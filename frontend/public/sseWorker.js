/**
 * sseWorker.js — NexRadar Pro  SharedWorker  (Fix-4 + HOP fixes + REFRESH-FIX)
 * ================================================================
 * One JS thread shared across ALL tabs of the same origin.
 * Holds the single EventSource connection permanently.
 *
 * Lifecycle:
 *   - Created when the FIRST tab opens nexradar.info
 *   - Survives: tab switches, page refreshes, navigation between pages
 *   - Terminated: only when ALL tabs are closed simultaneously
 *
 * FIXES IN THIS VERSION:
 *
 *   BUG-5 FIX  Honor msg.partial in snapshot handler.
 *              Tier-2 reconnect in main.py sends type="snapshot" with
 *              partial:true when the changed-rows set is non-empty but
 *              not a full replacement. The old isEarly size heuristic
 *              could decide to WIPE and rebuild from only those rows,
 *              losing the rest of the cache. Fix: when partial:true,
 *              always merge (never wipe), regardless of size comparison.
 *
 *   BUG-7 FIX  Sort worker debounce: sort dispatch is now debounced 150ms
 *              inside PageLiveTable — this worker is unaffected but the
 *              comment is kept here for traceability.
 *
 *   BUG-8 FIX  Gap replay error handling: when /api/replay returns
 *              ok:false (gap not in buffer), trigger reconnect() with
 *              client_ts=0 to force a fresh full snapshot rather than
 *              silently dropping the gap and continuing with a stale cache.
 *
 *   ATOMIC-SWAP-FIX: state.cache = {} followed by rebuild created a ~0ms
 *     window (visible to same-thread port message handlers) where cache was
 *     empty. Replaced with: build newCache first, then atomically assign.
 *
 *   EMPTY-CACHE-FETCH-FIX: When a new/refreshed tab sends get_snapshot but
 *     the SSE snapshot hasn't arrived yet (worker just reconnected after backend
 *     restart), the worker now fetches /api/snapshot directly and seeds its
 *     cache so the tab gets data immediately instead of showing a blank screen
 *     for up to 120 seconds.
 *
 *   PENDING-PORT-FIX: Ports that sent get_snapshot while cache was empty are
 *     now stored in a pendingPorts set and receive the snapshot as soon as it
 *     arrives via SSE broadcast or direct REST fetch — no polling needed.
 *
 *   HOP FIXES APPLIED:
 *   HOP-1b  JSON.parse runs here in the worker thread.
 *   HOP-2   Exponential backoff reconnect + watchdog.
 *   HOP-3-C client_ts passed on every reconnect.
 */

'use strict'

const state = {
  es:        null,     // EventSource instance — one for the whole browser session
  cache:     {},       // ticker → latest row (always current, all msg types merged)
  snapTs:    0,        // ts of last snapshot/delta — used for client_ts handshake
  ports:     new Set(),// one MessagePort per connected tab
  pendingPorts: new Set(), // ports waiting for first snapshot (cache was empty on get_snapshot)
  feedOk:    null,     // last known feed_status.ok — replayed to new tab ports
  attempt:   0,        // reconnect backoff counter
  apiBase:   '',       // set once by the first tab
  fetchingSnapshot: false, // guard: only one direct REST fetch at a time
  // SEQ-FIX: gap detection
  lastSeq:   0,        // last received sequence number
  tickerMap: {},       // {symbol: intId} — sent by server on connect
  tickerMapRev: {},    // {intId: symbol} — reverse lookup
}

// SEQ-FIX: gap recovery thresholds
const GAP_REPLAY_MAX_S  = 30
const GAP_REPLAY_MAX_N  = 300

// HOP-2: explicit backoff table
const BACKOFF_MS  = [1000, 2000, 4000, 8000, 30_000]
const WATCHDOG_MS = 25_000

let backoffTimer  = null
let watchdogTimer = null

// ── Watchdog ──────────────────────────────────────────────────────────────────
function resetWatchdog() {
  if (watchdogTimer) clearTimeout(watchdogTimer)
  watchdogTimer = setTimeout(() => {
    console.warn('[sseWorker] No SSE message in 25s — forcing reconnect')
    reconnect()
  }, WATCHDOG_MS)
}

// ── Broadcast to all connected tab ports ──────────────────────────────────────
function broadcast(msg) {
  const dead = []
  state.ports.forEach(port => {
    try   { port.postMessage(msg) }
    catch { dead.push(port) }
  })
  dead.forEach(p => { state.ports.delete(p); state.pendingPorts.delete(p) })
}

