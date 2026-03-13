// PageLiveTable.jsx — NexRadar Pro
// Live stock data table with sector filter, sub-mode (MH/AH), matrix view,
// inline chart panel, pagination, and two-tier sort throttling.

import { useState, useEffect, useRef, useMemo, useCallback, memo } from "react";
import { API_BASE } from "../../config.js";
import { SESSION_META } from "./constants.js";
import { fmt2, pct, fmtVol, normalizeSector } from "./utils.js";
import { SectionHeader, SectorPills, TVChart, MatrixCell } from "./primitives.jsx";

// ─── Memoized table row — skips re-render when visible data unchanged ─────────
const LiveTableRow = memo(function LiveTableRow({ ticker, isWatched, toggleWatchlist, subMode, gridCols, scalpSignals, setSelectedSymbol, haltedTickers, noiBySym, T }) {
  // MH: use day-over-day change_value / percent_change
  // AH: use ah_dollar / ah_pct (live_price vs today_close)
  const ahDollar    = ticker.ah_dollar    ?? (ticker.today_close > 0 ? ticker.live_price - ticker.today_close : ticker.change_value) ?? 0;
  const ahPct       = ticker.ah_pct       ?? (ticker.today_close > 0 ? (ticker.live_price - ticker.today_close) / ticker.today_close * 100 : ticker.percent_change) ?? 0;
  const displayChg  = subMode === 'AH' ? ahDollar : (ticker.change_value || 0);
  const displayPct  = subMode === 'AH' ? ahPct    : (ticker.percent_change || 0);
  const isPositive  = displayChg >= 0;
  const changeColor = isPositive ? T.green : T.red;
  const isHalted    = haltedTickers?.has(ticker.ticker) ?? ticker.is_halted ?? false;
  const noi         = noiBySym?.[ticker.ticker] ?? null;
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
                    <div style={{ display:'flex', alignItems:'center', gap:4, marginTop:2 }}>
                      <div className="noi-bar-wrap">
                        <div className="noi-bar-fill" style={{
                          background: noi.imbalance_side==='B' ? '#00e676' : '#ff3d5a',
                          width: noi.imbalance_side==='B' ? '70%' : '30%',
                          left: noi.imbalance_side==='B' ? '30%' : '0%',
                        }}/>
                      </div>
                      <span style={{ color:noi.imbalance_side==='B'?'#00e676':'#ff3d5a', fontSize:8, fontWeight:700 }}>
                        {noi.imbalance_side==='B'?'BUY IMBAL':'SELL IMBAL'}
                      </span>
                    </div>
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
          <div style={{ padding:"10px 14px", color:T.cyan, fontFamily:T.font, fontSize:13, display:"flex", alignItems:"center" }}>{fmt2(ticker.live_price||0)}</div>
          <div style={{ padding:"10px 14px", color:changeColor, fontFamily:T.font, fontSize:13, display:"flex", alignItems:"center" }}>{isPositive?"+":" "}{fmt2(displayChg)}</div>
          <div style={{ padding:"10px 14px", color:changeColor, fontFamily:T.font, fontSize:13, display:"flex", alignItems:"center" }}>{pct(displayPct)}</div>
        </>
      )}
    </div>
  );
}, (prev, next) => (
  prev.ticker.live_price   === next.ticker.live_price &&
  prev.ticker.change_value === next.ticker.change_value &&
  prev.ticker.ah_dollar    === next.ticker.ah_dollar    &&
  prev.ticker.percent_change === next.ticker.percent_change &&
  prev.ticker.volume       === next.ticker.volume &&
  prev.ticker.volume_spike === next.ticker.volume_spike &&
  prev.isWatched           === next.isWatched &&
  prev.subMode             === next.subMode &&
  prev.gridCols            === next.gridCols &&
  prev.scalpSignals?.[prev.ticker.ticker]?.signal === next.scalpSignals?.[next.ticker.ticker]?.signal &&
  prev.haltedTickers?.has(prev.ticker.ticker) === next.haltedTickers?.has(next.ticker.ticker) &&
  (prev.noiBySym?.[prev.ticker.ticker]?.imbalance_side) === (next.noiBySym?.[next.ticker.ticker]?.imbalance_side)
));

