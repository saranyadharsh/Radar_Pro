// ═══════════════════════════════════════════════════════════════
// NexRadarWatchlist.jsx — REBUILT
// Engine 1: DataEngine (FREE · AUTO)
//   Polygon WebSocket → live prices every 15ms
//   Polygon REST      → snapshot on click 300ms
//   EDGAR Watcher     → 8-K polling every 60s
// Engine 2: AIEngine (COST · MANUAL)
//   Toggle OFF → data only, $0 per click
//   Toggle ON  → 3 agents fire on click, ~$0.026
// ═══════════════════════════════════════════════════════════════

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { fmt2, fmtVol } from "./utils.js";
import AgenticPanel, { Shimmer } from "./AgenticPanel.jsx";
import DataEngine from "../engines/DataEngine.js";
import AIEngine   from "../engines/AIEngine.js";

const DEFAULT_WATCHLIST = [
  { symbol:"AAPL",  companyName:"Apple Inc",              sector:"Technology", tags:["MEGA_CAP","EARNINGS_SOON"] },
  { symbol:"NVDA",  companyName:"NVIDIA Corporation",     sector:"Technology", tags:["MOMENTUM","AI"] },
  { symbol:"CHTR",  companyName:"Charter Communications", sector:"Telecom",    tags:["DEAL","COX_ACQ"] },
  { symbol:"MSFT",  companyName:"Microsoft Corporation",  sector:"Technology", tags:["MEGA_CAP"] },
  { symbol:"TSLA",  companyName:"Tesla Inc",              sector:"Consumer",   tags:["VOLATILE"] },
  { symbol:"META",  companyName:"Meta Platforms",         sector:"Technology", tags:["AI","MOMENTUM"] },
  { symbol:"AMZN",  companyName:"Amazon.com Inc",         sector:"Consumer",   tags:["MEGA_CAP"] },
  { symbol:"JPM",   companyName:"JPMorgan Chase",         sector:"Financial",  tags:["DIVIDEND"] },
];

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

