/**
 * LiveDashboard.jsx — NexRadar Pro
 * ==================================
 * FIX: Sector filter now uses robust 3-stage matching:
 *   1. Normalized alias match (TECHNOLOGY, TECH, IT → all match)
 *   2. Case-insensitive exact match
 *   3. Contains/partial match fallback
 *   + Diagnostic banner when sector returns 0 results, showing
 *     the actual sector values present in the live data so you
 *     can align DB values with sidebar options.
 */

import { useState, useMemo, useEffect } from 'react'
import clsx from 'clsx'
import { NoDataEmptyState, NoResultsEmptyState, LoadingEmptyState } from './EmptyState'
import { TableSkeleton } from './SkeletonLoader'
import MiniSparkline, { generateSparklineData } from './MiniSparkline'
import { API_BASE, REFRESH_INTERVALS, DISPLAY_SETTINGS, THRESHOLDS } from '../config'
import logger from '../utils/logger'

const fmt   = (n, d = 2) => Number(n ?? 0).toFixed(d)
const fmtS  = (n)        => (n >= 0 ? '+' : '') + fmt(n)
const fmtP  = (n)        => (n >= 0 ? '+' : '') + fmt(n) + '%'
const isStale = (r) => (Date.now() / 1000 - (r.last_tick_time ?? 0)) > THRESHOLDS.STALE_PRICE_SECONDS

// ── Sector alias map: any DB variation → canonical key ────────────────────────
const SECTOR_ALIASES = {
  // Technology
  'TECHNOLOGY': 'TECHNOLOGY', 'TECH': 'TECHNOLOGY', 'IT': 'TECHNOLOGY',
  'INFORMATION TECHNOLOGY': 'TECHNOLOGY', 'SOFTWARE': 'TECHNOLOGY', 'HARDWARE': 'TECHNOLOGY',
  // Consumer
  'CONSUMER': 'CONSUMER', 'CONSUMER DISCRETIONARY': 'CONSUMER',
  'CONSUMER STAPLES': 'CONSUMER', 'RETAIL': 'CONSUMER',
  // Banking
  'BANKING': 'BANKING', 'FINANCE': 'BANKING', 'FINANCIAL': 'BANKING',
  'FINANCIAL SERVICES': 'BANKING', 'BANKS': 'BANKING',
  // Bio / Healthcare
  'BIO': 'BIO', 'HEALTHCARE': 'BIO', 'BIOTECHNOLOGY': 'BIO', 'BIOTECH': 'BIO',
  'HEALTH CARE': 'BIO', 'MEDICAL': 'BIO', 'PHARMACEUTICALS': 'BIO',
  // BM & Energy
  'BM & UENE': 'BM & UENE', 'BM & ENERGY': 'BM & UENE', 'BM&ENERGY': 'BM & UENE',
  'BM&UENE': 'BM & UENE', 'BASIC MATERIALS & ENERGY': 'BM & UENE',
  'BASIC MATERIALS': 'BM & UENE', 'MATERIALS': 'BM & UENE',
  'ENERGY': 'BM & UENE', 'OIL & GAS': 'BM & UENE', 'UTILITIES': 'BM & UENE',
  // Real Estate / Comms
  'REALCOM': 'REALCOM', 'REAL ESTATE': 'REALCOM', 'COMMUNICATIONS': 'REALCOM',
  'COMMUNICATION SERVICES': 'REALCOM', 'REAL ESTATE & COMMUNICATIONS': 'REALCOM',
  'TELECOM': 'REALCOM',
  // Industrials
  'INDUSTRIALS': 'INDUSTRIALS', 'INDUSTRIAL': 'INDUSTRIALS',
  'MANUFACTURING': 'INDUSTRIALS', 'AEROSPACE': 'INDUSTRIALS', 'DEFENSE': 'INDUSTRIALS',
}

const normalizeSector = (s) => {
  if (!s) return ''
  const u = s.trim().toUpperCase()
  return SECTOR_ALIASES[u] || u
}

