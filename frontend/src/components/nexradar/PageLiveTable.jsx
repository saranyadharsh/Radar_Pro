// PageLiveTable.jsx — NexRadar Pro
// Live stock data table with sector filter, sub-mode (MH/AH), matrix view,
// inline chart panel, virtual scrolling (zero external deps), and Web Worker sort.
//
// FIXES IN THIS VERSION:
//
//   BUG-3 FIX  AH $ CHG / % CHG no longer falls back to MH change_value.
//              When today_close = 0 (e.g. before _ah_close_loop has run),
//              the fallback is now null — the cell shows "—" explicitly
//              rather than silently displaying the wrong (MH day-change) number.
//              Root cause (BUG-2 in ws_engine.py) is fixed separately;
//              this is the defensive guard ensuring stale data is never shown.
//
//   BUG-4 FIX  useInlineVirtualizer useEffect dep array added.
//              The effect ran after every render (no deps), re-attaching scroll
//              and resize listeners on each render. In fast-mount/unmount cycles
//              (mobile, route changes) this could add duplicate listeners. Fix:
//              stable deps [count, estimateSize] ensure the effect only fires
//              when the virtualizer inputs change.
//
//   BUG-7 FIX  Sort worker dispatch is debounced 150ms.
//              tickers Map changes on every rAF flush (~60/s during trading).
//              Each change triggered a 6,000-object structured clone postMessage
//              to the sort worker — ~180 MB/s of inter-thread traffic and
//              continuous main-thread GC pressure.  150ms debounce cuts
//              invocations from ~60/s to ~6/s while keeping the table live.

import { useState, useEffect, useRef, useMemo, useCallback, memo } from "react";
import { API_BASE } from "../../config.js";
import { SESSION_META } from "./constants.js";
import { fmt2, pct, fmtVol, normalizeSector } from "./utils.js";
import { SectionHeader, SectorPills, TVChart, MatrixCell } from "./primitives.jsx";

