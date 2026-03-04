/**
 * TickerDetailDrawer.jsx - Detailed ticker view in slide-out drawer
 * Click any ticker to see comprehensive information without leaving the page
 */

import { useState, useEffect } from 'react'

const API = import.meta.env.VITE_API_BASE || ''

// Simple icon components (replacing lucide-react)
const XIcon = () => <span className="text-xl">✕</span>
const TrendingUpIcon = () => <span>📈</span>
const TrendingDownIcon = () => <span>📉</span>
const ActivityIcon = () => <span>📊</span>
const BarChartIcon = () => <span>📊</span>
const ClockIcon = () => <span>🕐</span>

export default function TickerDetailDrawer({ ticker, onClose, onOpenChart, darkMode = true }) {
  const [data, setData] = useState(null)
  const [signals, setSignals] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('overview')

  useEffect(() => {
    if (!ticker) return
    
    setLoading(true)
    console.log('[TickerDetailDrawer] Fetching data for:', ticker)
    
    Promise.all([
      fetch(`${API}/api/tickers?symbol=${ticker}`)
        .then(r => {
          if (!r.ok) throw new Error(`Tickers API: HTTP ${r.status}`)
          return r.json()
        })
        .catch(err => {
          console.error('[TickerDetailDrawer] Tickers fetch error:', err)
          return null
        }),
      fetch(`${API}/api/signals?symbol=${ticker}&limit=10`)
        .then(r => {
          if (!r.ok) throw new Error(`Signals API: HTTP ${r.status}`)
          return r.json()
        })
        .catch(err => {
          console.error('[TickerDetailDrawer] Signals fetch error:', err)
          return []
        }),
    ])
      .then(([tickerData, signalData]) => {
        console.log('[TickerDetailDrawer] Ticker data:', tickerData)
        console.log('[TickerDetailDrawer] Signal data:', signalData)
        setData(Array.isArray(tickerData) ? tickerData[0] : tickerData)
        setSignals(Array.isArray(signalData) ? signalData : [])
      })
      .catch(err => {
        console.error('[TickerDetailDrawer] Error:', err)
      })
      .finally(() => setLoading(false))
  }, [ticker])

  if (!ticker) return null

  const isPositive = data?.change_value >= 0
  const changeColor = isPositive ? 'text-emerald-400' : 'text-red-400'
  const changeBg = isPositive ? 'bg-emerald-950/30' : 'bg-red-950/30'

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 transition-opacity"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className={`fixed inset-y-0 right-0 w-full sm:w-[480px] z-50 
                      ${darkMode ? 'bg-[#0a0f1a]' : 'bg-white'} 
                      border-l ${darkMode ? 'border-white/10' : 'border-gray-200'}
                      shadow-2xl overflow-y-auto transform transition-transform`}>
        
        {/* Header */}
        <div className={`sticky top-0 z-10 ${darkMode ? 'bg-[#0a0f1a]/95' : 'bg-white/95'} 
                        backdrop-blur-xl border-b ${darkMode ? 'border-white/10' : 'border-gray-200'} 
                        p-4`}>
          <div className="flex items-start justify-between mb-3">
            <div className="flex-1">
              <div className="flex items-center gap-3">
                <h2 className="text-2xl font-black">{ticker}</h2>
                {data?.volume_spike && (
                  <span className="px-2 py-0.5 text-xs font-bold rounded bg-orange-600 text-white">
                    🔊 VOL SPIKE
                  </span>
                )}
              </div>
              <p className="text-sm text-gray-400 mt-1">{data?.company_name || 'Loading...'}</p>
            </div>
            <button 
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-white/5 transition-colors"
            >
              <XIcon />
            </button>
          </div>

          {/* Price Display */}
          {data && (
            <div className={`rounded-xl p-4 ${changeBg} border ${isPositive ? 'border-emerald-500/30' : 'border-red-500/30'}`}>
              <div className="flex items-end justify-between">
                <div>
                  <div className="text-4xl font-black">${Number(data.live_price).toFixed(2)}</div>
                  <div className={`text-lg font-bold ${changeColor} flex items-center gap-2 mt-1`}>
                    {isPositive ? <TrendingUpIcon /> : <TrendingDownIcon />}
                    {isPositive ? '+' : ''}{Number(data.change_value).toFixed(2)} 
                    ({isPositive ? '+' : ''}{Number(data.percent_change).toFixed(2)}%)
                  </div>
                </div>
                <div className="text-right text-xs text-gray-500">
                  <div>Last update</div>
                  <div className="text-white font-semibold">
                    {new Date(data.last_update * 1000).toLocaleTimeString()}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Tabs */}
          <div className="flex gap-2 mt-4">
            {['overview', 'signals', 'stats'].map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all
                  ${activeTab === tab 
                    ? 'bg-blue-600 text-white' 
                    : 'bg-white/5 text-gray-400 hover:text-white'}`}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin text-4xl">⏳</div>
            </div>
          ) : (
            <>
              {activeTab === 'overview' && data && (
                <OverviewTab data={data} />
              )}
              {activeTab === 'signals' && (
                <SignalsTab signals={signals} />
              )}
              {activeTab === 'stats' && data && (
                <StatsTab data={data} />
              )}
            </>
          )}
        </div>

        {/* Quick Actions Footer */}
        <div className={`sticky bottom-0 ${darkMode ? 'bg-[#0a0f1a]/95' : 'bg-white/95'} 
                        backdrop-blur-xl border-t ${darkMode ? 'border-white/10' : 'border-gray-200'} 
                        p-4 flex gap-2`}>
          <button 
            onClick={() => {
              if (onOpenChart) {
                onOpenChart(ticker)
                onClose()
              } else {
                window.open(`https://www.tradingview.com/chart/?symbol=${ticker}`, '_blank')
              }
            }}
            className="flex-1 py-3 rounded-lg bg-gradient-to-r from-blue-600 to-cyan-600 
                       text-white font-semibold hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
          >
            <BarChartIcon />
            View Chart
          </button>
          <button 
            className="flex-1 py-3 rounded-lg bg-white/5 border border-white/10 
                       text-white font-semibold hover:bg-white/10 transition-colors flex items-center justify-center gap-2"
          >
            ⭐ Add to Watchlist
          </button>
        </div>
      </div>
    </>
  )
}