export default function PageLiveTable({ selectedSectors, onSectorChange, tickers = new Map(), marketSession = "market", wsWatchlistRef = null, quickFilter = null, onClearQuickFilter = null, wsStatus = 'connected', onLiveCount = null, watchlistProp = null, toggleWatchlistProp = null, T }) {
  const [viewMode,     setViewMode]     = useState("TABLE");
  const [source,       setSource]       = useState("ALL");
  const [minDelta,     setMinDelta]     = useState(0);
  const [extLink,      setExtLink]      = useState("Yahoo Finance");
  const [matrixCount,  setMatrixCount]  = useState(50);
  const [currentPage,  setCurrentPage]  = useState(1);
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

  const tableScrollRef  = useRef(null);
  const tickerArrayRef  = useRef([]);
  const noiBySymRef     = useRef({});   // BUG-10 FIX: raw mutable map, avoids spread copy on every NOI event
  const noiFlushTimerRef = useRef(null);
  const ITEMS_PER_PAGE = 50;

  // Fallback local watchlist when not provided from root
  const [_localWatchlist, _setLocalWatchlist] = useState(new Set());
  const watchlist    = watchlistProp ?? _localWatchlist;
  const toggleWatchlist = toggleWatchlistProp ?? useCallback(async (symbol) => {
    const isWatched = _localWatchlist.has(symbol);
    _setLocalWatchlist(prev => { const n=new Set(prev); isWatched?n.delete(symbol):n.add(symbol); return n; });
    try {
      await fetch(`${API_BASE}/api/watchlist/${isWatched?"remove":"add"}`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ticker:symbol}) });
    } catch { _setLocalWatchlist(prev => { const n=new Set(prev); isWatched?n.add(symbol):n.delete(symbol); return n; }); }
  }, [_localWatchlist]);

  const autoSubMode = SESSION_META[marketSession]?.subMode ?? "MH";
  const subMode     = subModeOverride ?? autoSubMode;
  const setSubMode  = (id) => setSubModeOverride(id === autoSubMode ? null : id);
  useEffect(() => { setSubModeOverride(null); }, [autoSubMode]);

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

  // Scalp signals
  useEffect(() => {
    const poll = () => fetch(`${API_BASE}/api/scalp-analysis`).then(r=>r.ok?r.json():null).then(d=>{ if(!d?.data)return; const m={}; d.data.forEach(r=>{if(!r.status||r.status==="ok")m[r.ticker]=r;}); setScalpSignals(m); }).catch(()=>{});
    poll();
    const id = setInterval(poll, 30_000);
    return () => clearInterval(id);
  }, []);

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

  // Column sort
  const handleColSort = (key) => {
    setSortKey(prev => { if(prev===key){setSortDir(d=>d==="desc"?"asc":"desc");return key;} setSortDir("desc"); return key; });
    setCurrentPage(1);
  };

  // Two-tier sort throttle
  const [sortTrigger, setSortTrigger] = useState(0);
  useEffect(() => { const id=setInterval(()=>setSortTrigger(t=>t+1),1000); return ()=>clearInterval(id); }, []);

  const [userFilterVersion, setUserFilterVersion] = useState(0);
  useEffect(() => { setUserFilterVersion(v=>v+1); }, [selectedSectors, source, watchlist, earningsTickers, quickFilter]);

  const tickerArray = useMemo(() => {
    let arr = Array.from(tickers.values());
    if (source==="WATCHLIST") arr = arr.filter(t=>watchlist.has(t.ticker));
    if (!selectedSectors.includes("ALL")) {
      arr = arr.filter(t => {
        if (selectedSectors.includes("EARNINGS") && (t.is_earnings_gap_play||earningsTickers.has(t.ticker))) return true;
        const s = normalizeSector(t.sector);
        return s && selectedSectors.some(sel=>s===sel&&sel!=="EARNINGS");
      });
    }
    tickerArrayRef.current = arr;
    return arr;
  }, [tickers, selectedSectors, source, watchlist, earningsTickers]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const filteredTickers = useMemo(() => {
    let arr = tickerArrayRef.current.filter(t=>Math.abs(t.change_value||0)>=minDelta);
    if (quickFilter==="VOL_SPIKES")  arr=arr.filter(t=>t.volume_spike);
    if (quickFilter==="GAP_PLAYS")   arr=arr.filter(t=>t.is_gap_play);
    if (quickFilter==="AH_MOMT")     arr=arr.filter(t=>t.ah_momentum);
    if (quickFilter==="EARN_GAPS")   arr=arr.filter(t=>t.is_earnings_gap_play);
    if (quickFilter==="DIAMOND")     arr=arr.filter(t=>Math.abs(t.percent_change||0)>=5);
    const dir = sortDir==="desc"?-1:1;
    return arr.slice().sort((a,b) => {
      let va,vb;
      switch(sortKey){
        case "symbol":     return dir*(a.ticker||"").localeCompare(b.ticker||"");
        case "open":       va=a.open||0;       vb=b.open||0;       break;
        case "price":      va=a.live_price||0; vb=b.live_price||0; break;
        case "change":     va=a.change_value||0; vb=b.change_value||0; break;
        case "pct":        va=a.percent_change||0; vb=b.percent_change||0; break;
        case "volume":     va=a.volume||0;     vb=b.volume||0;     break;
        case "prev_close": va=a.prev_close||0; vb=b.prev_close||0; break;
        case "today_close":va=a.today_close||0;vb=b.today_close||0;break;
        case "live_price": va=a.live_price||0; vb=b.live_price||0; break;
        default:           va=a.change_value||0; vb=b.change_value||0;
      }
      return dir*(va-vb);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortTrigger, userFilterVersion, minDelta, quickFilter, sortKey, sortDir]);

  useEffect(() => { setCurrentPage(1); }, [selectedSectors, minDelta]);
  useEffect(() => { if(onLiveCount) onLiveCount(tickerArray.length); }, [tickerArray.length]); // eslint-disable-line

  const totalPages = Math.ceil(filteredTickers.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage-1)*ITEMS_PER_PAGE;
  const paginatedTickers = filteredTickers.slice(startIndex, startIndex+ITEMS_PER_PAGE);

  const matrixSymbols = useMemo(() => {
    if (filteredTickers.length>0) return filteredTickers.slice(0,matrixCount).map(t=>t.ticker);
    return ["AAPL","MSFT","NVDA","AMZN","GOOGL","META","TSLA","AVGO","JPM","V","MA","UNH","LLY","XOM","PG","HD","BAC","ABBV","NFLX","AMD"].slice(0,matrixCount);
  }, [filteredTickers, matrixCount]);

  const openExternalCharts = () => {
    filteredTickers.slice(0,chartOpenCount).forEach(t => {
      window.open(extLink==="TradingView"?`https://www.tradingview.com/chart/?symbol=${t.ticker}`:`https://finance.yahoo.com/quote/${t.ticker}`,"_blank");
    });
  };

  const MH_COLS = [
    {key:"symbol",w:"260px",label:"SYMBOL"},{key:"open",w:"1fr",label:"OPEN"},{key:"price",w:"1fr",label:"PRICE"},
    {key:"change",w:"1fr",label:"$ CHG"},{key:"pct",w:"1fr",label:"% CHG"},{key:"volume",w:"1fr",label:"VOLUME"},{key:"signal",w:"120px",label:"SIGNAL"},
  ];
  const AH_COLS = [
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
                <span style={{ color:T.text2, fontSize:12, fontFamily:T.font, fontWeight:500 }}>{filteredTickers.length.toLocaleString()} tickers</span>
                {tickers.size>0?(<><span className="live-dot"/><span style={{ color:T.green, fontSize:12, fontFamily:T.font, fontWeight:600 }}>LIVE</span></>):wsStatus==='connecting'?(<span style={{ color:T.gold, fontSize:12, fontFamily:T.font }}>🔄 RECONNECTING…</span>):(<span style={{ color:T.cyan, fontSize:12, fontFamily:T.font }}>⏳ AWAITING…</span>)}
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

            <div ref={tableScrollRef} style={{ maxHeight:"calc(100vh - 420px)", minHeight:"300px", overflowY:"auto", overflowX:"hidden", position:"relative" }}>
              {tickers.size===0&&wsStatus==='connecting'&&<div style={{ padding:40, textAlign:"center", color:T.gold, fontSize:13, fontFamily:T.font }}>🔄 Reconnecting to live feed…</div>}
              {tickers.size===0&&wsStatus==='connected'&&<div style={{ padding:40, textAlign:"center", color:T.cyan, fontSize:13, fontFamily:T.font }}>⏳ Connected — waiting for snapshot…</div>}
              {tickers.size===0&&wsStatus==='disconnected'&&<div style={{ padding:40, textAlign:"center", color:T.red, fontSize:13, fontFamily:T.font }}>❌ WebSocket disconnected — reconnecting</div>}
              {paginatedTickers.length===0&&tickers.size>0&&<div style={{ padding:40, textAlign:"center", color:T.text2, fontSize:13, fontFamily:T.font }}>No tickers match the current filter</div>}
              {paginatedTickers.map((ticker,i) => (
                <LiveTableRow key={ticker.ticker||i} ticker={ticker} isWatched={watchlist.has(ticker.ticker)} toggleWatchlist={toggleWatchlist} subMode={subMode} gridCols={gridCols} scalpSignals={scalpSignals} setSelectedSymbol={setSelectedSymbol} haltedTickers={haltedTickers} noiBySym={noiBySym} T={T}/>
              ))}
              {paginatedTickers.length>=10&&<div style={{ position:"sticky", bottom:0, left:0, right:0, height:40, background:`linear-gradient(to bottom,transparent,${T.bg1})`, pointerEvents:"none" }}/>}
            </div>

            <div style={{ padding:"14px 18px", borderTop:`2px solid ${T.border}`, display:"flex", justifyContent:"space-between", alignItems:"center", background:T.bg1, position:"sticky", bottom:0, zIndex:10 }}>
              <span style={{ color:T.text1, fontSize:13, fontFamily:T.font, fontWeight:600 }}>
                {paginatedTickers.length>0?`Showing ${startIndex+1}-${Math.min(startIndex+ITEMS_PER_PAGE,filteredTickers.length)} of ${filteredTickers.length.toLocaleString()} stocks`:"No stocks to display"}
              </span>
              <div style={{ display:"flex", gap:10, alignItems:"center" }}>
                <span style={{ color:T.text1, fontSize:13, fontFamily:T.font, fontWeight:600 }}>Page {currentPage} of {totalPages||1}</span>
                <button className="btn-ghost" style={{ fontSize:12, padding:"6px 12px" }} onClick={()=>{setCurrentPage(p=>Math.max(1,p-1));tableScrollRef.current&&(tableScrollRef.current.scrollTop=0);}} disabled={currentPage===1}>← PREV</button>
                <button className="btn-ghost" style={{ fontSize:12, padding:"6px 12px" }} onClick={()=>{setCurrentPage(p=>Math.min(totalPages,p+1));tableScrollRef.current&&(tableScrollRef.current.scrollTop=0);}} disabled={currentPage>=totalPages}>NEXT →</button>
              </div>
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
                const chg=live.percent_change||0, isPos=chg>=0;
                return (
                  <div style={{ display:"flex", gap:16, padding:"8px 14px", borderBottom:`1px solid ${T.border}`, background:T.bg2, flexShrink:0 }}>
                    <span style={{ color:T.text0, fontFamily:T.font, fontSize:13, fontWeight:700 }}>${(live.live_price||0).toFixed(2)}</span>
                    <span style={{ color:isPos?T.green:T.red, fontFamily:T.font, fontSize:12 }}>{isPos?"+":" "}{(live.change_value||0).toFixed(2)} ({isPos?"+":""}{chg.toFixed(2)}%)</span>
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
