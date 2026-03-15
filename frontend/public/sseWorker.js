/**
 * sseWorker.js — NexRadar Pro  SharedWorker  (Fix-4 + HOP fixes)
 * ================================================================
 * One JS thread shared across ALL tabs of the same origin.
 * Holds the single EventSource connection permanently.
 *
 * Lifecycle:
 *   - Created when the FIRST tab opens nexradar.info
 *   - Survives: tab switches, page refreshes, navigation between pages
 *   - Terminated: only when ALL tabs are closed simultaneously
 *
 * Why this fixes the network hikes:
 *   Before: EventSource lived inside a React component. Every tab switch /
 *   page refresh / navigation = component unmount = SSE disconnect = backend
 *   fires full 3 MB snapshot on reconnect = CPU spike = queue fills = spiral.
 *
 *   After: EventSource lives here, never in React. Tab switches are invisible
 *   to the backend. Refresh = new tab connects to same worker via new port,
 *   requests current cache from memory — zero network round-trip.
 *
 * Message protocol (worker → page):
 *   { type: "snapshot",            data: [...] }   — full state on first connect
 *   { type: "snapshot_delta",      data: [...] }   — only changed rows (FIX-2)
 *   { type: "tick_batch",          data: [...] }   — 250ms coalesced ticks
 *   { type: "tick",                ticker, data }  — single tick
 *   { type: "feed_status",         ok: bool }      — Polygon WS up/down (FIX-5)
 *   { type: "session_change",      session: str }  — MH/AH boundary (FIX-3)
 *   { type: "portfolio_update",    data: [...] }
 *   { type: "watchlist_update",    ... }
 *   { type: "watchlist_snapshot",  watchlist: [...] }
 *   { type: "signal_snapshot",     data: [...] }
 *   { type: "alert",               data: {...} }
 *   { type: "halt_alert",          ... }
 *   { type: "noi_update",          ... }
 *   { type: "reconnected" }                        — client_ts handshake ack
 *   { type: "keepalive" }                          — heartbeat data message, resets watchdog
 *
 * Message protocol (page → worker):
 *   "get_snapshot"   — page just mounted, wants current cache immediately
 *
 * HOP FIXES APPLIED:
 *   HOP-1b  JSON.parse runs here in the worker thread — pages receive
 *           pre-parsed objects, never raw strings. Zero parse cost on main thread.
 *   HOP-2   Exponential backoff reconnect: 1s→2s→4s→8s→30s cap.
 *           Native EventSource auto-reconnect replaced with manual control so
 *           client_ts is always fresh on each attempt (not stale from original URL).
 *   HOP-2   Watchdog: if no message in 25s, force reconnect. Catches silent TCP
 *           drops that EventSource onerror misses on some proxies/load balancers.
 *   HOP-3-C client_ts passed on every reconnect — backend skips the 3MB snapshot
 *           if worker cache is <10s old, returning a lightweight "reconnected" ack.
 */

'use strict'

const state = {
  es:        null,     // EventSource instance — one for the whole browser session
  cache:     {},       // ticker → latest row (always current, all msg types merged)
  snapTs:    0,        // ts of last snapshot/delta — used for client_ts handshake
  ports:     new Set(),// one MessagePort per connected tab
  feedOk:    null,     // last known feed_status.ok — replayed to new tab ports
  attempt:   0,        // reconnect backoff counter
  apiBase:   '',       // set once by the first tab
  // SEQ-FIX: gap detection
  lastSeq:   0,        // last received sequence number
  tickerMap: {},       // {symbol: intId} — sent by server on connect
  tickerMapRev: {},    // {intId: symbol} — reverse lookup
}

// SEQ-FIX: gap recovery thresholds
const GAP_REPLAY_MAX_S  = 30   // gaps < 30s → replay missed batches
const GAP_REPLAY_MAX_N  = 300  // gaps > 300 seq → skip replay, use snapshot

// HOP-2: explicit backoff table — no surprise long waits from 2**n formulas
const BACKOFF_MS  = [1000, 2000, 4000, 8000, 30_000]
const WATCHDOG_MS = 25_000

let backoffTimer  = null
let watchdogTimer = null

// ── Watchdog ──────────────────────────────────────────────────────────────────
// Catches silent TCP drops: connections where the socket is technically open
// but no bytes are flowing (happens behind some Nginx/Cloudflare configurations).

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
    catch { dead.push(port) }   // tab closed — port throws on postMessage
  })
  dead.forEach(p => state.ports.delete(p))
}

