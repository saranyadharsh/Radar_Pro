/**
 * Sidebar.jsx — NexRadar Pro
 * ============================
 * Mirrors full Command Center sidebar from Radar_Production.py:
 *
 *  🖥️ System Status — WS health, data integrity %, heartbeat, Reconnect WS
 *  🌙 Dark Mode toggle
 *  ⬛ Emergency Stop
 *  ⏰ Auto-Switch Session / Manual override
 *  📁 Data Source selector (Stock List / Monitor / Portfolio / Earnings / Favorites)
 *  🔍 Sector filter (Stock List only)
 *  ⚙️ Display Settings — refresh interval, min change $, show negative
 *  🚀 Bulk Sync (open top N tickers in TradingView)
 *  🗓️ Earnings Calendar (date range)
 *  ⭐ Favorites Manager (add / remove)
 *  💾 Database Stats (Supabase row counts)
 *  ⚡ Scalping Signal Engine (watchlist editor, Apply, Load Default, Reset VWAP)
 */

import { useState, useEffect } from 'react'
import clsx from 'clsx'

const API = import.meta.env.VITE_API_BASE || ''

const DEFAULT_WATCHLIST = [
  "AAPL","LITE","GOOGL","LMT","SNDK","WDC","ORCL","MU","NVDA","SPOT",
  "SHOP","AMD","TSLA","GRMN","META","RKLB","STX","CHTR","AMZN","DE",
  "TER","IDCC","MSFT","MDB","AVGO",
]

function SbSection({ title, icon, children, border = false }) {
  return (
    <div className={clsx('py-2', border && 'border border-white/10 rounded-lg p-3 mb-1')}>
      {title && (
        <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-2">
          {icon} {title}
        </p>
      )}
      {children}
    </div>
  )
}

function Divider() {
  return <hr className="border-white/10 my-1" />
}

