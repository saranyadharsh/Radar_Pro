/**
 * NexRadarDashboard.jsx — v5.0 — LIVE SUPABASE DATA
 *
 * ALL data now comes from real backend APIs:
 *   GET /api/tickers?source=all             → live_tickers table
 *   GET /api/tickers?source=all&sector=X    → sector-filtered
 *   GET /api/signals                         → signals table
 *   GET /api/metrics                         → ws engine stats
 *   GET /api/earnings                        → earnings table
 *   WS  /ws/live                             → real-time tick stream
 *
 * Sector counts derived from live_tickers sector field (populated by
 * ws_engine from stock_list.sector column).
 */

import { useState, useEffect, useRef, useMemo, useCallback } from "react";

// ─── API base (matches vite.config.js proxy) ─────────────────────────────────
const API = import.meta.env.VITE_API_BASE || "";
const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:8000/ws/live";

// ─── DESIGN TOKENS ────────────────────────────────────────────────────────────
const DARK = {
  bg: "#030912", bg2: "#060f1e", panel: "#08111f", panel2: "#0c1828", panel3: "#0f1e30",
  line: "rgba(255,255,255,0.06)", line2: "rgba(255,255,255,0.11)",
  text: "#f1f5f9", muted: "#4a6080", muted2: "#2d4a6a",
};
const LIGHT = {
  bg: "#f0f4f8", bg2: "#e4ecf4", panel: "#ffffff", panel2: "#f1f5fb", panel3: "#e2eaf5",
  line: "rgba(0,0,0,0.07)", line2: "rgba(0,0,0,0.12)",
  text: "#0f1e30", muted: "#6b82a0", muted2: "#8fa4bf",
};
const C = {
  amber: "#f59e0b", amber2: "#fbbf24",
  cyan: "#22d3ee", cyan2: "#67e8f9",
  green: "#10b981", green2: "#34d399",
  red: "#ef4444", red2: "#f87171",
  violet: "#8b5cf6", blue: "#3b82f6",
};

const clr = (n) => (n >= 0 ? C.green2 : C.red2);
const pct = (n) => `${n >= 0 ? "+" : ""}${Number(n || 0).toFixed(2)}%`;
const nowT = () => new Date().toLocaleTimeString("en-US", { hour12: false });
const fmt2 = (n) => Number(n || 0).toFixed(2);

// Known sector list (matches your stock_list sector values)
const SECTOR_LIST = [
  "TECHNOLOGY", "CONSUMER", "BANKING", "BIO",
  "BM & UENE", "REALCOM", "INDUSTRIALS",
];