// ── Flush snapshot to any port that was waiting (pendingPorts) ─────────────────
// Called after cache is populated (either via SSE or direct REST fetch).
function flushPendingPorts() {
  if (state.pendingPorts.size === 0) return
  const cacheValues = Object.values(state.cache)
  if (cacheValues.length === 0) return

  const snapMsg = {
    type:    'snapshot',
    data:    cacheValues,
    ts:      state.snapTs,
    lastSeq: state.lastSeq,
  }
  const tickerMapMsg = Object.keys(state.tickerMap).length > 0
    ? { type: 'ticker_map', map: state.tickerMap }
    : null
  const feedMsg = state.feedOk !== null
    ? { type: 'feed_status', ok: state.feedOk }
    : null

  state.pendingPorts.forEach(port => {
    try {
      port.postMessage(snapMsg)
      if (tickerMapMsg) port.postMessage(tickerMapMsg)
      if (feedMsg)      port.postMessage(feedMsg)
    } catch {
      state.ports.delete(port)
    }
  })
  state.pendingPorts.clear()
}

// ── Direct REST snapshot fetch (when SSE cache is empty on tab connect) ────────
// EMPTY-CACHE-FETCH-FIX: instead of making the new tab wait up to 120s for the
// SSE snapshot, fetch /api/snapshot directly and seed the cache immediately.
// Guard: only one inflight fetch at a time (multiple tabs opening simultaneously).
function fetchSnapshotDirect() {
  if (!state.apiBase || state.fetchingSnapshot) return
  // Only fetch if cache is genuinely empty
  if (Object.keys(state.cache).length > 0) {
    flushPendingPorts()
    return
  }
  state.fetchingSnapshot = true
  fetch(`${state.apiBase}/api/snapshot`)
    .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
    .then(data => {
      const rows = data.data ?? data ?? []
      if (!Array.isArray(rows) || rows.length === 0) return
      // ATOMIC-SWAP-FIX: build first, then assign
      const newCache = {}
      rows.forEach(row => { if (row?.ticker) newCache[row.ticker] = row })
      state.cache  = newCache
      state.snapTs = data.ts ?? Date.now()
      console.info(`[sseWorker] Direct REST snapshot seeded: ${rows.length} tickers`)
      flushPendingPorts()
    })
    .catch(err => {
      console.warn('[sseWorker] Direct REST snapshot failed:', err.message)
    })
    .finally(() => {
      state.fetchingSnapshot = false
    })
}

