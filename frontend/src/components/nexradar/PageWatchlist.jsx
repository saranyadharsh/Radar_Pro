/**
 * PageWatchlist.jsx — NexRadar Pro
 * SSE-driven watchlist with live prices, Edgar/Polygon panel on click,
 * automated news/edgar alerts via SSE, AI auto-analysis on add.
 *
 * Props: { T, watchlistSet, toggleWatchlist, tickers, sseRef,
 *          aiEnabled, onNavigateToSettings }
 *
 * FEATURES IN THIS VERSION:
 *
 *   SSE-ALERTS-WIRING: sseRef is now wired — news_alert and edgar_alert
 *     SSE events update per-row badges in real time. Each watchlist row
 *     shows a 📰 news badge or ⚡ edgar badge with the latest headline.
 *     On mount, fetches recent alert history from /api/alerts.
 *
 *   AI-AUTO-TRIGGER: When aiEnabled=true and user adds a new ticker to
 *     the watchlist, the AgenticPanel auto-selects that ticker and triggers
 *     a Morning Brief analysis. When aiEnabled=false (default), adding a
 *     ticker still selects it in the panel but doesn't auto-run AI.
 *
 *   NOTIFICATION-TOAST: Real SSE news/edgar/fda events show a floating
 *     toast with dismiss button. Multiple events queue (max 1 visible).
 *
 *   SYMBOL-CLICK-PANEL: Clicking any row opens AgenticPanel which loads
 *     Edgar EFTS filings + Polygon full stock data for that symbol via
 *     DataEngine.getFullStockData() — zero extra code needed, AgenticPanel
 *     already handles this internally.
 *
 *   EARNINGS-LINK: If a watchlist stock has an earnings date in the current
 *     week, the row shows an 📅 earnings badge with the date.
 */
import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { fmt2, fmtVol } from './utils.js';
import AgenticPanel, { Shimmer } from './AgenticPanel.jsx';
import { isSharedWorker } from './sseConnection.js';
import { API_BASE } from '../../config.js';

// ── Range bar (52-week position) ─────────────────────────────────────────────
function RangeBar({ price, high, low, T }) {
  if (!T) return null;
  if (!price||!high||!low||high===low) return <span style={{color:T.text2,fontSize:9}}>—</span>;
  const pct   = Math.round(((price-low)/(high-low))*100);
  const color = pct>70?T.green:pct>40?T.gold:T.red;
  return (
    <div>
      <div style={{height:3,background:T.bg4,borderRadius:2,width:55,overflow:'hidden'}}>
        <div style={{height:'100%',width:pct+'%',background:color,borderRadius:2}}/>
      </div>
      <span style={{color:T.text2,fontFamily:T.font,fontSize:7.5}}>{pct}%</span>
    </div>
  );
}

// ── Alert badge: shows latest edgar/news/fda hit per ticker ──────────────────
function AlertBadge({ alert, T }) {
  if (!alert || !T) return null;
  const isEdgar = alert.type === 'edgar_alert';
  const isFda   = alert.type === 'fda_alert';
  const color   = isEdgar ? T.orange : isFda ? T.purple : T.gold;
  const icon    = isEdgar ? '⚡' : isFda ? '💊' : '📰';
  return (
    <div style={{ color, fontFamily:T.font, fontSize:7.5, marginTop:2,
      display:'flex', alignItems:'center', gap:3, overflow:'hidden' }}>
      <span style={{ flexShrink:0 }}>{icon}</span>
      <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:80 }}>
        {alert.sub || alert.title || alert.headline || ''}
      </span>
    </div>
  );
}