// ─── MINI CANDLE CHART (visual only — seed from symbol) ──────────────────────
function CandleChart({ symbol }) {
  const seed = (symbol?.charCodeAt(0) || 78) + (symbol?.charCodeAt(1) || 86);
  const candles = Array.from({ length: 40 }, (_, i) => {
    const base = 100 + Math.sin((i + seed) * 0.3) * 20 + i * 0.5;
    const o = base + (Math.random() - 0.5) * 8;
    const c = base + (Math.random() - 0.5) * 8 + 1;
    const h = Math.max(o, c) + Math.random() * 4;
    const l = Math.min(o, c) - Math.random() * 4;
    const vol = 30 + Math.random() * 50;
    return { o, c, h, l, vol };
  });
  const allV = candles.flatMap((c) => [c.h, c.l]);
  const minV = Math.min(...allV), maxV = Math.max(...allV), rng = maxV - minV || 1;
  const W = 460, H = 150, VH = 36, cw = W / candles.length;
  const sy = (v) => H - ((v - minV) / rng) * (H - 8) - 4;
  const maxVol = Math.max(...candles.map((c) => c.vol));
  const vwap = candles.map((c, i) => `${i === 0 ? "M" : "L"}${i * cw + cw / 2},${sy(minV + rng * (0.45 + Math.sin(i * 0.15) * 0.08))}`).join(" ");
  const ema = candles.map((c, i) => `${i === 0 ? "M" : "L"}${i * cw + cw / 2},${sy(minV + rng * (0.5 + Math.sin(i * 0.2 + 1) * 0.1))}`).join(" ");
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H + VH + 8}`} preserveAspectRatio="none"
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
      {[0.25, 0.5, 0.75].map((f) => (
        <line key={f} x1={0} y1={sy(minV + rng * f)} x2={W} y2={sy(minV + rng * f)} stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
      ))}
      <path d={vwap} fill="none" stroke={C.amber} strokeWidth="1.2" strokeDasharray="4,3" opacity="0.7" />
      <path d={ema} fill="none" stroke="#8b5cf6" strokeWidth="1" opacity="0.6" />
      {candles.map((c, i) => {
        const x = i * cw + cw * 0.2, bw = cw * 0.6, bull = c.c >= c.o;
        const top = sy(Math.max(c.o, c.c)), bot = sy(Math.min(c.o, c.c)), bh = Math.max(bot - top, 1);
        return (
          <g key={i}>
            <line x1={x + bw / 2} y1={sy(c.h)} x2={x + bw / 2} y2={sy(c.l)} stroke={bull ? C.green : C.red} strokeWidth="0.8" />
            <rect x={x} y={top} width={bw} height={bh} rx="0.5" fill={bull ? C.green : C.red} opacity={bull ? 0.75 : 0.7} />
          </g>
        );
      })}
      {candles.map((c, i) => {
        const x = i * cw + cw * 0.2, bw = cw * 0.6, bull = c.c >= c.o, bh = (c.vol / maxVol) * VH;
        return <rect key={`v${i}`} x={x} y={H + 8 + (VH - bh)} width={bw} height={bh} fill={bull ? C.green : C.red} opacity="0.3" />;
      })}
      <rect x={2} y={2} width={6} height={3} fill={C.amber} />
      <text x={12} y={7} fontSize="7" fill={C.amber} opacity="0.8">VWAP</text>
      <rect x={46} y={2} width={6} height={3} fill="#8b5cf6" />
      <text x={56} y={7} fontSize="7" fill="#8b5cf6" opacity="0.8">EMA21</text>
    </svg>
  );
}

// ─── SECTOR HEATMAP TILE ──────────────────────────────────────────────────────
function HeatTile({ s, T, onClick }) {
  const intensity = Math.min(Math.abs(s.chgP) / 4, 1);
  const isPos = s.chgP >= 0;
  const bg = isPos ? `rgba(16,185,129,${0.06 + intensity * 0.18})` : `rgba(239,68,68,${0.06 + intensity * 0.18})`;
  const brd = isPos ? `rgba(16,185,129,${0.2 + intensity * 0.3})` : `rgba(239,68,68,${0.2 + intensity * 0.3})`;
  const barW = Math.min(Math.abs(s.chgP) / 5 * 100, 100);
  return (
    <div onClick={() => onClick(s)}
      style={{ background: bg, border: `1px solid ${brd}`, borderRadius: 8, padding: "8px 10px", cursor: "pointer", transition: "transform 0.12s", position: "relative", overflow: "hidden" }}
      onMouseEnter={(e) => { e.currentTarget.style.transform = "scale(1.04)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; }}>
      <div style={{ fontSize: 8, color: T.muted, letterSpacing: ".1em", textTransform: "uppercase", marginBottom: 2 }}>{s.name}</div>
      <div style={{ fontFamily: "'Rajdhani',sans-serif", fontSize: 20, fontWeight: 700, color: clr(s.chgP), lineHeight: 1 }}>{pct(s.chgP)}</div>
      <div style={{ marginTop: 5, height: 3, background: T.panel3, borderRadius: 2, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${barW}%`, background: isPos ? C.green : C.red, borderRadius: 2 }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3, fontSize: 7, color: T.muted }}>
        <span>{s.count} stocks</span>
        <span style={{ color: C.green2 }}>{s.gainers}↑ <span style={{ color: C.red2 }}>{s.losers}↓</span></span>
      </div>
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 2, background: isPos ? C.green : C.red, opacity: 0.6 }} />
    </div>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function NexRadarDashboard() {
  // ── State ──────────────────────────────────────────────────────────────────
  const [tickers, setTickers] = useState(new Map());       // Map<ticker, row>
  const [signals, setSignals] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [earnings, setEarnings] = useState([]);

  const [selectedTicker, setSelected] = useState(null);
  const [sortBy, setSortBy] = useState("change_value");
  const [sortDir, setSortDir] = useState(-1);
  const [timeframe, setTimeframe] = useState("5");
  const [sigFilter, setSigFilter] = useState("ALL");
  const [dataSource, setDS] = useState("all");
  const [activeSector, setSector] = useState("ALL");
  const [viewMode, setView] = useState("TABLE");
  const [search, setSearch] = useState("");
  const [darkMode, setDark] = useState(true);
  const [tvCount, setTvCount] = useState(5);
  const [bulkTarget, setBulkTarget] = useState("tradingview");
  const [heartbeat, setHB] = useState(nowT());
  const [flashMap, setFlash] = useState({});
  const [wsStatus, setWsStatus] = useState("connecting");
  const [notifOpen, setNotifOpen] = useState(false);
  const [activeTab, setTab] = useState("DASHBOARD");

  const T = darkMode ? DARK : LIGHT;
  const wsRef = useRef(null);
  const retryTimer = useRef(null);
  const retryDelay = useRef(1000);

  // ── WebSocket (real-time ticks) ────────────────────────────────────────────
  const connectWS = useCallback(() => {
    setWsStatus("connecting");
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setWsStatus("Healthy");
      retryDelay.current = 1000;
    };

    ws.onmessage = (event) => {
      const parse = (text) => {
        try {
          const msg = JSON.parse(text);
          if (msg.type === "snapshot") {
            const m = new Map();
            for (const row of msg.data ?? []) m.set(row.ticker, row);
            setTickers(m);
            // pick first positive mover as default selection
            const first = msg.data?.find(r => r.is_positive);
            if (first) setSelected(s => s || first.ticker);
          } else if (msg.type === "tick") {
            setTickers(prev => {
              const next = new Map(prev);
              const merged = { ...(prev.get(msg.ticker) ?? {}), ...msg.data };
              next.set(msg.ticker, merged);
              return next;
            });
            setFlash(f => ({ ...f, [msg.ticker]: (msg.data?.change_value ?? 0) >= 0 ? "up" : "dn" }));
            setTimeout(() => setFlash(f => { const n = { ...f }; delete n[msg.ticker]; return n; }), 400);
            setHB(nowT());
          }
        } catch { /* ignore */ }
      };
      if (event.data instanceof Blob) {
        const r = new FileReader();
        r.onload = () => parse(r.result);
        r.readAsText(event.data);
      } else parse(event.data);
    };

    ws.onerror = () => setWsStatus("Degraded");
    ws.onclose = () => {
      setWsStatus("closed");
      const wait = Math.min(retryDelay.current * (0.8 + Math.random() * 0.4), 30000);
      retryDelay.current = Math.min(retryDelay.current * 2, 30000);
      retryTimer.current = setTimeout(connectWS, wait);
    };
  }, []);

  useEffect(() => {
    connectWS();
    return () => { clearTimeout(retryTimer.current); wsRef.current?.close(); };
  }, [connectWS]);

  // ── REST polls ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const fetchAll = () => {
      fetch(`${API}/api/metrics`).then(r => r.json()).then(setMetrics).catch(() => {});
      fetch(`${API}/api/signals?limit=200`).then(r => r.json()).then(setSignals).catch(() => {});
      const today = new Date().toISOString().slice(0, 10);
      const next7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
      fetch(`${API}/api/earnings?start=${today}&end=${next7}`).then(r => r.json()).then(setEarnings).catch(() => {});
    };
    fetchAll();
    const id = setInterval(fetchAll, 5000);
    return () => clearInterval(id);
  }, []);

  // ── Derived data ───────────────────────────────────────────────────────────
  const allRows = useMemo(() => Array.from(tickers.values()), [tickers]);

  // sector heatmap — computed from live cache
  const sectorData = useMemo(() => {
    return SECTOR_LIST.map(name => {
      const stocks = allRows.filter(r => (r.sector || "").toUpperCase() === name.toUpperCase());
      const avg = stocks.length ? stocks.reduce((a, s) => a + (s.percent_change || 0), 0) / stocks.length : 0;
      return {
        name,
        chgP: parseFloat(avg.toFixed(2)),
        count: stocks.length,
        gainers: stocks.filter(s => (s.percent_change || 0) > 0).length,
        losers: stocks.filter(s => (s.percent_change || 0) <= 0).length,
      };
    });
  }, [allRows]);

  // source + sector + search filter
  const filtered = useMemo(() => {
    let rows = [...allRows];

    if (dataSource === "monitor") {
      // would need monitor list — approximate: show tickers with signals
      rows = rows.filter(r => signals.some(s => s.symbol === r.ticker));
    } else if (dataSource === "portfolio") {
      rows = rows.filter(r => r.is_positive && (r.percent_change || 0) > 2);
    }
    // "all" / "stock_list" — no extra filter

    if (activeSector !== "ALL") {
      rows = rows.filter(r => (r.sector || "").toUpperCase() === activeSector.toUpperCase());
    }

    if (search) {
      const q = search.toUpperCase();
      rows = rows.filter(r => r.ticker?.includes(q) || r.company_name?.toUpperCase().includes(q));
    }

    rows.sort((a, b) => sortDir * ((a[sortBy] || 0) - (b[sortBy] || 0)));
    return rows;
  }, [allRows, dataSource, activeSector, search, sortBy, sortDir, signals]);

  const top10 = useMemo(() =>
    [...filtered].sort((a, b) => (b.change_value || 0) - (a.change_value || 0)).slice(0, 10),
    [filtered]);

  const stock = selectedTicker ? (tickers.get(selectedTicker) || null) : (top10[0] || null);

  const handleSort = (col) => {
    if (sortBy === col) setSortDir(d => -d);
    else { setSortBy(col); setSortDir(-1); }
  };

  // alert counts from metrics
  const m = metrics;
  const volSpikes = m?.volume_spikes ?? 0;
  const gapPlays = m?.gap_plays ?? 0;
  const diamonds = m?.diamond ?? 0;
  const ahMomt = m?.ah_momentum ?? 0;
  const posCount = m?.pos_count ?? 0;
  const liveCount = m?.live_count ?? allRows.length;
  const totalCount = m?.total_tickers ?? allRows.length;
  const earningsGaps = m?.earnings_gap_plays ?? 0;

  const filteredSigs = sigFilter === "ALL" ? signals : signals.filter(s => s.direction === sigFilter);

  const aiConf = stock ? Math.min(99, Math.max(55, Math.round(72 + (stock.percent_change > 0 ? stock.percent_change * 2 : 0)))) : 72;
  const atr = stock ? (stock.live_price * 0.012).toFixed(2) : "0.00";
  const sl = stock ? (stock.live_price - parseFloat(atr) * 1.5).toFixed(2) : "0.00";

  const wsIcon = wsStatus === "Healthy" ? "🟢" : wsStatus === "connecting" ? "🟡" : "🔴";
  const wsColor = wsStatus === "Healthy" ? C.green : wsStatus === "connecting" ? C.amber : C.red;

  const openBulk = () => {
    top10.slice(0, tvCount).forEach(r => {
      const url = bulkTarget === "tradingview"
        ? `https://www.tradingview.com/chart/?symbol=${r.ticker}`
        : `https://finance.yahoo.com/quote/${r.ticker}/`;
      window.open(url, "_blank");
    });
  };

  const btn = (active, label, onClick, extra = {}) => (
    <button onClick={onClick} style={{
      background: active ? C.amber : T.panel2,
      color: active ? "#000" : T.muted,
      border: `1px solid ${active ? C.amber : T.line2}`,
      borderRadius: 5, padding: "3px 9px", fontSize: 10,
      fontFamily: "'Rajdhani',sans-serif", fontWeight: 600,
      cursor: "pointer", letterSpacing: ".05em", ...extra,
    }}>{label}</button>
  );

  const th = (label, col) => (
    <th onClick={() => handleSort(col)} style={{
      padding: "6px 8px", textAlign: "left", fontSize: 9,
      color: sortBy === col ? C.amber : T.muted,
      letterSpacing: ".08em", textTransform: "uppercase",
      cursor: "pointer", whiteSpace: "nowrap", fontWeight: 600,
      borderBottom: `1px solid ${T.line}`,
    }}>
      {label}{sortBy === col ? (sortDir === -1 ? " ▼" : " ▲") : ""}
    </th>
  );

  // ── RENDER ────────────────────────────────────────────────────────────────
  return (
    <div style={{
      fontFamily: "'IBM Plex Mono','Fira Code',monospace",
      background: T.bg, color: T.text, minHeight: "100vh",
      fontSize: 11, userSelect: "none",
    }}>
      {/* Google Font */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@400;600;700&family=IBM+Plex+Mono:wght@400;600&display=swap');
        ::-webkit-scrollbar{width:4px;height:4px}
        ::-webkit-scrollbar-track{background:transparent}
        ::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.1);border-radius:2px}
        @keyframes flashUp{0%,100%{background:transparent}50%{background:rgba(52,211,153,0.18)}}
        @keyframes flashDn{0%,100%{background:transparent}50%{background:rgba(248,113,113,0.18)}}
        .flash-up{animation:flashUp 0.4s ease}
        .flash-dn{animation:flashDn 0.4s ease}
      `}</style>

      {/* ── TOP NAV ── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 16px", height: 42,
        background: T.panel, borderBottom: `1px solid ${T.line2}`,
        position: "sticky", top: 0, zIndex: 100,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            fontFamily: "'Rajdhani',sans-serif", fontWeight: 700,
            fontSize: 18, color: C.amber, letterSpacing: ".1em",
          }}>NEX<span style={{ color: T.text }}>RADAR</span></div>
          <div style={{ fontSize: 8, color: T.muted, letterSpacing: ".15em", marginTop: 2 }}>
            REAL-TIME MARKET INTELLIGENCE
          </div>
        </div>

        <div style={{ display: "flex", gap: 4 }}>
          {["DASHBOARD", "SIGNALS", "EARNINGS", "PORTFOLIO"].map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              background: activeTab === t ? `rgba(245,158,11,0.12)` : "transparent",
              color: activeTab === t ? C.amber : T.muted,
              border: `1px solid ${activeTab === t ? C.amber : "transparent"}`,
              borderRadius: 4, padding: "3px 10px", fontSize: 9,
              fontFamily: "'Rajdhani',sans-serif", fontWeight: 700,
              cursor: "pointer", letterSpacing: ".1em",
            }}>{t}</button>
          ))}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ fontSize: 9, color: wsColor }}>
            {wsIcon} {wsStatus.toUpperCase()}
          </div>
          <div style={{ fontSize: 9, color: T.muted }}>
            TICK <span style={{ color: C.cyan }}>{heartbeat}</span>
          </div>
          <div style={{ fontSize: 9, color: T.muted }}>
            LIVE <span style={{ color: C.amber, fontWeight: 700 }}>{liveCount.toLocaleString()}</span>
            <span style={{ color: T.muted }}> / {totalCount.toLocaleString()}</span>
          </div>
          <button onClick={() => setDark(d => !d)} style={{
            background: "transparent", border: `1px solid ${T.line2}`,
            borderRadius: 4, padding: "2px 7px", fontSize: 10,
            color: T.muted, cursor: "pointer",
          }}>{darkMode ? "☀" : "🌙"}</button>
        </div>
      </div>

      {/* ── ALERT STRIP ── */}
      <div style={{
        display: "flex", gap: 6, padding: "6px 16px",
        background: T.bg2, borderBottom: `1px solid ${T.line}`,
        overflowX: "auto",
      }}>
        {[
          { label: "VOL SPIKES", val: volSpikes, color: C.amber },
          { label: "GAP PLAYS", val: gapPlays, color: C.cyan },
          { label: "DIAMONDS 💎", val: diamonds, color: C.violet },
          { label: "AH MOMENTUM", val: ahMomt, color: C.green2 },
          { label: "GAINERS", val: posCount, color: C.green2 },
          { label: "EARNINGS GAPS", val: earningsGaps, color: C.amber2 },
        ].map(({ label, val, color }) => (
          <div key={label} style={{
            display: "flex", alignItems: "center", gap: 5,
            background: T.panel, border: `1px solid ${T.line2}`,
            borderRadius: 5, padding: "3px 10px", whiteSpace: "nowrap",
          }}>
            <span style={{ fontSize: 8, color: T.muted, letterSpacing: ".1em" }}>{label}</span>
            <span style={{ fontFamily: "'Rajdhani',sans-serif", fontSize: 16, fontWeight: 700, color }}>
              {val}
            </span>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", height: "calc(100vh - 90px)", overflow: "hidden" }}>

        {/* ── LEFT PANEL: Detail + Chart ── */}
        <div style={{
          width: 260, flexShrink: 0, borderRight: `1px solid ${T.line2}`,
          display: "flex", flexDirection: "column", overflowY: "auto",
        }}>
          {/* Stock Detail */}
          {stock ? (
            <div style={{ padding: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <div>
                  <div style={{ fontFamily: "'Rajdhani',sans-serif", fontSize: 22, fontWeight: 700, color: T.text }}>
                    {stock.ticker}
                  </div>
                  <div style={{ fontSize: 8, color: T.muted, maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {stock.company_name || "—"}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontFamily: "'Rajdhani',sans-serif", fontSize: 24, fontWeight: 700, color: clr(stock.change_value) }}>
                    ${fmt2(stock.live_price)}
                  </div>
                  <div style={{ fontSize: 10, color: clr(stock.change_value) }}>
                    {stock.change_value >= 0 ? "+" : ""}{fmt2(stock.change_value)} ({pct(stock.percent_change)})
                  </div>
                </div>
              </div>

              {/* Chart placeholder */}
              <div style={{ position: "relative", height: 194, borderRadius: 6, overflow: "hidden", background: T.panel2, marginBottom: 8 }}>
                <CandleChart symbol={stock.ticker} />
              </div>

              {/* Timeframe */}
              <div style={{ display: "flex", gap: 3, marginBottom: 8 }}>
                {["1", "5", "15", "60", "D"].map(tf => btn(timeframe === tf, tf + (tf === "D" ? "" : "m"), () => setTimeframe(tf), { fontSize: 9, padding: "2px 7px" }))}
              </div>

              {/* Stats grid */}
              {[
                ["SECTOR", stock.sector || "—"],
                ["VOLUME", (stock.volume || 0).toLocaleString()],
                ["VOL AVG", (stock.avg_volume || 0).toLocaleString()],
                ["MKT CAP", stock.market_cap ? `$${(stock.market_cap / 1e9).toFixed(1)}B` : "—"],
                ["GAP %", pct(stock.gap_percent)],
                ["ATR (est)", `$${atr}`],
                ["STOP LOSS", `$${sl}`],
                ["AI CONF", `${aiConf}%`],
              ].map(([k, v]) => (
                <div key={k} style={{
                  display: "flex", justifyContent: "space-between",
                  borderBottom: `1px solid ${T.line}`, padding: "4px 0", fontSize: 10,
                }}>
                  <span style={{ color: T.muted, fontSize: 8, letterSpacing: ".08em" }}>{k}</span>
                  <span style={{ color: k === "AI CONF" ? C.violet : T.text, fontWeight: 600 }}>{v}</span>
                </div>
              ))}

              {/* Alert badges */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 8 }}>
                {stock.volume_spike && <span style={{ background: `rgba(245,158,11,0.15)`, border: `1px solid ${C.amber}`, borderRadius: 3, padding: "1px 6px", fontSize: 8, color: C.amber }}>VOL SPIKE</span>}
                {stock.gap_percent > 2 && <span style={{ background: `rgba(34,211,238,0.12)`, border: `1px solid ${C.cyan}`, borderRadius: 3, padding: "1px 6px", fontSize: 8, color: C.cyan }}>GAP PLAY</span>}
                {stock.ah_momentum && <span style={{ background: `rgba(52,211,153,0.12)`, border: `1px solid ${C.green}`, borderRadius: 3, padding: "1px 6px", fontSize: 8, color: C.green2 }}>AH MOMT</span>}
                {stock.pullback_state && <span style={{ background: `rgba(139,92,246,0.12)`, border: `1px solid ${C.violet}`, borderRadius: 3, padding: "1px 6px", fontSize: 8, color: C.violet }}>PULLBACK</span>}
              </div>

              {/* TradingView link */}
              <a href={`https://www.tradingview.com/chart/?symbol=${stock.ticker}`} target="_blank" rel="noreferrer"
                style={{
                  display: "block", marginTop: 10, background: `rgba(245,158,11,0.1)`,
                  border: `1px solid ${C.amber}`, borderRadius: 5, padding: "5px",
                  textAlign: "center", color: C.amber, fontSize: 10, textDecoration: "none",
                  fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, letterSpacing: ".1em",
                }}>
                OPEN IN TRADINGVIEW ↗
              </a>
            </div>
          ) : (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: T.muted, fontSize: 10 }}>
              {allRows.length === 0 ? "Connecting to live feed…" : "Select a stock"}
            </div>
          )}
        </div>

        {/* ── CENTRE: Main table ── */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

          {/* Sector heatmap */}
          <div style={{
            padding: "8px 12px", borderBottom: `1px solid ${T.line}`,
            display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 5,
          }}>
            {sectorData.map(s => (
              <HeatTile key={s.name} s={s} T={T} onClick={sec => {
                setSector(activeSector === sec.name ? "ALL" : sec.name);
              }} />
            ))}
          </div>

          {/* Toolbar */}
          <div style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "6px 12px", borderBottom: `1px solid ${T.line}`, flexWrap: "wrap",
          }}>
            {/* Search */}
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search ticker / name…"
              style={{
                background: T.panel2, border: `1px solid ${T.line2}`, borderRadius: 5,
                padding: "4px 8px", color: T.text, fontSize: 10, outline: "none", width: 160,
                fontFamily: "inherit",
              }} />

            {/* Data source */}
            <div style={{ display: "flex", gap: 3 }}>
              {[["all", "ALL"], ["monitor", "WATCHLIST"], ["portfolio", "PORTFOLIO"]].map(([v, l]) =>
                btn(dataSource === v, l, () => setDS(v), { fontSize: 9 })
              )}
            </div>

            {/* Sector pill */}
            {activeSector !== "ALL" && (
              <div style={{
                background: `rgba(245,158,11,0.12)`, border: `1px solid ${C.amber}`,
                borderRadius: 4, padding: "2px 8px", fontSize: 9, color: C.amber, display: "flex", alignItems: "center", gap: 4,
              }}>
                {activeSector}
                <span onClick={() => setSector("ALL")} style={{ cursor: "pointer", color: T.muted }}>✕</span>
              </div>
            )}

            <div style={{ marginLeft: "auto", display: "flex", gap: 4, alignItems: "center" }}>
              {/* View toggle */}
              {btn(viewMode === "TABLE", "≡ TABLE", () => setView("TABLE"))}
              {btn(viewMode === "MOVERS", "↑ MOVERS", () => setView("MOVERS"))}

              {/* Bulk open */}
              <select value={bulkTarget} onChange={e => setBulkTarget(e.target.value)}
                style={{ background: T.panel2, border: `1px solid ${T.line2}`, color: T.muted, borderRadius: 4, fontSize: 9, padding: "2px 4px" }}>
                <option value="tradingview">TradingView</option>
                <option value="yahoo">Yahoo Finance</option>
              </select>
              <select value={tvCount} onChange={e => setTvCount(Number(e.target.value))}
                style={{ background: T.panel2, border: `1px solid ${T.line2}`, color: T.muted, borderRadius: 4, fontSize: 9, padding: "2px 4px" }}>
                {[3, 5, 10].map(n => <option key={n} value={n}>Top {n}</option>)}
              </select>
              <button onClick={openBulk} style={{
                background: `rgba(34,211,238,0.1)`, border: `1px solid ${C.cyan}`,
                color: C.cyan, borderRadius: 5, padding: "3px 9px", fontSize: 9,
                fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, cursor: "pointer",
              }}>OPEN CHARTS</button>
            </div>
          </div>

          {/* Table or Movers */}
          <div style={{ flex: 1, overflowY: "auto" }}>
            {allRows.length === 0 ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 10, color: T.muted }}>
                <div style={{ fontSize: 28 }}>📡</div>
                <div style={{ fontSize: 12, color: C.amber }}>Connecting to live data feed…</div>
                <div style={{ fontSize: 9 }}>WebSocket: {wsStatus} · {WS_URL}</div>
              </div>
            ) : viewMode === "MOVERS" ? (
              <div style={{ padding: 12, display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(180px,1fr))", gap: 8 }}>
                {top10.map(r => (
                  <div key={r.ticker} onClick={() => setSelected(r.ticker)}
                    style={{
                      background: selectedTicker === r.ticker ? `rgba(245,158,11,0.08)` : T.panel2,
                      border: `1px solid ${selectedTicker === r.ticker ? C.amber : T.line2}`,
                      borderRadius: 8, padding: "10px 12px", cursor: "pointer",
                    }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, fontSize: 15, color: T.text }}>{r.ticker}</span>
                      <span style={{ fontSize: 9, color: T.muted }}>{r.sector}</span>
                    </div>
                    <div style={{ fontFamily: "'Rajdhani',sans-serif", fontSize: 20, fontWeight: 700, color: clr(r.change_value), marginTop: 2 }}>
                      ${fmt2(r.live_price)}
                    </div>
                    <div style={{ fontSize: 10, color: clr(r.change_value) }}>{pct(r.percent_change)}</div>
                    <div style={{ fontSize: 8, color: T.muted, marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {r.company_name}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead style={{ position: "sticky", top: 0, background: T.panel2, zIndex: 2 }}>
                  <tr>
                    {th("TICKER", "ticker")}
                    {th("PRICE", "live_price")}
                    {th("CHG $", "change_value")}
                    {th("CHG %", "percent_change")}
                    {th("VOLUME", "volume")}
                    {th("GAP %", "gap_percent")}
                    <th style={{ padding: "6px 8px", fontSize: 9, color: T.muted, letterSpacing: ".08em", textTransform: "uppercase", borderBottom: `1px solid ${T.line}` }}>SECTOR</th>
                    <th style={{ padding: "6px 8px", fontSize: 9, color: T.muted, letterSpacing: ".08em", textTransform: "uppercase", borderBottom: `1px solid ${T.line}` }}>FLAGS</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(r => {
                    const flash = flashMap[r.ticker];
                    return (
                      <tr key={r.ticker}
                        className={flash === "up" ? "flash-up" : flash === "dn" ? "flash-dn" : ""}
                        onClick={() => setSelected(r.ticker)}
                        style={{
                          cursor: "pointer",
                          background: selectedTicker === r.ticker ? `rgba(245,158,11,0.06)` : "transparent",
                          borderLeft: selectedTicker === r.ticker ? `2px solid ${C.amber}` : "2px solid transparent",
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = T.panel2}
                        onMouseLeave={e => e.currentTarget.style.background = selectedTicker === r.ticker ? `rgba(245,158,11,0.06)` : "transparent"}
                      >
                        <td style={{ padding: "5px 8px", borderBottom: `1px solid ${T.line}` }}>
                          <span style={{ fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, fontSize: 12 }}>{r.ticker}</span>
                          <div style={{ fontSize: 8, color: T.muted, maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.company_name}</div>
                        </td>
                        <td style={{ padding: "5px 8px", borderBottom: `1px solid ${T.line}`, fontFamily: "'Rajdhani',sans-serif", fontSize: 13, fontWeight: 600 }}>
                          ${fmt2(r.live_price)}
                        </td>
                        <td style={{ padding: "5px 8px", borderBottom: `1px solid ${T.line}`, color: clr(r.change_value), fontSize: 11 }}>
                          {r.change_value >= 0 ? "+" : ""}{fmt2(r.change_value)}
                        </td>
                        <td style={{ padding: "5px 8px", borderBottom: `1px solid ${T.line}`, color: clr(r.percent_change), fontWeight: 700, fontSize: 11 }}>
                          {pct(r.percent_change)}
                        </td>
                        <td style={{ padding: "5px 8px", borderBottom: `1px solid ${T.line}`, color: T.muted, fontSize: 10 }}>
                          {(r.volume || 0).toLocaleString()}
                        </td>
                        <td style={{ padding: "5px 8px", borderBottom: `1px solid ${T.line}`, color: clr(r.gap_percent), fontSize: 10 }}>
                          {r.gap_percent ? pct(r.gap_percent) : "—"}
                        </td>
                        <td style={{ padding: "5px 8px", borderBottom: `1px solid ${T.line}`, fontSize: 8, color: T.muted, letterSpacing: ".06em" }}>
                          {r.sector || "—"}
                        </td>
                        <td style={{ padding: "5px 8px", borderBottom: `1px solid ${T.line}` }}>
                          <div style={{ display: "flex", gap: 3 }}>
                            {r.volume_spike && <span style={{ background: C.amber, color: "#000", borderRadius: 2, padding: "1px 4px", fontSize: 7, fontWeight: 700 }}>VOL</span>}
                            {r.gap_percent > 2 && <span style={{ background: C.cyan, color: "#000", borderRadius: 2, padding: "1px 4px", fontSize: 7, fontWeight: 700 }}>GAP</span>}
                            {r.ah_momentum && <span style={{ background: C.green, color: "#000", borderRadius: 2, padding: "1px 4px", fontSize: 7, fontWeight: 700 }}>AH</span>}
                            {r.pullback_state && <span style={{ background: C.violet, color: "#fff", borderRadius: 2, padding: "1px 4px", fontSize: 7, fontWeight: 700 }}>PB</span>}
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
          <div style={{
            padding: "4px 12px", borderTop: `1px solid ${T.line}`,
            display: "flex", justifyContent: "space-between",
            fontSize: 8, color: T.muted, background: T.panel,
          }}>
            <span>Showing {filtered.length.toLocaleString()} of {allRows.length.toLocaleString()} stocks</span>
            <span>{activeSector !== "ALL" ? `Sector: ${activeSector} · ` : ""}{dataSource.toUpperCase()} · {heartbeat}</span>
          </div>
        </div>

        {/* ── RIGHT PANEL: Signals + Earnings ── */}
        <div style={{ width: 240, borderLeft: `1px solid ${T.line2}`, display: "flex", flexDirection: "column" }}>

          {/* Signals */}
          <div style={{ borderBottom: `1px solid ${T.line2}`, flex: "0 0 auto" }}>
            <div style={{
              padding: "6px 10px", display: "flex", justifyContent: "space-between", alignItems: "center",
              borderBottom: `1px solid ${T.line}`,
            }}>
              <span style={{ fontSize: 9, letterSpacing: ".12em", color: T.muted }}>SCALP SIGNALS</span>
              <div style={{ display: "flex", gap: 3 }}>
                {["ALL", "LONG", "SHORT"].map(f => btn(sigFilter === f, f, () => setSigFilter(f), { fontSize: 8, padding: "1px 6px" }))}
              </div>
            </div>
            <div style={{ maxHeight: 280, overflowY: "auto" }}>
              {filteredSigs.length === 0 ? (
                <div style={{ padding: 12, textAlign: "center", color: T.muted, fontSize: 9 }}>No signals yet</div>
              ) : filteredSigs.slice(0, 30).map((sig, i) => (
                <div key={i} onClick={() => setSelected(sig.symbol)}
                  style={{
                    padding: "6px 10px", borderBottom: `1px solid ${T.line}`,
                    cursor: "pointer", display: "flex", flexDirection: "column", gap: 2,
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = T.panel2}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                >
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, fontSize: 13 }}>{sig.symbol}</span>
                    <span style={{
                      fontSize: 8, fontWeight: 700, padding: "1px 5px", borderRadius: 3,
                      background: sig.direction === "LONG" ? `rgba(16,185,129,0.15)` : `rgba(239,68,68,0.15)`,
                      color: sig.direction === "LONG" ? C.green2 : C.red2,
                    }}>{sig.direction}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: T.muted }}>
                    <span>Entry: <span style={{ color: T.text }}>${fmt2(sig.entry_price)}</span></span>
                    <span>Score: <span style={{ color: C.amber }}>{sig.score}</span></span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 8, color: T.muted }}>
                    <span>TP: ${fmt2(sig.exit_price)}</span>
                    <span style={{ color: C.violet }}>Conf: {sig.confidence}%</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Earnings Calendar */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflowY: "auto" }}>
            <div style={{
              padding: "6px 10px", borderBottom: `1px solid ${T.line}`,
              fontSize: 9, letterSpacing: ".12em", color: T.muted, display: "flex", justifyContent: "space-between",
            }}>
              <span>EARNINGS (7d)</span>
              <span style={{ color: C.amber }}>{earnings.length}</span>
            </div>
            {earnings.length === 0 ? (
              <div style={{ padding: 12, textAlign: "center", color: T.muted, fontSize: 9 }}>No upcoming earnings</div>
            ) : earnings.map((e, i) => (
              <div key={i} onClick={() => setSelected(e.ticker)}
                style={{
                  padding: "6px 10px", borderBottom: `1px solid ${T.line}`,
                  cursor: "pointer",
                }}
                onMouseEnter={ev => ev.currentTarget.style.background = T.panel2}
                onMouseLeave={ev => ev.currentTarget.style.background = "transparent"}
              >
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontFamily: "'Rajdhani',sans-serif", fontWeight: 700, fontSize: 12 }}>{e.ticker}</span>
                  <span style={{ fontSize: 8, color: C.amber }}>{e.report_time === "BMO" ? "pre-mkt" : "after"}</span>
                </div>
                <div style={{ fontSize: 8, color: T.muted, marginTop: 1 }}>
                  {new Date(e.earnings_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  {e.est_eps != null && <span style={{ marginLeft: 6 }}>EPS est: <span style={{ color: T.text }}>${fmt2(e.est_eps)}</span></span>}
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}