// ── SSE connect ───────────────────────────────────────────────────────────────
function connect() {
  if (!state.apiBase) {
    console.warn('[sseWorker] connect() called before apiBase set — deferring')
    return
  }
  const url = `${state.apiBase}/api/stream?client_ts=${state.snapTs}`
  state.es  = new EventSource(url)

  state.es.onopen = () => {
    state.attempt = 0
    resetWatchdog()
  }

  // TIER1-1.5: Cache size guard
  function _evictStaleCache() {
    const MAX  = 10_000
    const keys = Object.keys(state.cache)
    if (keys.length <= MAX) return
    keys.sort((a, b) => (state.cache[a]?.ts ?? 0) - (state.cache[b]?.ts ?? 0))
    const evict = keys.slice(0, keys.length - MAX)
    evict.forEach(k => delete state.cache[k])
    console.info(`[sseWorker] Cache eviction: removed ${evict.length} stale entries`)
  }

  state.es.onmessage = (e) => {
    let msg
    try   { msg = JSON.parse(e.data) }
    catch { return }

    resetWatchdog()

    // SEQ-FIX: gap detection
    if (msg.seq !== undefined) {
      const expected = state.lastSeq + 1
      const received = msg.seq
      if (state.lastSeq > 0 && received > expected) {
        const gap       = received - expected
        const gapAgeSec = (Date.now() - state.snapTs) / 1000
        if (gap <= GAP_REPLAY_MAX_N && gapAgeSec <= GAP_REPLAY_MAX_S) {
          console.info(`[sseWorker] Seq gap ${expected}→${received} (${gap} missed) — replaying`)
          fetch(`${state.apiBase}/api/replay?from_seq=${expected}&to_seq=${received - 1}`)
            .then(r => r.json())
            .then(data => {
              // BUG-8 FIX: if the replay buffer doesn't cover the gap, the cache
              // is now stale. Force a full reconnect (client_ts=0) so the backend
              // sends a fresh snapshot rather than continuing with a gapped cache.
              if (!data.ok) {
                console.warn(`[sseWorker] Replay unavailable (${data.reason}) — forcing full reconnect`)
                state.snapTs = 0   // clear client_ts so Tier-1 (full snapshot) fires
                reconnect()
                return
              }
              if (data.messages) {
                data.messages.forEach(rawMsg => {
                  const json = rawMsg.replace(/^data: /, '').trim()
                  try {
                    const m = JSON.parse(json)
                    if (m.type === 'snapshot_delta' || m.type === 'tick_batch') {
                      ;(m.data ?? []).forEach(row => { if (row?.ticker) state.cache[row.ticker] = row })
                    }
                  } catch {}
                })
              }
            })
            .catch(() => {
              // Network error during replay — reconnect for safety
              console.warn('[sseWorker] Replay fetch failed — forcing full reconnect')
              state.snapTs = 0
              reconnect()
            })
        }
      }
      state.lastSeq = received
    }

    // TICKER-MAP
    if (msg.type === 'ticker_map') {
      state.tickerMap    = msg.map ?? {}
      state.tickerMapRev = {}
      Object.entries(state.tickerMap).forEach(([sym, id]) => {
        state.tickerMapRev[id] = sym
      })
      broadcast(msg)
      return
    }

    if (msg.type === 'snapshot') {
      const incoming  = msg.data ?? []
      const cacheSize = Object.keys(state.cache).length
      const cacheAge  = Date.now() - state.snapTs
      const FRESH_MS  = 5 * 60 * 1000

      // BUG-5 FIX: msg.partial === true means this is a Tier-2 zero-delta fallback
      // from main.py (changed rows only, not a full replacement). Always MERGE,
      // never wipe. The old isEarly size heuristic could decide to wipe and rebuild
      // from only the partial rows, dropping the rest of the cache entirely.
      const isPartial = msg.partial === true
      const isEarly   = !isPartial &&
                        cacheSize > 100 &&
                        incoming.length < cacheSize * 0.5 &&
                        cacheAge < FRESH_MS

      if (isPartial || isEarly) {
        // Merge partial/early snapshot — never wipe full cache
        incoming.forEach(row => { if (row?.ticker) state.cache[row.ticker] = row })
        state.snapTs = msg.ts ?? Date.now()
        console.info(
          `[sseWorker] ${isPartial ? 'Partial' : 'Early'} snapshot (${incoming.length} rows) ` +
          `merged into ${cacheSize} cached`
        )
      } else {
        // ATOMIC-SWAP-FIX: build newCache first, then assign atomically.
        // The old pattern (state.cache = {} then rebuild) created a visible
        // empty window. This eliminates it entirely.
        const newCache = {}
        incoming.forEach(row => { if (row?.ticker) newCache[row.ticker] = row })
        state.cache  = newCache
        state.snapTs = msg.ts ?? Date.now()
      }

      // Flush any tab ports that were waiting for first snapshot
      flushPendingPorts()
    }
    else if (msg.type === 'snapshot_delta') {
      ;(msg.data ?? []).forEach(row => { if (row?.ticker) state.cache[row.ticker] = row })
      state.snapTs = msg.ts ?? Date.now()
      _evictStaleCache()
      // If there were pending ports and we now have data, flush them
      if (state.pendingPorts.size > 0 && Object.keys(state.cache).length > 0) {
        flushPendingPorts()
      }
    }
    else if (msg.type === 'tick_batch') {
      const rawData = msg.data ?? []
      let batchData
      if (rawData.length > 0 && Array.isArray(rawData[0])) {
        batchData = []
        for (const arr of rawData) {
          const sym = state.tickerMapRev[arr[0]]
          if (!sym) continue
          // OPEN-PRICE-PRESERVE-FIX: the compact array format carries only 7 fields.
          // open / open_price are NOT in the array — preserve them from the cached
          // full row so the MH Open column never shows $0.00 after a tick update.
          // Without this, every tick in array format silently wipes open_price to
          // undefined, even though _DELTA_FIELDS in ws_engine includes "open".
          const cached = state.cache[sym] ?? {}
          batchData.push({
            ticker:         sym,
            price:          arr[1],
            live_price:     arr[1],
            change_pct:     arr[2],
            percent_change: arr[2],
            change_value:   arr[3],
            volume:         arr[4],
            rvol:           arr[5],
            ts:             arr[6],
            // Carry open fields from cache — never overwrite with undefined
            open:           cached.open       ?? cached.open_price ?? 0,
            open_price:     cached.open_price ?? cached.open       ?? 0,
            prev_close:     cached.prev_close  ?? 0,
          })
        }
      } else {
        batchData = rawData
      }
      batchData.forEach(row => {
        if (row?.ticker) state.cache[row.ticker] = { ...(state.cache[row.ticker] ?? {}), ...row }
      })
      broadcast({ ...msg, data: batchData })
      return
    }
    else if (msg.type === 'tick') {
      if (msg.ticker && msg.data) state.cache[msg.ticker] = msg.data
    }
    else if (msg.type === 'feed_status') {
      state.feedOk = msg.ok
      // Fall through to broadcast
    }
    else if (msg.type === 'reconnected') {
      state.attempt = 0
      // Fall through to broadcast
    }
    else if (msg.type === 'keepalive') {
      // Watchdog already reset above — don't fan out
      return
    }

    broadcast(msg)
  }

  state.es.onerror = () => {
    state.es.close()
    state.es = null
    reconnect()
  }
}