// 3-stage match: normalized alias → exact CI → contains
const sectorMatches = (rowSector, filterSector) => {
  if (!rowSector || !filterSector) return false
  const nr = normalizeSector(rowSector)
  const nf = normalizeSector(filterSector)
  if (nr === nf) return true
  if (rowSector.trim().toUpperCase() === filterSector.trim().toUpperCase()) return true
  if (nr.includes(nf) || nf.includes(nr)) return true
  return false
}

function Badge({ label, cls }) {
  return <span className={clsx('text-[9px] font-bold px-1.5 py-0.5 rounded', cls)}>{label}</span>
}

function AlertBadges({ row }) {
  return (
    <span className="flex gap-1 flex-wrap">
      {row.volume_spike_level === 'high' && <Badge label={`🔊 ${fmt(row.volume_ratio,1)}x`} cls="bg-red-600 text-white" />}
      {row.volume_spike && row.volume_spike_level !== 'high' && <Badge label={`📢 ${fmt(row.volume_ratio,1)}x`} cls="bg-orange-500 text-white" />}
      {row.is_gap_play && <Badge label={`📊${row.gap_direction==='up'?'↑':'↓'}${fmt(Math.abs(row.gap_percent),1)}%`} cls="bg-blue-600 text-white" />}
      {row.ah_momentum && <Badge label="🌙 AH" cls="bg-purple-600 text-white" />}
      {row.is_earnings_gap_play && <Badge label="📰 GAP" cls="bg-blue-500 text-white" />}
    </span>
  )
}

function MatrixBadges({ row }) {
  return (
    <span className="flex gap-1 flex-wrap mt-1">
      {Math.abs(row.percent_change ?? 0) >= 5 && <Badge label="💎" cls="bg-amber-400 text-black" />}
      {row.went_positive === 1           && <Badge label="🎯" cls="bg-cyan-500 text-black" />}
      {row.volume_spike_level === 'high' && <Badge label="🔊" cls="bg-red-600 text-white" />}
      {row.ah_momentum                   && <Badge label="🌙" cls="bg-purple-600 text-white" />}
    </span>
  )
}

