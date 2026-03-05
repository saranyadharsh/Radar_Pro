/**
 * Sidebar.jsx — NexRadar Pro (Redesigned)
 * ==========================================
 * Removed: Emergency Stop, Earnings Calendar, Database Stats
 * Added: Yahoo Finance bulk sync
 * Moved: Dark mode, Session → top header (App.jsx)
 */

import { useState, useEffect } from 'react'
import clsx from 'clsx'
import SectorFilter from './SectorFilter'
import { getTradingViewSymbol } from '../utils/tradingview.js'

const API = import.meta.env.VITE_API_BASE || ''

// Empty default watchlist - users will add their own
const DEFAULT_WATCHLIST = []

function Section({ title, icon, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border border-white/8 rounded-xl overflow-hidden mb-2">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 py-2.5
                   text-left hover:bg-white/5 transition-colors"
      >
        <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-gray-400">
          {icon} {title}
        </span>
        <span className={clsx('text-gray-600 text-xs transition-transform', open ? 'rotate-180' : '')}>▾</span>
      </button>
      {open && <div className="px-3 pb-3 pt-1">{children}</div>}
    </div>
  )
}

function StatRow({ label, val, highlight }) {
  return (
    <div className="flex justify-between items-center py-0.5">
      <span className={clsx('text-[10px]', highlight ? 'text-cyan-400 font-bold' : 'text-gray-500')}>{label}</span>
      <span className="text-[10px] font-bold text-gray-300 tabular-nums">{val}</span>
    </div>
  )
}

