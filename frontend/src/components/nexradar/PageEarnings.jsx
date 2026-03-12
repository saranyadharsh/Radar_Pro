/**
 * PageEarnings.jsx — NexRadar Pro
 * Full-page earnings calendar with week navigation, day pills, per-day fallback fetch.
 * Props: { T }
 */
import { useState, useEffect, useMemo } from 'react';
import { SectionHeader, Chip, Shimmer, EmptyState } from './primitives.jsx';
import { fmtK, getWeekDates } from './utils.js';
import { API_BASE } from '../../config.js';

export default function PageEarnings({ T }) {
  const [weekOffset,   setWeekOffset]   = useState(0);
  const [selectedDay,  setSelectedDay]  = useState(null);
  const [earningsData, setEarningsData] = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState(null);

  const weekDates = useMemo(() => getWeekDates(weekOffset), [weekOffset]);

  useEffect(() => {
    const fetchEarnings = async () => {
      try {
        setLoading(true);
        setError(null);
        const startDate = weekDates[0]?.isoDate;
        const endDate   = weekDates[weekDates.length - 1]?.isoDate;

        const normalize = (data) => {
          const arr = Array.isArray(data)          ? data         :
                      Array.isArray(data?.data)    ? data.data    :
                      Array.isArray(data?.earnings) ? data.earnings :
                      Array.isArray(data?.results) ? data.results : [];
          return arr.map(e => ({
            ...e,
            ticker:       e.ticker        || e.symbol       || '',
            company_name: e.company_name  || e.name         || '',
            date:         e.earnings_date || e.date         || e.report_date || '',
            time:         e.earnings_time || e.time         || e.when        || 'TNS',
            eps_est:      e.eps_estimate  || e.eps_est      || e.epsEstimate || null,
            rev_est:      e.rev_estimate  || e.rev_est      || e.revenueEstimate || null,
          }));
        };

        const res  = await fetch(`${API_BASE}/api/earnings?start=${startDate}&end=${endDate}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        let normalized = normalize(data);

        // Per-day fallback if week range returned nothing
        if (normalized.length === 0) {
          const perDayResults = await Promise.all(
            weekDates.map(d =>
              fetch(`${API_BASE}/api/earnings?start=${d.isoDate}&end=${d.isoDate}`)
                .then(r => r.ok ? r.json() : [])
                .then(d => normalize(d))
                .catch(() => [])
            )
          );
          normalized = perDayResults.flat();
        }

        setEarningsData(normalized);
        setLoading(false);
      } catch (err) {
        setError(err.message);
        setEarningsData([]);
        setLoading(false);
      }
    };

    if (weekDates.length > 0) fetchEarnings();
  }, [weekOffset, weekDates]);

  useEffect(() => {
    const todayEntry = weekDates.find(d => d.isToday);
    if (todayEntry)         setSelectedDay(todayEntry.isoDate);
    else if (weekOffset === 0) setSelectedDay(null);
  }, [weekOffset, weekDates]);

  const activeDay    = selectedDay || weekDates.find(d => d.isToday)?.isoDate || weekDates[0]?.isoDate;
  const dayEarnings  = useMemo(() => {
    if (!activeDay) return [];
    return earningsData.filter(e => e.date === activeDay);
  }, [earningsData, activeDay]);

  const HEADERS = ['SYMBOL','DATE','TIME','EPS EST','REV EST','MKT CAP','SECTOR','WATCH'];

  return (
    <div className="page-enter" style={{ display:'flex', flexDirection:'column', gap:16 }}>
      {/* Navigation */}
      <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
        <button className="btn-ghost" onClick={()=>setWeekOffset(o=>o-1)}>← PREV WEEK</button>
        {weekDates.map(d=>(
          <button key={d.isoDate} onClick={()=>setSelectedDay(d.isoDate)}
            style={{ background:activeDay===d.isoDate?T.cyanDim:T.bg2, border:`1px solid ${activeDay===d.isoDate?T.cyanMid:d.isToday?T.borderHi:T.border}`,
              color:activeDay===d.isoDate?T.cyan:d.isToday?T.text0:T.text2, borderRadius:5, padding:'6px 13px',
              cursor:'pointer', fontFamily:T.font, fontSize:10, letterSpacing:1,
              display:'flex', flexDirection:'column', alignItems:'center', gap:2 }}>
            <span>{d.day}</span>
            <span style={{ fontSize:8, opacity:0.7 }}>{d.date}</span>
            {d.isToday&&<span style={{ fontSize:7, color:T.cyan }}>TODAY</span>}
          </button>
        ))}
        <button className="btn-ghost" onClick={()=>setWeekOffset(o=>o+1)}>NEXT WEEK →</button>
        <div style={{ marginLeft:'auto', display:'flex', gap:8 }}>
          {weekOffset!==0&&<button className="btn-ghost" onClick={()=>setWeekOffset(0)} style={{ fontSize:9 }}>THIS WEEK</button>}
          <button className="btn-primary">+ ADD TO WATCHLIST</button>
        </div>
      </div>

      <div style={{ display:'flex', gap:16, flexWrap:'wrap' }}>
        {/* Main table */}
        <div className="card" style={{ flex:2, minWidth:300 }}>
          <SectionHeader title={`Earnings Calendar${activeDay?` · ${weekDates.find(d=>d.isoDate===activeDay)?.date||''}`:''}`} T={T}>
            {loading
              ? <Chip color={T.gold} T={T}>LOADING</Chip>
              : <Chip color={T.green} T={T}>{dayEarnings.length} EARNINGS</Chip>
            }
          </SectionHeader>
          <div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(8,1fr)', background:T.bg0, borderBottom:`1px solid ${T.border}` }}>
              {HEADERS.map(h=>(
                <div key={h} style={{ padding:'9px 12px', color:T.text1, fontSize:9, letterSpacing:1.5, fontFamily:T.font, fontWeight:800, textTransform:'uppercase' }}>{h}</div>
              ))}
            </div>
            <div style={{ maxHeight:'calc(100vh - 450px)', minHeight:'300px', overflowY:'auto', position:'relative' }}>
              {error ? (
                <EmptyState icon="⚠" label="ERROR LOADING EARNINGS" sub={error} h={200} T={T}/>
              ) : loading ? (
                Array(10).fill(0).map((_,i)=>(
                  <div key={i} className="tr-hover" style={{ display:'grid', gridTemplateColumns:'repeat(8,1fr)', borderBottom:`1px solid #080f1a` }}>
                    {[50,55,70,55,70,55,60,45].map((w,j)=>(
                      <div key={j} style={{ padding:'11px 12px' }}>
                        {j===7
                          ? <div style={{ width:26,height:16,background:T.cyanDim,border:`1px solid ${T.cyanMid}`,borderRadius:3 }}/>
                          : <Shimmer w={w} h={10} opacity={j===0?0.75:0.45} T={T}/>
                        }
                      </div>
                    ))}
                  </div>
                ))
              ) : dayEarnings.length===0 ? (
                <EmptyState icon="◎" label="NO EARNINGS" sub="No earnings scheduled for this day" h={200} T={T}/>
              ) : (
                <>
                  {dayEarnings.map((earning,i)=>(
                    <div key={i} className="tr-hover" style={{ display:'grid', gridTemplateColumns:'repeat(8,1fr)', borderBottom:`1px solid ${T.border}` }}>
                      <div style={{ padding:'11px 12px', color:T.cyan, fontSize:12, fontFamily:T.font, fontWeight:700 }}>{earning.ticker||earning.symbol}</div>
                      <div style={{ padding:'11px 12px', color:T.text1, fontSize:11, fontFamily:T.font, fontWeight:600 }}>{earning.date||earning.earnings_date}</div>
                      <div style={{ padding:'11px 12px', color:T.text1, fontSize:11, fontFamily:T.font, fontWeight:600 }}>{earning.time||earning.earnings_time||'—'}</div>
                      <div style={{ padding:'11px 12px', color:T.text1, fontSize:11, fontFamily:T.font, fontWeight:600 }}>{earning.eps_est||earning.eps_estimate||'—'}</div>
                      <div style={{ padding:'11px 12px', color:T.text1, fontSize:11, fontFamily:T.font, fontWeight:600 }}>{earning.rev_est||earning.revenue_estimate||'—'}</div>
                      <div style={{ padding:'11px 12px', color:T.text1, fontSize:11, fontFamily:T.font, fontWeight:600 }}>{earning.market_cap?fmtK(earning.market_cap):'—'}</div>
                      <div style={{ padding:'11px 12px', color:T.text2, fontSize:10, fontFamily:T.font, fontWeight:600 }}>{earning.sector||'—'}</div>
                      <div style={{ padding:'11px 12px' }}><button className="btn-ghost" style={{ fontSize:8, padding:'3px 8px', fontWeight:600 }}>⭐</button></div>
                    </div>
                  ))}
                  {dayEarnings.length>=10&&(
                    <div style={{ position:'sticky', bottom:0, left:0, right:0, height:40,
                      background:`linear-gradient(to bottom, transparent, ${T.bg1})`, pointerEvents:'none' }}/>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Right panel */}
        <div style={{ flex:1, minWidth:190, display:'flex', flexDirection:'column', gap:14 }}>
          <div className="card">
            <SectionHeader title="Selected Earnings"/>
            <EmptyState icon="◎" label="SELECT A TICKER" sub="Click any row to see earnings details, historical beats/misses, and implied move" h={140}/>
          </div>
          <div className="card">
            <SectionHeader title="Gap Stats"/>
            <div style={{ padding:14 }}>
              {['AVG GAP UP','AVG GAP DOWN','BEAT RATE','MISS RATE'].map(s=>(
                <div key={s} style={{ display:'flex', justifyContent:'space-between', padding:'8px 0', borderBottom:`1px solid ${T.border}` }}>
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
