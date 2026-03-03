/**
 * SkeletonLoader.jsx - Loading state components
 * Provides visual feedback while data is loading
 */

export function TableSkeleton({ rows = 10, cols = 8 }) {
  return (
    <div className="w-full">
      {/* Header skeleton */}
      <div className="flex gap-4 py-3 border-b border-white/10 bg-gray-900/50">
        {Array.from({ length: cols }).map((_, i) => (
          <div key={i} className="h-3 bg-white/10 rounded flex-1 animate-pulse" />
        ))}
      </div>
      
      {/* Row skeletons */}
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4 py-3 border-b border-white/5">
          {Array.from({ length: cols }).map((_, j) => (
            <div 
              key={j} 
              className="h-4 bg-white/5 rounded flex-1 animate-pulse"
              style={{ animationDelay: `${(i * 50) + (j * 20)}ms` }}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

export function CardSkeleton({ count = 6 }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
      {Array.from({ length: count }).map((_, i) => (
        <div 
          key={i} 
          className="rounded-xl p-4 border border-white/10 bg-gray-900/50 animate-pulse"
          style={{ animationDelay: `${i * 100}ms` }}
        >
          <div className="flex justify-between items-start mb-3">
            <div className="h-4 w-16 bg-white/10 rounded" />
            <div className="h-4 w-12 bg-white/10 rounded" />
          </div>
          <div className="h-3 w-24 bg-white/5 rounded mb-3" />
          <div className="h-5 w-20 bg-white/10 rounded mb-2" />
          <div className="flex gap-1">
            <div className="h-4 w-8 bg-white/5 rounded" />
            <div className="h-4 w-8 bg-white/5 rounded" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function ChartSkeleton() {
  return (
    <div className="w-full h-[600px] bg-gray-900/50 rounded-lg border border-white/10 
                    flex items-center justify-center animate-pulse">
      <div className="text-center">
        <div className="text-4xl mb-4">📊</div>
        <div className="h-4 w-32 bg-white/10 rounded mx-auto mb-2" />
        <div className="h-3 w-48 bg-white/5 rounded mx-auto" />
      </div>
    </div>
  )
}

export function StatCardSkeleton({ count = 4 }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <div 
          key={i} 
          className="rounded-xl p-4 border border-white/10 bg-gray-900/50 animate-pulse"
          style={{ animationDelay: `${i * 100}ms` }}
        >
          <div className="h-3 w-20 bg-white/10 rounded mb-3" />
          <div className="h-8 w-24 bg-white/15 rounded mb-2" />
          <div className="h-3 w-16 bg-white/5 rounded" />
        </div>
      ))}
    </div>
  )
}

export function ListSkeleton({ items = 5 }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: items }).map((_, i) => (
        <div 
          key={i} 
          className="flex items-center gap-3 p-3 rounded-lg bg-gray-900/50 animate-pulse"
          style={{ animationDelay: `${i * 80}ms` }}
        >
          <div className="w-10 h-10 bg-white/10 rounded-full" />
          <div className="flex-1">
            <div className="h-4 w-24 bg-white/10 rounded mb-2" />
            <div className="h-3 w-32 bg-white/5 rounded" />
          </div>
          <div className="h-6 w-16 bg-white/10 rounded" />
        </div>
      ))}
    </div>
  )
}

export function DashboardSkeleton() {
  return (
    <div className="space-y-6 p-4">
      {/* Stats row */}
      <StatCardSkeleton count={5} />
      
      {/* Main content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <div className="h-8 w-48 bg-white/10 rounded mb-4 animate-pulse" />
          <TableSkeleton rows={8} cols={7} />
        </div>
        
        <div>
          <div className="h-8 w-32 bg-white/10 rounded mb-4 animate-pulse" />
          <ListSkeleton items={6} />
        </div>
      </div>
    </div>
  )
}

// Shimmer effect variant
export function ShimmerSkeleton({ className = '' }) {
  return (
    <div className={`relative overflow-hidden bg-white/5 rounded ${className}`}>
      <div className="absolute inset-0 -translate-x-full animate-shimmer 
                      bg-gradient-to-r from-transparent via-white/10 to-transparent" />
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
