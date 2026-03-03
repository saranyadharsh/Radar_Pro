/**
 * App.jsx — NexRadar Pro
 * ========================
 * Mirrors Radar_Production.py layout exactly:
 *
 * LEFT SIDEBAR:
 *   🖥️ System Status (WS health, data integrity bar, heartbeat, Reconnect WS)
 *   🌙 Dark Mode toggle
 *   ⬛ Emergency Stop (stops WS)
 *   ⏰ Auto-Switch Session / Manual session
 *   📁 Data Source (Stock List / Monitor / Portfolio / Earnings / Favorites)
 *   🔍 Sector filter (when Stock List selected)
 *   ⚙️ Display Settings (refresh slider, Min Change, Show Negative)
 *   🚀 Bulk Sync (Open Top Tickers in TradingView)
 *   🗓️ Earnings Calendar (date range picker)
 *   ⭐ Favorites Manager (add / remove)
 *   💾 Database Stats (row counts per table)
 *   ⚡ Scalping Signal Engine (watchlist editor, Apply, Load Default, Reset VWAP)
 *
 * MAIN AREA:
 *   Floating pill (WS status)
 *   Session accent badge (MARKET HOURS / PRE-MARKET / AFTER HOURS / CLOSED)
 *   Sticky compact status bar
 *   5 clickable alert filter cards: Vol Spikes | Gap Plays | AH Momentum | Earnings Gaps | 💎 Diamond
 *   Tab 1: 📊 Live Dashboard → Table view + Matrix view
 *   Tab 2: 🔍 Search & Chart (TradingView + live metrics row)
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import clsx from 'clsx'
import { useWebSocket } from './hooks/useWebSocket'
import LiveDashboard from './components/LiveDashboard'
import SignalFeed    from './components/SignalFeed'
import ChartPanel    from './components/ChartPanel'
import Sidebar       from './components/Sidebar'

const API = import.meta.env.VITE_API_BASE || ''

const SESSION_CONFIG = {
  MARKET_HOURS:    { label: 'MARKET HOURS',  color: '#16a34a', bg: 'rgba(22,163,74,0.12)'   },
  PRE_MARKET:      { label: 'PRE-MARKET',    color: '#1d4ed8', bg: 'rgba(29,78,216,0.12)'   },
  AFTER_HOURS:     { label: 'AFTER HOURS',   color: '#7c3aed', bg: 'rgba(124,58,237,0.12)'  },
  CLOSED_WEEKEND:  { label: 'CLOSED',        color: '#64748b', bg: 'rgba(100,116,139,0.10)' },
  OVERNIGHT_SLEEP: { label: 'OVERNIGHT',     color: '#64748b', bg: 'rgba(100,116,139,0.10)' },
  CLOSED:          { label: 'CLOSED',        color: '#64748b', bg: 'rgba(100,116,139,0.10)' },
}

const WS_PULSE = {
  Healthy:    'bg-green-500 animate-pulse',
  connecting: 'bg-amber-400 animate-pulse',
  Degraded:   'bg-amber-400',
  error:      'bg-red-500',
  closed:     'bg-red-500',
}

export default function App() {
  const [activeTab,    setActiveTab]    = useState('live')
  const [darkMode,     setDarkMode]     = useState(true)
  const [metrics,      setMetrics]      = useState(null)
  const [activeFilter, setActiveFilter] = useState(null)
  const [chartTicker,  setChartTicker]  = useState('')
  const [chartInterval,setChartInterval]= useState('D')
  const [source,       setSource]       = useState('all')

  const { tickers, wsStatus } = useWebSocket()

  // Poll metrics every 3s
  useEffect(() => {
    const poll = () =>
      fetch(`${API}/api/metrics`).then(r => r.json()).then(setMetrics).catch(() => {})
    poll()
    const id = setInterval(poll, 3000)
    return () => clearInterval(id)
  }, [])

  const session = metrics?.session || 'CLOSED'
  const sc = SESSION_CONFIG[session] || SESSION_CONFIG.CLOSED

  const wsColor = {
    Healthy: 'text-green-400', connecting: 'text-amber-400',
    Degraded: 'text-amber-400', error: 'text-red-400', closed: 'text-red-400',
  }[wsStatus] ?? 'text-gray-400'

  // Clickable filter cards — mirrors 5 cards in Radar_Production.py
  const FILTER_CARDS = [
    { key: 'volume_spike',  label: 'Volume Spikes', icon: '🔊', count: metrics?.volume_spikes    ?? 0 },
    { key: 'gap_play',      label: 'Gap Plays',     icon: '📊', count: metrics?.gap_plays        ?? 0 },
    { key: 'ah_momentum',   label: 'AH Momentum',   icon: '🌙', count: metrics?.ah_momentum      ?? 0 },
    { key: 'earnings_gap',  label: 'Earnings Gaps', icon: '📰', count: metrics?.earnings_gap_plays ?? 0 },
    { key: 'diamond',       label: '💎 Diamond',    icon: '💎', count: metrics?.diamond          ?? 0 },
  ]

  const handleCardClick = (key) =>
    setActiveFilter(f => f === key ? null : key)

  const handleSelectTicker = useCallback((sym) => {
    setChartTicker(sym)
    setActiveTab('search')
  }, [])

  const m = metrics

  return (
    <div className={clsx('min-h-screen font-sans', darkMode ? 'bg-[#0e1117] text-white' : 'bg-white text-gray-900')}>

      {/* Floating WS pill — top right, mirrors float-status-pill */}
      <div className="fixed top-3 right-4 z-50 flex items-center gap-1.5 text-[11px] font-semibold
                      bg-[#0f172a]/80 text-slate-100 px-3 py-1 rounded-full border border-white/10
                      backdrop-blur-sm pointer-events-none">
        <span className={clsx('w-2 h-2 rounded-full inline-block', WS_PULSE[wsStatus] ?? 'bg-gray-500')} />
        {wsStatus === 'Healthy' || wsStatus === 'open' ? 'Healthy' : wsStatus}
      </div>

      <div className="flex">

        {/* ── SIDEBAR ─────────────────────────────────────────────────────── */}
        <Sidebar
          darkMode={darkMode}
          onDarkMode={setDarkMode}
          metrics={metrics}
          wsStatus={wsStatus}
          source={source}
          onSource={setSource}
          tickers={tickers}
        />

        {/* ── MAIN CONTENT ────────────────────────────────────────────────── */}
        <main className="flex-1 min-w-0 px-5 py-4">

          {/* Title row */}
          <div className="flex items-baseline gap-2 mb-1">
            <h1 className="text-xl font-extrabold tracking-tight">📡 Radar Pro — Live Dashboard</h1>
            <span className="text-xs text-gray-500">v4.2 | Source: {source}</span>
          </div>

          {/* Session accent badge */}
          <div
            className="inline-flex items-center gap-2 px-3 py-1 rounded mb-2 text-xs font-bold tracking-widest border-l-2"
            style={{ background: sc.bg, borderColor: sc.color, color: sc.color }}
          >
            {sc.label}
          </div>

          {/* Compact sticky status bar */}
          {m && (
            <div className={clsx(
              'sticky top-0 z-40 text-xs py-1.5 border-b mb-3',
              darkMode ? 'bg-[#0e1117]/90 border-white/10 text-gray-400' : 'bg-white/90 border-gray-200 text-gray-500'
            )}>
              <span className={clsx('font-bold mr-1', wsColor)}>
                {m.ws_health === 'Healthy' ? '🟢' : m.ws_health?.includes('Degraded') ? '🟡' : '🔴'} {m.ws_health}
              </span>
              &nbsp;·&nbsp; 📡 Live <b className="text-gray-300">{m.live_count ?? 0}</b>
              &nbsp;·&nbsp; 📊 Total <b className="text-gray-300">{m.total_tickers?.toLocaleString() ?? 0}</b>
              &nbsp;·&nbsp; 🟢 Positive <b className="text-gray-300">{m.pos_count ?? 0}</b>
              &nbsp;·&nbsp; 🎯 Turned+ <b className="text-gray-300">{m.turned_positive ?? 0}</b>
              &nbsp;·&nbsp; 🕒 <b className="text-gray-300">{m.last_update}</b>
            </div>
          )}

          {/* 5 clickable filter cards */}
          <div className="grid grid-cols-5 gap-2 mb-3">
            {FILTER_CARDS.map(fc => {
              const active = activeFilter === fc.key
              return (
                <button
                  key={fc.key}
                  onClick={() => handleCardClick(fc.key)}
                  className={clsx(
                    'rounded-lg p-3 text-left border transition-all',
                    active
                      ? 'border-blue-500 bg-blue-900/30 text-white'
                      : darkMode
                        ? 'border-white/10 bg-white/5 hover:border-white/20 text-gray-300'
                        : 'border-gray-200 bg-gray-50 hover:border-blue-300 text-gray-700',
                  )}
                >
                  <div className="text-xs font-bold text-gray-400 uppercase tracking-wide">{fc.icon} {fc.label}</div>
                  <div className="text-2xl font-black mt-1">{fc.count}</div>
                </button>
              )
            })}
          </div>

          {/* Active filter note */}
          {activeFilter && (
            <p className="text-xs text-blue-400 mb-2">
              🔍 Filter: <b>{FILTER_CARDS.find(f => f.key === activeFilter)?.label}</b> — click card again to clear
            </p>
          )}

          {/* Main tabs */}
          <div className="flex gap-1 border-b border-white/10 mb-4">
            {[
              { id: 'live',    label: '📊 Live Dashboard' },
              { id: 'search',  label: '🔍 Search & Chart'  },
              { id: 'signals', label: '⚡ Signals'          },
            ].map(t => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={clsx(
                  'px-4 py-2 text-sm font-semibold border-b-2 transition-colors -mb-px',
                  activeTab === t.id
                    ? 'border-blue-500 text-blue-400'
                    : 'border-transparent text-gray-500 hover:text-gray-300',
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Tab 1 — Live Dashboard */}
          {activeTab === 'live' && (
            <LiveDashboard
              tickers={tickers}
              wsStatus={wsStatus}
              activeFilter={activeFilter}
              metrics={metrics}
              source={source}
              darkMode={darkMode}
              onSelectTicker={handleSelectTicker}
            />
          )}

          {/* Tab 2 — Search & Chart */}
          {activeTab === 'search' && (
            <SearchTab
              tickers={tickers}
              chartTicker={chartTicker}
              setChartTicker={setChartTicker}
              chartInterval={chartInterval}
              setChartInterval={setChartInterval}
              darkMode={darkMode}
            />
          )}

          {/* Tab 3 — Signals */}
          {activeTab === 'signals' && <SignalFeed />}

        </main>
      </div>

      {/* Footer */}
      <footer className="flex items-center justify-between px-5 py-2 border-t border-white/5 text-xs text-gray-600 mt-8">
        <span>📡 NexRadar Pro</span>
        <span>🕒 {new Date().toLocaleTimeString()}</span>
      </footer>
    </div>
  )
}


// ── Search & Chart Tab ─────────────────────────────────────────────────────────
function SearchTab({ tickers, chartTicker, setChartTicker, chartInterval, setChartInterval, darkMode }) {
  const [input, setInput] = useState(chartTicker)
  const row = tickers.get(chartTicker)
  const isPos = row ? row.change_value >= 0 : null

  return (
    <div className="flex flex-col gap-4">
      <h2 className="font-bold text-base">🔎 Search &amp; Chart</h2>

      {/* Input row */}
      <div className="flex gap-3 items-end flex-wrap">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-400">Symbol</label>
          <input
            value={input}
            onChange={e => setInput(e.target.value.toUpperCase())}
            onKeyDown={e => e.key === 'Enter' && setChartTicker(input)}
            placeholder="AAPL, TSLA, NVDA…"
            className="bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-white
                       placeholder-gray-600 focus:outline-none focus:border-gray-500 w-44"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-400">Interval</label>
          <select
            value={chartInterval}
            onChange={e => setChartInterval(e.target.value)}
            className="bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-white focus:outline-none"
          >
            {['1','5','15','60','D','W'].map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
        <button
          onClick={() => setChartTicker(input)}
          className="px-4 py-2 bg-blue-700 hover:bg-blue-600 rounded text-sm font-medium"
        >
          Load Chart
        </button>
      </div>

      {/* Live data row — mirrors 4 metric boxes in original */}
      {chartTicker && row && (
        <div className="grid grid-cols-4 gap-3">
          {[
            ['Price',    `$${Number(row.live_price ?? 0).toFixed(2)}`, ''],
            ['Change',   `${Number(row.change_value ?? 0) >= 0 ? '+' : ''}${Number(row.change_value ?? 0).toFixed(2)}`,
                         `${Number(row.percent_change ?? 0) >= 0 ? '+' : ''}${Number(row.percent_change ?? 0).toFixed(2)}%`],
            ['Company',  row.company_name ?? 'N/A', ''],
            ['Status',
              row.went_positive ? '🎯 Turned Positive' :
              Math.abs(row.percent_change ?? 0) >= 5 ? '💎 Diamond Alert' : '📊 Active',
              ''],
          ].map(([label, val, sub]) => (
            <div key={label} className="bg-gray-900 border border-white/10 rounded-lg p-3">
              <p className="text-xs font-semibold text-gray-400 mb-1">{label}</p>
              <p className={clsx(
                'text-lg font-black',
                label === 'Change'
                  ? isPos ? 'text-emerald-400' : 'text-red-400'
                  : 'text-white'
              )}>{val}</p>
              {sub && <p className={clsx('text-xs', isPos ? 'text-emerald-500' : 'text-red-500')}>{sub}</p>}
            </div>
          ))}
        </div>
      )}

      {chartTicker && !row && (
        <p className="text-xs text-gray-500">No live data for {chartTicker} — showing chart only</p>
      )}

      <ChartPanel ticker={chartTicker} interval={chartInterval} darkMode={darkMode} />
    </div>
  )
}
