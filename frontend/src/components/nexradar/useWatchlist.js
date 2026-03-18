// useWatchlist.js — NexRadar Pro
// Global watchlist state shared by PageLiveTable, PagePortfolio, PageDashboard.
//
// REGRESSION FIX applied:
//   FIX-3  wsWatchlistRef was defined and returned, but the SSE message handler
//          in useTickerData.js discards watchlist_update events:
//            if (msg.type === 'watchlist_update') return;   ← no-op
//          AND useWatchlist was called without sseRef (now fixed in shell),
//          so even if we set up a listener here it had no SSE source.
//
//          Fix: attach a listener to the SSE source via sseRef when it
//          becomes available. When a watchlist_update arrives on the SSE
//          stream, apply the new watchlist array to state immediately.
//          This makes the star toggle in any tab instantly visible everywhere
//          without a full page refresh.

import { useState, useEffect, useRef, useCallback } from "react";
import { API_BASE } from "../../config.js";
import { isSharedWorker } from './sseConnection.js';

export function useWatchlist(sseRef) {
  const [watchlist, setWatchlist] = useState(new Set());
  // Exposed ref: shell passes this to PageLiveTable so legacy callers still work
  const wsWatchlistRef = useRef(null);

  // Keep ref in sync with latest setter
  useEffect(() => {
    wsWatchlistRef.current = setWatchlist;
    return () => { wsWatchlistRef.current = null; };
  }, []);

  // Initial load from backend
  useEffect(() => {
    fetch(`${API_BASE}/api/watchlist`)
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(data => setWatchlist(new Set(data.watchlist ?? [])))
      .catch(err => console.warn('[NexRadar] Failed to load watchlist:', err));
  }, []);

  // FIX-3 + WATCHLIST-ATTACH-FIX: intercept watchlist_update / watchlist_snapshot
  // from the SSE stream. Replaces the old recursive setTimeout(attach, 500) which
  // had no cap — could spin indefinitely on slow cold-starts.
  // New: setInterval that stops itself the moment it successfully attaches.
  // Max 60 attempts (30s) — logs a warning if sseRef is never set.
  useEffect(() => {
    if (!sseRef) return;

    const handlePayload = (payload) => {
      if (!payload || typeof payload !== 'object') return;
      if (payload.type !== 'watchlist_update' && payload.type !== 'watchlist_snapshot') return;
      if (Array.isArray(payload.watchlist)) {
        setWatchlist(new Set(payload.watchlist));
      }
    };

    let attached     = false;
    let attempts     = 0;
    const MAX_ATT    = 60;
    let swHandler    = null;
    let esHandler    = null;
    let attachedSse  = null;
    let intervalId   = null;

    const tryAttach = () => {
      const sse = sseRef.current;
      if (!sse) {
        attempts++;
        if (attempts >= MAX_ATT) {
          console.warn('[NexRadar] useWatchlist: sseRef never populated after 30s — stopping poll');
          clearInterval(intervalId);
        }
        return;
      }
      if (isSharedWorker(sse)) {
        swHandler = (e) => { handlePayload(e.data); };
        sse.port.addEventListener('message', swHandler);
        attachedSse = sse;
      } else if (typeof sse.addEventListener === 'function') {
        esHandler = (e) => { try { handlePayload(JSON.parse(e.data)); } catch {} };
        sse.addEventListener('message', esHandler);
        attachedSse = sse;
      }
      attached = true;
      clearInterval(intervalId);
    };

    tryAttach();
    if (!attached) {
      intervalId = setInterval(tryAttach, 500);
    }

    return () => {
      clearInterval(intervalId);
      if (attachedSse) {
        if (swHandler && isSharedWorker(attachedSse)) {
          try { attachedSse.port.removeEventListener('message', swHandler); } catch {}
        } else if (esHandler && typeof attachedSse.removeEventListener === 'function') {
          attachedSse.removeEventListener('message', esHandler);
        }
      }
    };
  }, [sseRef]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleWatchlist = useCallback(async (symbol) => {
    const isWatched = watchlist.has(symbol);
    const endpoint  = isWatched
      ? `${API_BASE}/api/watchlist/remove`
      : `${API_BASE}/api/watchlist/add`;
    // Optimistic update
    setWatchlist(prev => {
      const next = new Set(prev);
      isWatched ? next.delete(symbol) : next.add(symbol);
      return next;
    });
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker: symbol }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      console.error('[NexRadar] Watchlist toggle failed, rolling back:', err);
      setWatchlist(prev => {
        const next = new Set(prev);
        isWatched ? next.add(symbol) : next.delete(symbol);
        return next;
      });
    }
  }, [watchlist]);

  return { watchlist, toggleWatchlist, wsWatchlistRef };
}
