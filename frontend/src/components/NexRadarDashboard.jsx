import { useState, useEffect, useMemo, useRef } from "react";
import { API_BASE } from "../config.js";

// ─── Market Session Detection (ET, client-side) ─────────────────────────────
function getMarketSession() {
  const et  = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day = et.getDay();
  const hm  = et.getHours() * 60 + et.getMinutes();
  if (day === 0 || day === 6)            return "closed";
  if (hm >= 20 * 60 || hm < 4 * 60)    return "closed";
  if (hm < 9 * 60 + 30)                 return "pre";
  if (hm < 16 * 60)                     return "market";
  if (hm < 20 * 60)                     return "after";
  return "closed";
}
const SESSION_META = {
  market: { chipLabel: "● MARKET OPEN",  chipColorKey: "green",  subMode: "MH" },
  pre:    { chipLabel: "● PRE-MARKET",   chipColorKey: "gold",   subMode: "AH" },
  after:  { chipLabel: "● AFTER HOURS",  chipColorKey: "purple", subMode: "AH" },
  closed: { chipLabel: "● OVERNIGHT",    chipColorKey: "text2",  subMode: "AH" },
};

// ─── Design Tokens (Theme-aware) ───────────────────────────────────────────
const getThemeTokens = (darkMode = true) => ({
  // Backgrounds - Dark: deep blues, Light: clean grays
  bg0: darkMode ? "#02060d" : "#f8fafc",        // Deepest bg / Lightest bg
  bg1: darkMode ? "#060d18" : "#ffffff",        // Main bg / White cards
  bg2: darkMode ? "#0a1421" : "#f1f5f9",        // Card bg / Light gray
  bg3: darkMode ? "#0f1c2e" : "#e2e8f0",        // Hover bg / Medium gray
  bg4: darkMode ? "#142038" : "#cbd5e1",        // Active bg / Border gray
  
  // Borders - Dark: subtle blues, Light: medium grays
  border: darkMode ? "#172438" : "#d1d5db",     // Default border
  borderHi: darkMode ? "#1f3655" : "#9ca3af",   // Highlighted border
  
  // Primary (Cyan) - Dark: bright cyan, Light: teal
  cyan: darkMode ? "#00d4ff" : "#0891b2",
  cyanDim: darkMode ? "#00d4ff12" : "#0891b218",
  cyanMid: darkMode ? "#00d4ff35" : "#0891b240",
  
  // Success (Green) - Dark: bright green, Light: forest green
  green: darkMode ? "#00e676" : "#059669",
  greenDim: darkMode ? "#00e67614" : "#05966918",
  
  // Danger (Red) - Dark: bright red, Light: crimson
  red: darkMode ? "#ff3d5a" : "#dc2626",
  redDim: darkMode ? "#ff3d5a14" : "#dc262618",
  
  // Warning (Gold) - Dark: bright gold, Light: amber
  gold: darkMode ? "#ffc400" : "#d97706",
  goldDim: darkMode ? "#ffc40014" : "#d9770618",
  
  // Info (Purple) - Dark: bright purple, Light: violet
  purple: darkMode ? "#b388ff" : "#7c3aed",
  purpleDim: darkMode ? "#b388ff14" : "#7c3aed18",
  
  // Alert (Orange) - Dark: bright orange, Light: orange
  orange: darkMode ? "#ff6d00" : "#ea580c",
  orangeDim: darkMode ? "#ff6d0014" : "#ea580c18",
  
  // Text - Dark: light blues, Light: dark grays
  text0: darkMode ? "#e2f1f8" : "#0f172a",      // Primary text (highest contrast)
  text1: darkMode ? "#8ba3b8" : "#1e293b",      // Secondary text (medium contrast)
  text2: darkMode ? "#4a6278" : "#475569",      // Tertiary text (lower contrast)
  text3: darkMode ? "#2e4a62" : "#64748b",      // Muted text (lowest contrast)
  
  // Typography - Comfortable, readable fonts
  font: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  fontMono: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
  fontDisplay: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
  fontSans: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",  // FIX #11
});

// ─── Sector definitions + ticker counts (from Supabase) ─────────────────────
// Counts from stock_list table (is_active=1, ordered by sector for diverse loading)
// Backend streams first 1500 tickers ordered by sector
const SECTORS = [
  { id: "ALL",         label: "ALL",          color: "#00d4ff",    count: 6027 },
  { id: "TECHNOLOGY",  label: "TECHNOLOGY",   color: "#00d4ff",    count: 775  },
  { id: "CONSUMER",    label: "CONSUMER",     color: "#ffc400",    count: 823  },
  { id: "BANKING",     label: "BANKING",      color: "#00e676",    count: 1002 },
  { id: "BIO",         label: "BIO",          color: "#b388ff",    count: 1150 },
  { id: "BM & UENE",   label: "BM & UENE",    color: "#ff6d00",    count: 659  },
  { id: "REALCOM",     label: "REALCOM",      color: "#00bcd4",    count: 639  },
  { id: "INDUSTRIALS", label: "INDUSTRIALS",  color: "#78909c",    count: 979  },
  { id: "EARNINGS",    label: "EARNINGS",     color: "#ffc400",    count: null }, // dynamic, ~550/week
];
const MAX_TICKERS = 1500;

// ─── Sector Normalization Helper ──────────────────────────────────────────────
// Maps various sector name formats to standard SECTORS IDs
function normalizeSector(sectorName) {
  if (!sectorName) return null;
  const s = sectorName.toUpperCase().trim();
  
  // Direct matches
  if (s === "TECHNOLOGY" || s === "TECH") return "TECHNOLOGY";
  if (s === "CONSUMER" || s === "CONSUMER DISCRETIONARY" || s === "CONSUMER STAPLES") return "CONSUMER";
  if (s === "BANKING" || s === "FINANCIALS" || s === "FINANCIAL SERVICES") return "BANKING";
  if (s === "BIO" || s === "BIOTECHNOLOGY" || s === "HEALTHCARE" || s === "HEALTH CARE") return "BIO";
  if (s === "BM & UENE" || s === "BM&ENERGY" || s === "BASIC MATERIALS" || s === "ENERGY" || s === "UTILITIES") return "BM & UENE";
  if (s === "REALCOM" || s === "REAL ESTATE" || s === "COMMUNICATION SERVICES" || s === "TELECOMMUNICATIONS") return "REALCOM";
  if (s === "INDUSTRIALS" || s === "INDUSTRIAL") return "INDUSTRIALS";
  
  // Partial matches
  if (s.includes("TECH")) return "TECHNOLOGY";
  if (s.includes("CONSUMER")) return "CONSUMER";
  if (s.includes("BANK") || s.includes("FINANC")) return "BANKING";
  if (s.includes("BIO") || s.includes("HEALTH")) return "BIO";
  if (s.includes("ENERGY") || s.includes("MATERIAL") || s.includes("UTILIT")) return "BM & UENE";
  if (s.includes("REAL") || s.includes("COMM")) return "REALCOM";
  if (s.includes("INDUSTR")) return "INDUSTRIALS";
  
  return null;
}

// ─── Nav ────────────────────────────────────────────────────────────────────
const NAV = [
  { id: "dashboard", label: "Dashboard",  icon: "⬡" },
  { id: "live",      label: "Live Table", icon: "◈" },
  { id: "chart",     label: "Chart",      icon: "◇" },
  { id: "signals",   label: "Signals",    icon: "◉" },
  { id: "earnings",  label: "Earnings",   icon: "◎" },
  { id: "portfolio", label: "Portfolio",  icon: "◆" },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────
const fmt2 = n => Number(n || 0).toFixed(2);
const pct  = n => `${n >= 0 ? "+" : ""}${Number(n || 0).toFixed(2)}%`;
const fmtK = n => n >= 1e9 ? `$${(n/1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n/1e6).toFixed(0)}M` : n ? `$${n}` : "—";
const fmtVol = n => n >= 1e9 ? `${(n/1e9).toFixed(1)}B` : n >= 1e6 ? `${(n/1e6).toFixed(1)}M` : n >= 1e3 ? `${(n/1e3).toFixed(0)}K` : n ? `${n}` : "—";
// clr helper removed - use T.green/T.red directly in components where T is available

function getWeekDates(offsetWeeks = 0) {
  const today = new Date();
  const dow = today.getDay();
  const monday = new Date(today);
  monday.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1) + offsetWeeks * 7);
  return ["MON","TUE","WED","THU","FRI"].map((d, i) => {
    const dt = new Date(monday);
    dt.setDate(monday.getDate() + i);
    return {
      day: d,
      date: dt.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      isoDate: dt.toISOString().slice(0, 10),
      isToday: dt.toDateString() === today.toDateString(),
    };
  });
}

// Compute total tickers for a set of selected sectors, capped at MAX_TICKERS
function computeSectorTotal(selectedIds) {
  if (selectedIds.includes("ALL") || selectedIds.length === 0) return MAX_TICKERS;
  const total = selectedIds.reduce((sum, id) => {
    const s = SECTORS.find(x => x.id === id);
    return sum + (s?.count || 0);
  }, 0);
  return Math.min(total, MAX_TICKERS);
}

// ─── CSS (Theme-aware) ────────────────────────────────────────────────────────
const getCSS = (T) => `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap');
  
  *, *::before, *::after { 
    box-sizing: border-box; 
    margin: 0; 
    padding: 0; 
  }
  
  body { 
    background: ${T.bg0}; 
    font-family: ${T.font};
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }
  
  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: ${T.border}; border-radius: 3px; }
  ::-webkit-scrollbar-thumb:hover { background: ${T.borderHi}; }

  @keyframes fadeUp   { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
  @keyframes shimmer  { 0%{background-position:-400px 0} 100%{background-position:400px 0} }
  @keyframes dotblink { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.25;transform:scale(0.5)} }

  .page-enter { animation: fadeUp 0.3s ease forwards; }

  .shimmer-box {
    background: linear-gradient(90deg, ${T.bg2} 25%, ${T.bg3} 50%, ${T.bg2} 75%);
    background-size: 400px 100%; animation: shimmer 1.6s infinite; border-radius: 4px;
  }
  
  .nav-btn {
    background: none; border: 1px solid transparent; cursor: pointer;
    display: flex; align-items: center; gap: 10px;
    padding: 11px 16px; width: 100%; border-radius: 8px;
    transition: all 0.2s ease;
    font-family: ${T.font};
    font-size: 13px; 
    font-weight: 500;
    letter-spacing: 0.3px; 
    text-transform: uppercase; 
    color: ${T.text2};
  }
  .nav-btn:hover  { background: ${T.bg2}; color: ${T.text0}; }
  .nav-btn.active { 
    background: ${T.cyanDim}; 
    color: ${T.cyan}; 
    border-color: ${T.cyanMid}; 
    font-weight: 600;
  }
  .nav-btn .icon  { font-size: 16px; min-width: 18px; text-align: center; }

  .card { 
    background: ${T.bg1}; 
    border: 1px solid ${T.border}; 
    border-radius: 12px; 
    overflow: hidden; 
    position: relative;
    box-shadow: 0 1px 3px rgba(0,0,0,0.1);
  }
  .card-glow { 
    border-color: ${T.borderHi}; 
    box-shadow: 0 0 0 1px ${T.cyanDim} inset, 0 2px 8px rgba(0,0,0,0.15); 
  }

  .btn-ghost {
    background: none; 
    border: 1px solid ${T.border}; 
    color: ${T.text1};
    border-radius: 6px; 
    padding: 7px 14px; 
    cursor: pointer;
    font-family: ${T.font}; 
    font-size: 12px; 
    font-weight: 500;
    letter-spacing: 0.3px; 
    transition: all 0.2s ease;
  }
  .btn-ghost:hover:not(:disabled)  { 
    border-color: ${T.cyanMid}; 
    color: ${T.cyan}; 
    background: ${T.cyanDim}; 
  }
  .btn-ghost.active { 
    background: ${T.cyanDim}; 
    border-color: ${T.cyanMid}; 
    color: ${T.cyan}; 
    font-weight: 600;
  }
  .btn-ghost:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .btn-primary {
    background: ${T.cyanDim}; 
    border: 1px solid ${T.cyanMid}; 
    color: ${T.cyan};
    border-radius: 6px; 
    padding: 8px 16px; 
    cursor: pointer;
    font-family: ${T.font}; 
    font-size: 12px; 
    font-weight: 600;
    letter-spacing: 0.3px; 
    transition: all 0.2s ease;
  }
  .btn-primary:hover { background: ${T.cyanMid}; }

  .tr-hover { transition: background 0.15s ease; cursor: pointer; }
  .tr-hover:hover td { background: ${T.bg2} !important; }

  .live-dot {
    width: 8px; height: 8px; border-radius: 50%; background: ${T.green};
    animation: dotblink 1.4s ease-in-out infinite; display: inline-block; flex-shrink: 0;
  }
  
  input, select, textarea {
    font-family: ${T.font};
    font-size: 14px;
  }
  
  input:focus, select:focus, textarea:focus { 
    outline: none !important; 
    border-color: ${T.cyanMid} !important; 
    box-shadow: 0 0 0 3px ${T.cyanDim};
  }
  
  /* Theme selector dropdown */
  .theme-selector-group:hover .theme-dropdown {
    opacity: 1 !important;
    visibility: visible !important;
  }
`;

// ─── Primitives (accept T as prop or use default colors) ────────────────────
function Chip({ children, color = "#00d4ff", T }) {
  const font = T?.font || "'Inter', sans-serif";
  return (
    <span style={{ 
      background: color+"18", 
      color, 
      border:`1px solid ${color}28`,
      borderRadius:5, 
      padding:"4px 10px", 
      fontSize:11,
      fontFamily:font, 
      letterSpacing:0.3, 
      fontWeight:600, 
      whiteSpace:"nowrap" 
    }}>{children}</span>
  );
}

function SectionHeader({ title, children, T }) {
  const border = T?.border || "#172438";
  const text0 = T?.text0 || "#e2f1f8";
  const font = T?.font || "'Inter', sans-serif";
  return (
    <div style={{ 
      display:"flex", 
      justifyContent:"space-between", 
      alignItems:"center", 
      padding:"14px 18px", 
      borderBottom:`1px solid ${border}` 
    }}>
      <span style={{ 
        color:text0, 
        fontSize:13, 
        letterSpacing:0.5, 
        fontFamily:font, 
        textTransform:"uppercase",
        fontWeight:700
      }}>{title}</span>
      <div style={{ display:"flex", gap:8, alignItems:"center" }}>{children}</div>
    </div>
  );
}

function Shimmer({ w, h=14, opacity=1 }) {
  return <div className="shimmer-box" style={{ height:h, width:w, opacity }} />;
}

function EmptyState({ icon="◇", label="Awaiting data", sub, h=180, T }) {
  const text1 = T?.text1 || "#8ba3b8";
  const text2 = T?.text2 || "#4a6278";
  const font = T?.font || "'Inter', sans-serif";
  return (
    <div style={{ 
      display:"flex", 
      flexDirection:"column", 
      alignItems:"center", 
      justifyContent:"center", 
      gap:12, 
      height:h, 
      padding:24 
    }}>
      <div style={{ color:text2, fontSize:36, opacity:0.4 }}>{icon}</div>
      <div style={{ 
        color:text1, 
        fontSize:13, 
        letterSpacing:0.5, 
        fontFamily:font,
        fontWeight:600
      }}>{label}</div>
      {sub && <div style={{ 
        color:text2, 
        fontSize:13, 
        fontFamily:font, 
        textAlign:"center", 
        maxWidth:280, 
        lineHeight:1.6 
      }}>{sub}</div>}
    </div>
  );
}

function EmptyChart({ height=180, label="Awaiting live data feed", T }) {
  const W=400, H=height;
  const bg2 = T?.bg2 || "#0a1421";
  const border = T?.border || "#172438";
  const cyan = T?.cyan || "#00d4ff";
  const text2 = T?.text2 || "#4a6278";
  const font = T?.font || "'Inter', sans-serif";
  const path=`M0,${H*0.6} C60,${H*0.55} 90,${H*0.35} 140,${H*0.4} S210,${H*0.65} 260,${H*0.5} S340,${H*0.3} ${W},${H*0.45}`;
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

// ─── TradingView Embed — exchange-aware, auto-retries NYSE/AMEX ──────────────
// TradingView resolves most US symbols without an exchange prefix.
// ─── TradingView Embed ─ iframe, extended hours ──────────────────────────────
function TVChart({ symbol, height = 220, T, interval = "5", style = "1" }) {
  const bg1 = T?.bg1 || "#060d18";

  if (!symbol) return (
    <div style={{
      width: "100%", height, background: bg1,
      display: "flex", alignItems: "center", justifyContent: "center",
      color: T?.text2 || "#4a6278", fontSize: 13,
    }}>
      Select a symbol to view chart
    </div>
  );

  const params = new URLSearchParams({
    symbol:              symbol,
    interval:            interval,
    timezone:            "America/New_York",
    theme:               "dark",
    style:               style,
    locale:              "en",
    extended_hours:      "1",
    hide_top_toolbar:    "0",
    hide_side_toolbar:   "1",
    hide_legend:         "1",
    allow_symbol_change: "1",
    save_image:          "0",
  });

  return (
    <iframe
      key={`${symbol}-${interval}-${style}`}
      src={`https://s.tradingview.com/widgetembed/?${params.toString()}`}
      style={{ width: "100%", height, border: "none", display: "block", background: bg1 }}
      allowFullScreen
      title={`TradingView Chart — ${symbol}`}
    />
  );
}

// ─── Sector Multi-Select Pills with count + cap logic ────────────────────────
// Supports multi-select. If combined count > 1500, snaps to 1500 and ignores rest.
function SectorPills({ selectedSectors, onChange, showCounts=false, actualCount=null, T }) {
  const handleClick = (id) => {
    if (id === "ALL") { onChange(["ALL"]); return; }
    // Remove ALL if it was there
    let next = selectedSectors.filter(x => x !== "ALL");
    if (next.includes(id)) {
      next = next.filter(x => x !== id);
      if (next.length === 0) next = ["ALL"];
    } else {
      next = [...next, id];
    }
    // Check if combined count would exceed MAX_TICKERS
    const total = next.reduce((s, sid) => {
      const sec = SECTORS.find(x => x.id === sid);
      return s + (sec?.count || 0);
    }, 0);
    if (total > MAX_TICKERS) {
      // find the sector that pushed it over — exclude it
      // i.e. we accept the click but cap display to 1500
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
            style={{
              background: active ? s.color+"14" : "transparent",
              border: `1px solid ${active ? s.color+"45" : T.border}`,
              color: active ? s.color : T.text1,
              borderRadius:6, 
              padding: showCounts ? "6px 12px" : "6px 12px",
              cursor:"pointer", 
              fontFamily:T.font,
              fontSize:12, 
              fontWeight: active ? 600 : 500,
              letterSpacing:0.3, 
              whiteSpace:"nowrap",
              transition:"all 0.2s ease",
              display:"flex", 
              flexDirection:"column", 
              alignItems:"center", 
              gap:2,
            }}>
            <span>{s.label}</span>
            {showCounts && s.count && (
              <span style={{ fontSize:10, opacity:0.75, color: active ? s.color : T.text2, fontWeight:500 }}>
                {s.count?.toLocaleString()}
              </span>
            )}
          </button>
        );
      })}
      {!isAll && (
        <div style={{ display:"flex", alignItems:"center", gap:8, marginLeft:6 }}>
          <span style={{ 
            color: combinedCount >= MAX_TICKERS ? T.gold : T.cyan, 
            fontSize:12, 
            fontFamily:T.font,
            fontWeight:600
          }}>
            {combinedCount >= MAX_TICKERS ? `⚠ CAPPED AT ${MAX_TICKERS.toLocaleString()}` : `${combinedCount.toLocaleString()} tickers`}
          </span>
          <button className="btn-ghost" style={{ fontSize:11, padding:"4px 10px" }} onClick={() => onChange(["ALL"])}>✕ CLEAR</button>
        </div>
      )}
    </div>
  );
}

