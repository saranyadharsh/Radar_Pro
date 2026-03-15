// useTickerData.js — NexRadar Pro
// Custom hook that owns the SSE connection, flush interval, snapshot fetch,
// market-open reset, session boundary AH purge, and live notifications.
//
// Returns: { tickers, wsStatus, marketSession, notifications, unreadCount,
//            clearNotifications, sseRef }
//
// HOP-3 FIXES APPLIED:
//
//   HOP-3-A  requestAnimationFrame batching (replaces 1000ms setInterval flush)
//            tick, tick_batch, snapshot_delta all write into tickerCacheRef and
//            call scheduleFlush(). A single rAF callback flushes to React state
//            at most once per frame (~16ms). Zero renders during idle periods.
//            Also adds snapshot_delta handler — ws_engine FIX-2 sends only the
//            changed rows (200-400) instead of full 6200 on every 2s cycle.
//
//   HOP-3-B  feed_status + session_change SSE event handlers
//            feed_status ok:false → wsStatus='connecting' (Polygon WS dropped)
//            feed_status ok:true  → wsStatus='connected'  (Polygon WS restored)
//            session_change       → setMarketSession() instantly on boundary,
//            no longer waiting for the 30s clock-tick interval.
//
//   HOP-3-C  client_ts reconnect handshake
//            lastSnapTs tracks the ts field of the last received snapshot.
//            On reconnect, ?client_ts=lastSnapTs is appended to the SSE URL.
//            Backend skips the full 3 MB snapshot if client data is <10s old —
//            eliminates the blast on tab switches and short network hiccups.

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { API_BASE } from "../../config.js";
import { getMarketSession } from "./utils.js";
import { normalizeTicker } from "./normalizer.js";

const NOTIF_CAP         = 50;
const NOTIF_COOLDOWN_MS = 60_000;
const AH_FIELDS         = ['ah_dollar','ah_pct','today_close','prev_close','ah_momentum'];

