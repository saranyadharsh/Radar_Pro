// useTickerData.js — NexRadar Pro
// Custom hook that owns the SSE connection, flush interval, snapshot fetch,
// market-open reset, session boundary AH purge, and live notifications.
//
// Returns: { tickers, wsStatus, marketSession, notifications, unreadCount,
//            clearNotifications, sseRef }
//
// FIXES IN THIS VERSION:
//
//   MARKET-OPEN-FIX: The market-open reset useEffect was calling
//     sseRef.current.onopen / .onmessage / .onerror / .close() directly.
//     These are EventSource methods — sseRef.current is a SharedWorker,
//     which has none of them. The call silently failed (no error thrown),
//     leaving the worker connected but React state cleared → blank dashboard
//     with no recovery path.
//     Fix: send { type:'clear_cache' } message to the worker instead.
//     The worker clears its cache and forces a fresh SSE reconnect so the
//     backend sends a new snapshot with the session's data.
//
//   MIDNIGHT-RESET-FIX: scheduleMidnight() in the SSE useEffect also wiped
//     tickers and called fetchSnapshot() — but fetchSnapshot() only works on
//     the direct EventSource fallback path. On the SharedWorker path it
//     fetches from /api/snapshot and applies to tickerCacheRef directly, which
//     is correct and kept. The worker also receives clear_cache so its own
//     cache is flushed in sync.
//
//   FEED-WARNING-DEBOUNCE: feed_status {ok:false} fires on every SSE reconnect
//     bounce. Without debounce, users saw the red "Polygon data feed silent"
//     banner on almost every page load for 1-3s (false alarm — Polygon WS
//     reconnects that quickly). Now waits 5 seconds before escalating to
//     feed_warning, and immediately cancels if feed_status {ok:true} arrives.
//
//   HOP-3 FIXES (unchanged from prior version):
//   HOP-3-A  rAF batching replaces 1000ms setInterval flush.
//   HOP-3-B  feed_status + session_change handlers.
//   HOP-3-C  client_ts reconnect handshake.

import { useState, useEffect, useRef, useCallback } from "react";
import { API_BASE } from "../../config.js";
import { getMarketSession } from "./utils.js";
import { normalizeTicker } from "./normalizer.js";

