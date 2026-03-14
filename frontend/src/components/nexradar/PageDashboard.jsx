// PageDashboard.jsx — NexRadar Pro
// Market Breadth, Scalp Signals alert feed, Top Gainers/Losers, Earnings Today

import { useState, useEffect } from "react";
import { API_BASE } from "../../config.js";
import { SECTORS } from "./constants.js";
import { pct, normalizeSector } from "./utils.js";
import { SectionHeader, Shimmer, EmptyState } from "./primitives.jsx";
import { normalizeEarningsResponse } from "./normalizer.js";

export default function PageDashboard({ onNavigate, onSectorChange, selectedSectors, sectorPerformance = {}, tickers, techData = [], techLoading = false, T }) {
  const sectorTiles = SECTORS.filter(s => s.id !== "ALL");
  const [earnings,        setEarnings]        = useState([]);
  const [earningsLoading, setEarningsLoading] = useState(true);
  const [watchlist,       setWatchlist]       = useState(new Set());
  const [breadthTimeframe, setBreadthTimeframe] = useState("1D");
  const [scalpFilter,     setScalpFilter]     = useState("ALL");

  useEffect(() => {
    fetch(`${API_BASE}/api/watchlist`)
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(data => setWatchlist(new Set(data.watchlist ?? [])))
      .catch(() => {});

    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    fetch(`${API_BASE}/api/earnings?start=${today}&end=${today}`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(data => { setEarnings(normalizeEarningsResponse(data)); setEarningsLoading(false); })
      .catch(() => { setEarnings([]); setEarningsLoading(false); });
  }, []);

  const fmt2 = n => Number(n || 0).toFixed(2);

  return (
    <div className="page-enter" style={{ display:"flex", flexDirection:"column", gap:18 }}>

      {/* Market Breadth + Scalp Signals */}
      <div style={{ display:"flex", gap:18, flexWrap:"wrap", alignItems:"stretch" }}>

        {/* Market Breadth card */}
        <div className="card card-glow" style={{ flex:2, minWidth:340 }}>
          <SectionHeader title="Market Breadth" T={T}>
            {["1D","1W"].map(tf => (
              <button key={tf} className="btn-ghost" style={{ fontSize:9, background:breadthTimeframe===tf?T.cyan+"20":"transparent", color:breadthTimeframe===tf?T.cyan:T.text2 }} onClick={() => setBreadthTimeframe(tf)}>{tf}</button>
            ))}
          </SectionHeader>
          <div style={{ padding:14, display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(115px,1fr))", gap:8 }}>
            {sectorTiles.map(s => {
              const active = selectedSectors.includes(s.id);
              const perf = sectorPerformance[s.id] || { avgReturn:0, count:0, gainers:0, losers:0 };
              const isPositive = perf.avgReturn >= 0;
              const hasData = perf.count > 0;
              return (
                <div key={s.id}
                  onClick={() => { if (active && s.id !== "ALL") { onSectorChange(["ALL"]); } else { onSectorChange([s.id]); onNavigate("live"); } }}
                  style={{ background:active?s.color+"12":T.bg2, borderLeft:`1px solid ${active?s.color+"40":T.border}`, borderRight:`1px solid ${active?s.color+"40":T.border}`, borderBottom:`1px solid ${active?s.color+"40":T.border}`, borderTop:s.id==="EARNINGS"?`2px solid ${T.gold}50`:`1px solid ${active?s.color+"40":T.border}`, borderRadius:10, padding:"14px 16px", cursor:"pointer", transition:"all 0.2s ease" }}
                  onMouseEnter={e=>{ e.currentTarget.style.background=s.color+"0e"; }}
                  onMouseLeave={e=>{ e.currentTarget.style.background=active?s.color+"12":T.bg2; }}>
                  <div style={{ color:s.color, fontSize:11, letterSpacing:0.8, fontFamily:T.font, marginBottom:10, opacity:0.9, fontWeight:700 }}>
                    {s.id==="EARNINGS"?"◎ ":""}{s.label}
                  </div>
                  {s.id === "EARNINGS" ? (() => {
                    const earningsSet = new Set(earnings.map(e => e.ticker));
                    const earningsStocks = Array.from(tickers.values()).filter(t => t.is_earnings_gap_play || earningsSet.has(t.ticker));
                    if (earningsStocks.length === 0) return <div style={{ fontFamily:T.font, fontSize:24, fontWeight:800, color:T.text2, marginBottom:8 }}>—%</div>;
                    const avg = earningsStocks.reduce((s,t) => s+(t.percent_change||0), 0) / earningsStocks.length;
                    const gainers = earningsStocks.filter(t=>(t.percent_change||0)>0).length;
                    const losers  = earningsStocks.filter(t=>(t.percent_change||0)<0).length;
                    return (<><div style={{ fontFamily:T.font, fontSize:24, fontWeight:800, color:avg>=0?T.green:T.red, marginBottom:8 }}>{pct(avg)}</div><div style={{ color:T.text2, fontSize:11, fontFamily:T.font, display:"flex", justifyContent:"space-between" }}><span>{earningsStocks.length} stocks</span><span><span style={{ color:T.green }}>{gainers}↑</span> <span style={{ color:T.red }}>{losers}↓</span></span></div></>);
                  })() : hasData ? (
                    <><div style={{ fontFamily:T.font, fontSize:24, fontWeight:800, color:isPositive?T.green:T.red, marginBottom:8 }}>{pct(perf.avgReturn)}</div><div style={{ color:T.text2, fontSize:11, fontFamily:T.font, display:"flex", justifyContent:"space-between" }}><span>{perf.count} stocks</span><span><span style={{ color:T.green }}>{perf.gainers}↑</span> <span style={{ color:T.red }}>{perf.losers}↓</span></span></div></>
                  ) : (
                    <div style={{ fontFamily:T.font, fontSize:24, fontWeight:800, color:T.text2, marginBottom:8 }}>—%</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Scalp Signals */}
        <div className="card" style={{ flex:1, minWidth:200, display:"flex", flexDirection:"column" }}>
          <SectionHeader title="Scalp Signals" T={T}>
            {[{ key:"ALL",label:"ALL",color:T.cyan },{ key:"LONG",label:"LONG",color:T.green },{ key:"SHORT",label:"SHORT",color:T.red },{ key:"INST",label:"🐋 INST",color:T.purple }].map(f => (
              <button key={f.key} className="btn-ghost" style={{ fontSize:9, padding:"4px 8px", background:scalpFilter===f.key?f.color+"20":"transparent", color:scalpFilter===f.key?f.color:T.text2, border:`1px solid ${scalpFilter===f.key?f.color+"40":T.border}` }} onClick={() => setScalpFilter(f.key)}>{f.label}</button>
            ))}
          </SectionHeader>
          <div style={{ padding:"8px 0", flex:1, overflowY:"auto", maxHeight:320 }}>
            {(() => {
              const alerts = [];
              techData.forEach(row => {
                const isAccum = row.inst_footprint?.includes("Accumulation");
                const isDist  = row.inst_footprint?.includes("Distribution");
                const isInst  = isAccum || isDist;
                const highRvol  = (row.rvol ?? 0) >= 2.0;
                const highScore = Math.abs(row.score ?? 0) >= 3;
                const bbAlert   = row.bb_status?.includes("Overextended");
                if (!isInst && !highRvol && !highScore && !bbAlert) return;
                const isBullish = row.score > 0 || isAccum || row.trend === "Bullish" || row.rsi_signal === "Oversold";
                const isBearish = row.score < 0 || isDist  || row.trend === "Bearish" || row.rsi_signal === "Overbought";
                const direction = isBullish && !isBearish ? "LONG" : isBearish && !isBullish ? "SHORT" : row.score >= 0 ? "LONG" : "SHORT";
                const tags = [];
                if (isInst) tags.push({ label:isAccum?"🐋 ACCUM":"🔻 DIST", color:isAccum?T.purple:T.orange, priority:1 });
                if (highRvol) tags.push({ label:`⚡ ${row.rvol?.toFixed(1)}x VOL`, color:T.gold, priority:2 });
                if (highScore) tags.push({ label:`◈ ${row.score>0?"+":""}${row.score} SCORE`, color:row.score>=3?T.green:T.red, priority:3 });
                if (bbAlert) tags.push({ label:"⚠ BB EXT", color:T.orange, priority:4 });
                alerts.push({ ticker:row.ticker, price:row.price, direction, isInst, tags, score:row.score??0, rvol:row.rvol??0, priority:Math.min(...tags.map(t=>t.priority)) });
              });
              alerts.sort((a,b) => a.priority!==b.priority?a.priority-b.priority:b.rvol!==a.rvol?b.rvol-a.rvol:Math.abs(b.score)-Math.abs(a.score));
              let filtered = alerts;
              if (scalpFilter==="LONG")  filtered = alerts.filter(a=>a.direction==="LONG");
              if (scalpFilter==="SHORT") filtered = alerts.filter(a=>a.direction==="SHORT");
              if (scalpFilter==="INST")  filtered = alerts.filter(a=>a.isInst);
              const visible = filtered.slice(0, 8);
              if (techLoading && alerts.length === 0) return Array(4).fill(0).map((_,i)=>(<div key={i} style={{ padding:"10px 14px", display:"flex", justifyContent:"space-between", borderBottom:`1px solid ${T.border}` }}><Shimmer w={50} h={11}/><Shimmer w={80} h={11} opacity={0.5}/></div>));
              if (visible.length === 0) return <EmptyState icon="◉" label="NO ACTIVE ALERTS" sub={techData.length===0?"Tech analysis loading…":scalpFilter==="INST"?"No institutional activity detected":"No RVOL spikes or score extremes"} h={140} T={T}/>;
              return visible.map((a,i) => {
                const isLong = a.direction==="LONG";
                const dirColor = isLong?T.green:T.red;
                const topTag = a.tags[0];
                return (
                  <div key={a.ticker} style={{ display:"grid", gridTemplateColumns:"1fr auto auto", alignItems:"center", padding:"9px 14px", borderBottom:i<visible.length-1?`1px solid ${T.border}`:"none", gap:8 }}
                    onMouseEnter={e=>e.currentTarget.style.background=T.bg2} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                    <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
                      <span style={{ color:T.text0, fontSize:12, fontFamily:T.font, fontWeight:700 }}>{a.ticker}</span>
                      <span style={{ color:topTag.color, fontSize:9, fontFamily:T.font, fontWeight:600, background:topTag.color+"18", padding:"1px 6px", borderRadius:3, width:"fit-content" }}>{topTag.label}</span>
                    </div>
                    <span style={{ color:dirColor, fontSize:9, fontFamily:T.font, fontWeight:700, padding:"2px 6px", borderRadius:4, background:dirColor+"18" }}>{isLong?"▲ LONG":"▼ SHORT"}</span>
                    <span style={{ color:T.text0, fontSize:11, fontFamily:T.fontMono||T.font, fontWeight:600, minWidth:52, textAlign:"right" }}>{a.price?`$${Number(a.price).toFixed(2)}`:"—"}</span>
                  </div>
                );
              });
            })()}
          </div>
          {techData.length > 0 && (
            <div style={{ padding:"6px 14px", borderTop:`1px solid ${T.border}`, display:"flex", justifyContent:"space-between", flexShrink:0 }}>
              <span style={{ color:T.text3, fontSize:8.5, fontFamily:T.font }}>{techData.filter(r=>r.inst_footprint?.includes("Accumulation")||r.inst_footprint?.includes("Distribution")||(r.rvol??0)>=2.0||Math.abs(r.score??0)>=3).length} active alerts · {techData.length} tickers</span>
              <span style={{ color:T.text3, fontSize:8.5, fontFamily:T.font }}>TA · 5m TTL</span>
            </div>
          )}
        </div>
      </div>

      {/* Gainers / Losers / Earnings Today */}
      <div style={{ display:"flex", gap:18, flexWrap:"wrap" }}>
        {/* Top Gainers */}
        <div className="card" style={{ flex:1, minWidth:200, alignSelf:"flex-start" }}>
          <SectionHeader title={selectedSectors.includes("ALL")?"Top Gainers":`Top Gainers · ${selectedSectors.join(" + ")}`} T={T}>
            <button className="btn-ghost" style={{ fontSize:8 }} onClick={() => onNavigate("live")}>VIEW ALL</button>
          </SectionHeader>
          <div style={{ padding:"8px 14px" }}>
            {(() => {
              let all = Array.from(tickers.values());
              if (!selectedSectors.includes("ALL")) all = all.filter(t => selectedSectors.some(s => normalizeSector(t.sector) === s));
              const top = all.filter(t=>(t.percent_change||0)>0).sort((a,b)=>b.percent_change-a.percent_change).slice(0,5);
              if (top.length===0) return Array(5).fill(0).map((_,i)=>(<div key={i} style={{ display:"flex", justifyContent:"space-between", padding:"10px 0", borderBottom:i<4?`1px solid ${T.border}`:"none" }}><Shimmer w={44} h={11}/><Shimmer w={55} h={11} opacity={0.5}/></div>));
              return top.map((t,i)=>(<div key={i} style={{ display:"flex", justifyContent:"space-between", padding:"10px 0", borderBottom:i<4?`1px solid ${T.border}`:"none" }}><span style={{ color:T.text0, fontSize:12, fontFamily:T.font, fontWeight:700 }}>{t.ticker}</span><span style={{ color:T.green, fontSize:12, fontFamily:T.font, fontWeight:700 }}>{pct(t.percent_change)}</span></div>));
            })()}
          </div>
        </div>

        {/* Top Losers */}
        <div className="card" style={{ flex:1, minWidth:200, alignSelf:"flex-start" }}>
          <SectionHeader title={selectedSectors.includes("ALL")?"Top Losers":`Top Losers · ${selectedSectors.join(" + ")}`} T={T}>
            <button className="btn-ghost" style={{ fontSize:8 }} onClick={() => onNavigate("live")}>VIEW ALL</button>
          </SectionHeader>
          <div style={{ padding:"8px 14px" }}>
            {(() => {
              let all = Array.from(tickers.values());
              if (!selectedSectors.includes("ALL")) all = all.filter(t => selectedSectors.some(s => normalizeSector(t.sector) === s));
              const top = all.filter(t=>(t.percent_change||0)<0).sort((a,b)=>a.percent_change-b.percent_change).slice(0,5);
              if (top.length===0) return Array(5).fill(0).map((_,i)=>(<div key={i} style={{ display:"flex", justifyContent:"space-between", padding:"10px 0", borderBottom:i<4?`1px solid ${T.border}`:"none" }}><Shimmer w={44} h={11}/><Shimmer w={55} h={11} opacity={0.5}/></div>));
              return top.map((t,i)=>(<div key={i} style={{ display:"flex", justifyContent:"space-between", padding:"10px 0", borderBottom:i<4?`1px solid ${T.border}`:"none" }}><span style={{ color:T.text0, fontSize:12, fontFamily:T.font, fontWeight:700 }}>{t.ticker}</span><span style={{ color:T.red, fontSize:12, fontFamily:T.font, fontWeight:700 }}>{pct(t.percent_change)}</span></div>));
            })()}
          </div>
        </div>

        {/* Earnings Today */}
        <div className="card" style={{ flex:1, minWidth:280 }}>
          <SectionHeader title="Earnings Today" T={T}>
            <button className="btn-ghost" style={{ fontSize:8 }} onClick={() => onNavigate("earnings")}>VIEW ALL</button>
          </SectionHeader>
          <div style={{ padding:"8px 14px" }}>
            {earningsLoading ? (
              Array(5).fill(0).map((_,i)=>(<div key={i} style={{ display:"flex", justifyContent:"space-between", padding:"10px 0", borderBottom:i<4?`1px solid ${T.border}`:"none" }}><Shimmer w={44} h={11}/><Shimmer w={55} h={11} opacity={0.5}/></div>))
            ) : (() => {
              const today = new Date();
              const todayStr = today.toLocaleDateString('en-US',{month:'short',day:'numeric'});
              const timeOrder = { 'BMO':1,'AMC':2,'TNS':3 };
              const todayEarnings = [...earnings].sort((a,b) => {
                const aW=watchlist.has(a.ticker), bW=watchlist.has(b.ticker);
                if (aW && !bW) return -1; if (!aW && bW) return 1;
                return (timeOrder[a.time]||999)-(timeOrder[b.time]||999);
              }).slice(0,10);
              if (todayEarnings.length===0) return <EmptyState icon="◎" label="NO EARNINGS TODAY" sub="Check back tomorrow" h={160} T={T}/>;
              return (
                <div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 0.8fr 0.6fr 0.8fr", gap:8, padding:"8px 0", borderBottom:`2px solid ${T.border}`, fontSize:9, fontFamily:T.font, fontWeight:700, color:T.text2, textTransform:"uppercase" }}>
                    <span>SYMBOL</span><span>DATE</span><span>TIME</span><span>PRICE</span>
                  </div>
                  {todayEarnings.map((e,i) => {
                    const ticker = tickers.get(e.ticker);
                    const livePrice = ticker?.live_price || 0;
                    const isWL = watchlist.has(e.ticker);
                    return (
                      <div key={i} style={{ display:"grid", gridTemplateColumns:"1fr 0.8fr 0.6fr 0.8fr", gap:8, alignItems:"center", padding:"10px 0", borderBottom:i<todayEarnings.length-1?`1px solid ${T.border}`:"none", background:isWL?T.cyan+"08":"transparent" }}>
                        <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                          {isWL && <span style={{ color:T.cyan, fontSize:14 }}>★</span>}
                          <a href={`https://finance.yahoo.com/quote/${e.ticker}`} target="_blank" rel="noopener noreferrer" style={{ color:T.text0, fontSize:12, fontFamily:T.font, fontWeight:400, textDecoration:"none" }} onMouseEnter={ev=>ev.currentTarget.style.color=T.cyan} onMouseLeave={ev=>ev.currentTarget.style.color=T.text0}>{e.ticker}</a>
                        </div>
                        <span style={{ color:T.text2, fontSize:11, fontFamily:T.font }}>{todayStr}</span>
                        <span style={{ color:e.time==='BMO'?T.gold:e.time==='AMC'?T.purple:T.text2, fontSize:10, fontFamily:T.font }}>{e.time}</span>
                        <span style={{ color:T.cyan, fontSize:11, fontFamily:T.font }}>${livePrice.toFixed(2)}</span>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        </div>
      </div>
    </div>
  );
}