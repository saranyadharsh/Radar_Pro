/**
 * PageEarnings.jsx — NexRadar Pro
 * Earnings calendar: watchlist pinning, sector filter, market breadth strip.
 * Props: { T, tickers, watchlist, toggleWatchlist, sseRef,
 *          sseRef }
 *
 * FEATURES:
 *   WATCHLIST-PIN  Watched stocks float to top with gold accent border.
 *   SECTOR-FILTER  Pills filter table to one sector. Derived from live data.
 *   BREADTH-STRIP  Market breadth chips link to Live Table quick filters.
 *   DB-ONLY        Zero Polygon calls. Supabase Tier 1 + engine cache Tier 2.
 *   SSE-PRICES     sseRef tick_batch/snapshot_delta updates live_price inline.
 *   TIME-CODES     BMO→Pre-mkt, AMC→After, TNS→TBD.
 *   ABORT-FIX      Fresh AbortController per retry attempt.
 *   MOUNT-FIX      Always resets to today on React.lazy re-mount.
 */
import { useState, useEffect, useMemo } from 'react';
import { SectionHeader, Chip, Shimmer, EmptyState } from './primitives.jsx';
import { fmtK, getWeekDates, fmt2 } from './utils.js';
import { API_BASE } from '../../config.js';
import { isSharedWorker } from './sseConnection.js';

function fmtTime(t) {
  if (!t) return '—';
  const u = t.toUpperCase();
  if (u === 'BMO' || u === 'PRE')  return 'Pre-mkt';
  if (u === 'AMC' || u === 'POST') return 'After';
  if (u === 'TNS' || u === 'TBD')  return 'TBD';
  return t;
}
function fmtTimeLong(t) {
  if (!t) return '—';
  const u = t.toUpperCase();
  if (u === 'BMO' || u === 'PRE')  return 'Pre-market';
  if (u === 'AMC' || u === 'POST') return 'After hours';
  if (u === 'TNS' || u === 'TBD')  return 'Time TBD';
  return t;
}
function timeSortKey(time, isWatched) {
  if (isWatched) return 0;
  const u = (time || '').toUpperCase();
  if (u === 'BMO' || u === 'PRE')  return 1;
  if (u === 'AMC' || u === 'POST') return 2;
  return 3;
}



