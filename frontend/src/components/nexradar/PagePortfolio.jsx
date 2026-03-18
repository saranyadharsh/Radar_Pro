/**
 * PagePortfolio.jsx — NexRadar Pro
 * Portfolio table from /api/portfolio (REST on mount + SSE push), enriched with
 * live prices from SSE tickers Map, DonutChart sector allocation, KPI cards.
 *
 * Props: { tickers, marketSession, watchlist, toggleWatchlist, sseRef, T }
 *
 * FIXES IN THIS VERSION:
 *
 *   SSE-LISTENER-RACE-FIX: The prod version checked sseRef?.current once at
 *     mount time (always null on first render since useTickerData's useEffect
 *     runs asynchronously). When null, it returned immediately and the SSE
 *     listener was NEVER registered — portfolio_update messages silently
 *     dropped forever. Fix: poll every 300ms until sseRef.current is populated,
 *     then attach the listener. Same pattern as useWatchlist.js.
 *
 *   HIJACK-FIX: Prod version used sse.port.onmessage = handler (single-slot
 *     assignment). Multiple components writing to the same slot overwrote each
 *     other's handlers on every navigation/mount cycle. Fix: use
 *     port.addEventListener('message', handler) which is multi-subscriber safe.
 *
 *   LIVE-PRICE-FIX: Prod version read position.last_price which is NEVER
 *     populated by the backend. Fix: use position.live_price (enriched by
 *     ws_engine._portfolio_loop PORTFIX-2) then fall back to SSE tickers Map.
 *
 *   TIMEOUT-FIX: REST fetch timeout reduced from 25s to 8s on first attempt.
 *     Cold-start is handled by the 3-retry loop; a single 25s wait produced
 *     the "LOADING PORTFOLIO..." stuck screen during Render free-tier cold starts.
 *
 *   EFFECT-SPLIT-FIX: REST fetch and SSE listener are now in two independent
 *     useEffects with correct dependency arrays. The prod version had them
 *     combined in one effect with [sseRef] dep — the REST fetch re-ran on every
 *     sseRef change (every tab switch with SharedWorker), spamming /api/portfolio.
 *
 *   PATCH-MAIN-2: X-Data-Timestamp race guard preserved — REST response is
 *     discarded if a fresher SSE delta already arrived.
 */
import { useState, useEffect, useMemo, useRef } from 'react';
import { SectionHeader, Chip, Shimmer, EmptyState, EmptyChart } from './primitives.jsx';
import { fmt2, fmtK } from './utils.js';
import { API_BASE } from '../../config.js';
import { isSharedWorker } from './sseConnection.js';

