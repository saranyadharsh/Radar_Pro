/**
 * SignalFeed.jsx — Scalping signal tab.
 * Polls /api/signals every 5s.
 * Mirrors Signal_dashboard_page.py exactly:
 *   TOTAL / LONG / SHORT filter buttons
 *   Signal cards with entry, SL, TP, R:R, reasons
 *   Session Guide panel (ET)
 */

import { useState, useEffect } from 'react'
import clsx from 'clsx'

const API = import.meta.env.VITE_API_BASE || ''

function StrengthBadge({ s }) {
  const cls = { STRONG: 'bg-purple-600', MODERATE: 'bg-blue-600', WEAK: 'bg-gray-600' }[s] ?? 'bg-gray-700'
  return <span className={`${cls} text-white text-[9px] font-bold px-1.5 py-0.5 rounded uppercase`}>{s}</span>
}

function SignalCard({ sig }) {
  const isLong = sig.direction === 'LONG'
  const dc     = isLong ? 'text-emerald-400' : 'text-red-400'
  const bdr    = isLong ? 'border-l-emerald-500 bg-emerald-950/20' : 'border-l-red-500 bg-red-950/20'
  const rr     = Number(sig.risk_reward ?? 0)
  const ts     = sig.timestamp ?? (sig.created_at ? sig.created_at.slice(11, 19) : '')
  const sc     = Number(sig.score ?? 0)

  return (
    <div className={`border-l-2 ${bdr} rounded-r-lg p-3 mb-2`}>
      <div className="flex justify-between items-start">
        <div className="flex items-center gap-2">
          <span className={`text-base font-extrabold ${dc}`}>
            {isLong ? '▲' : '▼'} {sig.symbol}
          </span>
          <StrengthBadge s={sig.strength} />
        </div>
        <span className="text-[10px] text-gray-500">{ts}</span>
      </div>

      <div className="text-[11px] text-gray-400 mt-1 space-x-3">
        <span>Score <span className={clsx('font-bold', dc)}>{sc > 0 ? '+' : ''}{sc.toFixed(3)}</span></span>
        <span>Conf <span className="text-blue-400">{(Number(sig.confidence ?? 0) * 100).toFixed(0)}%</span></span>
        <span>R:R <span className={rr >= 2 ? 'text-emerald-400' : 'text-amber-400'}>1:{rr}</span></span>
      </div>

      <div className="grid grid-cols-3 gap-2 mt-2">
        {[
          ['ENTRY',       sig.entry_price,  'text-blue-400'],
          ['STOP LOSS',   sig.stop_loss,    'text-red-400'],
          ['TAKE PROFIT', sig.take_profit,  'text-emerald-400'],
        ].map(([label, val, color]) => (
          <div key={label} className="bg-gray-950 rounded p-2 text-center">
            <p className="text-[9px] text-gray-500">{label}</p>
            <p className={`text-sm font-black ${color}`}>${Number(val ?? 0).toFixed(2)}</p>
          </div>
        ))}
      </div>

      {Array.isArray(sig.reasons) && sig.reasons.length > 0 && (
        <div className="mt-1.5 text-[10px] flex flex-wrap gap-2">
          {sig.reasons.slice(0, 5).map((r, i) => (
            <span key={i} className={
              r.type === 'bull' ? 'text-emerald-400' :
              r.type === 'bear' ? 'text-red-400' : 'text-amber-400'
            }>{r.text}</span>
          ))}
        </div>
      )}
    </div>
  )
}

const BTNS = [
  { key: 'TOTAL', label: 'ALL SIGNALS',  active: 'border-white text-white'            },
  { key: 'LONG',  label: '▲ LONG',       active: 'border-emerald-400 text-emerald-400' },
  { key: 'SHORT', label: '▼ SHORT',      active: 'border-red-400 text-red-400'         },
]

export default function SignalFeed() {
  const [signals, setSignals] = useState([])
  const [filter,  setFilter]  = useState('TOTAL')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const poll = () =>
      fetch(`${API}/api/signals?limit=200`)
        .then(r => r.json())
        .then(d => { setSignals(d); setLoading(false) })
        .catch(() => setLoading(false))
    poll()
    const id = setInterval(poll, 5000)
    return () => clearInterval(id)
  }, [])

  const total  = signals.length
  const longs  = signals.filter(s => s.direction === 'LONG').length
  const shorts  = signals.filter(s => s.direction === 'SHORT').length
  const counts = { TOTAL: total, LONG: longs, SHORT: shorts }

  const filtered = filter === 'TOTAL' ? signals : signals.filter(s => s.direction === filter)

  // Active filter color
  const fc = { TOTAL: '#c8d8f0', LONG: '#00e5a0', SHORT: '#ff4060' }[filter]
  const fl = filter === 'TOTAL' ? `Showing all ${total} signals`
    : filter === 'LONG' ? `Showing ${longs} LONG signal${longs !== 1 ? 's' : ''}`
    : `Showing ${shorts} SHORT signal${shorts !== 1 ? 's' : ''}`

  return (
    <div className="flex flex-col gap-4">

      {/* Filter buttons */}
      <div className="flex gap-2">
        {BTNS.map(b => (
          <button key={b.key} onClick={() => setFilter(b.key)}
            className={clsx(
              'px-4 py-2 rounded border text-xs font-bold transition-all min-w-[110px]',
              filter === b.key ? b.active + ' bg-white/5' : 'border-gray-700 text-gray-500 hover:border-gray-500',
            )}>
            {b.label}<br />
            <span className="font-mono text-lg">{counts[b.key]}</span>
          </button>
        ))}
      </div>

      {/* Status line */}
      <p className="text-[11px]" style={{ color: fc }}>● {fl}</p>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Signal feed */}
        <div className="lg:col-span-2">
          <p className="text-[10px] text-gray-500 tracking-widest mb-2">LIVE SIGNAL FEED</p>
          {loading && <p className="text-gray-600 text-sm py-8 text-center">Loading…</p>}
          {!loading && filtered.length === 0 && (
            <p className="text-gray-600 text-sm py-8 text-center">
              {total === 0
                ? '⏳ Waiting for signals… engine warms up after 27 bars per symbol'
                : `No ${filter} signals yet — try ALL SIGNALS or wait for next bar`}
            </p>
          )}
          {filtered.slice(0, 25).map((sig, i) => <SignalCard key={sig.id ?? i} sig={sig} />)}
        </div>

        {/* Session guide */}
        <div>
          <p className="text-[10px] text-gray-500 tracking-widest mb-3">SESSION GUIDE (ET)</p>
          <div className="text-xs text-gray-400 space-y-2">
            {[
              ['🟡', '09:30–10:00', 'Open (volatile)'],
              ['🟢', '10:00–11:30', 'Best scalp window'],
              ['🔴', '11:30–14:00', 'Skipped (chop)'],
              ['🟡', '14:00–15:30', 'Afternoon'],
              ['🟢', '15:30–16:00', 'Power Hour'],
            ].map(([dot, t, l]) => (
              <div key={t} className="flex gap-2">
                <span>{dot}</span>
                <span className="text-gray-500 font-mono w-24 text-[11px]">{t}</span>
                <span>{l}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
