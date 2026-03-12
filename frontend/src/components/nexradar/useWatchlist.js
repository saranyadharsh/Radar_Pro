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

  // FIX-3: intercept watchlist_update messages from the SSE stream.
  // sseRef.current is the live EventSource — we add a second onmessage
  // listener that only handles watchlist_update and ignores everything else.
  useEffect(() => {
    if (!sseRef) return;

    const handler = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type !== 'watchlist_update') return;
        if (Array.isArray(msg.watchlist)) {
          setWatchlist(new Set(msg.watchlist));
        }
      } catch { /* ignore parse errors */ }
    };

    // Poll until sseRef.current is populated (SSE connects asynchronously)
    let pollId = null;
    const attach = () => {
      if (sseRef.current) {
        sseRef.current.addEventListener('message', handler);
      } else {
        pollId = setTimeout(attach, 500);
      }
    };
    attach();

    return () => {
      clearTimeout(pollId);
      if (sseRef.current) {
        sseRef.current.removeEventListener('message', handler);
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
