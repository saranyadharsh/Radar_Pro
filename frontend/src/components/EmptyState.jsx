/**
 * EmptyState.jsx - Reusable empty state component
 * Provides helpful guidance when no data is available
 */

import clsx from 'clsx'

export default function EmptyState({ 
  icon = '📊', 
  title = 'No Data Available', 
  description = 'There is no data to display at the moment.',
  action = null,
  size = 'md',
  darkMode = true
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
      <h3 className={clsx(
        `${s.title} font-bold mb-2 text-center`,
        darkMode ? 'text-white' : 'text-slate-900'
      )}>
        {title}
      </h3>
      <p className={clsx(
        `${s.desc} text-center max-w-md mb-6`,
        darkMode ? 'text-gray-400' : 'text-slate-600'
      )}>
        {description}
      </p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

// Preset empty states for common scenarios
export function NoDataEmptyState({ onRetry, darkMode = true }) {
  return (
    <EmptyState
      icon="📭"
      title="Backend Not Connected"
      description={
        <>
          <div className="mb-3">The backend server is not running or not reachable.</div>
          <div className={clsx(
            'text-xs text-left rounded-lg p-3 border font-mono',
            darkMode 
              ? 'bg-gray-900/50 border-white/10' 
              : 'bg-slate-50 border-slate-200'
          )}>
            <div className={clsx('mb-2', darkMode ? 'text-amber-400' : 'text-amber-600')}>
              To start the backend:
            </div>
            <div className={clsx(darkMode ? 'text-gray-400' : 'text-slate-600')}>
              1. Open a terminal
            </div>
            <div className={clsx(darkMode ? 'text-gray-400' : 'text-slate-600')}>
              2. Navigate to project root
            </div>
            <div className={clsx('mb-2', darkMode ? 'text-gray-400' : 'text-slate-600')}>
              3. Run:
            </div>
            <div className={clsx(
              'px-2 py-1 rounded',
              darkMode ? 'bg-black/50 text-green-400' : 'bg-slate-900 text-green-300'
            )}>
              uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
            </div>
          </div>
        </>
      }
      action={
        <div className="flex flex-col gap-2">
          {onRetry && (
            <button onClick={onRetry} className={clsx(
              'px-4 py-2 rounded-lg text-sm font-semibold transition-colors',
              darkMode
                ? 'bg-blue-600 hover:bg-blue-700 text-white'
                : 'bg-blue-500 hover:bg-blue-600 text-white'
            )}>
              🔄 Retry Connection
            </button>
          )}
          <a 
            href="http://localhost:8000/health" 
            target="_blank" 
            rel="noopener noreferrer"
            className={clsx(
              'px-4 py-2 rounded-lg text-sm font-semibold transition-colors',
              darkMode
                ? 'bg-gray-700 hover:bg-gray-600 text-white'
                : 'bg-slate-200 hover:bg-slate-300 text-slate-900'
            )}
          >
            🔍 Check Backend Health
          </a>
        </div>
      }
      darkMode={darkMode}
    />
  )
}

export function NoResultsEmptyState({ onClear, filterName, darkMode = true }) {
  return (
    <EmptyState
      icon="🔍"
      title="No Results Found"
      description={`No stocks match your current ${filterName || 'filter'} criteria. Try adjusting your filters or clearing them.`}
      action={
        onClear && (
          <button onClick={onClear} className={clsx(
            'px-4 py-2 rounded-lg text-sm font-semibold transition-colors',
            darkMode
              ? 'bg-gray-700 hover:bg-gray-600 text-white'
              : 'bg-slate-200 hover:bg-slate-300 text-slate-900'
          )}>
            ✕ Clear Filters
          </button>
        )
      }
      darkMode={darkMode}
    />
  )
}

export function LoadingEmptyState({ darkMode = true }) {
  return (
    <EmptyState
      icon={<div className="animate-spin text-6xl">⏳</div>}
      title="Connecting to Market Data"
      description={
        <>
          <div className="mb-2">Establishing WebSocket connection...</div>
          <div className={clsx('text-xs', darkMode ? 'text-gray-500' : 'text-slate-500')}>
            If this takes more than 10 seconds, the backend may not be running.
          </div>
        </>
      }
      size="sm"
      darkMode={darkMode}
    />
  )
}

export function MarketClosedEmptyState({ darkMode = true }) {
  return (
    <EmptyState
      icon="🌙"
      title="Markets Are Closed"
      description="US markets are currently closed. Live data will resume when markets reopen at 9:30 AM ET."
      action={
        <div className={clsx('text-xs mt-2', darkMode ? 'text-gray-500' : 'text-slate-500')}>
          Next open: <span className={clsx('font-semibold', darkMode ? 'text-white' : 'text-slate-900')}>
            Tomorrow 9:30 AM ET
          </span>
        </div>
      }
      darkMode={darkMode}
    />
  )
}

export function NoSignalsEmptyState({ darkMode = true }) {
  return (
    <EmptyState
      icon="⚡"
      title="No Signals Yet"
      description="The signal engine is warming up. Signals will appear after collecting at least 27 bars of data per symbol (approximately 27 minutes)."
      size="md"
      darkMode={darkMode}
    />
  )
}
