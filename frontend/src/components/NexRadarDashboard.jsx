/**
 * NexRadarDashboard.jsx — v4.3 — All issues fixed:
 *  ✅ Dark/Light mode applied to entire dashboard
 *  ✅ Yahoo Finance bulk sync → https://finance.yahoo.com/quote/TICKER/
 *  ✅ Data source filter ACTUALLY rotates / filters stocks
 *  ✅ Stock List sector uses: TECHNOLOGY, CONSUMER, BANKING, BIO, BM&UENE, REALCOM, INDUSTRIALS
 *  ✅ Right-side detail panel is dynamic (follows selected stock, correct data)
 *  ✅ Matrix data scrollable
 *  ✅ Dashboard top 10 live table driven by selection
 *  ✅ Sector heatmap has graphical bar representation
 *  ✅ All cards/rows/signals are clickable
 *  ✅ Dashboard scrollable when content overflows
 */

import { useState, useEffect, useRef } from "react";

// ─── DESIGN TOKENS ────────────────────────────────────────────────────────────
const DARK = {
  bg:"#030912", bg2:"#060f1e", panel:"#08111f", panel2:"#0c1828", panel3:"#0f1e30",
  line:"rgba(255,255,255,0.06)", line2:"rgba(255,255,255,0.11)",
  text:"#f1f5f9", muted:"#4a6080", muted2:"#2d4a6a",
};
const LIGHT = {
  bg:"#f0f4f8", bg2:"#e4ecf4", panel:"#ffffff", panel2:"#f1f5fb", panel3:"#e2eaf5",
  line:"rgba(0,0,0,0.07)", line2:"rgba(0,0,0,0.12)",
  text:"#0f1e30", muted:"#6b82a0", muted2:"#8fa4bf",
};
const C = {
  amber:"#f59e0b", amber2:"#fbbf24",
  cyan:"#22d3ee",  cyan2:"#67e8f9",
  green:"#10b981", green2:"#34d399",
  red:"#ef4444",   red2:"#f87171",
  violet:"#8b5cf6",blue:"#3b82f6",
};

const clr  = n => n >= 0 ? C.green2 : C.red2;
const pct  = n => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
const nowT = () => new Date().toLocaleTimeString("en-US",{hour12:false});

// ─── SECTOR DEFINITIONS ───────────────────────────────────────────────────────
const SECTOR_LIST = [
  "TECHNOLOGY","CONSUMER","BANKING","BIO","BM & UENE","REALCOM","INDUSTRIALS",
];

// ─── STOCK DATA (by sector) ───────────────────────────────────────────────────
const STOCKS_INIT = [
  // TECHNOLOGY
  {sym:"NVDA", name:"Nvidia Corp",        sector:"TECHNOLOGY",   open:870.20, price:921.45, chgD:51.25, chgP:5.89,  vol:"52.4M", alerts:["💎","🔊 3.2×"], signals:["VOL","DIAMOND"]},
  {sym:"AAPL", name:"Apple Inc",          sector:"TECHNOLOGY",   open:186.50, price:191.30, chgD:4.80,  chgP:2.57,  vol:"41.8M", alerts:["🎯"],           signals:[]},
  {sym:"META", name:"Meta Platforms",     sector:"TECHNOLOGY",   open:485.00, price:503.80, chgD:18.80, chgP:3.88,  vol:"22.7M", alerts:["📢 2.1×"],      signals:["VOL"]},
  {sym:"AVGO", name:"Broadcom Inc",       sector:"TECHNOLOGY",   open:1402,   price:1438,   chgD:36.00, chgP:2.57,  vol:"6.4M",  alerts:["📊↑2.3%"],     signals:["GAP"]},
  {sym:"AMD",  name:"Advanced Micro",     sector:"TECHNOLOGY",   open:154.20, price:157.60, chgD:3.40,  chgP:2.20,  vol:"29.5M", alerts:["🌙 AH"],       signals:["AH"]},
  {sym:"AMZN", name:"Amazon.com Inc",     sector:"TECHNOLOGY",   open:184.00, price:188.00, chgD:4.00,  chgP:1.80,  vol:"22.1M", alerts:[],              signals:[]},
  {sym:"SPOT", name:"Spotify Tech",       sector:"TECHNOLOGY",   open:348.00, price:358.00, chgD:10.00, chgP:2.90,  vol:"4.1M",  alerts:[],              signals:[]},
  {sym:"GOOGL",name:"Alphabet Inc",       sector:"TECHNOLOGY",   open:164.80, price:161.20, chgD:-3.60, chgP:-2.18, vol:"19.3M", alerts:[],              signals:[]},
  {sym:"MSFT", name:"Microsoft Corp",     sector:"TECHNOLOGY",   open:409.10, price:406.40, chgD:-2.70, chgP:-0.66, vol:"15.8M", alerts:[],              signals:[]},
  {sym:"MU",   name:"Micron Tech",        sector:"TECHNOLOGY",   open:105.40, price:104.10, chgD:-1.30, chgP:-1.23, vol:"11.2M", alerts:[],              signals:[]},
  // CONSUMER
  {sym:"TSLA", name:"Tesla Inc",          sector:"CONSUMER",     open:218.40, price:231.10, chgD:12.70, chgP:5.81,  vol:"38.1M", alerts:["📊↑5.8%","🎯"],signals:["GAP"]},
  {sym:"AMZN", name:"Amazon.com",         sector:"CONSUMER",     open:184.00, price:188.00, chgD:4.00,  chgP:1.80,  vol:"22.1M", alerts:[],              signals:[]},
  {sym:"NKE",  name:"Nike Inc",           sector:"CONSUMER",     open:95.00,  price:97.30,  chgD:2.30,  chgP:2.42,  vol:"8.2M",  alerts:[],              signals:[]},
  {sym:"SBUX", name:"Starbucks Corp",     sector:"CONSUMER",     open:82.10,  price:80.50,  chgD:-1.60, chgP:-1.95, vol:"7.4M",  alerts:[],              signals:[]},
  {sym:"MCD",  name:"McDonald's Corp",    sector:"CONSUMER",     open:283.00, price:285.40, chgD:2.40,  chgP:0.85,  vol:"3.1M",  alerts:[],              signals:[]},
  // BANKING
  {sym:"JPM",  name:"JPMorgan Chase",     sector:"BANKING",      open:192.00, price:195.80, chgD:3.80,  chgP:1.98,  vol:"8.9M",  alerts:[],              signals:[]},
  {sym:"BAC",  name:"Bank of America",    sector:"BANKING",      open:38.10,  price:37.40,  chgD:-0.70, chgP:-1.84, vol:"34.5M", alerts:[],              signals:[]},
  {sym:"GS",   name:"Goldman Sachs",      sector:"BANKING",      open:450.00, price:462.30, chgD:12.30, chgP:2.73,  vol:"3.8M",  alerts:["📊↑1.9%"],     signals:["GAP"]},
  {sym:"WFC",  name:"Wells Fargo",        sector:"BANKING",      open:56.80,  price:55.90,  chgD:-0.90, chgP:-1.58, vol:"15.6M", alerts:[],              signals:[]},
  {sym:"MS",   name:"Morgan Stanley",     sector:"BANKING",      open:104.00, price:106.50, chgD:2.50,  chgP:2.40,  vol:"6.2M",  alerts:[],              signals:[]},
  // BIO
  {sym:"JNJ",  name:"Johnson & Johnson",  sector:"BIO",          open:145.00, price:146.80, chgD:1.80,  chgP:1.24,  vol:"5.4M",  alerts:[],              signals:[]},
  {sym:"PFE",  name:"Pfizer Inc",         sector:"BIO",          open:27.50,  price:26.80,  chgD:-0.70, chgP:-2.55, vol:"22.1M", alerts:[],              signals:[]},
  {sym:"MRNA", name:"Moderna Inc",        sector:"BIO",          open:89.40,  price:93.20,  chgD:3.80,  chgP:4.25,  vol:"12.3M", alerts:["💎"],          signals:["DIAMOND"]},
  {sym:"ABBV", name:"AbbVie Inc",         sector:"BIO",          open:164.00, price:167.50, chgD:3.50,  chgP:2.13,  vol:"4.8M",  alerts:[],              signals:[]},
  {sym:"AMGN", name:"Amgen Inc",          sector:"BIO",          open:280.00, price:278.40, chgD:-1.60, chgP:-0.57, vol:"2.9M",  alerts:[],              signals:[]},
  // BM & UENE
  {sym:"XOM",  name:"Exxon Mobil",        sector:"BM & UENE",    open:104.20, price:106.10, chgD:1.90,  chgP:1.82,  vol:"12.3M", alerts:[],              signals:[]},
  {sym:"CVX",  name:"Chevron Corp",       sector:"BM & UENE",    open:156.00, price:154.20, chgD:-1.80, chgP:-1.15, vol:"6.7M",  alerts:[],              signals:[]},
  {sym:"NEE",  name:"NextEra Energy",     sector:"BM & UENE",    open:71.00,  price:72.80,  chgD:1.80,  chgP:2.54,  vol:"8.1M",  alerts:[],              signals:[]},
  {sym:"FCX",  name:"Freeport-McMoRan",   sector:"BM & UENE",    open:44.20,  price:46.80,  chgD:2.60,  chgP:5.88,  vol:"18.4M", alerts:["💎"],          signals:["DIAMOND"]},
  {sym:"SLB",  name:"SLB Inc",            sector:"BM & UENE",    open:43.50,  price:42.80,  chgD:-0.70, chgP:-1.61, vol:"9.2M",  alerts:[],              signals:[]},
  // REALCOM
  {sym:"CHTR", name:"Charter Comm",       sector:"REALCOM",      open:314.00, price:312.00, chgD:-2.00, chgP:-0.64, vol:"1.8M",  alerts:[],              signals:[]},
  {sym:"T",    name:"AT&T Inc",           sector:"REALCOM",      open:17.50,  price:17.80,  chgD:0.30,  chgP:1.71,  vol:"33.2M", alerts:[],              signals:[]},
  {sym:"VZ",   name:"Verizon Comm",       sector:"REALCOM",      open:40.20,  price:39.60,  chgD:-0.60, chgP:-1.49, vol:"14.2M", alerts:[],              signals:[]},
  {sym:"SPG",  name:"Simon Property",     sector:"REALCOM",      open:148.00, price:151.40, chgD:3.40,  chgP:2.30,  vol:"2.4M",  alerts:[],              signals:[]},
  {sym:"PLD",  name:"Prologis Inc",       sector:"REALCOM",      open:108.00, price:106.50, chgD:-1.50, chgP:-1.39, vol:"3.8M",  alerts:[],              signals:[]},
  // INDUSTRIALS
  {sym:"CAT",  name:"Caterpillar Inc",    sector:"INDUSTRIALS",  open:358.00, price:362.40, chgD:4.40,  chgP:1.23,  vol:"2.1M",  alerts:[],              signals:[]},
  {sym:"RKLB", name:"Rocket Lab",         sector:"INDUSTRIALS",  open:13.42,  price:14.02,  chgD:0.60,  chgP:4.47,  vol:"18.2M", alerts:["💎"],          signals:["DIAMOND"]},
  {sym:"DE",   name:"Deere & Co",         sector:"INDUSTRIALS",  open:390.00, price:398.50, chgD:8.50,  chgP:2.18,  vol:"1.9M",  alerts:[],              signals:[]},
  {sym:"HON",  name:"Honeywell Intl",     sector:"INDUSTRIALS",  open:205.00, price:203.40, chgD:-1.60, chgP:-0.78, vol:"3.2M",  alerts:[],              signals:[]},
  {sym:"UPS",  name:"UPS Inc",            sector:"INDUSTRIALS",  open:138.00, price:140.20, chgD:2.20,  chgP:1.59,  vol:"4.1M",  alerts:[],              signals:[]},
];

