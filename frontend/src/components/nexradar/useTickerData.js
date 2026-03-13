// useTickerData.js — NexRadar Pro
// Custom hook that owns the SSE connection, flush interval, snapshot fetch,
// market-open reset, session boundary AH purge, and live notifications.
//
// Returns: { tickers, wsStatus, marketSession, notifications, unreadCount,
//            clearNotifications, sseRef }

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
  const [marketSession, setMarketSession] = useState(getMarketSession);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount,   setUnreadCount]   = useState(0);

  // Mutable ref store — avoids Map copy on every tick
  const tickerCacheRef      = useRef(new Map());
  const tickerCacheDirtyRef = useRef(false);
  const lastSessionRef      = useRef(getMarketSession());
  const sseRef              = useRef(null);
  const midnightTimerRef    = useRef(null);
  const notifRef            = useRef([]);
  const notifCooldownRef    = useRef({});

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

  // ── SSE connection ────────────────────────────────────────────────────────
  useEffect(() => {
    const SSE_URL      = API_BASE + '/api/stream';
    const SNAPSHOT_URL = API_BASE + '/api/snapshot';

    let cancelled       = false;
    let source          = null;
    let flushIntervalId = null;
    let watchdogTimer   = null;
    const WATCHDOG_MS   = 20_000;

    const resetWatchdog = () => {
      if (watchdogTimer) clearTimeout(watchdogTimer);
      watchdogTimer = setTimeout(() => {
        if (cancelled) return;
        console.warn('[NexRadar] SSE silent for 20s — reconnecting');
        if (source) { source.onopen=null; source.onmessage=null; source.onerror=null; source.close(); }
        connectSSE();
      }, WATCHDOG_MS);
    };

    // Flush ref → React state at 1000ms (cuts reconcile work 4×)
    flushIntervalId = setInterval(() => {
      if (cancelled || !tickerCacheDirtyRef.current) return;
      tickerCacheDirtyRef.current = false;
      setTickers(new Map(tickerCacheRef.current));
    }, 1000);

    const fetchSnapshot = async () => {
      try {
        const res = await fetch(SNAPSHOT_URL);
        if (!res.ok) return;
        const data = await res.json();
        const rows = data.data ?? data ?? [];
        if (!Array.isArray(rows)) return;
        const m = new Map();
        for (const row of rows) m.set(row.ticker, normalizeTicker(row));
        tickerCacheRef.current      = m;
        tickerCacheDirtyRef.current = false;
        setTickers(new Map(m));
      } catch (err) {
        console.warn('[NexRadar] Snapshot fetch failed:', err);
      }
    };

    const connectSSE = () => {
      if (cancelled) return;
      fetchSnapshot();
      source = new EventSource(SSE_URL);
      sseRef.current = source;
      setWsStatus('connecting');

      source.onopen = () => {
        console.log('[NexRadar] SSE connected');
        setWsStatus('connected');
        resetWatchdog();
        fetchSnapshot();
      };

      let lastWatchdogReset = 0;
      source.onmessage = (event) => {
        if (cancelled) return;
        const _now = Date.now();
        if (_now - lastWatchdogReset > 1000) { resetWatchdog(); lastWatchdogReset = _now; }
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'keepalive') return;
          if (msg.type === 'watchlist_update') return; // handled by useWatchlist
          if (msg.type === 'snapshot') {
            const m = new Map();
            for (const row of msg.data ?? []) m.set(row.ticker, normalizeTicker(row));
            tickerCacheRef.current      = m;
            tickerCacheDirtyRef.current = false;
            setTickers(new Map(m));
            return;
          }
          if (msg.type === 'tick') {
            tickerCacheRef.current.set(msg.ticker, normalizeTicker(msg.data));
            tickerCacheDirtyRef.current = true;

            // Live notifications
            const row = msg.data;
            if (row?.volume_spike) {
              _pushNotif({ type:'vol', icon:'📡', color:'#00d4ff', ticker:row.ticker, title:`${row.ticker} VOL SPIKE`, sub:`${(row.rvol||row.volume_ratio||1).toFixed(1)}× avg` });
            }
            if (row?.ah_momentum) {
              _pushNotif({ type:'ah', icon:'🌙', color:'#b388ff', ticker:row.ticker, title:`${row.ticker} AH MOMENTUM`, sub:`${(row.percent_change||0).toFixed(2)}% AH` });
            }
            if (row?.is_gap_play) {
              _pushNotif({ type:'gap', icon:'📊', color:'#ffc400', ticker:row.ticker, title:`${row.ticker} GAP PLAY`, sub:`${(row.gap_percent||0).toFixed(1)}% gap` });
            }
            return;
          }
          if (msg.type === 'tick_batch') {
            const cache = tickerCacheRef.current;
            for (const row of msg.data) cache.set(row.ticker, normalizeTicker(row));
            tickerCacheDirtyRef.current = true;
            return;
          }
          if (msg.type === 'alert') {
            window.dispatchEvent(new CustomEvent('nexradar_alert', { detail: msg.data }));
            if (msg.data) {
              const a = msg.data;
              _pushNotif({
                type:   a.type,
                icon:   a.emoji,
                color:  a.color === 'green' ? '#00e676'
                       : a.color === 'red'  ? '#ff3d5a'
                       : a.color === 'gold' ? '#ffc400'
                       : a.color === 'cyan' ? '#00d4ff'
                       : '#8ba3b8',
                ticker: a.ticker,
                title:  a.title,
                sub:    a.message,
              });
            }
            return;
          }
          if (msg.type === 'halt_alert') {
            // Dispatch to window so PageLiveTable / any subscriber can react
            window.dispatchEvent(new CustomEvent('nexradar_halt', { detail: msg }));
            // Push to bell panel
            const isHalted = msg.is_halted;
            // BUG-12 FIX: prefix type with 'luld_' so cooldown key is
            // 'AAPL_luld_halt' not 'AAPL_halt' — prevents collision with any
            // ticker whose symbol is literally 'HALT' or 'RESUME'.
            if (isHalted) {
              _pushNotif({
                type:   'luld_halt',
                icon:   '⛔',
                color:  '#ff3d5a',
                ticker: msg.ticker,
                title:  `${msg.ticker} TRADING HALT`,
                sub:    msg.label || 'LULD volatility halt',
              });
            } else {
              _pushNotif({
                type:   'luld_resume',
                icon:   '✅',
                color:  '#00e676',
                ticker: msg.ticker,
                title:  `${msg.ticker} TRADING RESUMED`,
                sub:    'LULD halt lifted — trading active',
              });
            }
            return;
          }
          if (msg.type === 'noi_update') {
            // Dispatch for NOI imbalance meter (informational, no bell)
            window.dispatchEvent(new CustomEvent('nexradar_noi', { detail: msg }));
            return;
          }
          if (msg.type === 'control') return;
        } catch (err) {
          console.debug('[NexRadar] SSE parse error:', err);
        }
      };

      source.onerror = () => {
        setWsStatus('connecting');
        if (source.readyState === EventSource.CLOSED && !cancelled) {
          console.log('[NexRadar] SSE deliberately closed — reconnecting …');
          setTimeout(() => { if (!cancelled) connectSSE(); }, 1500);
        }
      };
    };

    connectSSE();

    // Midnight reset — fires at 09:30 ET to flush stale overnight data.
    // BUG-14 FIX: Was using browser local time (next.setHours(9,30)) which fires at
    // 09:30 Mountain = 11:30 ET for Denver users — 2hrs late into market session.
    // Fix: compute ET time explicitly via toLocaleString, identical to the
    // market-open heartbeat pattern already used above in this same file.
    const scheduleMidnight = () => {
      const nowUtc  = new Date();
      // Build an ET "clock" without relying on the browser's local timezone
      const etNow   = new Date(nowUtc.toLocaleString("en-US", { timeZone: "America/New_York" }));
      const etNext  = new Date(etNow);
      etNext.setHours(9, 30, 0, 0);          // 09:30:00.000 ET
      if (etNext <= etNow) etNext.setDate(etNext.getDate() + 1);   // already past → tomorrow
      // Convert the ET target back to UTC ms for setTimeout
      const etOffsetMs  = nowUtc.getTime() - etNow.getTime();       // UTC - ET = offset
      const fireAtUtcMs = etNext.getTime() + etOffsetMs;
      const msUntil     = fireAtUtcMs - nowUtc.getTime();
      midnightTimerRef.current = setTimeout(() => {
        if (cancelled) return;
        tickerCacheRef.current      = new Map();
        tickerCacheDirtyRef.current = true;
        setTickers(new Map());
        fetchSnapshot();
        scheduleMidnight();
      }, Math.max(msUntil, 1000));            // safety floor: never fire < 1s from now
    };
    scheduleMidnight();

    return () => {
      cancelled = true;
      if (flushIntervalId) clearInterval(flushIntervalId);
      if (watchdogTimer)   clearTimeout(watchdogTimer);
      if (midnightTimerRef.current) clearTimeout(midnightTimerRef.current);
      if (source) { source.onopen=null; source.onmessage=null; source.onerror=null; source.close(); }
      sseRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { tickers, wsStatus, marketSession, sseRef, notifications, unreadCount, clearNotifications };
}