export default function LiveDashboard({
  tickers, wsStatus, activeFilter, metrics, source, sector, darkMode, onSelectTicker,
}) {
  const [viewMode,      setViewMode]      = useState('table')
  const [minChange,     setMinChange]     = useState(0)
  const [showNegative,  setShowNegative]  = useState(false)
  const [sortKey,       setSortKey]       = useState('change_value')
  const [cfMinPct,      setCfMinPct]      = useState(0)
  const [cfVol,         setCfVol]         = useState('Any')
  const [cfFlags,       setCfFlags]       = useState([])
  const [filterOpen,    setFilterOpen]    = useState(false)
  const [portfolioData, setPortfolioData] = useState([])
  const [monitorData,   setMonitorData]   = useState([])
  const [earningsData,  setEarningsData]  = useState([])
  const [displayCount,  setDisplayCount]  = useState(DISPLAY_SETTINGS.INITIAL_ROW_COUNT)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [isLoadingSource, setIsLoadingSource] = useState(false)
  // Tracks unique sector strings actually present in live data (for diagnostics)
  const [liveSectors,   setLiveSectors]   = useState([])

  const session = metrics?.session ?? 'MARKET_HOURS'
  const isAH    = session === 'AFTER_HOURS'

  // Auto-refresh portfolio/monitor
  useEffect(() => {
    if (source !== 'portfolio' && source !== 'monitor') return
    const id = setInterval(() => {
      const ep = source === 'portfolio' ? '/api/portfolio' : '/api/monitor'
      fetch(`${API_BASE}${ep}`)
        .then(r => r.ok ? r.json() : Promise.reject())
        .then(data => {
          const t = data.tickers || data || []
          source === 'portfolio' ? setPortfolioData(t) : setMonitorData(t)
        }).catch(() => {})
    }, REFRESH_INTERVALS.PORTFOLIO)
    return () => clearInterval(id)
  }, [source])

  // Reset display count on filter/source change
  useEffect(() => {
    setDisplayCount(DISPLAY_SETTINGS.INITIAL_ROW_COUNT)
  }, [activeFilter, source, sector, minChange, cfMinPct, cfVol, cfFlags, showNegative])

  // Fetch source data
  useEffect(() => {
    const t = setTimeout(() => {
      setIsLoadingSource(true)
      if (source === 'portfolio') {
        fetch(`${API_BASE}/api/portfolio`)
          .then(r => r.json()).then(d => setPortfolioData(d.tickers || d || []))
          .catch(() => setPortfolioData([])).finally(() => setIsLoadingSource(false))
      } else if (source === 'monitor') {
        fetch(`${API_BASE}/api/monitor`)
          .then(r => r.json()).then(d => setMonitorData(d.tickers || d || []))
          .catch(() => setMonitorData([])).finally(() => setIsLoadingSource(false))
      } else if (source === 'earnings') {
        const start = new Date(Date.now() - 30*86400000).toISOString().slice(0,10)
        const end   = new Date(Date.now() + 60*86400000).toISOString().slice(0,10)
        fetch(`${API_BASE}/api/earnings?start=${start}&end=${end}`)
          .then(r => r.json())
          .then(d => setEarningsData(Array.isArray(d) ? d.map(e => e.ticker) : []))
          .catch(() => setEarningsData([])).finally(() => setIsLoadingSource(false))
      } else {
        setPortfolioData([]); setMonitorData([]); setEarningsData([])
        setIsLoadingSource(false)
      }
    }, DISPLAY_SETTINGS.DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [source])

  const rows = useMemo(() => {
    let arr = Array.from(tickers.values())

    // Collect unique sectors for diagnostic banner
    const unique = [...new Set(arr.map(r => r.sector).filter(Boolean))].sort()
    setLiveSectors(unique)

    // Source filter
    if (source === 'portfolio')  arr = portfolioData.length ? arr.filter(r => portfolioData.includes(r.ticker)) : []
    else if (source === 'monitor')   arr = monitorData.length   ? arr.filter(r => monitorData.includes(r.ticker))   : []
    else if (source === 'earnings')  arr = earningsData.length  ? arr.filter(r => earningsData.includes(r.ticker))  : []
    else if (source === 'favorites') arr = arr.filter(r => Math.abs(r.percent_change ?? 0) >= THRESHOLDS.DIAMOND_PERCENT)

    if (!showNegative) arr = arr.filter(r => r.is_positive)

    // Sector filter — active for stock_list, all, and any source when sector is set
    if (sector && sector !== 'all' && sector !== 'ALL') {
      arr = arr.filter(r => sectorMatches(r.sector, sector))
    }

    // Alert filters
    if      (activeFilter === 'volume_spike') arr = arr.filter(r => r.volume_spike)
    else if (activeFilter === 'gap_play')     arr = arr.filter(r => r.is_gap_play)
    else if (activeFilter === 'ah_momentum')  arr = arr.filter(r => r.ah_momentum)
    else if (activeFilter === 'earnings_gap') arr = arr.filter(r => r.is_earnings_gap_play)
    else if (activeFilter === 'diamond')      arr = arr.filter(r => Math.abs(r.percent_change ?? 0) >= THRESHOLDS.DIAMOND_PERCENT)

    if (minChange > 0) arr = arr.filter(r => Math.abs(r.change_value ?? 0) >= minChange)
    if (cfMinPct  > 0) arr = arr.filter(r => Math.abs(r.percent_change ?? 0) >= cfMinPct)
    if (cfVol === 'Spike Only (2×+)') arr = arr.filter(r => r.volume_spike)
    if (cfVol === 'Surge Only (5×+)') arr = arr.filter(r => r.volume_spike_level === 'high')
    if (cfFlags.includes('Gap Play'))        arr = arr.filter(r => r.is_gap_play)
    if (cfFlags.includes('AH Momentum'))     arr = arr.filter(r => r.ah_momentum)
    if (cfFlags.includes('Turned Positive')) arr = arr.filter(r => r.went_positive === 1)
    if (cfFlags.includes('Diamond'))         arr = arr.filter(r => Math.abs(r.percent_change ?? 0) >= THRESHOLDS.DIAMOND_PERCENT)

    arr.sort((a, b) => (b[sortKey] ?? 0) - (a[sortKey] ?? 0))
    return arr
  }, [tickers, showNegative, activeFilter, minChange, cfMinPct, cfVol, cfFlags, sortKey,
      sector, source, portfolioData, monitorData, earningsData])

  const tableCols = isAH
    ? [['ticker','Ticker'],['company_name','Company'],['sparkline','Trend'],['prev_close','Prev Close'],
       ['today_close','Today Close'],['live_price','Live Price'],['ah_dollar','AH ($)'],['ah_pct','AH (%)'],['alerts','Alerts']]
    : [['ticker','Ticker'],['company_name','Company'],['sparkline','Trend'],['open','Open'],['hwm','HWM (Peak)'],
       ['live_price','Price'],['change_value','Change ($)'],['percent_change','Change (%)'],['alerts','Alerts']]

  const cfActive = cfMinPct > 0 || cfVol !== 'Any' || cfFlags.length > 0
  const effectiveDisplayCount = Math.min(displayCount, rows.length)
  const displayedRows = rows.slice(0, effectiveDisplayCount)
  const hasMore = effectiveDisplayCount < rows.length

  // Is this a sector-mismatch zero-result? (data exists but sector matched nothing)
  const isSectorMismatch = rows.length === 0
    && sector && sector !== 'all' && sector !== 'ALL'
    && tickers.size > 0

  const loadMore = () => {
    setIsLoadingMore(true)
    setTimeout(() => { setDisplayCount(p => p + DISPLAY_SETTINGS.LOAD_MORE_INCREMENT); setIsLoadingMore(false) }, 200)
  }

  useEffect(() => {
    const onScroll = () => {
      if (isLoadingMore || !hasMore) return
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - DISPLAY_SETTINGS.SCROLL_THRESHOLD_PX) loadMore()
    }
    window.addEventListener('scroll', onScroll)
    return () => window.removeEventListener('scroll', onScroll)
  }, [isLoadingMore, hasMore, displayCount])

  // ── RENDER ──────────────────────────────────────────────────────────────────
  return (
    <div className={clsx('flex flex-col gap-3 rounded-lg p-4', darkMode ? 'bg-[#0a0f1a]' : 'bg-white shadow-sm')}>

      {session === 'OVERNIGHT_SLEEP' && (
        <div className={clsx('border rounded p-3 text-xs',
          darkMode ? 'bg-yellow-900/30 border-yellow-700/50 text-yellow-300' : 'bg-yellow-50 border-yellow-300 text-yellow-900')}>
          🌙 MARKET CLOSED (Overnight 8 PM–4 AM EST) — Live data is unreliable until 4:00 AM EST.
        </div>
      )}
      {session === 'CLOSED_WEEKEND' && (
        <div className={clsx('border rounded p-3 text-xs',
          darkMode ? 'bg-blue-900/20 border-blue-700/30 text-blue-300' : 'bg-blue-50 border-blue-300 text-blue-900')}>
          🏖️ Market Closed (Weekend)
        </div>
      )}

      {/* ── Sector mismatch diagnostic banner ─────────────────────────────── */}
      {isSectorMismatch && (
        <div className={clsx('border rounded p-3 text-xs space-y-2',
          darkMode ? 'bg-amber-900/20 border-amber-600/40 text-amber-300' : 'bg-amber-50 border-amber-300 text-amber-800')}>
          <p className="font-bold">⚠️ No stocks found for sector: <code className="font-mono bg-black/20 px-1 rounded">{sector}</code></p>
          <p className="opacity-80">The live data contains these sector values — check your DB <code>sector</code> column matches one of these:</p>
          <div className="flex flex-wrap gap-1">
            {liveSectors.length > 0 ? liveSectors.map(s => (
              <span key={s} className={clsx('px-2 py-0.5 rounded font-mono text-[10px] border',
                darkMode ? 'bg-white/10 border-white/20' : 'bg-white border-amber-300')}>
                {s}
              </span>
            )) : (
              <span className="opacity-60 text-[10px]">No sector data in live feed — backend may not be joining stock_list</span>
            )}
          </div>
        </div>
      )}

      {/* Controls row */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className={clsx('flex rounded overflow-hidden border text-xs', darkMode ? 'border-white/20' : 'border-slate-300')}>
          {['table','matrix'].map(v => (
            <button key={v} onClick={() => setViewMode(v)}
              className={clsx('px-3 py-1.5 font-semibold transition-colors',
                viewMode === v
                  ? darkMode ? 'bg-blue-600 text-white' : 'bg-blue-500 text-white'
                  : darkMode ? 'bg-white/5 text-gray-400 hover:bg-white/10' : 'bg-slate-50 text-slate-600 hover:bg-slate-100')}>
              {v === 'table' ? '≡ Table' : '⊞ Matrix'}
            </button>
          ))}
        </div>

        <div className={clsx('flex items-center gap-2 text-xs', darkMode ? 'text-gray-400' : 'text-slate-600')}>
          <span>Min Δ $: {fmt(minChange,1)}</span>
          <input type="range" min={0} max={5} step={0.1} value={minChange}
            onChange={e => setMinChange(+e.target.value)} className="w-24 accent-blue-500" />
        </div>

        <label className={clsx('flex items-center gap-1.5 text-xs cursor-pointer', darkMode ? 'text-gray-400' : 'text-slate-600')}>
          <input type="checkbox" checked={showNegative} onChange={e => setShowNegative(e.target.checked)} className="accent-blue-500" />
          Show –ve
        </label>

        <div className={clsx('ml-auto text-xs', darkMode ? 'text-gray-500' : 'text-slate-600')}>
          {isLoadingSource ? (
            <span className="flex items-center gap-2">
              <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
              </svg>
              Loading {source}...
            </span>
          ) : (
            <div className="flex items-center gap-3">
              <span>{hasMore ? `Showing ${effectiveDisplayCount} of ${rows.length} stocks` : `${rows.length} stocks`}</span>
              {(source === 'portfolio' || source === 'monitor') && (
                <span className="flex items-center gap-1 text-[10px]">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"/>
                  Auto-refresh: {REFRESH_INTERVALS.PORTFOLIO/1000}s
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Custom Filter Builder */}
      <div className={clsx('border rounded', darkMode ? 'border-white/10' : 'border-slate-200')}>
        <button onClick={() => setFilterOpen(o => !o)}
          className={clsx('w-full text-left px-3 py-2 text-xs flex justify-between', darkMode ? 'text-gray-400' : 'text-slate-600')}>
          <span>⚙️ Custom Filter Builder {cfActive ? '(active)' : ''}</span>
          <span>{filterOpen ? '▲' : '▼'}</span>
        </button>
        {filterOpen && (
          <div className="px-3 pb-3 grid grid-cols-3 gap-3">
            <div>
              <label className={clsx('text-xs', darkMode ? 'text-gray-500' : 'text-slate-600')}>Min Change %</label>
              <input type="number" min={0} max={50} step={0.5} value={cfMinPct} onChange={e => setCfMinPct(+e.target.value)}
                className={clsx('w-full mt-0.5 border rounded px-2 py-1 text-xs',
                  darkMode ? 'bg-gray-900 border-gray-700 text-white' : 'bg-white border-slate-300 text-slate-900')}/>
            </div>
            <div>
              <label className={clsx('text-xs', darkMode ? 'text-gray-500' : 'text-slate-600')}>Volume</label>
              <select value={cfVol} onChange={e => setCfVol(e.target.value)}
                className={clsx('w-full mt-0.5 border rounded px-2 py-1 text-xs',
                  darkMode ? 'bg-gray-900 border-gray-700 text-white' : 'bg-white border-slate-300 text-slate-900')}>
                {['Any','Spike Only (2×+)','Surge Only (5×+)'].map(o => <option key={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <label className={clsx('text-xs', darkMode ? 'text-gray-500' : 'text-slate-600')}>Alert Flags</label>
              <div className="flex flex-col gap-0.5 mt-0.5">
                {['Gap Play','AH Momentum','Turned Positive','Diamond'].map(f => (
                  <label key={f} className={clsx('flex items-center gap-1 text-xs cursor-pointer', darkMode ? 'text-gray-400' : 'text-slate-600')}>
                    <input type="checkbox" checked={cfFlags.includes(f)}
                      onChange={e => setCfFlags(p => e.target.checked ? [...p,f] : p.filter(x=>x!==f))}
                      className="accent-blue-500"/>
                    {f}
                  </label>
                ))}
              </div>
            </div>
            {cfActive && (
              <p className={clsx('col-span-3 text-xs', darkMode ? 'text-amber-400' : 'text-amber-700')}>
                🔧 Active — {cfMinPct}% min | {cfVol} | {cfFlags.join(', ')||'any flags'}
              </p>
            )}
          </div>
        )}
      </div>

      {/* ── TABLE VIEW ──────────────────────────────────────────────────────── */}
      {viewMode === 'table' && (
        <div>
          <h3 className="text-sm font-bold mb-2">📊 Live Stock Data</h3>

          {isLoadingSource ? <LoadingEmptyState darkMode={darkMode}/> : rows.length === 0 && !isSectorMismatch && (
            wsStatus === 'connecting' ? <LoadingEmptyState darkMode={darkMode}/> :
            tickers.size === 0 ? <NoDataEmptyState onRetry={() => window.location.reload()} darkMode={darkMode}/> :
            (source === 'portfolio'||source === 'monitor'||source === 'earnings') &&
            !portfolioData.length && !monitorData.length && !earningsData.length ? (
              <div className={clsx('text-center py-12 rounded-lg border',
                darkMode ? 'bg-white/5 border-white/10' : 'bg-slate-50 border-slate-200')}>
                <div className="text-5xl mb-4">📭</div>
                <p className={clsx('text-sm font-semibold mb-2', darkMode ? 'text-white' : 'text-slate-900')}>No {source} data available</p>
                <p className={clsx('text-xs', darkMode ? 'text-gray-500' : 'text-slate-600')}>
                  {source==='portfolio'?'Add stocks to your portfolio':source==='monitor'?'Add stocks to your monitor list':'No upcoming earnings'}
                </p>
              </div>
            ) : (
              <NoResultsEmptyState
                onClear={() => { setCfMinPct(0); setCfVol('Any'); setCfFlags([]); setMinChange(0); setShowNegative(false) }}
                filterName={source !== 'all' ? source : (activeFilter||'current filter')}
                darkMode={darkMode}/>
            )
          )}

          {rows.length > 0 && (
            <>
              <div className={clsx('overflow-x-auto rounded-lg border', darkMode ? 'border-white/10' : 'border-slate-200')}>
                <table className="w-full text-left text-xs">
                  <thead className={clsx('text-[10px] uppercase tracking-wide',
                    darkMode ? 'bg-gray-900/80 text-gray-400' : 'bg-slate-100 text-slate-700')}>
                    <tr>
                      {tableCols.map(([key,label]) => (
                        <th key={label} onClick={() => key && key!=='alerts' && setSortKey(key)}
                          className={clsx('px-3 py-2', key&&key!=='alerts'&&'cursor-pointer hover:text-white')}>
                          {label}{sortKey===key?' ↓':''}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {displayedRows.map(row => {
                      const stale  = isStale(row)
                      const chgVal = isAH ? (row.live_price-(row.today_close>0?row.today_close:row.prev_close)) : row.change_value
                      const chgPct = isAH && (row.today_close>0?row.today_close:row.prev_close)>0
                        ? (chgVal/(row.today_close>0?row.today_close:row.prev_close))*100 : row.percent_change
                      const isPos  = chgVal >= 0
                      const sparklineData = generateSparklineData(row.live_price||0, row.percent_change||0, 20)
                      return (
                        <tr key={row.ticker} onClick={() => onSelectTicker(row.ticker)}
                          className={clsx('border-b border-white/5 cursor-pointer transition-colors',
                            stale ? 'opacity-40 italic' : isPos ? 'bg-emerald-950/10 hover:bg-emerald-950/20' : 'bg-red-950/10 hover:bg-red-950/20')}>
                          <td className="py-2 px-3">
                            <div className="flex items-center gap-2">
                              <span className="font-bold">{row.ticker}</span>
                              {activeFilter && (
                                <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/20 border border-blue-500/30 text-blue-400">
                                  {activeFilter==='gap_play'&&row.is_gap_play&&'📊'}
                                  {activeFilter==='volume_spike'&&row.volume_spike&&'🔊'}
                                  {activeFilter==='ah_momentum'&&row.ah_momentum&&'🌙'}
                                  {activeFilter==='earnings_gap'&&row.is_earnings_gap_play&&'📰'}
                                  {activeFilter==='diamond'&&Math.abs(row.percent_change??0)>=5&&'💎'}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-2 px-3 text-gray-400 max-w-[140px] truncate">{row.company_name}</td>
                          <td className="py-2 px-3">
                            <MiniSparkline data={sparklineData} width={70} height={28}
                              color={isPos?'#10b981':'#ef4444'} isPositive={isPos} showTooltip ticker={row.ticker}/>
                          </td>
                          {isAH ? (
                            <>
                              <td className="py-2 px-3 font-mono">{fmt(row.prev_close)}</td>
                              <td className="py-2 px-3 font-mono">{fmt(row.today_close||row.prev_close)}</td>
                              <td className="py-2 px-3 font-mono font-semibold">{stale?`⏱️ ${fmt(row.live_price)}`:fmt(row.live_price)}</td>
                              <td className={clsx('py-2 px-3 font-mono font-bold',isPos?'text-emerald-400 bg-emerald-950/30':'text-red-400 bg-red-950/30')}>{fmtS(chgVal)}</td>
                              <td className={clsx('py-2 px-3 font-mono font-bold',isPos?'text-emerald-400 bg-emerald-950/30':'text-red-400 bg-red-950/30')}>{fmtP(chgPct)}</td>
                            </>
                          ) : (
                            <>
                              <td className="py-2 px-3 font-mono">{fmt(row.open)}</td>
                              <td className="py-2 px-3 font-mono">{fmt(row.hwm)}</td>
                              <td className={clsx('py-2 px-3 font-mono font-semibold',isPos?'text-emerald-300':'text-red-300')}>{fmt(row.live_price)}</td>
                              <td className={clsx('py-2 px-3 font-mono font-bold',isPos?'text-emerald-400 bg-emerald-950/30':'text-red-400 bg-red-950/30')}>{fmtS(row.change_value)}</td>
                              <td className={clsx('py-2 px-3 font-mono font-bold',isPos?'text-emerald-400 bg-emerald-950/30':'text-red-400 bg-red-950/30')}>{fmtP(row.percent_change)}</td>
                            </>
                          )}
                          <td className="py-2 px-3"><AlertBadges row={row}/></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {hasMore && (
                <div className="mt-4 flex flex-col items-center gap-3">
                  <div className={clsx('text-xs', darkMode?'text-gray-500':'text-slate-500')}>
                    Showing {effectiveDisplayCount} of {rows.length} stocks • {rows.length-effectiveDisplayCount} more
                  </div>
                  <button onClick={loadMore} disabled={isLoadingMore}
                    className={clsx('px-6 py-2.5 rounded-lg font-semibold text-sm transition-all flex items-center gap-2',
                      darkMode?'bg-cyan-500/20 border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/30':'bg-blue-500 text-white hover:bg-blue-600',
                      isLoadingMore&&'opacity-50 cursor-not-allowed')}>
                    {isLoadingMore ? 'Loading…' : `↓ Load More (+${DISPLAY_SETTINGS.LOAD_MORE_INCREMENT})`}
                  </button>
                  <p className={clsx('text-[10px]', darkMode?'text-gray-600':'text-slate-400')}>💡 Scroll down to auto-load more</p>
                </div>
              )}

              <p className="text-[10px] text-gray-600 mt-3">
                Showing {effectiveDisplayCount} of {rows.length} stocks | {session}
                {sector&&sector!=='all'?` | 🔵 Sector: ${sector}`:''}
                {activeFilter?` | 🔍 Filter: ${activeFilter}`:''}
                {isAH&&rows.some(r=>isStale(r))?` | ⏱️ ${rows.filter(r=>isStale(r)).length} stale`:''}
              </p>
            </>
          )}
        </div>
      )}

      {/* ── MATRIX VIEW ─────────────────────────────────────────────────────── */}
      {viewMode === 'matrix' && (
        <div>
          <h3 className="text-sm font-bold mb-2">⊞ Matrix View</h3>

          {isLoadingSource ? <LoadingEmptyState darkMode={darkMode}/> : rows.length === 0 && !isSectorMismatch && (
            wsStatus==='connecting' ? <LoadingEmptyState darkMode={darkMode}/> :
            tickers.size===0 ? <NoDataEmptyState onRetry={() => window.location.reload()} darkMode={darkMode}/> :
            (source==='portfolio'||source==='monitor'||source==='earnings') &&
            !portfolioData.length && !monitorData.length && !earningsData.length ? (
              <div className={clsx('text-center py-12 rounded-lg border', darkMode?'bg-white/5 border-white/10':'bg-slate-50 border-slate-200')}>
                <div className="text-5xl mb-4">📭</div>
                <p className={clsx('text-sm font-semibold', darkMode?'text-white':'text-slate-900')}>No {source} data available</p>
              </div>
            ) : (
              <NoResultsEmptyState
                onClear={() => { setCfMinPct(0); setCfVol('Any'); setCfFlags([]); setMinChange(0); setShowNegative(false) }}
                filterName={source!=='all'?source:(activeFilter||'current filter')} darkMode={darkMode}/>
            )
          )}

          {rows.length > 0 && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2">
                {displayedRows.map(row => {
                  const isPos = (row.change_value??0)>=0
                  const stale = isStale(row)
                  const sparklineData = generateSparklineData(row.live_price||0, row.percent_change||0, 15)
                  return (
                    <div key={row.ticker} onClick={() => onSelectTicker(row.ticker)}
                      className={clsx('rounded-xl p-3 border cursor-pointer transition-all hover:scale-[1.02]',
                        stale?'opacity-40':'',
                        isPos?'border-emerald-700/60 bg-emerald-950/25':'border-red-700/60 bg-red-950/25')}>
                      <div className="flex justify-between items-start">
                        <span className="font-extrabold text-sm">{row.ticker}</span>
                        <span className={clsx('font-bold text-sm',isPos?'text-emerald-400':'text-red-400')}>${fmt(row.live_price)}</span>
                      </div>
                      <p className="text-[10px] text-gray-500 truncate mt-0.5">{row.company_name}</p>
                      <div className="my-2 flex justify-center">
                        <MiniSparkline data={sparklineData} width={80} height={20} color={isPos?'#10b981':'#ef4444'} isPositive={isPos}/>
                      </div>
                      <p className={clsx('text-xs font-bold',isPos?'text-emerald-400':'text-red-400')}>
                        {isPos?'▲':'▼'} {fmtS(row.change_value)} ({fmtP(row.percent_change)})
                      </p>
                      <MatrixBadges row={row}/>
                      <p className="text-[9px] text-gray-600 mt-1">🖱️ Click for chart</p>
                    </div>
                  )
                })}
              </div>
              {hasMore && (
                <div className="mt-4 flex justify-center">
                  <button onClick={loadMore} disabled={isLoadingMore}
                    className={clsx('px-6 py-2.5 rounded-lg font-semibold text-sm transition-all',
                      darkMode?'bg-cyan-500/20 border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/30':'bg-blue-500 text-white hover:bg-blue-600',
                      isLoadingMore&&'opacity-50 cursor-not-allowed')}>
                    {isLoadingMore?'Loading…':`↓ Load More (+${DISPLAY_SETTINGS.LOAD_MORE_INCREMENT})`}
                  </button>
                </div>
              )}
              <p className="text-[10px] text-gray-600 mt-3">
                Showing {effectiveDisplayCount} of {rows.length} stocks | Matrix
                {sector&&sector!=='all'?` | 🔵 ${sector}`:''}
                {activeFilter?` | 🔍 ${activeFilter}`:''}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  )
}