export default function PageWatchlist({ onNavigateToSettings, T }) {
  const [watchlist,    setWatchlist]    = useState(DEFAULT_WATCHLIST);
  const [selectedTick, setSelectedTick] = useState(null);
  const [selectedRow,  setSelectedRow]  = useState(null);
  const [livePrices,   setLivePrices]   = useState({});
  const [edgarAlerts,  setEdgarAlerts]  = useState({});
  const [search,       setSearch]       = useState("");
  const [addSymbol,    setAddSymbol]    = useState("");
  const [filterTag,    setFilterTag]    = useState("ALL");
  const [isSyncing,    setIsSyncing]    = useState(false);
  const [newsAlerts,   setNewsAlerts]   = useState({});  // symbol → latest news alert
  const [toast,        setToast]        = useState(null); // floating news toast
  const edgarRef  = useRef(null);
  const newsRef   = useRef(null);

  // DataEngine — WebSocket live prices (AUTO · PUSH · 15ms)
  useEffect(() => {
    const symbols = watchlist.map(w=>w.symbol);
    DataEngine.connectWebSocket(symbols, (update) => {
      setLivePrices(prev => ({
        ...prev,
        [update.symbol]: {
          ...prev[update.symbol],
          price:     update.price,
          open:      update.open,
          high:      update.high,
          low:       update.low,
          volume:    update.volume,
          vwap:      update.vwap,
          change:    update.price-(prev[update.symbol]?.prevClose||update.price),
          changePct: prev[update.symbol]?.prevClose
            ? ((update.price-prev[update.symbol].prevClose)/prev[update.symbol].prevClose*100):0,
        },
      }));
    });
    return () => DataEngine.disconnectWebSocket();
  }, [watchlist]);

  // DataEngine — REST initial load (AUTO · 300ms)
  const loadPrices = useCallback(async () => {
    setIsSyncing(true);
    await Promise.all(watchlist.map(async w => {
      const snap = await DataEngine.getSnapshot(w.symbol);
      if (snap) setLivePrices(prev => ({ ...prev, [w.symbol]: snap }));
    }));
    setIsSyncing(false);
  }, [watchlist]);
  useEffect(() => { loadPrices(); }, [watchlist]);

  // DataEngine — EDGAR polling (AUTO · 60s)
  const pollEdgar = useCallback(async () => {
    const symbols = watchlist.map(w=>w.symbol);
    const results = await DataEngine.pollEdgarForWatchlist(symbols);
    for (const [sym, result] of Object.entries(results)) {
      if (!result.newFiling) continue;
      const stockData = livePrices[sym]||{};
      if (AIEngine.isAIEnabled()) {
        const classified = await AIEngine.classifyEdgarFiling(sym, result, stockData);
        setEdgarAlerts(prev => ({...prev,[sym]:classified}));
      } else {
        setEdgarAlerts(prev => ({...prev,[sym]:{
          eventType: result.formType||"8-K",
          eventTitle:`New ${result.formType||"8-K"} filed`,
          impact:"NEUTRAL", impactScore:5,
          summary:`Filed: ${result.filedAt}. Enable AI for analysis.`,
          priceImpact:"Unknown", action:"WATCH", urgency:"MEDIUM",
        }}));
      }
    }
  }, [watchlist, livePrices]);

  useEffect(() => {
    edgarRef.current = setInterval(pollEdgar, 60000);
    return () => clearInterval(edgarRef.current);
  }, [pollEdgar]);

  // DataEngine — News push poll (AUTO · 120s)
  // Fires when a NEW headline appears for any watchlist stock
  useEffect(() => {
    const symbols = watchlist.map(w => w.symbol);
    newsRef.current = DataEngine.startNewsPoll(
      symbols,
      (alert) => {
        // Badge on the row
        setNewsAlerts(prev => ({ ...prev, [alert.symbol]: alert }));
        // Toast notification — auto-dismiss after 6s
        setToast(alert);
        setTimeout(() => setToast(t => t?.symbol===alert.symbol ? null : t), 6000);
      },
      120000 // every 2 minutes
    );
    return () => DataEngine.stopNewsPoll(newsRef.current);
  }, [watchlist]);

  const addToWatchlist = useCallback(() => {
    const sym = addSymbol.trim().toUpperCase();
    if (!sym||watchlist.find(w=>w.symbol===sym)) return;
    setWatchlist(prev=>[...prev,{symbol:sym,companyName:sym,sector:"—",tags:[]}]);
    setAddSymbol("");
  }, [addSymbol, watchlist]);

  const removeFromWatchlist = useCallback((sym) => {
    setWatchlist(prev=>prev.filter(w=>w.symbol!==sym));
    if (selectedTick===sym) { setSelectedTick(null); setSelectedRow(null); }
  }, [selectedTick]);

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
    const prices = Object.values(livePrices);
    return {
      total:   watchlist.length,
      gainers: prices.filter(p=>p.change>0).length,
      losers:  prices.filter(p=>p.change<0).length,
      alerts:  Object.keys(edgarAlerts).length,
      news:    Object.keys(newsAlerts).length,
    };
  }, [watchlist,livePrices,edgarAlerts,newsAlerts]);

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
          <button onClick={loadPrices} disabled={isSyncing}
            style={{background:T.bg2,border:`1px solid ${T.border}`,
              color:isSyncing?T.text2:T.text1,borderRadius:6,padding:"5px 12px",
              cursor:"pointer",fontFamily:T.font,fontSize:9,fontWeight:600,
              animation:isSyncing?"pulse 1s infinite":"none"}}>
            {isSyncing?"⟳ SYNCING…":"⟳ REFRESH"}
          </button>
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
                justifyContent:"center",height:200,gap:8}}>
                <div style={{color:T.text2,fontSize:24,opacity:0.2}}>★</div>
                <span style={{color:T.text2,fontFamily:T.font,fontSize:11}}>
                  {search?"No matches":"Add tickers to watchlist"}
                </span>
              </div>
            ) : filtered.map((w,i)=>{
              const live      = livePrices[w.symbol];
              const alert     = edgarAlerts[w.symbol];
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
                    <div style={{color:T.cyan,fontSize:11,fontFamily:T.font,
                      fontWeight:800}}>{w.symbol}</div>
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
              {filtered.length} stocks · EDGAR 60s · News 120s
            </span>
            <span style={{color:T.text2,fontSize:8,fontFamily:T.font}}>
              Polygon WebSocket · {isSyncing?"Syncing…":"Live ●"}
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
