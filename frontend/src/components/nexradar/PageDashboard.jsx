// PageDashboard.jsx — NexRadar Pro
// Market Breadth, Scalp Signals alert feed, Top Gainers/Losers, Earnings Today

import { useState, useEffect } from "react";
import { API_BASE } from "../../config.js";
import { SECTORS } from "./constants.js";
import { pct, normalizeSector } from "./utils.js";
import { SectionHeader, Shimmer, EmptyState } from "./primitives.jsx";
import { normalizeEarningsResponse } from "./normalizer.js";

export default function PageDashboard({ onNavigate, onSectorChange, selectedSectors, sectorPerformance = {}, tickers, techData = [], techLoading = false, watchlist: watchlistProp = null, toggleWatchlist: toggleWatchlistProp = null, T }) {
  const sectorTiles = SECTORS.filter(s => s.id !== "ALL");
  const [earnings,        setEarnings]        = useState([]);
  const [earningsLoading, setEarningsLoading] = useState(true);
  // WATCHLIST-DEDUP-FIX: use watchlist prop from root (already loaded by useWatchlist).
  // Fall back to local state only if prop is not provided (standalone usage).
  const [_localWatchlist, _setLocalWatchlist] = useState(new Set());
  const watchlist = watchlistProp ?? _localWatchlist;
  const [breadthTimeframe, setBreadthTimeframe] = useState("1D");
  const [scalpFilter,     setScalpFilter]     = useState("ALL");

  // ── News Feed state ──
  const [news,        setNews]        = useState([]);
  const [newsLoading, setNewsLoading] = useState(true);
  const [newsFilter,  setNewsFilter]  = useState("ALL"); // ALL | WATCHLIST
  const [newsBadge,   setNewsBadge]   = useState(0);    // unread count for news card

  // ── Options Flow state ──
  const [optionsFlow,    setOptionsFlow]    = useState([]);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsMessage, setOptionsMessage] = useState('');  // OPTIONS-MSG-FIX: surface backend message
  const [optionsFilter,  setOptionsFilter]  = useState("ALL"); // ALL | CALLS | PUTS | SWEEP

  // ── Earnings badge state (live SSE earnings_alert) ──
  const [earningsBadge, setEarningsBadge] = useState(0);

  // ── Live SSE listener: prepend incoming news/earnings alerts to the news feed ──
  // DASHBOARD-SSE-NEWS-FIX: /api/news fetches once on mount (Polygon REST).
  // Real-time watchlist news/earnings alerts arrive via SSE → nexradar_alert window event.
  // Wire those in here so the dashboard News Feed card updates live without a refresh.
  useEffect(() => {
    const NEWS_TYPES = new Set(['news_alert', 'edgar_alert', 'earnings_alert', 'fda_alert']);
    const handler = (e) => {
      const a = e.detail;
      if (!a || !NEWS_TYPES.has(a.type)) return;
      // Normalise to Polygon article shape so the existing news card renders it
      const synthetic = {
        title:         a.title || a.sub || '',
        article_url:   a.url   || null,
        published_utc: new Date(a.ts ?? Date.now()).toISOString(),
        publisher:     { name: a.type === 'edgar_alert' ? 'SEC EDGAR' : a.type === 'earnings_alert' ? 'Earnings' : a.type === 'fda_alert' ? 'FDA' : 'Watchlist' },
        tickers:       a.ticker ? [a.ticker] : [],
        _live:         true,
        _color:        a.color ?? 'cyan',
        _emoji:        a.emoji ?? '📰',
      };
      setNews(prev => [synthetic, ...prev].slice(0, 50));
      setNewsBadge(prev => prev + 1);
      if (a.type === 'earnings_alert') setEarningsBadge(prev => prev + 1);
    };
    window.addEventListener('nexradar_alert', handler);
    return () => window.removeEventListener('nexradar_alert', handler);
  }, []);

  useEffect(() => {
    // WATCHLIST-DEDUP-FIX: only fetch if prop not provided (standalone / no root shell)
    if (watchlistProp === null) {
      fetch(`${API_BASE}/api/watchlist`)
        .then(r => r.ok ? r.json() : Promise.reject(r.status))
        .then(data => _setLocalWatchlist(new Set(data.watchlist ?? [])))
        .catch(() => {});
    }

    const now = new Date();
    // EARNINGS-TZ-FIX: toISOString() returns UTC — after 6 PM MT that's already
    // the *next* calendar day, so today's earnings never show up.
    // toLocaleDateString('en-CA') returns YYYY-MM-DD in the browser's local TZ
    // which matches the market-date convention the backend uses.
    const today = now.toLocaleDateString('en-CA');
    fetch(`${API_BASE}/api/earnings?start=${today}&end=${today}`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(data => {
        // EARNINGS-ARRAY-FIX: backend /api/earnings returns a bare [] not {data:[]}.
        // normalizeEarningsResponse may expect a wrapper — guard both shapes here
        // so a backend shape change never silently empties the earnings tiles.
        const arr = Array.isArray(data)           ? data          :
                    Array.isArray(data?.data)      ? data.data     :
                    Array.isArray(data?.earnings)  ? data.earnings :
                    Array.isArray(data?.results)   ? data.results  : [];
        try {
          setEarnings(normalizeEarningsResponse(arr.length ? data : arr));
        } catch {
          // normalizeEarningsResponse not available or threw — use raw array
          setEarnings(arr);
        }
        setEarningsLoading(false);
      })
      .catch(() => { setEarnings([]); setEarningsLoading(false); });

    // ── News Feed: proxied through /api/news (Polygon key stays server-side) ──
    // NEWS-BACKEND-FIX: Polygon key no longer lives in the browser.
    // Backend builds ticker.any_of= filter from Supabase watchlist so articles
    // are directly about held tickers, not just tagged post-hoc.
    fetch(`${API_BASE}/api/news?limit=25`)
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(j => {
        const items = Array.isArray(j?.results) ? j.results
                    : Array.isArray(j)           ? j
                    : [];
        setNews(items);
        setNewsLoading(false);
      })
      .catch(() => { setNews([]); setNewsLoading(false); });

    // ── Options Flow: proxied through /api/options-flow (mock data removed) ──
    // OPTIONS-MOCK-REMOVED: backend fetches Polygon /v3/snapshot/options per
    // watchlist ticker. Requires Polygon Starter tier+. Returns { data: [] }
    // with a message if key missing or tier insufficient — no fake rows.
    // OPTIONS-MSG-FIX: capture backend message so user sees WHY it's empty.
    fetch(`${API_BASE}/api/options-flow`)
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(j => {
        const rows = Array.isArray(j?.data) ? j.data : Array.isArray(j) ? j : [];
        setOptionsFlow(rows);
        // OPTIONS-MSG-FIX: surface backend message when data is empty
        if (rows.length === 0 && j?.message) {
          setOptionsMessage(j.message);
        }
        setOptionsLoading(false);
      })
      .catch(() => { setOptionsFlow([]); setOptionsMessage('Failed to load options flow'); setOptionsLoading(false); });
  }, []);

  const fmt2 = n => Number(n || 0).toFixed(2);

  return (
    <div className="page-enter" style={{ display:"flex", gap:18, flexWrap:"wrap", alignItems:"stretch" }}>
      <style>{`@keyframes badge_pulse { 0%,100%{transform:scale(1);opacity:1} 50%{transform:scale(1.18);opacity:0.85} }`}</style>

      {/* ── LEFT COLUMN ── */}
      {/* MOBILE-FIX-v2: minWidth set to 300px so it takes full width on mobile
          (300 > 375/2 = forces wrap) but doesn't overflow. On desktop (>768px)
          flex:2 gives it ~66% of the available width. */}
      <div style={{ flex:2, minWidth:300, display:"flex", flexDirection:"column", gap:18, alignSelf:"flex-start" }}>

        {/* Row 1: Market Breadth — full width of left column */}
        {/* MOBILE-FIX: minWidth reduced from 340→0 and grid minmax from 115→95px
            so 3 columns fit on a 375px screen (3×95 + 2×8gap + 28padding = 329px). */}
        <div className="card card-glow" style={{ flex:2, minWidth:0 }}>
          <SectionHeader title="Market Breadth" T={T}>
            {["1D","1W"].map(tf => (
              <button key={tf} className="btn-ghost" style={{ fontSize:9, background:breadthTimeframe===tf?T.cyan+"20":"transparent", color:breadthTimeframe===tf?T.cyan:T.text2 }} onClick={() => setBreadthTimeframe(tf)}>{tf}</button>
            ))}
          </SectionHeader>
          <div style={{ padding:14, display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(95px,1fr))", gap:8 }}>
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

        {/* Row 2: Top Gainers | Dark Pool Activity | Top Losers */}
        <div style={{ display:"flex", gap:18 }}>

          {/* 1. Top Gainers */}
          <div className="card" style={{ flex:1, minWidth:160 }}>
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

          {/* 2. Dark Pool Activity */}
          <div className="card" style={{ flex:1, minWidth:200, display:"flex", flexDirection:"column" }}>
            <SectionHeader title="Dark Pool Activity" T={T}>
              <span style={{ color:T.text2, fontFamily:T.font, fontSize:8.5, letterSpacing:0.5 }}>RVOL≥5× · ΔP&lt;0.3%</span>
            </SectionHeader>
            <div style={{ padding:"10px 16px", flex:1 }}>
              {(() => {
                const candidates = Array.from(tickers.values())
                  .filter(t => {
                    const rvol = t.rvol ?? t.volume_ratio ?? 0;
                    const chgPct = Math.abs(t.percent_change ?? 0);
                    return rvol >= 5 && chgPct < 0.3 && t.ticker;
                  })
                  .sort((a, b) => (b.rvol ?? b.volume_ratio ?? 0) - (a.rvol ?? a.volume_ratio ?? 0))
                  .slice(0, 5);
                if (candidates.length === 0) return (
                  <div style={{ padding:"14px 0", textAlign:"center", display:"flex", alignItems:"center", justifyContent:"center", gap:12 }}>
                    <div style={{ fontSize:20 }}>🌑</div>
                    <div>
                      <div style={{ color:T.text2, fontFamily:T.font, fontSize:11 }}>No dark pool activity detected</div>
                      <div style={{ color:T.text2, fontFamily:T.font, fontSize:9.5, marginTop:2, opacity:0.6 }}>High RVOL with flat price signals appear here</div>
                    </div>
                  </div>
                );
                return (
                  <div>
                    {candidates.map((t, i) => {
                      const rvol   = (t.rvol ?? t.volume_ratio ?? 0).toFixed(1);
                      const chgPct = (t.percent_change ?? 0).toFixed(2);
                      const price  = t.live_price ?? t.price ?? 0;
                      const vol    = t.volume ?? 0;
                      const volStr = vol >= 1e9 ? `${(vol/1e9).toFixed(1)}B` : vol >= 1e6 ? `${(vol/1e6).toFixed(1)}M` : vol >= 1e3 ? `${(vol/1e3).toFixed(0)}K` : String(vol);
                      const isUp   = (t.percent_change ?? 0) >= 0;
                      return (
                        <div key={t.ticker} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"8px 0", borderBottom:i<candidates.length-1?`1px solid ${T.border}`:"none", gap:8 }}>
                          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                            <div style={{ width:28, height:28, borderRadius:6, background:"#9c6ee812", border:"1px solid #9c6ee830", display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, flexShrink:0 }}>🌑</div>
                            <div>
                              <div style={{ display:"flex", alignItems:"center", gap:5, marginBottom:1 }}>
                                <span style={{ color:T.text0, fontSize:12, fontFamily:T.font, fontWeight:700 }}>{t.ticker}</span>
                                <span style={{ background:"#9c6ee818", border:"1px solid #9c6ee835", borderRadius:3, padding:"1px 4px", color:"#9c6ee8", fontFamily:T.font, fontSize:8, fontWeight:700 }}>{rvol}×</span>
                              </div>
                              <div style={{ display:"flex", gap:6 }}>
                                <span style={{ color:T.text2, fontFamily:T.font, fontSize:9 }}>${price.toFixed(2)}</span>
                                <span style={{ color:isUp?T.green:T.red, fontFamily:T.font, fontSize:9 }}>{isUp?"+":""}{chgPct}%</span>
                                <span style={{ color:T.text2, fontFamily:T.font, fontSize:9 }}>{volStr}</span>
                              </div>
                            </div>
                          </div>
                          <div style={{ color:"#9c6ee8", fontFamily:T.font, fontSize:11, fontWeight:700, flexShrink:0 }}>◉</div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
            <div style={{ padding:"6px 14px", borderTop:`1px solid ${T.border}`, display:"flex", justifyContent:"space-between", flexShrink:0 }}>
              <span style={{ color:T.text2, fontFamily:T.font, fontSize:8.5 }}>Dark venue / block prints</span>
              <span style={{ color:T.text2, fontFamily:T.font, fontSize:8.5 }}>Live · SSE</span>
            </div>
          </div>

          {/* 3. Top Losers */}
          <div className="card" style={{ flex:1, minWidth:160 }}>
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

        </div>{/* end Row 2 */}

        {/* ── Row 3: News Feed | Options Flow ── */}
        <div style={{ display:"flex", gap:18, flexWrap:"wrap" }}>

          {/* ── NEWS FEED ── */}
          <div className="card" style={{ flex:1, minWidth:280, display:"flex", flexDirection:"column" }}>
            <SectionHeader title="News Feed" T={T}>
              {/* Live unread badge */}
              {newsBadge > 0 && (
                <span style={{ background:T.red, color:"#fff", borderRadius:8, padding:"1px 6px", fontSize:8.5, fontWeight:700, fontFamily:T.font, animation:"badge_pulse 1.8s ease-in-out infinite" }}>
                  {newsBadge > 99 ? "99+" : newsBadge} NEW
                </span>
              )}
              {[{ key:"ALL", label:"ALL" }, { key:"WATCHLIST", label:"★ WL" }].map(f => (
                <button key={f.key} className="btn-ghost" style={{ fontSize:9, padding:"4px 8px", background:newsFilter===f.key?T.cyan+"20":"transparent", color:newsFilter===f.key?T.cyan:T.text2, border:`1px solid ${newsFilter===f.key?T.cyan+"40":T.border}` }}
                  onClick={() => { setNewsFilter(f.key); setNewsBadge(0); }}>{f.label}</button>
              ))}
            </SectionHeader>
            <div style={{ flex:1, overflowY:"auto", maxHeight:260 }}>
              {newsLoading ? (
                Array(5).fill(0).map((_,i) => (
                  <div key={i} style={{ padding:"10px 14px", borderBottom:`1px solid ${T.border}`, display:"flex", flexDirection:"column", gap:6 }}>
                    <Shimmer w={260} h={10}/><Shimmer w={120} h={9} opacity={0.4}/>
                  </div>
                ))
              ) : news.length === 0 ? (
                <div style={{ padding:"32px 14px", textAlign:"center" }}>
                  <div style={{ fontSize:20, marginBottom:8 }}>📰</div>
                  <div style={{ color:T.text2, fontFamily:T.font, fontSize:11 }}>No news loaded</div>
                  <div style={{ color:T.text2, fontFamily:T.font, fontSize:9, marginTop:4, opacity:0.6 }}>Set POLYGON_API_KEY in backend env vars to enable live headlines</div>
                </div>
              ) : (() => {
                const wlSet = watchlist instanceof Set ? watchlist : new Set(watchlist);
                const filtered = newsFilter === "WATCHLIST"
                  ? news.filter(n => (n.tickers ?? []).some(tk => wlSet.has(tk)))
                  : news;
                if (filtered.length === 0) return <EmptyState icon="★" label="NO WATCHLIST NEWS" sub="No headlines found for your watchlist tickers" h={120} T={T}/>;
                return filtered.slice(0, 10).map((item, i) => {
                  const age = (() => {
                    const diff = Date.now() - new Date(item.published_utc).getTime();
                    const m = Math.floor(diff / 60000);
                    if (m < 60) return `${m}m ago`;
                    const h = Math.floor(m / 60);
                    return h < 24 ? `${h}h ago` : `${Math.floor(h/24)}d ago`;
                  })();
                  const relTickers = (item.tickers ?? []).filter(tk => wlSet.has(tk));
                  const colorMap = { green:T.green, red:T.red, gold:T.gold, cyan:T.cyan, purple:T.purple };
                  const accentColor = item._live ? (colorMap[item._color] ?? T.cyan) : null;
                  return (
                    <a key={i} href={item.article_url ?? "#"} target="_blank" rel="noopener noreferrer"
                      style={{ display:"block", padding:"10px 14px", borderBottom:i<filtered.length-1?`1px solid ${T.border}`:"none", textDecoration:"none", transition:"background 0.15s", borderLeft: accentColor ? `3px solid ${accentColor}` : "3px solid transparent" }}
                      onMouseEnter={e => e.currentTarget.style.background = T.bg2}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:8, marginBottom:4 }}>
                        {item._live && <span style={{ fontSize:13, flexShrink:0 }}>{item._emoji}</span>}
                        <span style={{ color:accentColor??T.text0, fontSize:11, fontFamily:T.font, fontWeight:600, lineHeight:1.4, flex:1 }}>{item.title}</span>
                      </div>
                      <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                        {item._live && <span style={{ background:accentColor+"20", border:`1px solid ${accentColor}40`, borderRadius:3, padding:"1px 5px", color:accentColor, fontFamily:T.font, fontSize:8, fontWeight:700 }}>LIVE</span>}
                        <span style={{ color:T.text3, fontSize:9, fontFamily:T.font }}>{item.publisher?.name ?? "—"}</span>
                        <span style={{ color:T.text3, fontSize:9, fontFamily:T.font }}>·</span>
                        <span style={{ color:T.text3, fontSize:9, fontFamily:T.font }}>{age}</span>
                        {relTickers.map(tk => (
                          <span key={tk} style={{ background:T.cyan+"18", border:`1px solid ${T.cyan}35`, borderRadius:3, padding:"1px 5px", color:T.cyan, fontFamily:T.font, fontSize:8, fontWeight:700 }}>{tk}</span>
                        ))}
                        {(item.tickers ?? []).filter(tk => !wlSet.has(tk)).slice(0,3).map(tk => (
                          <span key={tk} style={{ background:T.bg2, border:`1px solid ${T.border}`, borderRadius:3, padding:"1px 5px", color:T.text2, fontFamily:T.font, fontSize:8 }}>{tk}</span>
                        ))}
                      </div>
                    </a>
                  );
                });
              })()}
            </div>
            <div style={{ padding:"6px 14px", borderTop:`1px solid ${T.border}`, display:"flex", justifyContent:"space-between", flexShrink:0 }}>
              <span style={{ color:T.text3, fontSize:8.5, fontFamily:T.font }}>Polygon.io · market news</span>
              <span style={{ color:T.text3, fontSize:8.5, fontFamily:T.font }}>15-min delay</span>
            </div>
          </div>

          {/* ── OPTIONS FLOW ── */}
          <div className="card" style={{ flex:1, minWidth:280, display:"flex", flexDirection:"column" }}>
            <SectionHeader title="Options Flow" T={T}>
              {[{ key:"ALL",label:"ALL",color:T.cyan },{ key:"CALLS",label:"CALLS",color:T.green },{ key:"PUTS",label:"PUTS",color:T.red },{ key:"SWEEP",label:"⚡ SWEEP",color:T.gold }].map(f => (
                <button key={f.key} className="btn-ghost" style={{ fontSize:9, padding:"4px 8px", background:optionsFilter===f.key?f.color+"20":"transparent", color:optionsFilter===f.key?f.color:T.text2, border:`1px solid ${optionsFilter===f.key?f.color+"40":T.border}` }} onClick={() => setOptionsFilter(f.key)}>{f.label}</button>
              ))}
            </SectionHeader>
            {/* Column headers */}
            <div style={{ display:"grid", gridTemplateColumns:"56px 44px 52px 52px 1fr 48px", gap:4, padding:"6px 14px", borderBottom:`1px solid ${T.border}`, fontSize:8.5, fontFamily:T.font, fontWeight:700, color:T.text2, textTransform:"uppercase", letterSpacing:0.5 }}>
              <span>TICKER</span><span>TYPE</span><span>STRIKE</span><span>EXP</span><span style={{ textAlign:"right" }}>PREMIUM</span><span style={{ textAlign:"right" }}>SIZE</span>
            </div>
            <div style={{ flex:1, overflowY:"auto", maxHeight:220 }}>
              {optionsLoading ? (
                Array(5).fill(0).map((_,i) => (
                  <div key={i} style={{ display:"grid", gridTemplateColumns:"56px 44px 52px 52px 1fr 48px", gap:4, padding:"9px 14px", borderBottom:`1px solid ${T.border}`, alignItems:"center" }}>
                    <Shimmer w={36} h={11}/><Shimmer w={30} h={10}/><Shimmer w={40} h={10}/><Shimmer w={40} h={10}/><Shimmer w={60} h={11} opacity={0.5}/><Shimmer w={30} h={10} opacity={0.4}/>
                  </div>
                ))
              ) : (() => {
                let rows = [...optionsFlow];
                if (optionsFilter === "CALLS")  rows = rows.filter(r => r.type === "CALL");
                if (optionsFilter === "PUTS")   rows = rows.filter(r => r.type === "PUT");
                if (optionsFilter === "SWEEP")  rows = rows.filter(r => r.sweep);
                if (rows.length === 0) return (
                  <div style={{ padding:'20px 14px', textAlign:'center' }}>
                    <EmptyState icon="◈" label="NO FLOW DATA" sub={optionsMessage || "No unusual options activity"} h={80} T={T}/>
                    {optionsMessage && (
                      <div style={{ marginTop:8, padding:'8px 12px', background:T.gold+'10', border:`1px solid ${T.gold}30`, borderRadius:6 }}>
                        <span style={{ color:T.gold, fontSize:9.5, fontFamily:T.font }}>ℹ {optionsMessage}</span>
                      </div>
                    )}
                  </div>
                );
                return rows.map((r, i) => {
                  const isCall = r.type === "CALL";
                  const typeColor = isCall ? T.green : T.red;
                  const premStr = r.premium >= 1e6 ? `$${(r.premium/1e6).toFixed(2)}M` : `$${(r.premium/1e3).toFixed(0)}K`;
                  return (
                    <div key={i}
                      style={{ display:"grid", gridTemplateColumns:"56px 44px 52px 52px 1fr 48px", gap:4, padding:"9px 14px", borderBottom:i<rows.length-1?`1px solid ${T.border}`:"none", alignItems:"center", transition:"background 0.15s" }}
                      onMouseEnter={e => e.currentTarget.style.background = T.bg2}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                      <div style={{ display:"flex", alignItems:"center", gap:5 }}>
                        <span style={{ color:T.text0, fontSize:12, fontFamily:T.font, fontWeight:700 }}>{r.ticker}</span>
                        {r.sweep && <span style={{ color:T.gold, fontSize:10 }}>⚡</span>}
                      </div>
                      <span style={{ background:typeColor+"18", border:`1px solid ${typeColor}35`, borderRadius:3, padding:"2px 5px", color:typeColor, fontFamily:T.font, fontSize:8.5, fontWeight:700, width:"fit-content" }}>{r.type}</span>
                      <span style={{ color:T.text1, fontSize:11, fontFamily:T.font }}>${r.strike}</span>
                      <span style={{ color:T.text2, fontSize:10, fontFamily:T.font }}>{r.expiry}</span>
                      <span style={{ color:T.gold, fontSize:11, fontFamily:T.font, fontWeight:700, textAlign:"right" }}>{premStr}</span>
                      <span style={{ color:T.text2, fontSize:10, fontFamily:T.font, textAlign:"right" }}>{r.size.toLocaleString()}</span>
                    </div>
                  );
                });
              })()}
            </div>
            <div style={{ padding:"6px 14px", borderTop:`1px solid ${T.border}`, display:"flex", justifyContent:"space-between", flexShrink:0 }}>
              <span style={{ color:T.text3, fontSize:8.5, fontFamily:T.font }}>Unusual activity · premium ≥ $500K</span>
              <span style={{ color:T.text3, fontSize:8.5, fontFamily:T.font }}>Polygon Starter+ required</span>
            </div>
          </div>

        </div>{/* end Row 3 */}

      </div>{/* end left column */}

      {/* ── RIGHT COLUMN ── */}
      {/* MOBILE-FIX-v2: minWidth reduced from 260→200 so flex-wrap triggers
          on phones. Both columns have minWidth > 50% viewport → forces wrap. */}
      <div style={{ flex:1, minWidth:200, display:"flex", flexDirection:"column", gap:18 }}>

        {/* Row 1: Scalp Signals */}
        <div className="card" style={{ flex:"0 0 auto", minWidth:200, display:"flex", flexDirection:"column" }}>
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
                // Dark pool: rvol >= 5× but price barely moved (< 0.3%) — institutional stealth
                const liveTicker = tickers.get(row.ticker);
                const liveChgPct = Math.abs(liveTicker?.percent_change ?? 0);
                const isDarkPool = (row.rvol ?? 0) >= 5 && liveChgPct < 0.3;
                if (!isInst && !highRvol && !highScore && !bbAlert && !isDarkPool) return;
                const isBullish = row.score > 0 || isAccum || row.trend === "Bullish" || row.rsi_signal === "Oversold";
                const isBearish = row.score < 0 || isDist  || row.trend === "Bearish" || row.rsi_signal === "Overbought";
                const direction = isBullish && !isBearish ? "LONG" : isBearish && !isBullish ? "SHORT" : row.score >= 0 ? "LONG" : "SHORT";
                const tags = [];
                if (isDarkPool) tags.push({ label:"🌑 DARK POOL", color:"#9c6ee8", priority:0 });
                if (isInst) tags.push({ label:isAccum?"🐋 ACCUM":"🔻 DIST", color:isAccum?T.purple:T.orange, priority:1 });
                if (highRvol) tags.push({ label:`⚡ ${row.rvol?.toFixed(1)}x VOL`, color:T.gold, priority:2 });
                if (highScore) tags.push({ label:`◈ ${row.score>0?"+":""}${row.score} SCORE`, color:row.score>=3?T.green:T.red, priority:3 });
                if (bbAlert) tags.push({ label:"⚠ BB EXT", color:T.orange, priority:4 });
                alerts.push({ ticker:row.ticker, price:row.price, direction, isInst, isDarkPool, tags, score:row.score??0, rvol:row.rvol??0, priority:Math.min(...tags.map(t=>t.priority)) });
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

        {/* Row 2+: Earnings Today */}
        <div className="card" style={{ flex:"1 1 0", minHeight:0, display:"flex", flexDirection:"column" }}>
          <SectionHeader title="Earnings Today" T={T}>
            {earningsBadge > 0 && (
              <span style={{ background:T.gold, color:"#000", borderRadius:8, padding:"1px 6px", fontSize:8.5, fontWeight:700, fontFamily:T.font, animation:"badge_pulse 1.8s ease-in-out infinite" }}
                onClick={() => setEarningsBadge(0)}>
                ⚡ {earningsBadge} NEW
              </span>
            )}
            <button className="btn-ghost" style={{ fontSize:8 }} onClick={() => onNavigate("earnings")}>VIEW ALL</button>
          </SectionHeader>
          <div style={{ padding:"8px 14px", flex:1, overflowY:"auto", minHeight:0 }}>
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

      </div>{/* end right column */}

    </div>
  );
}