export function useTickerData() {
  const [tickers,       setTickers]       = useState(new Map());
  const [wsStatus,      setWsStatus]      = useState('connecting');
  const [staleTickers,  setStaleTickers]  = useState(new Set());
  const staleCheckRef   = useRef(null);
  const [marketSession, setMarketSession] = useState(getMarketSession);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount,   setUnreadCount]   = useState(0);

  // Mutable ref store — avoids Map copy on every tick
  const tickerCacheRef      = useRef(new Map());
  const tickerCacheDirtyRef = useRef(false);
  // TICKER-MAP: {symbol: intId} — stored for future flat-array decoding
  const tickerMapRef        = useRef({});
  const lastSessionRef      = useRef(getMarketSession());
  const sseRef              = useRef(null);
  const midnightTimerRef    = useRef(null);
  const notifRef            = useRef([]);
  const notifCooldownRef    = useRef({});

  // HOP-3-A: rAF ref — one pending flush per animation frame (~16ms).
  // Replaces the 1000ms setInterval: renders fire only when data actually
  // changed, at most once per frame. Zero renders during idle/AH/pre-market.
  const rafRef = useRef(null);

  const scheduleFlush = useCallback(() => {
    if (rafRef.current) return; // already queued for this frame
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      if (!tickerCacheDirtyRef.current) return;
      tickerCacheDirtyRef.current = false;
      setTickers(new Map(tickerCacheRef.current));
    });
  }, []);

  // ── Market session clock ──────────────────────────────────────────────────
  useEffect(() => {
    const id = setInterval(() => setMarketSession(getMarketSession()), 30_000);
    return () => clearInterval(id);
  }, []);

  // ── Session boundary: purge stale AH fields on → Market Hours ───────────
  useEffect(() => {
    const prev = lastSessionRef.current;
    lastSessionRef.current = marketSession;
    if (prev === marketSession || marketSession !== 'market') return;
    console.log(`[NexRadar] Session ${prev} → market: purging stale AH cache fields`);
    const cache = tickerCacheRef.current;
    for (const [key, row] of cache) {
      const cleaned = { ...row };
      AH_FIELDS.forEach(f => delete cleaned[f]);
      cache.set(key, cleaned);
    }
    tickerCacheDirtyRef.current = true;
  }, [marketSession]);

  // ── Notifications helper ──────────────────────────────────────────────────
  const _pushNotif = useCallback((entry) => {
    const key = `${entry.ticker}_${entry.type}`;
    const now  = Date.now();
    if ((notifCooldownRef.current[key] || 0) + NOTIF_COOLDOWN_MS > now) return;
    notifCooldownRef.current[key] = now;
    const next = [{ ...entry, id:now+Math.random(), ts:now }, ...notifRef.current].slice(0, NOTIF_CAP);
    notifRef.current = next;
    setNotifications([...next]);
    setUnreadCount(c => c + 1);
  }, []);

  const clearNotifications = useCallback(() => {
    notifRef.current = [];
    setNotifications([]);
    setUnreadCount(0);
  }, []);

  // ── Market-open heartbeat ─────────────────────────────────────────────────
  useEffect(() => {
    const schedule = () => {
      const now   = new Date();
      const etNow = new Date(now.toLocaleString("en-US", { timeZone:"America/New_York" }));
      const target = new Date(etNow);
      target.setHours(9, 30, 5, 0);
      if (etNow >= target) target.setDate(target.getDate() + 1);
      const msUntil = target.getTime() - etNow.getTime();
      console.log(`[NexRadar] Market open reset in ${(msUntil/3_600_000).toFixed(2)}h`);
      return setTimeout(() => {
        console.log("[NexRadar] 🔔 Market Open — flushing stale session data");
        if (sseRef.current) {
          sseRef.current.onopen    = null;
          sseRef.current.onmessage = null;
          sseRef.current.onerror   = null;
          sseRef.current.close();
          sseRef.current = null;
        }
        setTickers(new Map());
        schedule();
      }, msUntil);
    };
    const timerId = schedule();
    return () => clearTimeout(timerId);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps


  // ── SSE connection via SharedWorker (tab-switch & refresh safe) ───────────
  //
  // SharedWorker path (all modern browsers except Safari <16 / FF private):
  //   - worker holds ONE EventSource for the entire browser session
  //   - tab mounts → port.postMessage('get_snapshot') → worker replies from
  //     in-memory cache instantly — zero network call on refresh/tab-switch
  //   - live SSE messages fan out from worker to all tab ports as pre-parsed
  //     objects (JSON.parse runs in worker thread, not main thread)
  //
  // Direct EventSource fallback (Safari <16, Firefox private browsing):
  //   - original prod behaviour preserved exactly
  //   - client_ts passed on reconnect so backend skips snapshot when fresh
  //
  useEffect(() => {
    const SSE_URL      = API_BASE + '/api/stream'
    const SNAPSHOT_URL = API_BASE + '/api/snapshot'

    // SharedWorker detection — typeof alone is insufficient on some mobile
    // browsers (iOS Chrome, some Android WebViews) where the global exists
    // in typeof but the constructor throws ReferenceError when called.
    // Test by actually referencing the constructor inside try/catch.
    const supportsSharedWorker = (() => {
      try { return typeof SharedWorker !== 'undefined' && !!SharedWorker; }
      catch { return false; }
    })()

    let cancelled     = false
    let worker        = null   // SharedWorker instance
    let source        = null   // fallback direct EventSource
    let watchdogTimer = null
    let lastSnapTs    = 0      // fallback path only — worker owns this for SharedWorker path
    const WATCHDOG_MS = 20_000

    const resetWatchdog = () => {
      if (watchdogTimer) clearTimeout(watchdogTimer)
      watchdogTimer = setTimeout(() => {
        if (cancelled) return
        console.warn('[NexRadar] SSE silent for 20s — reconnecting')
        if (source) { source.onopen=null; source.onmessage=null; source.onerror=null; source.close(); source=null }
        connectDirect()
      }, WATCHDOG_MS)
    }

    const fetchSnapshot = async () => {
      try {
        const res  = await fetch(SNAPSHOT_URL)
        if (!res.ok) return
        const data = await res.json()
        const rows = data.data ?? data ?? []
        if (!Array.isArray(rows)) return
        const m = new Map()
        for (const row of rows) m.set(row.ticker, normalizeTicker(row))
        tickerCacheRef.current      = m
        tickerCacheDirtyRef.current = false
        setTickers(new Map(m))
      } catch (err) {
        console.warn('[NexRadar] Snapshot fetch failed:', err)
      }
    }

    // ── Shared message handler ─────────────────────────────────────────────
    // Used by both the SharedWorker port and the direct EventSource path.
    // Worker sends pre-parsed objects; direct path parses inline before calling.
    const handleMsg = (msg) => {
      if (cancelled) return

      if (msg.type === 'keepalive') return
      if (msg.type === 'control')   return
      // watchlist_update handled by useWatchlist which also listens on sseRef
      if (msg.type === 'watchlist_update') return

      if (msg.type === 'reconnected') {
        setWsStatus('connected')
        return
      }

      // feed_status — Polygon WS up/down (ws_engine FIX-5)
      if (msg.type === 'feed_warning') {
        setWsStatus(msg.ok ? 'connected' : 'feed_warning')
        return
      }

      if (msg.type === 'feed_status') {
        setWsStatus(msg.ok ? 'connected' : 'connecting')
        return
      }

      // session_change — AH/MH boundary instantly (ws_engine FIX-3)
      // No longer waiting for the 30s clock-tick interval
      if (msg.type === 'session_change') {
        const s = msg.session
        if (s === 'market' || s === 'after' || s === 'pre') setMarketSession(s)
        return
      }

      // Full snapshot — sent on true first connect, stale reconnect, or get_snapshot reply
      if (msg.type === 'snapshot') {
        lastSnapTs = msg.ts ?? Date.now()   // track for fallback path client_ts
        const m = new Map()
        for (const row of msg.data ?? []) m.set(row.ticker, normalizeTicker(row))
        tickerCacheRef.current      = m
        tickerCacheDirtyRef.current = false
        setTickers(new Map(m))
        setWsStatus('connected')
        return
      }

      // snapshot_delta — ws_engine FIX-2: only changed rows (200-400 not 6200)
      if (msg.type === 'snapshot_delta') {
        lastSnapTs = msg.ts ?? Date.now()
        const cache = tickerCacheRef.current
        for (const row of msg.data ?? []) {
          if (row?.ticker) cache.set(row.ticker, normalizeTicker(row))
        }
        tickerCacheDirtyRef.current = true
        scheduleFlush()
        return
      }

      if (msg.type === 'tick') {
        tickerCacheRef.current.set(msg.ticker, normalizeTicker(msg.data))
        tickerCacheDirtyRef.current = true
        scheduleFlush()
        // Live notifications
        const row = msg.data
        if (row?.volume_spike)
          _pushNotif({ type:'vol',  icon:'📡', color:'#00d4ff', ticker:row.ticker, title:`${row.ticker} VOL SPIKE`,   sub:`${(row.rvol||row.volume_ratio||1).toFixed(1)}× avg` })
        if (row?.ah_momentum)
          _pushNotif({ type:'ah',   icon:'🌙', color:'#b388ff', ticker:row.ticker, title:`${row.ticker} AH MOMENTUM`, sub:`${(row.percent_change||0).toFixed(2)}% AH` })
        if (row?.is_gap_play)
          _pushNotif({ type:'gap',  icon:'📊', color:'#ffc400', ticker:row.ticker, title:`${row.ticker} GAP PLAY`,    sub:`${(row.gap_percent||0).toFixed(1)}% gap` })
        return
      }

      if (msg.type === 'ticker_map') {
        // Store int↔symbol map for future flat-array decoding (optimization #2)
        tickerMapRef.current = msg.map ?? {}
        return
      }

      if (msg.type === 'tick_batch') {
        const cache = tickerCacheRef.current
        for (const row of msg.data ?? []) cache.set(row.ticker, normalizeTicker(row))
        tickerCacheDirtyRef.current = true
        scheduleFlush()
        return
      }

      if (msg.type === 'alert') {
        window.dispatchEvent(new CustomEvent('nexradar_alert', { detail: msg.data }))
        if (msg.data) {
          const a = msg.data
          _pushNotif({
            type:   a.type,
            icon:   a.emoji,
            color:  a.color === 'green' ? '#00e676'
                  : a.color === 'red'   ? '#ff3d5a'
                  : a.color === 'gold'  ? '#ffc400'
                  : a.color === 'cyan'  ? '#00d4ff'
                  : '#8ba3b8',
            ticker: a.ticker,
            title:  a.title,
            sub:    a.message,
          })
        }
        return
      }

      if (msg.type === 'halt_alert') {
        // Dispatch to window so PageLiveTable / any subscriber can react
        window.dispatchEvent(new CustomEvent('nexradar_halt', { detail: msg }))
        // BUG-12 FIX: prefix 'luld_' so cooldown key never collides with
        // a ticker literally named 'HALT' or 'RESUME'
        _pushNotif(msg.is_halted ? {
          type:   'luld_halt',
          icon:   '⛔',
          color:  '#ff3d5a',
          ticker: msg.ticker,
          title:  `${msg.ticker} TRADING HALT`,
          sub:    msg.label || 'LULD volatility halt',
        } : {
          type:   'luld_resume',
          icon:   '✅',
          color:  '#00e676',
          ticker: msg.ticker,
          title:  `${msg.ticker} TRADING RESUMED`,
          sub:    'LULD halt lifted — trading active',
        })
        return
      }

      if (msg.type === 'noi_update') {
        // Dispatch for NOI imbalance meter (informational, no bell notification)
        window.dispatchEvent(new CustomEvent('nexradar_noi', { detail: msg }))
        return
      }
    }

    // ── SharedWorker path ──────────────────────────────────────────────────
    const connectWorker = () => {
      // Wrap constructor in try/catch — on some mobile browsers (iOS Chrome,
      // Android WebView, Firefox private) SharedWorker passes the typeof check
      // but throws ReferenceError or SecurityError on construction.
      // worker.onerror only catches async errors, not constructor throws.
      try {
        worker = new SharedWorker('/sseWorker.js', { name: 'nexradar-sse' })
      } catch (constructErr) {
        console.warn('[NexRadar] SharedWorker() constructor threw — falling back to direct SSE:', constructErr)
        connectDirect()
        return
      }

      // sseRef exposed so useWatchlist / PageSignals / PagePortfolio can
      // attach their own port.onmessage listeners to the same worker
      sseRef.current = worker

      worker.port.onmessage = (e) => handleMsg(e.data)

      worker.port.onmessageerror = (e) =>
        console.warn('[NexRadar] Worker message error:', e)

      worker.onerror = (e) => {
        console.error('[NexRadar] SharedWorker failed — falling back to direct SSE:', e)
        worker        = null
        sseRef.current = null
        connectDirect()
      }

      // CRITICAL: send API_BASE first so the worker can build an absolute URL.
      // Without this the worker has no URL, never opens EventSource, stays pending.
      // Must be sent BEFORE get_snapshot so the connection is open when cache is requested.
      worker.port.postMessage({ type: 'set_api_base', base: API_BASE })
      worker.port.postMessage('get_snapshot')
      worker.port.start()
    }

    // ── Direct EventSource fallback ────────────────────────────────────────
    const connectDirect = () => {
      if (cancelled) return
      fetchSnapshot()
      // HOP-3-C: client_ts prevents 3MB snapshot blast on fresh reconnects
      source = new EventSource(`${SSE_URL}?client_ts=${lastSnapTs}`)
      sseRef.current = source
      setWsStatus('connecting')
      fetch(`${API_BASE}/api/health`, { signal: AbortSignal.timeout(8000) })
        .then(r => r.ok ? r.json() : null)
        .then(h => { if (h?.warming_up) setWsStatus('warming_up') })
        .catch(() => {})
      source.onopen = () => {
        setWsStatus('connected')
        resetWatchdog()
        fetchSnapshot()
      }

      let lastWatchdogReset = 0
      source.onmessage = (event) => {
        if (cancelled) return
        const now = Date.now()
        if (now - lastWatchdogReset > 1000) { resetWatchdog(); lastWatchdogReset = now }
        try   { handleMsg(JSON.parse(event.data)) }
        catch (err) { console.debug('[NexRadar] SSE parse error:', err) }
      }

      source.onerror = () => {
        setWsStatus('connecting')
        if (source.readyState === EventSource.CLOSED && !cancelled) {
          console.log('[NexRadar] SSE closed — reconnecting …')
          setTimeout(() => { if (!cancelled) connectDirect() }, 1500)
        }
      }
    }

    // ── Start ──────────────────────────────────────────────────────────────
    if (supportsSharedWorker) {
      connectWorker()
    } else {
      console.info('[NexRadar] SharedWorker unavailable — using direct EventSource')
      connectDirect()
    }

    // ── Midnight / market-open reset (ET 09:30) ────────────────────────────
    // BUG-14 FIX: compute ET explicitly — never use browser local timezone.
    const scheduleMidnight = () => {
      const nowUtc  = new Date()
      const etNow   = new Date(nowUtc.toLocaleString('en-US', { timeZone: 'America/New_York' }))
      const etNext  = new Date(etNow)
      etNext.setHours(9, 30, 0, 0)
      if (etNext <= etNow) etNext.setDate(etNext.getDate() + 1)
      const etOffsetMs  = nowUtc.getTime() - etNow.getTime()
      const fireAtUtcMs = etNext.getTime() + etOffsetMs
      const msUntil     = fireAtUtcMs - nowUtc.getTime()
      midnightTimerRef.current = setTimeout(() => {
        if (cancelled) return
        tickerCacheRef.current      = new Map()
        tickerCacheDirtyRef.current = true
        setTickers(new Map())
        fetchSnapshot()
        scheduleMidnight()
      }, Math.max(msUntil, 1000))
    }
    scheduleMidnight()

    // TIER1-1.1: stale ticker check every 15s — market hours only.
    // During pre-market/after-hours/weekend Polygon sends no ticks so ts
    // never updates — every ticker would appear stale even with correct data.
    // Only meaningful during market hours when ticks should be flowing.
    staleCheckRef.current = setInterval(() => {
      const session = getMarketSession()
      if (session !== 'market') {
        // Outside market hours — clear any stale flags, nothing is stale
        setStaleTickers(new Set())
        return
      }
      const now   = Date.now()
      const cache = tickerCacheRef.current
      const stale = new Set()
      cache.forEach((row) => {
        if (row.ts && (now - row.ts) > 45_000) stale.add(row.ticker)
      })
      setStaleTickers(stale)
    }, 15_000)

    return () => {
      cancelled = true
      if (rafRef.current)           cancelAnimationFrame(rafRef.current)
      if (watchdogTimer)            clearTimeout(watchdogTimer)
      if (staleCheckRef.current)    clearInterval(staleCheckRef.current)
      if (midnightTimerRef.current) clearTimeout(midnightTimerRef.current)
      if (worker)                   worker.port.close()
      if (source) { source.onopen=null; source.onmessage=null; source.onerror=null; source.close() }
      sseRef.current = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return { tickers, wsStatus, marketSession, sseRef, notifications, unreadCount, clearNotifications, staleTickers };
}
