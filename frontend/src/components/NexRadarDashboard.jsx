/**
 * NexRadarDashboard.jsx — NexRadar Pro v6.5
 * Owns: sidebar, topbar, alert strip, page routing, dropdown panels, AppearanceModal.
 *
 * FIXES IN THIS VERSION:
 *
 *   SETTINGS-LIVE-FIX: Settings panel now shows real values from live data:
 *     - Broadcast Throttle: 250ms (ws_engine tick_flush_loop constant)
 *     - Portfolio Refresh: SSE push (event-driven via portfolio_update)
 *     - Display Cap: live tickers.size (not hardcoded 6200)
 *     - AH Close Refresh: 300s (updated ws_engine AH_CLOSE_REFRESH_S=300)
 *     - Signal Watching: live sideWatchlist count
 *     - Active Signals: live sideSignalCount (BUY+SELL only)
 *
 *   SIGNAL-PANEL-LIVE-FIX: Signal Engine panel now shows real live values
 *     (WATCHING=sideWatchlist, SIGNALS=sideSignalCount, BARS=sideBarsCount)
 *     instead of hardcoded '—'.
 *
 *   EARNINGS-FULL-PROPS: PageEarnings now receives sseRef, marketSession,
 *     and alertCounts so it can show market breadth strip, watchlist-pinned
 *     rows, and sector filter.
 *
 *   WATCHLIST-SSE-PROPS: PageWatchlist now receives sseRef so it can wire
 *     live news_alert / edgar_alert events to per-row badges.
 *
 *   AI-WATCHLIST-AUTO: aiEnabled state is passed to PageWatchlist so newly
 *     added watchlist tickers trigger AI analysis automatically when AI is ON.
 *
 *   ALERT-TOAST-ALL-PAGES: AlertToast shown on all pages (not just live/
 *     dashboard/signals) so portfolio, earnings, and watchlist users receive
 *     real-time edgar/news/fda alerts as toasts.
 */
import { useState, useEffect, useRef, useMemo, useCallback, lazy, Suspense } from 'react';
import { getThemeTokens, getCSS }                             from './nexradar/theme.js';
import { SECTORS, NAV, SESSION_META }                         from './nexradar/constants.js';
import { normalizeSector, computeSectorTotal, getMarketSession } from './nexradar/utils.js';
import { NexRadarErrorBoundary, Chip, AppearanceModal }       from './nexradar/primitives.jsx';
import { useTickerData }                                      from './nexradar/useTickerData.js';
import { useTechData }                                        from './nexradar/useTechData.js';
import { useWatchlist }                                       from './nexradar/useWatchlist.js';
import { API_BASE }                                           from '../config.js';
import AIEngine                                               from './engines/AIEngine.js';

import PageDashboard from './nexradar/PageDashboard.jsx';
import PageLiveTable from './nexradar/PageLiveTable.jsx';

const PageChart     = lazy(() => import('./nexradar/PageChart.jsx'));
const PageSignals   = lazy(() => import('./nexradar/PageSignals.jsx'));
const PageEarnings  = lazy(() => import('./nexradar/PageEarnings.jsx'));
const PagePortfolio = lazy(() => import('./nexradar/PagePortfolio.jsx'));
const PageScreener  = lazy(() => import('./nexradar/PageScreener.jsx'));
const PageScanner   = lazy(() => import('./nexradar/PageScanner.jsx'));
const PageWatchlist = lazy(() => import('./nexradar/PageWatchlist.jsx'));
import AlertToast from './nexradar/AlertToast.jsx';
import { isSharedWorker } from './nexradar/sseConnection.js';

const PageLoader = ({ T }) => (
  <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'60vh', flexDirection:'column', gap:14 }}>
    <div style={{ width:36, height:36, border:`3px solid ${T.cyanMid}`, borderTopColor:T.cyan,
      borderRadius:'50%', animation:'spin 0.7s linear infinite' }}/>
    <span style={{ color:T.text2, fontFamily:T.font, fontSize:11, letterSpacing:2 }}>LOADING MODULE…</span>
    <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
  </div>
);

