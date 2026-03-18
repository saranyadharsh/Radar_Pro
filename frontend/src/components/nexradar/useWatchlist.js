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

  // FIX-3: intercept watchlist_update messages from the SSE stream.
  // sseRef.current is the live EventSource — we add a second onmessage
  // listener that only handles watchlist_update and ignores everything else.
  useEffect(() => {
    if (!sseRef) return;

    // SharedWorker-aware listener.
    // SharedWorker path: sseRef.current is a SharedWorker — messages arrive as
    //   pre-parsed objects on port messages. Use port.addEventListener (not .onmessage
    //   assignment) so multiple React callers can subscribe independently.
    // Direct EventSource fallback: messages arrive as raw strings via addEventListener.

    const handlePayload = (payload) => {
      if (!payload || typeof payload !== 'object') return;
      // WATCHLIST-SNAPSHOT-FIX: backend sends 'watchlist_snapshot' on SSE connect
      // and 'watchlist_update' on add/remove. The old guard only passed
      // watchlist_update — snapshot was silently dropped, so if the initial REST
      // fetch failed (ERR_EMPTY_RESPONSE during backend cold-start), watchlist
      // stayed an empty Set for the whole session → Screener / Signals showed
      // "NO WATCHLIST TICKERS" even though 30 tickers were starred.
      if (payload.type !== 'watchlist_update' && payload.type !== 'watchlist_snapshot') return;
      if (Array.isArray(payload.watchlist)) {
        setWatchlist(new Set(payload.watchlist));
      }
    };

    let pollId = null;
    let cleanup = () => { clearTimeout(pollId); };

    const attach = () => {
      const sse = sseRef.current;
      if (!sse) { pollId = setTimeout(attach, 500); return; }

      if (isSharedWorker(sse)) {
        // SHARED-WORKER-HIJACK-FIX: was using sse.port.onmessage = handler which
        // is a single-slot assignment. If useTickerData's cleanup fired before ours,
        // our cleanup's restore of prevHandler would wipe the port entirely.
        // Fix: port.addEventListener is a multi-subscriber list — each caller
        // independently removes its own handler, no chaining needed.
        // port.start() is already called in connectWorker so messages flow.
        const handler = (e) => { handlePayload(e.data); };
        sse.port.addEventListener('message', handler);
        cleanup = () => {
          clearTimeout(pollId);
          if (sse.port) sse.port.removeEventListener('message', handler);
        };
      } else if (typeof sse.addEventListener === 'function') {
        const handler = (e) => { try { handlePayload(JSON.parse(e.data)); } catch {} };
        sse.addEventListener('message', handler);
        cleanup = () => { clearTimeout(pollId); sse.removeEventListener('message', handler); };
      }
    };
    attach();

    return () => cleanup();
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