export default function Sidebar({
  darkMode, onDarkMode,
  metrics, wsStatus,
  source, onSource,
  sector, onSector,
  tickers,
}) {
  const [collapsed,     setCollapsed]     = useState(false)
  const [minChange,     setMinChange]     = useState(0)
  const [showNeg,       setShowNeg]       = useState(false)
  const [refreshSecs,   setRefreshSecs]   = useState(3)
  const [tvCount,       setTvCount]       = useState(5)
  const [bulkTarget,    setBulkTarget]    = useState('tradingview')
  const [favInput,      setFavInput]      = useState('')
  const [favorites,     setFavorites]     = useState([])
  const [watchlistText, setWatchlistText] = useState(DEFAULT_WATCHLIST.join('\n'))
  const [watchlistInfo, setWatchlistInfo] = useState(null)
  const [wlMsg,         setWlMsg]         = useState('')

  useEffect(() => {
    fetch(`${API}/api/signal-watchlist`)
      .then(r => r.json())
      .then(d => {
        setWatchlistInfo(d)
        if (d.symbols?.length) setWatchlistText(d.symbols.join('\n'))
      })
      .catch(() => {})
  }, [])

  const m = metrics
  const wsIcon = m?.ws_health === 'Healthy' ? '🟢' : m?.ws_health?.includes('Degraded') ? '🟡' : '🔴'

  const reconnectWS = () => fetch(`${API}/api/metrics`).catch(() => {})

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

  const loadDefault = async () => {
    setWatchlistText(DEFAULT_WATCHLIST.join('\n'))
    const res = await fetch(`${API}/api/signal-watchlist`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbols: DEFAULT_WATCHLIST }),
    }).then(r => r.json()).catch(() => null)
    if (res) { setWlMsg(`✅ ${res.count} defaults loaded`); setTimeout(() => setWlMsg(''), 3000) }
  }

  const resetVWAP = () =>
    fetch(`${API}/api/signal-vwap-reset`, { method: 'POST' })
      .then(() => { setWlMsg('✅ VWAP reset'); setTimeout(() => setWlMsg(''), 3000) })
      .catch(() => {})

  const openBulk = () => {
    const rows = Array.from(tickers.values())
      .filter(r => r.is_positive)
      .sort((a, b) => b.change_value - a.change_value)
      .slice(0, tvCount)

    rows.forEach(r => {
      if (bulkTarget === 'tradingview') {
        window.open(`https://www.tradingview.com/chart/?symbol=${getTradingViewSymbol(r.ticker)}`, '_blank')
      } else {
        window.open(`https://finance.yahoo.com/quote/${r.ticker}/`, '_blank')
      }
    })
  }

  if (collapsed) {
    return (
      <div className="w-10 bg-[#080c14] border-r border-white/8 flex flex-col items-center pt-4 shrink-0">
        <button onClick={() => setCollapsed(false)}
          className="text-gray-600 hover:text-gray-300 text-lg rotate-180">‹</button>
        <div className="mt-4 flex flex-col gap-3 text-[11px] text-gray-600">
          {['📡','⚙️','🚀','⭐','⚡'].map(i => <span key={i}>{i}</span>)}
        </div>
      </div>
    )
  }

  return (
    <aside className={clsx(
      'w-60 shrink-0 border-r overflow-y-auto max-h-[calc(100vh-56px)] sticky top-14',
      'text-xs scrollbar-thin',
      darkMode
        ? 'bg-[#080c14] border-white/8'
        : 'bg-slate-50 border-slate-200'
    )}>

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-white/8">
        <span className="text-[10px] font-black tracking-[0.2em] uppercase text-gray-500">Control Panel</span>
        <button onClick={() => setCollapsed(true)}
          className="text-gray-700 hover:text-gray-400 text-base w-6 h-6 flex items-center justify-center rounded hover:bg-white/5">
          ‹
        </button>
      </div>

      <div className="px-2 py-2 space-y-0">

        {/* Data Source */}
        <Section title="Data Source" icon="📁" defaultOpen>
          <select
            value={source}
            onChange={e => onSource(e.target.value)}
            className={clsx(
              'w-full rounded-lg px-2 py-1.5 text-xs border outline-none font-semibold cursor-pointer transition-all',
              darkMode
                ? 'bg-white/5 border-white/10 text-white hover:bg-white/10 hover:border-cyan-500/30 focus:border-cyan-500/50 focus:bg-white/8'
                : 'bg-white border-slate-200 text-slate-900 hover:border-blue-300 focus:border-blue-400'
            )}
            style={{
              color: darkMode ? '#ffffff' : '#0f172a',
            }}
          >
            {['all','stock_list','monitor','portfolio','earnings','favorites'].map(s => (
              <option 
                key={s} 
                value={s}
                style={{
                  backgroundColor: darkMode ? '#1f2937' : '#ffffff',
                  color: darkMode ? '#ffffff' : '#0f172a',
                  padding: '8px',
                }}
              >
                {s === 'all'        ? 'All'
                : s === 'stock_list' ? 'Stock List'
                : s.charAt(0).toUpperCase() + s.slice(1)}
              </option>
            ))}
          </select>

          {/* Sector filter — only shown when Stock List is selected */}
          {source === 'stock_list' && (
            <SectorFilter
              sector={sector || 'all'}
              onSector={onSector}
              darkMode={darkMode}
            />
          )}
        </Section>

        {/* Display Settings */}
        <Section title="Display" icon="⚙️" defaultOpen={false}>
          <div className="space-y-2">
            <div>
              <div className="flex justify-between text-[10px] text-gray-500 mb-0.5">
                <span>Refresh interval</span>
                <span className="text-gray-300 font-bold">{refreshSecs}s</span>
              </div>
              <input type="range" min={2} max={30} value={refreshSecs}
                onChange={e => setRefreshSecs(+e.target.value)}
                className="w-full accent-cyan-500 h-1" />
            </div>
            <div>
              <div className="flex justify-between text-[10px] text-gray-500 mb-0.5">
                <span>Min Change $</span>
                <span className="text-gray-300 font-bold">{minChange.toFixed(1)}</span>
              </div>
              <input type="range" min={0} max={5} step={0.1} value={minChange}
                onChange={e => setMinChange(+e.target.value)}
                className="w-full accent-cyan-500 h-1" />
            </div>
            <label className="flex items-center gap-2 cursor-pointer text-gray-400 hover:text-white">
              <input type="checkbox" checked={showNeg} onChange={e => setShowNeg(e.target.checked)}
                className="accent-cyan-500 w-3 h-3" />
              <span className="text-[11px]">Show Negative</span>
            </label>
          </div>
        </Section>

        {/* Favorites */}
        <Section title="Favorites" icon="⭐" defaultOpen={false}>
          <div className="space-y-2">
            <div className="flex gap-1">
              <input
                value={favInput}
                onChange={e => setFavInput(e.target.value.toUpperCase())}
                onKeyDown={e => {
                  if (e.key === 'Enter' && favInput && !favorites.includes(favInput)) {
                    setFavorites(f => [...f, favInput]); setFavInput('')
                  }
                }}
                placeholder="AAPL, TSLA…"
                className={clsx(
                  'flex-1 rounded-lg px-2 py-1 text-[11px] border outline-none',
                  darkMode ? 'bg-white/5 border-white/10 text-white placeholder-gray-600' : 'bg-white border-slate-200 text-slate-900'
                )}
              />
              <button
                onClick={() => {
                  if (favInput && !favorites.includes(favInput)) {
                    setFavorites(f => [...f, favInput]); setFavInput('')
                  }
                }}
                className="px-2 py-1 rounded-lg bg-cyan-500/20 border border-cyan-500/30 text-cyan-400 text-xs font-bold"
              >+</button>
            </div>
            {favorites.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {favorites.map(s => (
                  <button key={s} onClick={() => setFavorites(f => f.filter(x => x !== s))}
                    className="px-2 py-0.5 rounded-lg bg-amber-400/10 border border-amber-400/20
                               text-amber-400 text-[10px] font-bold hover:bg-red-500/20 hover:border-red-500/30
                               hover:text-red-400 transition-all">
                    {s} ×
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-[10px] text-gray-600">No favorites yet</p>
            )}
          </div>
        </Section>

        {/* Signal Engine */}
        <Section title="Signal Engine" icon="⚡" defaultOpen>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-gray-500">Watchlist (max 50)</span>
              {watchlistInfo && (
                <span className="text-cyan-400 font-bold">{watchlistInfo.count} watching</span>
              )}
            </div>

            {m?.signal_watched !== undefined && (
              <div className="grid grid-cols-3 gap-1">
                {[
                  ['Watching', m.signal_watched],
                  ['Signals',  m.signal_count ?? 0],
                  ['Bars',     m.signal_bars ?? 0],
                ].map(([label, val]) => (
                  <div key={label} className="rounded-lg bg-white/3 border border-white/8 p-2 text-center">
                    <p className="text-[9px] text-gray-600 uppercase">{label}</p>
                    <p className="text-sm font-black text-white">{val}</p>
                  </div>
                ))}
              </div>
            )}

            <textarea
              value={watchlistText}
              onChange={e => setWatchlistText(e.target.value)}
              rows={6}
              placeholder={'AAPL\nTSLA\nNVDA\n(max 50)'}
              className={clsx(
                'w-full rounded-lg px-2 py-1.5 text-[10px] border outline-none resize-none font-mono',
                darkMode
                  ? 'bg-white/3 border-white/10 text-white focus:border-cyan-500/50'
                  : 'bg-white border-slate-200 text-slate-900'
              )}
            />

            {wlMsg && (
              <p className="text-emerald-400 text-[10px] font-bold">{wlMsg}</p>
            )}

            <button onClick={applyWatchlist}
              className="w-full py-1.5 rounded-lg bg-gradient-to-r from-blue-600 to-cyan-600
                         text-white text-[10px] font-black tracking-wide hover:opacity-90 transition-all">
              ✓ Apply Watchlist
            </button>
            <div className="grid grid-cols-2 gap-1">
              <button onClick={loadDefault}
                className="py-1.5 rounded-lg border border-white/10 bg-white/3 hover:bg-white/8
                           text-[10px] text-gray-400 hover:text-white transition-all">
                Load Default
              </button>
              <button onClick={resetVWAP}
                className="py-1.5 rounded-lg border border-white/10 bg-white/3 hover:bg-white/8
                           text-[10px] text-gray-400 hover:text-white transition-all">
                Reset VWAP
              </button>
            </div>
          </div>
        </Section>

        {/* WS Config */}
        <Section title="WS Config" icon="🔧" defaultOpen={false}>
          <div className="space-y-1">
            <StatRow label="Max Tickers" val="1,500" />
            <StatRow label="Reconnect" val="Auto" />
            <p className="text-[10px] text-emerald-600 mt-1">✅ Safe limits active</p>
          </div>
        </Section>

        <div className="pb-6" />
      </div>
    </aside>
  )
}
