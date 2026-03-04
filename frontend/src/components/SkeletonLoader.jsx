/**
 * SkeletonLoader.jsx - Loading state components
 * Provides visual feedback while data is loading
 */

import clsx from 'clsx'

export function TableSkeleton({ rows = 10, cols = 8, darkMode = true }) {
  return (
    <div className="w-full">
      {/* Header skeleton */}
      <div className={clsx(
        'flex gap-4 py-3 border-b',
        darkMode 
          ? 'border-white/10 bg-gray-900/50' 
          : 'border-slate-200 bg-slate-50'
      )}>
        {Array.from({ length: cols }).map((_, i) => (
          <div key={i} className={clsx(
            'h-3 rounded flex-1 animate-pulse',
            darkMode ? 'bg-white/10' : 'bg-slate-300'
          )} />
        ))}
      </div>
      
      {/* Row skeletons */}
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className={clsx(
          'flex gap-4 py-3 border-b',
          darkMode ? 'border-white/5' : 'border-slate-100'
        )}>
          {Array.from({ length: cols }).map((_, j) => (
            <div 
              key={j} 
              className={clsx(
                'h-4 rounded flex-1 animate-pulse',
                darkMode ? 'bg-white/5' : 'bg-slate-200'
              )}
              style={{ animationDelay: `${(i * 50) + (j * 20)}ms` }}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

export function CardSkeleton({ count = 6, darkMode = true }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
      {Array.from({ length: count }).map((_, i) => (
        <div 
          key={i} 
          className={clsx(
            'rounded-xl p-4 border animate-pulse',
            darkMode 
              ? 'border-white/10 bg-gray-900/50' 
              : 'border-slate-200 bg-slate-50'
          )}
          style={{ animationDelay: `${i * 100}ms` }}
        >
          <div className="flex justify-between items-start mb-3">
            <div className={clsx(
              'h-4 w-16 rounded',
              darkMode ? 'bg-white/10' : 'bg-slate-300'
            )} />
            <div className={clsx(
              'h-4 w-12 rounded',
              darkMode ? 'bg-white/10' : 'bg-slate-300'
            )} />
          </div>
          <div className={clsx(
            'h-3 w-24 rounded mb-3',
            darkMode ? 'bg-white/5' : 'bg-slate-200'
          )} />
          <div className={clsx(
            'h-5 w-20 rounded mb-2',
            darkMode ? 'bg-white/10' : 'bg-slate-300'
          )} />
          <div className="flex gap-1">
            <div className={clsx(
              'h-4 w-8 rounded',
              darkMode ? 'bg-white/5' : 'bg-slate-200'
            )} />
            <div className={clsx(
              'h-4 w-8 rounded',
              darkMode ? 'bg-white/5' : 'bg-slate-200'
            )} />
          </div>
        </div>
      ))}
    </div>
  )
}

export function ChartSkeleton({ darkMode = true }) {
  return (
    <div className={clsx(
      'w-full h-[600px] rounded-lg border flex items-center justify-center animate-pulse',
      darkMode 
        ? 'bg-gray-900/50 border-white/10' 
        : 'bg-slate-50 border-slate-200'
    )}>
      <div className="text-center">
        <div className="text-4xl mb-4">📊</div>
        <div className={clsx(
          'h-4 w-32 rounded mx-auto mb-2',
          darkMode ? 'bg-white/10' : 'bg-slate-300'
        )} />
        <div className={clsx(
          'h-3 w-48 rounded mx-auto',
          darkMode ? 'bg-white/5' : 'bg-slate-200'
        )} />
      </div>
    </div>
  )
}

export function StatCardSkeleton({ count = 4, darkMode = true }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <div 
          key={i} 
          className={clsx(
            'rounded-xl p-4 border animate-pulse',
            darkMode 
              ? 'border-white/10 bg-gray-900/50' 
              : 'border-slate-200 bg-slate-50'
          )}
          style={{ animationDelay: `${i * 100}ms` }}
        >
          <div className={clsx(
            'h-3 w-20 rounded mb-3',
            darkMode ? 'bg-white/10' : 'bg-slate-300'
          )} />
          <div className={clsx(
            'h-8 w-24 rounded mb-2',
            darkMode ? 'bg-white/15' : 'bg-slate-300'
          )} />
          <div className={clsx(
            'h-3 w-16 rounded',
            darkMode ? 'bg-white/5' : 'bg-slate-200'
          )} />
        </div>
      ))}
    </div>
  )
}

export function ListSkeleton({ items = 5, darkMode = true }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: items }).map((_, i) => (
        <div 
          key={i} 
          className={clsx(
            'flex items-center gap-3 p-3 rounded-lg animate-pulse',
            darkMode ? 'bg-gray-900/50' : 'bg-slate-50'
          )}
          style={{ animationDelay: `${i * 80}ms` }}
        >
          <div className={clsx(
            'w-10 h-10 rounded-full',
            darkMode ? 'bg-white/10' : 'bg-slate-300'
          )} />
          <div className="flex-1">
            <div className={clsx(
              'h-4 w-24 rounded mb-2',
              darkMode ? 'bg-white/10' : 'bg-slate-300'
            )} />
            <div className={clsx(
              'h-3 w-32 rounded',
              darkMode ? 'bg-white/5' : 'bg-slate-200'
            )} />
          </div>
          <div className={clsx(
            'h-6 w-16 rounded',
            darkMode ? 'bg-white/10' : 'bg-slate-300'
          )} />
        </div>
      ))}
    </div>
  )
}

export function DashboardSkeleton({ darkMode = true }) {
  return (
    <div className="space-y-6 p-4">
      {/* Stats row */}
      <StatCardSkeleton count={5} darkMode={darkMode} />
      
      {/* Main content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <div className={clsx(
            'h-8 w-48 rounded mb-4 animate-pulse',
            darkMode ? 'bg-white/10' : 'bg-slate-300'
          )} />
          <TableSkeleton rows={8} cols={7} darkMode={darkMode} />
        </div>
        
        <div>
          <div className={clsx(
            'h-8 w-32 rounded mb-4 animate-pulse',
            darkMode ? 'bg-white/10' : 'bg-slate-300'
          )} />
          <ListSkeleton items={6} darkMode={darkMode} />
        </div>
      </div>
    </div>
  )
}

// Shimmer effect variant
export function ShimmerSkeleton({ className = '', darkMode = true }) {
  return (
    <div className={clsx(
      'relative overflow-hidden rounded',
      darkMode ? 'bg-white/5' : 'bg-slate-200',
      className
    )}>
      <div className={clsx(
        'absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r',
        darkMode 
          ? 'from-transparent via-white/10 to-transparent'
          : 'from-transparent via-white/60 to-transparent'
      )} />
    </div>
  )
}

// Add to tailwind.config.js:
/*
module.exports = {
  theme: {
    extend: {
      keyframes: {
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        shimmer: 'shimmer 2s infinite',
      },
    },
  },
}
*/