// ── SSE connect ───────────────────────────────────────────────────────────────

function connect() {
  if (!state.apiBase) {
    // apiBase not set yet — wait for first tab to send it via 'set_api_base'
    console.warn('[sseWorker] connect() called before apiBase set — deferring')
    return
  }
  // HOP-3-C: include client_ts — backend returns lightweight "reconnected" ack
  // (30 bytes) instead of full 3MB snapshot when worker cache is fresh.
  // CRITICAL: use absolute URL — worker origin is nexradar.info (frontend),
  // but the API lives at api.nexradar.info. A relative /api/stream would hit
  // the static file server and fail. apiBase is passed by the first tab.
  const url = `${state.apiBase}/api/stream?client_ts=${state.snapTs}`
  state.es  = new EventSource(url)

  state.es.onopen = () => {
    state.attempt = 0  // clean connect — reset backoff counter
    resetWatchdog()
  }

  // TIER1-1.5: Cache size guard — evict oldest entries when cache > 10,000
  // sseWorker runs indefinitely in the browser — without a cap, 8hr trading
  // session accumulates stale rows that never get cleaned up.
  function _evictStaleCache () {
    const MAX = 10_000
    const keys = Object.keys(state.cache)
    if (keys.length <= MAX) return
    // Sort by ts ascending — evict oldest first
    keys.sort((a, b) => (state.cache[a]?.ts ?? 0) - (state.cache[b]?.ts ?? 0))
    const evict = keys.slice(0, keys.length - MAX)
    evict.forEach(k => delete state.cache[k])
    console.info(`[sseWorker] Cache eviction: removed ${evict.length} stale entries`)
  }

  state.es.onmessage = (e) => {
    // HOP-1b: JSON.parse here in worker thread — tabs receive pre-parsed objects.
    // This is the single biggest win for main-thread responsiveness: parsing
    // 6200-row snapshots (~40ms) no longer blocks React rendering.
    let msg
    try   { msg = JSON.parse(e.data) }
    catch { return }

    resetWatchdog()  // any message resets the dead-connection watchdog

    // SEQ-FIX: detect and recover from sequence gaps
    if (msg.seq !== undefined) {
      const expected = state.lastSeq + 1
      const received = msg.seq
      if (state.lastSeq > 0 && received > expected) {
        const gap        = received - expected
        const gapAgeMs   = Date.now() - state.snapTs
        const gapAgeSec  = gapAgeMs / 1000
        if (gap <= GAP_REPLAY_MAX_N && gapAgeSec <= GAP_REPLAY_MAX_S) {
          // Short gap — fetch missed batches from replay buffer
          console.info(`[sseWorker] Seq gap ${expected}→${received} (${gap} missed) — replaying`)
          fetch(`${state.apiBase}/api/replay?from_seq=${expected}&to_seq=${received - 1}`)
            .then(r => r.json())
            .then(data => {
              if (data.ok && data.messages) {
                data.messages.forEach(rawMsg => {
                  // rawMsg format: "data: {...}\n\n" — extract the JSON part
                  const json = rawMsg.replace(/^data: /, '').trim()
                  try {
                    const m = JSON.parse(json)
                    // Apply to cache (replay, don't broadcast to tabs — they'll get live update)
                    if (m.type === 'snapshot_delta' || m.type === 'tick_batch') {
                      ;(m.data ?? []).forEach(row => { if (row?.ticker) state.cache[row.ticker] = row })
                    }
                  } catch {}
                })
              } else {
                // Buffer miss — reconnect will send fresh snapshot via client_ts
                console.info(`[sseWorker] Replay unavailable (${data.reason}) — next reconnect will resync`)
              }
            })
            .catch(() => {})
        } else if (gapAgeSec > GAP_REPLAY_MAX_S) {
          // Long gap > 30s — sseWorker passes snapTs as client_ts on reconnect.
          // Backend tiers the response:
          //   10-30s gap → snapshot_delta (only changed rows, not all 6027)
          //   > 30s gap  → full snapshot (unavoidable after long absence)
          // No action needed here — the connect() function handles it automatically.
          console.info(`[sseWorker] Gap ${gapAgeSec.toFixed(0)}s — tier-${gapAgeSec > 30 ? 1 : 2} recovery on next reconnect`)
        }
      }
      state.lastSeq = received
    }

    // ── Update worker-side cache ──────────────────────────────────────────
    // Cache is kept current so new/refreshed tabs get instant data via get_snapshot
    // without any network round-trip.

    // TICKER-MAP: store int↔symbol map sent on connect
    if (msg.type === 'ticker_map') {
      state.tickerMap    = msg.map ?? {}
      state.tickerMapRev = {}
      Object.entries(state.tickerMap).forEach(([sym, id]) => {
        state.tickerMapRev[id] = sym
      })
      broadcast(msg)  // forward to tabs so they can decode flat-array messages
      return
    }

    if (msg.type === 'snapshot') {
      // Full state replace — sent only on true first connect or stale reconnect
      state.cache  = {}
      ;(msg.data ?? []).forEach(row => { if (row?.ticker) state.cache[row.ticker] = row })
      state.snapTs = msg.ts ?? Date.now()
    }
    else if (msg.type === 'snapshot_delta') {
      // Only changed rows — merge into existing cache (ws_engine FIX-2)
      // At market-hours peak: 200-400 rows every 2s instead of 6200
      ;(msg.data ?? []).forEach(row => { if (row?.ticker) state.cache[row.ticker] = row })
      state.snapTs = msg.ts ?? Date.now()
      _evictStaleCache()  // TIER1-1.5: keep cache bounded
    }
    else if (msg.type === 'tick_batch') {
      // 250ms coalesced ticks — merge into cache
      ;(msg.data ?? []).forEach(row => { if (row?.ticker) state.cache[row.ticker] = row })
    }
    else if (msg.type === 'tick') {
      // Single tick (legacy path)
      if (msg.ticker && msg.data) state.cache[msg.ticker] = msg.data
    }
    else if (msg.type === 'feed_status') {
      state.feedOk = msg.ok
      // Fall through to broadcast — pages need this to update wsStatus indicator
    }
    else if (msg.type === 'reconnected') {
      state.attempt = 0
      // Fall through to broadcast — pages need to clear "reconnecting" banner
    }
    else if (msg.type === 'keepalive') {
      // KEEPALIVE-FIX: now a real data message (was SSE comment).
      // resetWatchdog() already called above — don't fan out to tabs.
      return
    }

    // Fan out every message to all connected tab ports as a pre-parsed object
    broadcast(msg)
  }

  state.es.onerror = () => {
    // HOP-2: take manual control of reconnect so we can pass fresh client_ts.
    // Native EventSource auto-reconnect reuses the original URL — the client_ts
    // would be stale, defeating the handshake and forcing a full 3MB snapshot.
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

  // Notify all tabs that feed is down so UI can show reconnecting banner
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
    if (event.data === 'get_snapshot') {
      /**
       * Tab just mounted (first load OR page refresh OR tab switch).
       * Return current cache from worker memory — zero network call.
       * This is why refresh no longer costs a 3MB snapshot:
       * the worker already has all 6200 rows in state.cache.
       *
       * Sent as type="snapshot" — same shape as a real SSE snapshot,
       * so the existing snapshot handler in useTickerData applies unchanged.
       */
      port.postMessage({
        type:    'snapshot',
        data:    Object.values(state.cache),
        ts:      state.snapTs,
        lastSeq: state.lastSeq,
      })
      // Also send ticker_map so the new tab can decode flat-array messages
      if (Object.keys(state.tickerMap).length > 0) {
        port.postMessage({ type: 'ticker_map', map: state.tickerMap })
      }

      // Replay last known feed status so the tab's wsStatus indicator is correct
      if (state.feedOk !== null) {
        port.postMessage({ type: 'feed_status', ok: state.feedOk })
      }
    }

    // Tab sends its API base URL on first connect so the worker can open
    // an absolute EventSource URL. Without this the worker uses a relative
    // URL (/api/stream) which resolves to the FRONTEND origin (nexradar.info)
    // instead of the API origin (api.nexradar.info) — causing immediate 404.
    if (event.data?.type === 'set_api_base' && event.data.base && !state.apiBase) {
      state.apiBase = event.data.base.replace(/\/$/, '') // strip trailing slash
      console.log(`[sseWorker] apiBase set to: ${state.apiBase}`)
      // Now safe to open the SSE connection
      if (!state.es && !backoffTimer) {
        connect()
      }
    }
  }

  port.onmessageerror = () => state.ports.delete(port)
  port.start()

  // Connection is started when the first tab sends { type: 'set_api_base', base: '...' }.
  // Subsequent tabs reuse the same EventSource — no reconnect needed.
}