const NOTIF_CAP           = 60;    // max items in bell panel
const NOTIF_COOLDOWN_MS   = 60_000; // per ticker+type dedup window (1 min)
// NOTIF-FLOOD-FIX: global rate cap — max this many new notifications per
// NOTIF_RATE_WINDOW_MS regardless of ticker variety. EMA cross signals can
// fire for 30 watchlist tickers simultaneously; without a global cap the bell
// fills instantly and the count bounces from 0 to 11+ every few seconds.
const NOTIF_RATE_CAP      = 5;      // max new notifs per rate window
const NOTIF_RATE_WINDOW_MS= 10_000; // 10-second sliding window
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
  // BLUR-FIX: tracks client-side receive time per ticker (Date.now() at SSE arrival).
  const tickerReceivedTsRef = useRef(new Map());
  // TICKER-MAP: {symbol: intId} — stored for flat-array decoding
  const tickerMapRef        = useRef({});
  const lastSessionRef      = useRef(getMarketSession());
  const sseRef              = useRef(null);
  const midnightTimerRef    = useRef(null);
  const notifRef            = useRef([]);
  const notifCooldownRef    = useRef({});
  // NOTIF-FLOOD-FIX: global rate window — timestamps of recent pushes
  const notifRateWindowRef  = useRef([]);

  // FEED-WARNING-DEBOUNCE: timer ref — prevents false alarm banner on brief bounces
  const feedWarningTimerRef = useRef(null);

  // HOP-3-A: rAF ref — one pending flush per animation frame (~16ms).
  const rafRef = useRef(null);

  const scheduleFlush = useCallback(() => {
    if (rafRef.current) return;
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

    // Per-ticker+type cooldown: skip duplicates within 60s
    if ((notifCooldownRef.current[key] || 0) + NOTIF_COOLDOWN_MS > now) return;
    notifCooldownRef.current[key] = now;

    // NOTIF-FLOOD-FIX: global rate cap — drop if > NOTIF_RATE_CAP new
    // notifications have already been pushed in the last NOTIF_RATE_WINDOW_MS.
    // This prevents the bell count bouncing from 0 → 11+ every few seconds
    // when EMA cross signals fire for all watchlist tickers simultaneously.
    const rateWindow = notifRateWindowRef.current;
    const cutoff = now - NOTIF_RATE_WINDOW_MS;
    // Evict entries older than the window
    notifRateWindowRef.current = rateWindow.filter(t => t > cutoff);
    if (notifRateWindowRef.current.length >= NOTIF_RATE_CAP) return;
    notifRateWindowRef.current.push(now);

    const next = [{ ...entry, id: now + Math.random(), ts: now }, ...notifRef.current].slice(0, NOTIF_CAP);
    notifRef.current = next;
    setNotifications([...next]);
    setUnreadCount(c => c + 1);
  }, []);

  // NOTIF-READ-FIX: two separate actions:
  //   markNotificationsRead() — zeros the unread badge but KEEPS the list.
  //     Called when the bell panel opens so the user can actually read the items.
  //   clearNotifications()    — wipes the list AND zeros the count.
  //     Called by the explicit "Clear all" button inside the panel.
  //
  // Old behaviour: clearNotifications() was called on every bell click, which
  // cleared the list before the user could read it, then new signals immediately
  // refilled the count → badge bounced 9 → 0 → 9 every few seconds.
  const markNotificationsRead = useCallback(() => {
    setUnreadCount(0);
  }, []);

  const clearNotifications = useCallback(() => {
    notifRef.current = [];
    setNotifications([]);
    setUnreadCount(0);
  }, []);

  // ── Market-open heartbeat ─────────────────────────────────────────────────
  // DUAL-TIMER-FIX: this separate useEffect previously scheduled an independent
  // 9:30 AM ET reset alongside scheduleMidnight() inside the SSE useEffect below.
  // Both targeted 9:30 ET but fired ~5 seconds apart, causing two cache clears and
  // two SSE reconnects back-to-back at market open — a double full-snapshot blast
  // that briefly blanked the dashboard.
  // Fix: removed this duplicate. scheduleMidnight() in the SSE useEffect is now
  // the single source of truth for the 9:30 AM reset on both SharedWorker and
  // direct EventSource paths.

  // ── SSE connection via SharedWorker (tab-switch & refresh safe) ───────────
  //
  // T2-8: Service Worker registration (production only).
  useEffect(() => {
    if (!import.meta.env.PROD) return;
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/service-worker.js', { scope: '/' })
        .then(reg => console.log('[NexRadar] Service Worker registered:', reg.scope))
        .catch(err => console.debug('[NexRadar] Service Worker registration skipped:', err.message));
    }
  }, []);

  // ── Main SSE / SharedWorker connection effect ─────────────────────────────
  useEffect(() => {
    const SSE_URL      = API_BASE + '/api/stream';
    const SNAPSHOT_URL = API_BASE + '/api/snapshot';

    const supportsSharedWorker = (() => {
      try { return typeof SharedWorker !== 'undefined' && !!SharedWorker; }
      catch { return false; }
    })();

    let cancelled     = false;
    let worker        = null;   // SharedWorker instance
    let source        = null;   // fallback direct EventSource
    let watchdogTimer = null;
    let lastSnapTs    = 0;      // fallback path only
    const WATCHDOG_MS = 20_000;

    const resetWatchdog = () => {
      if (watchdogTimer) clearTimeout(watchdogTimer);
      watchdogTimer = setTimeout(() => {
        if (cancelled) return;
        console.warn('[NexRadar] SSE silent for 20s — reconnecting');
        if (source) { source.onopen=null; source.onmessage=null; source.onerror=null; source.close(); source=null; }
        connectDirect();
      }, WATCHDOG_MS);
    };

    const fetchSnapshot = async (retries = 4, delayMs = 2000) => {
      for (let attempt = 0; attempt < retries; attempt++) {
        try {
          const res  = await fetch(SNAPSHOT_URL);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();
          const rows = data.data ?? data ?? [];
          if (!Array.isArray(rows) || rows.length === 0) {
            if (attempt < retries - 1) {
              console.info(`[NexRadar] Snapshot empty (attempt ${attempt + 1}/${retries}) — retrying in ${delayMs}ms`);
              await new Promise(r => setTimeout(r, delayMs));
              continue;
            }
            return;
          }
          const m = new Map();
          for (const row of rows) m.set(row.ticker, normalizeTicker(row));
          tickerCacheRef.current      = m;
          tickerCacheDirtyRef.current = false;
          const _rt0 = Date.now();
          m.forEach((_, tk) => tickerReceivedTsRef.current.set(tk, _rt0));
          setTickers(new Map(m));
          return;
        } catch (err) {
          if (attempt < retries - 1) {
            console.warn(`[NexRadar] Snapshot fetch error (attempt ${attempt + 1}/${retries}):`, err.message);
            await new Promise(r => setTimeout(r, delayMs));
          } else {
            console.warn('[NexRadar] Snapshot fetch failed after all retries:', err);
          }
        }
      }
    };

    // ── Shared message handler ─────────────────────────────────────────────
    const handleMsg = (msg) => {
      if (cancelled) return;

      if (msg.type === 'keepalive') return;
      if (msg.type === 'control')   return;
      if (msg.type === 'loading')   return;  // worker ack: cache empty, REST fetch triggered
      if (msg.type === 'watchlist_update') return;  // handled by useWatchlist

      if (msg.type === 'reconnected') {
        setWsStatus('connected');
        return;
      }

      if (msg.type === 'feed_warning') {
        setWsStatus(msg.ok ? 'connected' : 'feed_warning');
        return;
      }

      if (msg.type === 'feed_status') {
        if (msg.ok) {
          // Clear any pending debounce — feed is back up
          if (feedWarningTimerRef.current) {
            clearTimeout(feedWarningTimerRef.current);
            feedWarningTimerRef.current = null;
          }
          setWsStatus('connected');
        } else {
          // FEED-WARNING-DEBOUNCE: Polygon WS reconnects in <3s on normal bounces.
          // Wait 5s before showing the warning banner — eliminates false alarms
          // on every page load / tab switch that triggers an SSE reconnect cycle.
          if (feedWarningTimerRef.current) return; // already counting
          feedWarningTimerRef.current = setTimeout(() => {
            feedWarningTimerRef.current = null;
            if (!cancelled) {
              setWsStatus(tickerCacheRef.current.size > 0 ? 'feed_warning' : 'connecting');
            }
          }, 5_000);
        }
        return;
      }

      if (msg.type === 'session_change') {
        const s = msg.session;
        if (s === 'market' || s === 'after' || s === 'pre') setMarketSession(s);
        return;
      }

      if (msg.type === 'snapshot') {
        const rows = msg.data ?? [];
        // EMPTY-SNAPSHOT-FIX: don't wipe valid cache with an empty snapshot
        if (rows.length === 0 && tickerCacheRef.current.size > 0) return;
        lastSnapTs = msg.ts ?? Date.now();
        const m = new Map();
        for (const row of rows) m.set(row.ticker, normalizeTicker(row));
        tickerCacheRef.current      = m;
        tickerCacheDirtyRef.current = false;
        const _rt1 = Date.now();
        m.forEach((_, tk) => tickerReceivedTsRef.current.set(tk, _rt1));
        setTickers(new Map(m));
        setWsStatus('connected');
        return;
      }

      if (msg.type === 'snapshot_delta') {
        lastSnapTs = msg.ts ?? Date.now();
        const cache = tickerCacheRef.current;
        const _rt2  = Date.now();
        for (const row of msg.data ?? []) {
          if (row?.ticker) {
            cache.set(row.ticker, normalizeTicker(row));
            tickerReceivedTsRef.current.set(row.ticker, _rt2);
          }
        }
        tickerCacheDirtyRef.current = true;
        scheduleFlush();
        return;
      }

      if (msg.type === 'tick') {
        tickerCacheRef.current.set(msg.ticker, normalizeTicker(msg.data));
        tickerCacheDirtyRef.current = true;
        tickerReceivedTsRef.current.set(msg.ticker, Date.now());
        scheduleFlush();
        const row = msg.data;
        if (row?.volume_spike)
          _pushNotif({ type:'vol',  icon:'📡', color:'#00d4ff', ticker:row.ticker, title:`${row.ticker} VOL SPIKE`,   sub:`${(row.rvol||row.volume_ratio||1).toFixed(1)}× avg` });
        if (row?.ah_momentum)
          _pushNotif({ type:'ah',   icon:'🌙', color:'#b388ff', ticker:row.ticker, title:`${row.ticker} AH MOMENTUM`, sub:`${(row.percent_change||0).toFixed(2)}% AH` });
        if (row?.is_gap_play)
          _pushNotif({ type:'gap',  icon:'📊', color:'#ffc400', ticker:row.ticker, title:`${row.ticker} GAP PLAY`,    sub:`${(row.gap_percent||0).toFixed(1)}% gap` });
        return;
      }

      if (msg.type === 'ticker_map') {
        tickerMapRef.current = msg.map ?? {};
        return;
      }

      if (msg.type === 'tick_batch') {
        const cache = tickerCacheRef.current;
        const _rt3  = Date.now();
        for (const row of msg.data ?? []) {
          // MERGE-FIX: merge slim delta into existing full cache entry.
          // tick_batch only carries 7 fields — don't wipe change_value/prev_close/open_price.
          const existing = cache.get(row.ticker);
          const merged   = existing
            ? normalizeTicker({ ...existing, ...row })
            : normalizeTicker(row);
          cache.set(row.ticker, merged);
          tickerReceivedTsRef.current.set(row.ticker, _rt3);
        }
        tickerCacheDirtyRef.current = true;
        scheduleFlush();
        return;
      }

      if (msg.type === 'alert') {
        const detail = { ts: Date.now(), ...msg.data };
        window.dispatchEvent(new CustomEvent('nexradar_alert', { detail }));
        if (msg.data) {
          const a = msg.data;
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
          });
        }
        return;
      }

      if (msg.type === 'halt_alert') {
        window.dispatchEvent(new CustomEvent('nexradar_halt', { detail: msg }));
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
        });
        return;
      }

      if (msg.type === 'noi_update') {
        window.dispatchEvent(new CustomEvent('nexradar_noi', { detail: msg }));
        return;
      }

      // ── Background poller alerts (news, edgar, earnings, fda) ──────────
      if (msg.type === 'news_alert' || msg.type === 'edgar_alert' ||
          msg.type === 'earnings_alert' || msg.type === 'fda_alert') {
        const colorMap = {
          green:  '#00e676',
          red:    '#ff3d5a',
          gold:   '#ffc400',
          cyan:   '#00d4ff',
          purple: '#b388ff',
        };
        const detail = {
          type:    msg.type,
          ticker:  msg.ticker || '',
          title:   msg.title  || '',
          sub:     msg.sub    || '',
          icon:    msg.emoji  || (msg.type === 'news_alert' ? '📰' : msg.type === 'fda_alert' ? '💊' : '📋'),
          color:   colorMap[msg.color] || '#00d4ff',
          url:     msg.url    || '',
          ts:      msg.ts ?? Date.now(),
          emoji:   msg.emoji  || (msg.type === 'news_alert' ? '📰' : msg.type === 'fda_alert' ? '💊' : '📋'),
          message: msg.sub    || msg.message || '',
          signal:  msg.signal || '',
          score:   msg.score  ?? null,
        };
        window.dispatchEvent(new CustomEvent('nexradar_alert', { detail }));
        _pushNotif({
          type:   msg.type,
          icon:   detail.icon,
          color:  detail.color,
          ticker: detail.ticker,
          title:  detail.title,
          sub:    detail.sub,
        });
        return;
      }
    };

    // ── SharedWorker path ──────────────────────────────────────────────────
    // SHAREDWORKER-LIFETIME-FIX: _mainHandler hoisted to useEffect scope
    // so the cleanup return block can call removeEventListener without
    // closing the port (which would terminate the SharedWorker).
    let _mainHandler = null;

    const connectWorker = () => {
      try {
        worker = new SharedWorker('/sseWorker.js', { name: 'nexradar-sse' });
      } catch (constructErr) {
        console.warn('[NexRadar] SharedWorker() constructor threw — falling back to direct SSE:', constructErr);
        connectDirect();
        return;
      }

      sseRef.current = worker;

      _mainHandler = (e) => handleMsg(e.data);
      worker.port.addEventListener('message', _mainHandler);

      worker.port.onmessageerror = (e) =>
        console.warn('[NexRadar] Worker message error:', e);

      worker.onerror = (e) => {
        console.error('[NexRadar] SharedWorker failed — falling back to direct SSE:', e);
        worker.port.removeEventListener('message', _mainHandler);
        worker         = null;
        sseRef.current = null;
        connectDirect();
      };

      // Send API_BASE FIRST so worker can open absolute EventSource URL.
      // Then request snapshot — worker replies from cache or triggers REST fetch.
      worker.port.postMessage({ type: 'set_api_base', base: API_BASE });
      worker.port.postMessage('get_snapshot');
      worker.port.start();
    };

    // ── Direct EventSource fallback (Safari <16, Firefox private) ─────────
    const connectDirect = () => {
      if (cancelled) return;
      fetchSnapshot();
      source = new EventSource(`${SSE_URL}?client_ts=${lastSnapTs}`);
      sseRef.current = source;
      setWsStatus('connecting');
      fetch(`${API_BASE}/api/health`, { signal: AbortSignal.timeout(8000) })
        .then(r => r.ok ? r.json() : null)
        .then(h => { if (h?.warming_up) setWsStatus('warming_up'); })
        .catch(() => {});

      source.onopen = () => {
        setWsStatus('connected');
        resetWatchdog();
        fetchSnapshot();
      };

      let lastWatchdogReset = 0;
      source.onmessage = (event) => {
        if (cancelled) return;
        const now = Date.now();
        if (now - lastWatchdogReset > 1000) { resetWatchdog(); lastWatchdogReset = now; }
        try   { handleMsg(JSON.parse(event.data)); }
        catch (err) { console.debug('[NexRadar] SSE parse error:', err); }
      };

      source.onerror = () => {
        setWsStatus('connecting');
        if (source.readyState === EventSource.CLOSED && !cancelled) {
          console.log('[NexRadar] SSE closed — reconnecting …');
          setTimeout(() => { if (!cancelled) connectDirect(); }, 1500);
        }
      };
    };

    // ── Start ──────────────────────────────────────────────────────────────
    if (supportsSharedWorker) {
      connectWorker();
    } else {
      console.info('[NexRadar] SharedWorker unavailable — using direct EventSource');
      connectDirect();
    }

    // ── Midnight / market-open reset (ET 09:30) ────────────────────────────
    // MIDNIGHT-RESET-FIX: on SharedWorker path, send clear_cache to worker
    // instead of calling fetchSnapshot() alone (which only seeds React state,
    // not the worker's in-memory cache — stale data would persist for other tabs).
    const scheduleMidnight = () => {
      const nowUtc  = new Date();
      const etNow   = new Date(nowUtc.toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const etNext  = new Date(etNow);
      etNext.setHours(9, 30, 0, 0);
      if (etNext <= etNow) etNext.setDate(etNext.getDate() + 1);
      const etOffsetMs  = nowUtc.getTime() - etNow.getTime();
      const fireAtUtcMs = etNext.getTime() + etOffsetMs;
      const msUntil     = fireAtUtcMs - nowUtc.getTime();
      midnightTimerRef.current = setTimeout(() => {
        if (cancelled) return;
        // Clear React-side cache
        tickerCacheRef.current      = new Map();
        tickerCacheDirtyRef.current = true;
        tickerReceivedTsRef.current = new Map();
        setTickers(new Map());
        // Tell worker to also clear its cache & reconnect
        if (worker) {
          worker.port.postMessage({ type: 'clear_cache' });
        } else {
          // Direct path: also fetch fresh snapshot
          fetchSnapshot();
        }
        scheduleMidnight();
      }, Math.max(msUntil, 1000));
    };
    scheduleMidnight();

    // ── Stale ticker check every 3s (market hours only) ───────────────────
    staleCheckRef.current = setInterval(() => {
      const session = getMarketSession();
      if (session !== 'market') {
        setStaleTickers(new Set());
        return;
      }
      const now   = Date.now();
      const stale = new Set();
      tickerReceivedTsRef.current.forEach((receivedAt, ticker) => {
        if ((now - receivedAt) > 6_000) stale.add(ticker);
      });
      setStaleTickers(stale);
    }, 3_000);

    return () => {
      cancelled = true;
      if (rafRef.current)             cancelAnimationFrame(rafRef.current);
      if (watchdogTimer)              clearTimeout(watchdogTimer);
      if (feedWarningTimerRef.current){ clearTimeout(feedWarningTimerRef.current); feedWarningTimerRef.current = null; }
      if (staleCheckRef.current)      clearInterval(staleCheckRef.current);
      if (midnightTimerRef.current)   clearTimeout(midnightTimerRef.current);
      // SHAREDWORKER-LIFETIME-FIX: do NOT call worker.port.close() here.
      // Closing the port while the tab is still open disconnects the last
      // port reference, which terminates the SharedWorker entirely — losing
      // state.snapTs, state.cache, and the live EventSource connection.
      // The next connect() then starts with client_ts=0 (full snapshot blast).
      // SharedWorker ports close automatically when the tab closes; explicit
      // port.close() in React cleanup is what causes the ~60s reconnect cycle.
      // We only need to stop listening — removeEventListener handles that.
      if (worker)  worker.port.removeEventListener('message', _mainHandler);
      if (source) { source.onopen=null; source.onmessage=null; source.onerror=null; source.close(); }
      sseRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { tickers, wsStatus, marketSession, sseRef, notifications, unreadCount, markNotificationsRead, clearNotifications, staleTickers };
}
