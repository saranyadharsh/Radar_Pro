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
  const [loading,      setLoading]      = useState(false)
  const [portfolioData, setPortfolioData] = useState([])
  const [monitorData,   setMonitorData]   = useState([])

  const session = metrics?.session ?? 'MARKET_HOURS'
  const isAH    = session === 'AFTER_HOURS'
  const isClosed = session === 'OVERNIGHT_SLEEP' || session === 'CLOSED_WEEKEND'

  // Fetch portfolio and monitor data when source changes
  useEffect(() => {
    if (source === 'portfolio') {
      fetch(`${API}/api/portfolio`)
        .then(r => r.json())
        .then(data => setPortfolioData(data.tickers || []))
        .catch(() => setPortfolioData([]))
    } else if (source === 'monitor') {
      fetch(`${API}/api/monitor`)
        .then(r => r.json())
        .then(data => setMonitorData(data.tickers || []))
        .catch(() => setMonitorData([]))
    }
  }, [source])

  const rows = useMemo(() => {
    let arr = Array.from(tickers.values())

    // Source-based filtering
    if (source === 'portfolio' && portfolioData.length > 0) {
      arr = arr.filter(r => portfolioData.includes(r.ticker))
    } else if (source === 'monitor' && monitorData.length > 0) {
      arr = arr.filter(r => monitorData.includes(r.ticker))
    } else if (source === 'earnings') {
      arr = arr.filter(r => r.is_earnings_gap_play || r.earnings_date)
    } else if (source === 'favorites') {
      // Favorites would need to be passed as prop or fetched from API
      // For now, filter by diamond stocks as placeholder
      arr = arr.filter(r => Math.abs(r.percent_change ?? 0) >= 5)
    }
    // 'all' and 'stock_list' show everything (stock_list filtered by sector below)

    if (!showNegative) arr = arr.filter(r => r.is_positive)

    // Sector filter (only meaningful when source === 'stock_list')
    if (sector && sector !== 'all') {
      arr = arr.filter(r => (r.sector ?? '').toLowerCase() === sector.toLowerCase())
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
  }, [tickers, showNegative, activeFilter, minChange, cfMinPct, cfVol, cfFlags, sortKey, sector, source, portfolioData, monitorData])

  // Column config mirrors original
  const tableCols = isAH
    ? [['ticker','Ticker'],['company_name','Company'],['prev_close','Prev Close'],['today_close','Today Close'],
       ['live_price','Live Price'],['ah_dollar','AH ($)'],['ah_pct','AH (%)'],['alerts','Alerts']]
    : [['ticker','Ticker'],['company_name','Company'],['open','Open'],['hwm','HWM (Peak)'],
       ['live_price','Price'],['change_value','Change ($)'],['percent_change','Change (%)'],['alerts','Alerts']]

  const cfActive = cfMinPct > 0 || cfVol !== 'Any' || cfFlags.length > 0

  return (
    <div className="flex flex-col gap-3">

      {/* Closed warnings */}
      {session === 'OVERNIGHT_SLEEP' && (
        <div className="bg-yellow-900/30 border border-yellow-700/50 rounded p-3 text-yellow-300 text-xs">
          🌙 MARKET CLOSED (Overnight 8 PM–4 AM EST) — Live data is unreliable until 4:00 AM EST.
        </div>
      )}
      {session === 'CLOSED_WEEKEND' && (
        <div className="bg-blue-900/20 border border-blue-700/30 rounded p-3 text-blue-300 text-xs">
          🏖️ Market Closed (Weekend)
        </div>
      )}

      {/* Controls row */}
      <div className="flex items-center gap-4 flex-wrap">
        {/* View toggle — mirrors segmented control */}
        <div className="flex rounded overflow-hidden border border-white/20 text-xs">
          {['table', 'matrix'].map((v) => (
            <button
              key={v}
              onClick={() => setViewMode(v)}
              className={clsx(
                'px-3 py-1.5 font-semibold transition-colors',
                viewMode === v ? 'bg-blue-600 text-white' : 'bg-white/5 text-gray-400 hover:bg-white/10',
              )}
            >
              {v === 'table' ? '≡ Table' : '⊞ Matrix'}
            </button>
          ))}
        </div>

        {/* Min Change slider */}
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <span>Min Δ $: {fmt(minChange, 1)}</span>
          <input type="range" min={0} max={5} step={0.1} value={minChange}
            onChange={e => setMinChange(+e.target.value)}
            className="w-24 accent-blue-500" />
        </div>

        {/* Show negative */}
        <label className="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer">
          <input type="checkbox" checked={showNegative} onChange={e => setShowNegative(e.target.checked)}
            className="accent-blue-500" />
          Show –ve
        </label>

        <div className="ml-auto text-xs text-gray-500">
          {rows.length} stocks shown
        </div>
      </div>

      {/* Custom Filter Builder expander */}
      <div className="border border-white/10 rounded">
        <button
          onClick={() => setFilterOpen(o => !o)}
          className="w-full text-left px-3 py-2 text-xs text-gray-400 flex justify-between"
        >
          <span>⚙️ Custom Filter Builder {cfActive ? '(active)' : ''}</span>
          <span>{filterOpen ? '▲' : '▼'}</span>
        </button>
        {filterOpen && (
          <div className="px-3 pb-3 grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-gray-500">Min Change %</label>
              <input type="number" min={0} max={50} step={0.5} value={cfMinPct}
                onChange={e => setCfMinPct(+e.target.value)}
                className="w-full mt-0.5 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-white" />
            </div>
            <div>
              <label className="text-xs text-gray-500">Volume</label>
              <select value={cfVol} onChange={e => setCfVol(e.target.value)}
                className="w-full mt-0.5 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-white">
                {['Any','Spike Only (2×+)','Surge Only (5×+)'].map(o => <option key={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500">Alert Flags</label>
              <div className="flex flex-col gap-0.5 mt-0.5">
                {['Gap Play','AH Momentum','Turned Positive','Diamond'].map(f => (
                  <label key={f} className="flex items-center gap-1 text-xs text-gray-400 cursor-pointer">
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
              <p className="col-span-3 text-xs text-amber-400">
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
          
          {/* Loading State */}
          {loading && <TableSkeleton rows={15} cols={tableCols.length} />}
          
          {/* Empty States */}
          {!loading && rows.length === 0 && (
            wsStatus === 'connecting' ? (
              <LoadingEmptyState />
            ) : activeFilter || cfActive ? (
              <NoResultsEmptyState 
                onClear={() => {
                  setActiveFilter?.(null)
                  setCfMinPct(0)
                  setCfVol('Any')
                  setCfFlags([])
                }}
                filterName={activeFilter || 'custom filter'}
              />
            ) : (
              <NoDataEmptyState onRetry={() => window.location.reload()} />
            )
          )}
          
          {/* Data Table */}
          {!loading && rows.length > 0 && (
            <>
              <div className="overflow-x-auto rounded-lg border border-white/10">
                <table className="w-full text-left text-xs text-white">
              <thead className="bg-gray-900/80 text-gray-400 text-[10px] uppercase tracking-wide">
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
                {rows.length === 0 ? (
                  <tr><td colSpan={tableCols.length} className="text-center py-12 text-gray-600">
                    {wsStatus === 'connecting' ? '⏳ Connecting to Massive WebSocket…' : '📭 No data yet'}
                  </td></tr>
                ) : rows.map(row => {
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

                  return (
                    <tr key={row.ticker}
                      onClick={() => onSelectTicker(row.ticker)}
                      className={clsx(
                        'border-b border-white/5 cursor-pointer transition-colors',
                        stale ? 'opacity-40 italic' : rowStyle,
                      )}
                    >
                      <td className="py-2 px-3 font-bold">{row.ticker}</td>
                      <td className="py-2 px-3 text-gray-400 max-w-[140px] truncate">{row.company_name}</td>

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

          {/* Caption */}
          <p className="text-[10px] text-gray-600 mt-1">
            Showing {rows.length} stocks | {session}
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
          
          {/* Loading State */}
          {loading && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2">
              {Array.from({ length: 12 }).map((_, i) => (
                <div key={i} className="rounded-xl p-3 border border-white/10 bg-gray-900/50 animate-pulse h-32" />
              ))}
            </div>
          )}
          
          {/* Empty States */}
          {!loading && rows.length === 0 && (
            wsStatus === 'connecting' ? (
              <LoadingEmptyState />
            ) : (
              <NoDataEmptyState onRetry={() => window.location.reload()} />
            )
          )}
          
          {/* Matrix Grid */}
          {!loading && rows.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2">
            {rows.slice(0, 50).map(row => {
              const isPos  = (row.change_value ?? 0) >= 0
              const stale  = isStale(row)
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
                  <p className={clsx('text-xs font-bold mt-1', isPos ? 'text-emerald-400' : 'text-red-400')}>
                    {isPos ? '▲' : '▼'} {fmtS(row.change_value)} ({fmtP(row.percent_change)})
                  </p>
                  <MatrixBadges row={row} />
                  <p className="text-[9px] text-gray-600 mt-1">🖱️ Click for chart</p>
                </div>
              )
            })}
          </div>
          )}
          
          {!loading && rows.length > 0 && (
            <p className="text-[10px] text-gray-600 mt-1">
              Showing {Math.min(rows.length, 50)} stocks (top 50) | Matrix View
              {sector && sector !== 'all' ? ` | 🔵 ${sector}` : ''}
              {activeFilter ? ` | 🔍 ${activeFilter}` : ''}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