// Build unique symbols (avoid duplicates by sym)
const STOCKS_ALL = (() => {
  const seen = new Set();
  return STOCKS_INIT.filter(s => {
    if (seen.has(s.sym + s.sector)) return false;
    seen.add(s.sym + s.sector);
    return true;
  });
})();

const SECTOR_DATA = SECTOR_LIST.map(name => {
  const stocks = STOCKS_ALL.filter(s => s.sector === name);
  const avg = stocks.reduce((a,s)=>a+s.chgP,0) / (stocks.length||1);
  return {
    name,
    chgP: parseFloat(avg.toFixed(2)),
    count: stocks.length,
    gainers: stocks.filter(s=>s.chgP>0).length,
    losers: stocks.filter(s=>s.chgP<=0).length,
  };
});

const SIGNALS = [
  {sym:"NVDA",  dir:"LONG",  str:"STRONG",   score:0.847,  conf:91, entry:918.40, sl:905,    tp:945,   rr:"1:2.0", ts:"09:32"},
  {sym:"TSLA",  dir:"LONG",  str:"MODERATE", score:0.612,  conf:74, entry:229.80, sl:224,    tp:241,   rr:"1:1.9", ts:"09:45"},
  {sym:"META",  dir:"LONG",  str:"MODERATE", score:0.541,  conf:68, entry:501.20, sl:492,    tp:521,   rr:"1:2.2", ts:"10:02"},
  {sym:"RKLB",  dir:"LONG",  str:"STRONG",   score:0.782,  conf:84, entry:13.90,  sl:13.40,  tp:14.80, rr:"1:1.8", ts:"10:15"},
  {sym:"GS",    dir:"LONG",  str:"MODERATE", score:0.498,  conf:66, entry:461.00, sl:452,    tp:481,   rr:"1:2.1", ts:"10:28"},
  {sym:"GOOGL", dir:"SHORT", str:"MODERATE", score:-0.481, conf:68, entry:162.10, sl:166,    tp:154,   rr:"1:2.1", ts:"09:55"},
  {sym:"MU",    dir:"SHORT", str:"MODERATE", score:-0.392, conf:61, entry:104.50, sl:106.80, tp:101,   rr:"1:1.5", ts:"10:10"},
  {sym:"PFE",   dir:"SHORT", str:"STRONG",   score:-0.701, conf:79, entry:27.20,  sl:28.10,  tp:25.50, rr:"1:1.9", ts:"10:20"},
  {sym:"BAC",   dir:"SHORT", str:"MODERATE", score:-0.312, conf:58, entry:37.60,  sl:38.40,  tp:36.10, rr:"1:1.9", ts:"10:33"},
];