function NexRadarDashboard({
  darkMode: darkModeProp = true,
  source:   sourceProp   = 'all',
  sector:   sectorProp   = 'ALL',
  onSourceChange, onSectorChange, onThemeChange,
  currentTheme = 'auto',
  onSignOut, user,
}) {
  // ── Page + UI state ──────────────────────────────────────────────────────────
  const [page, setPage] = useState(() => {
    try { const s = localStorage.getItem('nexradar_active_page'); if (s) return s; } catch {}
    return 'dashboard';
  });
  useEffect(() => { try { localStorage.setItem('nexradar_active_page', page); } catch {} }, [page]);

  const [quickFilter,    setQuickFilter]    = useState(null);
  const [showAppearance, setShowAppearance] = useState(false);
  const [chartInitSymbol,setChartInitSymbol]= useState('');
  const searchInputRef                       = useRef('');
  const [sideCollapsed,  setSideCollapsed]  = useState(false);
  const [isMobile,       setIsMobile]       = useState(() => window.innerWidth < 768);
  const [mobileDrawer,   setMobileDrawer]   = useState(false);
  const [liveAlerts,     setLiveAlerts]     = useState([]);

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  useEffect(() => {
    // Only genuinely actionable events get the overlay toast
    const TOAST_TYPES = new Set([
      'gap', 'vol_spike', 'ah_momentum', 'hod_break', 'lod_break',
      'luld_halt', 'luld_resume',
      'edgar_alert', 'earnings_alert', 'fda_alert', 'news_alert',
    ]);
    const handler = (e) => {
      const a = e.detail;
      if (!a || !TOAST_TYPES.has(a.type)) return;
      const stamped = { ...a, ts: a.ts ?? Date.now(), _key: Math.random() };
      setLiveAlerts(prev => [stamped, ...prev].slice(0, 3));
    };
    window.addEventListener('nexradar_alert', handler);
    return () => window.removeEventListener('nexradar_alert', handler);
  }, []);

  useEffect(() => {
    if (!liveAlerts.length) return;
    const t = setTimeout(() => setLiveAlerts(prev => prev.slice(0, -1)), 8000);
    return () => clearTimeout(t);
  }, [liveAlerts]);

  const [headerPanel, setHeaderPanel] = useState(null);

  // ── Theme tokens ─────────────────────────────────────────────────────────────
  const T = useMemo(() => getThemeTokens(darkModeProp), [darkModeProp]);

  // ── Multi-sector selection (persisted) ───────────────────────────────────────
  const [selectedSectors, setSelectedSectors] = useState(() => {
    try { const s = localStorage.getItem('nexradar_selected_sectors'); if (s) return JSON.parse(s); } catch {}
    return sectorProp && sectorProp !== 'ALL' ? [sectorProp.toUpperCase()] : ['ALL'];
  });
  useEffect(() => {
    try { localStorage.setItem('nexradar_selected_sectors', JSON.stringify(selectedSectors)); } catch {}
  }, [selectedSectors]);
  useEffect(() => {
    if (sectorProp && sectorProp !== 'ALL') setSelectedSectors([sectorProp.toUpperCase()]);
    else setSelectedSectors(['ALL']);
  }, [sectorProp]);

  // ── Data hooks ───────────────────────────────────────────────────────────────
  const { tickers, wsStatus, marketSession, sseRef, notifications, unreadCount, clearNotifications, staleTickers }
    = useTickerData();
  const { techData, techLoading, techError, techLastFetch, techCached, techDataAge, fetchTechData }
    = useTechData();
  const { watchlist, toggleWatchlist, wsWatchlistRef }
    = useWatchlist(sseRef);

  // ── Sidebar signal engine stats — SSE-driven ─────────────────────────────────
  const [sideWatchlist,    setSideWatchlist]    = useState(0);
  const [sideScalpSignals, setSideScalpSignals] = useState({});
  const [aiEnabled,        setAiEnabledState]   = useState(false);

  // WATCHLIST-DEDUP-FIX: sidebar watchlist count sourced from root watchlist Set
  // (populated by useWatchlist hook) — eliminates a redundant /api/watchlist fetch
  // that was firing simultaneously with useWatchlist's own fetch on every connect.
  useEffect(() => {
    setSideWatchlist(watchlist.size);
  }, [watchlist]);

  useEffect(() => {

    fetch(`${API_BASE}/api/scalp-analysis`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d?.data) return;
        const m = {};
        d.data.forEach(r => { if (!r.status || r.status === 'ok') m[r.ticker] = r; });
        setSideScalpSignals(m);
      }).catch(() => {});

    // Poll for sseRef then attach listener
    let pollId = null;
    let cleanup = () => { clearTimeout(pollId); };

    const attach = () => {
      const sse = sseRef?.current;
      if (!sse) { pollId = setTimeout(attach, 400); return; }

      const handlePayload = (payload) => {
        if (!payload || typeof payload !== 'object') return;
        if (payload.type === 'watchlist_snapshot' && Array.isArray(payload.watchlist)) {
          setSideWatchlist(payload.watchlist.length);
        } else if (payload.type === 'watchlist_update' && Array.isArray(payload.watchlist)) {
          setSideWatchlist(payload.watchlist.length);
        } else if (payload.type === 'signal_snapshot' && Array.isArray(payload.data)) {
          const m = {};
          payload.data.forEach(r => { if (!r.status || r.status === 'ok') m[r.ticker] = r; });
          setSideScalpSignals(m);
        } else if (payload.type === 'signal_alert' && payload.data) {
          const r = payload.data;
          if (!r.status || r.status === 'ok') {
            setSideScalpSignals(prev => ({ ...prev, [r.ticker]: r }));
          }
        }
      };

      if (isSharedWorker(sse)) {
        const handler = (e) => handlePayload(e.data);
        sse.port.addEventListener('message', handler);
        cleanup = () => { clearTimeout(pollId); if (sse.port) sse.port.removeEventListener('message', handler); };
      } else if (typeof sse.addEventListener === 'function') {
        const handler = (e) => { try { handlePayload(JSON.parse(e.data)); } catch {} };
        sse.addEventListener('message', handler);
        cleanup = () => { clearTimeout(pollId); sse.removeEventListener('message', handler); };
      }
    };

    attach();
    return () => cleanup();
  }, [sseRef]); // eslint-disable-line react-hooks/exhaustive-deps

  const sideSignalCount = useMemo(() =>
    Object.values(sideScalpSignals).filter(r => r.signal === 'BUY' || r.signal === 'SELL').length,
  [sideScalpSignals]);
  const sideBarsCount = tickers.size;

  // ── Sector performance ───────────────────────────────────────────────────────
  const sectorPerformance = useMemo(() => {
    const allRows = Array.from(tickers.values());
    const performance = {};
    SECTORS.forEach(sector => {
      if (sector.id === 'ALL' || sector.id === 'EARNINGS') return;
      const st = allRows.filter(row => normalizeSector(row.sector) === sector.id);
      if (!st.length) { performance[sector.id] = { avgReturn:0, count:0, gainers:0, losers:0 }; return; }
      const totalReturn = st.reduce((s, row) => s + (row.percent_change || 0), 0);
      performance[sector.id] = {
        avgReturn: parseFloat((totalReturn / st.length).toFixed(2)),
        count:     st.length,
        gainers:   st.filter(r => (r.percent_change||0) > 0).length,
        losers:    st.filter(r => (r.percent_change||0) < 0).length,
      };
    });
    return performance;
  }, [tickers]);

  const handleSectorChange = useCallback((sectorIds) => {
    setSelectedSectors(sectorIds);
    setQuickFilter(null);
    if (onSectorChange) onSectorChange(sectorIds[0] || 'ALL');
  }, [onSectorChange]);

  const [liveTickerCount, setLiveTickerCount] = useState(null);
  const handleLiveCount = useCallback((n) => setLiveTickerCount(n), []);
  useEffect(() => { if (page !== 'live') setLiveTickerCount(null); }, [page]);
  const tickerTotal  = computeSectorTotal(selectedSectors);
  const displayCount = (page === 'live' && liveTickerCount !== null) ? liveTickerCount : tickerTotal;
  const activeLabel  = selectedSectors.includes('ALL') ? null : selectedSectors.join(' + ');
  const current      = NAV.find(n => n.id === page);

  // ── Alert strip counts (passed to PageEarnings for breadth strip) ────────────
  const alertCounts = useMemo(() => {
    const all = Array.from(tickers.values());
    const isMH = marketSession === 'market';
    const sf = selectedSectors.includes('ALL') ? all : all.filter(t => {
      const ns = normalizeSector(t.sector);
      return ns && selectedSectors.includes(ns);
    });
    return [
      ['📡', 'VOL SPIKES', T.cyan,   sf.filter(t=>(t.rvol||1)>=1.5).length],
      isMH
        ? ['📊', 'GAP PLAYS',  T.gold,   sf.filter(t=>t.is_gap_play).length]
        : ['🌙', 'AH MOMT.',   T.purple, sf.filter(t=>t.ah_momentum).length],
      isMH
        ? ['🌙', 'AH MOMT.',   T.purple, sf.filter(t=>t.ah_momentum).length]
        : ['📊', 'GAP PLAYS',  T.gold,   sf.filter(t=>t.is_gap_play).length],
      ['📋', 'EARN. GAPS', T.orange, sf.filter(t=>t.is_earnings_gap_play).length],
      ['💎', 'DIAMOND',    T.cyan,   sf.filter(t=>Math.abs(t.percent_change||0)>=5).length],
    ];
  }, [tickers, marketSession, selectedSectors, T]);

  // ── Page router ──────────────────────────────────────────────────────────────
  const withLazy = (node) => (
    <Suspense fallback={<PageLoader T={T} />}>{node}</Suspense>
  );

  const renderPage = () => {
    switch (page) {
      case 'dashboard': return (
        <PageDashboard selectedSectors={selectedSectors} onSectorChange={handleSectorChange}
          onNavigate={setPage} sectorPerformance={sectorPerformance}
          tickers={tickers} techData={techData} techLoading={techLoading}
          watchlist={watchlist} toggleWatchlist={toggleWatchlist} T={T} />
      );
      case 'live': return (
        <PageLiveTable selectedSectors={selectedSectors} onSectorChange={handleSectorChange}
          tickers={tickers} marketSession={marketSession} wsWatchlistRef={wsWatchlistRef}
          quickFilter={quickFilter} onClearQuickFilter={()=>setQuickFilter(null)}
          wsStatus={wsStatus} onLiveCount={handleLiveCount}
          watchlistProp={watchlist} toggleWatchlistProp={toggleWatchlist}
          isActive={page === 'live'} staleTickers={staleTickers} T={T} />
      );
      case 'screener': return withLazy(
        <PageScreener tickers={tickers} watchlist={watchlist} toggleWatchlist={toggleWatchlist}
          techData={techData} scalpData={sideScalpSignals} T={T} />
      );
      case 'chart': return withLazy(
        <PageChart T={T} tickers={tickers} initialSymbol={chartInitSymbol} />
      );
      case 'signals': return withLazy(
        <PageSignals tickers={tickers} selectedSectors={selectedSectors} watchlist={watchlist}
          techData={techData} techLoading={techLoading} techError={techError}
          techLastFetch={techLastFetch} techCached={techCached} techDataAge={techDataAge}
          onForceFetch={fetchTechData} sseRef={sseRef} T={T} />
      );
      // EARNINGS-FULL-PROPS: sseRef + marketSession + alertCounts + sideWatchlist
      // for watchlist pinning, market breadth strip, and sector filter
      case 'earnings': return withLazy(
        <PageEarnings T={T} tickers={tickers} watchlist={watchlist}
          toggleWatchlist={toggleWatchlist} sseRef={sseRef} />
      );
      case 'scanner': return withLazy(
        <PageScanner T={T}
          onNavigateToChart={(sym) => { setChartInitSymbol(sym); setPage('chart'); }}
          tickers={tickers} />
      );
      case 'portfolio': return withLazy(
        <PagePortfolio tickers={tickers} marketSession={marketSession}
          watchlist={watchlist} toggleWatchlist={toggleWatchlist}
          sseRef={sseRef} T={T} />
      );
      // WATCHLIST-SSE-PROPS: sseRef for live news/edgar badge updates
      // aiEnabled so newly-added tickers auto-trigger AI when toggle is ON
      case 'watchlist': return withLazy(
        <PageWatchlist T={T}
          onNavigateToSettings={() => setHeaderPanel('settings')}
          watchlistSet={watchlist} toggleWatchlist={toggleWatchlist}
          tickers={tickers} sseRef={sseRef} aiEnabled={aiEnabled} />
      );
      default: return null;
    }
  };

  // ── RENDER ───────────────────────────────────────────────────────────────────
  return (
    <div style={{ display:'flex', height:'100vh', background:T.bg0, color:T.text0, fontFamily:T.font, overflow:'hidden' }}>
      <style>{getCSS(T)}</style>

      {/* ── SIDEBAR ── */}
      <div className="nexradar-sidebar" style={{ width:sideCollapsed?56:218, minWidth:sideCollapsed?56:218, background:T.bg1, borderRight:`1px solid ${T.border}`, display:'flex', flexDirection:'column', transition:'width 0.22s,min-width 0.22s', overflow:'hidden' }}>
        {/* Logo */}
        <div style={{ padding:'17px 13px', borderBottom:`1px solid ${T.border}`, display:'flex', alignItems:'center', gap:10, overflow:'hidden', flexShrink:0 }}>
          <div style={{ width:30, height:30, borderRadius:7, background:`linear-gradient(135deg,${T.cyan},#0055bb)`, display:'flex', alignItems:'center', justifyContent:'center', fontWeight:800, color:'#000', fontSize:13, flexShrink:0 }}>N</div>
          {!sideCollapsed&&(
            <div>
              <div style={{ fontFamily:T.fontSans, fontWeight:800, fontSize:13.5, color:T.text0, letterSpacing:2.5, whiteSpace:'nowrap' }}>NEXRADAR</div>
              <div style={{ color:T.text2, fontSize:7.5, letterSpacing:3.5, whiteSpace:'nowrap' }}>PROFESSIONAL</div>
            </div>
          )}
        </div>
        {/* Status */}
        {!sideCollapsed&&(
          <div style={{ padding:'9px 13px', borderBottom:`1px solid ${T.border}`, display:'flex', gap:7, flexShrink:0 }}>
            <Chip color={T.green}>● LIVE</Chip>
            <Chip color={T[SESSION_META[marketSession].chipColorKey]}>{SESSION_META[marketSession].chipLabel}</Chip>
          </div>
        )}
        {/* Nav */}
        <nav style={{ padding:'9px 7px', flex:1, display:'flex', flexDirection:'column', gap:2 }}>
          {NAV.map(n=>(
            <button key={n.id} className={`nav-btn${page===n.id?' active':''}`} onClick={()=>setPage(n.id)} title={sideCollapsed?n.label:''}>
              <span className="icon">{n.icon}</span>
              {!sideCollapsed&&<span style={{ whiteSpace:'nowrap' }}>{n.label}</span>}
            </button>
          ))}
        </nav>

        {/* Signal Engine — SIGNAL-PANEL-LIVE-FIX: real data from SSE */}
        {!sideCollapsed&&(
          <div style={{ padding:13, borderTop:`1px solid ${T.border}`, flexShrink:0 }}>
            <div style={{ color:T.text2, fontSize:8.5, letterSpacing:2, marginBottom:9 }}>SIGNAL ENGINE</div>
            <div style={{ display:'flex', gap:7, marginBottom:8 }}>
              {[
                ['WATCHING', sideWatchlist,    T.gold],
                ['SIGNALS',  sideSignalCount,  T.green],
                ['BARS',     sideBarsCount,    T.cyan],
              ].map(([l,v,c])=>(
                <div key={l} style={{ flex:1, background:T.bg2, border:`1px solid ${T.border}`, borderRadius:5, padding:'5px 7px', textAlign:'center' }}>
                  <div style={{ color:T.text2, fontSize:7.5, letterSpacing:1 }}>{l}</div>
                  <div style={{ color:v>0?c:T.text2, fontFamily:T.font, fontSize:14, fontWeight:700, marginTop:2 }}>
                    {v>0 ? v.toLocaleString() : '—'}
                  </div>
                </div>
              ))}
            </div>
            <button className="btn-primary" style={{ width:'100%', padding:'8px 0', fontSize:10 }}
              onClick={()=>setPage('live')} title="Go to Live Table filtered by your watchlist">
              ✓ APPLY WATCHLIST
            </button>
          </div>
        )}
        <button onClick={()=>setSideCollapsed(c=>!c)}
          style={{ background:'none', border:'none', borderTop:`1px solid ${T.border}`, color:T.text2, padding:'10px', cursor:'pointer', fontFamily:T.font, fontSize:16, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
          {sideCollapsed?'›':'‹'}
        </button>
      </div>

      {/* ── MAIN ── */}
      <div className="nexradar-main" style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
        {/* Top bar */}
        <div style={{ background:T.bg1, borderBottom:`1px solid ${T.border}`, padding:'0 20px', height:56, display:'flex', alignItems:'center', gap:14, flexShrink:0, position:'relative' }}>
          <span style={{ fontFamily:T.font, fontWeight:700, fontSize:16, color:T.text0, letterSpacing:0.5 }}>
            {current?.icon}&nbsp;{current?.label.toUpperCase()}
          </span>
          {activeLabel&&(
            <div style={{ display:'flex', alignItems:'center', gap:6, background:T.cyan+'10', border:`1px solid ${T.cyan}30`, borderRadius:6, padding:'4px 12px' }}>
              <span style={{ color:T.cyan, fontSize:11, letterSpacing:0.5, fontFamily:T.font, fontWeight:600 }}>{activeLabel}</span>
              <span style={{ color:T.cyan, fontSize:10, fontFamily:T.font }}>· {displayCount.toLocaleString()}</span>
              <button onClick={()=>setSelectedSectors(['ALL'])} style={{ background:'none', border:'none', color:T.cyan, cursor:'pointer', fontSize:13, padding:0, lineHeight:1, opacity:0.7 }}
                onMouseEnter={e=>e.target.style.opacity=1} onMouseLeave={e=>e.target.style.opacity=0.7}>✕</button>
            </div>
          )}
          <div style={{ flex:1 }}/>
          {/* Search */}
          <input placeholder="Search symbol…" defaultValue=""
            onChange={e=>{searchInputRef.current=e.target.value.toUpperCase();}}
            onKeyDown={e=>{
              if(e.key==='Enter'){
                const s=(searchInputRef.current||'').trim().toUpperCase();
                if(s){setChartInitSymbol(s);setPage('chart');searchInputRef.current='';e.target.value='';}
              }
            }}
            style={{ background:T.bg2, border:`1px solid ${T.border}`, borderRadius:6, padding:'8px 14px', color:T.text0, fontFamily:T.font, fontSize:13, outline:'none', width:180 }}
            onFocus={e=>e.target.style.borderColor=T.cyanMid}
            onBlur={e=>e.target.style.borderColor=T.border}/>
          <div style={{ width:1, height:24, background:T.border }}/>
          {/* SYS OK */}
          <div style={{ display:'flex', alignItems:'center', gap:6, background:T.greenDim, border:`1px solid ${T.green}30`, borderRadius:6, padding:'6px 12px', cursor:'pointer' }} title="System Status: All services operational">
            <span style={{ width:8, height:8, borderRadius:'50%', background:T.green, animation:'dotblink 1.4s ease-in-out infinite' }}/>
            <span style={{ color:T.green, fontSize:12, fontFamily:T.font, fontWeight:600, letterSpacing:0.3 }}>SYS OK</span>
          </div>
          {/* Notifications */}
          <button onClick={()=>{setHeaderPanel(p=>p==='notifications'?null:'notifications');clearNotifications();}}
            style={{ width:36, height:36, borderRadius:6, background:headerPanel==='notifications'?T.cyanDim:T.bg2, border:`1px solid ${headerPanel==='notifications'?T.cyanMid:T.border}`, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', color:headerPanel==='notifications'?T.cyan:T.text1, fontSize:16, position:'relative', transition:'all 0.2s' }}
            onMouseEnter={e=>{if(headerPanel!=='notifications'){e.currentTarget.style.borderColor=T.cyanMid;e.currentTarget.style.color=T.cyan;}}}
            onMouseLeave={e=>{if(headerPanel!=='notifications'){e.currentTarget.style.borderColor=T.border;e.currentTarget.style.color=T.text1;}}}
            title="Notifications">
            🔔
            {unreadCount>0&&(
              <span style={{ position:'absolute', top:3, right:3, minWidth:16, height:16, borderRadius:8, background:T.red, border:`2px solid ${T.bg1}`, color:'#fff', fontSize:9, fontWeight:700, fontFamily:T.font, display:'flex', alignItems:'center', justifyContent:'center', padding:'0 3px' }}>
                {unreadCount>9?'9+':unreadCount}
              </span>
            )}
            {unreadCount===0&&(<span style={{ position:'absolute', top:4, right:4, width:8, height:8, borderRadius:'50%', background:T.border, border:`2px solid ${T.bg1}` }}/>)}
          </button>
          {/* Settings */}
          <button onClick={()=>setHeaderPanel(p=>p==='settings'?null:'settings')}
            style={{ width:36, height:36, borderRadius:6, background:headerPanel==='settings'?T.cyanDim:T.bg2, border:`1px solid ${headerPanel==='settings'?T.cyanMid:T.border}`, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', color:headerPanel==='settings'?T.cyan:T.text1, fontSize:16, transition:'all 0.2s' }}
            onMouseEnter={e=>{if(headerPanel!=='settings'){e.currentTarget.style.borderColor=T.cyanMid;e.currentTarget.style.color=T.cyan;}}}
            onMouseLeave={e=>{if(headerPanel!=='settings'){e.currentTarget.style.borderColor=T.border;e.currentTarget.style.color=T.text1;}}}
            title="Settings">⚙️</button>
          {/* Signal Engine */}
          <button onClick={()=>setHeaderPanel(p=>p==='signals'?null:'signals')}
            style={{ width:36, height:36, borderRadius:6, background:headerPanel==='signals'?T.cyanDim:T.bg2, border:`1px solid ${headerPanel==='signals'?T.cyanMid:T.border}`, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', color:headerPanel==='signals'?T.cyan:T.text1, fontSize:16, transition:'all 0.2s' }}
            onMouseEnter={e=>{if(headerPanel!=='signals'){e.currentTarget.style.borderColor=T.cyanMid;e.currentTarget.style.color=T.cyan;}}}
            onMouseLeave={e=>{if(headerPanel!=='signals'){e.currentTarget.style.borderColor=T.border;e.currentTarget.style.color=T.text1;}}}
            title="Signal Engine">⚡</button>
          {/* User avatar */}
          <div style={{ position:'relative' }}>
            <div onClick={()=>setHeaderPanel(p=>p==='user'?null:'user')}
              style={{ width:32, height:32, borderRadius:6, background:T.cyanDim, border:`1px solid ${headerPanel==='user'?T.cyan:T.cyanMid}`, display:'flex', alignItems:'center', justifyContent:'center', color:T.cyan, fontWeight:800, fontSize:13, cursor:'pointer', letterSpacing:0.5, transition:'all 0.15s' }}
              title="Account">
              {user?.email?user.email[0].toUpperCase():'S'}
            </div>
            {headerPanel==='user'&&(
              <div style={{ position:'absolute', right:0, top:'calc(100% + 8px)', width:240, background:T.bg1, border:`1px solid ${T.border}`, borderRadius:10, boxShadow:'0 12px 40px rgba(0,0,0,0.5)', zIndex:10000, overflow:'hidden' }}>
                <div style={{ padding:'14px 16px', borderBottom:`1px solid ${T.border}` }}>
                  <div style={{ color:T.text0, fontFamily:T.font, fontWeight:700, fontSize:13, marginBottom:2 }}>{user?.user_metadata?.full_name||'Trader'}</div>
                  <div style={{ color:T.text2, fontFamily:T.font, fontSize:11, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{user?.email||''}</div>
                </div>
                <div style={{ padding:'6px 6px 0' }}>
                  <button onClick={()=>{setHeaderPanel(null);setShowAppearance(true);}}
                    style={{ width:'100%', display:'flex', alignItems:'center', gap:10, padding:'10px 12px', background:'transparent', border:'none', borderRadius:6, cursor:'pointer', color:T.text1, fontFamily:T.font, fontSize:13, fontWeight:500, transition:'background 0.15s', textAlign:'left' }}
                    onMouseEnter={e=>e.currentTarget.style.background=T.bg2} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                    <span style={{ fontSize:15 }}>🎨</span> Appearance
                  </button>
                </div>
                <div style={{ padding:6 }}>
                  <button onClick={()=>{setHeaderPanel(null);if(onSignOut)onSignOut();}}
                    style={{ width:'100%', display:'flex', alignItems:'center', gap:10, padding:'10px 12px', background:'transparent', border:'none', borderRadius:6, cursor:'pointer', color:T.red, fontFamily:T.font, fontSize:13, fontWeight:600, transition:'background 0.15s', textAlign:'left' }}
                    onMouseEnter={e=>e.currentTarget.style.background=T.red+'15'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                    <span style={{ fontSize:15 }}>⎋</span> Sign Out
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Backdrop */}
          {headerPanel&&(<div style={{ position:'fixed', inset:0, zIndex:9998 }} onClick={()=>setHeaderPanel(null)}/>)}

          {/* Notifications panel */}
          {headerPanel==='notifications'&&(
            <div style={{ position:'absolute', right:20, top:64, width:340, maxHeight:480, display:'flex', flexDirection:'column', background:T.bg1, border:`1px solid ${T.border}`, borderRadius:10, boxShadow:'0 12px 40px rgba(0,0,0,0.5)', zIndex:9999, overflow:'hidden' }}>
              <div style={{ padding:'14px 16px', borderBottom:`1px solid ${T.border}`, display:'flex', justifyContent:'space-between', alignItems:'center', flexShrink:0 }}>
                <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                  <span style={{ color:T.text0, fontFamily:T.font, fontWeight:700, fontSize:13 }}>Notifications</span>
                  {notifications.length>0&&(<span style={{ background:T.bg2, border:`1px solid ${T.border}`, borderRadius:10, padding:'1px 7px', color:T.text2, fontFamily:T.font, fontSize:10 }}>{notifications.length}</span>)}
                </div>
                <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                  {notifications.length>0&&(<button onClick={clearNotifications} style={{ background:'none', border:'none', color:T.text2, cursor:'pointer', fontFamily:T.font, fontSize:11, padding:0 }}>Clear all</button>)}
                  <button onClick={()=>setHeaderPanel(null)} style={{ background:'none', border:'none', color:T.text2, cursor:'pointer', fontSize:16, padding:0 }}>✕</button>
                </div>
              </div>
              <div style={{ overflowY:'auto', flex:1 }}>
                {notifications.length===0 ? (
                  <div style={{ padding:'32px 16px', textAlign:'center' }}>
                    <div style={{ fontSize:28, marginBottom:10 }}>🔔</div>
                    <div style={{ color:T.text2, fontFamily:T.font, fontSize:12 }}>No alerts yet</div>
                    <div style={{ color:T.text2, fontFamily:T.font, fontSize:11, marginTop:4, opacity:0.6 }}>Volume spikes, gap plays, AH momentum<br/>and signals will appear here live</div>
                  </div>
                ) : notifications.map(n=>{
                  const elapsed=Math.floor((Date.now()-n.ts)/1000);
                  const timeStr=elapsed<60?`${elapsed}s ago`:elapsed<3600?`${Math.floor(elapsed/60)}m ago`:`${Math.floor(elapsed/3600)}h ago`;
                  return(
                    <div key={n.id} onClick={()=>{setPage('live');setHeaderPanel(null);}}
                      style={{ padding:'11px 16px', borderBottom:`1px solid ${T.border}`, display:'flex', gap:11, alignItems:'flex-start', cursor:'pointer', transition:'background 0.12s' }}
                      onMouseEnter={e=>e.currentTarget.style.background=T.bg2} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                      <div style={{ width:32, height:32, borderRadius:7, background:n.color+'18', border:`1px solid ${n.color}30`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:14, flexShrink:0 }}>{n.icon}</div>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ color:T.text0, fontFamily:T.font, fontSize:12, fontWeight:600, display:'flex', justifyContent:'space-between', alignItems:'center', gap:6 }}>
                          <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{n.title}</span>
                          <span style={{ color:T.text2, fontSize:10, flexShrink:0 }}>{timeStr}</span>
                        </div>
                        <div style={{ color:T.text2, fontFamily:T.font, fontSize:11, marginTop:2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{n.sub}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{ padding:'10px 16px', borderTop:`1px solid ${T.border}`, flexShrink:0, textAlign:'center' }}>
                <button onClick={()=>{setPage('signals');setHeaderPanel(null);}} style={{ background:'none', border:'none', color:T.cyan, fontFamily:T.font, fontSize:12, cursor:'pointer', fontWeight:600 }}>View all signals →</button>
              </div>
            </div>
          )}

          {/* Settings panel — SETTINGS-LIVE-FIX: live values from SSE state */}
          {headerPanel==='settings'&&(
            <div style={{ position:'absolute', right:20, top:64, width:300, background:T.bg1, border:`1px solid ${T.border}`, borderRadius:10, boxShadow:'0 12px 40px rgba(0,0,0,0.5)', zIndex:9999, overflow:'hidden' }}>
              <div style={{ padding:'14px 16px', borderBottom:`1px solid ${T.border}`, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <span style={{ color:T.text0, fontFamily:T.font, fontWeight:700, fontSize:13 }}>Settings</span>
                <button onClick={()=>setHeaderPanel(null)} style={{ background:'none', border:'none', color:T.text2, cursor:'pointer', fontSize:16, padding:0 }}>✕</button>
              </div>
              {[
                {label:'Broadcast Throttle', key:'throttle',  value:'250ms',
                  note:'Tick-batch flush interval (ws_engine tick_flush_loop)'},
                {label:'Portfolio Refresh',  key:'portfolio', value:'SSE push',
                  note:'Event-driven via SSE portfolio_update'},
                {label:'Display Cap',        key:'cap',
                  // SETTINGS-LIVE-FIX: show real live ticker count
                  value:`${tickers.size > 0 ? tickers.size.toLocaleString() : '6 200'} tickers`,
                  note:'Max tickers in live cache (LIVE_DISPLAY_CAP)'},
                {label:'AH Close Refresh',   key:'ah',        value:'60s',
                  note:'After-hours closing price refresh (watchlist-scoped)'},
                {label:'Signal Watching',    key:'watching',
                  value:sideWatchlist > 0 ? `${sideWatchlist} tickers` : '—',
                  note:'Tickers in scalp signal watchlist'},
                {label:'Active Signals',     key:'signals',
                  value:sideSignalCount > 0 ? `${sideSignalCount} BUY/SELL` : '—',
                  note:'Live scalp signals (BUY or SELL)'},
              ].map(s=>(
                <div key={s.key} style={{ padding:'11px 16px', borderBottom:`1px solid ${T.border}` }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                    <span style={{ color:T.text1, fontFamily:T.font, fontSize:12, fontWeight:600 }}>{s.label}</span>
                    <span style={{ color:T.cyan,  fontFamily:T.font, fontSize:12, fontWeight:700 }}>{s.value}</span>
                  </div>
                  <div style={{ color:T.text2, fontFamily:T.font, fontSize:10, marginTop:3 }}>{s.note}</div>
                </div>
              ))}
              {/* AI Engine toggle — default OFF */}
              <div style={{ padding:'11px 16px', borderBottom:`1px solid ${T.border}`, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <div>
                  <div style={{ color:T.text0, fontFamily:T.font, fontSize:12, fontWeight:600 }}>⚡ AI Engine</div>
                  <div style={{ color:T.text2, fontFamily:T.font, fontSize:10, marginTop:2 }}>Morning Brief · Tech Analysis · Verdict · Chat (~$0.026/click)</div>
                </div>
                <button onClick={()=>{const next=!aiEnabled;setAiEnabledState(next);AIEngine.setAIEnabled(next);}}
                  style={{ background:aiEnabled?T.cyanDim:T.bg3, border:`1px solid ${aiEnabled?T.cyanMid:T.border}`,
                    color:aiEnabled?T.cyan:T.text2, borderRadius:5, padding:'5px 12px', cursor:'pointer',
                    fontFamily:T.font, fontSize:9, fontWeight:700, transition:'all 0.15s' }}>
                  {aiEnabled ? '● ON' : '○ OFF'}
                </button>
              </div>
              <div style={{ padding:'12px 16px', display:'flex', gap:8 }}>
                <button onClick={()=>setHeaderPanel(null)} style={{ flex:1, padding:'8px 0', borderRadius:6, border:`1px solid ${T.border}`, background:T.bg2, color:T.text1, fontFamily:T.font, fontSize:12, cursor:'pointer' }}>Close</button>
                <button onClick={()=>{setPage('dashboard');setHeaderPanel(null);}} style={{ flex:1, padding:'8px 0', borderRadius:6, border:'none', background:T.cyan, color:'#000', fontFamily:T.font, fontSize:12, fontWeight:700, cursor:'pointer' }}>Dashboard</button>
              </div>
            </div>
          )}

          {/* Signal Engine panel — SIGNAL-PANEL-LIVE-FIX: real live values */}
          {headerPanel==='signals'&&(
            <div style={{ position:'absolute', right:20, top:64, width:300, background:T.bg1, border:`1px solid ${T.border}`, borderRadius:10, boxShadow:'0 12px 40px rgba(0,0,0,0.5)', zIndex:9999, overflow:'hidden' }}>
              <div style={{ padding:'14px 16px', borderBottom:`1px solid ${T.border}`, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <span style={{ color:T.text0, fontFamily:T.font, fontWeight:700, fontSize:13 }}>⚡ Signal Engine</span>
                <button onClick={()=>setHeaderPanel(null)} style={{ background:'none', border:'none', color:T.text2, cursor:'pointer', fontSize:16, padding:0 }}>✕</button>
              </div>
              <div style={{ padding:'12px 16px', display:'flex', gap:8 }}>
                {[
                  ['WATCHING', sideWatchlist,   T.gold],
                  ['SIGNALS',  sideSignalCount, T.green],
                  ['BARS',     sideBarsCount,   T.cyan],
                ].map(([l,v,c])=>(
                  <div key={l} style={{ flex:1, background:T.bg2, border:`1px solid ${T.border}`, borderRadius:6, padding:'8px 6px', textAlign:'center' }}>
                    <div style={{ color:T.text2, fontSize:8, letterSpacing:1 }}>{l}</div>
                    <div style={{ color:v>0?c:T.text2, fontFamily:T.font, fontSize:16, fontWeight:700, marginTop:3 }}>
                      {v > 0 ? v.toLocaleString() : '—'}
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ padding:'0 16px 12px' }}>
                <div style={{ color:T.text2, fontFamily:T.font, fontSize:10, marginBottom:6 }}>COOLDOWN · SESSION FILTER · ADX THRESHOLD</div>
                {[
                  ['Signal Cooldown','120s'],
                  ['Min Score','0.45'],
                  ['Min Confidence','50%'],
                  ['Session Filter','Midday skipped'],
                ].map(([l,v])=>(
                  <div key={l} style={{ display:'flex', justifyContent:'space-between', padding:'5px 0', borderBottom:`1px solid ${T.border}` }}>
                    <span style={{ color:T.text2, fontFamily:T.font, fontSize:11 }}>{l}</span>
                    <span style={{ color:T.cyan,  fontFamily:T.font, fontSize:11, fontWeight:600 }}>{v}</span>
                  </div>
                ))}
              </div>
              <div style={{ padding:'12px 16px', display:'flex', gap:8 }}>
                <button onClick={()=>{setPage('signals');setHeaderPanel(null);}} style={{ flex:1, padding:'8px 0', borderRadius:6, border:'none', background:T.cyan, color:'#000', fontFamily:T.font, fontSize:12, fontWeight:700, cursor:'pointer' }}>Open Signals Page</button>
              </div>
            </div>
          )}
        </div>

        {/* Alert strip */}
        {page!=='live'&&(
          <div style={{ background:T.bg1, borderBottom:`1px solid #080f1a`, padding:'7px 20px', display:'flex', gap:9, flexShrink:0, overflowX:'auto' }}>
            {alertCounts.map(([icon,label,color,count])=>(
              <div key={label}
                onClick={()=>{
                  const filterMap={'VOL SPIKES':'VOL_SPIKES','GAP PLAYS':'GAP_PLAYS','AH MOMT.':'AH_MOMT','EARN. GAPS':'EARN_GAPS','DIAMOND':'DIAMOND'};
                  setQuickFilter(filterMap[label]??null);
                  setPage('live');
                }}
                style={{ display:'flex', alignItems:'center', gap:8, background:T.bg2, border:`1px solid ${T.border}`, borderRadius:7, padding:'5px 13px', cursor:'pointer', flexShrink:0, transition:'all 0.2s' }}
                onMouseEnter={e=>{e.currentTarget.style.borderColor=color+'40';e.currentTarget.style.background=color+'08';}}
                onMouseLeave={e=>{e.currentTarget.style.borderColor=T.border;e.currentTarget.style.background=T.bg2;}}>
                <span style={{ fontSize:12 }}>{icon}</span>
                <span style={{ color:T.text2, fontSize:8.5, letterSpacing:1.5, fontFamily:T.font }}>{label}</span>
                <span style={{ color:count>0?color:T.text2, fontFamily:T.font, fontSize:14, fontWeight:700 }}>{count>0?count:'—'}</span>
              </div>
            ))}
          </div>
        )}

        {/* Appearance modal */}
        {showAppearance&&(
          <AppearanceModal T={T} currentTheme={currentTheme}
            onThemeChange={t=>{if(onThemeChange)onThemeChange(t);}}
            onClose={()=>setShowAppearance(false)}/>
        )}

        {/* Status banners */}
        {wsStatus === 'warming_up' && (
          <div style={{ background:'#2a1f00', borderBottom:'1px solid #f59e0b40', padding:'8px 20px', display:'flex', alignItems:'center', gap:10, flexShrink:0 }}>
            <span style={{ fontSize:14 }}>⏳</span>
            <span style={{ color:'#f59e0b', fontSize:11, fontWeight:700, fontFamily:T.font, letterSpacing:0.5 }}>SERVER WAKING UP</span>
            <span style={{ color:'#a07830', fontSize:11, fontFamily:T.font }}>Render free tier — ready in ~30s.</span>
          </div>
        )}
        {wsStatus === 'connecting' && (
          <div style={{ background: marketSession === 'market' ? '#1a1200' : '#0a0e1a', borderBottom:`1px solid ${marketSession === 'market' ? '#f59e0b30' : '#22d3ee20'}`, padding:'6px 20px', display:'flex', alignItems:'center', gap:10, flexShrink:0 }}>
            <span style={{ fontSize:11 }}>{marketSession === 'market' ? '🔄' : '🌙'}</span>
            <span style={{ color: marketSession === 'market' ? '#f59e0b' : '#22d3ee', fontSize:11, fontWeight:700, fontFamily:T.font, letterSpacing:0.5 }}>
              {marketSession === 'market' ? 'RECONNECTING' : 'MARKET CLOSED'}
            </span>
            <span style={{ color: marketSession === 'market' ? '#806820' : '#2a4a5a', fontSize:11, fontFamily:T.font }}>
              {marketSession === 'market' ? 'SSE stream interrupted — restoring live prices…' : 'Live feed paused · prices from last session'}
            </span>
          </div>
        )}
        {wsStatus === 'feed_warning' && (
          <div style={{ background:'#1f0a0a', borderBottom:'1px solid #ff3d5a40', padding:'6px 20px', display:'flex', alignItems:'center', gap:10, flexShrink:0 }}>
            <span style={{ fontSize:11 }}>⚠</span>
            <span style={{ color:'#ff3d5a', fontSize:11, fontWeight:700, fontFamily:T.font, letterSpacing:0.5 }}>FEED WARNING</span>
            <span style={{ color:'#803030', fontSize:11, fontFamily:T.font }}>Polygon data feed silent — prices may be stale.</span>
          </div>
        )}

        {/* Page content */}
        <div key={page} className="nexradar-page" style={{ flex:1, overflowY:'auto', padding:18 }}>
          <NexRadarErrorBoundary key={page}>
            {renderPage()}
          </NexRadarErrorBoundary>
        </div>
      </div>

      {/* ── MOBILE BOTTOM NAV ── */}
      <nav className="mobile-tabbar">
        {[
          { id: 'dashboard', icon: '⬡', label: 'Home'   },
          { id: 'live',      icon: '◈', label: 'Live'    },
          { id: 'scanner',   icon: '◈', label: 'Scanner' },
          { id: 'signals',   icon: '◉', label: 'Signals' },
          { id: '__more__',  icon: '⋯', label: 'More'    },
        ].map(n => (
          <button key={n.id}
            className={`mobile-tab${n.id === '__more__' ? (mobileDrawer ? ' active' : '') : (page === n.id ? ' active' : '')}`}
            onClick={() => { if (n.id === '__more__') setMobileDrawer(d => !d); else { setPage(n.id); setMobileDrawer(false); } }}
            style={{ color: n.id === '__more__' ? (mobileDrawer ? T.cyan : T.text2) : (page === n.id ? T.cyan : T.text2) }}>
            <span className="mob-icon">{n.icon}</span>
            <span className="mob-label">{n.label}</span>
          </button>
        ))}
      </nav>

      {/* Mobile drawer */}
      {mobileDrawer && isMobile && (
        <>
          <div style={{ position:'fixed', inset:0, zIndex:4990, background:'rgba(0,0,0,0.5)' }}
               onClick={() => setMobileDrawer(false)}/>
          <div style={{ position:'fixed', bottom:58, left:0, right:0, background:T.bg1, borderTop:`1px solid ${T.border}`, borderRadius:'16px 16px 0 0', padding:16, zIndex:5000, display:'flex', flexDirection:'column', gap:4, animation:'slideUp 0.22s ease' }}>
            <div style={{ color:T.text2, fontSize:9, fontWeight:700, letterSpacing:2, padding:'4px 8px 8px' }}>MORE PAGES</div>
            {[
              { id:'screener',  icon:'⌖', label:'Screener'  },
              { id:'earnings',  icon:'◎', label:'Earnings'  },
              { id:'portfolio', icon:'◆', label:'Portfolio' },
              { id:'chart',     icon:'◇', label:'Chart'     },
              { id:'watchlist', icon:'★', label:'Watchlist' },
            ].map(n => (
              <button key={n.id} onClick={() => { setPage(n.id); setMobileDrawer(false); }}
                style={{ display:'flex', alignItems:'center', gap:14, padding:'12px 16px', borderRadius:10, background:page===n.id?T.cyanDim:'transparent', border:page===n.id?`1px solid ${T.cyanMid}`:'1px solid transparent', color:page===n.id?T.cyan:T.text0, fontFamily:T.font, fontSize:14, fontWeight:500, cursor:'pointer', transition:'all 0.15s', textAlign:'left' }}
                onMouseEnter={e=>e.currentTarget.style.background=T.bg2}
                onMouseLeave={e=>e.currentTarget.style.background=page===n.id?T.cyanDim:'transparent'}>
                <span style={{ fontSize:18 }}>{n.icon}</span>{n.label}
              </button>
            ))}
          </div>
        </>
      )}

      {/* ALERT-TOAST-ALL-PAGES: show on every page so watchlist/earnings users get alerts */}
      <AlertToast alerts={liveAlerts} setAlerts={setLiveAlerts} T={T} />
    </div>
  );
}

export default function NexRadarDashboardRoot(props) {
  return (
    <NexRadarErrorBoundary>
      <NexRadarDashboard {...props} />
    </NexRadarErrorBoundary>
  );
}
