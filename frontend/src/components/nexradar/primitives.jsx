// primitives.jsx — NexRadar Pro
// Shared UI atoms: Chip, SectionHeader, Shimmer, EmptyState, EmptyChart,
// TVChart, MatrixCell, SectorPills, AppearanceModal, NexRadarErrorBoundary

import { useState, useEffect, useRef, useCallback, useMemo, Component } from "react";
import { SECTORS, MAX_TICKERS, TV_INTERVAL_MAP } from "./constants.js";
import { computeSectorTotal } from "./utils.js";

// ─── Error Boundary ─────────────────────────────────────────────────────────
export class NexRadarErrorBoundary extends Component {
  state = { hasError: false, error: null, info: null };
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  componentDidCatch(error, info) {
    console.error("[NexRadar] Uncaught error:", error, info);
    this.setState({ info });
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", height:"100vh", background:"#02060d", fontFamily:"Inter,sans-serif", gap:16, padding:40 }}>
          <div style={{ fontSize:48, opacity:0.4 }}>⚠</div>
          <div style={{ color:"#ff3d5a", fontSize:16, fontWeight:700, letterSpacing:0.5 }}>SIGNAL LOST — UNEXPECTED ERROR</div>
          <div style={{ color:"#4a6278", fontSize:12, maxWidth:480, textAlign:"center", lineHeight:1.7 }}>
            {this.state.error?.message || "An unknown error occurred."}
          </div>
          <button onClick={() => this.setState({ hasError:false, error:null, info:null })}
            style={{ background:"#00d4ff12", border:"1px solid #00d4ff35", color:"#00d4ff", borderRadius:6, padding:"8px 20px", cursor:"pointer", fontFamily:"Inter,sans-serif", fontSize:12, fontWeight:700, letterSpacing:0.5, marginTop:8 }}>
            ↺ RELOAD DASHBOARD
          </button>
          {this.state.info && (
            <details style={{ color:"#2e4a62", fontSize:10, fontFamily:"monospace", maxWidth:600, textAlign:"left" }}>
              <summary style={{ cursor:"pointer", color:"#4a6278" }}>Component stack</summary>
              <pre style={{ marginTop:8, whiteSpace:"pre-wrap", wordBreak:"break-all" }}>{this.state.info.componentStack}</pre>
            </details>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── Chip ────────────────────────────────────────────────────────────────────
export function Chip({ children, color = "#00d4ff", T }) {
  const font = T?.font || "'Inter', sans-serif";
  return (
    <span style={{ background:color+"18", color, border:`1px solid ${color}28`, borderRadius:5, padding:"4px 10px", fontSize:11, fontFamily:font, letterSpacing:0.3, fontWeight:600, whiteSpace:"nowrap" }}>
      {children}
    </span>
  );
}

// ─── SectionHeader ───────────────────────────────────────────────────────────
export function SectionHeader({ title, children, T }) {
  const border = T?.border || "#172438";
  const text0  = T?.text0  || "#e2f1f8";
  const font   = T?.font   || "'Inter', sans-serif";
  return (
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"14px 18px", borderBottom:`1px solid ${border}` }}>
      <span style={{ color:text0, fontSize:13, letterSpacing:0.5, fontFamily:font, textTransform:"uppercase", fontWeight:700 }}>{title}</span>
      <div style={{ display:"flex", gap:8, alignItems:"center" }}>{children}</div>
    </div>
  );
}

// ─── Shimmer ─────────────────────────────────────────────────────────────────
export function Shimmer({ w, h = 14, opacity = 1 }) {
  return <div className="shimmer-box" style={{ height:h, width:w, opacity }} />;
}

// ─── EmptyState ──────────────────────────────────────────────────────────────
export function EmptyState({ icon = "◇", label = "Awaiting data", sub, h = 180, T }) {
  const text1 = T?.text1 || "#8ba3b8";
  const text2 = T?.text2 || "#4a6278";
  const font  = T?.font  || "'Inter', sans-serif";
  return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:12, height:h, padding:24 }}>
      <div style={{ color:text2, fontSize:36, opacity:0.4 }}>{icon}</div>
      <div style={{ color:text1, fontSize:13, letterSpacing:0.5, fontFamily:font, fontWeight:600 }}>{label}</div>
      {sub && <div style={{ color:text2, fontSize:13, fontFamily:font, textAlign:"center", maxWidth:280, lineHeight:1.6 }}>{sub}</div>}
    </div>
  );
}