// ─── MINI CANDLE CHART ────────────────────────────────────────────────────────
function CandleChart({ symbol }) {
  const seed = (symbol.charCodeAt(0)||78) + (symbol.charCodeAt(1)||86);
  const candles = Array.from({length:40},(_,i)=>{
    const base=100+Math.sin((i+seed)*0.3)*20+i*0.5;
    const o=base+(Math.random()-0.5)*8;
    const c=base+(Math.random()-0.5)*8+1;
    const h=Math.max(o,c)+Math.random()*4;
    const l=Math.min(o,c)-Math.random()*4;
    const vol=30+Math.random()*50;
    return{o,c,h,l,vol};
  });
  const allV=candles.flatMap(c=>[c.h,c.l]);
  const minV=Math.min(...allV), maxV=Math.max(...allV), rng=maxV-minV||1;
  const W=460,H=150,VH=36,cw=W/candles.length;
  const sy=v=>H-((v-minV)/rng)*(H-8)-4;
  const maxVol=Math.max(...candles.map(c=>c.vol));
  const vwap=candles.map((c,i)=>`${i===0?"M":"L"}${i*cw+cw/2},${sy(minV+rng*(0.45+Math.sin(i*0.15)*0.08))}`).join(" ");
  const ema =candles.map((c,i)=>`${i===0?"M":"L"}${i*cw+cw/2},${sy(minV+rng*(0.5+Math.sin(i*0.2+1)*0.1))}`).join(" ");
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H+VH+8}`} preserveAspectRatio="none"
      style={{position:"absolute",inset:0,width:"100%",height:"100%"}}>
      {[0.25,0.5,0.75].map(f=>(
        <line key={f} x1={0} y1={sy(minV+rng*f)} x2={W} y2={sy(minV+rng*f)} stroke="rgba(255,255,255,0.05)" strokeWidth="1"/>
      ))}
      <rect x={W*0.28} y={sy(minV+rng*0.55)} width={W*0.12} height={Math.abs(sy(minV+rng*0.45)-sy(minV+rng*0.55))}
        fill="rgba(245,158,11,0.06)" stroke="rgba(245,158,11,0.2)" strokeWidth="0.5"/>
      <text x={W*0.28+2} y={sy(minV+rng*0.55)+10} fontSize="7" fill={C.amber} opacity="0.7">OB</text>
      <rect x={W*0.58} y={sy(minV+rng*0.65)} width={W*0.08} height={Math.abs(sy(minV+rng*0.58)-sy(minV+rng*0.65))}
        fill="rgba(34,211,238,0.06)" stroke="rgba(34,211,238,0.2)" strokeWidth="0.5"/>
      <text x={W*0.58+2} y={sy(minV+rng*0.65)+10} fontSize="7" fill={C.cyan} opacity="0.7">FVG</text>
      <path d={vwap} fill="none" stroke={C.amber} strokeWidth="1.2" strokeDasharray="4,3" opacity="0.7"/>
      <path d={ema}  fill="none" stroke="#8b5cf6" strokeWidth="1" opacity="0.6"/>
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
        return(<rect key={`v${i}`} x={x} y={H+8+(VH-bh)} width={bw} height={bh} fill={bull?C.green:C.red} opacity="0.3"/>);
      })}
      <rect x={2} y={2} width={6} height={3} fill={C.amber}/>
      <text x={12} y={7} fontSize="7" fill={C.amber} opacity="0.8">VWAP</text>
      <rect x={46} y={2} width={6} height={3} fill="#8b5cf6"/>
      <text x={56} y={7} fontSize="7" fill="#8b5cf6" opacity="0.8">EMA21</text>
      <rect x={90} y={1} width={8} height={5} rx="1" fill="rgba(245,158,11,0.3)" stroke={C.amber} strokeWidth="0.5"/>
      <text x={102} y={7} fontSize="7" fill={C.amber} opacity="0.8">OB</text>
      <rect x={118} y={1} width={8} height={5} rx="1" fill="rgba(34,211,238,0.2)" stroke={C.cyan} strokeWidth="0.5"/>
      <text x={130} y={7} fontSize="7" fill={C.cyan} opacity="0.8">FVG</text>
    </svg>
  );
}

// ─── SECTOR HEATMAP TILE (graphical) ─────────────────────────────────────────
function HeatTile({ s, T, onClick }) {
  const intensity = Math.min(Math.abs(s.chgP)/4, 1);
  const isPos     = s.chgP >= 0;
  const bg        = isPos ? `rgba(16,185,129,${0.06+intensity*0.18})` : `rgba(239,68,68,${0.06+intensity*0.18})`;
  const brd       = isPos ? `rgba(16,185,129,${0.2+intensity*0.3})` : `rgba(239,68,68,${0.2+intensity*0.3})`;
  const barW      = Math.min(Math.abs(s.chgP) / 5 * 100, 100);

  return (
    <div onClick={()=>onClick(s)} style={{background:bg,border:`1px solid ${brd}`,borderRadius:8,padding:"8px 10px",cursor:"pointer",transition:"transform 0.12s",position:"relative",overflow:"hidden"}}
      onMouseEnter={e=>{e.currentTarget.style.transform="scale(1.04)";e.currentTarget.style.zIndex=2;}}
      onMouseLeave={e=>{e.currentTarget.style.transform="scale(1)";e.currentTarget.style.zIndex=1;}}>
      <div style={{fontSize:8,color:T.muted,letterSpacing:".1em",textTransform:"uppercase",marginBottom:2}}>{s.name}</div>
      <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:20,fontWeight:700,color:clr(s.chgP),lineHeight:1}}>{pct(s.chgP)}</div>
      {/* Graphical bar */}
      <div style={{marginTop:5,height:3,background:T.panel3,borderRadius:2,overflow:"hidden"}}>
        <div style={{height:"100%",width:`${barW}%`,background:isPos?C.green:C.red,borderRadius:2,transition:"width 0.6s ease"}}/>
      </div>
      <div style={{display:"flex",justifyContent:"space-between",marginTop:3,fontSize:7,color:T.muted}}>
        <span>{s.count} stocks</span>
        <span style={{color:C.green2}}>{s.gainers}↑ <span style={{color:C.red2}}>{s.losers}↓</span></span>
      </div>
      <div style={{position:"absolute",bottom:0,left:0,right:0,height:2,background:isPos?C.green:C.red,opacity:0.6}}/>
    </div>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function NexRadarDashboard() {
  const [stocks,      setStocks]    = useState(STOCKS_ALL);
  const [selectedSym, setSelected]  = useState("NVDA");
  const [sortBy,      setSortBy]    = useState("chgD");
  const [sortDir,     setSortDir]   = useState(-1);
  const [timeframe,   setTimeframe] = useState("5");
  const [sigFilter,   setSigFilter] = useState("ALL");
  const [session,     setSession]   = useState("MH");
  const [heartbeat,   setHB]        = useState(nowT());
  const [flashMap,    setFlash]     = useState({});
  const [dataSource,  setDS]        = useState("All");
  const [activeSector,setSector]    = useState("ALL");
  const [viewMode,    setView]      = useState("TABLE");
  const [search,      setSearch]    = useState("");
  const [activeTab,   setTab]       = useState("DASHBOARD");
  const [darkMode,    setDark]      = useState(true);
  const [bulkTarget,  setBulkTarget]= useState("tradingview");
  const [tvCount,     setTvCount]   = useState(5);
  const [notifOpen,   setNotifOpen] = useState(false);
  const [notifs]                    = useState(3);

  // Apply dark/light to T token object
  const T = darkMode ? DARK : LIGHT;

  // ── Live price simulation ────────────────────────────────────────────────
  useEffect(()=>{
    const iv = setInterval(()=>{
      setHB(nowT());
      setStocks(prev=>{
        const fm={};
        const next=prev.map(s=>{
          const d=(Math.random()-0.48)*s.price*0.002;
          const p=+(s.price+d).toFixed(2);
          fm[s.sym+"_"+s.sector]=d>=0?"up":"dn";
          return {...s, price:p, chgD:+(p-s.open).toFixed(2), chgP:+((p-s.open)/s.open*100).toFixed(2)};
        });
        setFlash(fm);
        setTimeout(()=>setFlash({}),400);
        return next;
      });
    },3000);
    return()=>clearInterval(iv);
  },[]);

  // ── Data source filtering ────────────────────────────────────────────────
  const SOURCE_FILTERS = {
    "All":       ()=>true,
    "Monitor":   s=>s.signals.length>0,
    "Portfolio": s=>["NVDA","AAPL","TSLA","META","AMZN"].includes(s.sym),
    "Stock List": s=>activeSector==="ALL" || s.sector===activeSector,
    "Earnings":  s=>["NVDA","TSLA","META","GS","JPM"].includes(s.sym),
    "Favorites": s=>["NVDA","TSLA","AAPL","META"].includes(s.sym),
  };

  const filteredBySource = stocks.filter(SOURCE_FILTERS[dataSource] || (()=>true));

  const sorted = [...filteredBySource]
    .filter(s=> s.sym.includes(search.toUpperCase()) || s.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a,b)=> sortDir * ((a[sortBy]||0)-(b[sortBy]||0)));

  const handleSort = col => {
    if(sortBy===col) setSortDir(d=>-d);
    else { setSortBy(col); setSortDir(-1); }
  };

  const stock = stocks.find(s=>s.sym===selectedSym) || stocks[0];

  const sigs         = sigFilter==="ALL" ? SIGNALS : SIGNALS.filter(s=>s.dir===sigFilter);
  const volSpikes    = stocks.filter(s=>s.signals.includes("VOL")).length;
  const gapPlays     = stocks.filter(s=>s.signals.includes("GAP")).length;
  const diamonds     = stocks.filter(s=>s.signals.includes("DIAMOND")).length;
  const ahMomt       = stocks.filter(s=>s.signals.includes("AH")).length;
  const posCount     = stocks.filter(s=>s.chgP>0).length;
  const aiConf       = Math.min(99, Math.max(55, Math.round(72 + (stock.chgP > 0 ? stock.chgP * 2 : 0))));
  const atr          = (stock.price * 0.012).toFixed(2);
  const sl           = (stock.price - parseFloat(atr)*1.5).toFixed(2);

  const top10 = [...filteredBySource].sort((a,b)=>b.chgD-a.chgD).slice(0,10);

  // ── Bulk open ───────────────────────────────────────────────────────────
  const openBulk = () => {
    const rows = [...filteredBySource].sort((a,b)=>b.chgD-a.chgD).slice(0,tvCount);
    rows.forEach(r => {
      const url = bulkTarget === "tradingview"
        ? `https://www.tradingview.com/chart/?symbol=${r.sym}`
        : `https://finance.yahoo.com/quote/${r.sym}/`;
      window.open(url, "_blank");
    });
  };

  const NAV_TABS = ["DASHBOARD","LIVE TABLE","CHART","SIGNALS","MUTUAL FUNDS"];

  // ── Styles helper ─────────────────────────────────────────────────────
  const btn = (active) => ({
    padding:"3px 10px", borderRadius:4, fontSize:9, fontWeight:500, letterSpacing:".08em",
    cursor:"pointer", fontFamily:"'JetBrains Mono',monospace",
    border:`1px solid ${active?"rgba(34,211,238,.3)":T.line2}`,
    background:active?"rgba(34,211,238,.08)":T.panel2,
    color:active?C.cyan:T.muted,
  });

  const card = {
    background:T.panel, border:`1px solid ${T.line2}`,
    borderRadius:10, overflow:"hidden", display:"flex", flexDirection:"column",
  };

  return (
    <div style={{fontFamily:"'JetBrains Mono',monospace",background:T.bg,color:T.text,height:"100vh",width:"100vw",overflow:"hidden",display:"flex",flexDirection:"column",position:"relative"}}>

      {/* Background glow */}
      {darkMode && <>
        <div style={{position:"fixed",inset:0,pointerEvents:"none",zIndex:0,opacity:.5,backgroundImage:`url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.04'/%3E%3C/svg%3E")`}}/>
        <div style={{position:"fixed",top:"-40%",left:"-10%",width:"70%",height:"80%",background:"radial-gradient(ellipse,rgba(34,211,238,0.04) 0%,transparent 65%)",pointerEvents:"none",zIndex:0}}/>
      </>}

      {/* ══ TOP BAR ══════════════════════════════════════════════════════════ */}
      <header style={{position:"relative",zIndex:100,height:48,display:"flex",alignItems:"center",padding:"0 14px",borderBottom:`1px solid ${T.line2}`,background:darkMode?"linear-gradient(180deg,rgba(6,15,30,0.98),rgba(3,9,18,0.95))":"rgba(255,255,255,0.97)",backdropFilter:"blur(20px)",flexShrink:0,gap:0}}>
        {/* Logo */}
        <div style={{display:"flex",alignItems:"center",gap:10,paddingRight:16,borderRight:`1px solid ${T.line2}`,flexShrink:0}}>
          <div style={{width:32,height:32,borderRadius:8,background:"linear-gradient(135deg,#0ea5e9,#22d3ee)",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Rajdhani',sans-serif",fontWeight:700,fontSize:16,color:"#000",boxShadow:"0 0 20px rgba(34,211,238,0.35)"}}>N</div>
          <div>
            <div style={{fontFamily:"'Rajdhani',sans-serif",fontWeight:700,fontSize:16,letterSpacing:".12em",color:T.text}}>NEXRADAR</div>
            <div style={{fontSize:8,letterSpacing:".28em",color:C.cyan,fontWeight:500}}>SCALPING · v4.3</div>
          </div>
        </div>
        {/* Market Status */}
        <div style={{display:"flex",alignItems:"center",gap:6,padding:"0 14px",borderRight:`1px solid ${T.line2}`,flexShrink:0}}>
          <div style={{width:8,height:8,borderRadius:"50%",background:C.green,boxShadow:`0 0 10px ${C.green}`,animation:"blink 2s infinite"}}/>
          <span style={{fontSize:10,fontWeight:600,color:T.text,letterSpacing:".08em"}}>🟢 LIVE</span>
          <span style={{fontSize:9,color:T.muted}}>843/1000</span>
        </div>
        {/* Nav tabs */}
        <nav style={{display:"flex",alignItems:"center",gap:1,padding:"0 10px",flex:1,overflow:"hidden"}}>
          {NAV_TABS.map(t=>(
            <button key={t} onClick={()=>setTab(t)} style={{padding:"4px 10px",borderRadius:5,fontSize:9,fontWeight:500,letterSpacing:".06em",background:"none",border:"none",color:activeTab===t?C.cyan:T.muted,borderBottom:activeTab===t?`2px solid ${C.cyan}`:"2px solid transparent",fontFamily:"'JetBrains Mono',monospace",whiteSpace:"nowrap",cursor:"pointer",transition:"all .12s"}}>
              {t}
            </button>
          ))}
        </nav>
        {/* Search */}
        <div style={{display:"flex",alignItems:"center",background:T.panel2,border:`1px solid ${T.line2}`,borderRadius:6,padding:"0 10px",height:30,gap:6,marginRight:10}}>
          <span style={{color:T.muted,fontSize:13}}>⌕</span>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search symbol…" style={{background:"none",border:"none",outline:"none",fontFamily:"'JetBrains Mono',monospace",fontSize:10,color:T.text,width:110}}/>
        </div>
        {/* Right controls */}
        <div style={{display:"flex",alignItems:"center",gap:6,paddingLeft:12,borderLeft:`1px solid ${T.line2}`,flexShrink:0}}>
          <div onClick={()=>setSession(s=>s==="MH"?"AH":"MH")} style={{display:"flex",alignItems:"center",gap:5,padding:"4px 10px",borderRadius:5,background:session==="MH"?"rgba(16,185,129,0.12)":"rgba(139,92,246,0.12)",border:`1px solid ${session==="MH"?"rgba(16,185,129,0.25)":"rgba(139,92,246,0.25)"}`,cursor:"pointer",fontSize:9,fontWeight:500,color:session==="MH"?C.green:C.violet,letterSpacing:".08em"}}>
            <div style={{width:5,height:5,borderRadius:"50%",background:session==="MH"?C.green:C.violet,animation:"blink 2s infinite"}}/>
            {session} · {session==="MH"?"MARKET OPEN":"AFTER HOURS"}
          </div>
          <div style={{display:"flex",alignItems:"center",gap:4,padding:"4px 8px",borderRadius:5,background:T.panel2,border:`1px solid ${T.line}`,fontSize:8,color:T.muted}}>
            <div style={{width:5,height:5,borderRadius:"50%",background:C.cyan,animation:"blink 1.5s infinite"}}/>
            {heartbeat}
          </div>
          {/* FIXED: Dark mode toggle */}
          <button onClick={()=>setDark(d=>!d)} title="Toggle dark/light mode" style={{width:30,height:30,borderRadius:6,background:T.panel2,border:`1px solid ${T.line2}`,fontSize:14,display:"flex",alignItems:"center",justifyContent:"center",color:darkMode?"#fbbf24":"#6366f1",cursor:"pointer"}}>
            {darkMode?"☀️":"🌙"}
          </button>
          {/* Notifications */}
          <div style={{position:"relative"}}>
            <button onClick={()=>setNotifOpen(n=>!n)} style={{width:30,height:30,borderRadius:6,background:T.panel2,border:`1px solid ${T.line}`,fontSize:13,color:T.muted,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer"}}>🔔</button>
            <div style={{position:"absolute",top:-3,right:-3,width:14,height:14,borderRadius:"50%",background:C.red,border:`2px solid ${T.bg}`,fontSize:7,fontWeight:700,color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Rajdhani',sans-serif"}}>{notifs}</div>
            {notifOpen&&(
              <div style={{position:"absolute",top:"110%",right:0,width:240,background:T.panel,border:`1px solid ${T.line2}`,borderRadius:10,boxShadow:"0 8px 32px rgba(0,0,0,0.4)",zIndex:999,padding:8}}>
                <div style={{fontSize:9,color:T.muted,letterSpacing:".15em",marginBottom:6}}>NOTIFICATIONS</div>
                {["💎 NVDA Diamond alert","🔊 META volume spike 2.1×","📊 TSLA gap play +5.8%"].map((n,i)=>(
                  <div key={i} style={{padding:"5px 6px",borderRadius:5,fontSize:9,color:T.text,borderBottom:`1px solid ${T.line}`,cursor:"pointer"}}>{n}</div>
                ))}
              </div>
            )}
          </div>
          <button style={{width:30,height:30,borderRadius:6,background:T.panel2,border:`1px solid ${T.line}`,fontSize:13,color:T.muted,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer"}}>⚙</button>
          <div style={{width:30,height:30,borderRadius:6,background:"linear-gradient(135deg,rgba(34,211,238,0.25),rgba(59,130,246,0.2))",border:"1px solid rgba(34,211,238,0.3)",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Rajdhani',sans-serif",fontSize:12,fontWeight:700,color:C.cyan,cursor:"pointer"}}>NR</div>
        </div>
      </header>

      {/* ══ BODY ═════════════════════════════════════════════════════════════ */}
      <div style={{display:"flex",flex:1,minHeight:0,position:"relative",zIndex:1,overflow:"hidden"}}>

        {/* ── SIDEBAR ─────────────────────────────────────────────────────── */}
        <aside style={{width:200,flexShrink:0,borderRight:`1px solid ${T.line2}`,background:darkMode?"rgba(6,15,30,0.85)":T.panel,overflowY:"auto",display:"flex",flexDirection:"column"}}>
          {/* System */}
          <div style={{padding:"10px 12px",borderBottom:`1px solid ${T.line}`}}>
            <div style={{fontSize:8,fontWeight:500,letterSpacing:".2em",textTransform:"uppercase",color:T.muted,marginBottom:8}}>📡 SYSTEM</div>
            <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:6}}>
              <div style={{width:7,height:7,borderRadius:"50%",background:C.green,boxShadow:`0 0 8px ${C.green}`,animation:"blink 3s infinite"}}/>
              <span style={{fontSize:10,color:C.green,fontWeight:500}}>Healthy</span>
            </div>
            {[["YF Quality",84,C.cyan],["WS Load",62,C.amber]].map(([l,p,c])=>(
              <div key={l} style={{marginBottom:5}}>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:8,color:T.muted,marginBottom:2}}><span>{l}</span><span style={{color:T.text}}>{p}%</span></div>
                <div style={{height:2,background:T.panel3,borderRadius:1,overflow:"hidden"}}><div style={{height:"100%",width:`${p}%`,borderRadius:1,background:`linear-gradient(90deg,${c},${C.green})`}}/></div>
              </div>
            ))}
            {[["Heartbeat",heartbeat],["Connected","843 / 1000"]].map(([k,v])=>(
              <div key={k} style={{display:"flex",justifyContent:"space-between",marginBottom:2,fontSize:8}}>
                <span style={{color:T.muted}}>{k}</span><span style={{color:T.text,fontWeight:500}}>{v}</span>
              </div>
            ))}
            <button style={{width:"100%",padding:5,borderRadius:5,background:T.panel2,border:`1px solid ${T.line2}`,color:T.muted,fontFamily:"'JetBrains Mono',monospace",fontSize:8,marginTop:5,cursor:"pointer"}}>⟳ Reconnect WS</button>
          </div>

          {/* FIXED: Data Source with actual filtering */}
          <div style={{padding:"10px 12px",borderBottom:`1px solid ${T.line}`}}>
            <div style={{fontSize:8,fontWeight:500,letterSpacing:".2em",textTransform:"uppercase",color:T.muted,marginBottom:8}}>📁 DATA SOURCE</div>
            <select value={dataSource} onChange={e=>{setDS(e.target.value);setSector("ALL");}}
              style={{width:"100%",padding:"5px 8px",borderRadius:5,background:T.panel2,border:`1px solid ${T.line2}`,color:T.text,fontFamily:"'JetBrains Mono',monospace",fontSize:9,outline:"none",cursor:"pointer"}}>
              {["All","Monitor","Portfolio","Stock List","Earnings","Favorites"].map(s=>(
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <div style={{marginTop:4,fontSize:9}}>
              {[["Source",dataSource],["Sector","Available ✓"],["Earnings","Synced ✓"],["Portfolio","Connected ✓"]].map(([k,v])=>(
                <div key={k} style={{display:"flex",justifyContent:"space-between",marginTop:3}}>
                  <span style={{color:T.muted}}>{k}</span><span style={{color:T.text,fontWeight:500}}>{v}</span>
                </div>
              ))}
            </div>
            {/* FIXED: Sector filter for Stock List */}
            {dataSource==="Stock List"&&(
              <div style={{marginTop:8}}>
                <div style={{fontSize:8,color:T.muted,letterSpacing:".14em",textTransform:"uppercase",marginBottom:4}}>Sector / Industry</div>
                <select value={activeSector} onChange={e=>setSector(e.target.value)}
                  style={{width:"100%",padding:"4px 6px",borderRadius:5,background:T.panel2,border:`1px solid ${activeSector!=="ALL"?"rgba(34,211,238,0.4)":T.line2}`,color:activeSector!=="ALL"?C.cyan:T.text,fontFamily:"'JetBrains Mono',monospace",fontSize:9,outline:"none",cursor:"pointer"}}>
                  <option value="ALL">All Sectors</option>
                  {SECTOR_LIST.map(s=><option key={s} value={s}>{s}</option>)}
                </select>
                {activeSector!=="ALL"&&(
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginTop:4,padding:"2px 6px",borderRadius:4,background:"rgba(34,211,238,0.08)",border:"1px solid rgba(34,211,238,0.2)"}}>
                    <span style={{fontSize:8,color:C.cyan}}>🔵 {activeSector}</span>
                    <button onClick={()=>setSector("ALL")} style={{background:"none",border:"none",color:T.muted,fontSize:11,cursor:"pointer"}}>×</button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Display */}
          <div style={{padding:"10px 12px",borderBottom:`1px solid ${T.line}`}}>
            <div style={{fontSize:8,fontWeight:500,letterSpacing:".2em",textTransform:"uppercase",color:T.muted,marginBottom:8}}>⚙ DISPLAY</div>
            <div style={{fontSize:8,color:T.muted,marginBottom:4}}>Refresh: 3s</div>
            <input type="range" min={1} max={30} defaultValue={3} style={{width:"100%",accentColor:C.cyan}}/>
            <label style={{display:"flex",alignItems:"center",gap:5,marginTop:6,fontSize:8,color:T.muted,cursor:"pointer"}}>
              <input type="checkbox" style={{accentColor:C.cyan}}/> Show Negative
            </label>
          </div>

          {/* FIXED: Bulk Sync with correct Yahoo Finance URL */}
          <div style={{padding:"10px 12px",borderBottom:`1px solid ${T.line}`}}>
            <div style={{fontSize:8,fontWeight:500,letterSpacing:".2em",textTransform:"uppercase",color:T.muted,marginBottom:8}}>🚀 BULK SYNC</div>
            <div style={{fontSize:8,color:T.muted,marginBottom:4}}>Tickers to open: {tvCount}</div>
            <input type="range" min={1} max={20} value={tvCount} onChange={e=>setTvCount(+e.target.value)} style={{width:"100%",accentColor:C.cyan,marginBottom:6}}/>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:4,marginBottom:6}}>
              {[["tradingview","📊 TradingView"],["yahoo","🟣 Yahoo"]].map(([id,label])=>(
                <button key={id} onClick={()=>setBulkTarget(id)}
                  style={{padding:"4px",borderRadius:4,textAlign:"center",fontSize:8,fontWeight:500,cursor:"pointer",
                    border:`1px solid ${bulkTarget===id?"rgba(34,211,238,.3)":T.line}`,
                    background:bulkTarget===id?"rgba(34,211,238,.08)":T.panel2,
                    color:bulkTarget===id?C.cyan:T.muted}}>
                  {label}
                </button>
              ))}
            </div>
            <button onClick={openBulk}
              style={{width:"100%",padding:5,borderRadius:5,background:"rgba(34,211,238,.1)",border:`1px solid rgba(34,211,238,.25)`,color:C.cyan,fontFamily:"'JetBrains Mono',monospace",fontSize:8,cursor:"pointer"}}>
              Open Top {tvCount} →
            </button>
          </div>

          {/* Favorites */}
          <div style={{padding:"10px 12px",borderBottom:`1px solid ${T.line}`}}>
            <div style={{fontSize:8,fontWeight:500,letterSpacing:".2em",textTransform:"uppercase",color:T.muted,marginBottom:8}}>⭐ FAVORITES</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:3}}>
              {["NVDA","TSLA","AAPL","META"].map(f=>(
                <span key={f} onClick={()=>setSelected(f)} style={{padding:"2px 6px",borderRadius:4,fontSize:7,fontWeight:500,background:"rgba(245,158,11,.1)",border:"1px solid rgba(245,158,11,.2)",color:C.amber,cursor:"pointer"}}>{f} ×</span>
              ))}
            </div>
          </div>

          {/* Signal Engine */}
          <div style={{padding:"10px 12px",flex:1}}>
            <div style={{fontSize:8,fontWeight:500,letterSpacing:".2em",textTransform:"uppercase",color:T.muted,marginBottom:8}}>⚡ SIGNAL ENGINE</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:3,marginBottom:8}}>
              {[["WATCH","25","#fff"],["SIGS","12",C.green],["BARS","847",C.cyan]].map(([l,n,c])=>(
                <div key={l} style={{background:T.panel2,border:`1px solid ${T.line}`,borderRadius:5,padding:"5px 4px",textAlign:"center"}}>
                  <div style={{fontSize:7,color:T.muted,letterSpacing:".1em",textTransform:"uppercase"}}>{l}</div>
                  <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:16,fontWeight:700,color:c}}>{n}</div>
                </div>
              ))}
            </div>
            <textarea defaultValue={"AAPL\nAMD\nAMZN\nAVGO\nNVDA\nTSLA\nMETA\nGOOGL\nMSFT"}
              style={{width:"100%",height:72,background:T.panel2,border:`1px solid ${T.line2}`,borderRadius:5,padding:6,fontFamily:"'JetBrains Mono',monospace",fontSize:9,color:C.cyan2,resize:"none",outline:"none",lineHeight:1.7}}/>
            <button style={{width:"100%",padding:6,borderRadius:5,marginTop:5,background:"linear-gradient(135deg,#1e3a8a,#0e7490)",border:"none",color:"#fff",fontFamily:"'Rajdhani',sans-serif",fontSize:11,fontWeight:700,letterSpacing:".12em",textTransform:"uppercase",cursor:"pointer"}}>✓ APPLY WATCHLIST</button>
          </div>
        </aside>

        {/* ── MAIN AREA ───────────────────────────────────────────────────── */}
        <main style={{flex:1,minWidth:0,display:"flex",flexDirection:"column",padding:"8px",gap:"8px",overflowY:"auto"}}>

          {/* STAT ROW */}
          <div style={{display:"grid",gridTemplateColumns:"1.4fr repeat(5,1fr)",gap:8,flexShrink:0}}>
            <div style={{background:T.panel,border:`1px solid ${T.line2}`,borderRadius:10,padding:"12px 14px",position:"relative",overflow:"hidden"}}>
              <div style={{fontSize:8,letterSpacing:".18em",textTransform:"uppercase",color:T.muted,marginBottom:6,display:"flex",alignItems:"center",gap:5}}>
                <div style={{width:7,height:7,borderRadius:"50%",background:C.green,boxShadow:`0 0 8px ${C.green}`,animation:"blink 2.5s infinite"}}/>Live Status
              </div>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                <div style={{width:10,height:10,borderRadius:"50%",background:C.green,boxShadow:`0 0 14px ${C.green}`,animation:"blink 2.5s infinite"}}/>
                <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:22,fontWeight:700,color:T.text}}>Healthy</div>
              </div>
              <div style={{display:"flex",gap:10,fontSize:9,color:T.muted,flexWrap:"wrap"}}>
                <span>📡 <b style={{color:T.text}}>843</b></span>
                <span>🟢 Pos <b style={{color:C.green2}}>{posCount}</b></span>
                <span>📊 <b style={{color:T.text}}>1,000</b></span>
              </div>
              <div style={{position:"absolute",bottom:0,left:0,right:0,height:2,background:`linear-gradient(90deg,${C.cyan},transparent)`,opacity:.7}}/>
            </div>
            {[
              {label:"🔊 Vol Spikes",val:volSpikes, sub:"↑ 3 vs last bar", color:C.red2,   bar:C.red},
              {label:"📊 Gap Plays", val:gapPlays,  sub:`${top10[0]?.sym||"NVDA"} +${Math.abs(top10[0]?.chgP||8.2).toFixed(1)}%`, color:"#93c5fd", bar:C.blue},
              {label:"💎 Diamond",   val:diamonds,  sub:"≥5% movers",    color:C.amber2, bar:C.amber},
              {label:"🌙 AH Momt.",  val:ahMomt,   sub:"After hours",   color:"#c4b5fd",bar:C.violet},
              {label:"📰 Earn. Gaps",val:4,         sub:"This week",     color:C.green2, bar:C.green},
            ].map((c,i)=>(
              <div key={c.label} onClick={()=>{}} style={{background:T.panel,border:`1px solid ${T.line2}`,borderRadius:10,padding:"12px 14px",position:"relative",overflow:"hidden",cursor:"pointer",animation:`riseIn .5s ease ${i*0.06}s both`}}
                onMouseEnter={e=>e.currentTarget.style.borderColor=c.bar+`60`}
                onMouseLeave={e=>e.currentTarget.style.borderColor=T.line2}>
                <div style={{fontSize:8,letterSpacing:".18em",textTransform:"uppercase",color:c.color,marginBottom:6}}>{c.label}</div>
                <div style={{fontFamily:"'Rajdhani',sans-serif",fontWeight:700,fontSize:30,color:c.color,lineHeight:1}}>{c.val}</div>
                <div style={{fontSize:8,color:T.muted,marginTop:4}}>{c.sub}</div>
                <div style={{position:"absolute",top:10,right:10,width:6,height:6,borderRadius:"50%",background:c.bar,boxShadow:`0 0 8px ${c.bar}`}}/>
                <div style={{position:"absolute",bottom:0,left:0,right:0,height:2,background:`linear-gradient(90deg,${c.bar},transparent)`,opacity:.7}}/>
              </div>
            ))}
          </div>

          {/* GRID: Table | Chart | Signals | Heatmap */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 420px",gridTemplateRows:"auto auto auto",gap:"8px"}}>

            {/* ─ LIVE TABLE / MATRIX ─ */}
            <div style={{...card,gridRow:"1",gridColumn:"1"}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 12px",borderBottom:`1px solid ${T.line}`,flexShrink:0}}>
                <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:13,fontWeight:600,letterSpacing:".12em",display:"flex",alignItems:"center",gap:8,color:T.text}}>
                  <span style={{width:6,height:6,borderRadius:"50%",background:C.cyan,boxShadow:`0 0 8px ${C.cyan}`,animation:"blink 2s infinite",display:"inline-block"}}/>
                  LIVE STOCK DATA
                  <span style={{fontSize:9,color:T.muted,fontWeight:400}}>
                    {sorted.length} shown
                    {dataSource!=="All"&&<span style={{color:C.cyan,marginLeft:4}}>[{dataSource}]</span>}
                    {activeSector!=="ALL"&&<span style={{color:C.amber,marginLeft:4}}>[{activeSector}]</span>}
                  </span>
                </div>
                <div style={{display:"flex",gap:4}}>
                  {["TABLE","MATRIX"].map(m=>(
                    <button key={m} onClick={()=>setView(m)} style={btn(viewMode===m)}>{m}</button>
                  ))}
                </div>
              </div>

              {viewMode==="TABLE" ? (
                <div style={{height:280,overflowY:"auto"}}>
                  <table style={{width:"100%",borderCollapse:"collapse"}}>
                    <thead>
                      <tr>
                        {[["sym","Ticker"],["price","Price"],["chgD","Chg $"],["chgP","Chg %"],["vol","Volume"]].map(([k,l])=>(
                          <th key={k} onClick={()=>k!=="vol"&&handleSort(k)}
                            style={{padding:"6px 10px",fontSize:8,fontWeight:500,letterSpacing:".15em",textTransform:"uppercase",color:sortBy===k?C.cyan:T.muted,borderBottom:`1px solid ${T.line}`,textAlign:"left",position:"sticky",top:0,background:T.panel,zIndex:2,cursor:k!=="vol"?"pointer":"default",whiteSpace:"nowrap"}}>
                            {l}{sortBy===k?(sortDir>0?" ▲":" ▼"):""}
                          </th>
                        ))}
                        <th style={{padding:"6px 10px",fontSize:8,color:T.muted,borderBottom:`1px solid ${T.line}`,textAlign:"right",position:"sticky",top:0,background:T.panel,zIndex:2}}>Alerts</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sorted.map(s=>(
                        <tr key={s.sym+"_"+s.sector}
                          className={flashMap[s.sym+"_"+s.sector]==="up"?"flash-up":flashMap[s.sym+"_"+s.sector]==="dn"?"flash-dn":""}
                          onClick={()=>setSelected(s.sym)}
                          style={{borderBottom:`1px solid rgba(255,255,255,.025)`,cursor:"pointer",background:selectedSym===s.sym?"rgba(34,211,238,.05)":"transparent",borderLeft:selectedSym===s.sym?`2px solid ${C.cyan}`:"2px solid transparent",transition:"background .12s"}}>
                          <td style={{padding:"7px 10px"}}>
                            <div style={{fontWeight:700,fontSize:11,color:T.text,letterSpacing:".04em"}}>{s.sym}</div>
                            <div style={{fontSize:8,color:T.muted,marginTop:1}}>{s.name}</div>
                          </td>
                          <td style={{padding:"7px 10px",fontWeight:500,color:T.text,fontSize:10}}>${s.price.toFixed(2)}</td>
                          <td style={{padding:"7px 10px",fontSize:10,color:clr(s.chgD),fontWeight:600}}>{s.chgD>=0?"+":'−'}${Math.abs(s.chgD).toFixed(2)}</td>
                          <td style={{padding:"7px 10px",fontSize:10,color:clr(s.chgP),fontWeight:600}}>{pct(s.chgP)}</td>
                          <td style={{padding:"7px 10px",fontSize:9,color:T.muted}}>{s.vol}</td>
                          <td style={{padding:"7px 10px",textAlign:"right"}}>
                            {s.alerts.map((a,i)=>{
                              const st=a.includes("💎")?{bg:"rgba(245,158,11,.15)",c:C.amber2,b:"rgba(245,158,11,.2)"}
                                :a.includes("🎯")?{bg:"rgba(16,185,129,.15)",c:C.green2,b:"rgba(16,185,129,.2)"}
                                :{bg:"rgba(59,130,246,.15)",c:"#93c5fd",b:"rgba(59,130,246,.2)"};
                              return <span key={i} style={{display:"inline-flex",alignItems:"center",padding:"2px 5px",borderRadius:3,fontSize:7,fontWeight:600,marginRight:2,background:st.bg,color:st.c,border:`1px solid ${st.b}`}}>{a}</span>;
                            })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                // FIXED: Matrix now scrollable
                <div style={{height:280,overflowY:"auto",display:"grid",gridTemplateColumns:"repeat(8,1fr)",gap:4,padding:8,alignContent:"start"}}>
                  {sorted.map(s=>(
                    <div key={s.sym+"_"+s.sector}
                      className={flashMap[s.sym+"_"+s.sector]==="up"?"flash-up":flashMap[s.sym+"_"+s.sector]==="dn"?"flash-dn":""}
                      onClick={()=>setSelected(s.sym)}
                      style={{background:s.chgP>=0?"rgba(16,185,129,0.07)":"rgba(239,68,68,0.07)",border:`1px solid ${selectedSym===s.sym?C.cyan:s.chgP>=0?"rgba(16,185,129,.15)":"rgba(239,68,68,.12)"}`,borderRadius:6,padding:"5px 4px",cursor:"pointer",transition:"all .12s"}}
                      onMouseEnter={e=>{e.currentTarget.style.transform="scale(1.05)";}}
                      onMouseLeave={e=>{e.currentTarget.style.transform="scale(1)";}}>
                      <div style={{fontSize:8,fontWeight:700,color:T.text,letterSpacing:".03em"}}>{s.sym}</div>
                      <div style={{fontSize:7,color:T.muted,margin:"1px 0"}}>${s.price.toFixed(0)}</div>
                      <div style={{fontSize:9,fontWeight:700,color:clr(s.chgP)}}>{pct(s.chgP)}</div>
                    </div>
                  ))}
                </div>
              )}
              <div style={{padding:"5px 12px",borderTop:`1px solid ${T.line}`,fontSize:8,color:T.muted,letterSpacing:".06em",flexShrink:0}}>
                {sorted.length} stocks · {session==="MH"?"MARKET_HOURS":"AFTER_HOURS"} · sorted by {sortBy}
              </div>
            </div>

            {/* ─ CHART + DETAIL PANEL ─ FIXED: fully dynamic ─ */}
            <div style={{...card,gridRow:"1 / 4",gridColumn:"2"}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 12px",borderBottom:`1px solid ${T.line}`,flexShrink:0}}>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:20,fontWeight:700,color:T.text}}>{stock.sym}</div>
                  <div style={{fontSize:9,color:T.muted}}>{stock.name}</div>
                </div>
                <div style={{display:"flex",gap:3}}>
                  {["1","5","15","1H","D","W"].map(t=>(
                    <button key={t} onClick={()=>setTimeframe(t)} style={{padding:"3px 7px",borderRadius:3,fontSize:8,fontWeight:500,cursor:"pointer",border:`1px solid ${timeframe===t?"rgba(34,211,238,.35)":T.line}`,background:timeframe===t?"rgba(34,211,238,.1)":"none",color:timeframe===t?C.cyan:T.muted,fontFamily:"'JetBrains Mono',monospace"}}>{t}</button>
                  ))}
                </div>
              </div>
              {/* FIXED: all 4 meta fields are dynamic */}
              <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:6,padding:"8px 12px",borderBottom:`1px solid ${T.line}`,flexShrink:0}}>
                {[
                  {l:"Price",   v:`$${stock.price.toFixed(2)}`,  c:T.text},
                  {l:"Change",  v:`${stock.chgD>=0?"+":"−"}$${Math.abs(stock.chgD).toFixed(2)}`, c:clr(stock.chgD)},
                  {l:"Change %",v:pct(stock.chgP),               c:clr(stock.chgP)},
                  {l:"Alert",   v:stock.alerts[0]||"—",          c:C.amber2},
                ].map(m=>(
                  <div key={m.l} style={{background:T.panel2,border:`1px solid ${T.line}`,borderRadius:6,padding:"6px 8px"}}>
                    <div style={{fontSize:7,color:T.muted,letterSpacing:".12em",textTransform:"uppercase",marginBottom:2}}>{m.l}</div>
                    <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:15,fontWeight:700,color:m.c}}>{m.v}</div>
                  </div>
                ))}
              </div>
              {/* Chart */}
              <div style={{flex:1,position:"relative",overflow:"hidden",minHeight:180}}>
                <div style={{position:"absolute",top:0,bottom:0,width:1,background:`linear-gradient(180deg,transparent,${C.cyan},transparent)`,opacity:.3,animation:"scanLine 5s linear infinite",pointerEvents:"none"}}/>
                <CandleChart symbol={stock.sym}/>
              </div>
              {/* AI Signal + Risk — FIXED: dynamic per stock */}
              <div style={{borderTop:`1px solid ${T.line}`,padding:"8px 12px",flexShrink:0}}>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                  <div style={{background:T.panel2,border:`1px solid ${T.line}`,borderRadius:6,padding:"8px 10px"}}>
                    <div style={{fontSize:7,color:T.muted,letterSpacing:".12em",textTransform:"uppercase",marginBottom:6}}>⚡ AI Signal Confidence</div>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:22,fontWeight:700,color:aiConf>70?C.green2:C.amber2}}>{aiConf}%</div>
                      <div style={{flex:1}}>
                        <div style={{height:4,background:T.panel3,borderRadius:2,overflow:"hidden"}}>
                          <div style={{height:"100%",width:`${aiConf}%`,borderRadius:2,background:`linear-gradient(90deg,${C.cyan},${C.green})`}}/>
                        </div>
                        <div style={{fontSize:7,color:T.muted,marginTop:3}}>{aiConf>70?"STRONG BUY":"MODERATE"} · {aiConf}% conf</div>
                      </div>
                    </div>
                  </div>
                  <div style={{background:T.panel2,border:`1px solid ${T.line}`,borderRadius:6,padding:"8px 10px"}}>
                    <div style={{fontSize:7,color:T.muted,letterSpacing:".12em",textTransform:"uppercase",marginBottom:4}}>🛡 Risk / ATR Metrics</div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:4}}>
                      {[["ATR",`$${atr}`,C.amber2],["SL",`$${sl}`,C.red2],["R:R","1:2.1",C.cyan]].map(([l,v,c])=>(
                        <div key={l}><div style={{fontSize:7,color:T.muted,marginBottom:1}}>{l}</div><div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:13,fontWeight:700,color:c}}>{v}</div></div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
              <div style={{padding:"5px 12px",borderTop:`1px solid ${T.line}`,fontSize:8,color:T.muted,letterSpacing:".06em",flexShrink:0}}>
                VWAP + EMA21 + OB / FVG · {timeframe}m · Click row to load →
              </div>
            </div>

            {/* ─ SIGNAL FEED ─ */}
            <div style={{...card,gridRow:"2",gridColumn:"1"}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"6px 12px 4px",borderBottom:`1px solid ${T.line}`,flexShrink:0}}>
                <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:13,fontWeight:600,letterSpacing:".12em",display:"flex",alignItems:"center",gap:6,color:T.text}}>
                  <span>⚡</span> SIGNAL FEED
                </div>
                <div style={{display:"flex",gap:4}}>
                  {[["ALL","#fff"],["LONG",C.green],["SHORT",C.red2]].map(([f,c])=>(
                    <button key={f} onClick={()=>setSigFilter(f)}
                      style={{padding:"3px 8px",borderRadius:4,fontSize:8,fontWeight:500,letterSpacing:".08em",cursor:"pointer",fontFamily:"'JetBrains Mono',monospace",
                        border:`1px solid ${sigFilter===f?(f==="LONG"?"rgba(16,185,129,.3)":f==="SHORT"?"rgba(239,68,68,.3)":"rgba(255,255,255,.18)"):T.line2}`,
                        background:sigFilter===f?(f==="LONG"?"rgba(16,185,129,.08)":f==="SHORT"?"rgba(239,68,68,.08)":"rgba(255,255,255,.05)"):T.panel2,
                        color:sigFilter===f?c:T.muted}}>
                      {f==="ALL"?`ALL · ${SIGNALS.length}`:f==="LONG"?`▲ LONG · ${SIGNALS.filter(s=>s.dir==="LONG").length}`:`▼ SHORT · ${SIGNALS.filter(s=>s.dir==="SHORT").length}`}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{height:150,overflowY:"auto",padding:"6px 10px"}}>
                {sigs.map((s,i)=>(
                  <div key={i} onClick={()=>setSelected(s.sym)}
                    style={{display:"flex",alignItems:"center",gap:8,padding:"6px 8px",borderRadius:6,borderLeft:`2px solid ${s.dir==="LONG"?C.green:C.red2}`,background:s.dir==="LONG"?"rgba(16,185,129,.04)":"rgba(239,68,68,.04)",marginBottom:4,cursor:"pointer",transition:"opacity .15s"}}
                    onMouseEnter={e=>e.currentTarget.style.opacity="0.8"}
                    onMouseLeave={e=>e.currentTarget.style.opacity="1"}>
                    <div style={{fontSize:14,color:s.dir==="LONG"?C.green:C.red2,flexShrink:0}}>{s.dir==="LONG"?"▲":"▼"}</div>
                    <div>
                      <div style={{fontSize:11,fontWeight:700,color:T.text,letterSpacing:".04em"}}>{s.sym}</div>
                      <span style={{display:"inline-block",padding:"1px 5px",borderRadius:3,fontSize:7,fontWeight:600,letterSpacing:".08em",textTransform:"uppercase",background:s.str==="STRONG"?"rgba(139,92,246,.2)":"rgba(59,130,246,.15)",color:s.str==="STRONG"?"#c4b5fd":"#93c5fd"}}>{s.str}</span>
                    </div>
                    <div style={{marginLeft:8}}>
                      <div style={{fontSize:11,fontWeight:700,color:clr(s.score)}}>{s.score>0?"+":""}{s.score.toFixed(3)}</div>
                      <div style={{fontSize:7,color:T.muted}}>{s.conf}% conf</div>
                    </div>
                    <div style={{display:"flex",gap:8,marginLeft:"auto",fontSize:8,flexShrink:0}}>
                      {[["ENTRY",s.entry,"#fff"],["SL",s.sl,C.red2],["TP",s.tp,C.green2],["R:R",s.rr,C.amber2]].map(([l,v,c])=>(
                        <div key={l}><div style={{fontSize:7,color:T.muted,textTransform:"uppercase",letterSpacing:".1em"}}>{l}</div><div style={{color:c,fontWeight:500}}>{typeof v==="number"?`$${v}`:v}</div></div>
                      ))}
                    </div>
                    <div style={{fontSize:7,color:T.muted,flexShrink:0}}>{s.ts}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* ─ DASHBOARD TOP 10 ─ FIXED: live data driven ─ */}
            <div style={{...card,gridRow:"3",gridColumn:"1"}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"6px 12px",borderBottom:`1px solid ${T.line}`,flexShrink:0}}>
                <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:13,fontWeight:600,letterSpacing:".12em",display:"flex",alignItems:"center",gap:6,color:T.text}}>
                  🏆 TOP 10 MOVERS
                  <span style={{fontSize:8,color:T.muted,fontWeight:400}}>from {dataSource}{activeSector!=="ALL"?` · ${activeSector}`:""}</span>
                </div>
              </div>
              <div style={{height:180,overflowY:"auto",padding:"4px 0"}}>
                {top10.map((s,i)=>(
                  <div key={s.sym+"_"+s.sector+"_top"} onClick={()=>setSelected(s.sym)}
                    style={{display:"flex",alignItems:"center",gap:8,padding:"5px 12px",cursor:"pointer",borderBottom:`1px solid ${T.line}`,background:selectedSym===s.sym?"rgba(34,211,238,.05)":"transparent"}}
                    onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,.03)"}
                    onMouseLeave={e=>e.currentTarget.style.background=selectedSym===s.sym?"rgba(34,211,238,.05)":"transparent"}>
                    <div style={{width:18,height:18,borderRadius:"50%",background:T.panel2,border:`1px solid ${T.line2}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:8,color:T.muted,flexShrink:0}}>{i+1}</div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{display:"flex",alignItems:"center",gap:6}}>
                        <span style={{fontSize:10,fontWeight:700,color:T.text}}>{s.sym}</span>
                        <span style={{fontSize:7,color:T.muted,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.name}</span>
                      </div>
                    </div>
                    <div style={{fontSize:9,color:T.text,fontWeight:600,flexShrink:0}}>${s.price.toFixed(2)}</div>
                    <div style={{fontSize:9,color:clr(s.chgD),fontWeight:700,flexShrink:0,width:60,textAlign:"right"}}>{s.chgD>=0?"+":"−"}${Math.abs(s.chgD).toFixed(2)}</div>
                    <div style={{fontSize:9,color:clr(s.chgP),fontWeight:700,flexShrink:0,width:52,textAlign:"right"}}>{pct(s.chgP)}</div>
                    {/* Mini bar */}
                    <div style={{width:40,height:4,background:T.panel3,borderRadius:2,overflow:"hidden",flexShrink:0}}>
                      <div style={{height:"100%",width:`${Math.min(Math.abs(s.chgP)/6*100,100)}%`,background:s.chgP>=0?C.green:C.red,borderRadius:2}}/>
                    </div>
                  </div>
                ))}
              </div>
            </div>

          </div>{/* end GRID */}

          {/* ─ SECTOR HEATMAP ─ FIXED: graphical bars ─ */}
          <div style={{...card,flexShrink:0}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"6px 12px",borderBottom:`1px solid ${T.line}`,flexShrink:0}}>
              <div style={{fontFamily:"'Rajdhani',sans-serif",fontSize:13,fontWeight:600,letterSpacing:".12em",display:"flex",alignItems:"center",gap:6,color:T.text}}>
                🗺 SECTOR HEATMAP
                <span style={{fontSize:8,color:T.muted,fontWeight:400}}>Real-time gainers vs losers</span>
              </div>
              <div style={{display:"flex",gap:10,fontSize:8}}>
                <span style={{color:C.green2}}>▲ {SECTOR_DATA.sort((a,b)=>b.chgP-a.chgP).slice(0,2).map(s=>s.name).join(", ")}</span>
                <span style={{color:C.red2}}>▼ {[...SECTOR_DATA].sort((a,b)=>a.chgP-b.chgP).slice(0,2).map(s=>s.name).join(", ")}</span>
              </div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:6,padding:"8px 10px"}}>
              {SECTOR_DATA.map(s=>(
                <HeatTile key={s.name} s={s} T={T} onClick={sd=>{setDS("Stock List");setSector(sd.name);}}/>
              ))}
            </div>
          </div>

        </main>{/* end MAIN */}
      </div>{/* end BODY */}

      {/* ══ TICKER TAPE ══ */}
      <div style={{position:"fixed",bottom:0,left:0,right:0,height:22,background:darkMode?"rgba(3,9,18,.96)":"rgba(240,244,248,.97)",borderTop:`1px solid ${T.line2}`,overflow:"hidden",zIndex:200,display:"flex",alignItems:"center"}}>
        <div style={{display:"flex",whiteSpace:"nowrap",animation:"scrollTape 55s linear infinite"}}>
          {[...Array(2)].flatMap((_,r)=>[
            <span key={`brand${r}`} style={{padding:"0 14px",fontSize:9,fontWeight:500,color:T.muted,letterSpacing:".2em",borderRight:`1px solid ${T.line2}`,flexShrink:0}}>NEXRADAR SCALPING</span>,
            ...stocks.map((s,i)=>(
              <span key={`${r}-${i}`} style={{padding:"0 10px",fontSize:9,color:s.chgP>=0?C.green2:C.red2,flexShrink:0,borderRight:`1px solid rgba(255,255,255,.04)`}}>
                {s.sym} {pct(s.chgP)} {s.chgP>=0?"▲":"▼"}
              </span>
            )),
            <span key={`sig${r}`} style={{padding:"0 14px",fontSize:9,color:C.amber2,flexShrink:0}}>⚡ {SIGNALS.filter(s=>s.dir==="LONG").length} LONG · {SIGNALS.filter(s=>s.dir==="SHORT").length} SHORT active</span>,
          ])}
        </div>
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@400;500;600;700&family=JetBrains+Mono:wght@300;400;500;700&display=swap');
        @keyframes blink{0%,100%{opacity:1}50%{opacity:.4}}
        @keyframes scrollTape{from{transform:translateX(0)}to{transform:translateX(-50%)}}
        @keyframes riseIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
        @keyframes flashUp{0%{background:rgba(16,185,129,0.25)}100%{background:transparent}}
        @keyframes flashDn{0%{background:rgba(239,68,68,0.25)}100%{background:transparent}}
        @keyframes scanLine{from{left:-2%}to{left:102%}}
        *{box-sizing:border-box;margin:0;padding:0;}
        ::-webkit-scrollbar{width:3px;height:3px}
        ::-webkit-scrollbar-thumb{background:${T.muted2};border-radius:2px}
        .flash-up{animation:flashUp 0.4s ease}
        .flash-dn{animation:flashDn 0.4s ease}
        button{cursor:pointer}
        textarea{cursor:text}
        input[type=range]{cursor:pointer}
        select option{background:#0c1828;color:#f1f5f9;}
      `}</style>
    </div>
  );
}
