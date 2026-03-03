/**
 * App.jsx — NexRadar Pro v4.2
 * Professional trading dashboard redesign
 * NexRadarDashboard added as "🏠 Dashboard" home tab
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import clsx from 'clsx'
import { useWebSocket } from './hooks/useWebSocket'
import LiveDashboard    from './components/LiveDashboard'
import SignalFeed       from './components/SignalFeed'
import ChartPanel       from './components/ChartPanel'
import Sidebar          from './components/Sidebar'
import NexRadarDashboard from './components/NexRadarDashboard'   // ← NEW

const API = import.meta.env.VITE_API_BASE || ''

const SESSION_CONFIG = {
  MARKET_HOURS:    { label: 'Market Open',  short: 'MH',  color: '#10b981', bg: 'rgba(16,185,129,0.15)', dot: 'bg-emerald-400' },
  PRE_MARKET:      { label: 'Pre-Market',   short: 'PM',  color: '#3b82f6', bg: 'rgba(59,130,246,0.15)', dot: 'bg-blue-400' },
  AFTER_HOURS:     { label: 'After Hours',  short: 'AH',  color: '#8b5cf6', bg: 'rgba(139,92,246,0.15)', dot: 'bg-violet-400' },
  CLOSED_WEEKEND:  { label: 'Weekend',      short: 'WE',  color: '#6b7280', bg: 'rgba(107,114,128,0.10)', dot: 'bg-gray-500' },
  OVERNIGHT_SLEEP: { label: 'Overnight',    short: 'ON',  color: '#6b7280', bg: 'rgba(107,114,128,0.10)', dot: 'bg-gray-500' },
  CLOSED:          { label: 'Closed',       short: 'CL',  color: '#6b7280', bg: 'rgba(107,114,128,0.10)', dot: 'bg-gray-500' },
}

const FILTER_CARDS = [
  { key: 'volume_spike', label: 'Vol Spikes', icon: '🔊', metricKey: 'volume_spikes',     color: 'from-orange-500/20 to-red-500/10',    border: 'border-orange-500/30',  text: 'text-orange-400' },
  { key: 'gap_play',     label: 'Gap Plays',  icon: '📊', metricKey: 'gap_plays',          color: 'from-blue-500/20 to-cyan-500/10',     border: 'border-blue-500/30',    text: 'text-blue-400' },
  { key: 'ah_momentum',  label: 'AH Momt.',   icon: '🌙', metricKey: 'ah_momentum',        color: 'from-violet-500/20 to-purple-500/10', border: 'border-violet-500/30',  text: 'text-violet-400' },
  { key: 'earnings_gap', label: 'Earn. Gaps', icon: '📰', metricKey: 'earnings_gap_plays', color: 'from-cyan-500/20 to-teal-500/10',     border: 'border-cyan-500/30',    text: 'text-cyan-400' },
  { key: 'diamond',      label: 'Diamond',    icon: '💎', metricKey: 'diamond',             color: 'from-amber-500/20 to-yellow-500/10',  border: 'border-amber-500/30',   text: 'text-amber-400' },
]

// ── Notification System ────────────────────────────────────────────────────────
function useNotifications(metrics) {
  const [notes, setNotes] = useState([])
  const prevMetrics = useRef(null)

  useEffect(() => {
    if (!metrics || !prevMetrics.current) { prevMetrics.current = metrics; return }
    const prev = prevMetrics.current
    const newNotes = []
    const ts = new Date().toLocaleTimeString()
    if ((metrics.volume_spikes ?? 0) > (prev.volume_spikes ?? 0))
      newNotes.push({ id: Date.now() + 1, icon: '🔊', text: `${metrics.volume_spikes} Volume Spikes detected`, time: ts, type: 'vol' })
    if ((metrics.gap_plays ?? 0) > (prev.gap_plays ?? 0))
      newNotes.push({ id: Date.now() + 2, icon: '📊', text: `${metrics.gap_plays} Gap Plays active`, time: ts, type: 'gap' })
    if ((metrics.diamond ?? 0) > (prev.diamond ?? 0))
      newNotes.push({ id: Date.now() + 3, icon: '💎', text: `Diamond alert triggered!`, time: ts, type: 'diamond' })
    if (newNotes.length) setNotes(n => [...newNotes, ...n].slice(0, 20))
    prevMetrics.current = metrics
  }, [metrics])

  const dismiss = (id) => setNotes(n => n.filter(x => x.id !== id))
  const clearAll = () => setNotes([])
  return { notes, dismiss, clearAll }
}

// ── Notification Panel ─────────────────────────────────────────────────────────
function NotificationPanel({ notes, dismiss, clearAll, onClose }) {
  return (
    <div className="absolute right-0 top-full mt-2 w-80 z-50 rounded-xl border border-white/10
                    bg-[#0d1117]/95 backdrop-blur-xl shadow-2xl shadow-black/50 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <span className="text-sm font-bold text-white">Notifications</span>
        <div className="flex gap-2">
          {notes.length > 0 && (
            <button onClick={clearAll} className="text-[10px] text-gray-500 hover:text-gray-300">Clear all</button>
          )}
          <button onClick={onClose} className="text-gray-500 hover:text-white text-lg leading-none">×</button>
        </div>
      </div>
      <div className="max-h-80 overflow-y-auto">
        {notes.length === 0 ? (
          <div className="py-8 text-center text-gray-600 text-sm">No notifications yet</div>
        ) : notes.map(n => (
          <div key={n.id} className="flex items-start gap-3 px-4 py-3 border-b border-white/5
                                     hover:bg-white/5 transition-colors group">
            <span className="text-base mt-0.5">{n.icon}</span>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-gray-200">{n.text}</p>
              <p className="text-[10px] text-gray-600 mt-0.5">{n.time}</p>
            </div>
            <button onClick={() => dismiss(n.id)}
              className="text-gray-700 hover:text-gray-400 opacity-0 group-hover:opacity-100 text-sm">×</button>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function App() {
  // ── "home" is the new NexRadarDashboard; existing tabs stay untouched ──
  const [activeTab,     setActiveTab]     = useState('home')      // ← DEFAULT changed to 'home'
  const [darkMode,      setDarkMode]      = useState(true)
  const [metrics,       setMetrics]       = useState(null)
  const [activeFilter,  setActiveFilter]  = useState(null)
  const [chartTicker,   setChartTicker]   = useState(() => {
    const params = new URLSearchParams(window.location.search)
    return params.get('symbol') || ''
  })
  const [chartInterval, setChartInterval] = useState('D')
  const [source,        setSource]        = useState('all')
  const [sector,        setSector]        = useState('all')
  const [showNotif,     setShowNotif]     = useState(false)
  const [showProfile,   setShowProfile]   = useState(false)
  const [autoSession,   setAutoSession]   = useState(true)

  const { tickers, wsStatus } = useWebSocket()
  const { notes, dismiss, clearAll } = useNotifications(metrics)

  useEffect(() => {
    const poll = () =>
      fetch(`${API}/api/metrics`).then(r => r.json()).then(setMetrics).catch(() => {})
    poll()
    const id = setInterval(poll, 3000)
    return () => clearInterval(id)
  }, [])

  const handleSourceChange = useCallback((val) => {
    setSource(val)
    if (val !== 'stock_list') setSector('all')   // reset sector when leaving Stock List
  }, [])

  const handleSelectTicker = useCallback((sym) => {
    setChartTicker(sym)
    setActiveTab('search')
    const url = new URL(window.location)
    url.searchParams.set('symbol', sym)
    window.history.pushState({}, '', url)
  }, [])

  useEffect(() => {
    if (chartTicker) setActiveTab('search')
  }, [])

  const session = metrics?.session || 'CLOSED'
  const sc = SESSION_CONFIG[session] || SESSION_CONFIG.CLOSED
  const m = metrics

  const wsHealthColor = { Healthy: 'text-emerald-400', connecting: 'text-amber-400', Degraded: 'text-amber-400', error: 'text-red-400', closed: 'text-red-400' }[wsStatus] ?? 'text-gray-400'
  const wsDot = { Healthy: 'bg-emerald-400 shadow-emerald-400/50', connecting: 'bg-amber-400', Degraded: 'bg-amber-400', error: 'bg-red-500', closed: 'bg-red-500' }[wsStatus] ?? 'bg-gray-500'

  const bg = darkMode ? 'bg-[#080c14]' : 'bg-slate-100'
  const fg = darkMode ? 'text-white' : 'text-slate-900'

  // ── Tab definition — 'home' inserted first ─────────────────────────────────
  const TABS = [
    { id: 'home',    label: '🏠 Dashboard' },   // ← NEW
    { id: 'live',    label: '📊 Live Table' },
    { id: 'search',  label: '🔍 Chart' },
    { id: 'signals', label: '⚡ Signals' },
  ]

  // ── When home tab is active, render NexRadarDashboard full-screen ──────────
  if (activeTab === 'home') {
    return (
      <div style={{ position: 'relative' }}>
        {/* Tab switcher overlaid on top-left so user can navigate back */}
        <div style={{
          position: 'fixed', top: 10, left: 260, zIndex: 9999,
          display: 'flex', gap: 4,
          background: 'rgba(3,9,18,0.85)', backdropFilter: 'blur(12px)',
          border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: '4px 6px',
        }}>
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              style={{
                padding: '4px 12px', borderRadius: 7, fontSize: 11, fontWeight: 600,
                fontFamily: "'JetBrains Mono', monospace", cursor: 'pointer', border: 'none',
                background: activeTab === t.id ? 'rgba(34,211,238,0.15)' : 'transparent',
                color: activeTab === t.id ? '#22d3ee' : '#4a6080',
                borderBottom: activeTab === t.id ? '2px solid #22d3ee' : '2px solid transparent',
                transition: 'all 0.12s',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
        {/* Full-screen NexRadar dashboard */}
        <NexRadarDashboard />
      </div>
    )
  }

  // ── All other tabs: original App shell ────────────────────────────────────
  return (
    <div className={clsx('min-h-screen font-mono', bg, fg)} style={{ fontFamily: "'IBM Plex Mono', 'Fira Code', monospace" }}>

      {/* ── TOP HEADER BAR ─────────────────────────────────────────────────── */}
      <header className={clsx(
        'sticky top-0 z-50 h-14 flex items-center justify-between px-4 border-b',
        darkMode
          ? 'bg-[#080c14]/95 border-white/10 backdrop-blur-xl'
          : 'bg-white/95 border-slate-200 backdrop-blur-xl shadow-sm'
      )}>

        {/* LEFT: Logo */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-cyan-400 to-blue-600
                            flex items-center justify-center text-white font-black text-xs shadow-lg shadow-blue-500/30">
              N
            </div>
            <div className="leading-none">
              <div className={clsx('text-[13px] font-black tracking-tight', darkMode ? 'text-white' : 'text-slate-900')}>
                NEXRADAR
              </div>
              <div className="text-[9px] tracking-[0.2em] text-cyan-400 font-bold uppercase">
                Pro
              </div>
            </div>
          </div>

          {/* WS status */}
          <div className="hidden sm:flex items-center gap-1.5 ml-3 pl-3 border-l border-white/10">
            <span className={clsx('w-1.5 h-1.5 rounded-full shadow-lg', wsDot)} />
            <span className={clsx('text-[10px] font-bold', wsHealthColor)}>
              {wsStatus === 'Healthy' || wsStatus === 'open' ? 'LIVE' : wsStatus.toUpperCase()}
            </span>
          </div>

          {/* Live counts */}
          {m && (
            <div className="hidden md:flex items-center gap-3 ml-2 text-[10px] text-gray-500">
              <span>📡 <b className="text-gray-300">{m.live_count ?? 0}</b> live</span>
              <span>📊 <b className="text-gray-300">{m.total_tickers?.toLocaleString() ?? 0}</b> total</span>
              <span>🟢 <b className="text-emerald-400">{m.pos_count ?? 0}</b> pos</span>
            </div>
          )}
        </div>

        {/* CENTER: Symbol search */}
        <div className="hidden sm:flex items-center gap-2">
          <SymbolSearchBar onSelect={handleSelectTicker} darkMode={darkMode} />
        </div>

        {/* RIGHT: Controls */}
        <div className="flex items-center gap-1">

          {/* Session toggle */}
          <button
            onClick={() => setAutoSession(a => !a)}
            className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-bold border transition-all tracking-wide mr-1"
            style={{ background: sc.bg, borderColor: sc.color + '60', color: sc.color }}
          >
            <span className={clsx('w-1.5 h-1.5 rounded-full', sc.dot)} />
            {sc.short} · {sc.label.toUpperCase()}
          </button>

          {/* Dark mode */}
          <button
            onClick={() => setDarkMode(d => !d)}
            className={clsx(
              'w-8 h-8 rounded-lg flex items-center justify-center text-sm transition-all',
              darkMode
                ? 'bg-white/5 hover:bg-white/10 text-yellow-300 border border-white/10'
                : 'bg-slate-100 hover:bg-slate-200 text-slate-600 border border-slate-200'
            )}
          >
            {darkMode ? '☀️' : '🌙'}
          </button>

          {/* Notifications */}
          <div className="relative">
            <button
              onClick={() => { setShowNotif(v => !v); setShowProfile(false) }}
              className={clsx(
                'w-8 h-8 rounded-lg flex items-center justify-center text-sm transition-all relative',
                darkMode
                  ? 'bg-white/5 hover:bg-white/10 border border-white/10'
                  : 'bg-slate-100 hover:bg-slate-200 border border-slate-200'
              )}
            >
              🔔
              {notes.length > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white
                                 text-[9px] font-black flex items-center justify-center leading-none">
                  {notes.length > 9 ? '9+' : notes.length}
                </span>
              )}
            </button>
            {showNotif && (
              <NotificationPanel notes={notes} dismiss={dismiss} clearAll={clearAll} onClose={() => setShowNotif(false)} />
            )}
          </div>

          {/* Profile */}
          <div className="relative">
            <button
              onClick={() => { setShowProfile(v => !v); setShowNotif(false) }}
              className={clsx(
                'w-8 h-8 rounded-lg flex items-center justify-center transition-all text-[11px] font-black border',
                darkMode
                  ? 'bg-gradient-to-br from-cyan-500/20 to-blue-600/20 border-cyan-500/30 text-cyan-400 hover:border-cyan-400/50'
                  : 'bg-gradient-to-br from-blue-50 to-cyan-50 border-blue-200 text-blue-600'
              )}
            >
              NR
            </button>
            {showProfile && (
              <div className="absolute right-0 top-full mt-2 w-52 z-50 rounded-xl border border-white/10
                              bg-[#0d1117]/95 backdrop-blur-xl shadow-2xl overflow-hidden">
                <div className="px-4 py-3 border-b border-white/10">
                  <p className="text-sm font-bold text-white">NexRadar Pro</p>
                  <p className="text-[10px] text-gray-500">nexradar.info</p>
                </div>
                <div className="px-2 py-1">
                  {[['⚙️','Settings'],['📊','Data Source'],['🔑','API Keys'],['❓','Help']].map(([icon, label]) => (
                    <button key={label} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg
                                                   text-xs text-gray-400 hover:bg-white/5 hover:text-white transition-colors">
                      <span>{icon}</span>{label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* ── BODY ──────────────────────────────────────────────────────────── */}
      <div className="flex">

        {/* SIDEBAR */}
        <Sidebar
          darkMode={darkMode}
          onDarkMode={setDarkMode}
          metrics={metrics}
          wsStatus={wsStatus}
          source={source}
          onSource={handleSourceChange}
          sector={sector}
          onSector={setSector}
          tickers={tickers}
        />

        {/* MAIN CONTENT */}
        <main className="flex-1 min-w-0 px-4 py-3">

          {/* Filter cards */}
          <div className="grid grid-cols-5 gap-2 mb-3">
            {FILTER_CARDS.map(fc => {
              const active = activeFilter === fc.key
              const count  = m?.[fc.metricKey] ?? 0
              return (
                <button
                  key={fc.key}
                  onClick={() => setActiveFilter(f => f === fc.key ? null : fc.key)}
                  className={clsx(
                    'relative rounded-xl p-3 text-left border transition-all overflow-hidden bg-gradient-to-br',
                    active
                      ? fc.color + ' ' + fc.border + ' ring-1 ring-inset ' + fc.border
                      : darkMode
                        ? 'from-white/3 to-white/0 border-white/8 hover:border-white/15'
                        : 'from-slate-50 to-white border-slate-200 hover:border-blue-200'
                  )}
                >
                  <div className={clsx('text-[10px] font-bold uppercase tracking-wider mb-1',
                    active ? fc.text : 'text-gray-500')}>
                    {fc.icon} {fc.label}
                  </div>
                  <div className={clsx('text-2xl font-black tabular-nums',
                    active ? fc.text : darkMode ? 'text-white' : 'text-slate-800')}>
                    {count}
                  </div>
                </button>
              )
            })}
          </div>

          {activeFilter && (
            <div className="flex items-center gap-2 mb-2 text-[11px]">
              <span className="text-gray-500">Filtering by</span>
              <span className="px-2 py-0.5 rounded bg-blue-900/40 border border-blue-500/30 text-blue-400 font-bold">
                {FILTER_CARDS.find(f => f.key === activeFilter)?.label}
              </span>
              <button onClick={() => setActiveFilter(null)} className="text-gray-600 hover:text-gray-400 text-xs">✕ clear</button>
            </div>
          )}

          {/* Tabs */}
          <div className={clsx('flex gap-0 mb-3 rounded-xl p-1 w-fit', darkMode ? 'bg-white/5' : 'bg-slate-100')}>
            {TABS.map(t => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={clsx(
                  'px-4 py-1.5 rounded-lg text-xs font-bold transition-all',
                  activeTab === t.id
                    ? darkMode ? 'bg-white/10 text-white shadow-sm' : 'bg-white text-slate-900 shadow-sm'
                    : darkMode ? 'text-gray-500 hover:text-gray-300' : 'text-slate-500 hover:text-slate-700'
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          {activeTab === 'live' && (
            <LiveDashboard
              tickers={tickers} wsStatus={wsStatus}
              activeFilter={activeFilter} metrics={metrics}
              source={source} sector={sector} darkMode={darkMode}
              onSelectTicker={handleSelectTicker}
            />
          )}
          {activeTab === 'search' && (
            <SearchTab
              tickers={tickers}
              chartTicker={chartTicker}
              setChartTicker={(sym) => {
                setChartTicker(sym)
                const url = new URL(window.location)
                url.searchParams.set('symbol', sym)
                window.history.pushState({}, '', url)
              }}
              chartInterval={chartInterval}
              setChartInterval={setChartInterval}
              darkMode={darkMode}
            />
          )}
          {activeTab === 'signals' && <SignalFeed />}

        </main>
      </div>

      {/* Footer */}
      <footer className={clsx(
        'flex items-center justify-between px-4 py-2 border-t text-[10px]',
        darkMode ? 'border-white/5 text-gray-700' : 'border-slate-200 text-slate-400'
      )}>
        <span className="font-bold tracking-wider">NEXRADAR PRO v4.2</span>
        <span>{new Date().toLocaleTimeString()} ET</span>
      </footer>

      {(showNotif || showProfile) && (
        <div className="fixed inset-0 z-40" onClick={() => { setShowNotif(false); setShowProfile(false) }} />
      )}
    </div>
  )
}

// ── Symbol Search Bar ──────────────────────────────────────────────────────────
function SymbolSearchBar({ onSelect, darkMode }) {
  const [val, setVal] = useState('')
  const submit = () => { const s = val.trim().toUpperCase(); if (s) { onSelect(s); setVal('') } }
  return (
    <div className="flex items-center gap-1">
      <input
        value={val}
        onChange={e => setVal(e.target.value.toUpperCase())}
        onKeyDown={e => e.key === 'Enter' && submit()}
        placeholder="Symbol…"
        className={clsx(
          'w-28 px-2.5 py-1.5 rounded-lg text-[11px] border outline-none transition-all font-mono placeholder-gray-600',
          darkMode
            ? 'bg-white/5 border-white/10 text-white focus:border-cyan-500/50 focus:bg-white/8'
            : 'bg-slate-50 border-slate-200 text-slate-900 focus:border-blue-300'
        )}
      />
      <button
        onClick={submit}
        className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-cyan-500/20 border border-cyan-500/30
                   text-cyan-400 hover:bg-cyan-500/30 transition-all"
      >
        Chart →
      </button>
    </div>
  )
}

// ── Search & Chart Tab ─────────────────────────────────────────────────────────
function SearchTab({ tickers, chartTicker, setChartTicker, chartInterval, setChartInterval, darkMode }) {
  const [input, setInput] = useState(chartTicker)
  useEffect(() => { setInput(chartTicker) }, [chartTicker])

  const row    = tickers.get(chartTicker)
  const isPos  = row ? (row.change_value ?? 0) >= 0 : null
  const chgVal = Number(row?.change_value ?? 0)
  const chgPct = Number(row?.percent_change ?? 0)
  const loadChart = () => { const s = input.trim().toUpperCase(); if (s) setChartTicker(s) }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end gap-3 flex-wrap">
        <div className="flex flex-col gap-1">
          <label className={clsx('text-[10px] uppercase tracking-wider font-bold', darkMode ? 'text-gray-500' : 'text-slate-500')}>Symbol</label>
          <input
            value={input}
            onChange={e => setInput(e.target.value.toUpperCase())}
            onKeyDown={e => e.key === 'Enter' && loadChart()}
            placeholder="AAPL, TSLA, NVDA…"
            autoFocus={!!chartTicker}
            className={clsx(
              'px-3 py-2 rounded-lg text-sm border outline-none font-mono w-40',
              darkMode
                ? 'bg-white/5 border-white/10 text-white focus:border-cyan-500/50'
                : 'bg-white border-slate-200 text-slate-900 focus:border-blue-300'
            )}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className={clsx('text-[10px] uppercase tracking-wider font-bold', darkMode ? 'text-gray-500' : 'text-slate-500')}>Interval</label>
          <select
            value={chartInterval}
            onChange={e => setChartInterval(e.target.value)}
            className={clsx('px-3 py-2 rounded-lg text-sm border outline-none',
              darkMode ? 'bg-white/5 border-white/10 text-white' : 'bg-white border-slate-200 text-slate-900')}
          >
            {['1','5','15','60','D','W'].map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
        <button onClick={loadChart}
          className="px-4 py-2 rounded-lg text-sm font-bold bg-gradient-to-r from-cyan-500 to-blue-600
                     text-white hover:opacity-90 transition-all shadow-lg shadow-blue-500/20">
          Load Chart
        </button>
      </div>

      {chartTicker && row && (
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: 'Price',   val: `$${Number(row.live_price ?? 0).toFixed(2)}`, sub: '', color: 'text-white' },
            { label: 'Change',  val: `${chgVal >= 0 ? '+' : ''}${chgVal.toFixed(2)}`, sub: `${chgPct >= 0 ? '+' : ''}${chgPct.toFixed(2)}%`, color: isPos ? 'text-emerald-400' : 'text-red-400' },
            { label: 'Company', val: row.company_name ?? 'N/A', sub: '', color: 'text-gray-300' },
            { label: 'Status',  val: row.went_positive ? '🎯 Turned +' : Math.abs(chgPct) >= 5 ? '💎 Diamond' : '● Active', sub: '', color: isPos ? 'text-emerald-400' : 'text-gray-300' },
          ].map(({ label, val, sub, color }) => (
            <div key={label} className={clsx('rounded-xl p-3 border', darkMode ? 'bg-white/3 border-white/8' : 'bg-white border-slate-200')}>
              <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">{label}</p>
              <p className={clsx('text-base font-black truncate', color)}>{val}</p>
              {sub && <p className={clsx('text-[11px]', isPos ? 'text-emerald-500' : 'text-red-500')}>{sub}</p>}
            </div>
          ))}
        </div>
      )}

      {chartTicker && !row && (
        <p className="text-[11px] text-gray-600">No live data for <b className="text-gray-400">{chartTicker}</b> — showing chart only</p>
      )}

      <ChartPanel ticker={chartTicker} interval={chartInterval} darkMode={darkMode} />
    </div>
  )
}