// ── Reconnect with exponential backoff ────────────────────────────────────────
function reconnect() {
  if (backoffTimer)  clearTimeout(backoffTimer)
  if (watchdogTimer) clearTimeout(watchdogTimer)
  if (state.es)      { state.es.close(); state.es = null }

  broadcast({ type: 'feed_status', ok: false, reason: 'sse_reconnecting' })

  const delay = BACKOFF_MS[Math.min(state.attempt, BACKOFF_MS.length - 1)]
  state.attempt += 1

  backoffTimer = setTimeout(() => {
    backoffTimer = null
    connect()
  }, delay)
}

// ── Tab port management ───────────────────────────────────────────────────────
self.onconnect = (e) => {
  const port = e.ports[0]
  state.ports.add(port)

  port.onmessage = (event) => {

    // ── clear_cache: market-open reset from useTickerData ──────────────────
    // Fired when ET clock crosses 9:30 AM — clears stale pre/AH session data.
    if (event.data?.type === 'clear_cache') {
      state.cache  = {}
      state.snapTs = 0
      state.fetchingSnapshot = false  // reset guard so REST fetch can run immediately
      console.info('[sseWorker] Cache cleared by market-open reset')
      // Force reconnect so backend sends fresh snapshot immediately
      if (state.es) {
        state.es.close()
        state.es = null
      }
      // Trigger a direct REST fetch immediately so the empty-cache window
      // is minimized — any tab that sends get_snapshot while SSE reconnects
      // will be served from the REST fetch result rather than seeing blank data.
      setTimeout(() => {
        connect()
        fetchSnapshotDirect()
      }, 100)
      return
    }

    // ── set_api_base: first tab sends API base URL ─────────────────────────
    if (event.data?.type === 'set_api_base' && event.data.base && !state.apiBase) {
      state.apiBase = event.data.base.replace(/\/$/, '')
      console.log(`[sseWorker] apiBase set to: ${state.apiBase}`)
      if (!state.es && !backoffTimer) {
        connect()
      }
      return
    }

    // ── get_snapshot: tab just mounted, wants current data ─────────────────
    if (event.data === 'get_snapshot') {
      const cacheKeys = Object.keys(state.cache)

      if (cacheKeys.length > 0) {
        // Cache is populated — reply immediately
        port.postMessage({
          type:    'snapshot',
          data:    Object.values(state.cache),
          ts:      state.snapTs,
          lastSeq: state.lastSeq,
        })
        if (Object.keys(state.tickerMap).length > 0) {
          port.postMessage({ type: 'ticker_map', map: state.tickerMap })
        }
        if (state.feedOk !== null) {
          port.postMessage({ type: 'feed_status', ok: state.feedOk })
        }
      } else {
        // EMPTY-CACHE-FETCH-FIX: cache is empty (worker just started or
        // reconnected after backend restart). Add this port to pendingPorts
        // so it receives the snapshot as soon as it arrives.
        // Also trigger a direct REST fetch so we don't wait up to 120s.
        console.log('[sseWorker] get_snapshot: cache empty — fetching REST snapshot + queueing port')
        state.pendingPorts.add(port)
        port.postMessage({ type: 'loading', reason: 'snapshot_pending' })
        if (state.feedOk !== null) {
          port.postMessage({ type: 'feed_status', ok: state.feedOk })
        }
        // Trigger direct REST fetch to populate cache ASAP
        fetchSnapshotDirect()
      }
      return
    }
  }

  port.onmessageerror = () => {
    state.ports.delete(port)
    state.pendingPorts.delete(port)
  }
  port.start()
}
