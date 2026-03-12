/**
 * PageSignals.jsx — NexRadar Pro
 * Sub-tabs: SIGNALS (Pro Scalp), TECH (tech analysis), EARNINGS (EarningsSubPanel)
 * Props: { tickers, selectedSectors, techData, techLoading, techError,
 *          techLastFetch, techCached, techDataAge, onForceFetch, T }
 *
 * REGRESSION FIX applied:
 *   FIX-4  The EARNINGS tab content (signalView==='EARNINGS') existed but no
 *          button in the tab bar could ever set signalView to 'EARNINGS'.
 *          The EARNINGS button was simply missing from the JSX.
 *          Fix: added a dedicated ◎ EARNINGS tab button next to ◉ SIGNALS
 *          in the top tab bar. When active it shows EarningsSubPanel and
 *          hides the SIGNALS/TECH sub-navigation to avoid visual clutter.
 */
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { SectionHeader, Shimmer, EmptyState } from './primitives.jsx';
import { fmt2, getWeekDates } from './utils.js';
import { API_BASE } from '../../config.js';

function EarningsSubPanel({ T }) {
  const [weekOffset,   setWeekOffset]   = useState(0);
  const [selectedDay,  setSelectedDay]  = useState(null);
  const [earningsData, setEarningsData] = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState(null);
  const weekDates = useMemo(() => getWeekDates(weekOffset), [weekOffset]);

  useEffect(() => {
    setLoading(true); setError(null);
    const start = weekDates[0]?.isoDate;
    const end   = weekDates[weekDates.length - 1]?.isoDate;
    fetch(`${API_BASE}/api/earnings?start=${start}&end=${end}`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(d  => { setEarningsData(d || []); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [weekOffset, weekDates]);

  useEffect(() => {
    const today = weekDates.find(d => d.isToday);
    if (today) setSelectedDay(today.isoDate);
    else if (weekOffset === 0) setSelectedDay(null);
  }, [weekOffset, weekDates]);

  const activeDay   = selectedDay || weekDates.find(d => d.isToday)?.isoDate || weekDates[0]?.isoDate;
  const dayEarnings = useMemo(() =>
    earningsData.filter(e => e.date === activeDay || e.earnings_date === activeDay),
  [earningsData, activeDay]);

  const COLS = ['SYMBOL','COMPANY','DATE','TIME','EPS EST','REV EST','SECTOR'];
  const GRID = '90px 1fr 80px 70px 80px 80px 100px';

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
      <div style={{ display:'flex', gap:6, alignItems:'center', flexWrap:'wrap' }}>
        <button className="btn-ghost" style={{ fontSize:9 }} onClick={()=>setWeekOffset(o=>o-1)}>← PREV</button>
        {weekDates.map(d=>(
          <button key={d.isoDate} onClick={()=>setSelectedDay(d.isoDate)}
            style={{ background:activeDay===d.isoDate?T.cyanDim:T.bg2,
              border:`1px solid ${activeDay===d.isoDate?T.cyanMid:d.isToday?T.borderHi:T.border}`,
              color:activeDay===d.isoDate?T.cyan:d.isToday?T.text0:T.text2,
              borderRadius:5, padding:'5px 12px', cursor:'pointer', fontFamily:T.font, fontSize:9,
              display:'flex', flexDirection:'column', alignItems:'center', gap:1 }}>
            <span>{d.day}</span>
            <span style={{ fontSize:8, opacity:0.7 }}>{d.date}</span>
            {d.isToday && <span style={{ fontSize:7, color:T.cyan }}>TODAY</span>}
          </button>
        ))}
        <button className="btn-ghost" style={{ fontSize:9 }} onClick={()=>setWeekOffset(o=>o+1)}>NEXT →</button>
        {weekOffset!==0 && <button className="btn-ghost" style={{ fontSize:9 }} onClick={()=>setWeekOffset(0)}>THIS WEEK</button>}
        <span style={{ marginLeft:'auto', color:T.text2, fontSize:10, fontFamily:T.font }}>
          {loading?'Loading…':`${dayEarnings.length} earnings`}
        </span>
      </div>
      <div className="card" style={{ overflow:'hidden' }}>
        <div style={{ display:'grid', gridTemplateColumns:GRID, background:T.bg0, borderBottom:`2px solid ${T.border}` }}>
          {COLS.map(h=><div key={h} style={{ padding:'9px 10px', color:T.text1, fontSize:9, letterSpacing:1, fontFamily:T.font, fontWeight:800 }}>{h}</div>)}
        </div>
        <div style={{ maxHeight:'calc(100vh - 480px)', overflowY:'auto' }}>
          {error ? (
            <EmptyState icon="⚠" label="ERROR" sub={error} h={120} T={T}/>
          ) : loading ? (
            Array(8).fill(0).map((_,i)=>(
              <div key={i} style={{ display:'grid', gridTemplateColumns:GRID, borderBottom:`1px solid ${T.border}`, padding:'10px 0' }}>
                {Array(7).fill(0).map((_,j)=><div key={j} className="shimmer-box" style={{ height:11, margin:'0 10px' }}/>)}
              </div>
            ))
          ) : dayEarnings.length===0 ? (
            <EmptyState icon="◎" label="NO EARNINGS" sub="No earnings scheduled for this day" h={140} T={T}/>
          ) : dayEarnings.map((e,i)=>(
            <div key={i} className="tr-hover" style={{ display:'grid', gridTemplateColumns:GRID, borderBottom:`1px solid ${T.border}` }}>
              <div style={{ padding:'10px', color:T.cyan, fontSize:12, fontFamily:T.font, fontWeight:700 }}>{e.ticker||e.symbol}</div>
              <div style={{ padding:'10px', color:T.text1, fontSize:11, fontFamily:T.font, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{e.company_name||'—'}</div>
              <div style={{ padding:'10px', color:T.text2, fontSize:11, fontFamily:T.font }}>{e.date||e.earnings_date||'—'}</div>
              <div style={{ padding:'10px', fontSize:10, fontFamily:T.font, fontWeight:600,
                color:e.earnings_time==='BMO'?T.gold:e.earnings_time==='AMC'?T.purple:T.text2 }}>
                {e.earnings_time||e.time||'—'}
              </div>
              <div style={{ padding:'10px', color:T.text1, fontSize:11, fontFamily:T.font }}>{e.eps_estimate||e.eps_est||'—'}</div>
              <div style={{ padding:'10px', color:T.text1, fontSize:11, fontFamily:T.font }}>{e.revenue_estimate||e.rev_est||'—'}</div>
              <div style={{ padding:'10px', color:T.text2, fontSize:10, fontFamily:T.font }}>{e.sector||'—'}</div>
            </div>
          ))}
        </div>
        <div style={{ padding:'10px 16px', borderTop:`2px solid ${T.border}`, display:'flex', justifyContent:'space-between', background:T.bg0 }}>
          <span style={{ color:T.text1, fontSize:11, fontFamily:T.font, fontWeight:600 }}>
            {dayEarnings.length} earnings · {weekDates.find(d=>d.isoDate===activeDay)?.date||''}
          </span>
          <span style={{ color:T.text2, fontSize:10, fontFamily:T.font }}>BMO = Before Open · AMC = After Close</span>
        </div>
      </div>
    </div>
  );
}

const PRO_COLS = [
  { key:'ticker',       label:'TICKER',    w:'90px'  },
  { key:'price',        label:'PRICE',     w:'80px'  },
  { key:'signal',       label:'SIGNAL',    w:'90px'  },
  { key:'prediction',   label:'PRED %',    w:'70px'  },
  { key:'vwap_status',  label:'VWAP',      w:'80px'  },
  { key:'support',      label:'SUPPORT',   w:'80px'  },
  { key:'resistance',   label:'RESIST',    w:'80px'  },
  { key:'candle',       label:'CANDLE',    w:'130px' },
  { key:'macd_signal',  label:'MACD',      w:'80px'  },
  { key:'rsi',          label:'RSI',       w:'55px'  },
  { key:'stoch_signal', label:'STOCH',     w:'80px'  },
  { key:'volume',       label:'VOLUME',    w:'70px'  },
  { key:'trend',        label:'TREND',     w:'85px'  },
  { key:'adx',          label:'ADX',       w:'80px'  },
  { key:'supertrend',   label:'SUPRTRND',  w:'85px'  },
  { key:'order_block',  label:'ORDR BLK',  w:'85px'  },
  { key:'confluence',   label:'CONFLUENC', w:'80px'  },
  { key:'tp',           label:'TP | SL',   w:'130px' },
];
const TECH_COLS = [
  { key:'ticker',         label:'TICKER',      w:'90px'  },
  { key:'price',          label:'PRICE',       w:'80px'  },
  { key:'score',          label:'SCORE',       w:'70px'  },
  { key:'trend',          label:'TREND',       w:'85px'  },
  { key:'rsi',            label:'RSI',         w:'55px'  },
  { key:'rsi_signal',     label:'RSI SIG',     w:'90px'  },
  { key:'bb_status',      label:'BB STATUS',   w:'135px' },
  { key:'candlestick',    label:'CANDLE',      w:'135px' },
  { key:'atr',            label:'ATR',         w:'65px'  },
  { key:'rvol',           label:'RVOL',        w:'60px'  },
  { key:'inst_footprint', label:'INST. PRINT', w:'175px' },
  { key:'fcf_yield',      label:'FCF %',       w:'65px'  },
  { key:'de_ratio',       label:'D/E',         w:'55px'  },
];

export default function PageSignals({
  tickers=new Map(), selectedSectors=['ALL'],
  techData=[], techLoading=false, techError=null,
  techLastFetch=null, techCached=false, techDataAge=0,
  onForceFetch=()=>{}, T,
}) {
  const [signalView, setSignalView] = useState('SIGNALS');
  const [proData,    setProData]    = useState([]);
  const [proLoading, setProLoading] = useState(false);
  const [proError,   setProError]   = useState(null);
  const [proFilter,  setProFilter]  = useState('ALL');
  const [proSort,    setProSort]    = useState('confidence');
  const [proSortAsc, setProSortAsc] = useState(false);
  const proIntervalRef = useRef(null);

  const fetchProData = useCallback(()=>{
    setProLoading(true); setProError(null);
    fetch(`${API_BASE}/api/scalp-analysis`)
      .then(r=>{ if(!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(d=>{ setProData(d.data||[]); })
      .catch(e=>setProError(e.message))
      .finally(()=>setProLoading(false));
  },[]);

  useEffect(()=>{
    if(signalView==='SIGNALS'){
      fetchProData();
      proIntervalRef.current=setInterval(fetchProData,30_000);
    } else {
      clearInterval(proIntervalRef.current);
    }
    return ()=>clearInterval(proIntervalRef.current);
  },[signalView,fetchProData]);

  const [techSortKey, setTechSortKey] = useState('score');
  const [techSortAsc, setTechSortAsc] = useState(false);
  const [techFilter,  setTechFilter]  = useState('ALL');
  const fetchTechData = (force=false)=>onForceFetch(force);

  const proRows = useMemo(()=>{
    let rows=proData.filter(r=>!r.status||r.status==='ok');
    if(proFilter==='BUY')    rows=rows.filter(r=>r.signal==='BUY');
    else if(proFilter==='SELL')   rows=rows.filter(r=>r.signal==='SELL');
    else if(proFilter==='STRONG') rows=rows.filter(r=>r.strength==='STRONG');
    return [...rows].sort((a,b)=>{
      let va=a[proSort]??0,vb=b[proSort]??0;
      if(typeof va==='string') return proSortAsc?va.localeCompare(vb):vb.localeCompare(va);
      return proSortAsc?va-vb:vb-va;
    });
  },[proData,proFilter,proSort,proSortAsc]);

  const proWarmingUp=proData.filter(r=>r.status==='warming_up');
  const proStats=useMemo(()=>({
    buy:    proData.filter(r=>r.signal==='BUY').length,
    sell:   proData.filter(r=>r.signal==='SELL').length,
    strong: proData.filter(r=>r.strength==='STRONG').length,
    total:  proData.filter(r=>!r.status||r.status==='ok').length,
  }),[proData]);
  const handleProSort=key=>{
    if(proSort===key)setProSortAsc(!proSortAsc);
    else{setProSort(key);setProSortAsc(false);}
  };

  const techRows=useMemo(()=>{
    let rows=[...techData];
    if(techFilter==='BULLISH') rows=rows.filter(r=>r.score>0);
    else if(techFilter==='BEARISH') rows=rows.filter(r=>r.score<0);
    else if(techFilter==='ALERTS')  rows=rows.filter(r=>r.alerts?.length>0);
    rows.sort((a,b)=>{
      let va=a[techSortKey]??(techSortAsc?Infinity:-Infinity);
      let vb=b[techSortKey]??(techSortAsc?Infinity:-Infinity);
      if(typeof va==='string') return techSortAsc?va.localeCompare(vb):vb.localeCompare(va);
      return techSortAsc?va-vb:vb-va;
    });
    return rows;
  },[techData,techFilter,techSortKey,techSortAsc]);

  const techStats=useMemo(()=>{
    if(!techData.length) return null;
    return {
      bullish:    techData.filter(r=>r.score>0).length,
      bearish:    techData.filter(r=>r.score<0).length,
      oversold:   techData.filter(r=>r.rsi_signal==='Oversold').length,
      overbought: techData.filter(r=>r.rsi_signal==='Overbought').length,
      alerts:     techData.filter(r=>r.alerts?.length>0).length,
    };
  },[techData]);
  const handleTechSort=key=>{
    if(techSortKey===key)setTechSortAsc(!techSortAsc);
    else{setTechSortKey(key);setTechSortAsc(false);}
  };

  const _sigClr   =s=>s==='BUY'?T.green:s==='SELL'?T.red:T.text2;
  const _sigBg    =s=>s==='BUY'?T.greenDim:s==='SELL'?T.redDim:T.bg2;
  const _vwapClr  =s=>s==='ABOVE'?T.green:T.red;
  const _macdClr  =s=>s==='Bullish'?T.green:s==='Bearish'?T.red:T.text2;
  const _stochClr =s=>s==='Bullish'?T.green:s==='Bearish'?T.red:T.text2;
  const _trendClr =t=>t==='Bullish'?T.green:t==='Bearish'?T.red:T.text2;
  const _candleClr=p=>p?.includes('Bullish')?T.green:p?.includes('Bearish')?T.red:p?.includes('Doji')?T.gold:T.text2;
  const _scoreClr =s=>s>=3?T.green:s>=1?T.cyan:s<=-3?T.red:s<=-1?T.orange:T.text1;
  const _rsiClr   =(r,s)=>s==='Overbought'?T.red:s==='Oversold'?T.green:r>60?T.orange:r<40?T.cyan:T.text1;
  const _bbClr    =s=>s?.includes('Overextended')?T.red:s?.includes('Bounce')?T.green:T.text2;
  const _instClr  =s=>s?.includes('Accumulation')?T.green:s?.includes('Distribution')?T.red:T.text2;
  const _stClr    =s=>s==='UP'?T.green:s==='DOWN'?T.red:T.text2;
  const _obClr    =s=>s==='BULLISH_OB'?T.green:s==='BEARISH_OB'?T.red:T.text2;

  const proGridCols =PRO_COLS.map(c=>c.w).join(' ');
  const techGridCols=TECH_COLS.map(c=>c.w).join(' ');

  // FIX-4: determine whether SIGNALS/TECH sub-nav should show
  const showSignalsNav = signalView === 'SIGNALS' || signalView === 'TECH';

  return (
    <div className="page-enter" style={{ display:'flex', flexDirection:'column', gap:16 }}>

      {/* ── TAB BAR ── */}
      <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
        <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>

          {/* FIX-4: Tab button group — SIGNALS and EARNINGS are peers */}
          <div style={{ display:'flex', background:T.bg0, border:`1px solid ${T.border}`, borderRadius:8, overflow:'hidden' }}>
            <button onClick={()=>setSignalView('SIGNALS')}
              style={{ background:signalView==='SIGNALS'||signalView==='TECH'?T.cyan:'transparent',
                color:signalView==='SIGNALS'||signalView==='TECH'?'#000':T.text2,
                border:'none', padding:'8px 20px', cursor:'pointer',
                fontFamily:T.font, fontSize:10.5, letterSpacing:0.7, fontWeight:700 }}>
              ◉ SIGNALS
            </button>
            {/* FIX-4: EARNINGS tab button — was missing, making signalView=EARNINGS unreachable */}
            <button onClick={()=>setSignalView('EARNINGS')}
              style={{ background:signalView==='EARNINGS'?T.gold:'transparent',
                color:signalView==='EARNINGS'?'#000':T.text2,
                border:'none', borderLeft:`1px solid ${T.border}`, padding:'8px 20px', cursor:'pointer',
                fontFamily:T.font, fontSize:10.5, letterSpacing:0.7, fontWeight:700 }}>
              ◎ EARNINGS
            </button>
          </div>

          {showSignalsNav&&(
            <>
              <div style={{ width:1, height:22, background:T.border, flexShrink:0 }}/>
              {[{lbl:'BUY',val:proStats.buy,clr:T.green},{lbl:'SELL',val:proStats.sell,clr:T.red},{lbl:'STRNG',val:proStats.strong,clr:T.purple},{lbl:'WATCH',val:proData.length,clr:T.cyan}].map(s=>(
                <div key={s.lbl} style={{ display:'flex', alignItems:'center', gap:5, background:T.bg2, border:`1px solid ${T.border}`, borderRadius:5, padding:'4px 10px' }}>
                  <span style={{ color:T.text2, fontSize:8.5, fontFamily:T.font, letterSpacing:0.8 }}>{s.lbl}</span>
                  <span style={{ color:s.clr, fontSize:14, fontFamily:T.font, fontWeight:800, lineHeight:1 }}>{s.val}</span>
                </div>
              ))}
              <div style={{ width:1, height:22, background:T.border, flexShrink:0 }}/>
              {[['ALL',`ALL (${proStats.total})`],['BUY',`▲ BUY (${proStats.buy})`],['SELL',`▼ SELL (${proStats.sell})`],['STRONG',`⚡ STRONG (${proStats.strong})`]].map(([key,lbl])=>(
                <button key={key} onClick={()=>setProFilter(key)}
                  style={{ background:proFilter===key?T.cyan+'14':'transparent', border:`1px solid ${proFilter===key?T.cyan+'45':T.border}`,
                    color:proFilter===key?T.cyan:T.text2, borderRadius:5, padding:'5px 11px', cursor:'pointer', fontFamily:T.font, fontSize:9.5, fontWeight:600 }}>
                  {lbl}
                </button>
              ))}
            </>
          )}
        </div>

        {/* Tech sub-tab — only shown when SIGNALS tab is active */}
        {showSignalsNav&&(
        <div style={{ display:'flex', alignItems:'center', gap:4, flexWrap:'wrap', paddingLeft:12, borderLeft:`2px solid ${T.border}`, marginLeft:6 }}>
          <span style={{ color:T.text2, fontSize:10, marginRight:2 }}>└</span>
          <button onClick={()=>setSignalView(signalView==='TECH'?'SIGNALS':'TECH')}
            style={{ background:signalView==='TECH'?T.cyan+'14':'transparent', border:`1px solid ${signalView==='TECH'?T.cyan+'45':T.border}`,
              color:signalView==='TECH'?T.cyan:T.text2, borderRadius:5, padding:'5px 14px', cursor:'pointer',
              fontFamily:T.font, fontSize:10, letterSpacing:0.4, fontWeight:signalView==='TECH'?700:500 }}>
            ◈ TECH ANALYSIS{techData.length>0?` (${techData.length})`:' '}
          </button>
          {signalView==='TECH'&&(
            <>
              <div style={{ width:1, height:18, background:T.border, flexShrink:0, marginLeft:4 }}/>
              {techStats&&[{lbl:'BULL',val:techStats.bullish,clr:T.green},{lbl:'BEAR',val:techStats.bearish,clr:T.red},{lbl:'ALRT',val:techStats.alerts,clr:T.gold}].map(s=>(
                <div key={s.lbl} style={{ display:'flex', alignItems:'center', gap:4, background:T.bg2, border:`1px solid ${T.border}`, borderRadius:5, padding:'3px 8px' }}>
                  <span style={{ color:T.text2, fontSize:8, fontFamily:T.font }}>{s.lbl}</span>
                  <span style={{ color:s.clr, fontSize:12, fontFamily:T.font, fontWeight:800 }}>{s.val}</span>
                </div>
              ))}
              {['ALL','BULLISH','BEARISH','ALERTS'].map(f=>(
                <button key={f} onClick={()=>setTechFilter(f)}
                  style={{ background:techFilter===f?T.cyan+'14':'transparent', border:`1px solid ${techFilter===f?T.cyan+'45':T.border}`,
                    color:techFilter===f?T.cyan:T.text2, borderRadius:5, padding:'4px 9px', cursor:'pointer', fontFamily:T.font, fontSize:9, fontWeight:600 }}>
                  {f==='BULLISH'?'▲ ':f==='BEARISH'?'▼ ':f==='ALERTS'?'🚨 ':''}{f}
                  {techStats&&f==='ALL'?` (${techData.length})`:''}{techStats&&f==='BULLISH'?` (${techStats.bullish})`:''}{techStats&&f==='BEARISH'?` (${techStats.bearish})`:''}{techStats&&f==='ALERTS'?` (${techStats.alerts})`:'' }
                </button>
              ))}
              <div style={{ marginLeft:'auto', display:'flex', gap:6, alignItems:'center' }}>
                {techLastFetch&&(()=>{
                  const ageMin=Math.round((Date.now()-techLastFetch.getTime())/60000);
                  const isStale=ageMin>=5;
                  const dataAgeMin=Math.round(techDataAge/60);
                  return(<span style={{ color:isStale?T.gold:T.text2, fontSize:9, fontFamily:T.font, fontWeight:isStale?700:400 }}>
                    {isStale?'⚠️ ':techCached?'📦 ':'✅ '}fetched {techLastFetch.toLocaleTimeString()}{techCached&&dataAgeMin>0?` · data ${dataAgeMin}m old`:''}{isStale?' · AUTO-REFRESHING':''}
                  </span>);
                })()}
                <button onClick={()=>fetchTechData(false)} disabled={techLoading}
                  style={{ background:T.bg2, border:`1px solid ${T.border}`, color:T.text1, borderRadius:5, padding:'4px 10px', cursor:techLoading?'wait':'pointer', fontFamily:T.font, fontSize:9, fontWeight:600, opacity:techLoading?0.5:1 }}>
                  {techLoading?'⏳':'🔄'} Refresh
                </button>
                <button onClick={()=>fetchTechData(true)} disabled={techLoading}
                  style={{ background:T.cyanDim, border:`1px solid ${T.cyanMid}`, color:T.cyan, borderRadius:5, padding:'4px 10px', cursor:techLoading?'wait':'pointer', fontFamily:T.font, fontSize:9, fontWeight:700, opacity:techLoading?0.5:1 }}>
                  ⚡ Force
                </button>
              </div>
            </>
          )}
        </div>
        )}
      </div>

      {/* ═══ EARNINGS TAB ═══ */}
      {signalView==='EARNINGS'&&<EarningsSubPanel T={T}/>}

      {/* ═══ SIGNALS VIEW ═══ */}
      {signalView==='SIGNALS'&&(
        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
          {proError&&(
            <div style={{ background:T.red+'10', border:`1px solid ${T.red}30`, borderRadius:8, padding:20, textAlign:'center' }}>
              <div style={{ fontSize:24, marginBottom:8 }}>⚠️</div>
              <div style={{ color:T.red, fontFamily:T.font, fontSize:13 }}>{proError}</div>
            </div>
          )}
          {!proLoading&&!proError&&proData.length===0&&(
            <EmptyState icon="📊" label="NO WATCHLIST TICKERS"
              sub="Star (★) some tickers in the Live Table. Signals run real-time indicator analysis on your ★ watchlist." h={240} T={T}/>
          )}
          {!proLoading&&!proError&&proData.length>0&&proRows.length===0&&proWarmingUp.length>0&&(
            <div className="card" style={{ padding:'32px 24px', textAlign:'center' }}>
              <div style={{ fontSize:32, marginBottom:12 }}>⏳</div>
              <div style={{ color:T.text0, fontFamily:T.font, fontSize:14, fontWeight:700, marginBottom:8, letterSpacing:0.5 }}>ENGINE WARMING UP</div>
              <div style={{ color:T.text2, fontFamily:T.font, fontSize:12, marginBottom:20, maxWidth:440, margin:'0 auto 20px' }}>
                {proWarmingUp.length} ticker{proWarmingUp.length!==1?'s':''} accumulating bars.
                Signals activate after <span style={{ color:T.cyan, fontWeight:700 }}>27 bars</span> (~2 min on the 5m chart). Auto-refreshes every 30 s.
              </div>
              <div style={{ display:'flex', flexWrap:'wrap', gap:8, justifyContent:'center', marginBottom:20 }}>
                {proWarmingUp.map(r=>{
                  const bars=r.bars_count??0;
                  const pct=Math.min(100,Math.round((bars/27)*100));
                  const clr=pct>=75?T.green:pct>=40?T.gold:T.text2;
                  return(
                    <div key={r.ticker} style={{ background:T.bg2, border:`1px solid ${T.border}`, borderRadius:6, padding:'8px 12px', display:'flex', flexDirection:'column', alignItems:'center', gap:5, minWidth:90 }}>
                      <span style={{ color:T.cyan, fontFamily:T.font, fontSize:12, fontWeight:700 }}>{r.ticker}</span>
                      <div style={{ width:70, height:4, background:T.bg3, borderRadius:2, overflow:'hidden' }}>
                        <div style={{ width:`${pct}%`, height:'100%', background:clr, borderRadius:2, transition:'width 1s ease' }}/>
                      </div>
                      <span style={{ color:T.text2, fontFamily:T.font, fontSize:9 }}>{bars}/27 bars · {pct}%</span>
                    </div>
                  );
                })}
              </div>
              <span style={{ color:T.text2, fontFamily:T.font, fontSize:10 }}>⭐ Watchlist · Signal Engine · Auto-refresh 30s</span>
            </div>
          )}
          {proLoading&&proData.length===0&&(
            <div className="card" style={{ overflow:'hidden' }}>
              {Array(6).fill(0).map((_,i)=>(
                <div key={i} style={{ display:'flex', gap:16, padding:'12px 16px', borderBottom:`1px solid ${T.border}` }}>
                  {Array(8).fill(0).map((_,j)=>(<div key={j} className="shimmer-box" style={{ height:14, flex:1 }}/>))}
                </div>
              ))}
            </div>
          )}
          {proRows.length>0&&(
            <div className="card" style={{ overflow:'hidden' }}>
              <div style={{ display:'grid', gridTemplateColumns:proGridCols, background:T.bg0, borderBottom:`2px solid ${T.border}`, position:'sticky', top:0, zIndex:5 }}>
                {PRO_COLS.map(col=>(
                  <div key={col.key} onClick={()=>handleProSort(col.key)}
                    style={{ padding:'10px 8px', color:T.text0, fontSize:9.5, letterSpacing:1, fontFamily:T.font, fontWeight:800, textTransform:'uppercase', cursor:'pointer', whiteSpace:'nowrap', background:proSort===col.key?T.cyan+'08':'transparent' }}>
                    {col.label}{proSort===col.key?(proSortAsc?' ↑':' ↓'):''}
                  </div>
                ))}
              </div>
              <div style={{ maxHeight:'calc(100vh - 420px)', overflowY:'auto', overflowX:'auto' }}>
                {proRows.map(row=>(
                  <div key={row.ticker} className="tr-hover" style={{ display:'grid', gridTemplateColumns:proGridCols, borderBottom:`1px solid ${T.border}` }}>
                    <div style={{ padding:'10px 8px' }}><span style={{ color:T.cyan, fontSize:12, fontWeight:700, fontFamily:T.font }}>{row.ticker}</span></div>
                    <div style={{ padding:'10px 8px', color:T.text0, fontSize:12, fontFamily:T.font, fontWeight:600, display:'flex', alignItems:'center' }}>${fmt2(row.price)}</div>
                    <div style={{ padding:'10px 8px', display:'flex', alignItems:'center' }}>
                      <span style={{ color:_sigClr(row.signal), fontSize:11, fontWeight:800, fontFamily:T.font, padding:'2px 8px', borderRadius:4, background:_sigBg(row.signal), letterSpacing:0.5 }}>
                        {row.signal==='BUY'?'▲ BUY':row.signal==='SELL'?'▼ SELL':'◈ HOLD'}
                      </span>
                    </div>
                    <div style={{ padding:'10px 8px', display:'flex', alignItems:'center' }}><span style={{ color:_sigClr(row.signal), fontSize:12, fontWeight:700, fontFamily:T.font }}>{row.prediction}%</span></div>
                    <div style={{ padding:'10px 8px', display:'flex', alignItems:'center' }}><span style={{ color:_vwapClr(row.vwap_status), fontSize:10, fontWeight:700, fontFamily:T.font, padding:'2px 6px', borderRadius:4, background:_vwapClr(row.vwap_status)+'15' }}>{row.vwap_status}</span></div>
                    <div style={{ padding:'10px 8px', color:T.green, fontSize:11, fontFamily:T.font, fontWeight:600, display:'flex', alignItems:'center' }}>${fmt2(row.support)}</div>
                    <div style={{ padding:'10px 8px', color:T.red,   fontSize:11, fontFamily:T.font, fontWeight:600, display:'flex', alignItems:'center' }}>${fmt2(row.resistance)}</div>
                    <div style={{ padding:'10px 8px', color:_candleClr(row.candle), fontSize:9.5, fontWeight:600, fontFamily:T.font, display:'flex', alignItems:'center' }}>{row.candle}</div>
                    <div style={{ padding:'10px 8px', display:'flex', alignItems:'center' }}><span style={{ color:_macdClr(row.macd_signal), fontSize:9.5, fontWeight:700, fontFamily:T.font, padding:'2px 6px', borderRadius:4, background:_macdClr(row.macd_signal)+'15' }}>{row.macd_signal}</span></div>
                    <div style={{ padding:'10px 8px', display:'flex', flexDirection:'column', gap:2, justifyContent:'center' }}>
                      <span style={{ color:T.text0, fontSize:12, fontFamily:T.font, fontWeight:700 }}>{row.rsi}</span>
                      <span style={{ color:_rsiClr(row.rsi,row.rsi_signal), fontSize:9, fontFamily:T.font }}>{row.rsi_signal}</span>
                    </div>
                    <div style={{ padding:'10px 8px', display:'flex', alignItems:'center' }}><span style={{ color:_stochClr(row.stoch_signal), fontSize:9.5, fontWeight:700, fontFamily:T.font, padding:'2px 6px', borderRadius:4, background:_stochClr(row.stoch_signal)+'15' }}>{row.stoch_signal}</span></div>
                    <div style={{ padding:'10px 8px', fontSize:11, fontFamily:T.font, fontWeight:600, display:'flex', alignItems:'center', color:row.volume>=2.0?T.orange:T.text1 }}>{row.volume?.toFixed(1)}x</div>
                    <div style={{ padding:'10px 8px', display:'flex', alignItems:'center' }}><span style={{ color:_trendClr(row.trend), fontSize:10, fontWeight:700, fontFamily:T.font, padding:'2px 6px', borderRadius:4, background:_trendClr(row.trend)+'12' }}>{row.trend==='Bullish'?'▲':row.trend==='Bearish'?'▼':'—'} {row.trend}</span></div>
                    <div style={{ padding:'10px 8px', display:'flex', flexDirection:'column', gap:2, justifyContent:'center' }}>
                      <span style={{ color:row.adx>=40?T.purple:row.adx>=25?T.cyan:T.text2, fontSize:12, fontFamily:T.font, fontWeight:700 }}>{row.adx}</span>
                      <span style={{ color:T.text2, fontSize:9, fontFamily:T.font }}>{row.adx_label}</span>
                    </div>
                    {/* SUPERTREND column */}
                    <div style={{ padding:'10px 8px', display:'flex', alignItems:'center' }}>
                      <span style={{ color:_stClr(row.supertrend), fontSize:9.5, fontWeight:700, fontFamily:T.font, padding:'2px 6px', borderRadius:4, background:_stClr(row.supertrend)+'15', whiteSpace:'nowrap' }}>
                        {row.supertrend==='UP'?'▲ UP':row.supertrend==='DOWN'?'▼ DOWN':'—'}
                      </span>
                    </div>
                    {/* ORDER BLOCK column */}
                    <div style={{ padding:'10px 8px', display:'flex', alignItems:'center' }}>
                      <span style={{ color:_obClr(row.order_block), fontSize:9, fontWeight:700, fontFamily:T.font, padding:'2px 6px', borderRadius:4, background:_obClr(row.order_block)+'15', whiteSpace:'nowrap' }}>
                        {row.order_block==='BULLISH_OB'?'🐋 BULL':row.order_block==='BEARISH_OB'?'🔻 BEAR':'—'}
                      </span>
                    </div>
                    <div style={{ padding:'10px 8px', display:'flex', alignItems:'center', gap:4 }}>
                      <span style={{ color:row.confluence>=5?T.green:row.confluence>=3?T.cyan:T.text2, fontSize:13, fontFamily:T.font, fontWeight:800 }}>{row.confluence}</span>
                      <span style={{ color:T.text2, fontSize:9, fontFamily:T.font }}>/6</span>
                    </div>
                    <div style={{ padding:'10px 8px', display:'flex', flexDirection:'column', gap:2, justifyContent:'center' }}>
                      <span style={{ color:T.green, fontSize:10, fontFamily:T.font, fontWeight:600 }}>TP ${fmt2(row.tp)}</span>
                      <span style={{ color:T.red,   fontSize:10, fontFamily:T.font, fontWeight:600 }}>SL ${fmt2(row.sl)}</span>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ padding:'10px 16px', borderTop:`2px solid ${T.border}`, display:'flex', justifyContent:'space-between', alignItems:'center', background:T.bg0 }}>
                <span style={{ color:T.text1, fontSize:12, fontFamily:T.font, fontWeight:600 }}>{proRows.length} of {proStats.total} ready · {proWarmingUp.length} warming up</span>
                <span style={{ color:T.text2, fontSize:10, fontFamily:T.font }}>★ Watchlist · Live indicators · Auto-refresh 30s</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══ TECH VIEW ═══ */}
      {signalView==='TECH'&&(
        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
          {techData.some(r=>r.alerts?.length>0)&&(
            <div style={{ background:T.gold+'08', border:`1px solid ${T.gold}30`, borderRadius:8, padding:'10px 16px' }}>
              <div style={{ color:T.gold, fontSize:11, fontWeight:700, fontFamily:T.font, marginBottom:6 }}>🚨 ACTIVE ALERTS</div>
              <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
                {techData.filter(r=>r.alerts?.length>0).flatMap(r=>r.alerts.map((a,i)=>(
                  <span key={`${r.ticker}-${i}`} style={{ background:a.type==='whale'?T.cyan+'18':a.type==='triple_bounce'?T.green+'18':T.gold+'18',
                    border:`1px solid ${a.type==='whale'?T.cyan+'40':a.type==='triple_bounce'?T.green+'40':T.gold+'40'}`,
                    color:a.type==='whale'?T.cyan:a.type==='triple_bounce'?T.green:T.gold,
                    borderRadius:5, padding:'3px 8px', fontSize:10, fontWeight:700, fontFamily:T.font }}>
                    {a.type==='whale'?'🐋':a.type==='triple_bounce'?'💎':'🚨'} {r.ticker}: {a.text}
                  </span>
                )))}
              </div>
            </div>
          )}
          {techError&&(
            <div style={{ background:T.red+'10', border:`1px solid ${T.red}30`, borderRadius:8, padding:20, textAlign:'center' }}>
              <div style={{ fontSize:28, marginBottom:8 }}>⚠️</div>
              <div style={{ color:T.red, fontFamily:T.font, fontSize:13, fontWeight:600 }}>{techError}</div>
            </div>
          )}
          {!techLoading&&!techError&&techData.length===0&&(
            <EmptyState icon="◇" label="NO WATCHLIST TICKERS" sub="Star (★) some tickers in the Live Table first. Tech analysis uses yfinance 3mo data on your ★ watchlist." h={240} T={T}/>
          )}
          {techLoading&&techData.length===0&&(
            <div className="card" style={{ overflow:'hidden' }}>
              {Array(8).fill(0).map((_,i)=>(
                <div key={i} style={{ display:'flex', gap:16, padding:'12px 16px', borderBottom:`1px solid ${T.border}` }}>
                  {Array(6).fill(0).map((_,j)=>(<div key={j} className="shimmer-box" style={{ height:14, flex:1 }}/>))}
                </div>
              ))}
            </div>
          )}
          {techRows.length>0&&(
            <div className="card" style={{ overflow:'hidden' }}>
              <div style={{ display:'grid', gridTemplateColumns:techGridCols, background:T.bg0, borderBottom:`2px solid ${T.border}`, position:'sticky', top:0, zIndex:5 }}>
                {TECH_COLS.map(col=>(
                  <div key={col.key} onClick={()=>handleTechSort(col.key)}
                    style={{ padding:'10px 8px', color:T.text0, fontSize:9.5, letterSpacing:1, fontFamily:T.font, fontWeight:800, textTransform:'uppercase', cursor:'pointer', whiteSpace:'nowrap', background:techSortKey===col.key?T.cyan+'08':'transparent' }}>
                    {col.label}{techSortKey===col.key?(techSortAsc?' ↑':' ↓'):''}
                  </div>
                ))}
              </div>
              <div style={{ maxHeight:'calc(100vh - 420px)', overflowY:'auto', overflowX:'auto' }}>
                {techRows.map(row=>(
                  <div key={row.ticker} className="tr-hover" style={{ display:'grid', gridTemplateColumns:techGridCols, borderBottom:`1px solid ${T.border}` }}>
                    <div style={{ padding:'9px 8px' }}>
                      <span style={{ color:T.cyan, fontSize:12, fontWeight:700, fontFamily:T.font }}>{row.ticker}</span>
                      {row.alerts?.length>0&&(
                        <div style={{ display:'flex', gap:2, marginTop:2 }}>
                          {row.alerts.map((a,j)=>(
                            <span key={j} style={{ fontSize:8, padding:'1px 4px', borderRadius:3, background:T.gold+'15', color:T.gold, fontWeight:700 }}>
                              {a.type==='whale'?'🐋':a.type==='triple_bounce'?'💎':'🚨'}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div style={{ padding:'9px 8px', color:T.text0, fontSize:12, fontFamily:T.font, fontWeight:600, display:'flex', alignItems:'center' }}>${fmt2(row.price)}</div>
                    <div style={{ padding:'9px 8px', display:'flex', alignItems:'center', justifyContent:'center' }}>
                      <span style={{ color:_scoreClr(row.score), fontSize:13, fontWeight:800, fontFamily:T.font }}>{row.score>=0?'+':''}{row.score?.toFixed(1)}</span>
                    </div>
                    <div style={{ padding:'9px 8px', display:'flex', alignItems:'center' }}><span style={{ color:_trendClr(row.trend), fontSize:10, fontWeight:700, fontFamily:T.font, padding:'2px 6px', borderRadius:4, background:_trendClr(row.trend)+'12' }}>{row.trend==='Bullish'?'▲':'▼'} {row.trend}</span></div>
                    <div style={{ padding:'9px 8px', color:_rsiClr(row.rsi,row.rsi_signal), fontSize:12, fontFamily:T.font, fontWeight:700, display:'flex', alignItems:'center' }}>{row.rsi!=null?row.rsi.toFixed(1):'—'}</div>
                    <div style={{ padding:'9px 8px', display:'flex', alignItems:'center' }}><span style={{ color:_rsiClr(row.rsi,row.rsi_signal), fontSize:9, fontWeight:700, fontFamily:T.font, padding:'2px 6px', borderRadius:4, background:_rsiClr(row.rsi,row.rsi_signal)+'15' }}>{row.rsi_signal}</span></div>
                    <div style={{ padding:'9px 8px', color:_bbClr(row.bb_status), fontSize:9.5, fontWeight:600, fontFamily:T.font, display:'flex', alignItems:'center' }}>{row.bb_status?.includes('Overextended')?'⚠️ ':row.bb_status?.includes('Bounce')?'💡 ':''}{row.bb_status}</div>
                    <div style={{ padding:'9px 8px', color:_candleClr(row.candlestick), fontSize:9.5, fontWeight:600, fontFamily:T.font, display:'flex', alignItems:'center' }}>{row.candlestick}</div>
                    <div style={{ padding:'9px 8px', color:T.text1, fontSize:11, fontFamily:T.font, display:'flex', alignItems:'center' }}>{row.atr!=null?row.atr.toFixed(2):'—'}</div>
                    <div style={{ padding:'9px 8px', fontSize:11, fontFamily:T.font, fontWeight:600, display:'flex', alignItems:'center', color:row.rvol>=2.0?T.orange:T.text1 }}>{row.rvol?`${row.rvol.toFixed(1)}x`:'—'}</div>
                    <div style={{ padding:'9px 8px', color:_instClr(row.inst_footprint), fontSize:9.5, fontWeight:600, fontFamily:T.font, display:'flex', alignItems:'center' }}>{row.inst_footprint?.includes('Accumulation')?'🐋 ':row.inst_footprint?.includes('Distribution')?'🔻 ':''}{row.inst_footprint}</div>
                    <div style={{ padding:'9px 8px', color:T.text1, fontSize:11, fontFamily:T.font, display:'flex', alignItems:'center' }}>{row.fcf_yield!=null?`${row.fcf_yield}%`:'—'}</div>
                    <div style={{ padding:'9px 8px', color:T.text1, fontSize:11, fontFamily:T.font, display:'flex', alignItems:'center' }}>{row.de_ratio!=null?row.de_ratio.toFixed(2):'—'}</div>
                  </div>
                ))}
              </div>
              <div style={{ padding:'10px 16px', borderTop:`2px solid ${T.border}`, display:'flex', justifyContent:'space-between', alignItems:'center', background:T.bg0 }}>
                <span style={{ color:T.text1, fontSize:12, fontFamily:T.font, fontWeight:600 }}>{techRows.length} of {techData.length} tickers{techFilter!=='ALL'?` · ${techFilter}`:''}</span>
                <span style={{ color:T.text2, fontSize:10, fontFamily:T.font }}>Sorted by {techSortKey} {techSortAsc?'↑':'↓'} · Data: yfinance 3mo · ★ Watchlist tickers</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