// ── Inline virtualizer hook — zero external deps, no React version conflicts ──
// Replaces @tanstack/react-virtual. Renders only visible rows using
// scroll position + row height. ~50 lines, no imports needed.
//
// BUG-4 FIX: useEffect now has a stable dep array [count, estimateSize].
// Previously had no dep array so it ran after every render, re-attaching scroll
// and resize listeners every ~16ms during live trading (= thousands of event
// listeners accumulating). The attachedRef guard prevented true duplicates for
// the same element, but on route change / remount cycles this still caused
// a race where a fresh element was attached twice before the cleanup fired.
function useInlineVirtualizer({ count, getScrollElement, estimateSize, overscan = 5 }) {
  const rowHeight    = estimateSize();
  const [scrollTop,  setScrollTop] = useState(0);
  const [height,     setHeight]    = useState(600);
  const attachedRef  = useRef(null); // track which element we're listening to

  // BUG-4 FIX: stable dep array [count, estimateSize].
  // We want the effect to run when these structural inputs change (different
  // list size → possibly different container), or on first mount. We do NOT
  // want it to re-run on every scroll/resize — that's handled by the listeners
  // themselves. The attachedRef guard is kept as a secondary safety net.
  useEffect(() => {
    const el = getScrollElement();
    if (!el || el === attachedRef.current) return; // already attached to this element
    attachedRef.current = el;
    const onScroll = () => setScrollTop(el.scrollTop);
    const onResize = () => setHeight(el.clientHeight || 600);
    onResize();
    el.addEventListener('scroll', onScroll, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(onResize) : null;
    if (ro) ro.observe(el);
    return () => {
      attachedRef.current = null;
      el.removeEventListener('scroll', onScroll);
      if (ro) ro.disconnect();
    };
  }, [count, estimateSize]); // eslint-disable-line react-hooks/exhaustive-deps

  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const visCount   = Math.ceil(height / rowHeight) + overscan * 2;
  const endIndex   = Math.min(count - 1, startIndex + visCount);

  const virtualItems = [];
  for (let i = startIndex; i <= endIndex; i++) {
    virtualItems.push({ index: i, key: i, start: i * rowHeight, size: rowHeight });
  }

  return {
    getTotalSize:    () => count * rowHeight,
    getVirtualItems: () => virtualItems,
  };
}

// ── NOIBar component — proportional imbalance meter ─────────────────────────
//
// NOI-FIX: replaces the old hardcoded 70%/30% split with a proportional bar
// driven by imbalance_size from the Polygon "I" event.
//
// Visual design:
//   The bar is a horizontal track (48px wide × 4px tall).
//   Center = equilibrium. Bar grows LEFT for buy imbalance (green),
//   RIGHT for sell imbalance (red). Width is proportional to imbalance_size
//   capped at 100K shares for the full-width extreme.
//
//   Examples:
//     imbalance_size=5000  → 5% width (tiny imbalance, near center)
//     imbalance_size=50000 → 50% width (significant)
//     imbalance_size=100000+ → 100% (max bar)
//
// Shown below the signal badge when a non-neutral imbalance exists.
// Also shown in AH mode rows (standalone, no signal required) because
// imbalances are most meaningful during pre/after-hours auctions.

const NOI_MAX_SHARES = 100_000  // 100K shares = full bar width

function NOIBar({ noi, T }) {
  if (!noi || noi.imbalance_side === 'N') return null

  const isBuy   = noi.imbalance_side === 'B'
  const color   = isBuy ? '#00e676' : '#ff3d5a'
  const dimClr  = isBuy ? '#00e67620' : '#ff3d5a20'
  const label   = isBuy ? 'BUY IMBAL' : 'SELL IMBAL'
  const size    = noi.imbalance_size ?? 0

  // Proportional fill: 0..NOI_MAX_SHARES → 0..100%
  const fillPct = Math.min(100, Math.round((size / NOI_MAX_SHARES) * 100))
  // Format size for display: "12.5K", "1.2M"
  const sizeStr = size >= 1_000_000
    ? `${(size/1_000_000).toFixed(1)}M`
    : size >= 1_000
    ? `${(size/1_000).toFixed(0)}K`
    : String(size)

  return (
    <div style={{ display:'flex', alignItems:'center', gap:5, marginTop:3 }}>
      {/* Track */}
      <div style={{
        position:'relative', width:48, height:4,
        background: T?.bg3 || '#172438',
        borderRadius:2, overflow:'hidden', flexShrink:0,
      }}>
        {/* Fill — grows from center outward */}
        <div style={{
          position:'absolute',
          top:0,
          height:'100%',
          width: `${fillPct / 2}%`,  // half-track: center = 50%, max = 50% of track
          // Buy: anchored at center, grows left
          // Sell: anchored at center, grows right
          left:  isBuy  ? `${50 - fillPct / 2}%` : '50%',
          background: color,
          borderRadius:2,
          transition: 'width 0.3s ease, left 0.3s ease',
        }}/>
        {/* Center marker */}
        <div style={{
          position:'absolute', top:0, left:'50%',
          width:1, height:'100%',
          background: T?.border || '#172438',
          transform:'translateX(-50%)',
        }}/>
      </div>
      {/* Label + size */}
      <div style={{ display:'flex', flexDirection:'column', gap:0 }}>
        <span style={{
          color, fontSize:7.5, fontWeight:700,
          fontFamily: T?.font || 'inherit',
          letterSpacing:0.3, lineHeight:1.2,
        }}>{label}</span>
        {size > 0 && (
          <span style={{
            color: T?.text2 || '#4a6278',
            fontSize:7, fontFamily: T?.font || 'inherit', lineHeight:1.2,
          }}>{sizeStr}</span>
        )}
      </div>
    </div>
  )
}

// ─── Memoized table row — skips re-render when visible data unchanged ─────────
const LiveTableRow = memo(function LiveTableRow({ ticker, isWatched, toggleWatchlist, subMode, gridCols, scalpSignals, setSelectedSymbol, haltedTickers, noiBySym, isStale = false, T }) {
  // MH: $ CHG = live_price - open  /  % CHG = (live_price - open) / open × 100
  //   This reflects intraday movement from today's open, which is consistent
  //   with the OPEN column shown in the same row. change_value (price - prev_close)
  //   was misleading when displayed next to OPEN — e.g. LNG open=283, price=287
  //   showed +20.98 (vs prev_close ~266) instead of the expected +4.08 (vs open).
  // AH: use ah_dollar / ah_pct (live_price vs today_close)
  //
  // BUG-3 FIX: AH $ CHG fallback is now null (renders "—"), NOT ticker.change_value.
  const ahDollar = ticker.ah_dollar != null
    ? ticker.ah_dollar
    : (ticker.today_close > 0 ? ticker.live_price - ticker.today_close : null);
  const ahPct = ticker.ah_pct != null
    ? ticker.ah_pct
    : (ticker.today_close > 0
        ? (ticker.live_price - ticker.today_close) / ticker.today_close * 100
        : null);

  // MH intraday change: live_price vs today's open
  const mhDollar = (ticker.open > 0 && ticker.live_price > 0)
    ? +(ticker.live_price - ticker.open).toFixed(4)
    : (ticker.change_value || 0);
  const mhPct = (ticker.open > 0 && ticker.live_price > 0)
    ? +((ticker.live_price - ticker.open) / ticker.open * 100).toFixed(4)
    : (ticker.percent_change || 0);

  const displayChg  = subMode === 'AH' ? ahDollar : mhDollar;
  const displayPct  = subMode === 'AH' ? ahPct    : mhPct;
  const isPositive  = (displayChg ?? 0) >= 0;
  const changeColor = isPositive ? T.green : T.red;
  const isHalted    = haltedTickers?.has(ticker.ticker) ?? ticker.is_halted ?? false;
  const noi         = noiBySym?.[ticker.ticker] ?? null;

  // Helper: format a nullable $ change value — shows "—" when null (AH before today_close populated)
  const fmtChg = (v) => v == null ? "—" : `${v >= 0 ? "+" : ""}${fmt2(v)}`;
  const fmtPct_ = (v) => v == null ? "—" : pct(v);

  return (
    <div className={`tr-hover${isHalted ? ' halt-row' : ''}`} style={{ display:"grid", gridTemplateColumns:gridCols, borderBottom:`1px solid ${T.border}` }}>
      {subMode === "MH" ? (
        <>
          <div style={{ padding:"10px 14px", display:"flex", alignItems:"flex-start", gap:10 }}>
            <button onClick={e=>{ e.stopPropagation(); toggleWatchlist(ticker.ticker); }}
              style={{ background:"none", border:"none", cursor:"pointer", fontSize:14, padding:0, marginTop:2, color:isWatched?T.gold:T.text2, opacity:isWatched?1:0.3, transition:"all 0.2s", flexShrink:0 }}
              onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=isWatched?1:0.3}
              title={isWatched?"Remove from watchlist":"Add to watchlist"}>{isWatched?"⭐":"☆"}</button>
            <div style={{ flex:1, minWidth:0 }}>
              <div onClick={() => setSelectedSymbol(s => s===ticker.ticker?null:ticker.ticker)} title="Click to view chart"
                style={{ color:T.cyan, fontSize:13, fontFamily:T.font, fontWeight:700, textDecoration:"underline", textDecorationColor:T.cyan+"40", marginBottom:3, lineHeight:1.2, cursor:"pointer" }}>
                {ticker.ticker}
                {isHalted && <span className="halt-badge">⛔ HALT</span>}
              </div>
              <div style={{ color:T.text2, fontSize:10, fontFamily:T.font, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", maxWidth:"100%", lineHeight:1.3 }}>
                {ticker.company_name && ticker.company_name !== ticker.ticker ? ticker.company_name : <span style={{ opacity:0.4 }}>—</span>}
              </div>
            </div>
          </div>
          <div style={{ padding:"10px 14px", color:T.text1, fontFamily:T.font, fontSize:13, display:"flex", alignItems:"center" }}>{fmt2(ticker.open||0)}</div>
          <div style={{ padding:"10px 14px", color:T.text0, fontFamily:T.font, fontSize:13, display:"flex", alignItems:"center" }}>{fmt2(ticker.live_price||0)}</div>
          <div style={{ padding:"10px 14px", color:changeColor, fontFamily:T.font, fontSize:13, display:"flex", alignItems:"center" }}>{isPositive?"+":" "}{fmt2(displayChg)}</div>
          <div style={{ padding:"10px 14px", color:changeColor, fontFamily:T.font, fontSize:13, display:"flex", alignItems:"center" }}>{pct(displayPct)}</div>
          <div style={{ padding:"10px 14px", color:T.text1, fontFamily:T.font, fontSize:13, display:"flex", alignItems:"center" }}>{fmtVol(ticker.volume||0)}</div>
          <div style={{ padding:"10px 14px", display:"flex", alignItems:"center", gap:5 }}>
            {(() => {
              const sig = scalpSignals[ticker.ticker];
              if (!sig) return ticker.volume_spike
                ? <span style={{ color:T.orange, fontSize:10, fontFamily:T.font, background:T.orangeDim, padding:"3px 8px", borderRadius:4, fontWeight:600 }}>VOL⚡</span>
                : <span style={{ color:T.text2, fontSize:11 }}>—</span>;
              const clr = sig.signal==="BUY"?T.green:sig.signal==="SELL"?T.red:T.text2;
              const bg  = sig.signal==="BUY"?T.greenDim:sig.signal==="SELL"?T.redDim:T.bg2;
              return (
                <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
                  <span style={{ color:clr, fontSize:11, fontFamily:T.font, fontWeight:800, background:bg, padding:"3px 8px", borderRadius:4, letterSpacing:0.5 }}>
                    {sig.signal==="BUY"?"▲ BUY":sig.signal==="SELL"?"▼ SELL":"◈ HOLD"}
                  </span>
                  <span style={{ color:T.text2, fontSize:9, fontFamily:T.font }}>{sig.strength} · {sig.prediction}%</span>
                  {noi && noi.imbalance_side !== 'N' && (
                    <NOIBar noi={noi} T={T} />
                  )}
                </div>
              );
            })()}
          </div>
        </>
      ) : (
        <>
          <div style={{ padding:"10px 14px", display:"flex", alignItems:"flex-start", gap:10 }}>
            <button onClick={e=>{ e.stopPropagation(); toggleWatchlist(ticker.ticker); }}
              style={{ background:"none", border:"none", cursor:"pointer", fontSize:14, padding:0, marginTop:2, color:isWatched?T.gold:T.text2, opacity:isWatched?1:0.3, transition:"all 0.2s", flexShrink:0 }}
              onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=isWatched?1:0.3}>{isWatched?"⭐":"☆"}</button>
            <div style={{ flex:1, minWidth:0 }}>
              <div onClick={() => setSelectedSymbol(s => s===ticker.ticker?null:ticker.ticker)} title="Click to view chart"
                style={{ color:T.cyan, fontSize:13, fontFamily:T.font, fontWeight:700, textDecoration:"underline", textDecorationColor:T.cyan+"40", marginBottom:3, lineHeight:1.2, cursor:"pointer" }}>
                {ticker.ticker}
                {isHalted && <span className="halt-badge">⛔ HALT</span>}
              </div>
              <div style={{ color:T.text2, fontSize:10, fontFamily:T.font, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", maxWidth:"100%", lineHeight:1.3 }}>
                {ticker.company_name && ticker.company_name !== ticker.ticker ? ticker.company_name : <span style={{ opacity:0.4 }}>—</span>}
              </div>
            </div>
          </div>
          <div style={{ padding:"10px 14px", color:T.text1, fontFamily:T.font, fontSize:13, display:"flex", alignItems:"center" }}>{ticker.prev_close>0?`$${fmt2(ticker.prev_close)}`:"—"}</div>
          <div style={{ padding:"10px 14px", color:T.text1, fontFamily:T.font, fontSize:13, display:"flex", alignItems:"center" }}>{ticker.today_close>0?`$${fmt2(ticker.today_close)}`:"—"}</div>
          <div style={{ padding:"10px 14px", color:T.cyan, fontFamily:T.font, fontSize:13, display:"flex", flexDirection:"column", alignItems:"flex-start", justifyContent:"center" }}>
            <span>{fmt2(ticker.live_price||0)}</span>
            {/* NOI-FIX: show imbalance bar in AH mode — most critical during auctions */}
            {noi && noi.imbalance_side !== 'N' && <NOIBar noi={noi} T={T} />}
          </div>
          {/* BUG-3 FIX: fmtChg / fmtPct_ return "—" when value is null (today_close not yet populated) */}
          <div style={{ padding:"10px 14px", color:changeColor, fontFamily:T.font, fontSize:13, display:"flex", alignItems:"center" }}>{fmtChg(displayChg)}</div>
          <div style={{ padding:"10px 14px", color:changeColor, fontFamily:T.font, fontSize:13, display:"flex", alignItems:"center" }}>{fmtPct_(displayPct)}</div>
        </>
      )}
    </div>
  );
}, (prev, next) => (
  prev.ticker.live_price    === next.ticker.live_price &&
  prev.ticker.change_value  === next.ticker.change_value &&
  prev.ticker.ah_dollar     === next.ticker.ah_dollar    &&
  prev.ticker.percent_change === next.ticker.percent_change &&
  prev.ticker.volume        === next.ticker.volume &&
  prev.ticker.volume_spike  === next.ticker.volume_spike &&
  // MEMO-FIX: today_close and prev_close were missing — AH mode rows
  // (lines 98-99) would not re-render when these arrive at 4PM ET.
  prev.ticker.today_close   === next.ticker.today_close &&
  prev.ticker.prev_close    === next.ticker.prev_close &&
  prev.isWatched            === next.isWatched &&
  prev.isStale              === next.isStale    &&
  prev.subMode              === next.subMode &&
  prev.gridCols             === next.gridCols &&
  // MEMO-FIX: was only checking .signal — prediction% and strength are also
  // rendered (line 61). A signal updating from 60%→95% confidence with the
  // same direction would silently skip the re-render.
  prev.scalpSignals?.[prev.ticker.ticker]?.signal     === next.scalpSignals?.[next.ticker.ticker]?.signal &&
  prev.scalpSignals?.[prev.ticker.ticker]?.prediction === next.scalpSignals?.[next.ticker.ticker]?.prediction &&
  prev.scalpSignals?.[prev.ticker.ticker]?.strength   === next.scalpSignals?.[next.ticker.ticker]?.strength &&
  prev.haltedTickers?.has(prev.ticker.ticker) === next.haltedTickers?.has(next.ticker.ticker) &&
  (prev.noiBySym?.[prev.ticker.ticker]?.imbalance_side) === (next.noiBySym?.[next.ticker.ticker]?.imbalance_side) &&
  (prev.noiBySym?.[prev.ticker.ticker]?.imbalance_size)  === (next.noiBySym?.[next.ticker.ticker]?.imbalance_size)
));

export default function PageLiveTable({ selectedSectors, onSectorChange, tickers = new Map(), marketSession = "market", wsWatchlistRef = null, quickFilter = null, onClearQuickFilter = null, wsStatus = 'connected', onLiveCount = null, watchlistProp = null, toggleWatchlistProp = null, isActive = true, staleTickers = new Set(), T }) {
  const [viewMode,     setViewMode]     = useState("TABLE");
  const [source,       setSource]       = useState("ALL");
  const [minDelta,     setMinDelta]     = useState(0);
  const [extLink,      setExtLink]      = useState("Yahoo Finance");
  const [matrixCount,  setMatrixCount]  = useState(50);
  const [selectedSymbol, setSelectedSymbol] = useState(null);
  const [chartPanelTF,   setChartPanelTF]   = useState("5");
  const [chartOpenCount, setChartOpenCount] = useState(5);
  const [sortKey,      setSortKey]      = useState("change");
  const [sortDir,      setSortDir]      = useState("desc");
  const [scalpSignals, setScalpSignals] = useState({});
  const [earningsTickers, setEarningsTickers] = useState(new Set());
  const [haltedTickers,  setHaltedTickers]  = useState(new Set());
  // BUG-10 FIX: noiBySym stored in ref, flushed to state at 500ms intervals.
  // Old pattern: setNoiBySym(prev=>({...prev,[tk]:...})) created a full object
  // copy on EVERY NOI SSE event — during auctions that's 10-50 events/sec,
  // causing continuous React reconciles of all subscribed rows. New pattern:
  // writes go to noiBySymRef (zero allocations), state flush every 500ms.
  const [noiBySym,       setNoiBySym]        = useState({});
  const [subModeOverride, setSubModeOverride] = useState(null);
  const [matrixInterval,  setMatrixInterval]  = useState("5");

  // T2-6: Virtual scrolling — replaces pagination. sortedSymbols is the full
  // sorted list; useInlineVirtualizer renders only the visible ~20 rows at a time.
  const [sortedSymbols, setSortedSymbols] = useState([]);

  const tableScrollRef  = useRef(null);
  const tickerArrayRef  = useRef([]);
  const noiBySymRef     = useRef({});   // BUG-10 FIX: raw mutable map, avoids spread copy on every NOI event
  const noiFlushTimerRef = useRef(null);
  // T2-7: Sort Web Worker — offloads O(N log N) sort from the main thread.
  // Terminated and re-created on component unmount to avoid memory leaks.
  const sortWorkerRef   = useRef(null);
  // BUG-7 FIX: debounce ref — prevents 180 MB/s structured clone traffic to sort worker.
  const sortDebounceRef = useRef(null);

  // Fallback local watchlist when not provided from root
  const [_localWatchlist, _setLocalWatchlist] = useState(new Set());
  const watchlist = watchlistProp ?? _localWatchlist;
  // HOOKS-FIX: useCallback must ALWAYS be called (Rules of Hooks).
  // `toggleWatchlistProp ?? useCallback(...)` skips the hook when prop is provided
  // → hook count changes between renders → React throws "rendered more hooks".
  // Fix: always define the fallback, then pick which to expose.
  const _fallbackToggle = useCallback(async (symbol) => {
    const isWatched = _localWatchlist.has(symbol);
    _setLocalWatchlist(prev => { const n=new Set(prev); isWatched?n.delete(symbol):n.add(symbol); return n; });
    try {
      await fetch(`${API_BASE}/api/watchlist/${isWatched?"remove":"add"}`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ticker:symbol}) });
    } catch { _setLocalWatchlist(prev => { const n=new Set(prev); isWatched?n.add(symbol):n.delete(symbol); return n; }); }
  }, [_localWatchlist]);
  const toggleWatchlist = toggleWatchlistProp ?? _fallbackToggle;

  const autoSubMode = SESSION_META[marketSession]?.subMode ?? "MH";
  const subMode     = subModeOverride ?? autoSubMode;
  const setSubMode  = (id) => setSubModeOverride(id === autoSubMode ? null : id);
  useEffect(() => { setSubModeOverride(null); }, [autoSubMode]);

  // T2-7: Sort Web Worker lifecycle — create once on mount, terminate on unmount.
  // The worker is long-lived and reused for every sort request.
  useEffect(() => {
    let w;
    try {
      w = new Worker('/sortWorker.js');
      w.onmessage = (e) => {
        if (e.data?.type === 'result') setSortedSymbols(e.data.symbols);
        if (e.data?.type === 'error')  console.warn('[SortWorker]', e.data.message);
      };
      w.onerror = (err) => console.warn('[SortWorker] Worker error:', err);
      sortWorkerRef.current = w;
    } catch {
      // Web Worker unavailable (some sandboxed environments) — sortedSymbols
      // will be computed synchronously via the fallback useMemo below.
      sortWorkerRef.current = null;
    }
    return () => {
      w?.terminate();
      sortWorkerRef.current = null;
      // BUG-7 FIX: cancel any pending debounce on unmount
      if (sortDebounceRef.current) clearTimeout(sortDebounceRef.current);
    };
  }, []);

  // Esc closes chart panel
  useEffect(() => {
    const fn = e => { if (e.key==="Escape") setSelectedSymbol(null); };
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, []);

  // Orphan iframe cleanup
  useEffect(() => {
    if (viewMode !== "MATRIX") {
      document.querySelectorAll('iframe[src*="tradingview"]').forEach(f => {
        if (!f.closest(".card")) f.parentNode?.removeChild(f);
      });
    }
  }, [viewMode]);

  // POLL-FIX: only poll /api/scalp-analysis when Live Table tab is active.
  // Old: polled every 30s unconditionally = 120 Render HTTP requests/hr even
  // when user is on Portfolio/Signals/Scanner tab.
  // New: stops polling on tab switch, resumes + immediate fetch on return.
  // ABORT-FIX: AbortController cancels inflight fetch on cleanup so a slow
  // request from before a tab switch cannot resolve last and overwrite the
  // fresher response that arrived after tab return.
  useEffect(() => {
    if (!isActive) return;
    let controller = new AbortController();
    const poll = () => {
      controller.abort();
      controller = new AbortController();
      fetch(`${API_BASE}/api/scalp-analysis`, { signal: controller.signal })
        .then(r => r.ok ? r.json() : null)
        .then(d => {
          if (!d?.data) return;
          const m = {};
          d.data.forEach(r => { if (!r.status || r.status === 'ok') m[r.ticker] = r; });
          setScalpSignals(m);
        })
        .catch(err => { if (err.name !== 'AbortError') console.debug('[NexRadar] scalp-analysis fetch:', err); });
    };
    poll();  // immediate fetch on tab activation
    const id = setInterval(poll, 30_000);
    return () => { clearInterval(id); controller.abort(); };
  }, [isActive]);

  // LULD halt tracking
  useEffect(() => {
    const handler = (e) => {
      const { ticker, is_halted } = e.detail;
      if (!ticker) return;
      setHaltedTickers(prev => {
        const next = new Set(prev);
        if (is_halted) next.add(ticker);
        else next.delete(ticker);
        return next;
      });
    };
    window.addEventListener('nexradar_halt', handler);
    return () => window.removeEventListener('nexradar_halt', handler);
  }, []);

  // NOI imbalance tracking — BUG-10 FIX: write to ref, flush to state every 500ms.
  // Eliminates the full-object spread ({...prev}) on every SSE event.
  useEffect(() => {
    const handler = (e) => {
      const { ticker, imbalance_side, imbalance_size } = e.detail;
      if (!ticker) return;
      noiBySymRef.current[ticker] = { imbalance_side, imbalance_size };
      // Schedule a flush if one isn't already pending
      if (!noiFlushTimerRef.current) {
        noiFlushTimerRef.current = setTimeout(() => {
          noiFlushTimerRef.current = null;
          setNoiBySym({ ...noiBySymRef.current });
        }, 500);
      }
    };
    window.addEventListener('nexradar_noi', handler);
    return () => {
      window.removeEventListener('nexradar_noi', handler);
      if (noiFlushTimerRef.current) {
        clearTimeout(noiFlushTimerRef.current);
        noiFlushTimerRef.current = null;
      }
    };
  }, []);

  // Today's earnings tickers
  useEffect(() => {
    const fetch_ = () => {
      const now=new Date(), today=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
      fetch(`${API_BASE}/api/earnings?start=${today}&end=${today}`).then(r=>r.ok?r.json():[]).then(data=>{
        const arr=Array.isArray(data)?data:Array.isArray(data?.data)?data.data:Array.isArray(data?.earnings)?data.earnings:Array.isArray(data?.results)?data.results:[];
        setEarningsTickers(new Set(arr.map(e=>e.ticker||e.symbol).filter(Boolean)));
      }).catch(()=>setEarningsTickers(new Set()));
    };
    fetch_();
    const timerRef = {current:null};
    const sched = () => {
      const etNow=new Date(new Date().toLocaleString("en-US",{timeZone:"America/New_York"}));
      const midnight=new Date(etNow); midnight.setHours(24,0,5,0);
      timerRef.current = setTimeout(()=>{ fetch_(); sched(); }, midnight.getTime()-etNow.getTime());
    };
    sched();
    return ()=>{ if(timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  // Fallback watchlist load when not from root
  useEffect(() => {
    if (watchlistProp !== null) return;
    fetch(`${API_BASE}/api/watchlist`).then(r=>r.ok?r.json():Promise.reject()).then(d=>_setLocalWatchlist(new Set(d.watchlist??[]))).catch(()=>{});
  }, [watchlistProp]);

  // NOI-FIX: pre-populate noiBySym on mount from /api/noi snapshot.
  // Polygon "I" events only fire when a new imbalance occurs — on page load
  // or tab switch, the bars would be empty until the next event (could be minutes).
  // Fetching the snapshot on mount means bars are immediately populated with
  // the current imbalance state for all active tickers.
  // Only runs once on mount (isActive guard avoids re-fetching on every tab switch).
  useEffect(() => {
    if (!isActive) return;
    fetch(`${API_BASE}/api/noi`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d?.data?.length) return;
        d.data.forEach(r => {
          if (r.ticker && r.imbalance_side !== 'N') {
            noiBySymRef.current[r.ticker] = {
              imbalance_side: r.imbalance_side,
              imbalance_size: r.imbalance_size ?? 0,
            };
          }
        });
        setNoiBySym({ ...noiBySymRef.current });
      })
      .catch(() => {}); // Non-critical — bars populate on next I event if fetch fails
  }, [isActive]); // eslint-disable-line react-hooks/exhaustive-deps

  // Column sort
  const handleColSort = (key) => {
    setSortKey(prev => { if(prev===key){setSortDir(d=>d==="desc"?"asc":"desc");return key;} setSortDir("desc"); return key; });
  };

  // T2-7: Sort pipeline — tickerArray useMemo feeds the sort worker.
  //
  // Stage 1 — tickerArray (O(N) filter, main thread):
  //   Returns plain Array snapshot — serialisable across worker boundary.
  //   Re-runs when live Map or filter inputs change.
  //
  // Stage 2 — sort worker (off main thread):
  //   Receives snapshot, runs O(N log N) sort + quickFilters off-thread.
  //   Posts { symbols: string[] } back. setSortedSymbols updates state.
  //   Fallback: synchronous sort if Worker unavailable.
  //
  // Stage 3 — virtual render (T2-6):
  //   useInlineVirtualizer renders only visible rows (~20 of 6,000+).
  //   Each row does O(1) tickers.get(sym) for freshest data.

  const tickerArray = useMemo(() => {
    let arr = Array.from(tickers.values());
    if (source === 'WATCHLIST') arr = arr.filter(t => watchlist.has(t.ticker));
    if (!selectedSectors.includes('ALL')) {
      arr = arr.filter(t => {
        if (selectedSectors.includes('EARNINGS') && (t.is_earnings_gap_play || earningsTickers.has(t.ticker))) return true;
        const s = normalizeSector(t.sector);
        return s && selectedSectors.some(sel => s === sel && sel !== 'EARNINGS');
      });
    }
    tickerArrayRef.current = arr;
    return arr;
  }, [tickers, selectedSectors, source, watchlist, earningsTickers]);

  // Dispatch to sort worker (or synchronous fallback) whenever inputs change.
  // NOTE: tickerArray is already sector+source+watchlist filtered by useMemo above.
  // We pass selectedSectors=['ALL'] and source='ALL' to the worker so it doesn't
  // double-filter — the worker only needs to handle minDelta and quickFilter.
  //
  // BUG-7 FIX: 150ms debounce prevents 6,000-object postMessage on every rAF flush.
  // During live trading tickers Map changes ~60/s (every rAF) → tickerArray recomputes
  // → useEffect fires → 6,000-object structured clone → sort worker → setSortedSymbols.
  // 150ms debounce: ~6 dispatches/s instead of ~60, cuts structured-clone traffic by 90%.
  // The 150ms delay is imperceptible in sort responsiveness but eliminates the CPU spike.
  useEffect(() => {
    const arr = tickerArray;

    const dispatch = () => {
      if (sortWorkerRef.current) {
        sortWorkerRef.current.postMessage({
          type: 'sort',
          payload: {
            tickers:         arr,
            sortKey,
            sortDir,
            minDelta,
            quickFilter,
            source:          'ALL',          // already filtered in tickerArray useMemo
            watchlist:       [],             // already filtered in tickerArray useMemo
            selectedSectors: ['ALL'],        // already filtered in tickerArray useMemo
            earningsTickers: [],             // already filtered in tickerArray useMemo
            subMode,
          },
        });
      } else {
        // Synchronous fallback (Worker unavailable — sandboxed environments)
        // MH intraday delta helper (mirrors LiveTableRow mhDollar)
        const mhChg = (t) => (t.open > 0 && t.live_price > 0) ? t.live_price - t.open : (t.change_value || 0);
        const mhPct = (t) => (t.open > 0 && t.live_price > 0) ? (t.live_price - t.open) / t.open * 100 : (t.percent_change || 0);
        let fa = arr.filter(t => Math.abs(subMode === 'AH' ? (t.ah_dollar ?? t.change_value ?? 0) : mhChg(t)) >= minDelta);
        if (quickFilter === 'VOL_SPIKES') fa = fa.filter(t => t.volume_spike);
        if (quickFilter === 'GAP_PLAYS')  fa = fa.filter(t => t.is_gap_play);
        if (quickFilter === 'AH_MOMT')    fa = fa.filter(t => t.ah_momentum);
        if (quickFilter === 'EARN_GAPS')  fa = fa.filter(t => t.is_earnings_gap_play);
        if (quickFilter === 'DIAMOND')    fa = fa.filter(t => Math.abs(subMode === 'AH' ? (t.ah_pct ?? t.percent_change ?? 0) : mhPct(t)) >= 5);
        const dir = sortDir === 'desc' ? -1 : 1;
        fa = fa.slice().sort((a, b) => {
          if (sortKey === 'symbol') return dir * (a.ticker || '').localeCompare(b.ticker || '');
          if (sortKey === 'change') return dir * (mhChg(a) - mhChg(b));
          if (sortKey === 'pct')    return dir * (mhPct(a) - mhPct(b));
          const kmap = { open:'open', price:'live_price', volume:'volume', prev_close:'prev_close', today_close:'today_close', live_price:'live_price' };
          const k = kmap[sortKey] ?? 'live_price';
          return dir * ((a[k] || 0) - (b[k] || 0));
        });
        setSortedSymbols(fa.map(t => t.ticker));
      }
    };

    // BUG-7 FIX: debounce — cancel any pending dispatch and reschedule
    if (sortDebounceRef.current) clearTimeout(sortDebounceRef.current);
    sortDebounceRef.current = setTimeout(() => {
      sortDebounceRef.current = null;
      dispatch();
    }, 150);

    // Cleanup: cancel debounce if deps change before it fires
    return () => {
      if (sortDebounceRef.current) {
        clearTimeout(sortDebounceRef.current);
        sortDebounceRef.current = null;
      }
    };
  }, [tickerArray, sortKey, sortDir, minDelta, quickFilter, subMode]); // eslint-disable-line

  useEffect(() => { if(onLiveCount) onLiveCount(tickerArray.length); }, [tickerArray.length]); // eslint-disable-line

  // T2-6: Inline virtual scrolling — zero external dependencies.
  // Renders only visible rows (~20 of 6,000+). No @tanstack/react-virtual needed.
  const ROW_HEIGHT = 45;
  const virtualizer = useInlineVirtualizer({
    count:            sortedSymbols.length,
    getScrollElement: () => tableScrollRef.current,
    estimateSize:     () => ROW_HEIGHT,
    overscan:         5,
  });

  const matrixSymbols = useMemo(() => {
    if (sortedSymbols.length > 0) return sortedSymbols.slice(0, matrixCount);
    return ["AAPL","MSFT","NVDA","AMZN","GOOGL","META","TSLA","AVGO","JPM","V","MA","UNH","LLY","XOM","PG","HD","BAC","ABBV","NFLX","AMD"].slice(0, matrixCount);
  }, [sortedSymbols, matrixCount]);

  const openExternalCharts = () => {
    sortedSymbols.slice(0, chartOpenCount).forEach(sym => {
      window.open(extLink === "TradingView" ? `https://www.tradingview.com/chart/?symbol=${sym}` : `https://finance.yahoo.com/quote/${sym}`, "_blank");
    });
  };


  // MOBILE-FIX: responsive column widths.
  // Desktop (>768px): full 7-column layout with 260px symbol.
  // Mobile (<=768px): compact layout — smaller symbol, tighter columns, horizontal scroll enabled.
  const isMobileView = typeof window !== 'undefined' && window.innerWidth < 768;
  const MH_COLS = isMobileView ? [
    {key:"symbol",w:"140px",label:"SYMBOL"},{key:"open",w:"75px",label:"OPEN"},{key:"price",w:"75px",label:"PRICE"},
    {key:"change",w:"75px",label:"$ CHG"},{key:"pct",w:"70px",label:"% CHG"},{key:"volume",w:"65px",label:"VOL"},{key:"signal",w:"80px",label:"SIGNAL"},
  ] : [
    {key:"symbol",w:"260px",label:"SYMBOL"},{key:"open",w:"1fr",label:"OPEN"},{key:"price",w:"1fr",label:"PRICE"},
    {key:"change",w:"1fr",label:"$ CHG"},{key:"pct",w:"1fr",label:"% CHG"},{key:"volume",w:"1fr",label:"VOLUME"},{key:"signal",w:"120px",label:"SIGNAL"},
  ];
  const AH_COLS = isMobileView ? [
    {key:"symbol",w:"140px",label:"SYMBOL"},{key:"prev_close",w:"75px",label:"PREV CL"},{key:"today_close",w:"75px",label:"TODAY CL"},
    {key:"live_price",w:"75px",label:"LIVE"},{key:"change",w:"75px",label:"$ CHG"},{key:"pct",w:"70px",label:"% CHG"},
  ] : [
    {key:"symbol",w:"260px",label:"SYMBOL"},{key:"prev_close",w:"1fr",label:"PREV CLOSE"},{key:"today_close",w:"1fr",label:"TODAY CLOSE"},
    {key:"live_price",w:"1fr",label:"LIVE PRICE"},{key:"change",w:"1fr",label:"$ CHG"},{key:"pct",w:"1fr",label:"% CHG"},
  ];
  const cols     = subMode==="MH"?MH_COLS:AH_COLS;
  const gridCols = cols.map(c=>c.w).join(" ");
  const activeLabel = selectedSectors.includes("ALL")?"ALL":selectedSectors.join(" + ");

  return (
    <div className="page-enter" style={{ display:"flex", flexDirection:"column", gap:12 }}>

      {/* Sector filter */}
      <div className="card" style={{ padding:"12px 16px" }}>
        <div style={{ display:"flex", alignItems:"flex-start", gap:12, flexWrap:"wrap" }}>
          <span style={{ color:T.text0, fontSize:13, letterSpacing:0.5, fontFamily:T.font, whiteSpace:"nowrap", marginTop:6, fontWeight:700 }}>SECTOR FILTER</span>
          <SectorPills selectedSectors={selectedSectors} onChange={onSectorChange} showCounts={false} actualCount={tickerArray.length} T={T}/>
        </div>
      </div>

      {/* Controls row */}
      <div style={{ display:"flex", gap:9, alignItems:"center", flexWrap:"wrap" }}>
        <button className={`btn-ghost${viewMode==="TABLE"?" active":""}`} onClick={()=>setViewMode("TABLE")}>≡ TABLE</button>
        <button className={`btn-ghost${viewMode==="MATRIX"?" active":""}`} onClick={()=>setViewMode("MATRIX")}>⊞ MATRIX</button>
        {quickFilter && (
          <div style={{ display:"flex", alignItems:"center", gap:6, marginLeft:8, background:"rgba(34,211,238,0.08)", border:"1px solid rgba(34,211,238,0.25)", borderRadius:6, padding:"3px 10px" }}>
            <span style={{ color:T.cyan, fontSize:10, fontFamily:T.font, fontWeight:600 }}>{{VOL_SPIKES:"📡 VOL SPIKES",GAP_PLAYS:"📊 GAP PLAYS",AH_MOMT:"🌙 AH MOMT.",EARN_GAPS:"📋 EARN. GAPS",DIAMOND:"💎 DIAMOND"}[quickFilter]}</span>
            <button onClick={()=>onClearQuickFilter&&onClearQuickFilter()} style={{ background:"none",border:"none",color:"#4a6278",cursor:"pointer",fontSize:13,lineHeight:1,padding:0 }}>✕</button>
          </div>
        )}
        {viewMode==="TABLE" && (
          <div style={{ display:"flex", background:T.bg2, border:`1px solid ${T.border}`, borderRadius:5, overflow:"hidden" }}>
            {[["MH","MARKET HOURS"],["AH","AFTER HOURS"]].map(([id,lbl])=>(
              <button key={id} onClick={()=>setSubMode(id)} style={{ background:subMode===id?T.cyan+"14":"transparent", color:subMode===id?T.cyan:T.text2, border:"none", padding:"5px 12px", cursor:"pointer", fontFamily:T.font, fontSize:9, letterSpacing:1, borderRight:id==="MH"?`1px solid ${T.border}`:"none" }}>{lbl}</button>
            ))}
          </div>
        )}
        <div style={{ display:"flex", alignItems:"center", gap:7 }}>
          <span style={{ color:T.text2, fontSize:9.5, fontFamily:T.font }}>MIN Δ$</span>
          <input type="range" min="0" max="5" step="0.1" value={minDelta} onChange={e=>setMinDelta(Number(e.target.value))} style={{ width:90, accentColor:T.cyan }}/>
          <span style={{ color:T.cyan, fontSize:9.5, fontFamily:T.font, minWidth:26 }}>{minDelta.toFixed(1)}</span>
        </div>
        <div style={{ marginLeft:"auto", display:"flex", gap:6, alignItems:"center" }}>
          {["ALL","WATCHLIST"].map(s=>(
            <button key={s} className={`btn-ghost${source===s?" active":""}`} onClick={()=>setSource(s)} style={{ fontSize:9 }}>{s}</button>
          ))}
          <div style={{ display:"flex", alignItems:"center", gap:4, marginLeft:8 }}>
            <span style={{ color:T.text2, fontSize:9, fontFamily:T.font, whiteSpace:"nowrap" }}>OPEN</span>
            <select value={chartOpenCount} onChange={e=>setChartOpenCount(Number(e.target.value))} style={{ background:T.bg2, border:`1px solid ${T.border}`, color:T.text1, fontFamily:T.font, fontSize:9, padding:"5px 8px", cursor:"pointer", outline:"none", borderRadius:5 }}>
              {[5,10,20,50].map(n=><option key={n} value={n}>{n}</option>)}
            </select>
            <span style={{ color:T.text2, fontSize:9, fontFamily:T.font }}>CHARTS</span>
          </div>
          <div style={{ display:"flex", alignItems:"center", border:`1px solid ${T.border}`, borderRadius:5, overflow:"hidden" }}>
            <select value={extLink} onChange={e=>setExtLink(e.target.value)} style={{ background:T.bg2, border:"none", color:T.text1, fontFamily:T.font, fontSize:9, padding:"5px 8px", cursor:"pointer", outline:"none" }}>
              <option>Yahoo Finance</option><option>TradingView</option>
            </select>
            <button onClick={openExternalCharts} style={{ background:T.cyan+"14", border:"none", borderLeft:`1px solid ${T.border}`, color:T.cyan, padding:"5px 10px", cursor:"pointer", fontFamily:T.font, fontSize:9, fontWeight:600 }}>OPEN CHARTS</button>
          </div>
        </div>
      </div>

      {/* TABLE VIEW */}
      {viewMode==="TABLE" && (
        <div style={{ display:"flex", gap:16, height:"100%" }}>
          <div className="card" style={{ flex:selectedSymbol?"1 1 58%":"1 1 100%", minWidth:0, transition:"flex 0.3s ease", overflow:"hidden" }}>
            <SectionHeader title={`Live Stock Data · ${subMode==="MH"?"Market Hours":"After Hours"}${!selectedSectors.includes("ALL")?" · "+activeLabel:""}`} T={T}>
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                <span style={{ color:T.text2, fontSize:12, fontFamily:T.font, fontWeight:500 }}>{sortedSymbols.length.toLocaleString()} tickers</span>
                {tickers.size>0?(<><span className="live-dot"/><span style={{ color:T.green, fontSize:12, fontFamily:T.font, fontWeight:600 }}>LIVE</span></>):wsStatus==='connecting'?(<span style={{ color:T.gold, fontSize:12, fontFamily:T.font }}>🔄 RECONNECTING…</span>):wsStatus==='feed_warning'?(<span style={{ color:T.gold, fontSize:12, fontFamily:T.font }}>⚠ FEED RECONNECTING…</span>):(<span style={{ color:T.cyan, fontSize:12, fontFamily:T.font }}>⏳ AWAITING…</span>)}
              </div>
            </SectionHeader>

            <div style={{ display:"grid", gridTemplateColumns:gridCols, background:T.bg0, borderBottom:`1px solid ${T.border}` }}>
              {cols.map(c => {
                const isActive=sortKey===c.key;
                return (
                  <div key={c.key} onClick={()=>handleColSort(c.key)}
                    style={{ padding:"12px 14px", color:isActive?T.cyan:T.text0, fontSize:11, letterSpacing:1, fontFamily:T.font, fontWeight:800, textTransform:"uppercase", cursor:"pointer", userSelect:"none", background:isActive?T.cyanDim:"transparent" }}>
                    {c.label}{isActive?(sortDir==="desc"?" ↓":" ↑"):<span style={{ opacity:0.25, fontSize:10 }}> ⇅</span>}
                  </div>
                );
              })}
            </div>

            {/* T2-6: Virtual scroll container — only ~20 DOM nodes at a time regardless of 6,000+ tickers */}
            {/* MOBILE-FIX: overflowX changed from "hidden" to "auto" so users can
                horizontally scroll to see $ CHG, % CHG, VOLUME, SIGNAL columns on mobile.
                On desktop the 1fr columns auto-fill so no horizontal scroll appears. */}
            <div ref={tableScrollRef} style={{ height:"calc(100vh - 420px)", minHeight:"300px", overflowY:"auto", overflowX:"auto", position:"relative" }}>
              {tickers.size===0&&wsStatus==='connecting'&&<div style={{ padding:40, textAlign:"center", color:T.gold, fontSize:13, fontFamily:T.font }}>🔄 Reconnecting to live feed…</div>}
              {tickers.size===0&&wsStatus==='connected'&&<div style={{ padding:40, textAlign:"center", color:T.cyan, fontSize:13, fontFamily:T.font }}>⏳ Connected — waiting for snapshot…</div>}
              {tickers.size===0&&wsStatus==='disconnected'&&<div style={{ padding:40, textAlign:"center", color:T.red, fontSize:13, fontFamily:T.font }}>❌ WebSocket disconnected — reconnecting</div>}
              {/* RECONNECT-BANNER-FIX: when feed drops but tickers are cached, show a
                  slim amber banner instead of blanking the table. Last-known prices stay
                  visible — far more useful than an empty screen during a brief reconnect. */}
              {tickers.size>0&&wsStatus==='feed_warning'&&(
                <div style={{ padding:"5px 14px", background:T.gold+"18", borderBottom:`1px solid ${T.gold}33`,
                  color:T.gold, fontSize:10, fontFamily:T.font, textAlign:"center", letterSpacing:0.5 }}>
                  ⚠ Feed reconnecting — prices shown are last known
                </div>
              )}
              {sortedSymbols.length===0&&tickers.size>0&&<div style={{ padding:40, textAlign:"center", color:T.text2, fontSize:13, fontFamily:T.font }}>No tickers match the current filter</div>}
              {sortedSymbols.length > 0 && (
                <div style={{ height: virtualizer.getTotalSize(), width:"100%", position:"relative" }}>
                  {virtualizer.getVirtualItems().map(virtualRow => {
                    const sym    = sortedSymbols[virtualRow.index];
                    const ticker = tickers.get(sym);
                    if (!ticker) return null;
                    return (
                      <div key={virtualRow.key} data-index={virtualRow.index} style={{ position:"absolute", top:0, left:0, width:"100%", height:`${virtualRow.size}px`, transform:`translateY(${virtualRow.start}px)` }}>
                        <LiveTableRow ticker={ticker} isWatched={watchlist.has(sym)} toggleWatchlist={toggleWatchlist} subMode={subMode} gridCols={gridCols} scalpSignals={scalpSignals} setSelectedSymbol={setSelectedSymbol} haltedTickers={haltedTickers} noiBySym={noiBySym} T={T} isStale={staleTickers.has(sym)} />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div style={{ padding:"10px 18px", borderTop:`2px solid ${T.border}`, display:"flex", justifyContent:"space-between", alignItems:"center", background:T.bg1, position:"sticky", bottom:0, zIndex:10 }}>
              <span style={{ color:T.text1, fontSize:13, fontFamily:T.font, fontWeight:600 }}>
                {sortedSymbols.length > 0 ? `${sortedSymbols.length.toLocaleString()} stocks · scroll to browse` : "No stocks to display"}
              </span>
              <span style={{ color:T.text2, fontSize:11, fontFamily:T.font }}>Virtual scroll · {virtualizer.getVirtualItems().length} rows rendered</span>
            </div>
          </div>

          {/* Inline chart panel */}
          {selectedSymbol && (
            <div className="card" style={{ flex:"0 0 40%", minWidth:320, maxWidth:560, display:"flex", flexDirection:"column", overflow:"hidden", animation:"slideInRight 0.22s ease", position:"relative" }}>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"10px 14px", borderBottom:`1px solid ${T.border}`, flexShrink:0 }}>
                <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                  <span style={{ color:T.cyan, fontFamily:T.font, fontSize:15, fontWeight:800 }}>{selectedSymbol}</span>
                  <span style={{ color:T.text2, fontFamily:T.font, fontSize:10 }}>CHART</span>
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                  {["1","5","15","60","D"].map(tf=>(
                    <button key={tf} onClick={()=>setChartPanelTF(tf)} style={{ background:chartPanelTF===tf?T.cyan+"22":"transparent", border:`1px solid ${chartPanelTF===tf?T.cyan:T.border}`, color:chartPanelTF===tf?T.cyan:T.text2, fontFamily:T.font, fontSize:10, fontWeight:700, padding:"3px 8px", borderRadius:4, cursor:"pointer" }}>
                      {tf==="D"?"1D":tf==="60"?"1H":tf+"m"}
                    </button>
                  ))}
                  <a href={`https://www.tradingview.com/chart/?symbol=${selectedSymbol}`} target="_blank" rel="noreferrer" style={{ color:T.text2, fontSize:10, fontFamily:T.font, textDecoration:"none", padding:"3px 8px", border:`1px solid ${T.border}`, borderRadius:4 }}>⬡ TV</a>
                  <button onClick={()=>setSelectedSymbol(null)} style={{ background:"transparent", border:`1px solid ${T.border}`, color:T.text2, fontFamily:T.font, fontSize:11, fontWeight:700, padding:"3px 9px", borderRadius:4, cursor:"pointer" }}>✕</button>
                </div>
              </div>
              {(() => {
                const live=tickers.get(selectedSymbol);
                if(!live) return null;
                const mhChgVal = (live.open > 0 && live.live_price > 0) ? live.live_price - live.open : (live.change_value || 0);
                const mhPctVal = (live.open > 0 && live.live_price > 0) ? (live.live_price - live.open) / live.open * 100 : (live.percent_change || 0);
                const isPos=mhChgVal>=0;
                return (
                  <div style={{ display:"flex", gap:16, padding:"8px 14px", borderBottom:`1px solid ${T.border}`, background:T.bg2, flexShrink:0 }}>
                    <span style={{ color:T.text0, fontFamily:T.font, fontSize:13, fontWeight:700 }}>${(live.live_price||0).toFixed(2)}</span>
                    <span style={{ color:isPos?T.green:T.red, fontFamily:T.font, fontSize:12 }}>{isPos?"+":" "}{mhChgVal.toFixed(2)} ({isPos?"+":""}{mhPctVal.toFixed(2)}%)</span>
                    <span style={{ color:T.text2, fontFamily:T.font, fontSize:11 }}>Vol {live.volume?(live.volume/1e6).toFixed(1)+"M":"—"}</span>
                  </div>
                );
              })()}
              <div style={{ flex:1, minHeight:0 }}>
                <TVChart symbol={selectedSymbol} height="100%" T={T} interval={chartPanelTF} livePrice={tickers.get(selectedSymbol)?.live_price??null}/>
              </div>
            </div>
          )}
        </div>
      )}

      {/* MATRIX VIEW */}
      {viewMode==="MATRIX" && (
        <div>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
            <div style={{ display:"flex", gap:6, alignItems:"center", flexWrap:"wrap" }}>
              <span style={{ color:T.text1, fontSize:10, fontFamily:T.font, letterSpacing:1.5 }}>TOP</span>
              {[5,10,20,50].map(n=>(<button key={n} className={`btn-ghost${matrixCount===n?" active":""}`} onClick={()=>setMatrixCount(n)} style={{ fontSize:9, padding:"3px 9px" }}>{n}</button>))}
              <span style={{ color:T.text2, fontSize:9, fontFamily:T.font }}>TF:</span>
              {["1","5","15","60"].map(tf=>(<button key={tf} className={`btn-ghost${matrixInterval===tf?" active":""}`} onClick={()=>setMatrixInterval(tf)} style={{ fontSize:9, padding:"3px 9px" }}>{tf==="60"?"1H":tf+"m"}</button>))}
            </div>
            <button onClick={()=>setViewMode("TABLE")} style={{ background:"none", border:`1px solid ${T.border}`, color:T.text2, borderRadius:4, padding:"3px 10px", cursor:"pointer", fontFamily:T.font, fontSize:9 }}>✕ CLOSE</button>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(380px,1fr))", gap:10 }}>
            {matrixSymbols.map(sym=>(<MatrixCell key={sym} sym={sym} tickers={tickers} matrixInterval={matrixInterval} T={T}/>))}
          </div>
        </div>
      )}
    </div>
  );
}