function OverviewTab({ data }) {
  const stats = [
    { label: 'Open', value: `$${Number(data.open_price || data.open).toFixed(2)}` },
    { label: 'Prev Close', value: `$${Number(data.prev_close).toFixed(2)}` },
    { label: 'Day High', value: `$${Number(data.hwm || data.day_high).toFixed(2)}` },
    { label: 'Day Low', value: `$${Number(data.day_low || 0).toFixed(2)}` },
    { label: 'Volume', value: Number(data.volume).toLocaleString() },
    { label: 'Vol Ratio', value: `${Number(data.volume_ratio || 0).toFixed(2)}x` },
  ]

  return (
    <div className="space-y-4">
      {/* Key Stats Grid */}
      <div>
        <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-3">
          Key Statistics
        </h3>
        <div className="grid grid-cols-2 gap-3">
          {stats.map(({ label, value }) => (
            <div key={label} className="bg-white/5 rounded-lg p-3 border border-white/10">
              <div className="text-xs text-gray-500 mb-1">{label}</div>
              <div className="text-base font-bold">{value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Alert Badges */}
      {(data.volume_spike || data.is_gap_play || data.ah_momentum) && (
        <div>
          <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-3">
            Active Alerts
          </h3>
          <div className="flex flex-wrap gap-2">
            {data.volume_spike && (
              <div className="px-3 py-2 rounded-lg bg-orange-600/20 border border-orange-500/30 text-orange-400">
                <div className="text-xs font-bold">🔊 VOLUME SPIKE</div>
                <div className="text-xs opacity-80">{Number(data.volume_ratio).toFixed(1)}x average</div>
              </div>
            )}
            {data.is_gap_play && (
              <div className="px-3 py-2 rounded-lg bg-blue-600/20 border border-blue-500/30 text-blue-400">
                <div className="text-xs font-bold">📊 GAP PLAY</div>
                <div className="text-xs opacity-80">{Number(data.gap_percent).toFixed(1)}% gap</div>
              </div>
            )}
            {data.ah_momentum && (
              <div className="px-3 py-2 rounded-lg bg-purple-600/20 border border-purple-500/30 text-purple-400">
                <div className="text-xs font-bold">🌙 AH MOMENTUM</div>
                <div className="text-xs opacity-80">After hours move</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Sector Info */}
      {data.sector && (
        <div className="bg-white/5 rounded-lg p-4 border border-white/10">
          <div className="text-xs text-gray-500 mb-1">Sector</div>
          <div className="text-base font-bold">{data.sector}</div>
          {data.sub_sector && (
            <div className="text-sm text-gray-400 mt-1">{data.sub_sector}</div>
          )}
        </div>
      )}
    </div>
  )
}

function SignalsTab({ signals }) {
  if (signals.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500">
        <div className="text-5xl mb-4">⚡</div>
        <p>No recent signals for this ticker</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider">
        Recent Signals ({signals.length})
      </h3>
      {signals.map((sig, i) => {
        const isLong = sig.direction === 'LONG'
        return (
          <div 
            key={i}
            className={`rounded-lg p-4 border-l-4 ${
              isLong 
                ? 'border-l-emerald-500 bg-emerald-950/20' 
                : 'border-l-red-500 bg-red-950/20'
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className={`text-lg font-bold ${isLong ? 'text-emerald-400' : 'text-red-400'}`}>
                  {isLong ? '▲' : '▼'} {sig.direction}
                </span>
                <span className="px-2 py-0.5 text-xs font-bold rounded bg-purple-600 text-white">
                  {sig.strength}
                </span>
              </div>
              <span className="text-xs text-gray-500">
                {new Date(sig.created_at).toLocaleTimeString()}
              </span>
            </div>
            
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div>
                <div className="text-gray-500">Entry</div>
                <div className="font-bold text-blue-400">${Number(sig.entry_price).toFixed(2)}</div>
              </div>
              <div>
                <div className="text-gray-500">Target</div>
                <div className="font-bold text-emerald-400">${Number(sig.take_profit).toFixed(2)}</div>
              </div>
              <div>
                <div className="text-gray-500">R:R</div>
                <div className="font-bold text-amber-400">{Number(sig.risk_reward).toFixed(1)}:1</div>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function StatsTab({ data }) {
  const metrics = [
    { label: 'Session', value: data.session || 'MARKET_HOURS', icon: '🕐' },
    { label: 'Update Count', value: data.update_count || 0, icon: '🔄' },
    { label: 'Pullback State', value: data.pullback_state || 'neutral', icon: '📉' },
    { label: 'Gap Direction', value: data.gap_direction || 'none', icon: '📊' },
    { label: 'Gap Magnitude', value: data.gap_magnitude || 'normal', icon: '📏' },
    { label: 'Vol Spike Level', value: data.volume_spike_level || 'none', icon: '🔊' },
  ]

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider">
        Advanced Metrics
      </h3>
      <div className="grid grid-cols-2 gap-3">
        {metrics.map(({ label, value, icon }) => (
          <div key={label} className="bg-white/5 rounded-lg p-3 border border-white/10">
            <div className="flex items-center gap-2 text-xs text-gray-500 mb-1">
              {icon}
              {label}
            </div>
            <div className="text-sm font-bold uppercase">{value}</div>
          </div>
        ))}
      </div>

      {/* Went Positive Indicator */}
      {data.went_positive === 1 && (
        <div className="bg-cyan-600/20 border border-cyan-500/30 rounded-lg p-4">
          <div className="flex items-center gap-2 text-cyan-400 font-bold">
            🎯 TURNED POSITIVE
          </div>
          <div className="text-xs text-cyan-300 mt-1">
            This stock recently crossed into positive territory
          </div>
        </div>
      )}
    </div>
  )
}