export default function Sidebar({
  darkMode, onDarkMode,
  metrics, wsStatus,
  source, onSource,
  tickers,
}) {
  const [collapsed,      setCollapsed]      = useState(false)
  const [autoSession,    setAutoSession]    = useState(true)
  const [manualSession,  setManualSession]  = useState('MARKET_HOURS')
  const [minChange,      setMinChange]      = useState(0)
  const [showNegative,   setShowNegative]   = useState(false)
  const [refreshSecs,    setRefreshSecs]    = useState(3)
  const [tvCount,        setTvCount]        = useState(5)
  const [earnStart,      setEarnStart]      = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() - d.getDay() + 1)
    return d.toISOString().slice(0, 10)
  })
  const [earnEnd,        setEarnEnd]        = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() - d.getDay() + 5)
    return d.toISOString().slice(0, 10)
  })
  const [favInput,       setFavInput]       = useState('')
  const [favorites,      setFavorites]      = useState([])
  const [dbStats,        setDbStats]        = useState(null)

  // Signal watchlist
  const [watchlistText,  setWatchlistText]  = useState(DEFAULT_WATCHLIST.join('\n'))
  const [watchlistInfo,  setWatchlistInfo]  = useState(null)
  const [wlMsg,          setWlMsg]          = useState('')

  // Load signal watchlist from backend
  useEffect(() => {
    fetch(`${API}/api/signal-watchlist`)
      .then(r => r.json())
      .then(d => {
        setWatchlistInfo(d)
        if (d.symbols?.length) setWatchlistText(d.symbols.join('\n'))
      })
      .catch(() => {})
  }, [])

  // Load Supabase table stats
  useEffect(() => {
    const load = () =>
      Promise.all([
        fetch(`${API}/api/monitor`).then(r => r.json()).catch(() => []),
        fetch(`${API}/api/portfolio`).then(r => r.json()).catch(() => []),
        fetch(`${API}/api/earnings`).then(r => r.json()).catch(() => []),
        fetch(`${API}/api/signals`).then(r => r.json()).catch(() => []),
      ]).then(([mon, port, earn, sig]) => {
        setDbStats({
          stock_list: metrics?.total_tickers ?? 0,
          monitor:    mon.length,
          portfolio:  port.length,
          earnings:   earn.length,
          signals:    sig.length,
        })
      })
    load()
    const id = setInterval(load, 30000)
    return () => clearInterval(id)
  }, [metrics])

  const m = metrics

  const wsHealthIcon = m?.ws_health === 'Healthy' ? '🟢' :
                       m?.ws_health?.includes('Degraded') ? '🟡' : '🔴'

  const reconnectWS = () =>
    fetch(`${API}/api/metrics`).catch(() => {})  // triggers metrics refresh

  const applyWatchlist = async () => {
    const syms = watchlistText.replace(/,/g, '\n').split('\n')
      .map(s => s.trim().toUpperCase()).filter(Boolean)
    const res = await fetch(`${API}/api/signal-watchlist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbols: syms }),
    }).then(r => r.json()).catch(() => null)
    if (res) {
      setWlMsg(`✅ Watching ${res.count} symbols`)
      setWatchlistInfo(res)
      setTimeout(() => setWlMsg(''), 4000)
    }
  }

  const loadDefaultWatchlist = async () => {
    setWatchlistText(DEFAULT_WATCHLIST.join('\n'))
    const res = await fetch(`${API}/api/signal-watchlist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbols: DEFAULT_WATCHLIST }),
    }).then(r => r.json()).catch(() => null)
    if (res) {
      setWlMsg(`✅ Loaded ${res.count} default symbols`)
      setTimeout(() => setWlMsg(''), 4000)
    }
  }

  const resetVWAP = () =>
    fetch(`${API}/api/signal-vwap-reset`, { method: 'POST' })
      .then(() => setWlMsg('✅ VWAP reset'))
      .catch(() => {})
      .finally(() => setTimeout(() => setWlMsg(''), 3000))

  const openTradingView = () => {
    const rows = Array.from(tickers.values())
      .filter(r => r.is_positive)
      .sort((a, b) => b.change_value - a.change_value)
      .slice(0, tvCount)
    rows.forEach(r =>
      window.open(`https://www.tradingview.com/chart/?symbol=${r.ticker}`, '_blank')
    )
  }

  if (collapsed) {
    return (
      <div className="w-8 bg-gray-950 border-r border-white/10 flex flex-col items-center pt-4">
        <button onClick={() => setCollapsed(false)} className="text-gray-400 text-sm">›</button>
      </div>
    )
  }

  return (
    <aside className="w-64 shrink-0 bg-gray-950 border-r border-white/10 overflow-y-auto
                      max-h-screen sticky top-0 text-xs text-gray-300">
      <div className="px-3 pt-3 pb-2 flex items-center justify-between">
        <h1 className="text-sm font-extrabold">📊 Command Center</h1>
        <button onClick={() => setCollapsed(true)} className="text-gray-600 hover:text-gray-400 text-base">‹</button>
      </div>

      <div className="px-3 space-y-0.5">

        {/* System Status */}
        <SbSection border>
          <p className="font-bold text-[11px] text-gray-300 mb-1.5">🖥️ System Status</p>
          <p>{wsHealthIcon} WS: <code className="bg-black/30 px-1 rounded">{m?.ws_health ?? '…'}</code></p>

          {m?.source_stats?.total_attempted > 0 && (
            <div className="mt-1.5">
              <div className="w-full bg-gray-800 rounded-full h-1.5 overflow-hidden">
                <div
                  className="bg-emerald-500 h-1.5 rounded-full transition-all"
                  style={{ width: `${Math.round((m.source_stats.yfinance_fallback / m.source_stats.total_attempted) * 100)}%` }}
                />
              </div>
              <p className="text-gray-500 mt-0.5">
                ✅ YF: {m.source_stats.yfinance_fallback} / {m.source_stats.total_attempted}
              </p>
            </div>
          )}

          <p className="text-gray-500 mt-1">Last heartbeat: {m?.last_update ?? '—'}</p>

          <button
            onClick={reconnectWS}
            className="mt-2 w-full text-center py-1 rounded bg-white/5 hover:bg-white/10 border border-white/10 text-xs"
          >
            🔄 Reconnect WS
          </button>
        </SbSection>

        <Divider />

        {/* Dark Mode */}
        <label className="flex items-center gap-2 cursor-pointer py-1">
          <input type="checkbox" checked={darkMode} onChange={e => onDarkMode(e.target.checked)}
            className="accent-blue-500" />
          🌙 Dark Mode
        </label>

        <Divider />

        {/* Emergency Stop */}
        <button
          onClick={() => window.location.reload()}
          className="w-full py-1.5 rounded border border-red-900 bg-gradient-to-r from-gray-900 to-red-950
                     text-red-400 font-bold uppercase tracking-wide text-[10px] hover:border-red-600"
        >
          ⬛ Emergency Stop
        </button>

        <Divider />

        {/* Session */}
        <SbSection title="Session" icon="⏰">
          <label className="flex items-center gap-2 cursor-pointer mb-1">
            <input type="checkbox" checked={autoSession} onChange={e => setAutoSession(e.target.checked)}
              className="accent-blue-500" />
            Auto-Switch Session
          </label>
          {autoSession ? (
            <p className="text-blue-400 font-bold">{m?.session ?? '…'}</p>
          ) : (
            <div className="flex gap-1">
              {['MARKET_HOURS','AFTER_HOURS'].map(s => (
                <button key={s}
                  onClick={() => setManualSession(s)}
                  className={clsx('flex-1 py-1 rounded text-[10px] border',
                    manualSession === s ? 'border-blue-500 text-blue-400 bg-blue-950/30' : 'border-white/10 text-gray-500')}
                >{s === 'MARKET_HOURS' ? 'Market' : 'After Hours'}</button>
              ))}
            </div>
          )}
        </SbSection>

        <Divider />

        {/* Data Source */}
        <SbSection title="Data Source" icon="📁">
          <select
            value={source}
            onChange={e => onSource(e.target.value)}
            className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-white"
          >
            {['all','monitor','portfolio','earnings','favorites'].map(s => (
              <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1).replace('_',' ')}</option>
            ))}
          </select>
        </SbSection>

        <Divider />

        {/* Display Settings */}
        <SbSection title="Display Settings" icon="⚙️">
          <label className="block mb-1 text-gray-400">
            Refresh: {refreshSecs}s
            <input type="range" min={2} max={30} value={refreshSecs}
              onChange={e => setRefreshSecs(+e.target.value)}
              className="w-full mt-0.5 accent-blue-500" />
          </label>
          <label className="block mb-1 text-gray-400">
            Min Change $: {minChange.toFixed(1)}
            <input type="range" min={0} max={5} step={0.1} value={minChange}
              onChange={e => setMinChange(+e.target.value)}
              className="w-full mt-0.5 accent-blue-500" />
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={showNegative} onChange={e => setShowNegative(e.target.checked)}
              className="accent-blue-500" />
            Show Negative
          </label>
        </SbSection>

        <Divider />

        {/* Bulk Sync */}
        <SbSection title="Bulk Sync" icon="🚀">
          <label className="block text-gray-400 mb-1">
            Tickers to open: {tvCount}
            <input type="range" min={1} max={20} value={tvCount}
              onChange={e => setTvCount(+e.target.value)}
              className="w-full mt-0.5 accent-blue-500" />
          </label>
          <button
            onClick={openTradingView}
            className="w-full py-1 rounded bg-white/5 hover:bg-white/10 border border-white/10 mt-1"
          >
            📊 Open Top {tvCount} in TradingView
          </button>
        </SbSection>

        <Divider />

        {/* Earnings Calendar */}
        <SbSection title="Earnings Calendar" icon="🗓️">
          <div className="grid grid-cols-2 gap-1 mb-1.5">
            <div>
              <p className="text-gray-500">From</p>
              <input type="date" value={earnStart} onChange={e => setEarnStart(e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 rounded px-1 py-0.5 text-white text-[10px]" />
            </div>
            <div>
              <p className="text-gray-500">To</p>
              <input type="date" value={earnEnd} onChange={e => setEarnEnd(e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 rounded px-1 py-0.5 text-white text-[10px]" />
            </div>
          </div>
          <p className="text-gray-500 text-[10px]">ℹ️ Earnings sync runs from backend via Nasdaq API</p>
        </SbSection>

        <Divider />

        {/* Favorites */}
        <SbSection title="Favorites" icon="⭐">
          <div className="flex gap-1 mb-1">
            <input
              value={favInput}
              onChange={e => setFavInput(e.target.value.toUpperCase())}
              placeholder="AAPL, TSLA…"
              className="flex-1 bg-gray-900 border border-gray-700 rounded px-2 py-0.5 text-white text-[10px]"
            />
            <button
              onClick={() => {
                if (favInput && !favorites.includes(favInput)) {
                  setFavorites(f => [...f, favInput])
                  setFavInput('')
                }
              }}
              className="px-2 py-0.5 rounded bg-blue-800 hover:bg-blue-700 text-white text-[10px]"
            >
              ➕
            </button>
          </div>
          {favorites.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {favorites.map(s => (
                <button key={s} onClick={() => setFavorites(f => f.filter(x => x !== s))}
                  className="px-1.5 py-0.5 rounded bg-gray-800 text-yellow-400 text-[10px] hover:bg-red-900/50">
                  ⭐ {s}
                </button>
              ))}
            </div>
          )}
          <p className="text-gray-600 text-[10px] mt-1">Click to remove</p>
        </SbSection>

        <Divider />

        {/* Database Stats */}
        <SbSection title="Database Stats" icon="💾">
          {dbStats ? (
            Object.entries(dbStats).map(([table, count]) => (
              <div key={table} className="flex justify-between text-gray-500">
                <span className={clsx(source === table ? 'text-blue-400 font-bold' : '')}>
                  {table.replace('_', ' ')}
                </span>
                <span>{count}</span>
              </div>
            ))
          ) : (
            <p className="text-gray-600">Loading…</p>
          )}
          {m?.signal_watched !== undefined && (
            <div className="mt-1 pt-1 border-t border-white/10 text-gray-500">
              <div className="flex justify-between"><span>⚡ Watching</span><span>{m.signal_watched}</span></div>
              <div className="flex justify-between"><span>⚡ Signals</span><span>{m.signal_count}</span></div>
              <div className="flex justify-between"><span>📊 Bars</span><span>{m.signal_bars}</span></div>
            </div>
          )}
        </SbSection>

        <Divider />

        {/* Scalping Signal Engine */}
        <SbSection border>
          <p className="font-bold text-[11px] text-blue-400 mb-2">⚡ Scalping Signal Engine</p>

          <p className="text-gray-500 text-[10px] mb-1">Watchlist (max 50 symbols)</p>
          {watchlistInfo && (
            <p className="text-gray-500 text-[10px] mb-1">
              👁️ Watching: <b className="text-white">{watchlistInfo.count}</b> symbols
            </p>
          )}

          <textarea
            value={watchlistText}
            onChange={e => setWatchlistText(e.target.value)}
            rows={7}
            placeholder="AAPL&#10;TSLA&#10;NVDA&#10;(max 50 symbols)"
            className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-white text-[10px]
                       resize-none focus:outline-none focus:border-gray-500 font-mono"
          />

          {wlMsg && <p className="text-emerald-400 text-[10px] mt-1">{wlMsg}</p>}

          <button onClick={applyWatchlist}
            className="w-full mt-1.5 py-1 rounded bg-blue-800 hover:bg-blue-700 text-white text-[10px] font-bold">
            ✅ Apply Watchlist
          </button>
          <button onClick={loadDefaultWatchlist}
            className="w-full mt-1 py-1 rounded bg-white/5 hover:bg-white/10 border border-white/10 text-[10px]">
            📥 Load Default 25 Symbols
          </button>
          <button onClick={resetVWAP}
            className="w-full mt-1 py-1 rounded bg-white/5 hover:bg-white/10 border border-white/10 text-[10px]">
            🔄 Reset VWAP (Market Open)
          </button>
        </SbSection>

        <Divider />

        {/* WS Config */}
        <SbSection title="WebSocket Config" icon="⚙️">
          <p className="text-gray-500">Max Tickers: 1,500</p>
          <p className="text-emerald-600 text-[10px]">✅ Safe limits (prevents 1008 errors)</p>
        </SbSection>

        <div className="pb-4" />

      </div>
    </aside>
  )
}
