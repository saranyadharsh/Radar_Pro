/**
 * NexRadarDashboard.jsx — v7.0 — COMPLETE DATA SOURCE FIX
 *
 * ALL DATA SOURCE SELECTIONS NOW WORK:
 *  ALL        → v_live_enriched (live_tickers JOIN stock_list) — sector included
 *  WATCHLIST  → filter allRows by monitorSet  (Set<ticker> from /api/monitor)
 *  PORTFOLIO  → filter allRows by portfolioSet (Set<ticker> from /api/portfolio)
 *
 * SECTOR FILTER FIX:
 *  Backend queries v_live_enriched view which JOINs stock_list.
 *  Every ticker row now carries sector — no client-side merge needed.
 *
 * Backend endpoints required:
 *   WS  /ws/live                    → snapshot + tick (rows must include sector)
 *   GET /api/monitor                → [{ticker,...}] from monitor table
 *   GET /api/portfolio              → [{ticker,shares,avg_cost,...,live_price}]
 *   GET /api/metrics                → engine alert counts
 *   GET /api/signals?limit=500      → scalping signals
 *   GET /api/earnings?start=&end=   → earnings calendar
 *
 * See fix_view.sql    → create v_live_enriched view in Supabase
 * See fix_backend.py  → FastAPI endpoint fixes
 */

import { useState, useEffect, useRef, useMemo, useCallback } from "react";

const API    = import.meta.env.VITE_API_BASE || "";
const WS_URL = import.meta.env.VITE_WS_URL  || "ws://localhost:8000/ws/live";

// ─── TOKENS ──────────────────────────────────────────────────────────────────
const DARK = {
  bg:"#030912",bg2:"#060f1e",panel:"#08111f",panel2:"#0c1828",panel3:"#0f1e30",
  line:"rgba(255,255,255,0.06)",line2:"rgba(255,255,255,0.11)",
  text:"#f1f5f9",muted:"#4a6080",muted2:"#2d4a6a",
};
const LIGHT = {
  bg:"#f0f4f8",bg2:"#e4ecf4",panel:"#ffffff",panel2:"#f1f5fb",panel3:"#e2eaf5",
  line:"rgba(0,0,0,0.07)",line2:"rgba(0,0,0,0.12)",
  text:"#0f1e30",muted:"#6b82a0",muted2:"#8fa4bf",
};
const C = {
  amber:"#f59e0b",amber2:"#fbbf24",
  cyan:"#22d3ee",cyan2:"#67e8f9",
  green:"#10b981",green2:"#34d399",
  red:"#ef4444",red2:"#f87171",
  violet:"#8b5cf6",blue:"#3b82f6",
};

const clr  = n => n >= 0 ? C.green2 : C.red2;
const pct  = n => `${n>=0?"+":""}${Number(n||0).toFixed(2)}%`;
const nowT = () => new Date().toLocaleTimeString("en-US",{hour12:false});
const fmt2 = n => Number(n||0).toFixed(2);
const fmtK = n => n>=1e9?`$${(n/1e9).toFixed(1)}B`:n>=1e6?`$${(n/1e6).toFixed(0)}M`:n?`$${n}`:"—";

const SECTOR_LIST = ["TECHNOLOGY","CONSUMER","BANKING","BIO","BM & UENE","REALCOM","INDUSTRIALS"];

// ─── MINI CANDLE CHART ───────────────────────────────────────────────────────
function CandleChart({ symbol }) {
  const seed = (symbol?.charCodeAt(0)||78)+(symbol?.charCodeAt(1)||86);
  const candles = useMemo(()=>Array.from({length:40},(_,i)=>{
    const base=100+Math.sin((i+seed)*0.3)*20+i*0.5;
    const o=base+(Math.random()-0.5)*8,c=base+(Math.random()-0.5)*8+1;
    return{o,c,h:Math.max(o,c)+Math.random()*4,l:Math.min(o,c)-Math.random()*4,vol:30+Math.random()*50};
  }),[symbol]);
  const allV=candles.flatMap(c=>[c.h,c.l]);
  const minV=Math.min(...allV),maxV=Math.max(...allV),rng=maxV-minV||1;
  const W=460,H=150,VH=36,cw=W/candles.length;
  const sy=v=>H-((v-minV)/rng)*(H-8)-4;
  const maxVol=Math.max(...candles.map(c=>c.vol));
  const vwap=candles.map((c,i)=>`${i===0?"M":"L"}${i*cw+cw/2},${sy(minV+rng*(0.45+Math.sin(i*0.15)*0.08))}`).join(" ");
  const ema=candles.map((c,i)=>`${i===0?"M":"L"}${i*cw+cw/2},${sy(minV+rng*(0.5+Math.sin(i*0.2+1)*0.1))}`).join(" ");
  return(
    <svg width="100%" viewBox={`0 0 ${W} ${H+VH+8}`} preserveAspectRatio="none"
      style={{position:"absolute",inset:0,width:"100%",height:"100%"}}>
      {[0.25,0.5,0.75].map(f=><line key={f} x1={0} y1={sy(minV+rng*f)} x2={W} y2={sy(minV+rng*f)} stroke="rgba(255,255,255,0.05)" strokeWidth="1"/>)}
      <path d={vwap} fill="none" stroke={C.amber} strokeWidth="1.2" strokeDasharray="4,3" opacity="0.7"/>
      <path d={ema}  fill="none" stroke={C.violet} strokeWidth="1"   opacity="0.6"/>
      {candles.map((c,i)=>{
        const x=i*cw+cw*0.2,bw=cw*0.6,bull=c.c>=c.o;
        const top=sy(Math.max(c.o,c.c)),bot=sy(Math.min(c.o,c.c)),bh=Math.max(bot-top,1);
        return(<g key={i}>
          <line x1={x+bw/2} y1={sy(c.h)} x2={x+bw/2} y2={sy(c.l)} stroke={bull?C.green:C.red} strokeWidth="0.8"/>
          <rect x={x} y={top} width={bw} height={bh} rx="0.5" fill={bull?C.green:C.red} opacity={bull?0.75:0.7}/>
        </g>);
      })}
      {candles.map((c,i)=>{
        const x=i*cw+cw*0.2,bw=cw*0.6,bull=c.c>=c.o,bh=(c.vol/maxVol)*VH;
        return<rect key={`v${i}`} x={x} y={H+8+(VH-bh)} width={bw} height={bh} fill={bull?C.green:C.red} opacity="0.3"/>;
      })}
      <rect x={2} y={2} width={6} height={3} fill={C.amber}/>
      <text x={12} y={7} fontSize="7" fill={C.amber} opacity="0.8">VWAP</text>
      <rect x={46} y={2} width={6} height={3} fill={C.violet}/>
      <text x={56} y={7} fontSize="7" fill={C.violet} opacity="0.8">EMA21</text>
    </svg>
  );
}