export default function PageEarnings({
  T,
  tickers         = new Map(),
  watchlist       = new Set(),
  toggleWatchlist = () => {},
  sseRef          = null,
}) {
  const [weekOffset,      setWeekOffset]      = useState(0);
  const [selectedDay,     setSelectedDay]     = useState(null);
  const [earningsData,    setEarningsData]    = useState([]);
  const [loading,         setLoading]         = useState(true);
  const [error,           setError]           = useState(null);
  const [selectedEarning, setSelectedEarning] = useState(null);
  const [sectorFilter,    setSectorFilter]    = useState('ALL');

  const weekDates = useMemo(() => getWeekDates(weekOffset), [weekOffset]);

  // ── Fetch ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!weekDates.length) return;
    let cancelled = false;

    const normalize = (data) => {
      const arr = Array.isArray(data)           ? data
                : Array.isArray(data?.data)     ? data.data
                : Array.isArray(data?.earnings) ? data.earnings
                : Array.isArray(data?.results)  ? data.results
                : [];
      return arr.map(e => {
        const sym  = (e.ticker || e.symbol || '').toUpperCase();
        const live = tickers.get(sym) ?? {};
        // COMPANY-NAME-FIX: priority chain for company_name:
        //   1. DB earnings row company_name (most authoritative)
        //   2. Live SSE tickers Map company_name (from ws_engine._company_map / stock_list)
        //   3. Live SSE tickers Map company alias (legacy field name)
        //   4. e.name fallback (some API shapes use 'name')
        //   5. Empty string (renders as '—' in the table)
        // This fixes the case where the earnings table has no company_name column
        // for tickers that exist in the earnings calendar but not in stock_list.
        const company_name =
          (e.company_name && e.company_name !== sym ? e.company_name : null) ||
          live.company_name ||
          live.company      ||
          e.name            ||
          '';
        return {
          ...e,
          ticker:         sym,
          company_name,
          date:           e.earnings_date || e.date || e.report_date || '',
          time:           e.earnings_time || e.when || e.time || 'TNS',
          eps_est:        e.eps_estimate  || e.eps_est  || e.epsEstimate || null,
          rev_est:        e.revenue_estimate || e.rev_est || e.revenueEstimate || null,
          sector:         e.sector || live.sector || '',
          live_price:     live.live_price || live.price || e.live_price || null,
          percent_change: live.percent_change != null ? live.percent_change : (e.percent_change ?? null),
        };
      });
    };

    const run = async () => {
      setLoading(true); setError(null); setSectorFilter('ALL');
      const start = weekDates[0]?.isoDate;
      const end   = weekDates[weekDates.length - 1]?.isoDate;
      let normalized = [], lastErr = null;

      for (let attempt = 1; attempt <= 3; attempt++) {
        const ctrl    = new AbortController();
        const timeout = setTimeout(() => ctrl.abort(), 20_000);
        try {
          const res = await fetch(`${API_BASE}/api/earnings?start=${start}&end=${end}`, { signal: ctrl.signal });
          clearTimeout(timeout);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          normalized = normalize(await res.json());
          lastErr    = null;
          break;
        } catch (err) {
          clearTimeout(timeout);
          lastErr = err;
          if (attempt < 3) await new Promise(r => setTimeout(r, 2_000));
        }
      }

      if (normalized.length === 0) {
        try {
          const perDay = await Promise.all(weekDates.map(d => {
            const ctrl = new AbortController();
            const t    = setTimeout(() => ctrl.abort(), 10_000);
            return fetch(`${API_BASE}/api/earnings?start=${d.isoDate}&end=${d.isoDate}`, { signal: ctrl.signal })
              .then(r => { clearTimeout(t); return r.ok ? r.json() : []; })
              .then(normalize).catch(() => []);
          }));
          normalized = perDay.flat();
        } catch {}
      }

      if (cancelled) return;
      if (lastErr && normalized.length === 0) setError(lastErr.message);
      setEarningsData(normalized);
      setLoading(false);
    };

    run();
    return () => { cancelled = true; };
  }, [weekOffset]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── SSE live price patch (tick_batch / snapshot_delta) ───────────────────────
  useEffect(() => {
    if (!sseRef) return;
    let pollId = null, cleanup = () => { clearTimeout(pollId); };

    const attach = () => {
      const sse = sseRef?.current;
      if (!sse) { pollId = setTimeout(attach, 400); return; }

      const handlePayload = (payload) => {
        if (!payload || (payload.type !== 'tick_batch' && payload.type !== 'snapshot_delta')) return;
        const updates = {};
        (payload.data ?? []).forEach(r => {
          if (r?.ticker) updates[r.ticker] = r;
        });
        if (!Object.keys(updates).length) return;
        setEarningsData(prev => {
          let changed = false;
          const next = prev.map(e => {
            const r = updates[e.ticker];
            if (!r) return e;
            changed = true;
            return { ...e,
              live_price:     r.live_price || r.price || e.live_price,
              percent_change: r.percent_change ?? r.change_pct ?? e.percent_change,
            };
          });
          return changed ? next : prev;
        });
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
  }, [sseRef]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Day selection ────────────────────────────────────────────────────────────
  useEffect(() => {
    const t = weekDates.find(d => d.isToday);
    if (t) setSelectedDay(t.isoDate);
    else if (weekOffset === 0) setSelectedDay(null);
  }, [weekOffset]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const t = weekDates.find(d => d.isToday);
    if (t) setSelectedDay(t.isoDate);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const activeDay = selectedDay || weekDates.find(d => d.isToday)?.isoDate || weekDates[0]?.isoDate;

  // ── Derived data ─────────────────────────────────────────────────────────────
  const dayEarnings = useMemo(() => {
    if (!activeDay) return [];
    let rows = earningsData.filter(e => e.date === activeDay);
    if (sectorFilter !== 'ALL') rows = rows.filter(e => (e.sector||'').toUpperCase() === sectorFilter);
    return [...rows].sort((a, b) => {
      const ak = timeSortKey(a.time, watchlist.has(a.ticker));
      const bk = timeSortKey(b.time, watchlist.has(b.ticker));
      return ak - bk || a.ticker.localeCompare(b.ticker);
    });
  }, [earningsData, activeDay, sectorFilter, watchlist]);

  const availableSectors = useMemo(() => {
    const dayRows = activeDay ? earningsData.filter(e => e.date === activeDay) : [];
    const s = new Set(dayRows.map(e => (e.sector||'').toUpperCase()).filter(Boolean));
    return ['ALL', ...Array.from(s).sort()];
  }, [earningsData, activeDay]);

  const daySummary = useMemo(() => {
    const base = activeDay ? earningsData.filter(e => e.date === activeDay) : [];
    const pre   = base.filter(e => { const u=(e.time||'').toUpperCase(); return u==='BMO'||u==='PRE'; }).length;
    const after = base.filter(e => { const u=(e.time||'').toUpperCase(); return u==='AMC'||u==='POST'; }).length;
    const wl    = base.filter(e => watchlist.has(e.ticker)).length;
    return { total: base.length, pre, after, tbd: base.length-pre-after, watchlist: wl };
  }, [earningsData, activeDay, watchlist]);

  const HEADERS  = ['SYMBOL','COMPANY','DATE','TIME','PRICE','EPS EST','REV EST','SECTOR','WATCH'];
  const gridCols = '0.7fr 1.4fr 0.8fr 0.7fr 1fr 0.7fr 0.8fr 0.9fr 0.5fr';

  return (
    <div className="page-enter" style={{ display:'flex', flexDirection:'column', gap:14 }}>

      {/* Week nav */}
      <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
        <button className="btn-ghost" onClick={()=>setWeekOffset(o=>o-1)}>← PREV WEEK</button>
        {weekDates.map(d=>(
          <button key={d.isoDate} onClick={()=>setSelectedDay(d.isoDate)}
            style={{ background:activeDay===d.isoDate?T.cyanDim:T.bg2,
              border:`1px solid ${activeDay===d.isoDate?T.cyanMid:d.isToday?T.borderHi:T.border}`,
              color:activeDay===d.isoDate?T.cyan:d.isToday?T.text0:T.text2,
              borderRadius:5, padding:'6px 13px', cursor:'pointer', fontFamily:T.font,
              fontSize:10, letterSpacing:1, display:'flex', flexDirection:'column', alignItems:'center', gap:2 }}>
            <span>{d.day}</span>
            <span style={{ fontSize:8, opacity:0.7 }}>{d.date}</span>
            {d.isToday&&<span style={{ fontSize:7, color:T.cyan }}>TODAY</span>}
          </button>
        ))}
        <button className="btn-ghost" onClick={()=>setWeekOffset(o=>o+1)}>NEXT WEEK →</button>
        {weekOffset!==0&&<button className="btn-ghost" onClick={()=>setWeekOffset(0)} style={{ fontSize:9, marginLeft:'auto' }}>THIS WEEK</button>}
      </div>

      <div style={{ display:'flex', gap:16, flexWrap:'wrap' }}>
        <div className="card" style={{ flex:2, minWidth:300 }}>
          <SectionHeader title={`Earnings Calendar${activeDay?` · ${weekDates.find(d=>d.isoDate===activeDay)?.date||''}`:''}`} T={T}>
            {loading ? <Chip color={T.gold} T={T}>LOADING</Chip> : <Chip color={T.green} T={T}>{dayEarnings.length} EARNINGS</Chip>}
            {daySummary.watchlist>0&&<Chip color={T.gold} T={T}>★ {daySummary.watchlist} WATCHED</Chip>}
          </SectionHeader>

          {/* Sector filter pills */}
          {availableSectors.length > 1 && (
            <div style={{ display:'flex', gap:6, padding:'7px 12px', borderBottom:`1px solid ${T.border}`, flexWrap:'wrap', background:T.bg0 }}>
              {availableSectors.map(s=>(
                <button key={s} onClick={()=>setSectorFilter(s)}
                  style={{ background:sectorFilter===s?T.cyanDim:'transparent',
                    border:`1px solid ${sectorFilter===s?T.cyanMid:T.border}`,
                    color:sectorFilter===s?T.cyan:T.text2,
                    borderRadius:4, padding:'3px 9px', cursor:'pointer',
                    fontFamily:T.font, fontSize:8, fontWeight:sectorFilter===s?700:400, transition:'all 0.12s' }}>
                  {s}
                </button>
              ))}
            </div>
          )}

          {/* Header */}
          <div style={{ display:'grid', gridTemplateColumns:gridCols, background:T.bg0, borderBottom:`1px solid ${T.border}` }}>
            {HEADERS.map(h=>(
              <div key={h} style={{ padding:'9px 12px', color:T.text1, fontSize:9, letterSpacing:1.5, fontFamily:T.font, fontWeight:800, textTransform:'uppercase' }}>{h}</div>
            ))}
          </div>

          {/* Rows */}
          <div style={{ maxHeight:'calc(100vh - 470px)', minHeight:'280px', overflowY:'auto', position:'relative' }}>
            {error ? (
              <EmptyState icon="⚠" label="ERROR LOADING EARNINGS" sub={error} h={200} T={T}/>
            ) : loading ? (
              Array(8).fill(0).map((_,i)=>(
                <div key={i} className="tr-hover" style={{ display:'grid', gridTemplateColumns:gridCols, borderBottom:`1px solid #080f1a` }}>
                  {[50,100,60,50,70,40,55,70,26].map((w,j)=>(
                    <div key={j} style={{ padding:'11px 12px' }}>
                      {j===8?<div style={{ width:26,height:16,background:T.cyanDim,border:`1px solid ${T.cyanMid}`,borderRadius:3 }}/>
                             :<Shimmer w={w} h={10} opacity={j===0?0.75:0.45} T={T}/>}
                    </div>
                  ))}
                </div>
              ))
            ) : dayEarnings.length===0 ? (
              <EmptyState icon="◎" label="NO EARNINGS"
                sub={sectorFilter!=='ALL'?`No ${sectorFilter} earnings on this day`:"No earnings scheduled for this day"}
                h={200} T={T}/>
            ) : (
              <>
                {dayEarnings.map((earning,i)=>{
                  const isSelected = selectedEarning?.ticker===earning.ticker;
                  const isWatched  = watchlist.has(earning.ticker);
                  const pct        = earning.percent_change;
                  const pctColor   = pct==null?T.text2:pct>=0?T.green:T.red;
                  return (
                    <div key={earning.ticker+i}
                      onClick={()=>setSelectedEarning(isSelected?null:earning)}
                      className="tr-hover"
                      style={{ display:'grid', gridTemplateColumns:gridCols,
                        borderBottom:`1px solid ${T.border}`,
                        borderLeft:isWatched?`3px solid ${T.gold}`:'3px solid transparent',
                        background:isSelected?T.cyanDim:isWatched?T.gold+'08':'transparent',
                        cursor:'pointer' }}>

                      <div style={{ padding:'11px 12px', display:'flex', alignItems:'center', gap:5 }}>
                        {isWatched&&<span style={{ color:T.gold, fontSize:9 }}>★</span>}
                        <span style={{ color:T.cyan, fontSize:12, fontFamily:T.font, fontWeight:700 }}>{earning.ticker}</span>
                      </div>
                      <div style={{ padding:'11px 12px', color:T.text2, fontSize:10, fontFamily:T.font,
                        whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                        {earning.company_name||'—'}
                      </div>
                      <div style={{ padding:'11px 12px', color:T.text1, fontSize:11, fontFamily:T.font, fontWeight:600 }}>
                        {earning.date||'—'}
                      </div>
                      <div style={{ padding:'11px 12px', color:T.text1, fontSize:11, fontFamily:T.font, fontWeight:600 }}>
                        {fmtTime(earning.time)}
                      </div>
                      <div style={{ padding:'11px 12px', fontFamily:T.font, fontSize:11 }}>
                        {earning.live_price!=null
                          ?<><span style={{ color:T.text0, fontWeight:700 }}>${fmt2(earning.live_price)}</span>
                              {pct!=null&&<span style={{ color:pctColor, fontSize:10, marginLeft:4 }}>{pct>=0?'+':''}{pct.toFixed(2)}%</span>}</>
                          :<span style={{ color:T.text2 }}>—</span>}
                      </div>
                      <div style={{ padding:'11px 12px', color:T.text1, fontSize:11, fontFamily:T.font, fontWeight:600 }}>
                        {earning.eps_est!=null?`$${earning.eps_est}`:'—'}
                      </div>
                      <div style={{ padding:'11px 12px', color:T.text1, fontSize:11, fontFamily:T.font, fontWeight:600 }}>
                        {earning.rev_est!=null?fmtK(earning.rev_est):'—'}
                      </div>
                      <div style={{ padding:'11px 12px', color:T.text2, fontSize:10, fontFamily:T.font, fontWeight:600 }}>
                        {earning.sector||'—'}
                      </div>
                      <div style={{ padding:'11px 12px' }}>
                        <button onClick={e=>{e.stopPropagation();toggleWatchlist(earning.ticker);}}
                          className="btn-ghost"
                          style={{ fontSize:8, padding:'3px 8px', fontWeight:600,
                            color:isWatched?T.gold:T.text2, borderColor:isWatched?T.gold:T.border }}>
                          {isWatched?'★':'☆'}
                        </button>
                      </div>
                    </div>
                  );
                })}
                {dayEarnings.length>=10&&(
                  <div style={{ position:'sticky', bottom:0, left:0, right:0, height:36,
                    background:`linear-gradient(to bottom, transparent, ${T.bg1})`, pointerEvents:'none' }}/>
                )}
              </>
            )}
          </div>
        </div>

        {/* Right panel */}
        <div style={{ flex:1, minWidth:200, display:'flex', flexDirection:'column', gap:14 }}>
          <div className="card">
            <SectionHeader title={selectedEarning?selectedEarning.ticker:'Selected Earnings'} T={T}>
              {selectedEarning&&<Chip color={T.cyan} T={T}>{selectedEarning.company_name||selectedEarning.ticker}</Chip>}
            </SectionHeader>
            {!selectedEarning ? (
              <EmptyState icon="◎" label="SELECT A TICKER" sub="Click any row to see earnings details" h={130} T={T}/>
            ) : (
              <div style={{ padding:14, display:'flex', flexDirection:'column', gap:10 }}>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                  {[
                    { label:'REPORT DATE', value: selectedEarning.date||'—' },
                    { label:'TIME',        value: fmtTimeLong(selectedEarning.time) },
                    { label:'EPS EST',     value: selectedEarning.eps_est!=null?`$${selectedEarning.eps_est}`:'—' },
                    { label:'REV EST',     value: selectedEarning.rev_est!=null?fmtK(selectedEarning.rev_est):'—' },
                  ].map(s=>(
                    <div key={s.label} style={{ background:T.bg0, borderRadius:4, padding:'8px 10px' }}>
                      <div style={{ color:T.text2, fontSize:8, letterSpacing:1.5, fontFamily:T.font, marginBottom:3 }}>{s.label}</div>
                      <div style={{ color:T.text0, fontSize:12, fontFamily:T.font, fontWeight:700 }}>{s.value}</div>
                    </div>
                  ))}
                </div>
                {selectedEarning.live_price!=null&&(
                  <div style={{ background:T.bg0, borderRadius:4, padding:'10px 12px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                    <span style={{ color:T.text2, fontSize:9, fontFamily:T.font }}>LIVE PRICE</span>
                    <span style={{ color:T.cyan, fontSize:16, fontFamily:T.font, fontWeight:700 }}>
                      ${fmt2(selectedEarning.live_price)}
                      {selectedEarning.percent_change!=null&&(
                        <span style={{ fontSize:11, marginLeft:6, color:selectedEarning.percent_change>=0?T.green:T.red }}>
                          {selectedEarning.percent_change>=0?'+':''}{selectedEarning.percent_change.toFixed(2)}%
                        </span>
                      )}
                    </span>
                  </div>
                )}
                {selectedEarning.sector&&(
                  <div style={{ display:'flex', justifyContent:'space-between', padding:'6px 0', borderTop:`1px solid ${T.border}` }}>
                    <span style={{ color:T.text2, fontSize:9, fontFamily:T.font }}>SECTOR</span>
                    <span style={{ color:T.text1, fontSize:10, fontFamily:T.font, fontWeight:600 }}>{selectedEarning.sector}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="card">
            <SectionHeader title="Day Summary" T={T}/>
            <div style={{ padding:14 }}>
              {[
                { label:'EARNINGS TODAY', value:daySummary.total||'—' },
                { label:'★ WATCHLIST',   value:daySummary.watchlist||'—', color:T.gold },
                { label:'PRE-MARKET',    value:daySummary.pre||'—',       color:T.cyan },
                { label:'AFTER HOURS',   value:daySummary.after||'—',     color:T.purple },
                { label:'TIME TBD',      value:daySummary.tbd||'—' },
              ].map(s=>(
                <div key={s.label} style={{ display:'flex', justifyContent:'space-between', padding:'8px 0', borderBottom:`1px solid ${T.border}` }}>
                  <span style={{ color:T.text2, fontSize:9.5, fontFamily:T.font }}>{s.label}</span>
                  <span style={{ color:s.color||T.text0, fontSize:12, fontFamily:T.font, fontWeight:700 }}>{s.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
