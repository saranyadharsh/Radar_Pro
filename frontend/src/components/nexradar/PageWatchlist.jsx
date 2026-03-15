// ═══════════════════════════════════════════════════════════════
// PageWatchlist.jsx — NexRadar Pro
// SSE-driven: live prices from tickers Map (useTickerData)
// Watchlist state managed by useWatchlist (shared with LiveTable)
// Star in LiveTable → adds here. ✕ button → removes from both.
// No DataEngine WebSocket. No hardcoded DEFAULT_WATCHLIST.
// ═══════════════════════════════════════════════════════════════

import { useState, useCallback, useMemo } from "react";
import { fmt2, fmtVol } from "./utils.js";
import AgenticPanel, { Shimmer } from "./AgenticPanel.jsx";

function RangeBar({ price, high, low, T }) {
  if (!price||!high||!low||high===low) return <span style={{color:T.text2,fontSize:9}}>—</span>;
  const pct = Math.round(((price-low)/(high-low))*100);
  const color = pct>70?T.green:pct>40?T.gold:T.red;
  return <div>
    <div style={{height:3,background:T.bg4,borderRadius:2,width:55,overflow:"hidden"}}>
      <div style={{height:"100%",width:pct+"%",background:color,borderRadius:2}}/>
    </div>
    <span style={{color:T.text2,fontFamily:T.font,fontSize:7.5}}>{pct}%</span>
  </div>;
}

function EdgarBadge({ alert, T }) {
  if (!alert) return null;
  const color = ["VERY_POSITIVE","POSITIVE"].includes(alert.impact)?T.green
    :["VERY_NEGATIVE","NEGATIVE"].includes(alert.impact)?T.red:T.orange;
  return <div style={{color,fontFamily:T.font,fontSize:7.5,marginTop:2,
    display:"flex",alignItems:"center",gap:3}}>
    <span>⚡</span><span>{alert.eventType}</span>
  </div>;
}

// News push badge — appears on row when new headline arrives
function NewsBadge({ alert, T }) {
  if (!alert) return null;
  const color = alert.sentiment==="positive"?T.green
    :alert.sentiment==="negative"?T.red:T.gold;
  return <div style={{color,fontFamily:T.font,fontSize:7.5,marginTop:2,
    display:"flex",alignItems:"center",gap:3}}>
    <span>📰</span>
    <span style={{maxWidth:90,overflow:"hidden",
      textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
      {alert.headline}
    </span>
  </div>;
}

// Floating toast for breaking news
function NewsToast({ toast, onDismiss, T }) {
  if (!toast) return null;
  const color = toast.sentiment==="positive"?T.green
    :toast.sentiment==="negative"?T.red:T.gold;
  return (
    <div style={{
      position:"fixed", bottom:24, right:24, zIndex:9999,
      background:T.bg2, border:`1px solid ${color}50`,
      borderLeft:`3px solid ${color}`,
      borderRadius:8, padding:"11px 14px", maxWidth:320,
      boxShadow:`0 4px 24px #00000060`,
      animation:"slideIn 0.2s ease",
      fontFamily:T.font,
    }}>
      <div style={{display:"flex",justifyContent:"space-between",
        alignItems:"flex-start",gap:8}}>
        <div style={{flex:1}}>
          <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:5}}>
            <span style={{fontSize:12}}>📰</span>
            <span style={{color,fontSize:8.5,fontWeight:900,
              letterSpacing:0.8}}>NEWS · {toast.symbol}</span>
            <span style={{background:color+"20",border:`1px solid ${color}40`,
              color,borderRadius:3,padding:"1px 5px",
              fontSize:7.5,fontWeight:700,textTransform:"capitalize"}}>
              {toast.sentiment}
            </span>
          </div>
          <p style={{color:T.text0,fontSize:10.5,lineHeight:1.7,marginBottom:4}}>
            {toast.headline}
          </p>
          <span style={{color:T.text2,fontSize:8}}>{toast.source}</span>
        </div>
        <button onClick={onDismiss}
          style={{background:"none",border:"none",color:T.text2,
            cursor:"pointer",fontSize:14,lineHeight:1,flexShrink:0}}>×</button>
      </div>
    </div>
  );
}

