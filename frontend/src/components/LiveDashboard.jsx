/**
 * LiveDashboard.jsx — NexRadar Pro
 * ==================================
 * Mirrors Tab 1 from Radar_Production.py:
 *
 * - Market closed warnings
 * - View toggle: Table | Matrix (segmented control)
 * - Min Change $ slider + Show -ve checkbox + custom filter builder expander
 * - TABLE VIEW:
 *   Columns: Ticker | Company | Open | HWM (Peak) | Price | Change ($) | Change (%) → Market
 *            Ticker | Company | Prev Close | Today Close | Live Price | AH ($) | AH (%) → AH
 *   Earnings source: inserts Earnings Date + Time + Gap % columns
 *   Sparkline column (≤50 rows)
 *   Alerts column: 🔊vol | 📊gap | 🌙ah | 📰GAP | 💎 badges
 *   Stale price: grayed row + ⏱️ badge if no tick >5min
 *   Row styling: green/red backgrounds on change columns
 *   Caption with count, session, filter note
 * - MATRIX VIEW:
 *   Card per ticker: ticker, badges (💎🎯🔊🌙), price, change
 *   Clickable card → opens chart in Search tab
 *   Top 50 only
 */

import { useState, useMemo, useEffect } from 'react'
import clsx from 'clsx'
import { NoDataEmptyState, NoResultsEmptyState, LoadingEmptyState } from './EmptyState'
import { TableSkeleton } from './SkeletonLoader'
import MiniSparkline, { generateSparklineData } from './MiniSparkline'

const API = import.meta.env.VITE_API_BASE || ''
const fmt   = (n, d = 2) => Number(n ?? 0).toFixed(d)
const fmtS  = (n)        => (n >= 0 ? '+' : '') + fmt(n)
const fmtP  = (n)        => (n >= 0 ? '+' : '') + fmt(n) + '%'
const isStale = (r) => (Date.now() / 1000 - (r.last_tick_time ?? 0)) > 300

function Badge({ label, cls }) {
  return <span className={clsx('text-[9px] font-bold px-1.5 py-0.5 rounded', cls)}>{label}</span>
}

function AlertBadges({ row }) {
  return (
    <span className="flex gap-1 flex-wrap">
      {row.volume_spike_level === 'high' && (
        <Badge label={`🔊 ${fmt(row.volume_ratio, 1)}x`} cls="bg-red-600 text-white" />
      )}
      {row.volume_spike && row.volume_spike_level !== 'high' && (
        <Badge label={`📢 ${fmt(row.volume_ratio, 1)}x`} cls="bg-orange-500 text-white" />
      )}
      {row.is_gap_play && (
        <Badge label={`📊${row.gap_direction === 'up' ? '↑' : '↓'}${fmt(Math.abs(row.gap_percent), 1)}%`}
          cls="bg-blue-600 text-white" />
      )}
      {row.ah_momentum && <Badge label="🌙 AH" cls="bg-purple-600 text-white" />}
      {row.is_earnings_gap_play && <Badge label="📰 GAP" cls="bg-blue-500 text-white" />}
    </span>
  )
}

function MatrixBadges({ row }) {
  return (
    <span className="flex gap-1 flex-wrap mt-1">
      {Math.abs(row.percent_change ?? 0) >= 5 && <Badge label="💎" cls="bg-amber-400 text-black" />}
      {row.went_positive === 1            && <Badge label="🎯" cls="bg-cyan-500 text-black" />}
      {row.volume_spike_level === 'high'  && <Badge label="🔊" cls="bg-red-600 text-white" />}
      {row.ah_momentum                    && <Badge label="🌙" cls="bg-purple-600 text-white" />}
    </span>
  )
}