// ── DonutChart ────────────────────────────────────────────────────────────────
function DonutChart({ data, T, size=130, thick=18 }) {
  const r    = (size - thick) / 2;
  const cx   = size / 2, cy = size / 2;
  const circ = 2 * Math.PI * r;
  if (!data.length) {
    return (
      <div style={{ position:'relative', width:size, height:size, flexShrink:0 }}>
        <svg width={size} height={size}>
          <circle cx={cx} cy={cy} r={r} fill="none" stroke={T.border} strokeWidth={thick}
            strokeDasharray={`${circ*0.8} ${circ*0.2}`} strokeDashoffset={circ*0.1} strokeLinecap="round"/>
          <circle cx={cx} cy={cy} r={r} fill="none" stroke={T.borderHi} strokeWidth={1} opacity={0.4}/>
        </svg>
        <div style={{ position:'absolute', inset:0, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center' }}>
          <span style={{ color:T.text2, fontSize:9, fontFamily:T.font, letterSpacing:1 }}>—%</span>
        </div>
      </div>
    );
  }
  let offset    = circ * 0.25;
  const totalPct= data.reduce((s,d)=>s+d.pct,0);
  return (
    <div style={{ position:'relative', width:size, height:size, flexShrink:0 }}>
      <svg width={size} height={size}>
        {data.map((seg,i)=>{
          const dash=circ*seg.pct/100;
          const gap =circ-dash;
          const el=(
            <circle key={i} cx={cx} cy={cy} r={r} fill="none"
              stroke={seg.color} strokeWidth={thick}
              strokeDasharray={`${dash} ${gap}`}
              strokeDashoffset={-offset+circ*0.25}
              strokeLinecap="butt" opacity={0.85}/>
          );
          offset+=dash;
          return el;
        })}
        <text x={cx} y={cy-4} textAnchor="middle" fill={T.text0} fontSize="13" fontFamily="Syne Mono,monospace" fontWeight="700">{totalPct.toFixed(0)}%</text>
        <text x={cx} y={cy+10} textAnchor="middle" fill={T.text2} fontSize="7" fontFamily="Syne Mono,monospace">ALLOCATED</text>
      </svg>
    </div>
  );
}

// ── KPI Card ──────────────────────────────────────────────────────────────────
function KPICard({ icon, label, value, note, color, T }) {
  return (
    <div className="card" style={{ padding:'16px 18px', flex:1, minWidth:130, position:'relative', overflow:'hidden' }}>
      <div style={{ position:'absolute', top:0, left:0, right:0, height:2, background:`linear-gradient(90deg,transparent,${color},transparent)`, opacity:0.45 }}/>
      <div style={{ fontSize:17, marginBottom:7 }}>{icon}</div>
      <div style={{ color:T.text2, fontSize:9, letterSpacing:2, marginBottom:9, fontFamily:T.font, textTransform:'uppercase' }}>{label}</div>
      <div style={{ fontFamily:T.font, fontSize:20, fontWeight:700, color, letterSpacing:1, marginBottom:5 }}>{value}</div>
      <div style={{ color:T.text2, fontSize:9, fontFamily:T.font }}>{note}</div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function PagePortfolio({ tickers=new Map(), marketSession='market', watchlist=new Set(), toggleWatchlist=()=>{}, sseRef=null, T }) {
  const [portfolioData, setPortfolioData] = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [currentPage,   setCurrentPage]   = useState(1);
  const ITEMS_PER_PAGE = 50;

  // PATCH-MAIN-2: track last SSE delta timestamp to guard REST race condition
  const lastSseTsRef = useRef(0);

  // ── Effect 1: REST fetch on mount ──────────────────────────────────────────
  // EFFECT-SPLIT-FIX: separate from SSE listener so REST doesn't re-fire on
  // every sseRef change (tab switches with SharedWorker).
  // TIMEOUT-FIX: 8s per attempt (was 25s) — retries handle cold-start window.
  useEffect(() => {
    let cancelled = false;

    const fetchPortfolio = async (attempt = 1) => {
      const controller = new AbortController();
      const timeout    = setTimeout(() => controller.abort(), 8_000);
      try {
        const r = await fetch(`${API_BASE}/api/portfolio`, { signal: controller.signal });
        clearTimeout(timeout);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const serverTs = parseInt(r.headers.get('X-Data-Timestamp') || '0', 10);
        const data     = await r.json();
        if (cancelled) return;
        // PATCH-MAIN-2: discard if fresher SSE delta already arrived
        if (serverTs > 0 && serverTs < lastSseTsRef.current) {
          console.debug('[Portfolio] REST response discarded — older than SSE delta');
          setLoading(false);
          return;
        }
        setPortfolioData(data || []);
        setLoading(false);
      } catch (err) {
        clearTimeout(timeout);
        if (cancelled) return;
        console.warn(`[Portfolio] Fetch attempt ${attempt}/3:`, err.message);
        if (attempt < 3) {
          setTimeout(() => { if (!cancelled) fetchPortfolio(attempt + 1); }, 3_000);
        } else {
          console.error('[Portfolio] All fetch attempts failed — showing empty state');
          setLoading(false);
        }
      }
    };

    fetchPortfolio();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Effect 2: SSE listener for live portfolio_update pushes ───────────────
  // SSE-LISTENER-RACE-FIX: sseRef.current is null on first render (useTickerData's
  // useEffect runs asynchronously). Poll every 300ms until it's available, then
  // attach the listener. This guarantees we never miss a portfolio_update message
  // even when the user navigates to Portfolio before SSE finishes connecting.
  //
  // HIJACK-FIX: use port.addEventListener (multi-subscriber) not port.onmessage
  // (single-slot). Multiple hooks writing to the same slot overwrote each other.
  useEffect(() => {
    let cleanup  = () => {};
    let pollId   = null;

    const attach = () => {
      const sse = sseRef?.current;
      if (!sse) {
        // SSE not ready yet — retry shortly
        pollId = setTimeout(attach, 300);
        return;
      }

      const handlePayload = (payload) => {
        if (!payload || typeof payload !== 'object') return;
        if (payload.type === 'portfolio_update' && Array.isArray(payload.data)) {
          // PATCH-MAIN-2: record SSE arrival time
          lastSseTsRef.current = payload.server_ts ?? Date.now();
          setPortfolioData(payload.data);
          setLoading(false);
        }
      };

      if (isSharedWorker(sse)) {
        // HIJACK-FIX: addEventListener is multi-subscriber safe
        const handler = (e) => handlePayload(e.data);
        sse.port.addEventListener('message', handler);
        cleanup = () => {
          clearTimeout(pollId);
          if (sse.port) sse.port.removeEventListener('message', handler);
        };
      } else if (typeof sse.addEventListener === 'function') {
        const handler = (e) => { try { handlePayload(JSON.parse(e.data)); } catch {} };
        sse.addEventListener('message', handler);
        cleanup = () => {
          clearTimeout(pollId);
          sse.removeEventListener('message', handler);
        };
      }
    };

    attach();
    return () => { clearTimeout(pollId); cleanup(); };
  }, [sseRef]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Enrich portfolio rows with live prices ────────────────────────────────
  // LIVE-PRICE-FIX: priority order:
  //   1. SSE tickers Map (250ms live, always fresh)
  //   2. position.live_price (enriched by ws_engine PORTFIX-2 / main.py REST)
  //   3. position.price (alias from ws_engine)
  //   4. 0 fallback
  // REMOVED: position.last_price — this field is never populated by the backend.
  const enrichedPortfolio = useMemo(() => {
    return portfolioData.map(position => {
      const ticker    = tickers.get(position.ticker);
      const livePrice = ticker?.live_price
                     || ticker?.price
                     || position.live_price   // ← PORTFIX-2 enriched by backend
                     || position.price
                     || 0;
      const openPrice = ticker?.open_price || ticker?.open
                     || position.open_price || position.open || 0;
      const prevClose = ticker?.prev_close || position.prev_close || 0;
      const todayClose= ticker?.today_close|| position.today_close || 0;
      const shares    = position.shares    || 0;
      const avgCost   = position.avg_cost  || 0;
      const marketValue = shares * livePrice;
      const costBasis   = shares * avgCost;
      const totalPnL    = marketValue - costBasis;
      const totalPnLPct = costBasis > 0 ? (totalPnL / costBasis) * 100 : 0;
      const isAH        = marketSession !== 'market';
      const dayBase     = isAH ? (todayClose || prevClose || livePrice) : (openPrice || prevClose || livePrice);
      const dayChange   = dayBase > 0 ? livePrice - dayBase : 0;
      const dayPnL      = shares * dayChange;
      const dayPct      = dayBase > 0 ? (dayChange / dayBase) * 100 : 0;
      return {
        ...position,
        livePrice, openPrice, prevClose, todayClose,
        marketValue, costBasis, totalPnL, totalPnLPct,
        dayPnL, dayPct,
        sector: ticker?.sector || position.sector || 'OTHER',
      };
    });
  }, [portfolioData, tickers, marketSession]);

  const allocationData = useMemo(() => {
    if (!enrichedPortfolio.length) return [];
    const totalValue = enrichedPortfolio.reduce((s,p)=>s+p.marketValue,0);
    if (!totalValue) return [];
    const sectorColors = {
      TECHNOLOGY:T.cyan, BANKING:T.green, BIO:T.purple, CONSUMER:T.gold,
      'BM & UENE':T.orange, REALCOM:'#00bcd4', INDUSTRIALS:'#ff9800', OTHER:T.text2,
    };
    const sectorMap = {};
    enrichedPortfolio.forEach(p => {
      const sec = (p.sector||'OTHER').toUpperCase();
      sectorMap[sec] = (sectorMap[sec]||0) + p.marketValue;
    });
    return Object.entries(sectorMap).map(([label,value])=>({
      label, pct:parseFloat(((value/totalValue)*100).toFixed(1)),
      color:sectorColors[label]||T.text2,
    })).sort((a,b)=>b.pct-a.pct);
  }, [enrichedPortfolio, T]);

  const kpis = useMemo(() => {
    if (!enrichedPortfolio.length) return { totalValue:0,dayPnL:0,totalPnL:0,maxDrawdown:0,winRate:0,topHolding:'—',concentration:0,sectorCount:0 };
    const totalValue = enrichedPortfolio.reduce((s,p)=>s+p.marketValue,0);
    const dayPnL     = enrichedPortfolio.reduce((s,p)=>s+p.dayPnL,0);
    const totalPnL   = enrichedPortfolio.reduce((s,p)=>s+p.totalPnL,0);
    const sorted     = [...enrichedPortfolio].sort((a,b)=>b.marketValue-a.marketValue);
    const topHolding = sorted[0]?.ticker||'—';
    const top5Pct    = Math.ceil(enrichedPortfolio.length*0.05);
    const top5Value  = sorted.slice(0,top5Pct).reduce((s,p)=>s+p.marketValue,0);
    const concentration = totalValue>0?(top5Value/totalValue)*100:0;
    const sectorCount   = new Set(enrichedPortfolio.map(p=>p.sector)).size;
    const maxDrawdown   = enrichedPortfolio.reduce((max,p)=>Math.max(max,p.totalPnLPct<0?Math.abs(p.totalPnLPct):0),0);
    const winRate       = (enrichedPortfolio.filter(p=>p.totalPnL>0).length/enrichedPortfolio.length)*100;
    return { totalValue, dayPnL, totalPnL, maxDrawdown, winRate, topHolding, concentration, sectorCount };
  }, [enrichedPortfolio]);

  const MH_COLS  = '1.4fr 0.7fr 0.9fr 0.9fr 0.9fr 0.9fr 0.9fr 0.9fr 0.9fr 0.9fr 0.6fr';
  const AH_COLS  = '1.4fr 0.7fr 0.9fr 0.9fr 1fr 1fr 0.9fr 0.9fr 0.9fr 0.9fr 0.6fr';
  const isMH     = marketSession === 'market';
  const gridCols = isMH ? MH_COLS : AH_COLS;
  const mhHeaders= ['SYMBOL','SHARES','AVG COST','OPEN','LIVE PRICE','CHANGE','% CHG','VALUE','DAY P&L','TOTAL P&L','ACTION'];
  const ahHeaders= ['SYMBOL','SHARES','AVG COST','PREV CLOSE','TODAY CLOSE','LIVE PRICE','$ CHG','% CHG','VALUE','TOTAL P&L','ACTION'];

  return (
    <div className="page-enter" style={{ display:'flex', flexDirection:'column', gap:16 }}>
      {/* KPIs */}
      <div style={{ display:'flex', gap:13, flexWrap:'wrap' }}>
        <KPICard icon="💰" label="Total Value"   value={fmtK(kpis.totalValue)} color={T.cyan}   note="Unrealized" T={T}/>
        <KPICard icon="📈" label="Day P&L"        value={kpis.dayPnL>=0?`+${fmtK(kpis.dayPnL)}`:fmtK(kpis.dayPnL)} color={kpis.dayPnL>=0?T.green:T.red} note="Today" T={T}/>
        <KPICard icon="📊" label="Total P&L"      value={kpis.totalPnL>=0?`+${fmtK(kpis.totalPnL)}`:fmtK(kpis.totalPnL)} color={kpis.totalPnL>=0?T.green:T.red} note="All time" T={T}/>
        <KPICard icon="📉" label="Max Drawdown"   value={`-${kpis.maxDrawdown.toFixed(1)}%`} color={T.red}    note="Portfolio risk" T={T}/>
        <KPICard icon="⚡" label="Win Rate"        value={`${kpis.winRate.toFixed(0)}%`}       color={T.purple} note={`${enrichedPortfolio.filter(p=>p.totalPnL>0).length} winners`} T={T}/>
      </div>

      <div style={{ display:'flex', gap:16, flexWrap:'wrap' }}>
        {/* Holdings table */}
        <div className="card" style={{ flex:2, minWidth:300 }}>
          <SectionHeader title="Holdings">
            <span style={{ color:T.text2, fontSize:8.5, fontFamily:T.font }}>{enrichedPortfolio.length} positions · live via SSE</span>
            <button className="btn-primary">+ ADD POSITION</button>
          </SectionHeader>
          <div style={{ display:'grid', gridTemplateColumns:gridCols, background:T.bg0, borderBottom:`1px solid ${T.border}` }}>
            {(isMH?mhHeaders:ahHeaders).map(h=>(
              <div key={h} style={{ padding:'9px 10px', color:T.text1, fontSize:9, letterSpacing:1, fontFamily:T.font, whiteSpace:'nowrap', fontWeight:800 }}>{h}</div>
            ))}
          </div>
          {loading ? (
            <EmptyState icon="◆" label="LOADING PORTFOLIO..." sub="Loading positions from server…" h={120}/>
          ) : enrichedPortfolio.length===0 ? (
            <EmptyState icon="◆" label="NO POSITIONS" sub="Add your first position to get started" h={120} T={T}/>
          ) : (
            <>
              <div style={{ maxHeight:'calc(100vh - 520px)', minHeight:'300px', overflowY:'auto' }}>
                {enrichedPortfolio.slice((currentPage-1)*ITEMS_PER_PAGE,currentPage*ITEMS_PER_PAGE).map(pos=>(
                  <div key={pos.ticker+(isMH?'':'_ah')} style={{ display:'grid', gridTemplateColumns:gridCols, borderBottom:`1px solid ${T.border}`, fontSize:12, fontFamily:T.font }}>
                    <div style={{ padding:'10px', display:'flex', alignItems:'flex-start', gap:8 }}>
                      <button onClick={e=>{e.stopPropagation();toggleWatchlist(pos.ticker);}}
                        style={{ background:'none', border:'none', cursor:'pointer', padding:'1px 2px', fontSize:14,
                          color:watchlist.has(pos.ticker)?T.gold||'#f5a623':T.text2,
                          opacity:watchlist.has(pos.ticker)?1:0.4, transition:'all 0.15s', flexShrink:0, lineHeight:1 }}
                        title={watchlist.has(pos.ticker)?'Remove from watchlist':'Add to watchlist'}>
                        {watchlist.has(pos.ticker)?'★':'☆'}
                      </button>
                      <div>
                        <div style={{ color:T.cyan, fontWeight:700, fontSize:13 }}>{pos.ticker}</div>
                        <div style={{ color:T.text2, fontSize:9, fontWeight:400 }}>{pos.company_name||''}</div>
                      </div>
                    </div>
                    <div style={{ padding:'10px', color:T.text1 }}>{pos.shares?.toLocaleString()||0}</div>
                    <div style={{ padding:'10px', color:T.text1 }}>${fmt2(pos.avg_cost)}</div>
                    {isMH ? (
                      <>
                        <div style={{ padding:'10px', color:T.text1 }}>{pos.openPrice>0?`$${fmt2(pos.openPrice)}`:'—'}</div>
                        <div style={{ padding:'10px', color:T.cyan, fontWeight:700 }}>${fmt2(pos.livePrice)}</div>
                        <div style={{ padding:'10px', color:pos.dayPnL>=0?T.green:T.red, fontWeight:600 }}>{pos.dayPnL>=0?'+':''}{fmt2(pos.dayPnL)}</div>
                        <div style={{ padding:'10px', color:pos.dayPct>=0?T.green:T.red, fontWeight:700 }}>{pos.dayPct>=0?'+':''}{pos.dayPct.toFixed(2)}%</div>
                        <div style={{ padding:'10px', color:T.text0 }}>{fmtK(pos.marketValue)}</div>
                        <div style={{ padding:'10px', color:pos.dayPnL>=0?T.green:T.red }}>{pos.dayPnL>=0?'+':''}{fmtK(pos.dayPnL)}</div>
                        <div style={{ padding:'10px', color:pos.totalPnL>=0?T.green:T.red }}>{pos.totalPnL>=0?'+':''}{fmtK(pos.totalPnL)}</div>
                      </>
                    ) : (
                      <>
                        <div style={{ padding:'10px', color:T.text1 }}>{pos.prevClose>0?`$${fmt2(pos.prevClose)}`:'—'}</div>
                        <div style={{ padding:'10px', color:T.text1 }}>{pos.todayClose>0?`$${fmt2(pos.todayClose)}`:'—'}</div>
                        <div style={{ padding:'10px', color:T.cyan, fontWeight:700 }}>${fmt2(pos.livePrice)}</div>
                        <div style={{ padding:'10px', color:pos.dayPnL>=0?T.green:T.red, fontWeight:600 }}>{pos.dayPnL>=0?'+':''}{fmt2(pos.dayPnL)}</div>
                        <div style={{ padding:'10px', color:pos.dayPct>=0?T.green:T.red, fontWeight:700 }}>{pos.dayPct>=0?'+':''}{pos.dayPct.toFixed(2)}%</div>
                        <div style={{ padding:'10px', color:T.text0 }}>{fmtK(pos.marketValue)}</div>
                        <div style={{ padding:'10px', color:pos.totalPnL>=0?T.green:T.red }}>{pos.totalPnL>=0?'+':''}{fmtK(pos.totalPnL)}</div>
                      </>
                    )}
                    <div style={{ padding:'10px' }}><button className="btn-ghost" style={{ fontSize:8, padding:'3px 6px' }}>SELL</button></div>
                  </div>
                ))}
              </div>
              {enrichedPortfolio.length>ITEMS_PER_PAGE&&(
                <div style={{ padding:'14px 18px', borderTop:`2px solid ${T.border}`, display:'flex', justifyContent:'space-between', alignItems:'center', background:T.bg1, position:'sticky', bottom:0, zIndex:10 }}>
                  <span style={{ color:T.text1, fontSize:13, fontFamily:T.font, fontWeight:600 }}>
                    Showing {((currentPage-1)*ITEMS_PER_PAGE)+1}–{Math.min(currentPage*ITEMS_PER_PAGE,enrichedPortfolio.length)} of {enrichedPortfolio.length.toLocaleString()} positions
                  </span>
                  <div style={{ display:'flex', gap:10, alignItems:'center' }}>
                    <span style={{ color:T.text1, fontSize:13, fontFamily:T.font, fontWeight:600 }}>Page {currentPage} of {Math.ceil(enrichedPortfolio.length/ITEMS_PER_PAGE)}</span>
                    <button className="btn-ghost" style={{ fontSize:12, padding:'6px 12px' }} onClick={()=>setCurrentPage(p=>Math.max(1,p-1))} disabled={currentPage===1}>← PREV</button>
                    <button className="btn-ghost" style={{ fontSize:12, padding:'6px 12px' }} onClick={()=>setCurrentPage(p=>Math.min(Math.ceil(enrichedPortfolio.length/ITEMS_PER_PAGE),p+1))} disabled={currentPage>=Math.ceil(enrichedPortfolio.length/ITEMS_PER_PAGE)}>NEXT →</button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Right: Allocation + Performance */}
        <div style={{ flex:1, minWidth:200, display:'flex', flexDirection:'column', gap:14 }}>
          <div className="card">
            <SectionHeader title="Allocation"><Chip color={T.text2}>BY SECTOR</Chip></SectionHeader>
            <div style={{ padding:'16px 18px' }}>
              <div style={{ color:T.text2, fontSize:8.5, fontFamily:T.font, marginBottom:12, lineHeight:1.6 }}>
                <span style={{ color:T.cyan }}>Formula: </span>(shares × live_price) ÷ total_portfolio_value × 100<br/>
                Grouped by <span style={{ color:T.text0 }}>sector</span> from stock_list JOIN portfolio.
              </div>
              <div style={{ display:'flex', gap:14, alignItems:'flex-start' }}>
                <DonutChart data={allocationData} T={T} size={130} thick={18}/>
                <div style={{ flex:1, display:'flex', flexDirection:'column', gap:6 }}>
                  {allocationData.length===0 ? (
                    [T.cyan,T.green,T.purple,T.gold,T.orange].map((c,i)=>(
                      <div key={i} style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                        <div style={{ display:'flex', gap:7, alignItems:'center' }}>
                          <div style={{ width:9,height:9,borderRadius:2,background:c,opacity:0.6 }}/>
                          <Shimmer w={55} h={9} opacity={0.5}/>
                        </div>
                        <Shimmer w={28} h={9} opacity={0.35}/>
                      </div>
                    ))
                  ) : allocationData.map((seg,i)=>(
                    <div key={i} style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                      <div style={{ display:'flex', gap:7, alignItems:'center' }}>
                        <div style={{ width:9,height:9,borderRadius:2,background:seg.color }}/>
                        <span style={{ color:T.text1, fontSize:9, fontFamily:T.font }}>{seg.label}</span>
                      </div>
                      <span style={{ color:seg.color, fontSize:10, fontFamily:T.font, fontWeight:700 }}>{seg.pct}%</span>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ marginTop:14, paddingTop:12, borderTop:`1px solid ${T.border}`, display:'flex', gap:8, flexWrap:'wrap' }}>
                {[
                  {lbl:'TOP HOLDING',   val:kpis.topHolding,                   note:'symbol'},
                  {lbl:'CONCENTRATION', val:`${kpis.concentration.toFixed(0)}%`, note:'top 5%'},
                  {lbl:'SECTORS',       val:kpis.sectorCount,                   note:'count'},
                ].map(k=>(
                  <div key={k.lbl} style={{ flex:1, background:T.bg2, border:`1px solid ${T.border}`, borderRadius:6, padding:'7px 10px', minWidth:70 }}>
                    <div style={{ color:T.text2, fontSize:7.5, letterSpacing:1.5, fontFamily:T.font }}>{k.lbl}</div>
                    <div style={{ color:T.text0, fontFamily:T.font, fontSize:14, fontWeight:700, marginTop:3 }}>{k.val}</div>
                    <div style={{ color:T.text2, fontSize:7.5, fontFamily:T.font, marginTop:1 }}>{k.note}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
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