// ─── EmptyChart ──────────────────────────────────────────────────────────────
export function EmptyChart({ height = 180, label = "Awaiting live data feed", T }) {
  const W = 400, H = height;
  const bg2   = T?.bg2   || "#0a1421";
  const border = T?.border || "#172438";
  const cyan  = T?.cyan  || "#00d4ff";
  const text2 = T?.text2 || "#4a6278";
  const font  = T?.font  || "'Inter', sans-serif";
  const path = `M0,${H*0.6} C60,${H*0.55} 90,${H*0.35} 140,${H*0.4} S210,${H*0.65} 260,${H*0.5} S340,${H*0.3} ${W},${H*0.45}`;
  return (
    <div style={{ position:"relative", background:bg2, borderRadius:8, overflow:"hidden" }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width:"100%", height, display:"block", opacity:0.14 }}>
        <defs><linearGradient id="eg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={cyan} stopOpacity="0.3"/><stop offset="100%" stopColor={cyan} stopOpacity="0"/></linearGradient></defs>
        {[...Array(7)].map((_,i)=><line key={i} x1="0" y1={H*i/6} x2={W} y2={H*i/6} stroke={border} strokeWidth="1"/>)}
        {[...Array(9)].map((_,i)=><line key={i} x1={W*i/8} y1="0" x2={W*i/8} y2={H} stroke={border} strokeWidth="1"/>)}
        <path d={path} fill="none" stroke={cyan} strokeWidth="1.5" strokeDasharray="4 3"/>
        <path d={`${path} L${W},${H} L0,${H} Z`} fill="url(#eg)"/>
      </svg>
      {label && (
        <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:10 }}>
          <div style={{ color:text2, fontSize:24, opacity:0.5 }}>◇</div>
          <div style={{ color:text2, fontSize:13, letterSpacing:0.5, fontFamily:font, fontWeight:500 }}>{label}</div>
        </div>
      )}
    </div>
  );
}

// ─── TVChart ──────────────────────────────────────────────────────────────────
// Uses widgetembed URL (iframe approach) — isolated, no tv.js script injection.
export function TVChart({ symbol, height = 220, T, interval = "5", livePrice = null, chartStyle = "1" }) {
  const bg    = T?.bg1   || "#060d18";
  const text2 = T?.text2 || "#4a6278";
  const cyan  = T?.cyan  || "#00bcd4";

  if (!symbol) return (
    <div style={{ width:"100%", height, background:bg, display:"flex", alignItems:"center", justifyContent:"center", color:text2, fontSize:13 }}>
      Select a symbol to view chart
    </div>
  );

  const tvInterval = TV_INTERVAL_MAP[interval] || interval || "5";
  const params = new URLSearchParams({
    symbol, interval:tvInterval, timezone:"America/New_York", theme:"dark",
    style:chartStyle, locale:"en", extended_hours:"1", hide_top_toolbar:"0",
    hide_side_toolbar:"1", hide_legend:"1", allow_symbol_change:"0",
    save_image:"0", studies:"Volume@tv-basicstudies",
  });

  return (
    <div style={{ position:"relative", width:"100%", height, background:bg }}>
      {livePrice != null && (
        <div style={{ position:"absolute", top:6, right:8, zIndex:10, background:"rgba(6,13,24,0.85)", border:`1px solid ${cyan}44`, borderRadius:4, padding:"2px 8px", fontFamily:"monospace", fontSize:11, color:T?.text0||"#e8f4fd", pointerEvents:"none", backdropFilter:"blur(4px)" }}>
          ${livePrice.toFixed(2)} <span style={{ color:cyan, fontSize:8 }}>●LIVE</span>
        </div>
      )}
      <iframe
        key={`${symbol}-${tvInterval}-${chartStyle}`}
        src={`https://s.tradingview.com/widgetembed/?${params.toString()}`}
        style={{ width:"100%", height, border:"none", display:"block" }}
        allowFullScreen
        title={`TradingView — ${symbol}`}
      />
    </div>
  );
}