export default function PageWatchlist({
  onNavigateToSettings,
  // SSE-driven props from NexRadarDashboard — no DataEngine needed
  watchlistSet = new Set(),       // Set<string> of starred symbols
  toggleWatchlist = ()=>{},       // (symbol) => void — calls backend + optimistic update
  tickers = new Map(),            // Map<ticker, liveRow> from useTickerData SSE
  T,
}) {
  // Derive flat watchlist array from the Set + tickers map for metadata
  const watchlist = useMemo(() => {
    return [...watchlistSet].map(sym => {
      const live = tickers.get(sym) || {};
      return {
        symbol:      sym,
        companyName: live.company_name || live.company || sym,
        sector:      live.sector || "—",
        tags:        [],
      };
    });
  }, [watchlistSet, tickers]);

  const [selectedTick, setSelectedTick] = useState(null);
  const [selectedRow,  setSelectedRow]  = useState(null);
  const [search,       setSearch]       = useState("");
  const [addSymbol,    setAddSymbol]    = useState("");
  const [filterTag,    setFilterTag]    = useState("ALL");
  const [newsAlerts,   setNewsAlerts]   = useState({});
  const [toast,        setToast]        = useState(null);

  // Live prices come directly from the SSE tickers map — no DataEngine WebSocket
  // tickers is a Map<symbol, {price, change, changePct, volume, high, low, vwap, ...}>
  const getLive = (sym) => {
    const row = tickers.get(sym);
    if (!row) return null;
    return {
      price:     row.price      || row.live_price   || 0,
      change:    row.change_value || 0,
      changePct: row.percent_change || row.change_pct || 0,
      volume:    row.volume     || 0,
      high:      row.high       || 0,
      low:       row.low        || 0,
      vwap:      row.vwap       || 0,
      prevClose: row.prev_close || 0,
    };
  };

  // Add to watchlist (calls backend via toggleWatchlist prop)
  const addToWatchlist = useCallback(() => {
    const sym = addSymbol.trim().toUpperCase();
    if (!sym || watchlistSet.has(sym)) return;
    toggleWatchlist(sym);
    setAddSymbol("");
  }, [addSymbol, watchlistSet, toggleWatchlist]);

  // Remove from watchlist
  const removeFromWatchlist = useCallback((sym) => {
    toggleWatchlist(sym);
    if (selectedTick === sym) { setSelectedTick(null); setSelectedRow(null); }
  }, [toggleWatchlist, selectedTick]);

  // Dummy for backward-compat with refresh button
  const loadPrices = useCallback(() => {}, []);
  const isSyncing  = false;

  const allTags = useMemo(() => {
    const tags = new Set(["ALL"]);
    watchlist.forEach(w=>w.tags?.forEach(t=>tags.add(t)));
    return [...tags];
  }, [watchlist]);

  const filtered = useMemo(() => {
    let list = watchlist;
    if (search.trim()) {
      const s = search.trim().toUpperCase();
      list = list.filter(w=>w.symbol.includes(s)||(w.companyName||"").toUpperCase().includes(s));
    }
    if (filterTag!=="ALL") list = list.filter(w=>w.tags?.includes(filterTag));
    return list;
  }, [watchlist,search,filterTag]);

  const stats = useMemo(() => {
    const prices = watchlist.map(w => getLive(w.symbol)).filter(Boolean);
    return {
      total:   watchlist.length,
      gainers: prices.filter(p=>p.change>0).length,
      losers:  prices.filter(p=>p.change<0).length,
      alerts:  0,
      news:    Object.keys(newsAlerts).length,
    };
  }, [watchlist, tickers, newsAlerts]);

  const COL = "82px 120px 78px 82px 78px 70px 38px";

  return (
    <div style={{background:T.bg0,height:"100vh",fontFamily:T.font,
      display:"flex",flexDirection:"column",overflow:"hidden"}}>
      

      {/* Top bar */}
      <div style={{display:"flex",alignItems:"center",gap:10,padding:"9px 16px",
        borderBottom:`1px solid ${T.border}`,background:T.bg1,
        flexShrink:0,flexWrap:"wrap"}}>
        <div style={{display:"flex",alignItems:"center",gap:7}}>
          <div style={{width:7,height:7,borderRadius:"50%",background:T.green,
            boxShadow:`0 0 6px ${T.green}`,animation:"pulse 2s infinite"}}/>
          <span style={{color:T.text0,fontSize:11,fontFamily:T.font,
            fontWeight:700,letterSpacing:1.2}}>★ WATCHLIST</span>
          {watchlist.length > 0 && (
            <span style={{color:T.green,fontFamily:T.font,fontSize:9,
              background:T.green+"18",border:`1px solid ${T.green}30`,
              borderRadius:4,padding:"2px 7px",fontWeight:700}}>
              ⚡ {watchlist.length} SIGNALS ACTIVE
            </span>
          )}
        </div>
        <div style={{display:"flex",gap:6}}>
          <input value={addSymbol}
            onChange={e=>setAddSymbol(e.target.value.toUpperCase())}
            onKeyDown={e=>e.key==="Enter"&&addToWatchlist()}
            placeholder="Add ticker…"
            style={{background:T.bg2,border:`1px solid ${T.border}`,borderRadius:6,
              padding:"5px 10px",color:T.text0,fontFamily:T.font,fontSize:11,
              outline:"none",caretColor:T.cyan,width:130}}/>
          <button onClick={addToWatchlist}
            style={{background:T.cyanDim,border:`1px solid ${T.cyanMid}`,
              color:T.cyan,borderRadius:6,padding:"5px 12px",cursor:"pointer",
              fontFamily:T.font,fontSize:10,fontWeight:700}}>+ ADD</button>
        </div>
        <input value={search} onChange={e=>setSearch(e.target.value)}
          placeholder="Search…"
          style={{background:T.bg2,border:`1px solid ${T.border}`,borderRadius:6,
            padding:"5px 10px",color:T.text0,fontFamily:T.font,fontSize:11,
            outline:"none",caretColor:T.cyan,width:130}}/>
        <div style={{marginLeft:"auto",display:"flex",gap:7,
          alignItems:"center",flexWrap:"wrap"}}>
          {[
            {icon:"★",l:"TOTAL",  v:stats.total,  c:T.cyan},
            {icon:"▲",l:"GAINERS",v:stats.gainers,c:T.green},
            {icon:"▼",l:"LOSERS", v:stats.losers, c:T.red},
            {icon:"⚡",l:"ALERTS", v:stats.alerts, c:T.orange},
            {icon:"📰",l:"NEWS",   v:stats.news,   c:T.gold},
          ].map(s=>(
            <div key={s.l} style={{display:"flex",alignItems:"center",gap:5,
              background:T.bg2,border:`1px solid ${T.border}`,
              borderRadius:5,padding:"4px 9px"}}>
              <span style={{color:s.c,fontSize:9}}>{s.icon}</span>
              <span style={{color:T.text2,fontSize:7.5,fontFamily:T.font}}>{s.l}</span>
              <span style={{color:s.c,fontSize:12,fontFamily:T.font,fontWeight:800}}>{s.v}</span>
            </div>
          ))}

        </div>
      </div>

      {/* Tag filter */}
      <div style={{display:"flex",gap:6,padding:"7px 16px",
        borderBottom:`1px solid ${T.border}`,background:T.bg1,
        flexShrink:0,flexWrap:"wrap"}}>
        {allTags.map(tag=>(
          <button key={tag} onClick={()=>setFilterTag(tag)}
            style={{background:filterTag===tag?T.cyanDim:"transparent",
              border:`1px solid ${filterTag===tag?T.cyanMid:T.border}`,
              color:filterTag===tag?T.cyan:T.text2,
              borderRadius:5,padding:"4px 10px",cursor:"pointer",
              fontFamily:T.font,fontSize:8.5,
              fontWeight:filterTag===tag?700:500,transition:"all 0.12s"}}>
            {tag}
          </button>
        ))}
      </div>

      {/* Split layout */}
      <div style={{display:"flex",flex:1,overflow:"hidden"}}>

        {/* LEFT — table */}
        <div style={{flex:1,display:"flex",flexDirection:"column",
          overflow:"hidden",borderRight:`1px solid ${T.border}`}}>

          {/* Headers */}
          <div style={{display:"grid",gridTemplateColumns:COL,
            background:T.bg0,borderBottom:`2px solid ${T.border}`,
            padding:"0 14px",flexShrink:0}}>
            {["SYMBOL","COMPANY","PRICE","CHANGE","VOLUME","52W","✕"].map(h=>(
              <div key={h} style={{padding:"7px 4px",color:T.text2,fontSize:8,
                fontFamily:T.font,letterSpacing:0.8,fontWeight:700}}>{h}</div>
            ))}
          </div>

          <div style={{flex:1,overflowY:"auto"}}>
            {filtered.length===0 ? (
              <div style={{display:"flex",flexDirection:"column",alignItems:"center",
                justifyContent:"center",height:240,gap:10}}>
                <div style={{color:T.text2,fontSize:32,opacity:0.15}}>★</div>
                <span style={{color:T.text0,fontFamily:T.font,fontSize:13,fontWeight:700}}>
                  {search ? "No matches" : "Your watchlist is empty"}
                </span>
                {!search && (
                  <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:6,
                    background:T.bg2,border:`1px solid ${T.border}`,borderRadius:8,
                    padding:"12px 20px",maxWidth:320,textAlign:"center"}}>
                    <span style={{color:T.text2,fontFamily:T.font,fontSize:10,lineHeight:1.6}}>
                      Type a ticker above and click <span style={{color:T.cyan,fontWeight:700}}>+ ADD</span>
                      <br/>— or —<br/>
                      Click <span style={{color:T.gold,fontWeight:700}}>★</span> on any row in the Live Table
                    </span>
                    <span style={{color:T.green,fontFamily:T.font,fontSize:9,marginTop:2}}>
                      ⚡ Adding a ticker starts signal engine calculations immediately
                    </span>
                  </div>
                )}
              </div>
            ) : filtered.map((w,i)=>{
              const live      = getLive(w.symbol);
              const alert     = null; // Edgar alerts removed — no longer tracked
              const newsAlert = newsAlerts[w.symbol];
              const isSel     = selectedTick===w.symbol;
              const chg       = live?.change||0;
              return (
                <div key={w.symbol} className="nx-row"
                  onClick={()=>{ setSelectedTick(w.symbol);
                    setSelectedRow({...w,...live}); }}
                  style={{display:"grid",gridTemplateColumns:COL,
                    padding:"0 14px",borderBottom:`1px solid ${T.border}`,
                    background:isSel?T.cyanDim:i%2===0?"transparent":T.bg3+"40",
                    borderLeft:`2px solid ${
                      isSel?T.cyan:newsAlert?T.gold:alert?T.orange:"transparent"}`,
                    transition:"all 0.1s",
                    animation:`fadeIn 0.12s ${Math.min(i*0.015,0.3)}s both`}}>

                  <div style={{padding:"9px 4px"}}>
                    <div style={{display:"flex",alignItems:"center",gap:4}}>
                      <span style={{color:T.cyan,fontSize:11,fontFamily:T.font,
                        fontWeight:800}}>{w.symbol}</span>
                      <span style={{color:T.green,fontSize:7,opacity:0.7}}>⚡</span>
                    </div>
                    <EdgarBadge alert={alert} T={T}/>
                    <NewsBadge alert={newsAlert} T={T}/>
                    <div style={{display:"flex",gap:2,flexWrap:"wrap",marginTop:2}}>
                      {w.tags?.slice(0,2).map(tag=>(
                        <span key={tag} style={{background:T.bg4,color:T.text2,
                          borderRadius:3,padding:"1px 4px",fontSize:7,
                          fontFamily:T.font}}>{tag}</span>
                      ))}
                    </div>
                  </div>

                  <div style={{padding:"9px 4px",color:T.text2,fontSize:9,
                    fontFamily:T.font,overflow:"hidden",textOverflow:"ellipsis",
                    whiteSpace:"nowrap",display:"flex",alignItems:"center"}}>
                    {w.companyName}
                  </div>

                  <div style={{padding:"9px 4px",display:"flex",alignItems:"center"}}>
                    {live?.price!=null
                      ? <span style={{color:T.text0,fontSize:11,fontFamily:T.font,
                          fontWeight:700}}>${fmt2(live.price)}</span>
                      : <Shimmer w={50} h={10} T={T}/>}
                  </div>

                  <div style={{padding:"9px 4px",display:"flex",alignItems:"center"}}>
                    {live?.change!=null
                      ? <span style={{color:chg>=0?T.green:T.red,
                          fontFamily:T.font,fontSize:10,fontWeight:600}}>
                          {chg>=0?"▲":"▼"}{fmt2(Math.abs(chg))}
                          <br/>
                          <span style={{fontSize:9}}>
                            ({fmt2(Math.abs(live.changePct))}%)
                          </span>
                        </span>
                      : <Shimmer w={40} h={10} T={T}/>}
                  </div>

                  <div style={{padding:"9px 4px",color:T.text1,fontSize:10,
                    fontFamily:T.font,display:"flex",alignItems:"center"}}>
                    {live?.volume?fmtVol(live.volume):"—"}
                  </div>

                  <div style={{padding:"9px 4px",display:"flex",alignItems:"center"}}>
                    <RangeBar price={live?.price}
                      high={live?.high} low={live?.low} T={T}/>
                  </div>

                  <div style={{padding:"9px 4px",display:"flex",alignItems:"center"}}>
                    <button onClick={e=>{e.stopPropagation();
                      removeFromWatchlist(w.symbol);}}
                      style={{background:"none",border:"none",
                        color:T.text2+"50",cursor:"pointer",
                        fontSize:14,lineHeight:1,transition:"all 0.15s"}}
                      onMouseEnter={e=>e.currentTarget.style.color=T.red}
                      onMouseLeave={e=>e.currentTarget.style.color=T.text2+"50"}>✕</button>
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{padding:"5px 14px",borderTop:`1px solid ${T.border}`,
            display:"flex",justifyContent:"space-between",
            background:T.bg0,flexShrink:0}}>
            <span style={{color:T.text2,fontSize:8.5,fontFamily:T.font}}>
              {filtered.length} stocks · SSE live feed
            </span>
            <span style={{color:T.text2,fontSize:8,fontFamily:T.font}}>
              NexRadar SSE · Live ●
            </span>
          </div>
        </div>

        {/* RIGHT — AgenticPanel */}
        <div style={{width:320,flexShrink:0,display:"flex",
          flexDirection:"column",background:T.bg1,overflow:"hidden"}}>
          <AgenticPanel
            ticker={selectedTick}
            rowHint={selectedRow}
            context="watchlist"
            onNavigateToSettings={onNavigateToSettings}
            T={T}
          />
        </div>
      </div>

      {/* Floating news toast — auto push */}
      <NewsToast toast={toast} onDismiss={()=>setToast(null)} T={T}/>
    </div>
  );
}