// ─── PAGE: Dashboard ──────────────────────────────────────────────────────────
// Market Breadth now includes EARNINGS tile with real-time sector performance
function PageDashboard({ onNavigate, onSectorChange, selectedSectors, sectorPerformance = {}, tickers, T }) {
  const sectorTiles = SECTORS.filter(s => s.id !== "ALL");
  
  // Fetch earnings data for Earnings Today widget
  const [earnings, setEarnings] = useState([]);
  const [earningsLoading, setEarningsLoading] = useState(true);
  
  // Fetch watchlist for prioritizing earnings
  const [watchlist, setWatchlist] = useState(new Set());
  
  // Market Breadth timeframe state
  const [breadthTimeframe, setBreadthTimeframe] = useState("1D");
  
  // Scalp Signals filter state
  const [scalpFilter, setScalpFilter] = useState("ALL");
  
  useEffect(() => {
    // Fetch watchlist
    fetch(`${API_BASE}/api/watchlist`)
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(data => setWatchlist(new Set(data.watchlist ?? [])))
      .catch(err => console.warn('[NexRadar Dashboard] Failed to load watchlist:', err));
    
    // Fetch only today's earnings
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
    fetch(`${API_BASE}/api/earnings?start=${today}&end=${today}`)
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(data => {
        // Backend returns array directly, not wrapped in object
        const earningsArray = Array.isArray(data) ? data : [];
        // Map backend field names to frontend expected names
        const mappedEarnings = earningsArray.map(e => ({
          ticker: e.ticker,
          company_name: e.company_name,
          date: e.earnings_date,
          time: e.earnings_time
        }));
        setEarnings(mappedEarnings);
        setEarningsLoading(false);
      })
      .catch(err => {
        console.error('[NexRadar Dashboard] Failed to load earnings:', err);
        setEarningsLoading(false);
      });
  }, []);

  return (
    <div className="page-enter" style={{ display:"flex", flexDirection:"column", gap:18 }}>
      {/* Market Breadth (includes Earnings) + Scalp Signals */}
      <div style={{ display:"flex", gap:18, flexWrap:"wrap" }}>
        <div className="card card-glow" style={{ flex:2, minWidth:340 }}>
          <SectionHeader title="Market Breadth" T={T}>
            <button 
              className="btn-ghost" 
              style={{ 
                fontSize:9, 
                background: breadthTimeframe === "1D" ? T.cyan+"20" : "transparent",
                color: breadthTimeframe === "1D" ? T.cyan : T.text2
              }}
              onClick={() => setBreadthTimeframe("1D")}
            >
              1D
            </button>
            <button 
              className="btn-ghost" 
              style={{ 
                fontSize:9,
                background: breadthTimeframe === "1W" ? T.cyan+"20" : "transparent",
                color: breadthTimeframe === "1W" ? T.cyan : T.text2
              }}
              onClick={() => setBreadthTimeframe("1W")}
            >
              1W
            </button>
          </SectionHeader>
          <div style={{ padding:14, display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(115px,1fr))", gap:8 }}>
            {sectorTiles.map(s => {
              const active = selectedSectors.includes(s.id);
              const perf = sectorPerformance[s.id] || { avgReturn: 0, count: 0, gainers: 0, losers: 0 };
              const isPositive = perf.avgReturn >= 0;
              const hasData = perf.count > 0;

              return (
                <div key={s.id} onClick={() => { 
                  // Toggle behavior: click selected sector to deselect (go back to ALL)
                  if (active && s.id !== "ALL") {
                    onSectorChange(["ALL"]);
                  } else {
                    onSectorChange([s.id]); 
                    onNavigate("live");
                  }
                }}
                  style={{ 
                    background: active ? s.color+"12" : T.bg2, 
                    borderLeft:`1px solid ${active ? s.color+"40" : T.border}`,
                    borderRight:`1px solid ${active ? s.color+"40" : T.border}`,
                    borderBottom:`1px solid ${active ? s.color+"40" : T.border}`,
                    borderTop: s.id === "EARNINGS" ? `2px solid ${T.gold}50` : `1px solid ${active ? s.color+"40" : T.border}`,
                    borderRadius:10, 
                    padding:"14px 16px", 
                    cursor:"pointer", 
                    transition:"all 0.2s ease"
                  }}
                  onMouseEnter={e=>{ 
                    e.currentTarget.style.borderLeft=s.color+"50"; 
                    e.currentTarget.style.borderRight=s.color+"50"; 
                    e.currentTarget.style.borderBottom=s.color+"50"; 
                    e.currentTarget.style.borderTop=s.id === "EARNINGS" ? `2px solid ${T.gold}50` : s.color+"50";
                    e.currentTarget.style.background=s.color+"0e"; 
                  }}
                  onMouseLeave={e=>{ 
                    e.currentTarget.style.borderLeft=active?s.color+"40":T.border; 
                    e.currentTarget.style.borderRight=active?s.color+"40":T.border; 
                    e.currentTarget.style.borderBottom=active?s.color+"40":T.border; 
                    e.currentTarget.style.borderTop=s.id === "EARNINGS" ? `2px solid ${T.gold}50` : (active?s.color+"40":T.border);
                    e.currentTarget.style.background=active?s.color+"12":T.bg2; 
                  }}>
                  <div style={{ color:s.color, fontSize:11, letterSpacing:0.8, fontFamily:T.font, marginBottom:10, opacity:0.9, fontWeight:700 }}>
                    {s.id === "EARNINGS" ? "◎ " : ""}{s.label}
                  </div>
                  
                  {/* Real-time sector performance */}
                  {s.id === "EARNINGS" ? (
                    (() => {
                      // Calculate performance for earnings stocks (today only)
                      const tickerArray = Array.from(tickers.values());
                      
                      // Get tickers with earnings today from our earnings list
                      const earningsTodaySet = new Set(earnings.map(e => e.ticker));
                      
                      const earningsStocks = tickerArray.filter(t => 
                        t.is_earnings_gap_play || earningsTodaySet.has(t.ticker)
                      );
                      
                      if (earningsStocks.length === 0) {
                        return (
                          <div style={{ 
                            fontFamily:T.font, 
                            fontSize:24, 
                            fontWeight:800, 
                            color: T.text2,
                            letterSpacing:0.5,
                            marginBottom:8
                          }}>
                            —%
                          </div>
                        );
                      }
                      
                      const avgReturn = earningsStocks.reduce((sum, t) => sum + (t.percent_change || 0), 0) / earningsStocks.length;
                      const gainers = earningsStocks.filter(t => (t.percent_change || 0) > 0).length;
                      const losers = earningsStocks.filter(t => (t.percent_change || 0) < 0).length;
                      const isPositive = avgReturn >= 0;
                      
                      return (
                        <>
                          <div style={{ 
                            fontFamily:T.font, 
                            fontSize:24, 
                            fontWeight:800, 
                            color: isPositive ? T.green : T.red,
                            letterSpacing:0.5,
                            marginBottom:8
                          }}>
                            {pct(avgReturn)}
                          </div>
                          <div style={{ color:T.text2, fontSize:11, marginTop:6, fontFamily:T.font, display:"flex", justifyContent:"space-between", alignItems:"center", fontWeight:500 }}>
                            <span>{earningsStocks.length} stocks</span>
                            <span>
                              <span style={{ color:T.green, fontWeight:600 }}>{gainers}↑</span>
                              {" "}
                              <span style={{ color:T.red, fontWeight:600 }}>{losers}↓</span>
                            </span>
                          </div>
                        </>
                      );
                    })()
                  ) : hasData ? (
                    <>
                      <div style={{ 
                        fontFamily:T.font, 
                        fontSize:24, 
                        fontWeight:800, 
                        color: isPositive ? T.green : T.red,
                        letterSpacing:0.5,
                        marginBottom:8
                      }}>
                        {pct(perf.avgReturn)}
                      </div>
                      <div style={{ color:T.text2, fontSize:11, marginTop:6, fontFamily:T.font, display:"flex", justifyContent:"space-between", alignItems:"center", fontWeight:500 }}>
                        <span>{perf.count} stocks</span>
                        <span>
                          <span style={{ color:T.green, fontWeight:600 }}>{perf.gainers}↑</span>
                          {" "}
                          <span style={{ color:T.red, fontWeight:600 }}>{perf.losers}↓</span>
                        </span>
                      </div>
                    </>
                  ) : (
                    <div style={{ 
                      fontFamily:T.font, 
                      fontSize:24, 
                      fontWeight:800, 
                      color: T.text2,
                      letterSpacing:0.5,
                      marginBottom:8
                    }}>
                      —%
                    </div>
                  )}

                  {/* Stock count and gainers/losers */}
                  {s.id === "EARNINGS" ? null : hasData ? null : (
                    <div style={{ color:T.text2, fontSize:11, marginTop:6, fontFamily:T.font, fontWeight:500 }}>
                      {s.count ? `${s.count.toLocaleString()} stocks` : "— stocks"}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Scalp Signals */}
        <div className="card" style={{ flex:1, minWidth:200, alignSelf:"flex-start" }}>
          <SectionHeader title="Scalp Signals" T={T}>
            <button 
              className="btn-ghost" 
              style={{ 
                fontSize:9, 
                background: scalpFilter === "ALL" ? T.cyan+"20" : "transparent",
                color: scalpFilter === "ALL" ? T.cyan : T.text2,
                padding:"4px 8px",
                borderRadius:4
              }}
              onClick={() => setScalpFilter("ALL")}
            >
              ALL
            </button>
            <button 
              className="btn-ghost" 
              style={{ 
                fontSize:9,
                background: scalpFilter === "LONG" ? T.green+"20" : "transparent",
                color: scalpFilter === "LONG" ? T.green : T.text2,
                padding:"4px 8px",
                borderRadius:4
              }}
              onClick={() => setScalpFilter("LONG")}
            >
              LONG
            </button>
            <button 
              className="btn-ghost" 
              style={{ 
                fontSize:9,
                background: scalpFilter === "SHORT" ? T.red+"20" : "transparent",
                color: scalpFilter === "SHORT" ? T.red : T.text2,
                padding:"4px 8px",
                borderRadius:4
              }}
              onClick={() => setScalpFilter("SHORT")}
            >
              SHORT
            </button>
          </SectionHeader>
          <div style={{ padding:"8px 14px" }}>
            {(() => {
              const tickerArray = Array.from(tickers.values());
              let topSignals = tickerArray
                .filter(t => Math.abs(t.percent_change || 0) > 1)
                .sort((a, b) => Math.abs(b.percent_change || 0) - Math.abs(a.percent_change || 0));
              
              // Apply filter
              if (scalpFilter === "LONG") {
                topSignals = topSignals.filter(t => (t.percent_change || 0) > 0);
              } else if (scalpFilter === "SHORT") {
                topSignals = topSignals.filter(t => (t.percent_change || 0) < 0);
              }
              
              topSignals = topSignals.slice(0, 5);
              
              if (topSignals.length === 0) {
                return <EmptyState icon="◉" label="NO SIGNALS" sub="Market is closed or no significant movements" h={160} T={T} />;
              }
              
              return topSignals.map((ticker, i) => {
                const isLong = (ticker.percent_change || 0) > 0;
                return (
                  <div key={i} style={{ 
                    display:"grid",
                    gridTemplateColumns:"1fr auto auto",
                    alignItems:"center",
                    padding:"10px 0", 
                    borderBottom:i<4?`1px solid ${T.border}`:"none",
                    gap:8
                  }}>
                    <span style={{ color:T.text0, fontSize:12, fontFamily:T.font, fontWeight:400 }}>{ticker.ticker}</span>
                    <span style={{ 
                      color: isLong ? T.green : T.red, 
                      fontSize:9, 
                      fontFamily:T.font, 
                      fontWeight:700,
                      padding:"2px 6px",
                      borderRadius:4,
                      background: isLong ? T.green+"15" : T.red+"15",
                      textAlign:"center"
                    }}>
                      {isLong ? "LONG" : "SHORT"}
                    </span>
                    <span style={{ color: isLong ? T.green : T.red, fontSize:12, fontFamily:T.font, fontWeight:700, textAlign:"right" }}>
                      {pct(ticker.percent_change)}
                    </span>
                  </div>
                );
              });
            })()}
          </div>
        </div>
      </div>

      {/* Gainers / Losers / Earnings Today */}
      <div style={{ display:"flex", gap:18, flexWrap:"wrap" }}>
        {/* Top Gainers */}
        <div className="card" style={{ flex:1, minWidth:200, alignSelf:"flex-start" }}>
          <SectionHeader title={selectedSectors.includes("ALL") ? "Top Gainers" : `Top Gainers · ${selectedSectors.join(" + ")}`} T={T}>
            <button className="btn-ghost" style={{ fontSize:8 }} onClick={() => onNavigate("live")}>VIEW ALL</button>
          </SectionHeader>
          <div style={{ padding:"8px 14px" }}>
            {(() => {
              const tickerArray = Array.from(tickers.values());
              
              // Filter by selected sector if not ALL
              let filteredTickers = tickerArray;
              if (!selectedSectors.includes("ALL")) {
                filteredTickers = tickerArray.filter(t => {
                  // Handle EARNINGS sector
                  if (selectedSectors.includes("EARNINGS")) {
                    if (t.is_earnings_gap_play) return true;
                  }
                  // Handle regular sectors
                  const tickerSector = normalizeSector(t.sector);
                  return tickerSector && selectedSectors.some(s => tickerSector === s && s !== "EARNINGS");
                });
              }
              
              const topGainers = filteredTickers
                .filter(t => (t.percent_change || 0) > 0)
                .sort((a, b) => (b.percent_change || 0) - (a.percent_change || 0))
                .slice(0, 5);
              
              if (topGainers.length === 0) {
                return Array(5).fill(0).map((_,i)=>(
                  <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"10px 0", borderBottom:i<4?`1px solid ${T.border}`:"none" }}>
                    <Shimmer w={44} h={11} />
                    <Shimmer w={55} h={11} opacity={0.5} />
                  </div>
                ));
              }
              
              return topGainers.map((ticker, i) => (
                <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"10px 0", borderBottom:i<4?`1px solid ${T.border}`:"none" }}>
                  <span style={{ color:T.text0, fontSize:12, fontFamily:T.font, fontWeight:700 }}>{ticker.ticker}</span>
                  <span style={{ color:T.green, fontSize:12, fontFamily:T.font, fontWeight:700 }}>{pct(ticker.percent_change)}</span>
                </div>
              ));
            })()}
          </div>
        </div>

        {/* Top Losers */}
        <div className="card" style={{ flex:1, minWidth:200, alignSelf:"flex-start" }}>
          <SectionHeader title={selectedSectors.includes("ALL") ? "Top Losers" : `Top Losers · ${selectedSectors.join(" + ")}`} T={T}>
            <button className="btn-ghost" style={{ fontSize:8 }} onClick={() => onNavigate("live")}>VIEW ALL</button>
          </SectionHeader>
          <div style={{ padding:"8px 14px" }}>
            {(() => {
              const tickerArray = Array.from(tickers.values());
              
              // Filter by selected sector if not ALL
              let filteredTickers = tickerArray;
              if (!selectedSectors.includes("ALL")) {
                filteredTickers = tickerArray.filter(t => {
                  // Handle EARNINGS sector
                  if (selectedSectors.includes("EARNINGS")) {
                    if (t.is_earnings_gap_play) return true;
                  }
                  // Handle regular sectors
                  const tickerSector = normalizeSector(t.sector);
                  return tickerSector && selectedSectors.some(s => tickerSector === s && s !== "EARNINGS");
                });
              }
              
              const topLosers = filteredTickers
                .filter(t => (t.percent_change || 0) < 0)
                .sort((a, b) => (a.percent_change || 0) - (b.percent_change || 0))
                .slice(0, 5);
              
              if (topLosers.length === 0) {
                return Array(5).fill(0).map((_,i)=>(
                  <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"10px 0", borderBottom:i<4?`1px solid ${T.border}`:"none" }}>
                    <Shimmer w={44} h={11} />
                    <Shimmer w={55} h={11} opacity={0.5} />
                  </div>
                ));
              }
              
              return topLosers.map((ticker, i) => (
                <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"10px 0", borderBottom:i<4?`1px solid ${T.border}`:"none" }}>
                  <span style={{ color:T.text0, fontSize:12, fontFamily:T.font, fontWeight:700 }}>{ticker.ticker}</span>
                  <span style={{ color:T.red, fontSize:12, fontFamily:T.font, fontWeight:700 }}>{pct(ticker.percent_change)}</span>
                </div>
              ));
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
              Array(5).fill(0).map((_,i)=>(
                <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"10px 0", borderBottom:i<4?`1px solid ${T.border}`:"none" }}>
                  <Shimmer w={44} h={11} />
                  <Shimmer w={55} h={11} opacity={0.5} />
                </div>
              ))
            ) : (() => {
              // Get today's date in "Mar 5" format
              const today = new Date();
              const todayStr = today.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
              
              // Sort by priority: Watchlist first, then by time (BMO → AMC → TNS)
              const timeOrder = { 'BMO': 1, 'AMC': 2, 'TNS': 3 };
              const todayEarnings = earnings
                .sort((a, b) => {
                  // First priority: Watchlist stocks come first
                  const aInWatchlist = watchlist.has(a.ticker);
                  const bInWatchlist = watchlist.has(b.ticker);
                  if (aInWatchlist && !bInWatchlist) return -1;
                  if (!aInWatchlist && bInWatchlist) return 1;
                  
                  // Second priority: Sort by time (BMO → AMC → TNS)
                  return (timeOrder[a.time] || 999) - (timeOrder[b.time] || 999);
                })
                .slice(0, 10);
              
              if (todayEarnings.length === 0) {
                return <EmptyState icon="◎" label="NO EARNINGS TODAY" sub="Check back tomorrow for upcoming earnings" h={160} T={T} />;
              }
              
              // Table with header
              return (
                <div>
                  <div style={{ 
                    display:"grid", 
                    gridTemplateColumns:"1fr 0.8fr 0.6fr 0.8fr", 
                    gap:8, 
                    padding:"8px 0", 
                    borderBottom:`2px solid ${T.border}`,
                    fontSize:9,
                    fontFamily:T.font,
                    fontWeight:700,
                    color:T.text2,
                    textTransform:"uppercase",
                    letterSpacing:0.5
                  }}>
                    <span>SYMBOL</span>
                    <span>DATE</span>
                    <span>TIME</span>
                    <span>PRICE</span>
                  </div>
                  {todayEarnings.map((earning, i) => {
                    const ticker = tickers.get(earning.ticker);
                    const livePrice = ticker?.live_price || 0;
                    const isWatchlist = watchlist.has(earning.ticker);
                    
                    return (
                      <div key={i} style={{ 
                        display:"grid", 
                        gridTemplateColumns:"1fr 0.8fr 0.6fr 0.8fr", 
                        gap:8, 
                        alignItems:"center", 
                        padding:"10px 0", 
                        borderBottom:i<todayEarnings.length-1?`1px solid ${T.border}`:"none",
                        background: isWatchlist ? T.cyan+"08" : "transparent"
                      }}>
                        <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                          {isWatchlist && <span style={{ color:T.cyan, fontSize:14 }}>★</span>}
                          <a 
                            href={`https://finance.yahoo.com/quote/${earning.ticker}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ 
                              color:T.text0, 
                              fontSize:12, 
                              fontFamily:T.font, 
                              fontWeight:400,
                              textDecoration:"none",
                              cursor:"pointer"
                            }}
                            onMouseEnter={e => e.currentTarget.style.color = T.cyan}
                            onMouseLeave={e => e.currentTarget.style.color = T.text0}
                          >
                            {earning.ticker}
                          </a>
                        </div>
                        <span style={{ color:T.text2, fontSize:11, fontFamily:T.font, fontWeight:400 }}>
                          {todayStr}
                        </span>
                        <span style={{ 
                          color: earning.time === 'BMO' ? T.gold : earning.time === 'AMC' ? T.purple : T.text2, 
                          fontSize:10, 
                          fontFamily:T.font, 
                          fontWeight:400 
                        }}>
                          {earning.time}
                        </span>
                        <span style={{ color:T.cyan, fontSize:11, fontFamily:T.font, fontWeight:400 }}>
                          ${livePrice.toFixed(2)}
                        </span>
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

// ─── PAGE: Live Table ─────────────────────────────────────────────────────────
// • Sector filter bar with multi-select + counts + cap warning
// • Sub-mode tabs: MH (Market Hours) / AH (After Hours)
// • MH cols: SYMBOL+name+open | PRICE | $ CHG | %CHG | VOLUME | SIGNAL
// • AH cols: SYMBOL+name | PREV CLOSE | TODAY CLOSE | LIVE PRICE | CHANGE | %CHG
// • Source: ALL / WATCHLIST / (Yahoo Finance | TradingView) replaces PORTFOLIO
// • Matrix view: top 50 clean TradingView charts
function PageLiveTable({ selectedSectors, onSectorChange, tickers = new Map(), marketSession = "market", wsWatchlistRef = null, quickFilter = null, onClearQuickFilter = null, T }) {
  const [viewMode,   setViewMode]   = useState("TABLE");
  const autoSubMode = SESSION_META[marketSession]?.subMode ?? "MH";
  const [subModeOverride, setSubModeOverride] = useState(null);
  const subMode    = subModeOverride ?? autoSubMode;
  const setSubMode = (id) => setSubModeOverride(id === autoSubMode ? null : id);
  // Reset override when session boundary is crossed
  useEffect(() => { setSubModeOverride(null); }, [autoSubMode]);
  const [source,     setSource]     = useState("ALL");
  const [minDelta,   setMinDelta]   = useState(0);
  const [extLink,    setExtLink]    = useState("Yahoo Finance"); // Yahoo Finance | TradingView
  const [matrixCount,setMatrixCount]= useState(50);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedSymbol, setSelectedSymbol] = useState(null); // For chart panel
  const [chartOpenCount, setChartOpenCount] = useState(5); // How many charts to open
  const [watchlist, setWatchlist] = useState(new Set()); // ★ Persisted signal watchlist
  const tableScrollRef = useRef(null); // Ref for scroll-to-top on page change
  const ITEMS_PER_PAGE = 50;

  // ── Scalp signal map — BUY/SELL/HOLD badges in SIGNAL column ─────────────
  const [scalpSignals, setScalpSignals] = useState({}); // { TICKER: { signal, direction, strength, confidence } }
  useEffect(() => {
    const fetchScalp = () =>
      fetch(`${API_BASE}/api/scalp-analysis`)
        .then(r => r.ok ? r.json() : null)
        .then(d => {
          if (!d?.data) return;
          const m = {};
          d.data.forEach(r => { if (r.status === "ok") m[r.ticker] = r; });
          setScalpSignals(m);
        })
        .catch(() => {});
    fetchScalp();
    const id = setInterval(fetchScalp, 30_000); // refresh every 30s
    return () => clearInterval(id);
  }, []);
  
  // Fetch earnings for EARNINGS sector filter
  const [earningsTickers, setEarningsTickers] = useState(new Set());
  
  useEffect(() => {
    // Fetch only today's earnings
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
    fetch(`${API_BASE}/api/earnings?start=${today}&end=${today}`)
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(data => {
        const earningsArray = Array.isArray(data) ? data : [];
        // Get all tickers with earnings today
        const todayEarningsTickers = new Set(
          earningsArray.map(e => e.ticker)
        );
        setEarningsTickers(todayEarningsTickers);
      })
      .catch(err => console.warn('[NexRadar Live Table] Failed to load earnings:', err));
  }, []);

  // ── Load watchlist from backend on mount ─────────────────────────────────
  useEffect(() => {
    fetch(`${API_BASE}/api/watchlist`)
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(data => setWatchlist(new Set(data.watchlist ?? [])))
      .catch(err => console.warn('[NexRadar] Failed to load watchlist:', err));
  }, []);

  // ── Register setter into root ref so WS watchlist_update events reach here ─
  // The root onmessage handler calls wsWatchlistRef.current(newSet) when
  // another tab stars/unstars a ticker, keeping all tabs in sync.
  useEffect(() => {
    if (wsWatchlistRef) {
      wsWatchlistRef.current = setWatchlist;
    }
    return () => {
      if (wsWatchlistRef) wsWatchlistRef.current = null;
    };
  }, [wsWatchlistRef]);

  // ── Toggle watchlist — calls backend, optimistic UI update ───────────────
  const toggleWatchlist = async (symbol) => {
    const isWatched = watchlist.has(symbol);
    const endpoint  = isWatched
      ? `${API_BASE}/api/watchlist/remove`
      : `${API_BASE}/api/watchlist/add`;

    // Optimistic update — instant ★ feedback, no waiting for round-trip
    setWatchlist(prev => {
      const next = new Set(prev);
      isWatched ? next.delete(symbol) : next.add(symbol);
      return next;
    });

    try {
      const res = await fetch(endpoint, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ticker: symbol }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (err) {
      // Rollback on failure — revert the optimistic update
      console.error('[NexRadar] Watchlist toggle failed, rolling back:', err);
      setWatchlist(prev => {
        const next = new Set(prev);
        isWatched ? next.add(symbol) : next.delete(symbol);
        return next;
      });
    }
  };

  // Convert tickers Map to array and filter by sector
  const tickerArray = useMemo(() => {
    const arr = Array.from(tickers.values());

    // Filter by source (ALL or WATCHLIST)
    let filtered = arr;
    if (source === "WATCHLIST") {
      filtered = arr.filter(ticker => watchlist.has(ticker.ticker));
    }

    // Filter by selected sectors
    if (!selectedSectors.includes("ALL")) {
      filtered = filtered.filter(ticker => {
        // EARNINGS is a special pseudo-sector — matches tickers with earnings today
        if (selectedSectors.includes("EARNINGS")) {
          if (ticker.is_earnings_gap_play || earningsTickers.has(ticker.ticker)) return true;
        }
        const tickerSector = normalizeSector(ticker.sector);
        return tickerSector && selectedSectors.some(s => tickerSector === s && s !== "EARNINGS");
      });
    }

    return filtered;
  }, [tickers, selectedSectors, source, watchlist, earningsTickers]);

  const filteredTickers = useMemo(() => {
    let arr = tickerArray.filter(t => Math.abs(t.change_value || 0) >= minDelta);
    if (quickFilter === "VOL_SPIKES")  arr = arr.filter(t => t.volume_spike);
    if (quickFilter === "GAP_PLAYS")   arr = arr.filter(t => t.is_gap_play);
    if (quickFilter === "AH_MOMT")     arr = arr.filter(t => t.ah_momentum);
    if (quickFilter === "EARN_GAPS")   arr = arr.filter(t => t.is_earnings_gap_play);
    if (quickFilter === "DIAMOND")     arr = arr.filter(t => Math.abs(t.percent_change || 0) >= 5);
    return arr.sort((a, b) => (b.change_value || 0) - (a.change_value || 0));
  }, [tickerArray, minDelta, quickFilter]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedSectors, minDelta]);

  // Pagination calculations
  const totalPages = Math.ceil(filteredTickers.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const paginatedTickers = filteredTickers.slice(startIndex, endIndex);

  const handlePrevPage = () => {
    setCurrentPage(prev => Math.max(1, prev - 1));
    if (tableScrollRef.current) tableScrollRef.current.scrollTop = 0;
  };

  const handleNextPage = () => {
    setCurrentPage(prev => Math.min(totalPages, prev + 1));
    if (tableScrollRef.current) tableScrollRef.current.scrollTop = 0;
  };

  const activeLabel = selectedSectors.includes("ALL") ? "ALL" : selectedSectors.join(" + ");
  const tickerCount = tickerArray.length; // Use tickerArray (after sector filter) not filteredTickers (after minDelta filter)

  const matrixSymbols = useMemo(() => {
    if (filteredTickers && filteredTickers.length > 0) {
      return filteredTickers.slice(0, matrixCount).map(t => t.ticker);
    }
    return ["AAPL","MSFT","NVDA","AMZN","GOOGL","META","TSLA","AVGO","JPM","V",
      "MA","UNH","LLY","JNJ","XOM","PG","HD","BAC","ABBV","MRK","COST","NFLX","AMD",
      "TMO","CVX","ORCL","KO","CRM","QCOM","MCD","ACN","PFE","TXN","ABT","LIN",
      "CSCO","WFC","AXP","DHR","AMGN","INTU","IBM","SPGI","UPS","BKNG","GS","BLK",
      "DE","CAT","HON"].slice(0, matrixCount);
  }, [filteredTickers, matrixCount]);

  const openExternalCharts = () => {
    const topSymbols = filteredTickers.slice(0, chartOpenCount).map(t => t.ticker);
    topSymbols.forEach(sym => {
      const url = extLink === "TradingView"
        ? `https://www.tradingview.com/chart/?symbol=${sym}`
        : `https://finance.yahoo.com/quote/${sym}/chart`;
      window.open(url, "_blank");
    });
  };

  // MH column definitions - SYMBOL column includes star + symbol + company name stacked
  const MH_COLS = [
    { key:"symbol",   label:"SYMBOL",      w:"260px" },
    { key:"open",     label:"OPEN",        w:"1fr" },
    { key:"price",    label:"PRICE",       w:"1fr" },
    { key:"change",   label:"$ CHG",       w:"1fr" },
    { key:"pct",      label:"% CHG",       w:"1fr" },
    { key:"volume",   label:"VOLUME",      w:"1fr" },
    { key:"signal",   label:"SIGNAL",      w:"120px" },
  ];

  // AH column definitions
  const AH_COLS = [
    { key:"symbol",     label:"SYMBOL",        w:"260px" },
    { key:"prev_close", label:"PREV CLOSE",    w:"1fr" },
    { key:"today_close",label:"TODAY CLOSE",   w:"1fr" },
    { key:"live_price", label:"LIVE PRICE",    w:"1fr" },
    { key:"change",     label:"$ CHG",         w:"1fr" },
    { key:"pct",        label:"% CHG",         w:"1fr" },
  ];

  const cols = subMode === "MH" ? MH_COLS : AH_COLS;
  const gridCols = cols.map(c => c.w).join(" ");

  return (
    <div className="page-enter" style={{ display:"flex", flexDirection:"column", gap:12 }}>

      {/* ── SECTOR FILTER ── */}
      <div className="card" style={{ padding:"12px 16px" }}>
        <div style={{ display:"flex", alignItems:"flex-start", gap:12, flexWrap:"wrap" }}>
          <span style={{ color:T.text0, fontSize:13, letterSpacing:0.5, fontFamily:T.font, whiteSpace:"nowrap", marginTop:6, fontWeight:700 }}>
            SECTOR FILTER
          </span>
          <SectorPills selectedSectors={selectedSectors} onChange={onSectorChange} showCounts={false} actualCount={tickerArray.length} T={T} />
        </div>
      </div>

      {/* ── Controls row ── */}
      <div style={{ display:"flex", gap:9, alignItems:"center", flexWrap:"wrap" }}>
        {/* View mode */}
        <button className={`btn-ghost${viewMode==="TABLE"?" active":""}`}    onClick={()=>setViewMode("TABLE")}>≡ TABLE</button>
        <button className={`btn-ghost${viewMode==="MATRIX"?" active":""}`}   onClick={()=>setViewMode("MATRIX")}>⊞ MATRIX</button>
        {quickFilter && (
          <div style={{ display:"flex", alignItems:"center", gap:6, marginLeft:8, background:"rgba(34,211,238,0.08)", border:"1px solid rgba(34,211,238,0.25)", borderRadius:6, padding:"3px 10px" }}>
            <span style={{ color:T.cyan, fontSize:10, fontFamily:T.font, fontWeight:600 }}>{{"VOL_SPIKES":"📡 VOL SPIKES","GAP_PLAYS":"📊 GAP PLAYS","AH_MOMT":"🌙 AH MOMT.","EARN_GAPS":"📋 EARN. GAPS","DIAMOND":"💎 DIAMOND"}[quickFilter]}</span>
            <button onClick={() => onClearQuickFilter && onClearQuickFilter()} style={{ background:"none", border:"none", color:"#4a6278", cursor:"pointer", fontSize:13, lineHeight:1, padding:0 }}>✕</button>
          </div>
        )}

        {/* MH / AH sub-mode (TABLE only) */}
        {viewMode === "TABLE" && (
          <div style={{ display:"flex", background:T.bg2, border:`1px solid ${T.border}`, borderRadius:5, overflow:"hidden" }}>
            {[["MH","MARKET HOURS"],["AH","AFTER HOURS"]].map(([id, lbl]) => (
              <button key={id} onClick={()=>setSubMode(id)}
                style={{ background:subMode===id?T.cyan+"14":"transparent",
                  color:subMode===id?T.cyan:T.text2,
                  border:"none", padding:"5px 12px", cursor:"pointer",
                  fontFamily:T.font, fontSize:9, letterSpacing:1, borderRight:id==="MH"?`1px solid ${T.border}`:"none" }}>
                {lbl}
              </button>
            ))}
          </div>
        )}

        {/* Min delta slider */}
        <div style={{ display:"flex", alignItems:"center", gap:7 }}>
          <span style={{ color:T.text2, fontSize:9.5, fontFamily:T.font }}>MIN Δ$</span>
          <input type="range" min="0" max="5" step="0.1" value={minDelta}
            onChange={e=>setMinDelta(Number(e.target.value))} style={{ width:90, accentColor:T.cyan }}/>
          <span style={{ color:T.cyan, fontSize:9.5, fontFamily:T.font, minWidth:26 }}>{minDelta.toFixed(1)}</span>
        </div>

        {/* Source + chart count + external link */}
        <div style={{ marginLeft:"auto", display:"flex", gap:6, alignItems:"center" }}>
          {["ALL","WATCHLIST"].map(s => (
            <button key={s} className={`btn-ghost${source===s?" active":""}`}
              onClick={()=>setSource(s)} style={{ fontSize:9 }}>{s}</button>
          ))}

          {/* Chart count selector */}
          <div style={{ display:"flex", alignItems:"center", gap:4, marginLeft:8 }}>
            <span style={{ color:T.text2, fontSize:9, fontFamily:T.font, whiteSpace:"nowrap" }}>OPEN</span>
            <select value={chartOpenCount} onChange={e=>setChartOpenCount(Number(e.target.value))}
              style={{ background:T.bg2, border:`1px solid ${T.border}`, color:T.text1, fontFamily:T.font, fontSize:9, padding:"5px 8px", cursor:"pointer", outline:"none", borderRadius:5, letterSpacing:0.5 }}>
              <option value={5}>5</option>
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
            </select>
            <span style={{ color:T.text2, fontSize:9, fontFamily:T.font }}>CHARTS</span>
          </div>

          {/* External chart opener */}
          <div style={{ display:"flex", alignItems:"center", gap:0, border:`1px solid ${T.border}`, borderRadius:5, overflow:"hidden" }}>
            <select value={extLink} onChange={e=>setExtLink(e.target.value)}
              style={{ background:T.bg2, border:"none", color:T.text1, fontFamily:T.font, fontSize:9, padding:"5px 8px", cursor:"pointer", outline:"none", letterSpacing:0.5 }}>
              <option>Yahoo Finance</option>
              <option>TradingView</option>
            </select>
            <button onClick={openExternalCharts}
              style={{ background:T.cyan+"14", border:"none", borderLeft:`1px solid ${T.border}`, color:T.cyan,
                padding:"5px 10px", cursor:"pointer", fontFamily:T.font, fontSize:9, letterSpacing:0.5, fontWeight:600 }}>
              OPEN CHARTS
            </button>
          </div>
        </div>
      </div>

      {/* ── TABLE VIEW with optional Chart Panel ── */}
      {viewMode === "TABLE" && (
        <div style={{ display:"flex", gap:16, height:"100%" }}>
          {/* Main Table */}
          <div className="card" style={{ flex: selectedSymbol ? "1 1 60%" : "1 1 100%", transition:"flex 0.3s ease" }}>
          <SectionHeader title={`Live Stock Data · ${subMode === "MH" ? "Market Hours" : "After Hours"}${!selectedSectors.includes("ALL") ? ` · ${activeLabel}` : ""}`} T={T}>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <span style={{ color:T.text2, fontSize:12, fontFamily:T.font, fontWeight:500 }}>{tickerCount.toLocaleString()} tickers</span>
              {tickers.size > 0 ? (
                <>
                  <span className="live-dot"/>
                  <span style={{ color:T.green, fontSize:12, fontFamily:T.font, fontWeight:600 }}>LIVE</span>
                </>
              ) : (
                <span style={{ color:T.text2, fontSize:12, fontFamily:T.font, fontWeight:500 }}>CONNECTING…</span>
              )}
            </div>
          </SectionHeader>

          {/* Column headers */}
          <div style={{ display:"grid", gridTemplateColumns:gridCols, background:T.bg0, borderBottom:`1px solid ${T.border}` }}>
            {cols.map(c => (
              <div key={c.key} style={{ padding:"12px 14px", color:T.text0, fontSize:11, letterSpacing:1, fontFamily:T.font, fontWeight:800, textTransform:"uppercase" }}>
                {c.label} <span style={{ opacity:0.3, fontSize:10 }}>⇅</span>
              </div>
            ))}
          </div>

          {/* Scrollable Rows Container */}
          <div ref={tableScrollRef} style={{ maxHeight:"calc(100vh - 420px)", minHeight:"300px", overflowY:"auto", overflowX:"hidden", position:"relative" }}>
            {paginatedTickers.length === 0 ? (
              <div style={{ padding:40, textAlign:"center", color:T.text2, fontSize:13, fontFamily:T.font }}>
                {tickers.size === 0 ? 'Waiting for live data from WebSocket...' : 'No tickers match the current filter'}
              </div>
            ) : (
              <>
                {paginatedTickers.map((ticker, i) => {
                const isPositive = (ticker.change_value || 0) >= 0;
                const changeColor = isPositive ? T.green : T.red;
                
                return (
                  <div key={ticker.ticker || i} className="tr-hover" style={{ display:"grid", gridTemplateColumns:gridCols, borderBottom:`1px solid ${T.border}` }}>
                    {subMode === "MH" ? (
                      <>
                        {/* Symbol + Company (stacked with star) */}
                        <div style={{ padding:"10px 14px", display:"flex", alignItems:"flex-start", gap:10 }}>
                          {/* Star icon for watchlist */}
                          <button
                            onClick={(e) => { e.stopPropagation(); toggleWatchlist(ticker.ticker); }}
                            style={{ 
                              background:"none", 
                              border:"none", 
                              cursor:"pointer", 
                              fontSize:14, 
                              padding:0,
                              marginTop:2,
                              color: watchlist.has(ticker.ticker) ? T.gold : T.text2,
                              opacity: watchlist.has(ticker.ticker) ? 1 : 0.3,
                              transition:"all 0.2s",
                              flexShrink:0
                            }}
                            onMouseEnter={e => e.currentTarget.style.opacity = 1}
                            onMouseLeave={e => e.currentTarget.style.opacity = watchlist.has(ticker.ticker) ? 1 : 0.3}
                            title={watchlist.has(ticker.ticker) ? "Remove from watchlist" : "Add to watchlist"}
                          >
                            {watchlist.has(ticker.ticker) ? "⭐" : "☆"}
                          </button>
                          
                          {/* Symbol + Company stacked */}
                          <div 
                            style={{ flex:1, cursor:"pointer", minWidth:0 }}
                            onClick={() => setSelectedSymbol(ticker.ticker)}
                          >
                            <div style={{ 
                              color:T.cyan, 
                              fontSize:13, 
                              fontFamily:T.font, 
                              fontWeight:700,
                              textDecoration:"underline",
                              textDecorationColor:T.cyan+"40",
                              marginBottom:3,
                              lineHeight:1.2
                            }}>{ticker.ticker}</div>
                            <div style={{ 
                              color:T.text2, 
                              fontSize:10, 
                              fontFamily:T.font, 
                              whiteSpace:"nowrap", 
                              overflow:"hidden", 
                              textOverflow:"ellipsis",
                              maxWidth:"100%",
                              lineHeight:1.3
                            }}>
                              {ticker.company_name && ticker.company_name !== ticker.ticker
                                ? ticker.company_name
                                : <span style={{ opacity:0.4 }}>—</span>}
                            </div>
                          </div>
                        </div>
                        {/* Open */}
                        <div style={{ padding:"10px 14px", color:T.text1, fontFamily:T.font, fontSize:13, display:"flex", alignItems:"center" }}>{fmt2(ticker.open || 0)}</div>
                        {/* Price */}
                        <div style={{ padding:"10px 14px", color:T.text0, fontFamily:T.font, fontSize:13, display:"flex", alignItems:"center" }}>{fmt2(ticker.live_price || 0)}</div>
                        {/* Change */}
                        <div style={{ padding:"10px 14px", color:changeColor, fontFamily:T.font, fontSize:13, display:"flex", alignItems:"center" }}>
                          {isPositive ? '+' : ''}{fmt2(ticker.change_value || 0)}
                        </div>
                        {/* %CHG */}
                        <div style={{ padding:"10px 14px", color:changeColor, fontFamily:T.font, fontSize:13, display:"flex", alignItems:"center" }}>
                          {pct(ticker.percent_change || 0)}
                        </div>
                        {/* Volume */}
                        <div style={{ padding:"10px 14px", color:T.text1, fontFamily:T.font, fontSize:13, display:"flex", alignItems:"center" }}>
                          {fmtVol(ticker.volume || 0)}
                        </div>
                        {/* SIGNAL — from scalp analysis engine */}
                        <div style={{ padding:"10px 14px", display:"flex", alignItems:"center", gap:5 }}>
                          {(() => {
                            const sig = scalpSignals[ticker.ticker];
                            if (!sig) {
                              return ticker.volume_spike
                                ? <span style={{ color:T.orange, fontSize:10, fontFamily:T.font, background:T.orangeDim, padding:"3px 8px", borderRadius:4, fontWeight:600 }}>VOL⚡</span>
                                : <span style={{ color:T.text2, fontSize:11 }}>—</span>;
                            }
                            const clr = sig.signal === "BUY" ? T.green : sig.signal === "SELL" ? T.red : T.text2;
                            const bg  = sig.signal === "BUY" ? T.greenDim : sig.signal === "SELL" ? T.redDim : T.bg2;
                            return (
                              <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
                                <span style={{ color:clr, fontSize:11, fontFamily:T.font, fontWeight:800, background:bg, padding:"3px 8px", borderRadius:4, letterSpacing:0.5 }}>
                                  {sig.signal === "BUY" ? "▲ BUY" : sig.signal === "SELL" ? "▼ SELL" : "◈ HOLD"}
                                </span>
                                <span style={{ color:T.text2, fontSize:9, fontFamily:T.font }}>
                                  {sig.strength} · {sig.prediction}%
                                </span>
                              </div>
                            );
                          })()}
                        </div>
                      </>
                    ) : (
                      <>
                        {/* Symbol + Company (stacked with star) */}
                        <div style={{ padding:"10px 14px", display:"flex", alignItems:"flex-start", gap:10 }}>
                          {/* Star icon for watchlist */}
                          <button
                            onClick={(e) => { e.stopPropagation(); toggleWatchlist(ticker.ticker); }}
                            style={{ 
                              background:"none", 
                              border:"none", 
                              cursor:"pointer", 
                              fontSize:14, 
                              padding:0,
                              marginTop:2,
                              color: watchlist.has(ticker.ticker) ? T.gold : T.text2,
                              opacity: watchlist.has(ticker.ticker) ? 1 : 0.3,
                              transition:"all 0.2s",
                              flexShrink:0
                            }}
                            onMouseEnter={e => e.currentTarget.style.opacity = 1}
                            onMouseLeave={e => e.currentTarget.style.opacity = watchlist.has(ticker.ticker) ? 1 : 0.3}
                            title={watchlist.has(ticker.ticker) ? "Remove from watchlist" : "Add to watchlist"}
                          >
                            {watchlist.has(ticker.ticker) ? "⭐" : "☆"}
                          </button>
                          
                          {/* Symbol + Company stacked */}
                          <div 
                            style={{ flex:1, cursor:"pointer", minWidth:0 }}
                            onClick={() => setSelectedSymbol(ticker.ticker)}
                          >
                            <div style={{ 
                              color:T.cyan, 
                              fontSize:13, 
                              fontFamily:T.font, 
                              fontWeight:700,
                              textDecoration:"underline",
                              textDecorationColor:T.cyan+"40",
                              marginBottom:3,
                              lineHeight:1.2
                            }}>{ticker.ticker}</div>
                            <div style={{ 
                              color:T.text2, 
                              fontSize:10, 
                              fontFamily:T.font, 
                              whiteSpace:"nowrap", 
                              overflow:"hidden", 
                              textOverflow:"ellipsis",
                              maxWidth:"100%",
                              lineHeight:1.3
                            }}>
                              {ticker.company_name && ticker.company_name !== ticker.ticker
                                ? ticker.company_name
                                : <span style={{ opacity:0.4 }}>—</span>}
                            </div>
                          </div>
                        </div>
                        {/* Prev Close */}
                        <div style={{ padding:"10px 14px", color:T.text1, fontFamily:T.font, fontSize:13, display:"flex", alignItems:"center" }}>{fmt2(ticker.prev_close || 0)}</div>
                        {/* Today Close */}
                        <div style={{ padding:"10px 14px", color:T.text1, fontFamily:T.font, fontSize:13, display:"flex", alignItems:"center" }}>{fmt2(ticker.today_close || 0)}</div>
                        {/* Live Price */}
                        <div style={{ padding:"10px 14px", color:T.cyan, fontFamily:T.font, fontSize:13, display:"flex", alignItems:"center" }}>{fmt2(ticker.live_price || 0)}</div>
                        {/* Change */}
                        <div style={{ padding:"10px 14px", color:changeColor, fontFamily:T.font, fontSize:13, display:"flex", alignItems:"center" }}>
                          {isPositive ? '+' : ''}{fmt2(ticker.change_value || 0)}
                        </div>
                        {/* %CHG */}
                        <div style={{ padding:"10px 14px", color:changeColor, fontFamily:T.font, fontSize:13, display:"flex", alignItems:"center" }}>
                          {pct(ticker.percent_change || 0)}
                        </div>
                      </>
                    )}
                  </div>
                );
              })
              }
              
              {/* Bottom fade gradient — purely decorative, shows more content below */}
              {paginatedTickers.length >= 10 && (
                <div style={{ 
                  position:"sticky", 
                  bottom:0, 
                  left:0, 
                  right:0, 
                  height:40,
                  background:`linear-gradient(to bottom, transparent, ${T.bg1})`,
                  pointerEvents:"none"
                }}/>
              )}
              </>
            )}
          </div>

          {/* Pagination Footer - Always visible at bottom */}
          <div style={{ 
            padding:"14px 18px", 
            borderTop:`2px solid ${T.border}`, 
            display:"flex", 
            justifyContent:"space-between", 
            alignItems:"center", 
            background:T.bg1,
            position:"sticky",
            bottom:0,
            zIndex:10
          }}>
            <span style={{ color:T.text1, fontSize:13, fontFamily:T.font, fontWeight:600 }}>
              {paginatedTickers.length > 0 
                ? `Showing ${startIndex + 1}-${Math.min(endIndex, filteredTickers.length)} of ${filteredTickers.length.toLocaleString()} stocks`
                : 'No stocks to display'}
            </span>
            <div style={{ display:"flex", gap:10, alignItems:"center" }}>
              <span style={{ color:T.text1, fontSize:13, fontFamily:T.font, fontWeight:600 }}>
                Page {currentPage} of {totalPages || 1}
              </span>
              <button 
                className="btn-ghost" 
                style={{ fontSize:12, padding:"6px 12px" }}
                onClick={handlePrevPage}
                disabled={currentPage === 1}
              >
                ← PREV
              </button>
              <button 
                className="btn-ghost" 
                style={{ fontSize:12, padding:"6px 12px" }}
                onClick={handleNextPage}
                disabled={currentPage >= totalPages}
              >
                NEXT →
              </button>
            </div>
          </div>
        </div>
          
          {/* Chart Panel - Appears on right when symbol selected */}
          {selectedSymbol && (
            <div className="card" style={{ flex:"1 1 38%", display:"flex", flexDirection:"column", minWidth:400, maxWidth:500 }}>
              <SectionHeader title={selectedSymbol} T={T}>
                <button 
                  className="btn-ghost" 
                  style={{ fontSize:11, padding:"4px 10px" }}
                  onClick={() => setSelectedSymbol(null)}
                >
                  ✕ CLOSE
                </button>
              </SectionHeader>
              
              {/* TradingView Chart */}
              <div style={{ flex:1, minHeight:400 }}>
                <TVChart symbol={selectedSymbol} height={400} T={T} />
              </div>
              
              {/* Quick Stats */}
              <div style={{ padding:"14px 16px", borderTop:`1px solid ${T.border}`, background:T.bg0 }}>
                {(() => {
                  const tickerData = tickers.get(selectedSymbol);
                  if (!tickerData) return <div style={{ color:T.text2, fontSize:12, fontFamily:T.font }}>Loading data...</div>;
                  
                  const isPositive = (tickerData.change_value || 0) >= 0;
                  const changeColor = isPositive ? T.green : T.red;
                  
                  return (
                    <div style={{ display:"grid", gridTemplateColumns:"repeat(2, 1fr)", gap:12 }}>
                      <div>
                        <div style={{ color:T.text2, fontSize:11, fontFamily:T.font, marginBottom:4, fontWeight:600 }}>PRICE</div>
                        <div style={{ color:T.text0, fontSize:18, fontFamily:T.font, fontWeight:700 }}>${fmt2(tickerData.live_price || 0)}</div>
                      </div>
                      <div>
                        <div style={{ color:T.text2, fontSize:11, fontFamily:T.font, marginBottom:4, fontWeight:600 }}>CHANGE</div>
                        <div style={{ color:changeColor, fontSize:16, fontFamily:T.font, fontWeight:700 }}>
                          {isPositive ? '+' : ''}{fmt2(tickerData.change_value || 0)} ({pct(tickerData.percent_change || 0)})
                        </div>
                      </div>
                      <div>
                        <div style={{ color:T.text2, fontSize:11, fontFamily:T.font, marginBottom:4, fontWeight:600 }}>OPEN</div>
                        <div style={{ color:T.text1, fontSize:14, fontFamily:T.font, fontWeight:600 }}>${fmt2(tickerData.open || 0)}</div>
                      </div>
                      <div>
                        <div style={{ color:T.text2, fontSize:11, fontFamily:T.font, marginBottom:4, fontWeight:600 }}>VOLUME</div>
                        <div style={{ color:T.text1, fontSize:14, fontFamily:T.font, fontWeight:600 }}>{fmtK(tickerData.volume || 0)}</div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── MATRIX VIEW: Top 50 clean TradingView charts ── */}
      {viewMode === "MATRIX" && (
        <div>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
            <div style={{ display:"flex", gap:6, alignItems:"center" }}>
              <span style={{ color:T.text1, fontSize:10, fontFamily:T.font, letterSpacing:1.5 }}>TOP</span>
              {[20,50].map(n=>(
                <button key={n} className={`btn-ghost${matrixCount===n?" active":""}`}
                  onClick={()=>setMatrixCount(n)} style={{ fontSize:9, padding:"3px 9px" }}>
                  {n}
                </button>
              ))}
              <span style={{ color:T.text2, fontSize:9, fontFamily:T.font }}>clean chart · no indicators</span>
            </div>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))", gap:10 }}>
            {matrixSymbols.map(sym => (
              <div key={sym} className="card" style={{ overflow:"hidden" }}>
                <div style={{ padding:"7px 12px", borderBottom:`1px solid ${T.border}`, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <span style={{ color:T.text0, fontFamily:T.font, fontSize:12, fontWeight:700 }}>{sym}</span>
                  <a href={`https://www.tradingview.com/chart/?symbol=${sym}`} target="_blank" rel="noreferrer"
                    style={{ color:T.text2, fontSize:8.5, textDecoration:"none", fontFamily:T.font }}>↗ TV</a>
                </div>
                <TVChart symbol={sym} height={180} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── PAGE: Chart (PRESERVED as-is) ───────────────────────────────────────────
function useKeyStats(sym) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!sym) { setStats(null); return; }
    setLoading(true); setStats(null);
    fetch(`${API_BASE}/api/quote/${sym}`)
      .then(r => { if (!r.ok) throw new Error("backend"); return r.json(); })
      .then(data => setStats(data))
      .catch(() =>
        fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(`https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=1d`)}`)
          .then(r => r.json()).then(w => {
            const meta = JSON.parse(w.contents)?.chart?.result?.[0]?.meta ?? {};
            setStats({ open:meta.regularMarketOpen, high:meta.regularMarketDayHigh, low:meta.regularMarketDayLow, prevClose:meta.chartPreviousClose, volume:meta.regularMarketVolume, avgVol:meta.averageDailyVolume10Day, marketCap:meta.marketCap, wkHi52:meta.fiftyTwoWeekHigh, wkLo52:meta.fiftyTwoWeekLow, exchange:meta.exchangeName });
          }).catch(() => setStats(null))
      ).finally(() => setLoading(false));
  }, [sym]);
  return { stats, loading };
}

function useNewsFeed(sym) {
  const [news, setNews] = useState([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!sym) { setNews([]); return; }
    setLoading(true); setNews([]);
    fetch(`${API_BASE}/api/news/${sym}`)
      .then(r => { if (!r.ok) throw new Error("backend"); return r.json(); })
      .then(data => setNews(data.items ?? []))
      .catch(() =>
        fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(`https://feeds.finance.yahoo.com/rss/2.0/headline?s=${sym}&region=US&lang=en-US`)}`)
          .then(r => r.json()).then(w => {
            const xml = new DOMParser().parseFromString(w.contents, "text/xml");
            setNews(Array.from(xml.querySelectorAll("item")).slice(0, 8).map(it => ({
              title: it.querySelector("title")?.textContent ?? "", link: it.querySelector("link")?.textContent ?? "#",
              pubDate: it.querySelector("pubDate")?.textContent ?? "", source: it.querySelector("source")?.textContent ?? "Yahoo Finance",
            })));
          }).catch(() => setNews([]))
      ).finally(() => setLoading(false));
  }, [sym]);
  return { news, loading };
}

function _fmtBig(n) {
  if (!n) return "—";
  if (n >= 1e12) return `$${(n/1e12).toFixed(2)}T`;
  if (n >= 1e9)  return `$${(n/1e9).toFixed(2)}B`;
  if (n >= 1e6)  return `$${(n/1e6).toFixed(2)}M`;
  return `$${n.toLocaleString()}`;
}
function _fmtVol(n) {
  if (!n) return "—";
  if (n >= 1e9) return `${(n/1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n/1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n/1e3).toFixed(1)}K`;
  return String(n);
}
function _timeAgo(d) {
  if (!d) return "";
  const m = Math.floor((Date.now() - new Date(d)) / 60000);
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.floor(m/60)}h ago`;
  return `${Math.floor(m/1440)}d ago`;
}

function PageChart({ T }) {
  const [inputVal,   setInputVal]   = useState("");
  const [sym,        setSym]        = useState("");
  const [tf,         setTf]         = useState("1D");
  const [chartStyle, setChartStyle] = useState("1");
  const TF_MAP = {"1m":"1","5m":"5","15m":"15","1H":"60","4H":"240","1D":"D","1W":"W"};
  const { stats, loading: sLoad } = useKeyStats(sym);
  const { news,  loading: nLoad } = useNewsFeed(sym);
  const handleLoad = () => { const s = inputVal.trim().toUpperCase(); if (s) setSym(s); };
  const statRows = stats ? [
    ["Open",        stats.open      ? `$${(+stats.open).toFixed(2)}`      : "—"],
    ["Day High",    stats.high      ? `$${(+stats.high).toFixed(2)}`      : "—"],
    ["Day Low",     stats.low       ? `$${(+stats.low).toFixed(2)}`       : "—"],
    ["Prev Close",  stats.prevClose ? `$${(+stats.prevClose).toFixed(2)}` : "—"],
    ["Volume",      _fmtVol(stats.volume)],
    ["Avg Vol 10d", _fmtVol(stats.avgVol)],
    ["Market Cap",  _fmtBig(stats.marketCap)],
    ["52W High",    stats.wkHi52    ? `$${(+stats.wkHi52).toFixed(2)}`   : "—"],
    ["52W Low",     stats.wkLo52    ? `$${(+stats.wkLo52).toFixed(2)}`   : "—"],
    ["Exchange",    stats.exchange  ?? "—"],
  ] : [];

  return (
    <div className="page-enter" style={{ display:"flex", flexDirection:"column", gap:16 }}>
      <div style={{ display:"flex", gap:10, alignItems:"center", flexWrap:"wrap" }}>
        <input placeholder="Enter symbol…" value={inputVal}
          onChange={e => setInputVal(e.target.value.toUpperCase())}
          onKeyDown={e => e.key === "Enter" && handleLoad()}
          style={{ background:T.bg2, border:`1px solid ${T.border}`, borderRadius:7,
            padding:"7px 13px", color:T.text0, fontFamily:T.font, fontSize:13, outline:"none", width:170 }}/>
        <button onClick={handleLoad}
          style={{ background:T.cyanDim, border:`1px solid ${T.cyanMid}`, color:T.cyan,
            borderRadius:6, padding:"6px 14px", cursor:"pointer", fontFamily:T.font, fontSize:10, fontWeight:700, letterSpacing:1 }}>LOAD</button>
        {["1m","5m","15m","1H","4H","1D","1W"].map(t => (
          <button key={t} onClick={() => setTf(t)}
            style={{ background:tf===t?T.cyanDim:T.bg2, border:`1px solid ${tf===t?T.cyanMid:T.border}`,
              color:tf===t?T.cyan:T.text2, borderRadius:5, padding:"5px 11px",
              cursor:"pointer", fontFamily:T.font, fontSize:10, letterSpacing:1 }}>{t}</button>
        ))}
        <div style={{ marginLeft:"auto", display:"flex", gap:6 }}>
          {[["CANDLE","1"],["LINE","2"],["BAR","3"]].map(([lbl, s]) => (
            <button key={lbl} onClick={() => setChartStyle(s)}
              className={`btn-ghost${chartStyle===s?" active":""}`} style={{ fontSize:9 }}>{lbl}</button>
          ))}
        </div>
      </div>
      <div style={{ display:"flex", gap:16, alignItems:"flex-start", flexWrap:"wrap" }}>
        <div className="card" style={{ flex:3, minWidth:300, overflow:"hidden" }}>
          <SectionHeader title={sym||"— SELECT SYMBOL"}><Chip color={T.cyan}>{tf}</Chip></SectionHeader>
          {sym
            ? <TVChart symbol={sym} height={460} T={T} interval={TF_MAP[tf]} style={chartStyle}/>
            : <EmptyChart height={460} label="Enter a symbol above and press LOAD or Enter"/>}
        </div>
        <div style={{ flex:1, minWidth:230, display:"flex", flexDirection:"column", gap:14 }}>
          <div className="card">
            <SectionHeader title="Key Stats">{sym && <span style={{ color:T.text2, fontSize:9, fontFamily:T.font }}>{sym}</span>}</SectionHeader>
            <div style={{ padding:"10px 13px" }}>
              {!sym && <p style={{ color:T.text2, fontSize:9.5, fontFamily:T.font, margin:0 }}>Load a symbol to see stats.</p>}
              {sym && sLoad && Array(8).fill(0).map((_,i) => (
                <div key={i} style={{ display:"flex", justifyContent:"space-between", marginBottom:7 }}>
                  <Shimmer w={80} h={10}/><Shimmer w={55} h={10}/>
                </div>
              ))}
              {sym && !sLoad && !stats && <p style={{ color:T.red, fontSize:9.5, fontFamily:T.font, margin:0 }}>⚠ Could not load stats — check symbol or network</p>}
              {statRows.map(([label, val]) => (
                <div key={label} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"5px 0", borderBottom:`1px solid ${T.border}` }}>
                  <span style={{ color:T.text2, fontSize:9.5, fontFamily:T.font }}>{label}</span>
                  <span style={{ color:T.text0, fontSize:10, fontFamily:T.font, fontWeight:600 }}>{val}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="card">
            <SectionHeader title="News Feed">{sym && <span style={{ color:T.text2, fontSize:9, fontFamily:T.font }}>{sym}</span>}</SectionHeader>
            <div style={{ padding:"10px 13px", display:"flex", flexDirection:"column", gap:8 }}>
              {!sym && <p style={{ color:T.text2, fontSize:9.5, fontFamily:T.font, margin:0 }}>Load a symbol to see news.</p>}
              {sym && nLoad && Array(4).fill(0).map((_,i) => (
                <div key={i} style={{ display:"flex", flexDirection:"column", gap:4 }}>
                  <Shimmer w="100%" h={10}/><Shimmer w="60%" h={8}/>
                </div>
              ))}
              {sym && !nLoad && news.length === 0 && <p style={{ color:T.text2, fontSize:9.5, fontFamily:T.font, margin:0 }}>No recent news for {sym}.</p>}
              {news.map((item, i) => (
                <a key={i} href={item.link} target="_blank" rel="noreferrer"
                  style={{ textDecoration:"none", display:"block", padding:"8px 10px", borderRadius:6,
                    background:T.bg2, border:`1px solid ${T.border}`, transition:"border-color 0.15s" }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = T.cyanMid}
                  onMouseLeave={e => e.currentTarget.style.borderColor = T.border}>
                  <p style={{ color:T.text0, fontSize:10, fontFamily:T.font, lineHeight:1.45, margin:"0 0 4px 0" }}>{item.title}</p>
                  <div style={{ display:"flex", justifyContent:"space-between" }}>
                    <span style={{ color:T.cyan,  fontSize:8.5, fontFamily:T.font }}>{item.source}</span>
                    <span style={{ color:T.text2, fontSize:8.5, fontFamily:T.font }}>{_timeAgo(item.pubDate)}</span>
                  </div>
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


// ─── PAGE: Signals - Scalp Signals + Pro Scalp Analysis + Tech Analysis ───────
function PageSignals({ tickers = new Map(), selectedSectors = ["ALL"], T }) {
  const [signalView, setSignalView] = useState("SIGNALS"); // "SIGNALS" | "TECH"

  // ── PRO SCALP (Signals tab) state ──────────────────────────────────────────
  const [proData,    setProData]    = useState([]);
  const [proLoading, setProLoading] = useState(false);
  const [proError,   setProError]   = useState(null);
  const [proFilter,  setProFilter]  = useState("ALL"); // ALL|BUY|SELL|STRONG
  const [proSort,    setProSort]    = useState("confidence");
  const [proSortAsc, setProSortAsc] = useState(false);
  const proIntervalRef = useRef(null);

  const fetchProData = () => {
    setProLoading(true); setProError(null);
    fetch(`${API_BASE}/api/scalp-analysis`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(d => { setProData(d.data || []); })
      .catch(e => setProError(e.message))
      .finally(() => setProLoading(false));
  };

  // Auto-fetch + 30s poll when Signals tab active
  useEffect(() => {
    if (signalView === "SIGNALS") {
      fetchProData();
      proIntervalRef.current = setInterval(fetchProData, 30_000);
    } else {
      clearInterval(proIntervalRef.current);
    }
    return () => clearInterval(proIntervalRef.current);
  }, [signalView]);

  // ── TECH ANALYSIS state (unchanged) ───────────────────────────────────────
  const [techData,      setTechData]      = useState([]);
  const [techLoading,   setTechLoading]   = useState(false);
  const [techError,     setTechError]     = useState(null);
  const [techLastFetch, setTechLastFetch] = useState(null);
  const [techCached,    setTechCached]    = useState(false);
  const [techSortKey,   setTechSortKey]   = useState("score");
  const [techSortAsc,   setTechSortAsc]   = useState(false);
  const [techFilter,    setTechFilter]    = useState("ALL");

  const fetchTechData = (forceRefresh = false) => {
    setTechLoading(true); setTechError(null);
    fetch(`${API_BASE}/api/market-monitor${forceRefresh ? "?refresh=1" : ""}`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(json => {
        if (json.error) { setTechError(json.error); return; }
        setTechData(json.data || []);
        setTechCached(json.cached || false);
        setTechLastFetch(new Date());
      })
      .catch(err => setTechError(err.message))
      .finally(() => setTechLoading(false));
  };

  useEffect(() => {
    if (signalView === "TECH" && techData.length === 0 && !techLoading) fetchTechData();
  }, [signalView]);

  // ── PRO SCALP processed rows ───────────────────────────────────────────────
  const proRows = useMemo(() => {
    let rows = proData.filter(r => r.status === "ok");
    if (proFilter === "BUY")    rows = rows.filter(r => r.signal === "BUY");
    else if (proFilter === "SELL")   rows = rows.filter(r => r.signal === "SELL");
    else if (proFilter === "STRONG") rows = rows.filter(r => r.strength === "STRONG");
    rows = [...rows].sort((a, b) => {
      let va = a[proSort] ?? 0, vb = b[proSort] ?? 0;
      if (typeof va === "string") return proSortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
      return proSortAsc ? va - vb : vb - va;
    });
    return rows;
  }, [proData, proFilter, proSort, proSortAsc]);

  const proWarmingUp = proData.filter(r => r.status === "warming_up");
  const proStats = useMemo(() => ({
    buy:    proData.filter(r => r.signal === "BUY").length,
    sell:   proData.filter(r => r.signal === "SELL").length,
    strong: proData.filter(r => r.strength === "STRONG").length,
    total:  proData.filter(r => r.status === "ok").length,
  }), [proData]);

  const handleProSort = key => {
    if (proSort === key) setProSortAsc(!proSortAsc);
    else { setProSort(key); setProSortAsc(false); }
  };

  // ── TECH processed rows (unchanged) ───────────────────────────────────────
  const techRows = useMemo(() => {
    let rows = [...techData];
    if (techFilter === "BULLISH") rows = rows.filter(r => r.score > 0);
    else if (techFilter === "BEARISH") rows = rows.filter(r => r.score < 0);
    else if (techFilter === "ALERTS") rows = rows.filter(r => r.alerts?.length > 0);
    rows.sort((a, b) => {
      let va = a[techSortKey] ?? (techSortAsc ? Infinity : -Infinity);
      let vb = b[techSortKey] ?? (techSortAsc ? Infinity : -Infinity);
      if (typeof va === "string") return techSortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
      return techSortAsc ? va - vb : vb - va;
    });
    return rows;
  }, [techData, techFilter, techSortKey, techSortAsc]);

  const techStats = useMemo(() => {
    if (!techData.length) return null;
    return {
      bullish:    techData.filter(r => r.score > 0).length,
      bearish:    techData.filter(r => r.score < 0).length,
      oversold:   techData.filter(r => r.rsi_signal === "Oversold").length,
      overbought: techData.filter(r => r.rsi_signal === "Overbought").length,
      alerts:     techData.filter(r => r.alerts?.length > 0).length,
    };
  }, [techData]);

  // ── Column definitions ─────────────────────────────────────────────────────
  const PRO_COLS = [
    { key:"ticker",       label:"TICKER",     w:"90px"  },
    { key:"price",        label:"PRICE",      w:"80px"  },
    { key:"signal",       label:"SIGNAL",     w:"90px"  },
    { key:"prediction",   label:"PRED %",     w:"70px"  },
    { key:"vwap_status",  label:"VWAP",       w:"80px"  },
    { key:"support",      label:"SUPPORT",    w:"80px"  },
    { key:"resistance",   label:"RESIST",     w:"80px"  },
    { key:"candle",       label:"CANDLE",     w:"130px" },
    { key:"macd_signal",  label:"MACD",       w:"80px"  },
    { key:"rsi",          label:"RSI",        w:"55px"  },
    { key:"stoch_signal", label:"STOCH",      w:"80px"  },
    { key:"volume",       label:"VOLUME",     w:"70px"  },
    { key:"trend",        label:"TREND",      w:"85px"  },
    { key:"adx",          label:"ADX",        w:"80px"  },
    { key:"confluence",   label:"CONFLUENC",  w:"80px"  },
    { key:"tp",           label:"TP | SL",    w:"130px" },
  ];
  const proGridCols = PRO_COLS.map(c => c.w).join(" ");

  const TECH_COLS = [
    { key:"ticker",         label:"TICKER",      w:"90px"  },
    { key:"price",          label:"PRICE",       w:"80px"  },
    { key:"score",          label:"SCORE",       w:"70px"  },
    { key:"trend",          label:"TREND",       w:"85px"  },
    { key:"rsi",            label:"RSI",         w:"55px"  },
    { key:"rsi_signal",     label:"RSI SIG",     w:"90px"  },
    { key:"bb_status",      label:"BB STATUS",   w:"135px" },
    { key:"candlestick",    label:"CANDLE",      w:"135px" },
    { key:"atr",            label:"ATR",         w:"65px"  },
    { key:"rvol",           label:"RVOL",        w:"60px"  },
    { key:"inst_footprint", label:"INST. PRINT", w:"175px" },
    { key:"fcf_yield",      label:"FCF %",       w:"65px"  },
    { key:"de_ratio",       label:"D/E",         w:"55px"  },
  ];
  const techGridCols = TECH_COLS.map(c => c.w).join(" ");

  // ── Color helpers ──────────────────────────────────────────────────────────
  const _sigClr    = s => s === "BUY" ? T.green : s === "SELL" ? T.red : T.text2;
  const _sigBg     = s => s === "BUY" ? T.greenDim : s === "SELL" ? T.redDim : T.bg2;
  const _vwapClr   = s => s === "ABOVE" ? T.green : T.red;
  const _macdClr   = s => s === "Bullish" ? T.green : s === "Bearish" ? T.red : T.text2;
  const _stochClr  = s => s === "Bullish" ? T.green : s === "Bearish" ? T.red : T.text2;
  const _trendClr  = t => t === "Bullish" ? T.green : t === "Bearish" ? T.red : T.text2;
  const _candleClr = p => p?.includes("Bullish") ? T.green : p?.includes("Bearish") ? T.red : p?.includes("Doji") ? T.gold : T.text2;
  const _scoreClr  = s => s >= 3 ? T.green : s >= 1 ? T.cyan : s <= -3 ? T.red : s <= -1 ? T.orange : T.text1;
  const _rsiClr    = (r, s) => s === "Overbought" ? T.red : s === "Oversold" ? T.green : r > 60 ? T.orange : r < 40 ? T.cyan : T.text1;
  const _bbClr     = s => s?.includes("Overextended") ? T.red : s?.includes("Bounce") ? T.green : T.text2;
  const _instClr   = s => s?.includes("Accumulation") ? T.green : s?.includes("Distribution") ? T.red : T.text2;
  const handleTechSort = key => {
    if (techSortKey === key) setTechSortAsc(!techSortAsc);
    else { setTechSortKey(key); setTechSortAsc(false); }
  };

  // ── RENDER ─────────────────────────────────────────────────────────────────
  return (
    <div className="page-enter" style={{ display:"flex", flexDirection:"column", gap:16 }}>

      {/* ── TAB BAR + STATS + FILTERS — single unified row ── */}
      <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>

        {/* Tab toggle */}
        <div style={{ display:"flex", background:T.bg0, border:`1px solid ${T.border}`, borderRadius:8, overflow:"hidden", boxShadow:`0 1px 4px ${T.bg0}` }}>
          <button onClick={() => setSignalView("SIGNALS")}
            style={{
              background: signalView==="SIGNALS" ? T.cyan : "transparent",
              color: signalView==="SIGNALS" ? "#000" : T.text2,
              border:"none", borderRight:`1px solid ${T.border}`,
              padding:"8px 20px", cursor:"pointer",
              fontFamily:T.font, fontSize:10.5, letterSpacing:0.7, fontWeight:700,
              transition:"all 0.15s",
            }}>
            ◉ SIGNALS
          </button>
          <button onClick={() => setSignalView("TECH")}
            style={{
              background: signalView==="TECH" ? T.cyan+"22" : "transparent",
              color: signalView==="TECH" ? T.cyan : T.text2,
              border:"none",
              padding:"8px 20px", cursor:"pointer",
              fontFamily:T.font, fontSize:10.5, letterSpacing:0.7, fontWeight:600,
              transition:"all 0.15s",
            }}>
            ◈ TECH ANALYSIS
          </button>
        </div>

        {/* Divider */}
        <div style={{ width:1, height:22, background:T.border, flexShrink:0 }}/>

        {/* ── Inline stat badges (always visible, context-sensitive) ── */}
        {signalView === "SIGNALS" && (
          <>
            {[
              { lbl:"BUY",   val:proStats.buy,    clr:T.green  },
              { lbl:"SELL",  val:proStats.sell,   clr:T.red    },
              { lbl:"STRNG", val:proStats.strong, clr:T.purple },
              { lbl:"WATCH", val:proData.length,  clr:T.cyan   },
            ].map(s => (
              <div key={s.lbl} style={{ display:"flex", alignItems:"center", gap:5,
                background:T.bg2, border:`1px solid ${T.border}`, borderRadius:5, padding:"4px 10px" }}>
                <span style={{ color:T.text2, fontSize:8.5, fontFamily:T.font, letterSpacing:0.8 }}>{s.lbl}</span>
                <span style={{ color:s.clr, fontSize:14, fontFamily:T.font, fontWeight:800, lineHeight:1 }}>{s.val}</span>
              </div>
            ))}

            {/* Divider */}
            <div style={{ width:1, height:22, background:T.border, flexShrink:0 }}/>

            {/* Filter pills */}
            {[
              ["ALL",    `ALL (${proStats.total})`      ],
              ["BUY",    `▲ BUY (${proStats.buy})`      ],
              ["SELL",   `▼ SELL (${proStats.sell})`    ],
              ["STRONG", `⚡ STRONG (${proStats.strong})`],
            ].map(([key, lbl]) => (
              <button key={key} onClick={() => setProFilter(key)}
                style={{
                  background: proFilter===key ? T.cyan+"14" : "transparent",
                  border: `1px solid ${proFilter===key ? T.cyan+"45" : T.border}`,
                  color: proFilter===key ? T.cyan : T.text2,
                  borderRadius:5, padding:"5px 11px", cursor:"pointer",
                  fontFamily:T.font, fontSize:9.5, fontWeight:600,
                }}>
                {lbl}
              </button>
            ))}

            {/* Warming up + refresh */}
            <div style={{ marginLeft:"auto", display:"flex", gap:6, alignItems:"center" }}>
              {proWarmingUp.length > 0 && (
                <span style={{ color:T.text2, fontSize:9.5, fontFamily:T.font }}>
                  ⏳ {proWarmingUp.length} warming
                </span>
              )}
              <button onClick={fetchProData} disabled={proLoading}
                style={{ background:T.bg2, border:`1px solid ${T.border}`, color:T.text1,
                  borderRadius:5, padding:"5px 12px", cursor:proLoading?"wait":"pointer",
                  fontFamily:T.font, fontSize:10, fontWeight:600, opacity:proLoading?0.5:1 }}>
                {proLoading ? "⏳" : "🔄"} {proLoading ? "Loading…" : "Refresh"}
              </button>
            </div>
          </>
        )}

        {/* ── TECH tab filters ── */}
        {signalView === "TECH" && (
          <>
            {techStats && (
              <>
                {[
                  { lbl:"BULL",  val:techStats.bullish,    clr:T.green },
                  { lbl:"BEAR",  val:techStats.bearish,    clr:T.red   },
                  { lbl:"ALERT", val:techStats.alerts,     clr:T.gold  },
                ].map(s => (
                  <div key={s.lbl} style={{ display:"flex", alignItems:"center", gap:5,
                    background:T.bg2, border:`1px solid ${T.border}`, borderRadius:5, padding:"4px 10px" }}>
                    <span style={{ color:T.text2, fontSize:8.5, fontFamily:T.font, letterSpacing:0.8 }}>{s.lbl}</span>
                    <span style={{ color:s.clr, fontSize:14, fontFamily:T.font, fontWeight:800, lineHeight:1 }}>{s.val}</span>
                  </div>
                ))}
                <div style={{ width:1, height:22, background:T.border, flexShrink:0 }}/>
              </>
            )}

            {["ALL","BULLISH","BEARISH","ALERTS"].map(f => (
              <button key={f} onClick={() => setTechFilter(f)}
                style={{
                  background: techFilter===f ? T.cyan+"14" : "transparent",
                  border: `1px solid ${techFilter===f ? T.cyan+"45" : T.border}`,
                  color: techFilter===f ? T.cyan : T.text2,
                  borderRadius:5, padding:"5px 11px", cursor:"pointer",
                  fontFamily:T.font, fontSize:9.5, fontWeight:600, letterSpacing:0.3,
                }}>
                {f==="BULLISH"?"▲ ":f==="BEARISH"?"▼ ":f==="ALERTS"?"🚨 ":""}
                {f}
                {techStats && f==="ALL"     ? ` (${techData.length})`    : ""}
                {techStats && f==="BULLISH" ? ` (${techStats.bullish})`  : ""}
                {techStats && f==="BEARISH" ? ` (${techStats.bearish})`  : ""}
                {techStats && f==="ALERTS"  ? ` (${techStats.alerts})`   : ""}
              </button>
            ))}

            <div style={{ marginLeft:"auto", display:"flex", gap:6, alignItems:"center" }}>
              {techLastFetch && (
                <span style={{ color:T.text2, fontSize:9.5, fontFamily:T.font }}>
                  {techCached ? "📦" : "✅"} {techLastFetch.toLocaleTimeString()}
                </span>
              )}
              <button onClick={() => fetchTechData(false)} disabled={techLoading}
                style={{ background:T.bg2, border:`1px solid ${T.border}`, color:T.text1,
                  borderRadius:5, padding:"5px 12px", cursor:techLoading?"wait":"pointer",
                  fontFamily:T.font, fontSize:10, fontWeight:600, opacity:techLoading?0.5:1 }}>
                {techLoading ? "⏳ Loading…" : "🔄 Refresh"}
              </button>
              <button onClick={() => fetchTechData(true)} disabled={techLoading}
                style={{ background:T.cyanDim, border:`1px solid ${T.cyanMid}`, color:T.cyan,
                  borderRadius:5, padding:"5px 12px", cursor:techLoading?"wait":"pointer",
                  fontFamily:T.font, fontSize:10, fontWeight:700, opacity:techLoading?0.5:1 }}>
                ⚡ Force
              </button>
            </div>
          </>
        )}
      </div>

      {/* ═══ SIGNALS VIEW (Pro Scalp table) ═══ */}
      {signalView === "SIGNALS" && (
        <div style={{ display:"flex", flexDirection:"column", gap:12 }}>

          {/* Error */}
          {proError && (
            <div style={{ background:T.red+"10", border:`1px solid ${T.red}30`, borderRadius:8, padding:20, textAlign:"center" }}>
              <div style={{ fontSize:24, marginBottom:8 }}>⚠️</div>
              <div style={{ color:T.red, fontFamily:T.font, fontSize:13 }}>{proError}</div>
            </div>
          )}

          {/* Empty watchlist */}
          {!proLoading && !proError && proData.length === 0 && (
            <EmptyState icon="📊" label="NO WATCHLIST TICKERS"
              sub="Star (★) some tickers in the Live Table. Signals run real-time indicator analysis on your ★ watchlist." h={240} T={T}/>
          )}

          {/* Loading shimmer */}
          {proLoading && proData.length === 0 && (
            <div className="card" style={{ overflow:"hidden" }}>
              {Array(6).fill(0).map((_,i) => (
                <div key={i} style={{ display:"flex", gap:16, padding:"12px 16px", borderBottom:`1px solid ${T.border}` }}>
                  {Array(8).fill(0).map((_,j) => (<div key={j} className="shimmer-box" style={{ height:14, flex:1 }}/>))}
                </div>
              ))}
            </div>
          )}

          {/* Pro Scalp data table */}
          {proRows.length > 0 && (
            <div className="card" style={{ overflow:"hidden" }}>
              {/* Sticky header */}
              <div style={{ display:"grid", gridTemplateColumns:proGridCols, background:T.bg0, borderBottom:`2px solid ${T.border}`, position:"sticky", top:0, zIndex:5, overflowX:"auto" }}>
                {PRO_COLS.map(col => (
                  <div key={col.key} onClick={() => handleProSort(col.key)}
                    style={{ padding:"10px 8px", color:T.text0, fontSize:9.5, letterSpacing:1, fontFamily:T.font, fontWeight:800, textTransform:"uppercase", cursor:"pointer", whiteSpace:"nowrap", background:proSort===col.key ? T.cyan+"08" : "transparent" }}>
                    {col.label}{proSort===col.key ? (proSortAsc?" ↑":" ↓") : ""}
                  </div>
                ))}
              </div>

              {/* Rows */}
              <div style={{ maxHeight:"calc(100vh - 420px)", overflowY:"auto", overflowX:"auto" }}>
                {proRows.map(row => (
                  <div key={row.ticker} className="tr-hover"
                    style={{ display:"grid", gridTemplateColumns:proGridCols, borderBottom:`1px solid ${T.border}` }}>
                    {/* Ticker */}
                    <div style={{ padding:"10px 8px" }}>
                      <span style={{ color:T.cyan, fontSize:12, fontWeight:700, fontFamily:T.font }}>{row.ticker}</span>
                    </div>
                    {/* Price */}
                    <div style={{ padding:"10px 8px", color:T.text0, fontSize:12, fontFamily:T.font, fontWeight:600, display:"flex", alignItems:"center" }}>
                      ${fmt2(row.price)}
                    </div>
                    {/* Signal */}
                    <div style={{ padding:"10px 8px", display:"flex", alignItems:"center" }}>
                      <span style={{ color:_sigClr(row.signal), fontSize:11, fontWeight:800, fontFamily:T.font, padding:"2px 8px", borderRadius:4, background:_sigBg(row.signal), letterSpacing:0.5 }}>
                        {row.signal === "BUY" ? "▲ BUY" : row.signal === "SELL" ? "▼ SELL" : "◈ HOLD"}
                      </span>
                    </div>
                    {/* Prediction % */}
                    <div style={{ padding:"10px 8px", display:"flex", alignItems:"center" }}>
                      <span style={{ color:_sigClr(row.signal), fontSize:12, fontWeight:700, fontFamily:T.font }}>
                        {row.prediction}%
                      </span>
                    </div>
                    {/* VWAP */}
                    <div style={{ padding:"10px 8px", display:"flex", alignItems:"center" }}>
                      <span style={{ color:_vwapClr(row.vwap_status), fontSize:10, fontWeight:700, fontFamily:T.font, padding:"2px 6px", borderRadius:4, background:_vwapClr(row.vwap_status)+"15" }}>
                        {row.vwap_status}
                      </span>
                    </div>
                    {/* Support */}
                    <div style={{ padding:"10px 8px", color:T.green, fontSize:11, fontFamily:T.font, fontWeight:600, display:"flex", alignItems:"center" }}>
                      ${fmt2(row.support)}
                    </div>
                    {/* Resistance */}
                    <div style={{ padding:"10px 8px", color:T.red, fontSize:11, fontFamily:T.font, fontWeight:600, display:"flex", alignItems:"center" }}>
                      ${fmt2(row.resistance)}
                    </div>
                    {/* Candle */}
                    <div style={{ padding:"10px 8px", color:_candleClr(row.candle), fontSize:9.5, fontWeight:600, fontFamily:T.font, display:"flex", alignItems:"center" }}>
                      {row.candle}
                    </div>
                    {/* MACD */}
                    <div style={{ padding:"10px 8px", display:"flex", alignItems:"center" }}>
                      <span style={{ color:_macdClr(row.macd_signal), fontSize:9.5, fontWeight:700, fontFamily:T.font, padding:"2px 6px", borderRadius:4, background:_macdClr(row.macd_signal)+"15" }}>
                        {row.macd_signal}
                      </span>
                    </div>
                    {/* RSI */}
                    <div style={{ padding:"10px 8px", display:"flex", flexDirection:"column", gap:2, justifyContent:"center" }}>
                      <span style={{ color:T.text0, fontSize:12, fontFamily:T.font, fontWeight:700 }}>{row.rsi}</span>
                      <span style={{ color:_rsiClr(row.rsi, row.rsi_signal), fontSize:9, fontFamily:T.font }}>{row.rsi_signal}</span>
                    </div>
                    {/* Stoch */}
                    <div style={{ padding:"10px 8px", display:"flex", alignItems:"center" }}>
                      <span style={{ color:_stochClr(row.stoch_signal), fontSize:9.5, fontWeight:700, fontFamily:T.font, padding:"2px 6px", borderRadius:4, background:_stochClr(row.stoch_signal)+"15" }}>
                        {row.stoch_signal}
                      </span>
                    </div>
                    {/* Volume RVOL */}
                    <div style={{ padding:"10px 8px", fontSize:11, fontFamily:T.font, fontWeight:600, display:"flex", alignItems:"center", color:row.volume >= 2.0 ? T.orange : T.text1 }}>
                      {row.volume?.toFixed(1)}x
                    </div>
                    {/* Trend */}
                    <div style={{ padding:"10px 8px", display:"flex", alignItems:"center" }}>
                      <span style={{ color:_trendClr(row.trend), fontSize:10, fontWeight:700, fontFamily:T.font, padding:"2px 6px", borderRadius:4, background:_trendClr(row.trend)+"12" }}>
                        {row.trend === "Bullish" ? "▲" : row.trend === "Bearish" ? "▼" : "—"} {row.trend}
                      </span>
                    </div>
                    {/* ADX */}
                    <div style={{ padding:"10px 8px", display:"flex", flexDirection:"column", gap:2, justifyContent:"center" }}>
                      <span style={{ color:row.adx >= 40 ? T.purple : row.adx >= 25 ? T.cyan : T.text2, fontSize:12, fontFamily:T.font, fontWeight:700 }}>{row.adx}</span>
                      <span style={{ color:T.text2, fontSize:9, fontFamily:T.font }}>{row.adx_label}</span>
                    </div>
                    {/* Confluence */}
                    <div style={{ padding:"10px 8px", display:"flex", alignItems:"center", gap:4 }}>
                      <span style={{ color:row.confluence >= 5 ? T.green : row.confluence >= 3 ? T.cyan : T.text2, fontSize:13, fontFamily:T.font, fontWeight:800 }}>
                        {row.confluence}
                      </span>
                      <span style={{ color:T.text2, fontSize:9, fontFamily:T.font }}>/6</span>
                    </div>
                    {/* TP | SL */}
                    <div style={{ padding:"10px 8px", display:"flex", flexDirection:"column", gap:2, justifyContent:"center" }}>
                      <span style={{ color:T.green, fontSize:10, fontFamily:T.font, fontWeight:600 }}>TP ${fmt2(row.tp)}</span>
                      <span style={{ color:T.red,   fontSize:10, fontFamily:T.font, fontWeight:600 }}>SL ${fmt2(row.sl)}</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Footer */}
              <div style={{ padding:"10px 16px", borderTop:`2px solid ${T.border}`, display:"flex", justifyContent:"space-between", alignItems:"center", background:T.bg0 }}>
                <span style={{ color:T.text1, fontSize:12, fontFamily:T.font, fontWeight:600 }}>
                  {proRows.length} of {proStats.total} ready · {proWarmingUp.length} warming up
                </span>
                <span style={{ color:T.text2, fontSize:10, fontFamily:T.font }}>
                  ★ Watchlist · Live indicators · Auto-refresh 30s
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══ TECH ANALYSIS VIEW ═══ */}
      {signalView === "TECH" && (
        <div style={{ display:"flex", flexDirection:"column", gap:12 }}>

          {/* Active alerts banner */}
          {techData.some(r => r.alerts?.length > 0) && (
            <div style={{ background:T.gold+"08", border:`1px solid ${T.gold}30`, borderRadius:8, padding:"10px 16px" }}>
              <div style={{ color:T.gold, fontSize:11, fontWeight:700, fontFamily:T.font, marginBottom:6 }}>🚨 ACTIVE ALERTS</div>
              <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                {techData.filter(r => r.alerts?.length > 0).flatMap(r =>
                  r.alerts.map((a, i) => (
                    <span key={`${r.ticker}-${i}`} style={{
                      background: a.type==="whale" ? T.cyan+"18" : a.type==="triple_bounce" ? T.green+"18" : T.gold+"18",
                      border: `1px solid ${a.type==="whale" ? T.cyan+"40" : a.type==="triple_bounce" ? T.green+"40" : T.gold+"40"}`,
                      color: a.type==="whale" ? T.cyan : a.type==="triple_bounce" ? T.green : T.gold,
                      borderRadius:5, padding:"3px 8px", fontSize:10, fontWeight:700, fontFamily:T.font,
                    }}>
                      {a.type==="whale"?"🐋":a.type==="triple_bounce"?"💎":"🚨"} {r.ticker}: {a.text}
                    </span>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Error state */}
          {techError && (
            <div style={{ background:T.red+"10", border:`1px solid ${T.red}30`, borderRadius:8, padding:20, textAlign:"center" }}>
              <div style={{ fontSize:28, marginBottom:8 }}>⚠️</div>
              <div style={{ color:T.red, fontFamily:T.font, fontSize:13, fontWeight:600 }}>{techError}</div>
            </div>
          )}

          {/* Empty watchlist */}
          {!techLoading && !techError && techData.length === 0 && (
            <EmptyState icon="◇" label="NO WATCHLIST TICKERS"
              sub="Star (★) some tickers in the Live Table first. Tech analysis uses yfinance 3mo data on your ★ watchlist." h={240} T={T}/>
          )}

          {/* Loading shimmer */}
          {techLoading && techData.length === 0 && (
            <div className="card" style={{ overflow:"hidden" }}>
              {Array(8).fill(0).map((_,i) => (
                <div key={i} style={{ display:"flex", gap:16, padding:"12px 16px", borderBottom:`1px solid ${T.border}` }}>
                  {Array(6).fill(0).map((_,j) => (<div key={j} className="shimmer-box" style={{ height:14, flex:1 }}/>))}
                </div>
              ))}
            </div>
          )}

          {/* Tech Analysis data table */}
          {techRows.length > 0 && (
            <div className="card" style={{ overflow:"hidden" }}>
              {/* Sticky header */}
              <div style={{ display:"grid", gridTemplateColumns:techGridCols, background:T.bg0, borderBottom:`2px solid ${T.border}`, position:"sticky", top:0, zIndex:5, overflowX:"auto" }}>
                {TECH_COLS.map(col => (
                  <div key={col.key} onClick={() => handleTechSort(col.key)}
                    style={{ padding:"10px 8px", color:T.text0, fontSize:9.5, letterSpacing:1, fontFamily:T.font, fontWeight:800, textTransform:"uppercase", cursor:"pointer", whiteSpace:"nowrap", background:techSortKey===col.key ? T.cyan+"08" : "transparent" }}>
                    {col.label}{techSortKey===col.key ? (techSortAsc?" ↑":" ↓") : ""}
                  </div>
                ))}
              </div>

              {/* Scrollable rows */}
              <div style={{ maxHeight:"calc(100vh - 420px)", overflowY:"auto", overflowX:"auto" }}>
                {techRows.map(row => (
                  <div key={row.ticker} className="tr-hover"
                    style={{ display:"grid", gridTemplateColumns:techGridCols, borderBottom:`1px solid ${T.border}` }}>
                    {/* Ticker + alert badges */}
                    <div style={{ padding:"9px 8px" }}>
                      <span style={{ color:T.cyan, fontSize:12, fontWeight:700, fontFamily:T.font }}>{row.ticker}</span>
                      {row.alerts?.length > 0 && (
                        <div style={{ display:"flex", gap:2, marginTop:2 }}>
                          {row.alerts.map((a,j) => (
                            <span key={j} style={{ fontSize:8, padding:"1px 4px", borderRadius:3, background:T.gold+"15", color:T.gold, fontWeight:700 }}>
                              {a.type==="whale"?"🐋":a.type==="triple_bounce"?"💎":"🚨"}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div style={{ padding:"9px 8px", color:T.text0, fontSize:12, fontFamily:T.font, fontWeight:600, display:"flex", alignItems:"center" }}>${fmt2(row.price)}</div>
                    <div style={{ padding:"9px 8px", display:"flex", alignItems:"center", justifyContent:"center" }}>
                      <span style={{ color:_scoreClr(row.score), fontSize:13, fontWeight:800, fontFamily:T.font }}>{row.score >= 0 ? "+" : ""}{row.score?.toFixed(1)}</span>
                    </div>
                    <div style={{ padding:"9px 8px", display:"flex", alignItems:"center" }}>
                      <span style={{ color:_trendClr(row.trend), fontSize:10, fontWeight:700, fontFamily:T.font, padding:"2px 6px", borderRadius:4, background:_trendClr(row.trend)+"12" }}>
                        {row.trend==="Bullish"?"▲":"▼"} {row.trend}
                      </span>
                    </div>
                    <div style={{ padding:"9px 8px", color:_rsiClr(row.rsi, row.rsi_signal), fontSize:12, fontFamily:T.font, fontWeight:700, display:"flex", alignItems:"center" }}>{row.rsi != null ? row.rsi.toFixed(1) : "—"}</div>
                    <div style={{ padding:"9px 8px", display:"flex", alignItems:"center" }}>
                      <span style={{ color:_rsiClr(row.rsi, row.rsi_signal), fontSize:9, fontWeight:700, fontFamily:T.font, padding:"2px 6px", borderRadius:4, background:_rsiClr(row.rsi, row.rsi_signal)+"15" }}>{row.rsi_signal}</span>
                    </div>
                    <div style={{ padding:"9px 8px", color:_bbClr(row.bb_status), fontSize:9.5, fontWeight:600, fontFamily:T.font, display:"flex", alignItems:"center" }}>
                      {row.bb_status?.includes("Overextended")?"⚠️ ":row.bb_status?.includes("Bounce")?"💡 ":""}{row.bb_status}
                    </div>
                    <div style={{ padding:"9px 8px", color:_candleClr(row.candlestick), fontSize:9.5, fontWeight:600, fontFamily:T.font, display:"flex", alignItems:"center" }}>{row.candlestick}</div>
                    <div style={{ padding:"9px 8px", color:T.text1, fontSize:11, fontFamily:T.font, display:"flex", alignItems:"center" }}>{row.atr != null ? row.atr.toFixed(2) : "—"}</div>
                    <div style={{ padding:"9px 8px", fontSize:11, fontFamily:T.font, fontWeight:600, display:"flex", alignItems:"center", color:row.rvol >= 2.0 ? T.orange : T.text1 }}>{row.rvol ? `${row.rvol.toFixed(1)}x` : "—"}</div>
                    <div style={{ padding:"9px 8px", color:_instClr(row.inst_footprint), fontSize:9.5, fontWeight:600, fontFamily:T.font, display:"flex", alignItems:"center" }}>
                      {row.inst_footprint?.includes("Accumulation")?"🐋 ":row.inst_footprint?.includes("Distribution")?"🔻 ":""}{row.inst_footprint}
                    </div>
                    <div style={{ padding:"9px 8px", color:T.text1, fontSize:11, fontFamily:T.font, display:"flex", alignItems:"center" }}>{row.fcf_yield != null ? `${row.fcf_yield}%` : "—"}</div>
                    <div style={{ padding:"9px 8px", color:T.text1, fontSize:11, fontFamily:T.font, display:"flex", alignItems:"center" }}>{row.de_ratio != null ? row.de_ratio.toFixed(2) : "—"}</div>
                  </div>
                ))}
              </div>

              {/* Table footer */}
              <div style={{ padding:"10px 16px", borderTop:`2px solid ${T.border}`, display:"flex", justifyContent:"space-between", alignItems:"center", background:T.bg0 }}>
                <span style={{ color:T.text1, fontSize:12, fontFamily:T.font, fontWeight:600 }}>
                  {techRows.length} of {techData.length} tickers{techFilter !== "ALL" ? ` · ${techFilter}` : ""}
                </span>
                <span style={{ color:T.text2, fontSize:10, fontFamily:T.font }}>
                  Sorted by {techSortKey} {techSortAsc ? "↑" : "↓"} · Data: yfinance 3mo · ★ Watchlist tickers
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── PAGE: Earnings (with real data from Supabase) ───────────────────────────
function PageEarnings({ T }) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedDay, setSelectedDay] = useState(null);
  const [earningsData, setEarningsData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const weekDates = useMemo(() => getWeekDates(weekOffset), [weekOffset]);

  // Fetch earnings data
  useEffect(() => {
    const fetchEarnings = async () => {
      try {
        setLoading(true);
        setError(null);
        const startDate = weekDates[0]?.isoDate;
        const endDate = weekDates[weekDates.length - 1]?.isoDate;
        
        console.log('[Earnings] Fetching data:', { startDate, endDate, url: `${API_BASE}/api/earnings?start=${startDate}&end=${endDate}` });
        
        const res = await fetch(`${API_BASE}/api/earnings?start=${startDate}&end=${endDate}`);
        console.log('[Earnings] Response status:', res.status, res.statusText);
        
        if (!res.ok) {
          const errorText = await res.text();
          console.error('[Earnings] HTTP error:', res.status, errorText);
          throw new Error(`HTTP ${res.status}: ${errorText}`);
        }
        
        const data = await res.json();
        console.log('[Earnings] Data received:', { count: data?.length || 0, sample: data?.[0] });
        
        setEarningsData(data || []);
        setLoading(false);
      } catch (err) {
        console.error('[Earnings] Fetch error:', err);
        setError(err.message);
        setEarningsData([]);
        setLoading(false);
      }
    };

    if (weekDates.length > 0) {
      fetchEarnings();
    }
  }, [weekOffset, weekDates]);

  useEffect(() => {
    const todayEntry = weekDates.find(d => d.isToday);
    if (todayEntry) setSelectedDay(todayEntry.isoDate);
    else if (weekOffset === 0) setSelectedDay(null);
  }, [weekOffset, weekDates]);

  const activeDay = selectedDay || weekDates.find(d=>d.isToday)?.isoDate || weekDates[0]?.isoDate;

  // Filter earnings by selected day
  const dayEarnings = useMemo(() => {
    if (!activeDay) return [];
    return earningsData.filter(e => e.date === activeDay || e.earnings_date === activeDay);
  }, [earningsData, activeDay]);

  return (
    <div className="page-enter" style={{ display:"flex", flexDirection:"column", gap:16 }}>
      <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
        <button className="btn-ghost" onClick={()=>setWeekOffset(o=>o-1)}>← PREV WEEK</button>
        {weekDates.map(d=>(
          <button key={d.isoDate} onClick={()=>setSelectedDay(d.isoDate)}
            style={{ background:activeDay===d.isoDate?T.cyanDim:T.bg2, border:`1px solid ${activeDay===d.isoDate?T.cyanMid:d.isToday?T.borderHi:T.border}`, color:activeDay===d.isoDate?T.cyan:d.isToday?T.text0:T.text2, borderRadius:5, padding:"6px 13px", cursor:"pointer", fontFamily:T.font, fontSize:10, letterSpacing:1, display:"flex", flexDirection:"column", alignItems:"center", gap:2 }}>
            <span>{d.day}</span>
            <span style={{ fontSize:8, opacity:0.7 }}>{d.date}</span>
            {d.isToday && <span style={{ fontSize:7, color:T.cyan }}>TODAY</span>}
          </button>
        ))}
        <button className="btn-ghost" onClick={()=>setWeekOffset(o=>o+1)}>NEXT WEEK →</button>
        <div style={{ marginLeft:"auto", display:"flex", gap:8 }}>
          {weekOffset!==0&&<button className="btn-ghost" onClick={()=>setWeekOffset(0)} style={{ fontSize:9 }}>THIS WEEK</button>}
          <button className="btn-primary">+ ADD TO WATCHLIST</button>
        </div>
      </div>
      <div style={{ display:"flex", gap:16, flexWrap:"wrap" }}>
        <div className="card" style={{ flex:2, minWidth:300 }}>
          <SectionHeader title={`Earnings Calendar${activeDay?` · ${weekDates.find(d=>d.isoDate===activeDay)?.date||""}`:""}`} T={T}>
            {loading ? (
              <Chip color={T.gold} T={T}>LOADING</Chip>
            ) : (
              <Chip color={T.green} T={T}>{dayEarnings.length} EARNINGS</Chip>
            )}
          </SectionHeader>
          <div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(8,1fr)", background:T.bg0, borderBottom:`1px solid ${T.border}` }}>
              {["SYMBOL","DATE","TIME","EPS EST","REV EST","MKT CAP","SECTOR","WATCH"].map(h=>(
                <div key={h} style={{ padding:"9px 12px", color:T.text1, fontSize:9, letterSpacing:1.5, fontFamily:T.font, fontWeight:800, textTransform:"uppercase" }}>{h}</div>
              ))}
            </div>
            
            {/* Scrollable container */}
            <div style={{ maxHeight:"calc(100vh - 450px)", minHeight:"300px", overflowY:"auto", position:"relative" }}>
              {error ? (
                <EmptyState icon="⚠" label="ERROR LOADING EARNINGS" sub={error} h={200} T={T}/>
              ) : loading ? (
                // Show shimmer
                Array(10).fill(0).map((_,i)=>(
                  <div key={i} className="tr-hover" style={{ display:"grid", gridTemplateColumns:"repeat(8,1fr)", borderBottom:`1px solid #080f1a` }}>
                    {[50,55,70,55,70,55,60,45].map((w,j)=>(
                      <div key={j} style={{ padding:"11px 12px" }}>
                        {j===7?<div style={{ width:26,height:16,background:T.cyanDim,border:`1px solid ${T.cyanMid}`,borderRadius:3}}/>
                              :<Shimmer w={w} h={10} opacity={j===0?0.75:0.45} T={T}/>}
                      </div>
                    ))}
                  </div>
                ))
              ) : dayEarnings.length === 0 ? (
                <EmptyState icon="◎" label="NO EARNINGS" sub="No earnings scheduled for this day" h={200} T={T}/>
              ) : (
                <>
                  {dayEarnings.map((earning, i) => (
                    <div key={i} className="tr-hover" style={{ display:"grid", gridTemplateColumns:"repeat(8,1fr)", borderBottom:`1px solid ${T.border}` }}>
                      <div style={{ padding:"11px 12px", color:T.cyan, fontSize:12, fontFamily:T.font, fontWeight:700 }}>
                        {earning.ticker || earning.symbol}
                      </div>
                      <div style={{ padding:"11px 12px", color:T.text1, fontSize:11, fontFamily:T.font, fontWeight:600 }}>
                        {earning.date || earning.earnings_date}
                      </div>
                      <div style={{ padding:"11px 12px", color:T.text1, fontSize:11, fontFamily:T.font, fontWeight:600 }}>
                        {earning.time || earning.earnings_time || '—'}
                      </div>
                      <div style={{ padding:"11px 12px", color:T.text1, fontSize:11, fontFamily:T.font, fontWeight:600 }}>
                        {earning.eps_est || earning.eps_estimate || '—'}
                      </div>
                      <div style={{ padding:"11px 12px", color:T.text1, fontSize:11, fontFamily:T.font, fontWeight:600 }}>
                        {earning.rev_est || earning.revenue_estimate || '—'}
                      </div>
                      <div style={{ padding:"11px 12px", color:T.text1, fontSize:11, fontFamily:T.font, fontWeight:600 }}>
                        {earning.market_cap ? fmtK(earning.market_cap) : '—'}
                      </div>
                      <div style={{ padding:"11px 12px", color:T.text2, fontSize:10, fontFamily:T.font, fontWeight:600 }}>
                        {earning.sector || '—'}
                      </div>
                      <div style={{ padding:"11px 12px" }}>
                        <button className="btn-ghost" style={{ fontSize:8, padding:"3px 8px", fontWeight:600 }}>⭐</button>
                      </div>
                    </div>
                  ))}
                  
                  {/* Bottom fade gradient — purely decorative */}
                  {dayEarnings.length >= 10 && (
                    <div style={{ 
                      position:"sticky", 
                      bottom:0, 
                      left:0, 
                      right:0, 
                      height:40,
                      background:`linear-gradient(to bottom, transparent, ${T.bg1})`,
                      pointerEvents:"none"
                    }}/>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
        <div style={{ flex:1, minWidth:190, display:"flex", flexDirection:"column", gap:14 }}>
          <div className="card">
            <SectionHeader title="Selected Earnings"/>
            <EmptyState icon="◎" label="SELECT A TICKER" sub="Click any row to see earnings details, historical beats/misses, and implied move" h={140}/>
          </div>
          <div className="card">
            <SectionHeader title="Gap Stats"/>
            <div style={{ padding:14 }}>
              {["AVG GAP UP","AVG GAP DOWN","BEAT RATE","MISS RATE"].map(s=>(
                <div key={s} style={{ display:"flex", justifyContent:"space-between", padding:"8px 0", borderBottom:`1px solid ${T.border}` }}>
                  <span style={{ color:T.text2, fontSize:9.5, fontFamily:T.font }}>{s}</span>
                  <Shimmer w={44} h={10}/>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── PAGE: Portfolio ──────────────────────────────────────────────────────────
// Allocation section: SVG donut with sector breakdown by portfolio weight.
// Sectors drawn proportionally once real data arrives from /api/portfolio.
// Until then, shows empty donut with usage guide.
function PagePortfolio({ tickers = new Map(), marketSession = "market", T }) {
  const [portfolioData, setPortfolioData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 50;

  // Fetch portfolio data
  useEffect(() => {
    const fetchPortfolio = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/portfolio`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setPortfolioData(data || []);
        setLoading(false);
      } catch (err) {
        console.error('[Portfolio] Fetch error:', err);
        setLoading(false);
      }
    };

    fetchPortfolio();
    const interval = setInterval(fetchPortfolio, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, []);

  // Enrich portfolio with live prices and calculate values
  const enrichedPortfolio = useMemo(() => {
    return portfolioData.map(position => {
      const ticker = tickers.get(position.ticker);
      // FIX: use live_price (was wrongly ticker?.price)
      const livePrice  = ticker?.live_price || position.last_price || 0;
      const openPrice  = ticker?.open       || 0;
      const prevClose  = ticker?.prev_close || 0;
      const todayClose = ticker?.today_close || 0;
      const shares   = position.shares  || 0;
      const avgCost  = position.avg_cost || 0;

      const marketValue = shares * livePrice;
      const costBasis   = shares * avgCost;
      const totalPnL    = marketValue - costBasis;
      const totalPnLPct = costBasis > 0 ? (totalPnL / costBasis) * 100 : 0;

      // Day P&L: MH = vs open; AH = vs today_close (regular session close)
      const isAH       = marketSession !== "market";
      const dayBase    = isAH ? (todayClose || prevClose || livePrice)
                               : (openPrice  || prevClose || livePrice);
      const dayChange  = dayBase > 0 ? livePrice - dayBase : 0;
      const dayPnL     = shares * dayChange;
      const dayPct     = dayBase > 0 ? (dayChange / dayBase) * 100 : 0;

      return {
        ...position,
        livePrice,
        openPrice,
        prevClose,
        todayClose,
        marketValue,
        costBasis,
        totalPnL,
        totalPnLPct,
        dayPnL,
        dayPct,
        sector: ticker?.sector || position.sector || 'OTHER',
      };
    });
  }, [portfolioData, tickers]);

  // Calculate allocation by sector
  const allocationData = useMemo(() => {
    if (enrichedPortfolio.length === 0) return [];

    const totalValue = enrichedPortfolio.reduce((sum, p) => sum + p.marketValue, 0);
    if (totalValue === 0) return [];

    // Group by sector
    const sectorMap = {};
    enrichedPortfolio.forEach(p => {
      const sector = (p.sector || 'OTHER').toUpperCase();
      if (!sectorMap[sector]) {
        sectorMap[sector] = 0;
      }
      sectorMap[sector] += p.marketValue;
    });

    // Convert to array with percentages
    const sectorColors = {
      'TECHNOLOGY': T.cyan,
      'BANKING': T.green,
      'BIO': T.purple,
      'CONSUMER': T.gold,
      'BM & UENE': T.orange,
      'REALCOM': '#00bcd4',
      'INDUSTRIALS': '#ff9800',
      'OTHER': T.text2,
    };

    return Object.entries(sectorMap)
      .map(([label, value]) => ({
        label,
        pct: parseFloat(((value / totalValue) * 100).toFixed(1)),
        color: sectorColors[label] || T.text2,
      }))
      .sort((a, b) => b.pct - a.pct);
  }, [enrichedPortfolio]);

  // Calculate KPIs
  const kpis = useMemo(() => {
    if (enrichedPortfolio.length === 0) {
      return {
        totalValue: 0,
        dayPnL: 0,
        totalPnL: 0,
        maxDrawdown: 0,
        winRate: 0,
        topHolding: '—',
        concentration: 0,
        sectorCount: 0,
      };
    }

    const totalValue = enrichedPortfolio.reduce((sum, p) => sum + p.marketValue, 0);
    const dayPnL = enrichedPortfolio.reduce((sum, p) => sum + p.dayPnL, 0);
    const totalPnL = enrichedPortfolio.reduce((sum, p) => sum + p.totalPnL, 0);

    // Top holding
    const sorted = [...enrichedPortfolio].sort((a, b) => b.marketValue - a.marketValue);
    const topHolding = sorted[0]?.ticker || '—';

    // Concentration (top 5% of holdings)
    const top5Pct = Math.ceil(enrichedPortfolio.length * 0.05);
    const top5Value = sorted.slice(0, top5Pct).reduce((sum, p) => sum + p.marketValue, 0);
    const concentration = totalValue > 0 ? (top5Value / totalValue) * 100 : 0;

    // Sector count
    const uniqueSectors = new Set(enrichedPortfolio.map(p => p.sector));
    const sectorCount = uniqueSectors.size;

    // Max drawdown (simplified - would need historical data for accurate calculation)
    const maxDrawdown = enrichedPortfolio.reduce((max, p) => {
      const dd = p.totalPnLPct < 0 ? Math.abs(p.totalPnLPct) : 0;
      return Math.max(max, dd);
    }, 0);

    // Win rate (positions with positive P&L)
    const winners = enrichedPortfolio.filter(p => p.totalPnL > 0).length;
    const winRate = (winners / enrichedPortfolio.length) * 100;

    return {
      totalValue,
      dayPnL,
      totalPnL,
      maxDrawdown,
      winRate,
      topHolding,
      concentration,
      sectorCount,
    };
  }, [enrichedPortfolio]);

  // SVG donut builder
  function DonutChart({ data, size=130, thick=18 }) {
    const r = (size - thick) / 2;
    const cx = size / 2, cy = size / 2;
    const circ = 2 * Math.PI * r;
    if (!data.length) {
      return (
        <div style={{ position:"relative", width:size, height:size, flexShrink:0 }}>
          <svg width={size} height={size}>
            <circle cx={cx} cy={cy} r={r} fill="none" stroke={T.border} strokeWidth={thick} strokeDasharray={`${circ * 0.8} ${circ * 0.2}`} strokeDashoffset={circ * 0.1} strokeLinecap="round"/>
            <circle cx={cx} cy={cy} r={r} fill="none" stroke={T.borderHi} strokeWidth={1} opacity={0.4}/>
          </svg>
          <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center" }}>
            <span style={{ color:T.text2, fontSize:9, fontFamily:T.font, letterSpacing:1 }}>—%</span>
          </div>
        </div>
      );
    }
    let offset = circ * 0.25; // start at top
    const totalPct = data.reduce((s,d)=>s+d.pct,0);
    return (
      <div style={{ position:"relative", width:size, height:size, flexShrink:0 }}>
        <svg width={size} height={size}>
          {data.map((seg, i) => {
            const dash = circ * seg.pct / 100;
            const gap  = circ - dash;
            const el = (
              <circle key={i} cx={cx} cy={cy} r={r} fill="none"
                stroke={seg.color} strokeWidth={thick}
                strokeDasharray={`${dash} ${gap}`}
                strokeDashoffset={-offset + circ * 0.25}
                strokeLinecap="butt" opacity={0.85}/>
            );
            offset += dash;
            return el;
          })}
          {/* center label */}
          <text x={cx} y={cy-4} textAnchor="middle" fill={T.text0} fontSize="13" fontFamily="Syne Mono,monospace" fontWeight="700">
            {totalPct.toFixed(0)}%
          </text>
          <text x={cx} y={cy+10} textAnchor="middle" fill={T.text2} fontSize="7" fontFamily="Syne Mono,monospace">ALLOCATED</text>
        </svg>
      </div>
    );
  }

  const KPICard = ({ icon, label, value, note, color=T.cyan }) => (
    <div className="card" style={{ padding:"16px 18px", flex:1, minWidth:130, position:"relative", overflow:"hidden" }}>
      <div style={{ position:"absolute", top:0, left:0, right:0, height:2, background:`linear-gradient(90deg,transparent,${color},transparent)`, opacity:0.45 }}/>
      <div style={{ fontSize:17, marginBottom:7 }}>{icon}</div>
      <div style={{ color:T.text2, fontSize:9, letterSpacing:2, marginBottom:9, fontFamily:T.font, textTransform:"uppercase" }}>{label}</div>
      <div style={{ fontFamily:T.font, fontSize:20, fontWeight:700, color, letterSpacing:1, marginBottom:5 }}>{value}</div>
      <div style={{ color:T.text2, fontSize:9, fontFamily:T.font }}>{note}</div>
    </div>
  );

  return (
    <div className="page-enter" style={{ display:"flex", flexDirection:"column", gap:16 }}>
      {/* KPIs */}
      <div style={{ display:"flex", gap:13, flexWrap:"wrap" }}>
        <KPICard icon="💰" label="Total Value" value={fmtK(kpis.totalValue)} color={T.cyan} note="Unrealized"/>
        <KPICard icon="📈" label="Day P&L" value={kpis.dayPnL >= 0 ? `+${fmtK(kpis.dayPnL)}` : fmtK(kpis.dayPnL)} color={kpis.dayPnL >= 0 ? T.green : T.red} note="Today"/>
        <KPICard icon="📊" label="Total P&L" value={kpis.totalPnL >= 0 ? `+${fmtK(kpis.totalPnL)}` : fmtK(kpis.totalPnL)} color={kpis.totalPnL >= 0 ? T.green : T.red} note="All time"/>
        <KPICard icon="📉" label="Max Drawdown" value={`-${kpis.maxDrawdown.toFixed(1)}%`} color={T.red} note="Portfolio risk"/>
        <KPICard icon="⚡" label="Win Rate" value={`${kpis.winRate.toFixed(0)}%`} color={T.purple} note={`${enrichedPortfolio.filter(p => p.totalPnL > 0).length} winners`}/>
      </div>

      <div style={{ display:"flex", gap:16, flexWrap:"wrap" }}>
        {/* Holdings */}
        <div className="card" style={{ flex:2, minWidth:300 }}>
          <SectionHeader title="Holdings">
            <span style={{ color:T.text2, fontSize:8.5, fontFamily:T.font }}>{enrichedPortfolio.length} positions · /api/portfolio</span>
            <button className="btn-primary">+ ADD POSITION</button>
          </SectionHeader>
          {/* Session-aware column headers */}
          {marketSession === "market" ? (
            <div style={{ display:"grid", gridTemplateColumns:"1.4fr 0.7fr 0.9fr 0.9fr 0.9fr 0.9fr 0.9fr 0.9fr 0.9fr 0.9fr 0.6fr", background:T.bg0, borderBottom:`1px solid ${T.border}` }}>
              {["SYMBOL","SHARES","AVG COST","OPEN","LIVE PRICE","CHANGE","% CHG","VALUE","DAY P&L","TOTAL P&L","ACTION"].map(h=>(
                <div key={h} style={{ padding:"9px 10px", color:T.text1, fontSize:9, letterSpacing:1, fontFamily:T.font, whiteSpace:"nowrap", fontWeight:800 }}>{h}</div>
              ))}
            </div>
          ) : (
            <div style={{ display:"grid", gridTemplateColumns:"1.4fr 0.7fr 0.9fr 0.9fr 1fr 1fr 0.9fr 0.9fr 0.9fr 0.9fr 0.6fr", background:T.bg0, borderBottom:`1px solid ${T.border}` }}>
              {["SYMBOL","SHARES","AVG COST","PREV CLOSE","TODAY CLOSE","LIVE PRICE","$ CHG","% CHG","VALUE","TOTAL P&L","ACTION"].map(h=>(
                <div key={h} style={{ padding:"9px 10px", color:T.text1, fontSize:9, letterSpacing:1, fontFamily:T.font, whiteSpace:"nowrap", fontWeight:800 }}>{h}</div>
              ))}
            </div>
          )}
          {loading ? (
            <EmptyState icon="◆" label="LOADING PORTFOLIO..." sub="Fetching positions from /api/portfolio" h={120}/>
          ) : enrichedPortfolio.length === 0 ? (
            <EmptyState icon="◆" label="NO POSITIONS" sub="Add your first position to get started" h={120} T={T}/>
          ) : (
            <>
              <div style={{ maxHeight:"calc(100vh - 520px)", minHeight:"300px", overflowY:"auto" }}>
                {enrichedPortfolio.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE).map((pos, i) => {
                  if (marketSession === "market") {
                    return (
                    /* ── MH ROW: SYMBOL | SHARES | AVG COST | OPEN | LIVE PRICE | CHANGE | % CHG | VALUE | DAY P&L | TOTAL P&L | ACTION */
                    <div key={i} style={{ display:"grid", gridTemplateColumns:"1.4fr 0.7fr 0.9fr 0.9fr 0.9fr 0.9fr 0.9fr 0.9fr 0.9fr 0.9fr 0.6fr", borderBottom:`1px solid ${T.border}`, fontSize:12, fontFamily:T.font }}>
                      <div style={{ padding:"10px", color:T.cyan, fontWeight:700, fontSize:13 }}>{pos.ticker}<div style={{ color:T.text2, fontSize:9, fontWeight:400 }}>{pos.company_name || ""}</div></div>
                      <div style={{ padding:"10px", color:T.text1 }}>{pos.shares?.toLocaleString() || 0}</div>
                      <div style={{ padding:"10px", color:T.text1 }}>${fmt2(pos.avg_cost)}</div>
                      <div style={{ padding:"10px", color:T.text1 }}>{pos.openPrice > 0 ? `$${fmt2(pos.openPrice)}` : "—"}</div>
                      <div style={{ padding:"10px", color:T.cyan, fontWeight:700 }}>${fmt2(pos.livePrice)}</div>
                      <div style={{ padding:"10px", color:pos.dayPnL >= 0 ? T.green : T.red, fontWeight:600 }}>{pos.dayPnL >= 0 ? "+" : ""}{fmt2(pos.dayPnL)}</div>
                      <div style={{ padding:"10px", color:pos.dayPct >= 0 ? T.green : T.red, fontWeight:700 }}>{pos.dayPct >= 0 ? "+" : ""}{pos.dayPct.toFixed(2)}%</div>
                      <div style={{ padding:"10px", color:T.text0 }}>{fmtK(pos.marketValue)}</div>
                      <div style={{ padding:"10px", color:pos.dayPnL >= 0 ? T.green : T.red }}>{pos.dayPnL >= 0 ? "+" : ""}{fmtK(pos.dayPnL)}</div>
                      <div style={{ padding:"10px", color:pos.totalPnL >= 0 ? T.green : T.red }}>{pos.totalPnL >= 0 ? "+" : ""}{fmtK(pos.totalPnL)}</div>
                      <div style={{ padding:"10px" }}><button className="btn-ghost" style={{ fontSize:8, padding:"3px 6px" }}>SELL</button></div>
                    </div>
                    );
                  } else {
                    /* ── AH ROW: SYMBOL | SHARES | AVG COST | PREV CLOSE | TODAY CLOSE | LIVE PRICE | $ CHG | % CHG | VALUE | TOTAL P&L | ACTION */
                    return (
                    <div key={i} style={{ display:"grid", gridTemplateColumns:"1.4fr 0.7fr 0.9fr 0.9fr 1fr 1fr 0.9fr 0.9fr 0.9fr 0.9fr 0.6fr", borderBottom:`1px solid ${T.border}`, fontSize:12, fontFamily:T.font }}>
                      <div style={{ padding:"10px", color:T.cyan, fontWeight:700, fontSize:13 }}>{pos.ticker}<div style={{ color:T.text2, fontSize:9, fontWeight:400 }}>{pos.company_name || ""}</div></div>
                      <div style={{ padding:"10px", color:T.text1 }}>{pos.shares?.toLocaleString() || 0}</div>
                      <div style={{ padding:"10px", color:T.text1 }}>${fmt2(pos.avg_cost)}</div>
                      <div style={{ padding:"10px", color:T.text1 }}>{pos.prevClose > 0 ? `$${fmt2(pos.prevClose)}` : "—"}</div>
                      <div style={{ padding:"10px", color:T.text1 }}>{pos.todayClose > 0 ? `$${fmt2(pos.todayClose)}` : "—"}</div>
                      <div style={{ padding:"10px", color:T.cyan, fontWeight:700 }}>${fmt2(pos.livePrice)}</div>
                      <div style={{ padding:"10px", color:pos.dayPnL >= 0 ? T.green : T.red, fontWeight:600 }}>{pos.dayPnL >= 0 ? "+" : ""}{fmt2(pos.dayPnL)}</div>
                      <div style={{ padding:"10px", color:pos.dayPct >= 0 ? T.green : T.red, fontWeight:700 }}>{pos.dayPct >= 0 ? "+" : ""}{pos.dayPct.toFixed(2)}%</div>
                      <div style={{ padding:"10px", color:T.text0 }}>{fmtK(pos.marketValue)}</div>
                      <div style={{ padding:"10px", color:pos.totalPnL >= 0 ? T.green : T.red }}>{pos.totalPnL >= 0 ? "+" : ""}{fmtK(pos.totalPnL)}</div>
                      <div style={{ padding:"10px" }}><button className="btn-ghost" style={{ fontSize:8, padding:"3px 6px" }}>SELL</button></div>
                    </div>
                    );
                  }
                })}
              </div>
              
              {/* Pagination Footer */}
              {enrichedPortfolio.length > ITEMS_PER_PAGE && (
                <div style={{ 
                  padding:"14px 18px", 
                  borderTop:`2px solid ${T.border}`, 
                  display:"flex", 
                  justifyContent:"space-between", 
                  alignItems:"center", 
                  background:T.bg1,
                  position:"sticky",
                  bottom:0,
                  zIndex:10
                }}>
                  <span style={{ color:T.text1, fontSize:13, fontFamily:T.font, fontWeight:600 }}>
                    Showing {((currentPage - 1) * ITEMS_PER_PAGE) + 1}-{Math.min(currentPage * ITEMS_PER_PAGE, enrichedPortfolio.length)} of {enrichedPortfolio.length.toLocaleString()} positions
                  </span>
                  <div style={{ display:"flex", gap:10, alignItems:"center" }}>
                    <span style={{ color:T.text1, fontSize:13, fontFamily:T.font, fontWeight:600 }}>
                      Page {currentPage} of {Math.ceil(enrichedPortfolio.length / ITEMS_PER_PAGE)}
                    </span>
                    <button 
                      className="btn-ghost" 
                      style={{ fontSize:12, padding:"6px 12px" }}
                      onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                      disabled={currentPage === 1}
                    >
                      ← PREV
                    </button>
                    <button 
                      className="btn-ghost" 
                      style={{ fontSize:12, padding:"6px 12px" }}
                      onClick={() => setCurrentPage(prev => Math.min(Math.ceil(enrichedPortfolio.length / ITEMS_PER_PAGE), prev + 1))}
                      disabled={currentPage >= Math.ceil(enrichedPortfolio.length / ITEMS_PER_PAGE)}
                    >
                      NEXT →
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Right: Allocation + Performance */}
        <div style={{ flex:1, minWidth:200, display:"flex", flexDirection:"column", gap:14 }}>

          {/* ── ALLOCATION DONUT ── */}
          <div className="card">
            <SectionHeader title="Allocation">
              <Chip color={T.text2}>BY SECTOR</Chip>
            </SectionHeader>
            <div style={{ padding:"16px 18px" }}>
              {/* How allocation is calculated */}
              <div style={{ color:T.text2, fontSize:8.5, fontFamily:T.font, marginBottom:12, lineHeight:1.6 }}>
                <span style={{ color:T.cyan }}>Formula: </span>
                (shares × live_price) ÷ total_portfolio_value × 100
                <br/>Grouped by <span style={{ color:T.text0 }}>sector</span> from stock_list JOIN portfolio.
              </div>

              <div style={{ display:"flex", gap:14, alignItems:"flex-start" }}>
                <DonutChart data={allocationData} size={130} thick={18}/>
                <div style={{ flex:1, display:"flex", flexDirection:"column", gap:6 }}>
                  {allocationData.length === 0 ? (
                    // Skeleton legend — matches sector list
                    [T.cyan, T.green, T.purple, T.gold, T.orange].map((c,i)=>(
                      <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                        <div style={{ display:"flex", gap:7, alignItems:"center" }}>
                          <div style={{ width:9,height:9,borderRadius:2,background:c,opacity:0.6 }}/>
                          <Shimmer w={55} h={9} opacity={0.5}/>
                        </div>
                        <Shimmer w={28} h={9} opacity={0.35}/>
                      </div>
                    ))
                  ) : (
                    allocationData.map((seg,i)=>(
                      <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                        <div style={{ display:"flex", gap:7, alignItems:"center" }}>
                          <div style={{ width:9,height:9,borderRadius:2,background:seg.color }}/>
                          <span style={{ color:T.text1, fontSize:9, fontFamily:T.font }}>{seg.label}</span>
                        </div>
                        <span style={{ color:seg.color, fontSize:10, fontFamily:T.font, fontWeight:700 }}>{seg.pct}%</span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Additional allocation breakdowns */}
              <div style={{ marginTop:14, paddingTop:12, borderTop:`1px solid ${T.border}`, display:"flex", gap:8, flexWrap:"wrap" }}>
                <div style={{ flex:1, background:T.bg2, border:`1px solid ${T.border}`, borderRadius:6, padding:"7px 10px", minWidth:70 }}>
                  <div style={{ color:T.text2, fontSize:7.5, letterSpacing:1.5, fontFamily:T.font }}>TOP HOLDING</div>
                  <div style={{ color:T.text0, fontFamily:T.font, fontSize:14, fontWeight:700, marginTop:3 }}>{kpis.topHolding}</div>
                  <div style={{ color:T.text2, fontSize:7.5, fontFamily:T.font, marginTop:1 }}>symbol</div>
                </div>
                <div style={{ flex:1, background:T.bg2, border:`1px solid ${T.border}`, borderRadius:6, padding:"7px 10px", minWidth:70 }}>
                  <div style={{ color:T.text2, fontSize:7.5, letterSpacing:1.5, fontFamily:T.font }}>CONCENTRATION</div>
                  <div style={{ color:T.text0, fontFamily:T.font, fontSize:14, fontWeight:700, marginTop:3 }}>{kpis.concentration.toFixed(0)}%</div>
                  <div style={{ color:T.text2, fontSize:7.5, fontFamily:T.font, marginTop:1 }}>top 5%</div>
                </div>
                <div style={{ flex:1, background:T.bg2, border:`1px solid ${T.border}`, borderRadius:6, padding:"7px 10px", minWidth:70 }}>
                  <div style={{ color:T.text2, fontSize:7.5, letterSpacing:1.5, fontFamily:T.font }}>SECTORS</div>
                  <div style={{ color:T.text0, fontFamily:T.font, fontSize:14, fontWeight:700, marginTop:3 }}>{kpis.sectorCount}</div>
                  <div style={{ color:T.text2, fontSize:7.5, fontFamily:T.font, marginTop:1 }}>count</div>
                </div>
              </div>
            </div>
          </div>

          {/* Performance chart */}
          <div className="card">
            <SectionHeader title="Performance"/>
            <div style={{ padding:13 }}>
              <EmptyChart height={95} label="No closed trades"/>
            </div>
          </div>
        </div>
      </div>

      {/* Closed Trades */}
      <div className="card">
        <SectionHeader title="Closed Trades">
          <button className="btn-ghost" style={{ fontSize:9 }}>EXPORT CSV</button>
        </SectionHeader>
        <EmptyState icon="◇" label="NO CLOSED TRADES" sub="Completed positions will appear here" h={90}/>
      </div>
    </div>
  );
}

// ─── App Shell ────────────────────────────────────────────────────────────────
export default function NexRadarDashboard({ darkMode: darkModeProp = true, source: sourceProp = 'all', sector: sectorProp = 'ALL', onSourceChange, onSectorChange, onThemeChange, currentTheme = 'auto', onSignOut, user }) {
  // Active page state - persisted in localStorage
  const [quickFilter, setQuickFilter] = useState(null);
  const [page, setPage] = useState(() => {
    try {
      const saved = localStorage.getItem('nexradar_active_page');
      if (saved) {
        return saved;
      }
    } catch (err) {
      console.warn('[NexRadar] Failed to load saved page:', err);
    }
    return "dashboard";
  });
  
  // Save active page to localStorage whenever it changes
  useEffect(() => {
    try {
      localStorage.setItem('nexradar_active_page', page);
    } catch (err) {
      console.warn('[NexRadar] Failed to save page:', err);
    }
  }, [page]);
  
  const [sideCollapsed, setSideCollapsed]= useState(false);
  const [headerPanel,   setHeaderPanel]  = useState(null); // "notifications" | "settings" | "signals" | null
  
  // Get theme-aware design tokens
  const T = useMemo(() => getThemeTokens(darkModeProp), [darkModeProp]);
  
  // Multi-sector selection — default ALL or from props, persisted in localStorage
  const [selectedSectors, setSelectedSectors] = useState(() => {
    // Check localStorage first
    try {
      const saved = localStorage.getItem('nexradar_selected_sectors');
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (err) {
      console.warn('[NexRadar] Failed to load saved sectors:', err);
    }
    
    // Fall back to prop or default
    if (sectorProp && sectorProp !== 'ALL') {
      return [sectorProp.toUpperCase()];
    }
    return ["ALL"];
  });
  
  // Save selectedSectors to localStorage whenever it changes
  useEffect(() => {
    try {
      localStorage.setItem('nexradar_selected_sectors', JSON.stringify(selectedSectors));
    } catch (err) {
      console.warn('[NexRadar] Failed to save sectors:', err);
    }
  }, [selectedSectors]);

  // WebSocket state for live ticker data
  const [tickers, setTickers] = useState(new Map());
  const wsRef = useRef(null);
  // Ref that carries the PageLiveTable watchlist setter into the WS closure.
  // The WS handler is created once on mount; without a ref it would capture a
  // stale setWatchlistFromWS that does nothing.
  const wsWatchlistRef = useRef(null);

  // Market session — rechecked every 30s; drives auto-subMode + sidebar chip
  const [marketSession, setMarketSession] = useState(getMarketSession);
  useEffect(() => {
    const id = setInterval(() => setMarketSession(getMarketSession()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Sync with parent props
  useEffect(() => {
    if (sectorProp && sectorProp !== 'ALL') {
      setSelectedSectors([sectorProp.toUpperCase()]);
    } else {
      setSelectedSectors(["ALL"]);
    }
  }, [sectorProp]);

  // FIX #6: use a mutable ref as the primary ticker store so ticks never
  // trigger a full Map copy on every message. A throttled interval flushes
  // the ref into React state at most once every 250 ms, keeping the UI
  // responsive without copying 1 500+ entries on every price update.
  const tickerCacheRef = useRef(new Map());

  // ── Live Notifications ────────────────────────────────────────────────────
  // Accumulates real alerts fired by WS ticks. Capped at 50 entries (ring buffer).
  // Each entry: { id, type, icon, color, title, sub, time, ticker, ts }
  const [notifications,    setNotifications]    = useState([]);
  const [unreadCount,      setUnreadCount]       = useState(0);
  const notifRef           = useRef([]);          // mutable buffer — same pattern as tickerCacheRef
  // Per-ticker cooldown: don't re-alert same ticker+type within 60 s
  const notifCooldownRef   = useRef({});          // { "AAPL_vol": timestamp }
  const NOTIF_CAP          = 50;
  const NOTIF_COOLDOWN_MS  = 60_000;

  const _pushNotif = (entry) => {
    const key = `${entry.ticker}_${entry.type}`;
    const now  = Date.now();
    if ((notifCooldownRef.current[key] || 0) + NOTIF_COOLDOWN_MS > now) return; // still in cooldown
    notifCooldownRef.current[key] = now;
    const next = [{ ...entry, id: now + Math.random(), ts: now }, ...notifRef.current].slice(0, NOTIF_CAP);
    notifRef.current = next;
    setNotifications([...next]);
    setUnreadCount(c => c + 1);
  };

  // WebSocket connection for live data
  // FIX #4: 'cancelled' flag prevents onclose from spawning new sockets
  // after the effect cleanup runs (React strict-mode double-mount / hot reload).
  //
  // KEEPALIVE FIX:
  //   Render (and most proxies) drop idle TCP connections after ~55 s.
  //   The server sends {"type":"ping"} every 30 s.  We reply with
  //   {"type":"pong"} so the server's receive loop knows we're alive.
  //   We also send our own heartbeat every 30 s in case the server ping
  //   is buffered or swallowed by an intermediate proxy.
  useEffect(() => {
    const WS_URL = import.meta.env.VITE_WS_URL ||
      (import.meta.env.PROD
        ? `wss://${window.location.host}/ws/live`
        : 'ws://localhost:8000/ws/live');

    let cancelled = false;   // FIX #4: guards the reconnect timer
    let heartbeatTimer = null;

    const connectWS = () => {
      if (cancelled) return;   // don't open a new socket after cleanup
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[NexRadar] WebSocket connected');
        // Client-side heartbeat: send a ping every 30 s so the proxy sees
        // traffic in the client→server direction even between market ticks.
        heartbeatTimer = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, 30000);
      };

      ws.onmessage = async (event) => {
        try {
          let data = event.data;
          if (data instanceof Blob) {
            data = await data.text();
          }
          const msg = JSON.parse(data);

          // Server keepalive ping — reply with pong immediately
          if (msg.type === 'ping') {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'pong' }));
            }
            return;
          }

          // Ignore our own pong echo if server reflects it back
          if (msg.type === 'pong') return;

          // ── Watchlist sync across tabs ─────────────────────────────────
          // Backend broadcasts this when any tab adds/removes a ★ ticker.
          // All open tabs update their star state without a page reload.
          if (msg.type === 'watchlist_update') {
            // msg.watchlist is the full sorted list from the backend
            if (wsWatchlistRef.current) {
              wsWatchlistRef.current(new Set(msg.watchlist ?? []));
            }
            return;
          }

          if (msg.type === "snapshot") {
            // Snapshot: replace entire cache and push straight to state
            const m = new Map();
            for (const row of msg.data ?? []) {
              m.set(row.ticker, row);
            }
            tickerCacheRef.current = m;
            setTickers(new Map(m));   // one full copy for snapshot is fine

          } else if (msg.type === "tick") {
            // FIX #6: mutate the ref in-place; NO Map copy here.
            // The flush interval below will propagate it to React state.
            const cache = tickerCacheRef.current;
            const prev  = cache.get(msg.ticker) ?? {};
            const next  = { ...prev, ...msg.data };
            cache.set(msg.ticker, next);

            // ── Live alert detection ──────────────────────────────────────
            const d      = msg.data;
            const ticker = msg.ticker;
            const pct    = (d.percent_change ?? 0).toFixed(2);
            const price  = d.live_price ? `$${(+d.live_price).toFixed(2)}` : "";

            if (d.volume_spike && d.volume_spike_level === "high" && !prev.volume_spike) {
              _pushNotif({ type:"vol", icon:"📡", color:"#00d4ff",
                title:`${ticker} Volume Spike`,
                sub:`${d.volume_ratio?.toFixed(1) ?? "?"}× avg vol · ${pct}% · ${price}`,
                ticker });
            }
            if (d.is_gap_play && !prev.is_gap_play) {
              const dir = d.gap_direction === "up" ? "↑" : "↓";
              _pushNotif({ type:"gap", icon:"📊", color:"#f5a623",
                title:`${ticker} Gap Play ${dir}`,
                sub:`Gap ${d.gap_percent > 0 ? "+" : ""}${(d.gap_percent ?? 0).toFixed(2)}% · ${price}`,
                ticker });
            }
            if (d.ah_momentum && !prev.ah_momentum) {
              _pushNotif({ type:"ah", icon:"🌙", color:"#a78bfa",
                title:`${ticker} AH Momentum`,
                sub:`AH move exceeds regular session · ${price}`,
                ticker });
            }
            if (d.went_positive === 1 && (prev.went_positive ?? 0) !== 1) {
              _pushNotif({ type:"turn", icon:"🔄", color:"#22c55e",
                title:`${ticker} Turned Positive`,
                sub:`+${pct}% · ${price}`,
                ticker });
            }
            if (d.is_earnings_gap_play && !prev.is_earnings_gap_play) {
              _pushNotif({ type:"earn", icon:"📋", color:"#f97316",
                title:`${ticker} Earnings Gap`,
                sub:`Gap ${d.gap_percent > 0 ? "+" : ""}${(d.gap_percent ?? 0).toFixed(2)}% post-earnings · ${price}`,
                ticker });
            }
            if (Math.abs(d.percent_change ?? 0) >= 5 && Math.abs(prev.percent_change ?? 0) < 5) {
              _pushNotif({ type:"diamond", icon:"💎", color:"#00d4ff",
                title:`${ticker} Diamond +5%`,
                sub:`${pct}% · ${price}`,
                ticker });
            }
          }
        } catch (err) {
          console.error('[NexRadar] WebSocket parse error:', err);
        }
      };

      ws.onerror = () => {
        console.error('[NexRadar] WebSocket error');
      };

      ws.onclose = () => {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
        if (cancelled) return;   // FIX #4: don't reconnect after unmount
        console.log('[NexRadar] WebSocket closed, reconnecting...');
        setTimeout(connectWS, 3000);
      };
    };

    connectWS();

    // FIX #6: flush tick buffer to React state at 250 ms intervals.
    // This bounds re-renders to ≤4/s regardless of tick rate.
    const flushInterval = setInterval(() => {
      if (!cancelled) {
        setTickers(new Map(tickerCacheRef.current));
      }
    }, 250);

    return () => {
      cancelled = true;   // FIX #4: block any pending reconnect timers
      clearInterval(flushInterval);
      clearInterval(heartbeatTimer);
      if (wsRef.current) {
        wsRef.current.onclose = null;   // prevent the handler from firing during intentional close
        wsRef.current.close();
      }
    };
  }, []);

  // Calculate sector performance from live ticker data
  const sectorPerformance = useMemo(() => {
    const allRows = Array.from(tickers.values());
    const performance = {};

    SECTORS.forEach(sector => {
      if (sector.id === "ALL" || sector.id === "EARNINGS") return;

      // Filter tickers by sector using normalization
      const sectorTickers = allRows.filter(row => {
        const normalizedSector = normalizeSector(row.sector);
        return normalizedSector === sector.id;
      });

      if (sectorTickers.length === 0) {
        performance[sector.id] = { avgReturn: 0, count: 0, gainers: 0, losers: 0 };
        return;
      }

      // Calculate average percent change
      const totalReturn = sectorTickers.reduce((sum, row) => sum + (row.percent_change || 0), 0);
      const avgReturn = totalReturn / sectorTickers.length;

      // Count gainers and losers
      const gainers = sectorTickers.filter(row => (row.percent_change || 0) > 0).length;
      const losers = sectorTickers.filter(row => (row.percent_change || 0) < 0).length;

      performance[sector.id] = {
        avgReturn: parseFloat(avgReturn.toFixed(2)),
        count: sectorTickers.length,
        gainers,
        losers,
      };
    });

    return performance;
  }, [tickers]);

  const current = NAV.find(n => n.id === page);

  const handleSectorChange = (sectorIds) => {
    setSelectedSectors(sectorIds);
    // Notify parent if callback provided
    if (onSectorChange) {
      onSectorChange(sectorIds[0] || 'ALL');
    }
  };

  const renderPage = () => {
    switch (page) {
      case "dashboard": return <PageDashboard selectedSectors={selectedSectors} onSectorChange={handleSectorChange} onNavigate={setPage} sectorPerformance={sectorPerformance} tickers={tickers} T={T} />;
      case "live":      return <PageLiveTable  selectedSectors={selectedSectors} onSectorChange={handleSectorChange} tickers={tickers} marketSession={marketSession} wsWatchlistRef={wsWatchlistRef} quickFilter={quickFilter} onClearQuickFilter={() => setQuickFilter(null)} T={T} />;
      case "chart":     return <PageChart T={T} />;
      case "signals":   return <PageSignals tickers={tickers} selectedSectors={selectedSectors} T={T} />;
      case "earnings":  return <PageEarnings T={T} />;
      case "portfolio": return <PagePortfolio tickers={tickers} marketSession={marketSession} T={T} />;
      default:          return null;
    }
  };

  const activeLabel = selectedSectors.includes("ALL") ? null : selectedSectors.join(" + ");
  const tickerTotal = computeSectorTotal(selectedSectors);

  return (
    <div style={{ display:"flex", height:"100vh", background:T.bg0, color:T.text0, fontFamily:T.font, overflow:"hidden" }}>
      <style>{getCSS(T)}</style>

      {/* ── SIDEBAR ── */}
      <div style={{ width:sideCollapsed?56:218, minWidth:sideCollapsed?56:218, background:T.bg1, borderRight:`1px solid ${T.border}`, display:"flex", flexDirection:"column", transition:"width 0.22s,min-width 0.22s", overflow:"hidden" }}>
        {/* Logo */}
        <div style={{ padding:"17px 13px", borderBottom:`1px solid ${T.border}`, display:"flex", alignItems:"center", gap:10, overflow:"hidden", flexShrink:0 }}>
          <div style={{ width:30, height:30, borderRadius:7, background:`linear-gradient(135deg,${T.cyan},#0055bb)`, display:"flex", alignItems:"center", justifyContent:"center", fontWeight:800, color:"#000", fontSize:13, flexShrink:0 }}>N</div>
          {!sideCollapsed && (
            <div>
              <div style={{ fontFamily:T.fontSans, fontWeight:800, fontSize:13.5, color:T.text0, letterSpacing:2.5, whiteSpace:"nowrap" }}>NEXRADAR</div>
              <div style={{ color:T.text2, fontSize:7.5, letterSpacing:3.5, whiteSpace:"nowrap" }}>PROFESSIONAL</div>
            </div>
          )}
        </div>

        {/* Status */}
        {!sideCollapsed && (
          <div style={{ padding:"9px 13px", borderBottom:`1px solid ${T.border}`, display:"flex", gap:7, flexShrink:0 }}>
            <Chip color={T.green}>● LIVE</Chip>
            <Chip color={T[SESSION_META[marketSession].chipColorKey]}>{SESSION_META[marketSession].chipLabel}</Chip>
          </div>
        )}

        {/* Nav */}
        <nav style={{ padding:"9px 7px", flex:1, display:"flex", flexDirection:"column", gap:2 }}>
          {NAV.map(n=>(
            <button key={n.id} className={`nav-btn${page===n.id?" active":""}`} onClick={()=>setPage(n.id)} title={sideCollapsed?n.label:""}>
              <span className="icon">{n.icon}</span>
              {!sideCollapsed && <span style={{ whiteSpace:"nowrap" }}>{n.label}</span>}
            </button>
          ))}
        </nav>

        {/* Signal Engine */}
        {!sideCollapsed && (
          <div style={{ padding:13, borderTop:`1px solid ${T.border}`, flexShrink:0 }}>
            <div style={{ color:T.text2, fontSize:8.5, letterSpacing:2, marginBottom:9 }}>SIGNAL ENGINE</div>
            <div style={{ display:"flex", gap:7, marginBottom:8 }}>
              {[["WATCHING","—"],["SIGNALS","—"],["BARS","—"]].map(([l,v])=>(
                <div key={l} style={{ flex:1, background:T.bg2, border:`1px solid ${T.border}`, borderRadius:5, padding:"5px 7px", textAlign:"center" }}>
                  <div style={{ color:T.text2, fontSize:7.5, letterSpacing:1 }}>{l}</div>
                  <div style={{ color:T.cyan, fontFamily:T.font, fontSize:14, fontWeight:700, marginTop:2 }}>{v}</div>
                </div>
              ))}
            </div>
            <button className="btn-primary" style={{ width:"100%", padding:"8px 0", fontSize:10 }}>✓ APPLY WATCHLIST</button>
          </div>
        )}

        <button onClick={()=>setSideCollapsed(c=>!c)}
          style={{ background:"none", border:"none", borderTop:`1px solid ${T.border}`, color:T.text2, padding:"10px", cursor:"pointer", fontFamily:T.font, fontSize:16, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
          {sideCollapsed?"›":"‹"}
        </button>
      </div>

      {/* ── MAIN ── */}
      <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
        {/* Top bar */}
        <div style={{ background:T.bg1, borderBottom:`1px solid ${T.border}`, padding:"0 20px", height:56, display:"flex", alignItems:"center", gap:14, flexShrink:0, position:"relative" }}>
          <span style={{ fontFamily:T.font, fontWeight:700, fontSize:16, color:T.text0, letterSpacing:0.5 }}>
            {current?.icon}&nbsp;{current?.label.toUpperCase()}
          </span>
          {activeLabel && (
            <div style={{ display:"flex", alignItems:"center", gap:6, background:T.cyan+"10", border:`1px solid ${T.cyan}30`, borderRadius:6, padding:"4px 12px" }}>
              <span style={{ color:T.cyan, fontSize:11, letterSpacing:0.5, fontFamily:T.font, fontWeight:600 }}>{activeLabel}</span>
              <span style={{ color:T.cyan, fontSize:10, fontFamily:T.font }}>· {tickerTotal.toLocaleString()}</span>
              <button onClick={()=>setSelectedSectors(["ALL"])} style={{ background:"none", border:"none", color:T.cyan, cursor:"pointer", fontSize:13, padding:0, lineHeight:1, opacity:0.7 }} onMouseEnter={e=>e.target.style.opacity=1} onMouseLeave={e=>e.target.style.opacity=0.7}>✕</button>
            </div>
          )}
          <div style={{ flex:1 }}/>
          
          {/* Search Input */}
          <input placeholder="Search symbol…"
            style={{ background:T.bg2, border:`1px solid ${T.border}`, borderRadius:6, padding:"8px 14px", color:T.text0, fontFamily:T.font, fontSize:13, outline:"none", width:180 }}
            onFocus={e=>e.target.style.borderColor=T.cyanMid}
            onBlur={e=>e.target.style.borderColor=T.border}/>
          
          <div style={{ width:1, height:24, background:T.border }}/>
          
          {/* System Status */}
          <div style={{ 
            display:"flex", 
            alignItems:"center", 
            gap:6, 
            background:T.greenDim, 
            border:`1px solid ${T.green}30`, 
            borderRadius:6, 
            padding:"6px 12px",
            cursor:"pointer"
          }}
          title="System Status: All services operational">
            <span style={{ width:8, height:8, borderRadius:"50%", background:T.green, animation:"dotblink 1.4s ease-in-out infinite" }}/>
            <span style={{ color:T.green, fontSize:12, fontFamily:T.font, fontWeight:600, letterSpacing:0.3 }}>SYS OK</span>
          </div>
          
          {/* Notifications Button */}
          <button 
            onClick={() => { setHeaderPanel(p => p === "notifications" ? null : "notifications"); setUnreadCount(0); }}
            style={{ 
              width:36, height:36, borderRadius:6, background: headerPanel==="notifications" ? T.cyanDim : T.bg2, 
              border:`1px solid ${headerPanel==="notifications" ? T.cyanMid : T.border}`, 
              display:"flex", alignItems:"center", justifyContent:"center", 
              cursor:"pointer", color: headerPanel==="notifications" ? T.cyan : T.text1, 
              fontSize:16, position:"relative", transition:"all 0.2s"
            }}
            onMouseEnter={e => { if(headerPanel!=="notifications"){ e.currentTarget.style.borderColor=T.cyanMid; e.currentTarget.style.color=T.cyan; }}}
            onMouseLeave={e => { if(headerPanel!=="notifications"){ e.currentTarget.style.borderColor=T.border; e.currentTarget.style.color=T.text1; }}}
            title="Notifications"
          >
            🔔
            {unreadCount > 0 && (
              <span style={{ position:"absolute", top:3, right:3, minWidth:16, height:16, borderRadius:8,
                background:T.red, border:`2px solid ${T.bg1}`, color:"#fff",
                fontSize:9, fontWeight:700, fontFamily:T.font,
                display:"flex", alignItems:"center", justifyContent:"center", padding:"0 3px" }}>
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
            {unreadCount === 0 && (
              <span style={{ position:"absolute", top:4, right:4, width:8, height:8, borderRadius:"50%", background:T.border, border:`2px solid ${T.bg1}` }}/>
            )}
          </button>
          
          {/* Settings Button */}
          <button 
            onClick={() => setHeaderPanel(p => p === "settings" ? null : "settings")}
            style={{ 
              width:36, height:36, borderRadius:6, background: headerPanel==="settings" ? T.cyanDim : T.bg2, 
              border:`1px solid ${headerPanel==="settings" ? T.cyanMid : T.border}`, 
              display:"flex", alignItems:"center", justifyContent:"center", 
              cursor:"pointer", color: headerPanel==="settings" ? T.cyan : T.text1, 
              fontSize:16, transition:"all 0.2s"
            }}
            onMouseEnter={e => { if(headerPanel!=="settings"){ e.currentTarget.style.borderColor=T.cyanMid; e.currentTarget.style.color=T.cyan; }}}
            onMouseLeave={e => { if(headerPanel!=="settings"){ e.currentTarget.style.borderColor=T.border; e.currentTarget.style.color=T.text1; }}}
            title="Settings"
          >
            ⚙️
          </button>
          
          {/* Signal Watchlist Button */}
          <button
            onClick={() => setHeaderPanel(p => p === "signals" ? null : "signals")}
            style={{
              width:36, height:36, borderRadius:6, background: headerPanel==="signals" ? T.cyanDim : T.bg2,
              border:`1px solid ${headerPanel==="signals" ? T.cyanMid : T.border}`,
              display:"flex", alignItems:"center", justifyContent:"center",
              cursor:"pointer", color: headerPanel==="signals" ? T.cyan : T.text1,
              fontSize:16, transition:"all 0.2s"
            }}
            onMouseEnter={e => { if(headerPanel!=="signals"){ e.currentTarget.style.borderColor=T.cyanMid; e.currentTarget.style.color=T.cyan; }}}
            onMouseLeave={e => { if(headerPanel!=="signals"){ e.currentTarget.style.borderColor=T.border; e.currentTarget.style.color=T.text1; }}}
            title="Signal Engine"
          >
            ⚡
          </button>

          {/* Theme Selector */}
          {onThemeChange && (
            <div style={{ position:"relative", display:"inline-block" }} className="theme-selector-group">
              <button 
                style={{ 
                  width:36, height:36, borderRadius:6, background:T.bg2, border:`1px solid ${T.border}`, 
                  display:"flex", alignItems:"center", justifyContent:"center", 
                  cursor:"pointer", color:T.text1, fontSize:16, transition:"all 0.2s"
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor=T.cyanMid; e.currentTarget.style.color=T.cyan; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor=T.border; e.currentTarget.style.color=T.text1; }}
                title="Change theme"
              >
                {currentTheme === 'light' ? '☀️' : currentTheme === 'dark' ? '🌙' : currentTheme === 'high-contrast' ? '◐' : '⚡'}
              </button>
              <div className="theme-dropdown" style={{ 
                position:"absolute", right:0, top:"calc(100% + 8px)", width:220, 
                background:T.bg1, border:`1px solid ${T.border}`, borderRadius:8, 
                boxShadow:"0 8px 24px rgba(0,0,0,0.4)", zIndex:9999,
                opacity:0, visibility:"hidden", transition:"opacity 0.2s, visibility 0.2s", padding:8
              }}>
                {[
                  { id:'light', icon:'☀️', label:'Light' },
                  { id:'dark', icon:'🌙', label:'Dark' },
                  { id:'high-contrast', icon:'◐', label:'High Contrast' },
                  { id:'auto', icon:'⚡', label:'Auto (Day/Night)' },
                ].map(({ id, icon, label }) => (
                  <div key={id} onClick={() => onThemeChange(id)}
                    style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:10,
                      padding:"10px 14px", borderRadius:6, cursor:"pointer",
                      background: currentTheme===id ? T.cyan+"14" : "transparent",
                      color: currentTheme===id ? T.cyan : T.text1,
                      fontFamily:T.font, fontSize:13, fontWeight:500, transition:"all 0.15s"
                    }}
                    onMouseEnter={e => { if(currentTheme!==id) e.currentTarget.style.background=T.bg2; }}
                    onMouseLeave={e => { if(currentTheme!==id) e.currentTarget.style.background="transparent"; }}
                  >
                    <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                      <span style={{ fontSize:16 }}>{icon}</span><span>{label}</span>
                    </div>
                    {currentTheme===id && <span style={{ color:T.cyan, fontSize:14, fontWeight:700 }}>✓</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* User Avatar + Dropdown */}
          <div style={{ position:"relative" }}>
            <div
              onClick={() => setHeaderPanel(p => p === "user" ? null : "user")}
              style={{ width:32, height:32, borderRadius:6, background:T.cyanDim, border:`1px solid ${headerPanel==="user" ? T.cyan : T.cyanMid}`, display:"flex", alignItems:"center", justifyContent:"center", color:T.cyan, fontWeight:800, fontSize:13, cursor:"pointer", letterSpacing:0.5, transition:"all 0.15s" }}
              title="Account"
            >
              {user?.email ? user.email[0].toUpperCase() : "S"}
            </div>

            {/* User dropdown panel */}
            {headerPanel === "user" && (
              <div style={{ position:"absolute", right:0, top:"calc(100% + 8px)", width:240, background:T.bg1, border:`1px solid ${T.border}`, borderRadius:10, boxShadow:"0 12px 40px rgba(0,0,0,0.5)", zIndex:10000, overflow:"hidden" }}>
                {/* User info */}
                <div style={{ padding:"14px 16px", borderBottom:`1px solid ${T.border}` }}>
                  <div style={{ color:T.text0, fontFamily:T.font, fontWeight:700, fontSize:13, marginBottom:2 }}>
                    {user?.user_metadata?.full_name || "Trader"}
                  </div>
                  <div style={{ color:T.text2, fontFamily:T.font, fontSize:11, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                    {user?.email || ""}
                  </div>
                </div>
                {/* Sign out */}
                <div style={{ padding:6 }}>
                  <button
                    onClick={() => { setHeaderPanel(null); if (onSignOut) onSignOut(); }}
                    style={{ width:"100%", display:"flex", alignItems:"center", gap:10, padding:"10px 12px", background:"transparent", border:"none", borderRadius:6, cursor:"pointer", color:T.red, fontFamily:T.font, fontSize:13, fontWeight:600, transition:"background 0.15s", textAlign:"left" }}
                    onMouseEnter={e => e.currentTarget.style.background = T.red+"15"}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                  >
                    <span style={{ fontSize:15 }}>⎋</span> Sign Out
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* ── Dropdown Panels ── */}
          {headerPanel && (
            <div style={{ position:"fixed", inset:0, zIndex:9998 }} onClick={() => setHeaderPanel(null)}/>
          )}

          {/* Notifications Panel */}
          {headerPanel === "notifications" && (
            <div style={{ position:"absolute", right:20, top:64, width:340, maxHeight:480, display:"flex", flexDirection:"column", background:T.bg1, border:`1px solid ${T.border}`, borderRadius:10, boxShadow:"0 12px 40px rgba(0,0,0,0.5)", zIndex:9999, overflow:"hidden" }}>
              <div style={{ padding:"14px 16px", borderBottom:`1px solid ${T.border}`, display:"flex", justifyContent:"space-between", alignItems:"center", flexShrink:0 }}>
                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <span style={{ color:T.text0, fontFamily:T.font, fontWeight:700, fontSize:13 }}>Notifications</span>
                  {notifications.length > 0 && (
                    <span style={{ background:T.bg2, border:`1px solid ${T.border}`, borderRadius:10, padding:"1px 7px", color:T.text2, fontFamily:T.font, fontSize:10 }}>{notifications.length}</span>
                  )}
                </div>
                <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                  {notifications.length > 0 && (
                    <button onClick={() => { notifRef.current = []; setNotifications([]); setUnreadCount(0); }}
                      style={{ background:"none", border:"none", color:T.text2, cursor:"pointer", fontFamily:T.font, fontSize:11, padding:0 }}>
                      Clear all
                    </button>
                  )}
                  <button onClick={() => setHeaderPanel(null)} style={{ background:"none", border:"none", color:T.text2, cursor:"pointer", fontSize:16, padding:0 }}>✕</button>
                </div>
              </div>

              <div style={{ overflowY:"auto", flex:1 }}>
                {notifications.length === 0 ? (
                  <div style={{ padding:"32px 16px", textAlign:"center" }}>
                    <div style={{ fontSize:28, marginBottom:10 }}>🔔</div>
                    <div style={{ color:T.text2, fontFamily:T.font, fontSize:12 }}>No alerts yet</div>
                    <div style={{ color:T.text2, fontFamily:T.font, fontSize:11, marginTop:4, opacity:0.6 }}>
                      Volume spikes, gap plays, AH momentum<br/>and signals will appear here live
                    </div>
                  </div>
                ) : notifications.map((n) => {
                  const elapsed = Math.floor((Date.now() - n.ts) / 1000);
                  const timeStr = elapsed < 60 ? `${elapsed}s ago`
                    : elapsed < 3600 ? `${Math.floor(elapsed/60)}m ago`
                    : `${Math.floor(elapsed/3600)}h ago`;
                  return (
                    <div key={n.id}
                      onClick={() => { setPage("live"); setHeaderPanel(null); }}
                      style={{ padding:"11px 16px", borderBottom:`1px solid ${T.border}`, display:"flex", gap:11, alignItems:"flex-start", cursor:"pointer", transition:"background 0.12s" }}
                      onMouseEnter={e=>e.currentTarget.style.background=T.bg2}
                      onMouseLeave={e=>e.currentTarget.style.background="transparent"}
                    >
                      <div style={{ width:32, height:32, borderRadius:7, background:n.color+"18", border:`1px solid ${n.color}30`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:14, flexShrink:0 }}>{n.icon}</div>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ color:T.text0, fontFamily:T.font, fontSize:12, fontWeight:600, display:"flex", justifyContent:"space-between", alignItems:"center", gap:6 }}>
                          <span style={{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{n.title}</span>
                          <span style={{ color:T.text2, fontSize:10, flexShrink:0 }}>{timeStr}</span>
                        </div>
                        <div style={{ color:T.text2, fontFamily:T.font, fontSize:11, marginTop:2, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{n.sub}</div>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div style={{ padding:"10px 16px", borderTop:`1px solid ${T.border}`, flexShrink:0, textAlign:"center" }}>
                <button onClick={() => { setPage("signals"); setHeaderPanel(null); }}
                  style={{ background:"none", border:"none", color:T.cyan, fontFamily:T.font, fontSize:12, cursor:"pointer", fontWeight:600 }}>
                  View all signals →
                </button>
              </div>
            </div>
          )}

          {/* Settings Panel */}
          {headerPanel === "settings" && (
            <div style={{ position:"absolute", right:20, top:64, width:300, background:T.bg1, border:`1px solid ${T.border}`, borderRadius:10, boxShadow:"0 12px 40px rgba(0,0,0,0.5)", zIndex:9999, overflow:"hidden" }}>
              <div style={{ padding:"14px 16px", borderBottom:`1px solid ${T.border}`, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <span style={{ color:T.text0, fontFamily:T.font, fontWeight:700, fontSize:13 }}>Settings</span>
                <button onClick={() => setHeaderPanel(null)} style={{ background:"none", border:"none", color:T.text2, cursor:"pointer", fontSize:16, padding:0 }}>✕</button>
              </div>
              {[
                { label:"Broadcast Throttle", key:"throttle", value:"350ms", note:"Min interval between tick broadcasts" },
                { label:"Portfolio Refresh", key:"portfolio", value:"30s", note:"How often portfolio/monitor reloads" },
                { label:"Display Cap", key:"cap", value:"1 600 tickers", note:"Max tickers shown across all sectors" },
                { label:"AH Close Refresh", key:"ah", value:"120s", note:"After-hours closing price refresh rate" },
              ].map(s => (
                <div key={s.key} style={{ padding:"11px 16px", borderBottom:`1px solid ${T.border}` }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                    <span style={{ color:T.text1, fontFamily:T.font, fontSize:12, fontWeight:600 }}>{s.label}</span>
                    <span style={{ color:T.cyan, fontFamily:T.font, fontSize:12, fontWeight:700 }}>{s.value}</span>
                  </div>
                  <div style={{ color:T.text2, fontFamily:T.font, fontSize:10, marginTop:3 }}>{s.note}</div>
                </div>
              ))}
              <div style={{ padding:"12px 16px", borderBottom:`1px solid ${T.border}` }}>
                <div style={{ color:T.text1, fontFamily:T.font, fontSize:12, fontWeight:600, marginBottom:8 }}>Theme</div>
                <div style={{ display:"flex", gap:6 }}>
                  {[["🌙","dark"],["☀️","light"],["⚡","auto"]].map(([icon,id]) => (
                    <button key={id} onClick={() => onThemeChange && onThemeChange(id)}
                      style={{ flex:1, padding:"6px 0", borderRadius:6, border:`1px solid ${currentTheme===id ? T.cyanMid : T.border}`, background:currentTheme===id ? T.cyanDim : T.bg2, color:currentTheme===id ? T.cyan : T.text2, fontFamily:T.font, fontSize:12, cursor:"pointer", transition:"all 0.15s" }}>
                      {icon} {id}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ padding:"12px 16px", display:"flex", gap:8 }}>
                <button onClick={() => setHeaderPanel(null)} style={{ flex:1, padding:"8px 0", borderRadius:6, border:`1px solid ${T.border}`, background:T.bg2, color:T.text1, fontFamily:T.font, fontSize:12, cursor:"pointer" }}>Close</button>
                <button onClick={() => { setPage("dashboard"); setHeaderPanel(null); }} style={{ flex:1, padding:"8px 0", borderRadius:6, border:"none", background:T.cyan, color:"#000", fontFamily:T.font, fontSize:12, fontWeight:700, cursor:"pointer" }}>Dashboard</button>
              </div>
            </div>
          )}

          {/* Signal Engine Panel */}
          {headerPanel === "signals" && (
            <div style={{ position:"absolute", right:20, top:64, width:300, background:T.bg1, border:`1px solid ${T.border}`, borderRadius:10, boxShadow:"0 12px 40px rgba(0,0,0,0.5)", zIndex:9999, overflow:"hidden" }}>
              <div style={{ padding:"14px 16px", borderBottom:`1px solid ${T.border}`, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <span style={{ color:T.text0, fontFamily:T.font, fontWeight:700, fontSize:13 }}>⚡ Signal Engine</span>
                <button onClick={() => setHeaderPanel(null)} style={{ background:"none", border:"none", color:T.text2, cursor:"pointer", fontSize:16, padding:0 }}>✕</button>
              </div>
              <div style={{ padding:"12px 16px", display:"flex", gap:8 }}>
                {[["WATCHING","—",T.cyan],["SIGNALS","—",T.green],["BARS","—",T.text1]].map(([l,v,c])=>(
                  <div key={l} style={{ flex:1, background:T.bg2, border:`1px solid ${T.border}`, borderRadius:6, padding:"8px 6px", textAlign:"center" }}>
                    <div style={{ color:T.text2, fontSize:8, letterSpacing:1 }}>{l}</div>
                    <div style={{ color:c, fontFamily:T.font, fontSize:16, fontWeight:700, marginTop:3 }}>{v}</div>
                  </div>
                ))}
              </div>
              <div style={{ padding:"0 16px 12px" }}>
                <div style={{ color:T.text2, fontFamily:T.font, fontSize:10, marginBottom:6 }}>COOLDOWN · SESSION FILTER · ADX THRESHOLD</div>
                {[["Signal Cooldown","120s"],["Min Score","0.45"],["Min Confidence","50%"],["Session Filter","Midday skipped"]].map(([l,v])=>(
                  <div key={l} style={{ display:"flex", justifyContent:"space-between", padding:"5px 0", borderBottom:`1px solid ${T.border}` }}>
                    <span style={{ color:T.text2, fontFamily:T.font, fontSize:11 }}>{l}</span>
                    <span style={{ color:T.cyan, fontFamily:T.font, fontSize:11, fontWeight:600 }}>{v}</span>
                  </div>
                ))}
              </div>
              <div style={{ padding:"12px 16px", display:"flex", gap:8 }}>
                <button onClick={() => { setPage("signals"); setHeaderPanel(null); }} style={{ flex:1, padding:"8px 0", borderRadius:6, border:"none", background:T.cyan, color:"#000", fontFamily:T.font, fontSize:12, fontWeight:700, cursor:"pointer" }}>Open Signals Page</button>
              </div>
            </div>
          )}
        </div>

        {/* Global alert strip (hidden on live page — sector pills shown there instead) */}
        {page !== "live" && (
          <div style={{ background:T.bg1, borderBottom:`1px solid #080f1a`, padding:"7px 20px", display:"flex", gap:9, flexShrink:0, overflowX:"auto" }}>
            {(() => {
              const all = Array.from(tickers.values());
              const counts = [
                ["📡","VOL SPIKES", T.cyan,   all.filter(t => t.volume_spike).length],
                ["📊","GAP PLAYS",  T.gold,   all.filter(t => t.is_gap_play).length],
                ["🌙","AH MOMT.",   T.purple, all.filter(t => t.ah_momentum).length],
                ["📋","EARN. GAPS", T.orange, all.filter(t => t.is_earnings_gap_play).length],
                ["💎","DIAMOND",    T.cyan,   all.filter(t => Math.abs(t.percent_change || 0) >= 5).length],
              ];
              return counts.map(([icon,label,color,count]) => (
                <div key={label}
                  onClick={() => {
                    const filterMap = {"VOL SPIKES":"VOL_SPIKES","GAP PLAYS":"GAP_PLAYS","AH MOMT.":"AH_MOMT","EARN. GAPS":"EARN_GAPS","DIAMOND":"DIAMOND"};
                    setQuickFilter(filterMap[label] ?? null);
                    setPage("live");
                  }}
                  style={{ display:"flex",alignItems:"center",gap:8,background:T.bg2,border:`1px solid ${T.border}`,borderRadius:7,padding:"5px 13px",cursor:"pointer",flexShrink:0,transition:"all 0.2s" }}
                  onMouseEnter={e=>{e.currentTarget.style.borderColor=color+"40"; e.currentTarget.style.background=color+"08";}}
                  onMouseLeave={e=>{e.currentTarget.style.borderColor=T.border; e.currentTarget.style.background=T.bg2;}}>
                  <span style={{ fontSize:12 }}>{icon}</span>
                  <span style={{ color:T.text2, fontSize:8.5, letterSpacing:1.5, fontFamily:T.font }}>{label}</span>
                  <span style={{ color:count > 0 ? color : T.text2, fontFamily:T.font, fontSize:14, fontWeight:700 }}>{count > 0 ? count : "—"}</span>
                </div>
              ));
            })()}
          </div>
        )}

        {/* Page content */}
        <div key={page} style={{ flex:1, overflowY:"auto", padding:18 }}>
          {renderPage()}
        </div>
      </div>
    </div>
  );
}