// ─── SECTOR HEATMAP TILE ─────────────────────────────────────────────────────
function HeatTile({s,T,active,onClick}){
  const intensity=Math.min(Math.abs(s.chgP)/4,1);
  const isPos=s.chgP>=0;
  const bg=active?(isPos?`rgba(16,185,129,0.2)`:`rgba(239,68,68,0.2)`):(isPos?`rgba(16,185,129,${0.04+intensity*0.14})`:`rgba(239,68,68,${0.04+intensity*0.14})`);
  const brd=active?(isPos?C.green2:C.red2):(isPos?`rgba(16,185,129,${0.15+intensity*0.3})`:`rgba(239,68,68,${0.15+intensity*0.3})`);
  return(
    <div onClick={onClick}
      style={{background:bg,border:`1px solid ${brd}`,borderRadius:8,padding:"7px 10px",cursor:"pointer",
              transition:"transform 0.12s",position:"relative",overflow:"hidden",
              boxShadow:active?`0 0 8px ${isPos?C.green:C.red}44`:""}}
      onMouseEnter={e=>e.currentTarget.style.transform="scale(1.04)"}
      onMouseLeave={e=>e.currentTarget.style.transform="scale(1)"}>
      <div style={{fontSize:8,color:T.muted,letterSpacing:".1em",textTransform:"uppercase",marginBottom:1}}>{s.name}</div>
      <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:19,fontWeight:700,color:clr(s.chgP),lineHeight:1}}>{pct(s.chgP)}</div>
      <div style={{marginTop:4,height:2,background:T.panel3,borderRadius:2,overflow:"hidden"}}>
        <div style={{height:"100%",width:`${Math.min(Math.abs(s.chgP)/5*100,100)}%`,background:isPos?C.green:C.red,borderRadius:2}}/>
      </div>
      <div style={{display:"flex",justifyContent:"space-between",marginTop:3,fontSize:7,color:T.muted}}>
        <span>{s.count} stks</span>
        <span><span style={{color:C.green2}}>{s.gainers}↑</span> <span style={{color:C.red2}}>{s.losers}↓</span></span>
      </div>
      <div style={{position:"absolute",bottom:0,left:0,right:0,height:2,background:isPos?C.green:C.red,opacity:0.5}}/>
    </div>
  );
}

