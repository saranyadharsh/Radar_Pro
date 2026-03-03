/**
 * MiniSparkline.jsx — NexRadar Pro
 * Enhanced sparkline chart with tooltips and interactions
 */

import { useMemo, useState } from 'react'

export default function MiniSparkline({ 
  data, 
  width = 60, 
  height = 24, 
  color = '#10b981', 
  isPositive = true,
  showTooltip = true,
  ticker = ''
}) {
  const [hoveredPoint, setHoveredPoint] = useState(null)

  const { path, points, min, max } = useMemo(() => {
    if (!data || data.length < 2) {
      return { path: '', points: [], min: 0, max: 0 }
    }

    const values = data.filter(v => v != null && !isNaN(v))
    if (values.length < 2) {
      return { path: '', points: [], min: 0, max: 0 }
    }

    const min = Math.min(...values)
    const max = Math.max(...values)
    const range = max - min || 1

    const points = values.map((value, index) => {
      const x = (index / (values.length - 1)) * width
      const y = height - ((value - min) / range) * height
      return { x, y, value, index }
    })

    const pathStr = `M ${points.map(p => `${p.x},${p.y}`).join(' L ')}`

    return { path: pathStr, points, min, max }
  }, [data, width, height])

  if (!path) {
    return (
      <svg width={width} height={height} className="opacity-20">
        <line x1="0" y1={height / 2} x2={width} y2={height / 2} stroke="currentColor" strokeWidth="1" strokeDasharray="2,2" />
      </svg>
    )
  }

  const handleMouseMove = (e) => {
    if (!showTooltip) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const closest = points.reduce((prev, curr) => 
      Math.abs(curr.x - x) < Math.abs(prev.x - x) ? curr : prev
    )
    setHoveredPoint(closest)
  }

  const handleMouseLeave = () => {
    setHoveredPoint(null)
  }

  return (
    <div className="relative inline-block">
      <svg 
        width={width} 
        height={height} 
        className="overflow-visible"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        {/* Gradient fill */}
        <defs>
          <linearGradient id={`gradient-${ticker}-${isPositive ? 'up' : 'down'}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.3" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        
        {/* Fill area */}
        <path
          d={`${path} L ${width},${height} L 0,${height} Z`}
          fill={`url(#gradient-${ticker}-${isPositive ? 'up' : 'down'})`}
        />
        
        {/* Line */}
        <path
          d={path}
          fill="none"
          stroke={color}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        
        {/* Hover point */}
        {hoveredPoint && (
          <>
            <line
              x1={hoveredPoint.x}
              y1="0"
              x2={hoveredPoint.x}
              y2={height}
              stroke={color}
              strokeWidth="1"
              strokeDasharray="2,2"
              opacity="0.5"
            />
            <circle
              cx={hoveredPoint.x}
              cy={hoveredPoint.y}
              r="3"
              fill={color}
              stroke="white"
              strokeWidth="1.5"
            />
          </>
        )}
        
        {/* Last point dot */}
        {!hoveredPoint && (
          <circle
            cx={width}
            cy={height - ((data[data.length - 1] - min) / (max - min || 1)) * height}
            r="2"
            fill={color}
          />
        )}
      </svg>
      
      {/* Tooltip */}
      {showTooltip && hoveredPoint && (
        <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-gray-900 text-white text-[10px] rounded shadow-lg whitespace-nowrap z-50 pointer-events-none">
          ${hoveredPoint.value.toFixed(2)}
          <div className="absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900" />
        </div>
      )}
    </div>
  )
}

// Generate mock intraday data for sparkline
export function generateSparklineData(currentPrice, changePercent, points = 20) {
  const data = []
  const startPrice = currentPrice / (1 + changePercent / 100)
  
  for (let i = 0; i < points; i++) {
    const progress = i / (points - 1)
    // Add some randomness to make it look realistic
    const noise = (Math.random() - 0.5) * (Math.abs(changePercent) * 0.1)
    const price = startPrice + (currentPrice - startPrice) * progress + noise
    data.push(price)
  }
  
  // Ensure last point is exactly current price
  data[data.length - 1] = currentPrice
  
  return data
}
