/**
 * EmptyState.jsx - Reusable empty state component
 * Provides helpful guidance when no data is available
 */

export default function EmptyState({ 
  icon = '📊', 
  title = 'No Data Available', 
  description = 'There is no data to display at the moment.',
  action = null,
  size = 'md' 
}) {
  const sizes = {
    sm: { container: 'py-8', icon: 'text-4xl', title: 'text-base', desc: 'text-xs' },
    md: { container: 'py-16', icon: 'text-6xl', title: 'text-lg', desc: 'text-sm' },
    lg: { container: 'py-24', icon: 'text-8xl', title: 'text-2xl', desc: 'text-base' },
  }

  const s = sizes[size]

  return (
    <div className={`flex flex-col items-center justify-center ${s.container} px-4`}>
      <div className={`${s.icon} mb-4 animate-bounce`}>{icon}</div>
      <h3 className={`${s.title} font-bold text-white mb-2 text-center`}>{title}</h3>
      <p className={`${s.desc} text-gray-400 text-center max-w-md mb-6`}>{description}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

// Preset empty states for common scenarios
export function NoDataEmptyState({ onRetry }) {
  return (
    <EmptyState
      icon="📭"
      title="Backend Not Connected"
      description={
        <>
          <div className="mb-3">The backend server is not running or not reachable.</div>
          <div className="text-xs text-left bg-gray-900/50 rounded-lg p-3 border border-white/10 font-mono">
            <div className="text-amber-400 mb-2">To start the backend:</div>
            <div className="text-gray-400">1. Open a terminal</div>
            <div className="text-gray-400">2. Navigate to project root</div>
            <div className="text-gray-400 mb-2">3. Run:</div>
            <div className="bg-black/50 px-2 py-1 rounded text-green-400">
              uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
            </div>
          </div>
        </>
      }
      action={
        <div className="flex flex-col gap-2">
          {onRetry && (
            <button onClick={onRetry} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 
              text-white rounded-lg text-sm font-semibold transition-colors">
              🔄 Retry Connection
            </button>
          )}
          <a 
            href="http://localhost:8000/health" 
            target="_blank" 
            rel="noopener noreferrer"
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg 
                       text-sm font-semibold transition-colors"
          >
            🔍 Check Backend Health
          </a>
        </div>
      }
    />
  )
}

export function NoResultsEmptyState({ onClear, filterName }) {
  return (
    <EmptyState
      icon="🔍"
      title="No Results Found"
      description={`No stocks match your current ${filterName || 'filter'} criteria. Try adjusting your filters or clearing them.`}
      action={
        onClear && (
          <button onClick={onClear} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 
            text-white rounded-lg text-sm font-semibold transition-colors">
            ✕ Clear Filters
          </button>
        )
      }
    />
  )
}

export function LoadingEmptyState() {
  return (
    <EmptyState
      icon={<div className="animate-spin text-6xl">⏳</div>}
      title="Connecting to Market Data"
      description={
        <>
          <div className="mb-2">Establishing WebSocket connection...</div>
          <div className="text-xs text-gray-500">
            If this takes more than 10 seconds, the backend may not be running.
          </div>
        </>
      }
      size="sm"
    />
  )
}

export function MarketClosedEmptyState() {
  return (
    <EmptyState
      icon="🌙"
      title="Markets Are Closed"
      description="US markets are currently closed. Live data will resume when markets reopen at 9:30 AM ET."
      action={
        <div className="text-xs text-gray-500 mt-2">
          Next open: <span className="text-white font-semibold">Tomorrow 9:30 AM ET</span>
        </div>
      }
    />
  )
}

export function NoSignalsEmptyState() {
  return (
    <EmptyState
      icon="⚡"
      title="No Signals Yet"
      description="The signal engine is warming up. Signals will appear after collecting at least 27 bars of data per symbol (approximately 27 minutes)."
      size="md"
    />
  )
}