export default function LiveDashboard({
  tickers, wsStatus, activeFilter, metrics, source, sector, darkMode, onSelectTicker,
}) {
  const [viewMode,     setViewMode]     = useState('table')
  const [minChange,    setMinChange]    = useState(0)
  const [showNegative, setShowNegative] = useState(false)
  const [sortKey,      setSortKey]      = useState('change_value')
  const [cfMinPct,     setCfMinPct]     = useState(0)
  const [cfVol,        setCfVol]        = useState('Any')
  const [cfFlags,      setCfFlags]      = useState([])
  const [filterOpen,   setFilterOpen]   = useState(false)
  const [portfolioData, setPortfolioData] = useState([])
  const [monitorData,   setMonitorData]   = useState([])
  const [earningsData,  setEarningsData]  = useState([])
  const [displayCount,  setDisplayCount]  = useState(50)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [isLoadingSource, setIsLoadingSource] = useState(false)

  const session = metrics?.session ?? 'MARKET_HOURS'
  const isAH    = session === 'AFTER_HOURS'

  // Reset display count when filters change
  useEffect(() => {
    setDisplayCount(50)
  }, [activeFilter, source, sector, minChange, cfMinPct, cfVol, cfFlags, showNegative])

  // Fetch portfolio, monitor, and earnings data when source changes
  useEffect(() => {
    setIsLoadingSource(true)
    
    if (source === 'portfolio') {
      fetch(`${API}/api/portfolio`)
        .then(r => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`)
          return r.json()
        })
        .then(data => {
          console.log('[LiveDashboard] Portfolio data:', data)
          setPortfolioData(data.tickers || data || [])
        })
        .catch(err => {
          console.error('[LiveDashboard] Portfolio fetch error:', err)
          setPortfolioData([])
        })
        .finally(() => setIsLoadingSource(false))
    } else if (source === 'monitor') {
      fetch(`${API}/api/monitor`)
        .then(r => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`)
          return r.json()
        })
        .then(data => {
          console.log('[LiveDashboard] Monitor data:', data)
          setMonitorData(data.tickers || data || [])
        })
        .catch(err => {
          console.error('[LiveDashboard] Monitor fetch error:', err)
          setMonitorData([])
        })
        .finally(() => setIsLoadingSource(false))
    } else if (source === 'earnings') {
      const start = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
      const end   = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10)
      fetch(`${API}/api/earnings?start=${start}&end=${end}`)
        .then(r => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`)
          return r.json()
        })
        .then(data => {
          console.log('[LiveDashboard] Earnings data:', data)
          const tickers = Array.isArray(data) ? data.map(e => e.ticker) : []
          setEarningsData(tickers)
        })
        .catch(err => {
          console.error('[LiveDashboard] Earnings fetch error:', err)
          setEarningsData([])
        })
        .finally(() => setIsLoadingSource(false))
    } else {
      // Reset when switching to 'all' or other sources
      setPortfolioData([])
      setMonitorData([])
      setEarningsData([])
      setIsLoadingSource(false)
    }
  }, [source])

  const rows = useMemo(() => {
    let arr = Array.from(tickers.values())
    
    console.log('[LiveDashboard] Filtering - source:', source, 'tickers count:', arr.length)

    // Source-based filtering
    if (source === 'portfolio') {
      console.log('[LiveDashboard] Portfolio filter - data:', portfolioData)
      if (portfolioData.length > 0) {
        arr = arr.filter(r => portfolioData.includes(r.ticker))
        console.log('[LiveDashboard] After portfolio filter:', arr.length)
      } else {
        // Show empty state if no portfolio data loaded yet
        arr = []
      }
    } else if (source === 'monitor') {
      console.log('[LiveDashboard] Monitor filter - data:', monitorData)
      if (monitorData.length > 0) {
        arr = arr.filter(r => monitorData.includes(r.ticker))
        console.log('[LiveDashboard] After monitor filter:', arr.length)
      } else {
        arr = []
      }
    } else if (source === 'earnings') {
      console.log('[LiveDashboard] Earnings filter - data:', earningsData)
      if (earningsData.length > 0) {
        arr = arr.filter(r => earningsData.includes(r.ticker))
        console.log('[LiveDashboard] After earnings filter:', arr.length)
      } else {
        // Show empty state if no earnings data loaded yet
        arr = []
      }
    } else if (source === 'favorites') {
      // Favorites would need to be passed as prop or fetched from API
      // For now, filter by diamond stocks as placeholder
      arr = arr.filter(r => Math.abs(r.percent_change ?? 0) >= 5)
    }
    // 'all' and 'stock_list' show everything (stock_list filtered by sector below)

    if (!showNegative) arr = arr.filter(r => r.is_positive)

    // Sector filter — only for stock_list / all sources
    if (sector && sector !== 'all' && (source === 'stock_list' || source === 'all')) {
      // DEBUG: log unique sector values (remove once confirmed matching)
      const uniqueSectors = [...new Set(Array.from(tickers.values()).map(r => r.sector))]
      console.log('[NexRadar] Sector values in WS data:', uniqueSectors)
      console.log('[NexRadar] Filtering by sector:', sector)
      arr = arr.filter(r => (r.sector ?? '').trim().toLowerCase() === sector.trim().toLowerCase())
    }

    // Active filter card
    if (activeFilter === 'volume_spike') arr = arr.filter(r => r.volume_spike)
    else if (activeFilter === 'gap_play')     arr = arr.filter(r => r.is_gap_play)
    else if (activeFilter === 'ah_momentum')  arr = arr.filter(r => r.ah_momentum)
    else if (activeFilter === 'earnings_gap') arr = arr.filter(r => r.is_earnings_gap_play)
    else if (activeFilter === 'diamond')      arr = arr.filter(r => Math.abs(r.percent_change ?? 0) >= 5)

    // Min change filter
    if (minChange > 0) arr = arr.filter(r => Math.abs(r.change_value ?? 0) >= minChange)

    // Custom filter builder
    if (cfMinPct > 0)                    arr = arr.filter(r => Math.abs(r.percent_change ?? 0) >= cfMinPct)
    if (cfVol === 'Spike Only (2×+)')    arr = arr.filter(r => r.volume_spike)
    if (cfVol === 'Surge Only (5×+)')    arr = arr.filter(r => r.volume_spike_level === 'high')
    if (cfFlags.includes('Gap Play'))    arr = arr.filter(r => r.is_gap_play)
    if (cfFlags.includes('AH Momentum')) arr = arr.filter(r => r.ah_momentum)
    if (cfFlags.includes('Turned Positive')) arr = arr.filter(r => r.went_positive === 1)
    if (cfFlags.includes('Diamond'))     arr = arr.filter(r => Math.abs(r.percent_change ?? 0) >= 5)

    arr.sort((a, b) => (b[sortKey] ?? 0) - (a[sortKey] ?? 0))
    return arr
  }, [tickers, showNegative, activeFilter, minChange, cfMinPct, cfVol, cfFlags, sortKey, sector, source, portfolioData, monitorData, earningsData])

  // Column config with sparkline
  const tableCols = isAH
    ? [['ticker','Ticker'],['company_name','Company'],['sparkline','Trend'],['prev_close','Prev Close'],['today_close','Today Close'],
       ['live_price','Live Price'],['ah_dollar','AH ($)'],['ah_pct','AH (%)'],['alerts','Alerts']]
    : [['ticker','Ticker'],['company_name','Company'],['sparkline','Trend'],['open','Open'],['hwm','HWM (Peak)'],
       ['live_price','Price'],['change_value','Change ($)'],['percent_change','Change (%)'],['alerts','Alerts']]

  const cfActive = cfMinPct > 0 || cfVol !== 'Any' || cfFlags.length > 0

  // Infinite scroll and load more
  const displayedRows = rows.slice(0, displayCount)
  const hasMore = displayCount < rows.length

  const loadMore = () => {
    setIsLoadingMore(true)
    setTimeout(() => {
      setDisplayCount(prev => Math.min(prev + 50, rows.length))
      setIsLoadingMore(false)
    }, 300)
  }

  // Auto-load on scroll
  useEffect(() => {
    const handleScroll = () => {
      if (isLoadingMore || !hasMore) return
      const scrollPosition = window.innerHeight + window.scrollY
      const threshold = document.documentElement.scrollHeight - 200
      if (scrollPosition >= threshold) {
        loadMore()
      }
    }
    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [isLoadingMore, hasMore, displayCount])

  return (
    <div className={clsx(
      'flex flex-col gap-3 rounded-lg p-4',
      darkMode ? 'bg-[#0a0f1a]' : 'bg-white shadow-sm'
    )}>

      {/* Closed warnings */}
      {session === 'OVERNIGHT_SLEEP' && (
        <div className={clsx(
          'border rounded p-3 text-xs',
          darkMode
            ? 'bg-yellow-900/30 border-yellow-700/50 text-yellow-300'
            : 'bg-yellow-50 border-yellow-300 text-yellow-900'
        )}>
          🌙 MARKET CLOSED (Overnight 8 PM–4 AM EST) — Live data is unreliable until 4:00 AM EST.
        </div>
      )}
      {session === 'CLOSED_WEEKEND' && (
        <div className={clsx(
          'border rounded p-3 text-xs',
          darkMode
            ? 'bg-blue-900/20 border-blue-700/30 text-blue-300'
            : 'bg-blue-50 border-blue-300 text-blue-900'
        )}>
          🏖️ Market Closed (Weekend)
        </div>
      )}

      {/* Controls row */}
      <div className="flex items-center gap-4 flex-wrap">
        {/* View toggle — mirrors segmented control */}
        <div className={clsx(
          'flex rounded overflow-hidden border text-xs',
          darkMode ? 'border-white/20' : 'border-slate-300'
        )}>
          {['table', 'matrix'].map((v) => (
            <button
              key={v}
              onClick={() => setViewMode(v)}
              className={clsx(
                'px-3 py-1.5 font-semibold transition-colors',
                viewMode === v 
                  ? darkMode 
                    ? 'bg-blue-600 text-white' 
                    : 'bg-blue-500 text-white'
                  : darkMode
                    ? 'bg-white/5 text-gray-400 hover:bg-white/10'
                    : 'bg-slate-50 text-slate-600 hover:bg-slate-100',
              )}
            >
              {v === 'table' ? '≡ Table' : '⊞ Matrix'}
            </button>
          ))}
        </div>

        {/* Min Change slider */}
        <div className={clsx('flex items-center gap-2 text-xs', darkMode ? 'text-gray-400' : 'text-slate-600')}>
          <span>Min Δ $: {fmt(minChange, 1)}</span>
          <input type="range" min={0} max={5} step={0.1} value={minChange}
            onChange={e => setMinChange(+e.target.value)}
            className="w-24 accent-blue-500" />
        </div>

        {/* Show negative */}
        <label className={clsx('flex items-center gap-1.5 text-xs cursor-pointer', darkMode ? 'text-gray-400' : 'text-slate-600')}>
          <input type="checkbox" checked={showNegative} onChange={e => setShowNegative(e.target.checked)}
            className="accent-blue-500" />
          Show –ve
        </label>

        <div className={clsx('ml-auto text-xs', darkMode ? 'text-gray-500' : 'text-slate-600')}>
          {isLoadingSource ? (
            <span className="flex items-center gap-2">
              <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Loading {source}...
            </span>
          ) : (
            <span>{rows.length} stocks shown</span>
          )}
        </div>
      </div>

      {/* Custom Filter Builder expander */}
      <div className={clsx('border rounded', darkMode ? 'border-white/10' : 'border-slate-200')}>
        <button
          onClick={() => setFilterOpen(o => !o)}
          className={clsx(
            'w-full text-left px-3 py-2 text-xs flex justify-between',
            darkMode ? 'text-gray-400' : 'text-slate-600'
          )}
        >
          <span>⚙️ Custom Filter Builder {cfActive ? '(active)' : ''}</span>
          <span>{filterOpen ? '▲' : '▼'}</span>
        </button>
        {filterOpen && (
          <div className="px-3 pb-3 grid grid-cols-3 gap-3">
            <div>
              <label className={clsx('text-xs', darkMode ? 'text-gray-500' : 'text-slate-600')}>Min Change %</label>
              <input type="number" min={0} max={50} step={0.5} value={cfMinPct}
                onChange={e => setCfMinPct(+e.target.value)}
                className={clsx(
                  'w-full mt-0.5 border rounded px-2 py-1 text-xs',
                  darkMode
                    ? 'bg-gray-900 border-gray-700 text-white'
                    : 'bg-white border-slate-300 text-slate-900'
                )} />
            </div>
            <div>
              <label className={clsx('text-xs', darkMode ? 'text-gray-500' : 'text-slate-600')}>Volume</label>
              <select value={cfVol} onChange={e => setCfVol(e.target.value)}
                className={clsx(
                  'w-full mt-0.5 border rounded px-2 py-1 text-xs',
                  darkMode
                    ? 'bg-gray-900 border-gray-700 text-white'
                    : 'bg-white border-slate-300 text-slate-900'
                )}>
                {['Any','Spike Only (2×+)','Surge Only (5×+)'].map(o => <option key={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <label className={clsx('text-xs', darkMode ? 'text-gray-500' : 'text-slate-600')}>Alert Flags</label>
              <div className="flex flex-col gap-0.5 mt-0.5">
                {['Gap Play','AH Momentum','Turned Positive','Diamond'].map(f => (
                  <label key={f} className={clsx('flex items-center gap-1 text-xs cursor-pointer', darkMode ? 'text-gray-400' : 'text-slate-600')}>
                    <input type="checkbox"
                      checked={cfFlags.includes(f)}
                      onChange={e => setCfFlags(prev =>
                        e.target.checked ? [...prev, f] : prev.filter(x => x !== f)
                      )}
                      className="accent-blue-500" />
                    {f}
                  </label>
                ))}
              </div>
            </div>
            {cfActive && (
              <p className={clsx('col-span-3 text-xs', darkMode ? 'text-amber-400' : 'text-amber-700')}>
                🔧 Custom filter active — {cfMinPct}% min | {cfVol} vol | flags: {cfFlags.join(', ') || 'any'}
              </p>
            )}
          </div>
        )}
      </div>

      {/* ── TABLE VIEW ─────────────────────────────────────────────────────── */}
      {viewMode === 'table' && (
        <div>
          <h3 className="text-sm font-bold mb-2">📊 Live Stock Data</h3>
          
          {/* Empty States */}
          {isLoadingSource ? (
            <LoadingEmptyState darkMode={darkMode} />
          ) : rows.length === 0 && (
            wsStatus === 'connecting' ? (
              <LoadingEmptyState darkMode={darkMode} />
            ) : tickers.size === 0 ? (
              <NoDataEmptyState onRetry={() => window.location.reload()} darkMode={darkMode} />
            ) : (source === 'portfolio' || source === 'monitor' || source === 'earnings') && 
               (portfolioData.length === 0 && monitorData.length === 0 && earningsData.length === 0) ? (
              <div className={clsx(
                'text-center py-12 rounded-lg border',
                darkMode ? 'bg-white/5 border-white/10' : 'bg-slate-50 border-slate-200'
              )}>
                <div className="text-5xl mb-4">📭</div>
                <p className={clsx('text-sm font-semibold mb-2', darkMode ? 'text-white' : 'text-slate-900')}>
                  No {source} data available
                </p>
                <p className={clsx('text-xs', darkMode ? 'text-gray-500' : 'text-slate-600')}>
                  {source === 'portfolio' && 'Add stocks to your portfolio to see them here'}
                  {source === 'monitor' && 'Add stocks to your monitor list to track them'}
                  {source === 'earnings' && 'No upcoming earnings in the selected date range'}
                </p>
              </div>
            ) : (
              <NoResultsEmptyState
                onClear={() => {
                  if (activeFilter) {
                    // Need to call parent's setActiveFilter - for now just reset local filters
                  }
                  setCfMinPct(0)
                  setCfVol('Any')
                  setCfFlags([])
                  setMinChange(0)
                  setShowNegative(false)
                }}
                filterName={source !== 'all' ? source : (activeFilter || 'current filter')}
                darkMode={darkMode}
              />
            )
          )}
          
          {/* Data Table */}
          {rows.length > 0 && (
            <>
              <div className={clsx('overflow-x-auto rounded-lg border', darkMode ? 'border-white/10' : 'border-slate-200')}>
                <table className="w-full text-left text-xs">
              <thead className={clsx(
                'text-[10px] uppercase tracking-wide',
                darkMode ? 'bg-gray-900/80 text-gray-400' : 'bg-slate-100 text-slate-700'
              )}>
                <tr>
                  {tableCols.map(([key, label]) => (
                    <th
                      key={label}
                      onClick={() => key && key !== 'alerts' && setSortKey(key)}
                      className={clsx('px-3 py-2', key && key !== 'alerts' && 'cursor-pointer hover:text-white')}
                    >
                      {label}{sortKey === key ? ' ↓' : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {displayedRows.map(row => {
                  const stale  = isStale(row)
                  const chgVal = isAH
                    ? (row.live_price - (row.today_close > 0 ? row.today_close : row.prev_close))
                    : row.change_value
                  const chgPct = isAH && (row.today_close > 0 ? row.today_close : row.prev_close) > 0
                    ? (chgVal / (row.today_close > 0 ? row.today_close : row.prev_close)) * 100
                    : row.percent_change
                  const isPos  = chgVal >= 0
                  const rowStyle = isPos
                    ? 'bg-emerald-950/10 hover:bg-emerald-950/20'
                    : 'bg-red-950/10 hover:bg-red-950/20'
                  
                  // Generate sparkline data
                  const sparklineData = generateSparklineData(
                    row.live_price || 0,
                    row.percent_change || 0,
                    20
                  )

                  return (
                    <tr key={row.ticker}
                      onClick={() => onSelectTicker(row.ticker)}
                      className={clsx(
                        'border-b border-white/5 cursor-pointer transition-colors',
                        stale ? 'opacity-40 italic' : rowStyle,
                      )}
                    >
                      <td className="py-2 px-3">
                        <div className="flex items-center gap-2">
                          <span className="font-bold">{row.ticker}</span>
                          {activeFilter && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/20 border border-blue-500/30 text-blue-400">
                              {activeFilter === 'gap_play' && row.is_gap_play && '📊'}
                              {activeFilter === 'volume_spike' && row.volume_spike && '🔊'}
                              {activeFilter === 'ah_momentum' && row.ah_momentum && '🌙'}
                              {activeFilter === 'earnings_gap' && row.is_earnings_gap_play && '📰'}
                              {activeFilter === 'diamond' && Math.abs(row.percent_change ?? 0) >= 5 && '💎'}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-2 px-3 text-gray-400 max-w-[140px] truncate">{row.company_name}</td>
                      
                      {/* Sparkline */}
                      <td className="py-2 px-3">
                        <MiniSparkline
                          data={sparklineData}
                          width={70}
                          height={28}
                          color={isPos ? '#10b981' : '#ef4444'}
                          isPositive={isPos}
                          showTooltip={true}
                          ticker={row.ticker}
                        />
                      </td>

                      {isAH ? (
                        <>
                          <td className="py-2 px-3 font-mono">{fmt(row.prev_close)}</td>
                          <td className="py-2 px-3 font-mono">{fmt(row.today_close || row.prev_close)}</td>
                          <td className="py-2 px-3 font-mono font-semibold">
                            {stale ? `⏱️ ${fmt(row.live_price)}` : fmt(row.live_price)}
                          </td>
                          <td className={clsx('py-2 px-3 font-mono font-bold',
                            isPos ? 'text-emerald-400 bg-emerald-950/30' : 'text-red-400 bg-red-950/30')}>
                            {fmtS(chgVal)}
                          </td>
                          <td className={clsx('py-2 px-3 font-mono font-bold',
                            isPos ? 'text-emerald-400 bg-emerald-950/30' : 'text-red-400 bg-red-950/30')}>
                            {fmtP(chgPct)}
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="py-2 px-3 font-mono">{fmt(row.open)}</td>
                          <td className="py-2 px-3 font-mono">{fmt(row.hwm)}</td>
                          <td className={clsx('py-2 px-3 font-mono font-semibold',
                            isPos ? 'text-emerald-300' : 'text-red-300')}>
                            {fmt(row.live_price)}
                          </td>
                          <td className={clsx('py-2 px-3 font-mono font-bold',
                            isPos ? 'text-emerald-400 bg-emerald-950/30' : 'text-red-400 bg-red-950/30')}>
                            {fmtS(row.change_value)}
                          </td>
                          <td className={clsx('py-2 px-3 font-mono font-bold',
                            isPos ? 'text-emerald-400 bg-emerald-950/30' : 'text-red-400 bg-red-950/30')}>
                            {fmtP(row.percent_change)}
                          </td>
                        </>
                      )}

                      <td className="py-2 px-3"><AlertBadges row={row} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Load More Section */}
          {hasMore && (
            <div className="mt-4 flex flex-col items-center gap-3">
              <div className={clsx(
                'flex items-center gap-2 text-xs',
                darkMode ? 'text-gray-500' : 'text-slate-500'
              )}>
                <span>Showing {displayCount} of {rows.length} stocks</span>
                <span>•</span>
                <span>{rows.length - displayCount} more available</span>
              </div>
              
              <button
                onClick={loadMore}
                disabled={isLoadingMore}
                className={clsx(
                  'px-6 py-2.5 rounded-lg font-semibold text-sm transition-all flex items-center gap-2',
                  darkMode
                    ? 'bg-cyan-500/20 border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/30'
                    : 'bg-blue-500 text-white hover:bg-blue-600',
                  isLoadingMore && 'opacity-50 cursor-not-allowed'
                )}
              >
                {isLoadingMore ? (
                  <>
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Loading...
                  </>
                ) : (
                  <>
                    <span>↓ Load More Stocks</span>
                    <span className={clsx(
                      'px-2 py-0.5 rounded text-xs font-bold',
                      darkMode ? 'bg-cyan-500/30' : 'bg-white/30'
                    )}>
                      +50
                    </span>
                  </>
                )}
              </button>

              <p className={clsx(
                'text-[10px]',
                darkMode ? 'text-gray-600' : 'text-slate-400'
              )}>
                💡 Scroll down to automatically load more stocks
              </p>
            </div>
          )}

          {/* Caption */}
          <p className="text-[10px] text-gray-600 mt-3">
            Showing {displayCount} of {rows.length} stocks | {session}
            {sector && sector !== 'all' ? ` | 🔵 Sector: ${sector}` : ''}
            {activeFilter ? ` | 🔍 Filter: ${activeFilter}` : ''}
            {isAH && rows.some(r => isStale(r)) ? ` | ⏱️ ${rows.filter(r => isStale(r)).length} stale price(s)` : ''}
          </p>
        </>
          )}
        </div>
      )}

      {/* ── MATRIX VIEW ────────────────────────────────────────────────────── */}
      {viewMode === 'matrix' && (
        <div>
          <h3 className="text-sm font-bold mb-2">⊞ Matrix View</h3>
          
          {/* Empty States */}
          {isLoadingSource ? (
            <LoadingEmptyState darkMode={darkMode} />
          ) : rows.length === 0 && (
            wsStatus === 'connecting' ? (
              <LoadingEmptyState darkMode={darkMode} />
            ) : tickers.size === 0 ? (
              <NoDataEmptyState onRetry={() => window.location.reload()} darkMode={darkMode} />
            ) : (source === 'portfolio' || source === 'monitor' || source === 'earnings') && 
               (portfolioData.length === 0 && monitorData.length === 0 && earningsData.length === 0) ? (
              <div className={clsx(
                'text-center py-12 rounded-lg border',
                darkMode ? 'bg-white/5 border-white/10' : 'bg-slate-50 border-slate-200'
              )}>
                <div className="text-5xl mb-4">📭</div>
                <p className={clsx('text-sm font-semibold mb-2', darkMode ? 'text-white' : 'text-slate-900')}>
                  No {source} data available
                </p>
                <p className={clsx('text-xs', darkMode ? 'text-gray-500' : 'text-slate-600')}>
                  {source === 'portfolio' && 'Add stocks to your portfolio to see them here'}
                  {source === 'monitor' && 'Add stocks to your monitor list to track them'}
                  {source === 'earnings' && 'No upcoming earnings in the selected date range'}
                </p>
              </div>
            ) : (
              <NoResultsEmptyState
                onClear={() => {
                  setCfMinPct(0)
                  setCfVol('Any')
                  setCfFlags([])
                  setMinChange(0)
                  setShowNegative(false)
                }}
                filterName={source !== 'all' ? source : (activeFilter || 'current filter')}
                darkMode={darkMode}
              />
            )
          )}
          
          {/* Matrix Grid */}
          {rows.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2">
            {displayedRows.map(row => {
              const isPos  = (row.change_value ?? 0) >= 0
              const stale  = isStale(row)
              const sparklineData = generateSparklineData(
                row.live_price || 0,
                row.percent_change || 0,
                15
              )
              return (
                <div
                  key={row.ticker}
                  onClick={() => onSelectTicker(row.ticker)}
                  className={clsx(
                    'rounded-xl p-3 border cursor-pointer transition-all hover:scale-[1.02]',
                    stale ? 'opacity-40' : '',
                    isPos
                      ? 'border-emerald-700/60 bg-emerald-950/25'
                      : 'border-red-700/60 bg-red-950/25',
                  )}
                >
                  <div className="flex justify-between items-start">
                    <span className="font-extrabold text-sm">{row.ticker}</span>
                    <span className={clsx('font-bold text-sm', isPos ? 'text-emerald-400' : 'text-red-400')}>
                      ${fmt(row.live_price)}
                    </span>
                  </div>
                  <p className="text-[10px] text-gray-500 truncate mt-0.5">{row.company_name}</p>
                  
                  {/* Mini Sparkline */}
                  <div className="my-2 flex justify-center">
                    <MiniSparkline
                      data={sparklineData}
                      width={80}
                      height={20}
                      color={isPos ? '#10b981' : '#ef4444'}
                      isPositive={isPos}
                    />
                  </div>
                  
                  <p className={clsx('text-xs font-bold', isPos ? 'text-emerald-400' : 'text-red-400')}>
                    {isPos ? '▲' : '▼'} {fmtS(row.change_value)} ({fmtP(row.percent_change)})
                  </p>
                  <MatrixBadges row={row} />
                  <p className="text-[9px] text-gray-600 mt-1">🖱️ Click for chart</p>
                </div>
              )
            })}
          </div>
          )}
          
          {/* Load More for Matrix View */}
          {rows.length > 0 && hasMore && (
            <div className="mt-4 flex flex-col items-center gap-3">
              <button
                onClick={loadMore}
                disabled={isLoadingMore}
                className={clsx(
                  'px-6 py-2.5 rounded-lg font-semibold text-sm transition-all flex items-center gap-2',
                  darkMode
                    ? 'bg-cyan-500/20 border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/30'
                    : 'bg-blue-500 text-white hover:bg-blue-600',
                  isLoadingMore && 'opacity-50 cursor-not-allowed'
                )}
              >
                {isLoadingMore ? (
                  <>
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Loading...
                  </>
                ) : (
                  <>
                    <span>↓ Load More Cards</span>
                    <span className={clsx(
                      'px-2 py-0.5 rounded text-xs font-bold',
                      darkMode ? 'bg-cyan-500/30' : 'bg-white/30'
                    )}>
                      +50
                    </span>
                  </>
                )}
              </button>
            </div>
          )}
          
          {rows.length > 0 && (
            <p className="text-[10px] text-gray-600 mt-3">
              Showing {displayCount} of {rows.length} stocks | Matrix View
              {sector && sector !== 'all' ? ` | 🔵 ${sector}` : ''}
              {activeFilter ? ` | 🔍 ${activeFilter}` : ''}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
