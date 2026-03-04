/**
 * App.jsx — NexRadar Pro v4.2
 * Professional trading dashboard redesign
 * NexRadarDashboard added as "🏠 Dashboard" home tab
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import clsx from 'clsx'
import { Toaster } from 'react-hot-toast'
import { useWebSocket } from './hooks/useWebSocket'
import LiveDashboard    from './components/LiveDashboard'
import SignalFeed       from './components/SignalFeed'
import ChartPanel       from './components/ChartPanel'
import Sidebar          from './components/Sidebar'
import NexRadarDashboard from './components/NexRadarDashboard'
import TickerDetailDrawer from './components/TickerDetailDrawer'
import UserProfile from './components/UserProfile'

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
function NotificationPanel({ notes, dismiss, clearAll, onClose, darkMode }) {
  return (
    <div className={clsx(
      'absolute right-0 top-full mt-2 w-80 z-50 rounded-xl border backdrop-blur-xl shadow-2xl overflow-hidden',
      darkMode
        ? 'bg-[#0d1117]/95 border-white/10 shadow-black/50'
        : 'bg-white/95 border-slate-200 shadow-slate-500/20'
    )}>
      <div className={clsx(
        'flex items-center justify-between px-4 py-3 border-b',
        darkMode ? 'border-white/10' : 'border-slate-200'
      )}>
        <span className={clsx('text-sm font-bold', darkMode ? 'text-white' : 'text-slate-900')}>
          Notifications
        </span>
        <div className="flex gap-2">
          {notes.length > 0 && (
            <button onClick={clearAll} className={clsx(
              'text-[10px] transition-colors',
              darkMode ? 'text-gray-500 hover:text-gray-300' : 'text-slate-500 hover:text-slate-700'
            )}>
              Clear all
            </button>
          )}
          <button onClick={onClose} className={clsx(
            'text-lg leading-none transition-colors',
            darkMode ? 'text-gray-500 hover:text-white' : 'text-slate-500 hover:text-slate-900'
          )}>
            ×
          </button>
        </div>
      </div>
      <div className="max-h-80 overflow-y-auto">
        {notes.length === 0 ? (
          <div className={clsx(
            'py-8 text-center text-sm',
            darkMode ? 'text-gray-600' : 'text-slate-500'
          )}>
            No notifications yet
          </div>
        ) : notes.map(n => (
          <div key={n.id} className={clsx(
            'flex items-start gap-3 px-4 py-3 border-b transition-colors group',
            darkMode 
              ? 'border-white/5 hover:bg-white/5' 
              : 'border-slate-100 hover:bg-slate-50'
          )}>
            <span className="text-base mt-0.5">{n.icon}</span>
            <div className="flex-1 min-w-0">
              <p className={clsx('text-xs', darkMode ? 'text-gray-200' : 'text-slate-700')}>
                {n.text}
              </p>
              <p className={clsx('text-[10px] mt-0.5', darkMode ? 'text-gray-600' : 'text-slate-500')}>
                {n.time}
              </p>
            </div>
            <button onClick={() => dismiss(n.id)} className={clsx(
              'text-sm opacity-0 group-hover:opacity-100 transition-all',
              darkMode ? 'text-gray-700 hover:text-gray-400' : 'text-slate-400 hover:text-slate-600'
            )}>
              ×
            </button>
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
  const [showUserProfile, setShowUserProfile] = useState(false)
  const [selectedTickerDetail, setSelectedTickerDetail] = useState(null)
  const [user, setUser] = useState({ name: 'Saranya', role: 'Premium Trader' })

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
    setSelectedTickerDetail(sym)
  }, [])
  
  const handleOpenChart = useCallback((sym) => {
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

  const wsHealthColor = { 
    Healthy: 'text-emerald-400', 
    open: 'text-emerald-400',  // Backend sends 'open' when connected
    connecting: 'text-amber-400', 
    Degraded: 'text-amber-400', 
    error: 'text-red-400', 
    closed: 'text-red-400' 
  }[wsStatus] ?? 'text-gray-400'
  
  const wsDot = { 
    Healthy: 'bg-emerald-400 shadow-emerald-400/50', 
    open: 'bg-emerald-400 shadow-emerald-400/50',  // Backend sends 'open' when connected
    connecting: 'bg-amber-400', 
    Degraded: 'bg-amber-400', 
    error: 'bg-red-500', 
    closed: 'bg-red-500' 
  }[wsStatus] ?? 'bg-gray-500'

  const bg = darkMode ? 'bg-[#080c14]' : 'bg-slate-100'
  const fg = darkMode ? 'text-white' : 'text-slate-900'

  // ── Tab definition with EARNINGS and PORTFOLIO ────────────────────────────
  const TABS = [
    { id: 'home',      label: 'DASHBOARD' },
    { id: 'live',      label: 'LIVE TABLE' },
    { id: 'search',    label: 'CHART' },
    { id: 'signals',   label: 'SIGNALS' },
    { id: 'earnings',  label: 'EARNINGS' },
    { id: 'portfolio', label: 'PORTFOLIO' },
  ]

  // ── All tabs use the same shell with unified navigation ────────────────────
  return (
    <div className={clsx('min-h-screen font-mono', bg, fg)} style={{ fontFamily: "'IBM Plex Mono', 'Fira Code', monospace" }}>

      {/* ── TOP HEADER BAR WITH NAVIGATION ────────────────────────────────── */}
      <header className={clsx(
        'sticky top-0 z-50',
        darkMode
          ? 'bg-gradient-to-r from-[#0a0f1a] via-[#0d1219] to-[#0a0f1a] border-b border-white/5'
          : 'bg-gradient-to-r from-slate-50 via-white to-slate-50 border-b border-slate-200 shadow-sm'
      )}>
        
        {/* Top row: Logo, Status, Controls */}
        <div className="h-16 flex items-center justify-between px-6">
          {/* LEFT: Logo & Status */}
          <div className="flex items-center gap-6">
            {/* Logo */}
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-400 via-blue-500 to-blue-600
                              flex items-center justify-center text-white font-black text-sm shadow-xl shadow-blue-500/40
                              ring-2 ring-blue-400/20">
                N
              </div>
              <div className="leading-none">
                <div className={clsx('text-base font-black tracking-tight', darkMode ? 'text-white' : 'text-slate-900')}>
                  NEXRADAR
                </div>
                <div className="text-[10px] tracking-[0.25em] text-cyan-400 font-bold uppercase">
                  Professional
                </div>
              </div>
            </div>

            {/* Divider */}
            <div className={clsx('h-8 w-px', darkMode ? 'bg-white/10' : 'bg-slate-300')} />

            {/* Status Pills */}
            <div className="flex items-center gap-3">
              {/* WS Status */}
              <div className={clsx(
                'flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold',
                darkMode ? 'bg-white/5' : 'bg-slate-100'
              )}>
                <span className={clsx('w-2 h-2 rounded-full shadow-lg animate-pulse', wsDot)} />
                <span className={wsHealthColor}>
                  {wsStatus === 'Healthy' || wsStatus === 'open' ? 'LIVE' : wsStatus.toUpperCase()}
                </span>
              </div>

              {/* Session Status */}
              {m && (
                <div 
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold border transition-all"
                  style={{ background: sc.bg, borderColor: sc.color + '40', color: sc.color }}
                >
                  <span className={clsx('w-2 h-2 rounded-full', sc.dot)} />
                  <span>{sc.label.toUpperCase()}</span>
                </div>
              )}

              {/* Live Metrics */}
              {m && (
                <div className={clsx(
                  'hidden lg:flex items-center gap-4 px-4 py-1.5 rounded-lg text-xs',
                  darkMode ? 'bg-white/5' : 'bg-slate-100'
                )}>
                  <div className="flex items-center gap-1.5">
                    <span className={clsx(darkMode ? 'text-gray-500' : 'text-slate-500')}>Live</span>
                    <span className={clsx('font-bold', darkMode ? 'text-cyan-400' : 'text-blue-600')}>
                      {m.live_count ?? 0}
                    </span>
                  </div>
                  <div className={clsx('w-px h-3', darkMode ? 'bg-white/10' : 'bg-slate-300')} />
                  <div className="flex items-center gap-1.5">
                    <span className={clsx(darkMode ? 'text-gray-500' : 'text-slate-500')}>Total</span>
                    <span className={clsx('font-bold', darkMode ? 'text-white' : 'text-slate-900')}>
                      {m.total_tickers?.toLocaleString() ?? 0}
                    </span>
                  </div>
                  <div className={clsx('w-px h-3', darkMode ? 'bg-white/10' : 'bg-slate-300')} />
                  <div className="flex items-center gap-1.5">
                    <span className={clsx(darkMode ? 'text-gray-500' : 'text-slate-500')}>Gainers</span>
                    <span className="font-bold text-emerald-400">
                      {m.pos_count ?? 0}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* CENTER: Symbol search */}
          <div className="hidden md:flex items-center gap-2">
            <SymbolSearchBar onSelect={handleSelectTicker} darkMode={darkMode} />
          </div>

          {/* RIGHT: Controls */}
          <div className="flex items-center gap-2">

            {/* SYS Indicator - Clickable */}
            {m && (
              <div className="relative group">
                <button className={clsx(
                  'flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-semibold transition-all',
                  darkMode 
                    ? 'bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20' 
                    : 'bg-slate-100 border-slate-200 hover:bg-slate-200'
                )}>
                  <span className={clsx('font-bold', wsHealthColor)}>
                    {m.ws_health === 'Healthy' ? '●' : '●'} SYS
                  </span>
                  <span className={clsx('text-gray-500', darkMode ? '' : 'text-slate-600')}>|</span>
                  <span className={clsx(darkMode ? 'text-gray-400' : 'text-slate-600')}>{m.live_count ?? 0}</span>
                </button>
                
                {/* SYS Dropdown */}
                <div className={clsx(
                  'absolute right-0 top-full mt-2 w-64 z-50 rounded-xl border backdrop-blur-xl shadow-2xl overflow-hidden',
                  'opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all',
                  darkMode
                    ? 'bg-[#0d1117]/95 border-white/10'
                    : 'bg-white/95 border-slate-200 shadow-slate-500/20'
                )}>
                  <div className={clsx(
                    'px-4 py-3 border-b',
                    darkMode ? 'border-white/10' : 'border-slate-200'
                  )}>
                    <p className={clsx('text-sm font-bold', darkMode ? 'text-white' : 'text-slate-900')}>
                      System Status
                    </p>
                  </div>
                  <div className="px-4 py-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className={clsx('text-xs', darkMode ? 'text-gray-400' : 'text-slate-600')}>WebSocket</span>
                      <span className={clsx('text-xs font-bold', wsHealthColor)}>
                        {m.ws_health ?? '—'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className={clsx('text-xs', darkMode ? 'text-gray-400' : 'text-slate-600')}>Live Tickers</span>
                      <span className={clsx('text-xs font-bold', darkMode ? 'text-white' : 'text-slate-900')}>
                        {m.live_count ?? 0}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className={clsx('text-xs', darkMode ? 'text-gray-400' : 'text-slate-600')}>Total Tickers</span>
                      <span className={clsx('text-xs font-bold', darkMode ? 'text-white' : 'text-slate-900')}>
                        {m.total_tickers?.toLocaleString() ?? 0}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className={clsx('text-xs', darkMode ? 'text-gray-400' : 'text-slate-600')}>Gainers</span>
                      <span className="text-xs font-bold text-emerald-400">
                        {m.pos_count ?? 0}
                      </span>
                    </div>
                    {m.source_stats?.total_attempted > 0 && (
                      <>
                        <div className={clsx('pt-2 border-t', darkMode ? 'border-white/10' : 'border-slate-200')}>
                          <div className="flex justify-between text-[10px] mb-1">
                            <span className={clsx(darkMode ? 'text-gray-500' : 'text-slate-500')}>Data Quality</span>
                            <span className={clsx('font-bold', darkMode ? 'text-gray-300' : 'text-slate-700')}>
                              {Math.round((m.source_stats.yfinance_fallback / m.source_stats.total_attempted) * 100)}%
                            </span>
                          </div>
                          <div className={clsx('w-full h-1.5 rounded-full overflow-hidden', darkMode ? 'bg-white/5' : 'bg-slate-200')}>
                            <div className="h-full bg-gradient-to-r from-cyan-500 to-emerald-500 rounded-full transition-all"
                              style={{ width: `${Math.round((m.source_stats.yfinance_fallback / m.source_stats.total_attempted) * 100)}%` }} />
                          </div>
                          <p className={clsx('text-[10px] mt-1', darkMode ? 'text-gray-600' : 'text-slate-500')}>
                            {m.source_stats.yfinance_fallback} / {m.source_stats.total_attempted} enriched
                          </p>
                        </div>
                      </>
                    )}
                    <p className={clsx('text-[10px]', darkMode ? 'text-gray-600' : 'text-slate-500')}>
                      Last update: {m.last_update ?? '—'}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Dark/Light Mode Toggle */}
            <button
              onClick={() => setDarkMode(d => !d)}
              className={clsx(
                'relative w-16 h-8 rounded-full transition-all duration-300 border-2',
                darkMode
                  ? 'bg-slate-800 border-slate-700'
                  : 'bg-amber-100 border-amber-300'
              )}
              title={darkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            >
              <span className={clsx(
                'absolute top-0.5 w-7 h-7 rounded-full transition-all duration-300 flex items-center justify-center text-sm shadow-lg',
                darkMode
                  ? 'left-0.5 bg-slate-900 text-yellow-300'
                  : 'left-8 bg-white text-amber-600'
              )}>
                {darkMode ? '🌙' : '☀️'}
              </span>
            </button>

            {/* Notifications */}
            <div className="relative">
              <button
                onClick={() => { setShowNotif(v => !v); setShowProfile(false) }}
                className={clsx(
                  'w-10 h-10 rounded-xl flex items-center justify-center text-base transition-all relative',
                  darkMode
                    ? 'bg-white/5 hover:bg-white/10 border border-white/10'
                    : 'bg-slate-100 hover:bg-slate-200 border border-slate-200'
                )}
              >
                🔔
                {notes.length > 0 && (
                  <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-white
                                   text-[10px] font-black flex items-center justify-center leading-none shadow-lg">
                    {notes.length > 9 ? '9+' : notes.length}
                  </span>
                )}
              </button>
              {showNotif && (
                <NotificationPanel notes={notes} dismiss={dismiss} clearAll={clearAll} onClose={() => setShowNotif(false)} darkMode={darkMode} />
              )}
            </div>

            {/* Profile */}
            <div className="relative">
              <button
                onClick={() => { setShowProfile(v => !v); setShowNotif(false) }}
                className={clsx(
                  'w-10 h-10 rounded-xl flex items-center justify-center transition-all text-xs font-black border-2 shadow-lg',
                  darkMode
                    ? 'bg-gradient-to-br from-cyan-500/20 to-blue-600/20 border-cyan-500/30 text-cyan-400 hover:border-cyan-400/50 hover:shadow-cyan-500/20'
                    : 'bg-gradient-to-br from-blue-50 to-cyan-50 border-blue-300 text-blue-600 hover:border-blue-400'
                )}
              >
                {user.name.charAt(0)}
              </button>
              {showProfile && (
                <div className={clsx(
                  'absolute right-0 top-full mt-2 w-52 z-50 rounded-xl border backdrop-blur-xl shadow-2xl overflow-hidden',
                  darkMode
                    ? 'bg-[#0d1117]/95 border-white/10'
                    : 'bg-white/95 border-slate-200 shadow-slate-500/20'
                )}>
                  <div className={clsx(
                    'px-4 py-3 border-b',
                    darkMode ? 'border-white/10' : 'border-slate-200'
                  )}>
                    <p className={clsx('text-sm font-bold', darkMode ? 'text-white' : 'text-slate-900')}>
                      NexRadar Pro
                    </p>
                    <p className={clsx('text-[10px]', darkMode ? 'text-gray-500' : 'text-slate-500')}>
                      nexradar.info
                    </p>
                  </div>
                  <div className="px-2 py-1">
                    {[['⚙️','Settings'],['📊','Data Source'],['🔑','API Keys'],['❓','Help']].map(([icon, label]) => (
                      <button key={label} className={clsx(
                        'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-colors',
                        darkMode
                          ? 'text-gray-400 hover:bg-white/5 hover:text-white'
                          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                      )}>
                        <span>{icon}</span>{label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Navigation Tabs Row - Scrollable */}
        <div className={clsx(
          'border-t overflow-x-auto scrollbar-thin',
          darkMode ? 'border-white/5 bg-[#0a0f1a]/50' : 'border-slate-200 bg-slate-50/50'
        )}>
          <div className="flex gap-1 px-6 min-w-max">
            {TABS.map(t => (
              <button
                key={t.id}
                onClick={() => {
                  setActiveTab(t.id)
                  // Auto-set source when switching to earnings/portfolio tabs
                  if (t.id === 'earnings') handleSourceChange('earnings')
                  else if (t.id === 'portfolio') handleSourceChange('portfolio')
                  else if (t.id === 'live') handleSourceChange('all')
                }}
                className={clsx(
                  'px-6 py-3 text-xs font-bold tracking-wider transition-all uppercase whitespace-nowrap rounded-t-lg relative',
                  activeTab === t.id
                    ? darkMode 
                      ? 'text-cyan-400 bg-gradient-to-b from-cyan-500/10 to-transparent' 
                      : 'text-blue-600 bg-gradient-to-b from-blue-100 to-transparent'
                    : darkMode 
                      ? 'text-gray-500 hover:text-gray-300 hover:bg-white/5' 
                      : 'text-slate-500 hover:text-slate-700 hover:bg-white/50'
                )}
              >
                {t.label}
                {activeTab === t.id && (
                  <span className={clsx(
                    'absolute bottom-0 left-0 right-0 h-0.5',
                    darkMode ? 'bg-cyan-400' : 'bg-blue-600'
                  )} />
                )}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* ── BODY ──────────────────────────────────────────────────────────── */}
      <div className="flex">

        {/* SIDEBAR - Only show for non-dashboard tabs */}
        {activeTab !== 'home' && (
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
        )}

        {/* MAIN CONTENT */}
        <main className={clsx('flex-1 min-w-0', activeTab !== 'home' && 'px-4 py-3')}>

          {/* Dashboard - Full screen */}
          {activeTab === 'home' && (
            <NexRadarDashboard 
              darkMode={darkMode} 
              source={source}
              sector={sector}
              onSourceChange={handleSourceChange}
              onSectorChange={setSector}
            />
          )}

          {/* Other tabs - With filter cards and content */}
          {activeTab !== 'home' && (
            <>
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
                        'relative rounded-xl p-3 text-left border transition-all overflow-hidden bg-gradient-to-br cursor-pointer',
                        active
                          ? fc.color + ' ' + fc.border + ' ring-2 ring-inset ' + fc.border + ' shadow-lg'
                          : darkMode
                            ? 'from-white/3 to-white/0 border-white/8 hover:border-white/20 hover:from-white/5'
                            : 'from-slate-50 to-white border-slate-200 hover:border-blue-300 hover:shadow-md'
                      )}
                      title={`Click to filter by ${fc.label}`}
                    >
                      <div className={clsx('text-[10px] font-bold uppercase tracking-wider mb-1',
                        active ? fc.text : 'text-gray-500')}>
                        {fc.icon} {fc.label}
                      </div>
                      <div className={clsx('text-2xl font-black tabular-nums',
                        active ? fc.text : darkMode ? 'text-white' : 'text-slate-800')}>
                        {count}
                      </div>
                      {active && (
                        <div className="absolute top-1 right-1">
                          <span className={clsx('text-xs', fc.text)}>✓</span>
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>

              {activeFilter && (
                <div className={clsx(
                  'flex items-center justify-between gap-2 mb-3 p-3 rounded-lg border',
                  darkMode
                    ? 'bg-blue-500/10 border-blue-500/30'
                    : 'bg-blue-50 border-blue-200'
                )}>
                  <div className="flex items-center gap-2">
                    <span className={clsx('text-[11px]', darkMode ? 'text-gray-500' : 'text-slate-600')}>
                      Active Filter:
                    </span>
                    <span className={clsx(
                      'px-3 py-1 rounded-lg border font-bold text-xs',
                      darkMode
                        ? 'bg-blue-500/20 border-blue-500/30 text-blue-400'
                        : 'bg-blue-100 border-blue-300 text-blue-700'
                    )}>
                      {FILTER_CARDS.find(f => f.key === activeFilter)?.icon} {FILTER_CARDS.find(f => f.key === activeFilter)?.label}
                    </span>
                    <span className={clsx('text-[11px]', darkMode ? 'text-gray-400' : 'text-slate-600')}>
                      Showing stocks with {activeFilter === 'gap_play' ? 'gap play signals' : 
                                          activeFilter === 'volume_spike' ? 'volume spikes (2x+)' :
                                          activeFilter === 'ah_momentum' ? 'after-hours momentum' :
                                          activeFilter === 'earnings_gap' ? 'earnings gap plays' :
                                          activeFilter === 'diamond' ? '5%+ change' : 'this filter'}
                    </span>
                  </div>
                  <button 
                    onClick={() => setActiveFilter(null)} 
                    className={clsx(
                      'px-3 py-1 rounded-lg border transition-all text-xs font-semibold',
                      darkMode
                        ? 'bg-red-500/20 border-red-500/30 text-red-400 hover:bg-red-500/30'
                        : 'bg-red-100 border-red-300 text-red-700 hover:bg-red-200'
                    )}
                  >
                    ✕ Clear Filter
                  </button>
                </div>
              )}

              {/* Tab content */}
              {activeTab === 'live' && (
                <LiveDashboard
                  tickers={tickers} wsStatus={wsStatus}
                  activeFilter={activeFilter} metrics={metrics}
                  source={source} sector={sector} darkMode={darkMode}
                  onSelectTicker={handleSelectTicker}
                />
              )}
              {activeTab === 'earnings' && (
                <LiveDashboard
                  tickers={tickers} wsStatus={wsStatus}
                  activeFilter={activeFilter} metrics={metrics}
                  source="earnings" sector={sector} darkMode={darkMode}
                  onSelectTicker={handleSelectTicker}
                />
              )}
              {activeTab === 'portfolio' && (
                <LiveDashboard
                  tickers={tickers} wsStatus={wsStatus}
                  activeFilter={activeFilter} metrics={metrics}
                  source="portfolio" sector={sector} darkMode={darkMode}
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
            </>
          )}
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

      {/* User Profile Modal */}
      {showUserProfile && (
        <UserProfile
          user={user}
          darkMode={darkMode}
          onDarkModeChange={setDarkMode}
          onClose={() => setShowUserProfile(false)}
        />
      )}

      {/* Toast Notifications */}
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: darkMode ? '#1f2937' : '#fff',
            color: darkMode ? '#fff' : '#000',
            border: `1px solid ${darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
          },
          success: { duration: 3000, iconTheme: { primary: '#10b981', secondary: '#fff' } },
          error: { duration: 4000, iconTheme: { primary: '#ef4444', secondary: '#fff' } },
        }}
      />

      {/* Ticker Detail Drawer */}
      {selectedTickerDetail && (
        <TickerDetailDrawer
          ticker={selectedTickerDetail}
          onClose={() => setSelectedTickerDetail(null)}
          onOpenChart={handleOpenChart}
          darkMode={darkMode}
        />
      )}

      {/* WebSocket Connection Status Banner */}
      {wsStatus !== 'Healthy' && wsStatus !== 'open' && (
        <div className={clsx(
          'fixed top-[104px] left-0 right-0 z-50 backdrop-blur-sm border-b px-4 py-3 shadow-lg animate-slideDown',
          darkMode
            ? 'bg-gradient-to-r from-amber-900 to-orange-900 border-amber-700'
            : 'bg-gradient-to-r from-amber-100 to-orange-100 border-amber-300'
        )}>
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="animate-pulse text-xl">
                {wsStatus === 'connecting' && '⏳'}
                {wsStatus === 'closed' && '🔌'}
                {wsStatus === 'error' && '⚠️'}
              </span>
              <div>
                <div className={clsx('text-sm font-bold', darkMode ? 'text-amber-100' : 'text-amber-900')}>
                  {wsStatus === 'connecting' && 'Connecting to Market Data'}
                  {wsStatus === 'closed' && 'Connection Lost - Retrying...'}
                  {wsStatus === 'error' && 'Backend Not Reachable'}
                </div>
                <div className={clsx('text-xs', darkMode ? 'text-amber-200' : 'text-amber-800')}>
                  {wsStatus === 'connecting' && 'Establishing WebSocket connection to ws://localhost:8000/ws/live'}
                  {wsStatus === 'closed' && 'Attempting to reconnect automatically...'}
                  {wsStatus === 'error' && 'Make sure backend is running: uvicorn backend.main:app --reload'}
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <a
                href="http://localhost:8000/health"
                target="_blank"
                rel="noopener noreferrer"
                className={clsx(
                  'px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors',
                  darkMode
                    ? 'bg-amber-800 hover:bg-amber-700 text-white'
                    : 'bg-amber-200 hover:bg-amber-300 text-amber-900'
                )}
              >
                Check Backend
              </a>
              <button 
                onClick={() => window.location.reload()}
                className={clsx(
                  'px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors',
                  darkMode
                    ? 'bg-amber-700 hover:bg-amber-600 text-white'
                    : 'bg-amber-300 hover:bg-amber-400 text-amber-900'
                )}
              >
                Retry Now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Symbol Search Bar ──────────────────────────────────────────────────────────
function SymbolSearchBar({ onSelect, darkMode }) {
  const [val, setVal] = useState('')
  const submit = () => { const s = val.trim().toUpperCase(); if (s) { onSelect(s); setVal('') } }
  return (
    <div className={clsx(
      'flex items-center gap-2 px-3 py-2 rounded-xl border transition-all',
      darkMode
        ? 'bg-white/5 border-white/10 hover:border-white/20'
        : 'bg-slate-50 border-slate-200 hover:border-slate-300'
    )}>
      <span className="text-gray-500 text-sm">🔍</span>
      <input
        value={val}
        onChange={e => setVal(e.target.value.toUpperCase())}
        onKeyDown={e => e.key === 'Enter' && submit()}
        placeholder="Search symbol..."
        className={clsx(
          'w-36 bg-transparent text-sm border-none outline-none font-mono placeholder-gray-500',
          darkMode ? 'text-white' : 'text-slate-900'
        )}
      />
      {val && (
        <button
          onClick={submit}
          className={clsx(
            'px-3 py-1 rounded-lg text-xs font-bold transition-all',
            darkMode
              ? 'bg-cyan-500/20 border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/30'
              : 'bg-blue-500 text-white hover:bg-blue-600'
          )}
        >
          Go
        </button>
      )}
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