// ─── MatrixCell ───────────────────────────────────────────────────────────────
// Click-to-load iframe — lightweight price card until clicked.
export function MatrixCell({ sym, tickers, matrixInterval, T }) {
  const [active, setActive] = useState(false);
  const containerRef = useRef(null);
  const tickerData = tickers.get(sym);
  const livePrice  = tickerData?.live_price ?? null;
  const changePct  = tickerData?.percent_change ?? null;
  const isPos      = (tickerData?.change_value || 0) >= 0;

  useEffect(() => {
    return () => { if (containerRef.current) containerRef.current.innerHTML = ""; };
  }, []);

  const handleClose = useCallback((e) => {
    e.stopPropagation();
    if (containerRef.current) containerRef.current.innerHTML = "";
    setActive(false);
  }, []);

  return (
    <div className="card" style={{ overflow:"hidden" }}>
      <div style={{ padding:"7px 12px", borderBottom:`1px solid ${T.border}`, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <span style={{ color:T.text0, fontFamily:T.font, fontSize:12, fontWeight:700 }}>{sym}</span>
          {livePrice != null && <span style={{ color:T.text0, fontFamily:T.font, fontSize:11 }}>${livePrice.toFixed(2)}</span>}
          {changePct != null && <span style={{ color:isPos?T.green:T.red, fontFamily:T.font, fontSize:10 }}>{isPos?"+":""}{changePct.toFixed(2)}%</span>}
        </div>
        <div style={{ display:"flex", gap:6, alignItems:"center" }}>
          {active && <button onClick={handleClose} style={{ background:"none", border:`1px solid ${T.border}`, color:T.text2, borderRadius:3, padding:"2px 7px", cursor:"pointer", fontFamily:T.font, fontSize:9 }}>✕</button>}
          <a href={`https://www.tradingview.com/chart/?symbol=${sym}`} target="_blank" rel="noreferrer" style={{ color:T.text2, fontSize:8.5, textDecoration:"none", fontFamily:T.font }}>↗ TV</a>
        </div>
      </div>
      <div ref={containerRef} style={{ height:300, cursor:active?"default":"pointer" }} onClick={!active?()=>setActive(true):undefined}>
        {active ? (
          <TVChart symbol={sym} height={300} T={T} livePrice={livePrice} interval={matrixInterval||"5"}/>
        ) : (
          <div style={{ width:"100%", height:300, background:T.bg0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:8 }}>
            <span style={{ color:T.text0, fontFamily:T.font, fontSize:22, fontWeight:700 }}>{sym}</span>
            {livePrice != null && <span style={{ color:T.cyan, fontFamily:T.font, fontSize:16, fontWeight:600 }}>${livePrice.toFixed(2)}</span>}
            <span style={{ color:T.text2, fontFamily:T.font, fontSize:10, letterSpacing:1 }}>CLICK TO LOAD CHART</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── SectorPills ─────────────────────────────────────────────────────────────
// Multi-select sector pills with count + cap logic.
export function SectorPills({ selectedSectors, onChange, showCounts = false, actualCount = null, T }) {
  const handleClick = (id) => {
    if (id === "ALL") { onChange(["ALL"]); return; }
    let next = selectedSectors.filter(x => x !== "ALL");
    if (next.includes(id)) {
      next = next.filter(x => x !== id);
      if (next.length === 0) next = ["ALL"];
    } else {
      next = [...next, id];
    }
    onChange(next);
  };

  const combinedCount = actualCount !== null ? actualCount : computeSectorTotal(selectedSectors);
  const isAll = selectedSectors.includes("ALL") || selectedSectors.length === 0;

  return (
    <div style={{ display:"flex", flexWrap:"wrap", gap:6, alignItems:"center" }}>
      {SECTORS.map(s => {
        const active = isAll ? s.id === "ALL" : selectedSectors.includes(s.id);
        return (
          <button key={s.id} onClick={() => handleClick(s.id)}
            style={{ background:active?s.color+"14":"transparent", border:`1px solid ${active?s.color+"45":T.border}`, color:active?s.color:T.text1, borderRadius:6, padding:"6px 12px", cursor:"pointer", fontFamily:T.font, fontSize:12, fontWeight:active?600:500, letterSpacing:0.3, whiteSpace:"nowrap", transition:"all 0.2s ease", display:"flex", flexDirection:"column", alignItems:"center", gap:2 }}>
            <span>{s.label}</span>
            {showCounts && s.count && <span style={{ fontSize:10, opacity:0.75, color:active?s.color:T.text2, fontWeight:500 }}>{s.count?.toLocaleString()}</span>}
          </button>
        );
      })}
      {!isAll && (
        <div style={{ display:"flex", alignItems:"center", gap:8, marginLeft:6 }}>
          <span style={{ color:combinedCount>=MAX_TICKERS?T.gold:T.cyan, fontSize:12, fontFamily:T.font, fontWeight:600 }}>
            {combinedCount>=MAX_TICKERS?`⚠ CAPPED AT ${MAX_TICKERS.toLocaleString()}`:`${combinedCount.toLocaleString()} tickers`}
          </span>
          <button className="btn-ghost" style={{ fontSize:11, padding:"4px 10px" }} onClick={() => onChange(["ALL"])}>✕ CLEAR</button>
        </div>
      )}
    </div>
  );
}

// ─── AppearanceModal ──────────────────────────────────────────────────────────
export function AppearanceModal({ onClose, currentTheme, onThemeChange, T }) {
  const [selected, setSelected] = useState(currentTheme || "dark");

  const options = [
    { id:"light", label:"Light mode",    preview:<div style={{ width:"100%", height:90, background:"#ffffff", borderRadius:8, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:6, padding:10 }}><div style={{ width:"60%", height:10, background:"#d1d5db", borderRadius:4 }}/><div style={{ width:"80%", height:36, background:"#9ca3af", borderRadius:6 }}/><div style={{ width:"70%", height:8, background:"#d1d5db", borderRadius:4 }}/></div> },
    { id:"dark",  label:"Dark mode",     preview:<div style={{ width:"100%", height:90, background:"#111827", borderRadius:8, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:6, padding:10 }}><div style={{ width:"60%", height:10, background:"#374151", borderRadius:4 }}/><div style={{ width:"80%", height:36, background:"#4b5563", borderRadius:6 }}/><div style={{ width:"70%", height:8, background:"#374151", borderRadius:4 }}/></div> },
    { id:"auto",  label:"Device default",preview:<div style={{ width:"100%", height:90, borderRadius:8, overflow:"hidden", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:6, padding:10, background:"linear-gradient(135deg,#f9fafb 50%,#111827 50%)" }}><div style={{ width:"60%", height:10, background:"rgba(100,100,100,0.4)", borderRadius:4 }}/><div style={{ width:"80%", height:36, background:"rgba(100,100,100,0.5)", borderRadius:6 }}/></div> },
  ];

  return (
    <div style={{ position:"fixed", inset:0, zIndex:99999, display:"flex", alignItems:"center", justifyContent:"center", background:"rgba(0,0,0,0.55)", backdropFilter:"blur(4px)" }} onClick={onClose}>
      <div style={{ background:T.bg1, border:`1px solid ${T.border}`, borderRadius:16, padding:"32px 36px", width:520, maxWidth:"95vw", boxShadow:"0 20px 60px rgba(0,0,0,0.5)" }} onClick={e=>e.stopPropagation()}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:28 }}>
          <span style={{ color:T.text0, fontFamily:T.font, fontWeight:700, fontSize:20 }}>Appearance</span>
          <button onClick={onClose} style={{ background:"none", border:"none", color:T.text2, cursor:"pointer", fontSize:18, lineHeight:1, padding:4 }}>✕</button>
        </div>
        <div style={{ display:"flex", gap:16, marginBottom:32 }}>
          {options.map(opt => (
            <div key={opt.id} onClick={() => setSelected(opt.id)} style={{ flex:1, cursor:"pointer", display:"flex", flexDirection:"column", gap:10 }}>
              <div style={{ border:`2px solid ${selected===opt.id?"#0d9488":T.border}`, borderRadius:10, overflow:"hidden", padding:6, background:selected===opt.id?"#0d948812":T.bg2, transition:"all 0.15s" }}>{opt.preview}</div>
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                <div style={{ width:18, height:18, borderRadius:"50%", flexShrink:0, border:`2px solid ${selected===opt.id?"#0d9488":T.border}`, background:selected===opt.id?"#0d948820":"transparent", display:"flex", alignItems:"center", justifyContent:"center" }}>
                  {selected===opt.id && <div style={{ width:8, height:8, borderRadius:"50%", background:"#0d9488" }}/>}
                </div>
                <span style={{ color:T.text0, fontFamily:T.font, fontSize:13, fontWeight:500 }}>{opt.label}</span>
              </div>
            </div>
          ))}
        </div>
        <button onClick={() => { onThemeChange(selected); onClose(); }}
          style={{ width:"100%", padding:"13px 0", borderRadius:30, background:"#0d9488", border:"none", color:"#ffffff", fontFamily:T.font, fontSize:15, fontWeight:700, cursor:"pointer" }}
          onMouseEnter={e=>e.currentTarget.style.opacity="0.9"} onMouseLeave={e=>e.currentTarget.style.opacity="1"}>
          OK
        </button>
      </div>
    </div>
  );
}