// ─── SIGNALS PAGE ─────────────────────────────────────────────────────────────
function SignalsPage({signals,T,onSelect}){
  const[filter,setFilter]=useState("ALL");
  const[search,setSearch]=useState("");
  const rows=useMemo(()=>{
    let s=filter==="ALL"?signals:signals.filter(x=>x.direction===filter);
    if(search)s=s.filter(x=>x.symbol?.toUpperCase().includes(search.toUpperCase()));
    return s;
  },[signals,filter,search]);
  const Btn=({active,label,onClick})=>(
    <button onClick={onClick} style={{background:active?C.amber:"transparent",color:active?"#000":T.muted,
      border:`1px solid ${active?C.amber:T.line2}`,borderRadius:4,padding:"3px 10px",fontSize:9,
      fontFamily:"'Rajdhani',sans-serif",fontWeight:700,cursor:"pointer",letterSpacing:".08em"}}>
      {label}</button>
  );
  return(
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{padding:"10px 14px",borderBottom:`1px solid ${T.line2}`,display:"flex",gap:8,alignItems:"center"}}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search symbol…"
          style={{background:T.panel2,border:`1px solid ${T.line2}`,borderRadius:5,padding:"4px 8px",
                  color:T.text,fontSize:10,outline:"none",width:150,fontFamily:"inherit"}}/>
        <div style={{display:"flex",gap:4}}>
          {["ALL","LONG","SHORT"].map(f=><Btn key={f} active={filter===f} label={f} onClick={()=>setFilter(f)}/>)}
        </div>
        <span style={{fontSize:9,color:T.muted,marginLeft:"auto"}}>{rows.length} signals</span>
      </div>
      <div style={{flex:1,overflowY:"auto"}}>
        {rows.length===0?(
          <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:200,color:T.muted,fontSize:11}}>
            No signals{filter!=="ALL"?` for ${filter}`:""}</div>
        ):(
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead style={{position:"sticky",top:0,background:T.panel2,zIndex:2}}>
              <tr>{["SYMBOL","DIR","ENTRY","STOP","TARGET","R:R","SCORE","CONF","STRENGTH","TIME"].map(h=>(
                <th key={h} style={{padding:"6px 10px",textAlign:"left",fontSize:9,color:T.muted,
                  letterSpacing:".08em",textTransform:"uppercase",borderBottom:`1px solid ${T.line}`,fontWeight:600,whiteSpace:"nowrap"}}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {rows.map((s,i)=>(
                <tr key={i} onClick={()=>onSelect(s.symbol)}
                  style={{cursor:"pointer",borderBottom:`1px solid ${T.line}`}}
                  onMouseEnter={e=>e.currentTarget.style.background=T.panel2}
                  onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                  <td style={{padding:"6px 10px"}}>
                    <span style={{fontFamily:"'Rajdhani',sans-serif",fontWeight:700,fontSize:13}}>{s.symbol}</span>
                  </td>
                  <td style={{padding:"6px 10px"}}>
                    <span style={{background:s.direction==="LONG"?`rgba(16,185,129,0.15)`:`rgba(239,68,68,0.15)`,
                      color:s.direction==="LONG"?C.green2:C.red2,padding:"2px 7px",borderRadius:3,fontSize:9,fontWeight:700}}>
                      {s.direction}</span>
                  </td>
                  <td style={{padding:"6px 10px",color:T.text,fontSize:11}}>${fmt2(s.entry_price)}</td>
                  <td style={{padding:"6px 10px",color:C.red2,fontSize:11}}>${fmt2(s.stop_loss)}</td>
                  <td style={{padding:"6px 10px",color:C.green2,fontSize:11}}>${fmt2(s.take_profit)}</td>
                  <td style={{padding:"6px 10px",color:C.amber,fontSize:11}}>{fmt2(s.risk_reward)}x</td>
                  <td style={{padding:"6px 10px",color:C.amber2,fontSize:11,fontWeight:700}}>{s.score}</td>
                  <td style={{padding:"6px 10px",color:C.violet,fontSize:11}}>{s.confidence}%</td>
                  <td style={{padding:"6px 10px",fontSize:9,color:s.strength==="STRONG"?C.green2:s.strength==="MODERATE"?C.amber:T.muted,fontWeight:600}}>
                    {s.strength||"—"}</td>
                  <td style={{padding:"6px 10px",color:T.muted,fontSize:9}}>
                    {s.created_at?new Date(s.created_at).toLocaleTimeString("en-US",{hour12:false,hour:"2-digit",minute:"2-digit"}):"—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─── EARNINGS PAGE ────────────────────────────────────────────────────────────
function EarningsPage({earnings,tickers,T,onSelect}){
  const grouped=useMemo(()=>{
    const map={};
    for(const e of earnings){const d=e.earnings_date;if(!map[d])map[d]=[];map[d].push(e);}
    return Object.entries(map).sort(([a],[b])=>a.localeCompare(b));
  },[earnings]);
  return(
    <div style={{flex:1,overflowY:"auto",padding:"12px 16px"}}>
      {grouped.length===0?(
        <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:200,color:T.muted,fontSize:11}}>
          No upcoming earnings in next 7 days</div>
      ):grouped.map(([date,rows])=>(
        <div key={date} style={{marginBottom:20}}>
          <div style={{fontSize:10,color:C.amber,letterSpacing:".12em",textTransform:"uppercase",
            fontFamily:"'Rajdhani',sans-serif",fontWeight:700,
            borderBottom:`1px solid ${T.line2}`,paddingBottom:4,marginBottom:8}}>
            {new Date(date+"T12:00:00").toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric"})}
            <span style={{marginLeft:8,color:T.muted,fontSize:9}}>{rows.length} companies</span>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:6}}>
            {rows.map((e,i)=>{
              const live=tickers.get(e.ticker);
              return(
                <div key={i} onClick={()=>onSelect(e.ticker)}
                  style={{background:T.panel2,border:`1px solid ${T.line2}`,borderRadius:8,padding:"8px 12px",cursor:"pointer"}}
                  onMouseEnter={ev=>ev.currentTarget.style.borderColor=C.amber}
                  onMouseLeave={ev=>ev.currentTarget.style.borderColor=T.line2}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <span style={{fontFamily:"'Rajdhani',sans-serif",fontWeight:700,fontSize:15}}>{e.ticker}</span>
                    <span style={{fontSize:8,padding:"1px 6px",borderRadius:3,fontWeight:700,
                      background:e.earnings_time==="BMO"?`rgba(34,211,238,0.15)`:`rgba(245,158,11,0.15)`,
                      color:e.earnings_time==="BMO"?C.cyan:C.amber}}>
                      {e.earnings_time==="BMO"?"PRE-MKT":"AFTER"}</span>
                  </div>
                  <div style={{fontSize:8,color:T.muted,marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                    {e.company_name||"—"}</div>
                  {live&&(
                    <div style={{marginTop:6,display:"flex",justifyContent:"space-between"}}>
                      <span style={{fontFamily:"'Rajdhani',sans-serif",fontSize:14,fontWeight:700,color:T.text}}>
                        ${fmt2(live.live_price)}</span>
                      <span style={{fontSize:10,color:clr(live.percent_change)}}>{pct(live.percent_change)}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── PORTFOLIO PAGE ───────────────────────────────────────────────────────────
function PortfolioPage({portfolio,tickers,T,onSelect}){
  const rows=useMemo(()=>portfolio.map(p=>{
    const live=tickers.get(p.ticker);
    const lp=live?.live_price||0;
    const cost=(p.avg_cost||0)*(p.shares||0);
    const value=lp*(p.shares||0);
    const pnl=value-cost;
    const pnlPct=cost>0?pnl/cost*100:0;
    return{...p,livePrice:lp,cost,value,pnl,pnlPct,live};
  }),[portfolio,tickers]);

  const totalCost=rows.reduce((a,r)=>a+r.cost,0);
  const totalValue=rows.reduce((a,r)=>a+r.value,0);
  const totalPnl=totalValue-totalCost;
  const totalPnlPct=totalCost>0?totalPnl/totalCost*100:0;

  return(
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{display:"flex",gap:20,padding:"10px 16px",borderBottom:`1px solid ${T.line2}`,
                   background:T.panel2,flexWrap:"wrap"}}>
        {[["POSITIONS",rows.length,""],["TOTAL COST",`$${totalCost.toFixed(2)}`,""],
          ["MARKET VALUE",`$${totalValue.toFixed(2)}`,clr(totalPnl)],
          ["UNREALIZED P&L",`${totalPnl>=0?"+":""}$${totalPnl.toFixed(2)}`,clr(totalPnl)],
          ["TOTAL RETURN",pct(totalPnlPct),clr(totalPnlPct)]].map(([k,v,c])=>(
          <div key={k}>
            <div style={{fontSize:8,color:T.muted,letterSpacing:".1em"}}>{k}</div>
            <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:17,fontWeight:700,color:c||T.text}}>{v}</div>
          </div>
        ))}
      </div>
      {rows.length===0?(
        <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",color:T.muted,fontSize:11}}>
          No portfolio holdings — add via /api/portfolio</div>
      ):(
        <div style={{flex:1,overflowY:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead style={{position:"sticky",top:0,background:T.panel2,zIndex:2}}>
              <tr>{["TICKER","SHARES","AVG COST","LIVE PRICE","MKT VALUE","P&L $","P&L %","NOTES"].map(h=>(
                <th key={h} style={{padding:"6px 10px",textAlign:"left",fontSize:9,color:T.muted,
                  letterSpacing:".08em",textTransform:"uppercase",borderBottom:`1px solid ${T.line}`,
                  fontWeight:600,whiteSpace:"nowrap"}}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {rows.map((r,i)=>(
                <tr key={i} onClick={()=>onSelect(r.ticker)}
                  style={{cursor:"pointer",borderBottom:`1px solid ${T.line}`}}
                  onMouseEnter={e=>e.currentTarget.style.background=T.panel2}
                  onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                  <td style={{padding:"7px 10px"}}>
                    <div style={{fontFamily:"'Rajdhani',sans-serif",fontWeight:700,fontSize:13}}>{r.ticker}</div>
                    <div style={{fontSize:8,color:T.muted,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:120}}>
                      {r.company_name||"—"}</div>
                  </td>
                  <td style={{padding:"7px 10px",color:T.text,fontSize:11}}>{r.shares}</td>
                  <td style={{padding:"7px 10px",color:T.muted,fontSize:11}}>${fmt2(r.avg_cost)}</td>
                  <td style={{padding:"7px 10px",fontFamily:"'Rajdhani',sans-serif",fontWeight:700,fontSize:13,
                              color:r.live?clr(r.live.change_value):T.muted}}>
                    {r.livePrice?`$${fmt2(r.livePrice)}`:"—"}</td>
                  <td style={{padding:"7px 10px",color:T.text,fontSize:11}}>${fmt2(r.value)}</td>
                  <td style={{padding:"7px 10px",color:clr(r.pnl),fontWeight:700,fontSize:11}}>
                    {r.pnl>=0?"+":""}${fmt2(r.pnl)}</td>
                  <td style={{padding:"7px 10px",color:clr(r.pnlPct),fontWeight:700,fontSize:11}}>{pct(r.pnlPct)}</td>
                  <td style={{padding:"7px 10px",color:T.muted,fontSize:9,maxWidth:160,
                              overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                    {r.notes||"—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── MAIN ────────────────────────────────────────────────────────────────────
export default function NexRadarDashboard(){
  const[tickers,        setTickers]       =useState(new Map()); // Map<ticker, live_row> from WS
  const[monitorSet,     setMonitorSet]    =useState(new Set()); // Set<ticker> from monitor table
  const[portfolioSet,   setPortfolioSet]  =useState(new Set()); // Set<ticker> from portfolio table
  const[signals,        setSignals]       =useState([]);
  const[metrics,        setMetrics]       =useState(null);
  const[earnings,       setEarnings]      =useState([]);
  const[portfolio,      setPortfolio]     =useState([]);

  const[selectedTicker,setSelected]=useState(null);
  const[sortBy,  setSortBy] =useState("change_value");
  const[sortDir, setSortDir]=useState(-1);
  const[timeframe,setTf]   =useState("1");
  const[sigFilter,setSigF] =useState("ALL");
  const[dataSource,setDS]  =useState("all");
  const[activeSector,setSector]=useState("ALL");
  const[viewMode,setView]  =useState("TABLE");
  const[search,  setSearch]=useState("");
  const[darkMode,setDark]  =useState(true);
  const[tvCount, setTvCount]=useState(5);
  const[bulkTarget,setBulkT]=useState("tradingview");
  const[heartbeat,setHB]   =useState(nowT());
  const[flashMap, setFlash]=useState({});
  const[wsStatus, setWsStatus]=useState("connecting");
  const[activeTab,setTab]  =useState("DASHBOARD");

  const T=darkMode?DARK:LIGHT;
  const wsRef=useRef(null),retryTimer=useRef(null),retryDelay=useRef(1000);

  // ── WebSocket ──────────────────────────────────────────────────────────────
  const connectWS=useCallback(()=>{
    setWsStatus("connecting");
    const ws=new WebSocket(WS_URL);
    wsRef.current=ws;
    ws.onopen=()=>{setWsStatus("Healthy");retryDelay.current=1000;};
    ws.onmessage=event=>{
      const parse=text=>{
        try{
          const msg=JSON.parse(text);
          if(msg.type==="snapshot"){
            const m=new Map();
            for(const row of msg.data??[])m.set(row.ticker,row);
            setTickers(m);
            const first=msg.data?.find(r=>r.is_positive);
            if(first)setSelected(s=>s||first.ticker);
          }else if(msg.type==="tick"){
            setTickers(prev=>{
              const next=new Map(prev);
              next.set(msg.ticker,{...(prev.get(msg.ticker)??{}),...msg.data});
              return next;
            });
            setFlash(f=>({...f,[msg.ticker]:(msg.data?.change_value??0)>=0?"up":"dn"}));
            setTimeout(()=>setFlash(f=>{const n={...f};delete n[msg.ticker];return n;}),400);
            setHB(nowT());
          }
        }catch{}
      };
      if(event.data instanceof Blob){const r=new FileReader();r.onload=()=>parse(r.result);r.readAsText(event.data);}
      else parse(event.data);
    };
    ws.onerror=()=>setWsStatus("Degraded");
    ws.onclose=()=>{
      setWsStatus("closed");
      const wait=Math.min(retryDelay.current*(0.8+Math.random()*0.4),30000);
      retryDelay.current=Math.min(retryDelay.current*2,30000);
      retryTimer.current=setTimeout(connectWS,wait);
    };
  },[]);

  useEffect(()=>{connectWS();return()=>{clearTimeout(retryTimer.current);wsRef.current?.close();};},[connectWS]);

  // ── Fetch monitor + portfolio ticker sets for data source filtering ─────────
  // Backend now JOINs stock_list so sector comes with every ticker row.
  // We only need to know WHICH tickers are in monitor/portfolio to filter.
  useEffect(()=>{
    const fetchSets=()=>{
      // monitor tickers
      fetch(`${API}/api/monitor`)
        .then(r=>r.json())
        .then(data=>{
          const rows=Array.isArray(data)?data:(data.data??[]);
          setMonitorSet(new Set(rows.map(r=>r.ticker)));
        }).catch(()=>{});
      // portfolio tickers (also stored for P&L page)
      fetch(`${API}/api/portfolio`)
        .then(r=>r.json())
        .then(data=>{
          const rows=Array.isArray(data)?data:(data.data??[]);
          setPortfolioSet(new Set(rows.map(r=>r.ticker)));
          setPortfolio(rows);
        }).catch(()=>{});
    };
    fetchSets();
    const id=setInterval(fetchSets,10000); // refresh every 10s (watchlist changes less often)
    return()=>clearInterval(id);
  },[]);

  // ── REST polls (fast-changing data) ────────────────────────────────────────
  useEffect(()=>{
    const fetchAll=()=>{
      fetch(`${API}/api/metrics`).then(r=>r.json()).then(setMetrics).catch(()=>{});
      fetch(`${API}/api/signals?limit=500`).then(r=>r.json()).then(d=>setSignals(Array.isArray(d)?d:d.data??[])).catch(()=>{});
      const today=new Date().toISOString().slice(0,10);
      const next7=new Date(Date.now()+7*86400000).toISOString().slice(0,10);
      fetch(`${API}/api/earnings?start=${today}&end=${next7}`).then(r=>r.json()).then(d=>setEarnings(Array.isArray(d)?d:d.data??[])).catch(()=>{});
    };
    fetchAll();
    const id=setInterval(fetchAll,5000);
    return()=>clearInterval(id);
  },[]);

  // ── Derived ────────────────────────────────────────────────────────────────
  // allRows: sector now comes directly from backend (v_live_enriched JOIN)
  // No client-side merge needed — backend does the join.
  const allRows=useMemo(()=>Array.from(tickers.values()),[tickers]);

  // Sector heatmap — works because sector is now in every row
  const sectorData=useMemo(()=>SECTOR_LIST.map(name=>{
    const stocks=allRows.filter(r=>(r.sector||"").toUpperCase()===name.toUpperCase());
    const avg=stocks.length?stocks.reduce((a,s)=>a+(s.percent_change||0),0)/stocks.length:0;
    return{name,chgP:parseFloat(avg.toFixed(2)),count:stocks.length,
           gainers:stocks.filter(s=>(s.percent_change||0)>0).length,
           losers: stocks.filter(s=>(s.percent_change||0)<=0).length};
  }),[allRows]);

  const filtered=useMemo(()=>{
    let rows=[...allRows];

    // Data source filter — uses Set for O(1) lookup
    if(dataSource==="monitor")   rows=rows.filter(r=>monitorSet.has(r.ticker));
    if(dataSource==="portfolio") rows=rows.filter(r=>portfolioSet.has(r.ticker));
    // "all" → no filter

    // Sector filter — works because backend sends sector with every row
    if(activeSector!=="ALL") rows=rows.filter(r=>(r.sector||"").toUpperCase()===activeSector.toUpperCase());

    // Search
    if(search){
      const q=search.toUpperCase();
      rows=rows.filter(r=>r.ticker?.includes(q)||r.company_name?.toUpperCase().includes(q));
    }

    rows.sort((a,b)=>sortDir*((a[sortBy]||0)-(b[sortBy]||0)));
    return rows;
  },[allRows,dataSource,activeSector,search,sortBy,sortDir,monitorSet,portfolioSet]);

  const top10=useMemo(()=>[...filtered].sort((a,b)=>(b.change_value||0)-(a.change_value||0)).slice(0,10),[filtered]);
  const stock=selectedTicker?(allRows.find(r=>r.ticker===selectedTicker)||null):(top10[0]||null);
  const handleSort=col=>{if(sortBy===col)setSortDir(d=>-d);else{setSortBy(col);setSortDir(-1);}};

  const m=metrics;
  const volSpikes=m?.volume_spikes??0,gapPlays=m?.gap_plays??0,diamonds=m?.diamond??0;
  const ahMomt=m?.ah_momentum??0,posCount=m?.pos_count??0,earningsGaps=m?.earnings_gap_plays??0;
  const liveCount=m?.live_count??allRows.length,totalCount=m?.total_tickers??allRows.length;

  const aiConf=stock?Math.min(99,Math.max(55,Math.round(72+(stock.percent_change>0?stock.percent_change*2:0)))):72;
  const atr=stock?(stock.live_price*0.012).toFixed(2):"0.00";
  const sl=stock?(stock.live_price-parseFloat(atr)*1.5).toFixed(2):"0.00";

  const wsColor=wsStatus==="Healthy"?C.green:wsStatus==="connecting"?C.amber:C.red;
  const wsIcon=wsStatus==="Healthy"?"🟢":wsStatus==="connecting"?"🟡":"🔴";

  const openBulk=()=>top10.slice(0,tvCount).forEach(r=>window.open(
    bulkTarget==="tradingview"?`https://www.tradingview.com/chart/?symbol=${r.ticker}`:`https://finance.yahoo.com/quote/${r.ticker}/`,"_blank"
  ));

  const Btn=({active,label,onClick,sx={}})=>(
    <button onClick={onClick} style={{background:active?C.amber:T.panel2,color:active?"#000":T.muted,
      border:`1px solid ${active?C.amber:T.line2}`,borderRadius:5,padding:"3px 9px",fontSize:10,
      fontFamily:"'Rajdhani',sans-serif",fontWeight:700,cursor:"pointer",letterSpacing:".05em",...sx}}>{label}</button>
  );

  const Th=({label,col})=>(
    <th onClick={()=>handleSort(col)} style={{padding:"6px 8px",textAlign:"left",fontSize:9,
      color:sortBy===col?C.amber:T.muted,letterSpacing:".08em",textTransform:"uppercase",
      cursor:"pointer",whiteSpace:"nowrap",fontWeight:600,borderBottom:`1px solid ${T.line}`}}>
      {label}{sortBy===col?(sortDir===-1?" ▼":" ▲"):""}
    </th>
  );

  // ── RENDER ─────────────────────────────────────────────────────────────────
  return(
    <div style={{fontFamily:"'IBM Plex Mono','Fira Code',monospace",background:T.bg,color:T.text,minHeight:"100vh",fontSize:11,userSelect:"none"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@400;600;700&family=IBM+Plex+Mono:wght@400;600&display=swap');
        ::-webkit-scrollbar{width:4px;height:4px}
        ::-webkit-scrollbar-track{background:transparent}
        ::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.1);border-radius:2px}
        @keyframes flashUp{0%,100%{background:transparent}50%{background:rgba(52,211,153,0.18)}}
        @keyframes flashDn{0%,100%{background:transparent}50%{background:rgba(248,113,113,0.18)}}
        .fup{animation:flashUp 0.4s ease}.fdn{animation:flashDn 0.4s ease}
      `}</style>

      {/* ── ALERT STRIP ── */}
      <div style={{display:"flex",gap:6,padding:"5px 16px",background:T.bg2,
                   borderBottom:`1px solid ${T.line}`,overflowX:"auto"}}>
        {[{label:"VOL SPIKES",val:volSpikes,color:C.amber,filter:"volume_spike"},
          {label:"GAP PLAYS",val:gapPlays,color:C.cyan,filter:"gap_play"},
          {label:"DIAMONDS 💎",val:diamonds,color:C.violet,filter:"diamond"},
          {label:"AH MOMENTUM",val:ahMomt,color:C.green2,filter:"ah_momentum"},
          {label:"GAINERS",val:posCount,color:C.green2,filter:"gainers"},
          {label:"EARNINGS GAPS",val:earningsGaps,color:C.amber2,filter:"earnings_gap"}].map(({label,val,color,filter})=>(
          <button key={label} onClick={()=>{
            // Filter the data based on the clicked alert type
            if(filter==="volume_spike") setDS("all"); // Reset to show all, then filter will apply
            // Note: Actual filtering would need to be implemented in the data filtering logic
          }} style={{display:"flex",alignItems:"center",gap:5,
            background:T.panel,border:`1px solid ${T.line2}`,borderRadius:5,
            padding:"3px 10px",whiteSpace:"nowrap",cursor:"pointer",
            transition:"all 0.15s",outline:"none"}}
            onMouseEnter={e=>{e.currentTarget.style.background=T.panel2;e.currentTarget.style.borderColor=color;}}
            onMouseLeave={e=>{e.currentTarget.style.background=T.panel;e.currentTarget.style.borderColor=T.line2;}}>
            <span style={{fontSize:8,color:T.muted,letterSpacing:".1em"}}>{label}</span>
            <span style={{fontFamily:"'Rajdhani',sans-serif",fontSize:16,fontWeight:700,color}}>{val}</span>
          </button>
        ))}
      </div>

      {/* ── TAB ROUTING ── */}
      {activeTab==="SIGNALS"&&(
        <div style={{display:"flex",flexDirection:"column",height:"calc(100vh - 88px)"}}>
          <SignalsPage signals={signals} T={T} onSelect={t=>{setSelected(t);setTab("DASHBOARD");}}/>
        </div>
      )}
      {activeTab==="EARNINGS"&&(
        <div style={{display:"flex",flexDirection:"column",height:"calc(100vh - 88px)"}}>
          <EarningsPage earnings={earnings} tickers={tickers} T={T} onSelect={t=>{setSelected(t);setTab("DASHBOARD");}}/>
        </div>
      )}
      {activeTab==="PORTFOLIO"&&(
        <div style={{display:"flex",flexDirection:"column",height:"calc(100vh - 88px)"}}>
          <PortfolioPage portfolio={portfolio} tickers={tickers} T={T} onSelect={t=>{setSelected(t);setTab("DASHBOARD");}}/>
        </div>
      )}

      {activeTab==="DASHBOARD"&&(
        <div style={{display:"flex",height:"calc(100vh - 88px)",overflow:"hidden"}}>

          {/* ── LEFT DETAIL PANEL ── */}
          <div style={{width:256,flexShrink:0,borderRight:`1px solid ${T.line2}`,
                       display:"flex",flexDirection:"column",overflowY:"auto"}}>
            {stock?(
              <div style={{padding:12}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                  <div>
                    <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:22,fontWeight:700}}>{stock.ticker}</div>
                    <div style={{fontSize:8,color:T.muted,maxWidth:130,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                      {stock.company_name||"—"}</div>
                  </div>
                  <div style={{textAlign:"right"}}>
                    {/* FIX: always live_price — irrespective of AH/AM session */}
                    <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:24,fontWeight:700,color:clr(stock.change_value)}}>
                      ${fmt2(stock.live_price)}</div>
                    <div style={{fontSize:10,color:clr(stock.change_value)}}>
                      {stock.change_value>=0?"+":""}{fmt2(stock.change_value)} ({pct(stock.percent_change)})</div>
                  </div>
                </div>
                <div style={{position:"relative",height:194,borderRadius:6,overflow:"hidden",background:T.panel2,marginBottom:8}}>
                  <CandleChart symbol={stock.ticker}/>
                </div>
                <div style={{display:"flex",gap:3,marginBottom:8}}>
                  {["1","5","15","60","D"].map(tf=>(
                    <Btn key={tf} active={timeframe===tf} label={tf+(tf==="D"?"":"m")} onClick={()=>setTf(tf)} sx={{fontSize:9,padding:"2px 6px"}}/>
                  ))}
                </div>
                {[["SECTOR",stock.sector||"—"],["VOLUME",(stock.volume||0).toLocaleString()],
                  ["VOL RATIO",stock.volume_ratio?`${fmt2(stock.volume_ratio)}x`:"—"],
                  ["MKT CAP",fmtK(stock.market_cap)],["GAP %",pct(stock.gap_percent||0)],
                  ["OPEN",stock.open_price?`$${fmt2(stock.open_price)}`:"—"],
                  ["PREV CLOSE",stock.prev_close?`$${fmt2(stock.prev_close)}`:"—"],
                  ["DAY HI/LO",stock.day_high?`$${fmt2(stock.day_high)} / $${fmt2(stock.day_low)}`:"—"],
                  ["ATR (est)",`$${atr}`],["STOP LOSS",`$${sl}`],["AI CONF",`${aiConf}%`],
                ].map(([k,v])=>(
                  <div key={k} style={{display:"flex",justifyContent:"space-between",
                    borderBottom:`1px solid ${T.line}`,padding:"4px 0",fontSize:10}}>
                    <span style={{color:T.muted,fontSize:8,letterSpacing:".08em"}}>{k}</span>
                    <span style={{color:k==="AI CONF"?C.violet:T.text,fontWeight:600}}>{v}</span>
                  </div>
                ))}
                <div style={{display:"flex",flexWrap:"wrap",gap:4,marginTop:8}}>
                  {stock.volume_spike&&<span style={{background:`rgba(245,158,11,0.15)`,border:`1px solid ${C.amber}`,borderRadius:3,padding:"1px 6px",fontSize:8,color:C.amber}}>VOL SPIKE</span>}
                  {(stock.gap_percent||0)>2&&<span style={{background:`rgba(34,211,238,0.12)`,border:`1px solid ${C.cyan}`,borderRadius:3,padding:"1px 6px",fontSize:8,color:C.cyan}}>GAP PLAY</span>}
                  {stock.ah_momentum&&<span style={{background:`rgba(52,211,153,0.12)`,border:`1px solid ${C.green}`,borderRadius:3,padding:"1px 6px",fontSize:8,color:C.green2}}>AH MOMT</span>}
                  {stock.pullback_state&&stock.pullback_state!=="neutral"&&<span style={{background:`rgba(139,92,246,0.12)`,border:`1px solid ${C.violet}`,borderRadius:3,padding:"1px 6px",fontSize:8,color:C.violet}}>PULLBACK</span>}
                </div>
                <a href={`https://www.tradingview.com/chart/?symbol=${stock.ticker}`} target="_blank" rel="noreferrer"
                  style={{display:"block",marginTop:10,background:`rgba(245,158,11,0.1)`,border:`1px solid ${C.amber}`,
                    borderRadius:5,padding:"5px",textAlign:"center",color:C.amber,fontSize:10,textDecoration:"none",
                    fontFamily:"'Rajdhani',sans-serif",fontWeight:700,letterSpacing:".1em"}}>
                  OPEN IN TRADINGVIEW ↗</a>
              </div>
            ):(
              <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",
                           flexDirection:"column",gap:8,color:T.muted,padding:16}}>
                <div style={{fontSize:24}}>📡</div>
                <div style={{fontSize:10,color:C.amber,textAlign:"center"}}>
                  {allRows.length===0?"Connecting to live feed…":"Select a stock"}</div>
                {allRows.length===0&&<div style={{fontSize:8,color:T.muted,textAlign:"center"}}>{WS_URL}</div>}
              </div>
            )}
          </div>

          {/* ── CENTRE ── */}
          <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
            {/* Sector heatmap */}
            <div style={{padding:"7px 12px",borderBottom:`1px solid ${T.line}`,
                         display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:5}}>
              {sectorData.map(s=>(
                <HeatTile key={s.name} s={s} T={T}
                  active={activeSector===s.name}
                  onClick={()=>setSector(activeSector===s.name?"ALL":s.name)}/>
              ))}
            </div>

            {/* Toolbar */}
            <div style={{display:"flex",alignItems:"center",gap:6,
                         padding:"5px 12px",borderBottom:`1px solid ${T.line}`,flexWrap:"wrap"}}>
              <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search ticker / name…"
                style={{background:T.panel2,border:`1px solid ${T.line2}`,borderRadius:5,padding:"4px 8px",
                        color:T.text,fontSize:10,outline:"none",width:160,fontFamily:"inherit"}}/>
              <div style={{display:"flex",gap:3}}>
                {[["all","ALL"],["monitor","WATCHLIST"],["portfolio","PORTFOLIO"]].map(([v,l])=>(
                  <Btn key={v} active={dataSource===v} label={l} onClick={()=>setDS(v)} sx={{fontSize:9}}/>
                ))}
              </div>
              {activeSector!=="ALL"&&(
                <div style={{background:`rgba(245,158,11,0.12)`,border:`1px solid ${C.amber}`,borderRadius:4,
                             padding:"2px 8px",fontSize:9,color:C.amber,display:"flex",alignItems:"center",gap:4}}>
                  {activeSector}
                  <span onClick={()=>setSector("ALL")} style={{cursor:"pointer",color:T.muted}}>✕</span>
                </div>
              )}
              <div style={{marginLeft:"auto",display:"flex",gap:4,alignItems:"center"}}>
                <Btn active={viewMode==="TABLE"} label="≡ TABLE" onClick={()=>setView("TABLE")}/>
                <Btn active={viewMode==="MOVERS"} label="↑ MOVERS" onClick={()=>setView("MOVERS")}/>
                <select value={bulkTarget} onChange={e=>setBulkT(e.target.value)}
                  style={{background:T.panel2,border:`1px solid ${T.line2}`,color:T.muted,borderRadius:4,fontSize:9,padding:"2px 4px"}}>
                  <option value="tradingview">TradingView</option>
                  <option value="yahoo">Yahoo Finance</option>
                </select>
                <select value={tvCount} onChange={e=>setTvCount(Number(e.target.value))}
                  style={{background:T.panel2,border:`1px solid ${T.line2}`,color:T.muted,borderRadius:4,fontSize:9,padding:"2px 4px"}}>
                  {[3,5,10].map(n=><option key={n} value={n}>Top {n}</option>)}
                </select>
                <button onClick={openBulk} style={{background:`rgba(34,211,238,0.1)`,border:`1px solid ${C.cyan}`,
                  color:C.cyan,borderRadius:5,padding:"3px 9px",fontSize:9,
                  fontFamily:"'Rajdhani',sans-serif",fontWeight:700,cursor:"pointer"}}>OPEN CHARTS</button>
              </div>
            </div>

            {/* Table / Movers */}
            <div style={{flex:1,overflowY:"auto"}}>
              {allRows.length===0?(
                <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"100%",gap:10,color:T.muted}}>
                  <div style={{fontSize:28}}>📡</div>
                  <div style={{fontSize:12,color:C.amber}}>Connecting to live data feed…</div>
                  <div style={{fontSize:9}}>WS: {wsStatus} · {WS_URL}</div>
                </div>
              ):viewMode==="MOVERS"?(
                <div style={{padding:12,display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(175px,1fr))",gap:8}}>
                  {top10.map(r=>(
                    <div key={r.ticker} onClick={()=>setSelected(r.ticker)}
                      style={{background:selectedTicker===r.ticker?`rgba(245,158,11,0.08)`:T.panel2,
                        border:`1px solid ${selectedTicker===r.ticker?C.amber:T.line2}`,
                        borderRadius:8,padding:"10px 12px",cursor:"pointer"}}>
                      <div style={{display:"flex",justifyContent:"space-between"}}>
                        <span style={{fontFamily:"'Rajdhani',sans-serif",fontWeight:700,fontSize:15}}>{r.ticker}</span>
                        <span style={{fontSize:8,color:T.muted}}>{r.sector||"—"}</span>
                      </div>
                      <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:20,fontWeight:700,color:clr(r.change_value),marginTop:2}}>
                        ${fmt2(r.live_price)}</div>
                      <div style={{fontSize:10,color:clr(r.percent_change)}}>{pct(r.percent_change)}</div>
                      <div style={{fontSize:8,color:T.muted,marginTop:4,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                        {r.company_name}</div>
                    </div>
                  ))}
                </div>
              ):(
                <table style={{width:"100%",borderCollapse:"collapse"}}>
                  <thead style={{position:"sticky",top:0,background:T.panel2,zIndex:2}}>
                    <tr>
                      <Th label="TICKER"  col="ticker"/>
                      <Th label="PRICE"   col="live_price"/>
                      <Th label="CHG $"   col="change_value"/>
                      <Th label="CHG %"   col="percent_change"/>
                      <Th label="VOLUME"  col="volume"/>
                      <Th label="GAP %"   col="gap_percent"/>
                      <th style={{padding:"6px 8px",fontSize:9,color:T.muted,letterSpacing:".08em",
                        textTransform:"uppercase",borderBottom:`1px solid ${T.line}`,fontWeight:600}}>SECTOR</th>
                      <th style={{padding:"6px 8px",fontSize:9,color:T.muted,letterSpacing:".08em",
                        textTransform:"uppercase",borderBottom:`1px solid ${T.line}`,fontWeight:600}}>FLAGS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(r=>{
                      const flash=flashMap[r.ticker];
                      return(
                        <tr key={r.ticker}
                          className={flash==="up"?"fup":flash==="dn"?"fdn":""}
                          onClick={()=>setSelected(r.ticker)}
                          style={{cursor:"pointer",
                            background:selectedTicker===r.ticker?`rgba(245,158,11,0.06)`:"transparent",
                            borderLeft:selectedTicker===r.ticker?`2px solid ${C.amber}`:"2px solid transparent"}}
                          onMouseEnter={e=>e.currentTarget.style.background=T.panel2}
                          onMouseLeave={e=>e.currentTarget.style.background=selectedTicker===r.ticker?`rgba(245,158,11,0.06)`:"transparent"}>
                          <td style={{padding:"5px 8px",borderBottom:`1px solid ${T.line}`}}>
                            <span style={{fontFamily:"'Rajdhani',sans-serif",fontWeight:700,fontSize:12}}>{r.ticker}</span>
                            <div style={{fontSize:8,color:T.muted,maxWidth:100,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.company_name}</div>
                          </td>
                          {/* live_price — always shown irrespective of AH/AM */}
                          <td style={{padding:"5px 8px",borderBottom:`1px solid ${T.line}`,fontFamily:"'Rajdhani',sans-serif",fontSize:13,fontWeight:600}}>
                            ${fmt2(r.live_price)}</td>
                          <td style={{padding:"5px 8px",borderBottom:`1px solid ${T.line}`,color:clr(r.change_value),fontSize:11}}>
                            {r.change_value>=0?"+":""}{fmt2(r.change_value)}</td>
                          <td style={{padding:"5px 8px",borderBottom:`1px solid ${T.line}`,color:clr(r.percent_change),fontWeight:700,fontSize:11}}>
                            {pct(r.percent_change)}</td>
                          <td style={{padding:"5px 8px",borderBottom:`1px solid ${T.line}`,color:T.muted,fontSize:10}}>
                            {(r.volume||0).toLocaleString()}</td>
                          <td style={{padding:"5px 8px",borderBottom:`1px solid ${T.line}`,color:clr(r.gap_percent||0),fontSize:10}}>
                            {r.gap_percent?pct(r.gap_percent):"—"}</td>
                          <td style={{padding:"5px 8px",borderBottom:`1px solid ${T.line}`,fontSize:8,color:T.muted,letterSpacing:".06em"}}>
                            {r.sector||"—"}</td>
                          <td style={{padding:"5px 8px",borderBottom:`1px solid ${T.line}`}}>
                            <div style={{display:"flex",gap:3}}>
                              {r.volume_spike&&<span style={{background:C.amber,color:"#000",borderRadius:2,padding:"1px 4px",fontSize:7,fontWeight:700}}>VOL</span>}
                              {(r.gap_percent||0)>2&&<span style={{background:C.cyan,color:"#000",borderRadius:2,padding:"1px 4px",fontSize:7,fontWeight:700}}>GAP</span>}
                              {r.ah_momentum&&<span style={{background:C.green,color:"#000",borderRadius:2,padding:"1px 4px",fontSize:7,fontWeight:700}}>AH</span>}
                              {r.pullback_state&&r.pullback_state!=="neutral"&&<span style={{background:C.violet,color:"#fff",borderRadius:2,padding:"1px 4px",fontSize:7,fontWeight:700}}>PB</span>}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* Status bar */}
            <div style={{padding:"4px 12px",borderTop:`1px solid ${T.line}`,display:"flex",
                         justifyContent:"space-between",fontSize:8,color:T.muted,background:T.panel}}>
              <span>Showing {filtered.length.toLocaleString()} of {allRows.length.toLocaleString()} stocks</span>
              <span>{activeSector!=="ALL"?`Sector: ${activeSector} · `:""}{dataSource.toUpperCase()} · {heartbeat}</span>
            </div>
          </div>

          {/* ── RIGHT SIDEBAR ── */}
          <div style={{width:238,borderLeft:`1px solid ${T.line2}`,display:"flex",flexDirection:"column"}}>
            {/* Signals sidebar */}
            <div style={{borderBottom:`1px solid ${T.line2}`,flex:"0 0 auto"}}>
              <div style={{padding:"6px 10px",display:"flex",justifyContent:"space-between",
                           alignItems:"center",borderBottom:`1px solid ${T.line}`}}>
                <span style={{fontSize:9,letterSpacing:".12em",color:T.muted}}>SCALP SIGNALS</span>
                <div style={{display:"flex",gap:3}}>
                  {["ALL","LONG","SHORT"].map(f=>(
                    <Btn key={f} active={sigFilter===f} label={f} onClick={()=>setSigF(f)} sx={{fontSize:8,padding:"1px 6px"}}/>
                  ))}
                </div>
              </div>
              <div style={{maxHeight:260,overflowY:"auto"}}>
                {(sigFilter==="ALL"?signals:signals.filter(s=>s.direction===sigFilter)).length===0?(
                  <div style={{padding:12,textAlign:"center",color:T.muted,fontSize:9}}>No signals</div>
                ):(sigFilter==="ALL"?signals:signals.filter(s=>s.direction===sigFilter)).slice(0,20).map((sig,i)=>(
                  <div key={i} onClick={()=>setSelected(sig.symbol)}
                    style={{padding:"6px 10px",borderBottom:`1px solid ${T.line}`,cursor:"pointer"}}
                    onMouseEnter={e=>e.currentTarget.style.background=T.panel2}
                    onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                    <div style={{display:"flex",justifyContent:"space-between"}}>
                      <span style={{fontFamily:"'Rajdhani',sans-serif",fontWeight:700,fontSize:13}}>{sig.symbol}</span>
                      <span style={{fontSize:8,fontWeight:700,padding:"1px 5px",borderRadius:3,
                        background:sig.direction==="LONG"?`rgba(16,185,129,0.15)`:`rgba(239,68,68,0.15)`,
                        color:sig.direction==="LONG"?C.green2:C.red2}}>{sig.direction}</span>
                    </div>
                    <div style={{display:"flex",justifyContent:"space-between",fontSize:9,color:T.muted,marginTop:2}}>
                      <span>Entry: <span style={{color:T.text}}>${fmt2(sig.entry_price)}</span></span>
                      <span>Score: <span style={{color:C.amber}}>{sig.score}</span></span>
                    </div>
                    <div style={{display:"flex",justifyContent:"space-between",fontSize:8,color:T.muted}}>
                      <span>TP: ${fmt2(sig.take_profit)}</span>
                      <span style={{color:C.violet}}>Conf: {sig.confidence}%</span>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{padding:"4px 10px",borderTop:`1px solid ${T.line}`,textAlign:"center"}}>
                <button onClick={()=>setTab("SIGNALS")} style={{background:"transparent",border:`1px solid ${T.line2}`,
                  color:T.muted,borderRadius:4,padding:"2px 10px",fontSize:8,cursor:"pointer",
                  fontFamily:"'Rajdhani',sans-serif",letterSpacing:".08em"}}>VIEW ALL →</button>
              </div>
            </div>
            {/* Earnings sidebar */}
            <div style={{flex:1,display:"flex",flexDirection:"column",overflowY:"auto"}}>
              <div style={{padding:"6px 10px",borderBottom:`1px solid ${T.line}`,
                           display:"flex",justifyContent:"space-between",fontSize:9,color:T.muted}}>
                <span>EARNINGS (7d)</span><span style={{color:C.amber}}>{earnings.length}</span>
              </div>
              {earnings.slice(0,20).map((e,i)=>(
                <div key={i} onClick={()=>setSelected(e.ticker)}
                  style={{padding:"6px 10px",borderBottom:`1px solid ${T.line}`,cursor:"pointer"}}
                  onMouseEnter={ev=>ev.currentTarget.style.background=T.panel2}
                  onMouseLeave={ev=>ev.currentTarget.style.background="transparent"}>
                  <div style={{display:"flex",justifyContent:"space-between"}}>
                    <span style={{fontFamily:"'Rajdhani',sans-serif",fontWeight:700,fontSize:12}}>{e.ticker}</span>
                    <span style={{fontSize:8,color:C.amber}}>{e.earnings_time==="BMO"?"pre-mkt":"after"}</span>
                  </div>
                  <div style={{fontSize:8,color:T.muted,marginTop:1}}>
                    {new Date(e.earnings_date+"T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"})}</div>
                </div>
              ))}
              <div style={{padding:"4px 10px",borderTop:`1px solid ${T.line}`,textAlign:"center"}}>
                <button onClick={()=>setTab("EARNINGS")} style={{background:"transparent",border:`1px solid ${T.line2}`,
                  color:T.muted,borderRadius:4,padding:"2px 10px",fontSize:8,cursor:"pointer",
                  fontFamily:"'Rajdhani',sans-serif",letterSpacing:".08em"}}>VIEW ALL →</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