// ── Floating toast for real-time alerts ──────────────────────────────────────
function AlertToastWL({ toast, onDismiss, T }) {
  if (!toast || !T) return null;
  const isEdgar = toast.type === 'edgar_alert';
  const isFda   = toast.type === 'fda_alert';
  const color   = isEdgar ? T.orange : isFda ? T.purple : T.gold;
  const icon    = isEdgar ? '⚡' : isFda ? '💊' : '📰';
  const label   = isEdgar ? 'EDGAR FILING' : isFda ? 'FDA ALERT' : 'NEWS';
  return (
    <div style={{
      position:'fixed', bottom:24, right:24, zIndex:9999,
      background:T.bg2, border:`1px solid ${color}40`,
      borderLeft:`3px solid ${color}`,
      borderRadius:8, padding:'11px 14px', maxWidth:320,
      boxShadow:'0 4px 24px #00000060', fontFamily:T.font,
    }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:8 }}>
        <div style={{ flex:1 }}>
          <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:5 }}>
            <span style={{ fontSize:12 }}>{icon}</span>
            <span style={{ color, fontSize:8.5, fontWeight:900, letterSpacing:0.8 }}>
              {label} · {toast.ticker}
            </span>
          </div>
          <p style={{ color:T.text0, fontSize:10.5, lineHeight:1.6, marginBottom:4 }}>
            {toast.title || toast.headline || ''}
          </p>
          <span style={{ color:T.text2, fontSize:8 }}>{toast.sub || ''}</span>
        </div>
        <button onClick={onDismiss}
          style={{ background:'none', border:'none', color:T.text2, cursor:'pointer', fontSize:14, lineHeight:1, flexShrink:0 }}>
          ×
        </button>
      </div>
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────
export default function PageWatchlist({
  T,
  watchlistSet    = new Set(),
  toggleWatchlist = () => {},
  tickers         = new Map(),
  sseRef          = null,
  aiEnabled       = false,
  onNavigateToSettings = () => {},
}) {
  const watchlist = useMemo(() =>
    [...watchlistSet].map(sym => {
      const live = tickers.get(sym) || {};
      return { symbol: sym, companyName: live.company_name || live.company || sym, sector: live.sector || '—' };
    }),
  [watchlistSet, tickers]);

  const [selectedTick,  setSelectedTick]  = useState(null);
  const [selectedRow,   setSelectedRow]   = useState(null);
  const [search,        setSearch]        = useState('');
  const [addSymbol,     setAddSymbol]     = useState('');
  const [alertMap,      setAlertMap]      = useState({});  // ticker → latest alert
  const [toast,         setToast]         = useState(null);
  const autoAnalyzeRef  = useRef(false);   // signals AgenticPanel to auto-run AI

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

  // ── SSE-ALERTS-WIRING: wire sseRef for news/edgar/fda alerts ─────────────────
  useEffect(() => {
    // Seed with recent alert history on mount
    fetch(`${API_BASE}/api/alerts?limit=100`)
      .then(r => r.ok ? r.json() : { data: [] })
      .then(j => {
        const m = {};
        (j.data || []).forEach(a => {
          if (a.ticker && !m[a.ticker]) m[a.ticker] = a;
        });
        setAlertMap(prev => ({ ...m, ...prev }));
      })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!sseRef) return;
    let pollId = null, cleanup = () => { clearTimeout(pollId); };

    const attach = () => {
      const sse = sseRef?.current;
      if (!sse) { pollId = setTimeout(attach, 400); return; }

      const handlePayload = (payload) => {
        if (!payload || typeof payload !== 'object') return;
        const t = payload.type;
        if (t !== 'news_alert' && t !== 'edgar_alert' && t !== 'fda_alert' && t !== 'earnings_alert') return;
        const ticker = payload.ticker;
        if (!ticker) return;

        // Only show badge + toast for tickers in the user's watchlist
        if (!watchlistSet.has(ticker)) return;

        setAlertMap(prev => ({ ...prev, [ticker]: payload }));
        setToast(payload);
        // Auto-dismiss toast after 8s
        setTimeout(() => setToast(t => t === payload ? null : t), 8_000);
      };

      if (isSharedWorker(sse)) {
        const h = (e) => handlePayload(e.data);
        sse.port.addEventListener('message', h);
        cleanup = () => { clearTimeout(pollId); if (sse.port) sse.port.removeEventListener('message', h); };
      } else if (typeof sse.addEventListener === 'function') {
        const h = (e) => { try { handlePayload(JSON.parse(e.data)); } catch {} };
        sse.addEventListener('message', h);
        cleanup = () => { clearTimeout(pollId); sse.removeEventListener('message', h); };
      }
    };

    attach();
    return () => cleanup();
  }, [sseRef, watchlistSet]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Add to watchlist — AI-AUTO-TRIGGER ────────────────────────────────────────
  const addToWatchlist = useCallback(() => {
    const sym = addSymbol.trim().toUpperCase();
    if (!sym || watchlistSet.has(sym)) return;
    toggleWatchlist(sym);
    setAddSymbol('');
    // Select the new ticker in AgenticPanel immediately
    setSelectedTick(sym);
    setSelectedRow({ symbol: sym });
    // AI-AUTO-TRIGGER: if AI is enabled, flag for auto-analysis
    if (aiEnabled) {
      autoAnalyzeRef.current = true;
    }
  }, [addSymbol, watchlistSet, toggleWatchlist, aiEnabled]);

  const removeFromWatchlist = useCallback((sym) => {
    toggleWatchlist(sym);
    if (selectedTick === sym) { setSelectedTick(null); setSelectedRow(null); }
  }, [toggleWatchlist, selectedTick]);

  const stats = useMemo(() => {
    const prices  = watchlist.map(w => getLive(w.symbol)).filter(Boolean);
    const alerts  = Object.keys(alertMap).filter(k => watchlistSet.has(k));
    return {
      total:   watchlist.length,
      gainers: prices.filter(p => p.change > 0).length,
      losers:  prices.filter(p => p.change < 0).length,
      alerts:  alerts.filter(k => alertMap[k]?.type === 'edgar_alert').length,
      news:    alerts.filter(k => alertMap[k]?.type === 'news_alert').length,
    };
  }, [watchlist, tickers, alertMap, watchlistSet]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    if (!search.trim()) return watchlist;
    const s = search.trim().toUpperCase();
    return watchlist.filter(w => w.symbol.includes(s) || (w.companyName||'').toUpperCase().includes(s));
  }, [watchlist, search]);

  const COL = '82px 120px 78px 82px 78px 70px 38px';

  // Guard: T (theme) may be undefined on first render if parent hasn't loaded yet
  if (!T) return null;

  return (
    <div style={{ background:T.bg0, height:'100vh', fontFamily:T.font,
      display:'flex', flexDirection:'column', overflow:'hidden' }}>

      {/* Top bar */}
      <div style={{ display:'flex', alignItems:'center', gap:10, padding:'9px 16px',
        borderBottom:`1px solid ${T.border}`, background:T.bg1, flexShrink:0, flexWrap:'wrap' }}>
        <div style={{ display:'flex', alignItems:'center', gap:7 }}>
          <div style={{ width:7, height:7, borderRadius:'50%', background:T.green,
            boxShadow:`0 0 6px ${T.green}`, animation:'pulse 2s infinite' }}/>
          <span style={{ color:T.text0, fontSize:11, fontFamily:T.font, fontWeight:700, letterSpacing:1.2 }}>★ WATCHLIST</span>
          {watchlist.length > 0 && (
            <span style={{ color:T.green, fontFamily:T.font, fontSize:9,
              background:T.green+'18', border:`1px solid ${T.green}30`,
              borderRadius:4, padding:'2px 7px', fontWeight:700 }}>
              ⚡ {watchlist.length} SIGNALS ACTIVE
            </span>
          )}
          {aiEnabled && (
            <span style={{ color:T.cyan, fontFamily:T.font, fontSize:9,
              background:T.cyan+'12', border:`1px solid ${T.cyan}30`,
              borderRadius:4, padding:'2px 7px', fontWeight:700 }}>
              🤖 AI ON
            </span>
          )}
        </div>
        <div style={{ display:'flex', gap:6 }}>
          <input value={addSymbol}
            onChange={e=>setAddSymbol(e.target.value.toUpperCase())}
            onKeyDown={e=>e.key==='Enter'&&addToWatchlist()}
            placeholder="Add ticker…"
            style={{ background:T.bg2, border:`1px solid ${T.border}`, borderRadius:6,
              padding:'5px 10px', color:T.text0, fontFamily:T.font, fontSize:11,
              outline:'none', caretColor:T.cyan, width:130 }}/>
          <button onClick={addToWatchlist}
            style={{ background:T.cyanDim, border:`1px solid ${T.cyanMid}`,
              color:T.cyan, borderRadius:6, padding:'5px 12px', cursor:'pointer',
              fontFamily:T.font, fontSize:10, fontWeight:700 }}>+ ADD</button>
        </div>
        <input value={search} onChange={e=>setSearch(e.target.value)}
          placeholder="Search…"
          style={{ background:T.bg2, border:`1px solid ${T.border}`, borderRadius:6,
            padding:'5px 10px', color:T.text0, fontFamily:T.font, fontSize:11,
            outline:'none', caretColor:T.cyan, width:120 }}/>
        <div style={{ marginLeft:'auto', display:'flex', gap:7, alignItems:'center', flexWrap:'wrap' }}>
          {[
            {icon:'★', l:'TOTAL',   v:stats.total,   c:T.cyan},
            {icon:'▲', l:'GAINERS', v:stats.gainers, c:T.green},
            {icon:'▼', l:'LOSERS',  v:stats.losers,  c:T.red},
            {icon:'⚡', l:'EDGAR',   v:stats.alerts,  c:T.orange},
            {icon:'📰', l:'NEWS',    v:stats.news,    c:T.gold},
          ].map(s=>(
            <div key={s.l} style={{ display:'flex', alignItems:'center', gap:5,
              background:T.bg2, border:`1px solid ${T.border}`,
              borderRadius:5, padding:'4px 9px' }}>
              <span style={{ color:s.c, fontSize:9 }}>{s.icon}</span>
              <span style={{ color:T.text2, fontSize:7.5, fontFamily:T.font }}>{s.l}</span>
              <span style={{ color:s.c, fontSize:12, fontFamily:T.font, fontWeight:800 }}>{s.v}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Split layout */}
      <div style={{ display:'flex', flex:1, overflow:'hidden' }}>

        {/* LEFT — table */}
        <div style={{ flex:1, display:'flex', flexDirection:'column',
          overflow:'hidden', borderRight:`1px solid ${T.border}` }}>

          {/* Headers */}
          <div style={{ display:'grid', gridTemplateColumns:COL,
            background:T.bg0, borderBottom:`2px solid ${T.border}`,
            padding:'0 14px', flexShrink:0 }}>
            {['SYMBOL','COMPANY','PRICE','CHANGE','VOLUME','52W','✕'].map(h=>(
              <div key={h} style={{ padding:'7px 4px', color:T.text2, fontSize:8,
                fontFamily:T.font, letterSpacing:0.8, fontWeight:700 }}>{h}</div>
            ))}
          </div>

          <div style={{ flex:1, overflowY:'auto' }}>
            {filtered.length===0 ? (
              <div style={{ display:'flex', flexDirection:'column', alignItems:'center',
                justifyContent:'center', height:240, gap:10 }}>
                <div style={{ color:T.text2, fontSize:32, opacity:0.15 }}>★</div>
                <span style={{ color:T.text0, fontFamily:T.font, fontSize:13, fontWeight:700 }}>
                  {search ? 'No matches' : 'Your watchlist is empty'}
                </span>
                {!search && (
                  <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:6,
                    background:T.bg2, border:`1px solid ${T.border}`, borderRadius:8,
                    padding:'12px 20px', maxWidth:320, textAlign:'center' }}>
                    <span style={{ color:T.text2, fontFamily:T.font, fontSize:10, lineHeight:1.6 }}>
                      Type a ticker above and click <span style={{ color:T.cyan, fontWeight:700 }}>+ ADD</span>
                      <br/>— or —<br/>
                      Click <span style={{ color:T.gold, fontWeight:700 }}>★</span> on any row in the Live Table
                    </span>
                    <span style={{ color:T.green, fontFamily:T.font, fontSize:9, marginTop:2 }}>
                      ⚡ Adding a ticker starts signal engine calculations immediately
                    </span>
                    {aiEnabled && (
                      <span style={{ color:T.cyan, fontFamily:T.font, fontSize:9 }}>
                        🤖 AI Engine is ON — new tickers auto-analyze on add
                      </span>
                    )}
                  </div>
                )}
              </div>
            ) : filtered.map((w, i) => {
              const live    = getLive(w.symbol);
              const alert   = alertMap[w.symbol] ?? null;
              const isSel   = selectedTick === w.symbol;
              const chg     = live?.change || 0;
              const hasAlert= alert !== null;
              return (
                <div key={w.symbol} className="nx-row"
                  onClick={()=>{
                    setSelectedTick(w.symbol);
                    setSelectedRow({...w,...(live||{})});
                    autoAnalyzeRef.current = false; // only auto-trigger on add
                  }}
                  style={{ display:'grid', gridTemplateColumns:COL,
                    padding:'0 14px', borderBottom:`1px solid ${T.border}`,
                    background:isSel?T.cyanDim:i%2===0?'transparent':T.bg3+'40',
                    borderLeft:`2px solid ${isSel?T.cyan:hasAlert?T.orange:'transparent'}`,
                    transition:'all 0.1s', cursor:'pointer' }}>

                  {/* SYMBOL + badges */}
                  <div style={{ padding:'9px 4px' }}>
                    <div style={{ display:'flex', alignItems:'center', gap:4 }}>
                      <span style={{ color:T.cyan, fontSize:11, fontFamily:T.font, fontWeight:800 }}>{w.symbol}</span>
                      <span style={{ color:T.green, fontSize:7, opacity:0.7 }}>⚡</span>
                    </div>
                    {/* SSE-ALERTS-WIRING: live alert badge per row */}
                    <AlertBadge alert={alert} T={T}/>
                  </div>

                  {/* COMPANY */}
                  <div style={{ padding:'9px 4px', color:T.text2, fontSize:9,
                    fontFamily:T.font, overflow:'hidden', textOverflow:'ellipsis',
                    whiteSpace:'nowrap', display:'flex', alignItems:'center' }}>
                    {w.companyName}
                  </div>

                  {/* PRICE */}
                  <div style={{ padding:'9px 4px', display:'flex', alignItems:'center' }}>
                    {live?.price != null
                      ? <span style={{ color:T.text0, fontSize:11, fontFamily:T.font, fontWeight:700 }}>${fmt2(live.price)}</span>
                      : <Shimmer w={50} h={10} T={T}/>}
                  </div>

                  {/* CHANGE */}
                  <div style={{ padding:'9px 4px', display:'flex', alignItems:'center' }}>
                    {live?.change != null
                      ? <span style={{ color:chg>=0?T.green:T.red, fontFamily:T.font, fontSize:10, fontWeight:600 }}>
                          {chg>=0?'▲':'▼'}{fmt2(Math.abs(chg))}
                          <br/>
                          <span style={{ fontSize:9 }}>({fmt2(Math.abs(live.changePct))}%)</span>
                        </span>
                      : <Shimmer w={40} h={10} T={T}/>}
                  </div>

                  {/* VOLUME */}
                  <div style={{ padding:'9px 4px', color:T.text1, fontSize:10,
                    fontFamily:T.font, display:'flex', alignItems:'center' }}>
                    {live?.volume ? fmtVol(live.volume) : '—'}
                  </div>

                  {/* 52W range */}
                  <div style={{ padding:'9px 4px', display:'flex', alignItems:'center' }}>
                    <RangeBar price={live?.price} high={live?.high} low={live?.low} T={T}/>
                  </div>

                  {/* Remove */}
                  <div style={{ padding:'9px 4px', display:'flex', alignItems:'center' }}>
                    <button onClick={e=>{e.stopPropagation();removeFromWatchlist(w.symbol);}}
                      style={{ background:'none', border:'none', color:T.text2+'50',
                        cursor:'pointer', fontSize:14, lineHeight:1, transition:'all 0.15s' }}
                      onMouseEnter={e=>e.currentTarget.style.color=T.red}
                      onMouseLeave={e=>e.currentTarget.style.color=T.text2+'50'}>✕</button>
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ padding:'5px 14px', borderTop:`1px solid ${T.border}`,
            display:'flex', justifyContent:'space-between', background:T.bg0, flexShrink:0 }}>
            <span style={{ color:T.text2, fontSize:8.5, fontFamily:T.font }}>
              {filtered.length} stocks · SSE live feed
            </span>
            <span style={{ color:T.text2, fontSize:8, fontFamily:T.font }}>
              {Object.keys(alertMap).filter(k=>watchlistSet.has(k)).length > 0
                ? `${Object.keys(alertMap).filter(k=>watchlistSet.has(k)).length} alerts`
                : 'NexRadar SSE · Live ●'}
            </span>
          </div>
        </div>

        {/* RIGHT — AgenticPanel (Edgar + Polygon + AI) */}
        <div style={{ width:320, flexShrink:0, display:'flex',
          flexDirection:'column', background:T.bg1, overflow:'hidden' }}>
          <AgenticPanel
            ticker={selectedTick}
            rowHint={selectedRow}
            context="watchlist"
            autoAnalyze={autoAnalyzeRef.current && aiEnabled}
            onNavigateToSettings={onNavigateToSettings}
            T={T}
          />
        </div>
      </div>

      {/* Floating alert toast */}
      <AlertToastWL toast={toast} onDismiss={()=>setToast(null)} T={T}/>
    </div>
  );
}
