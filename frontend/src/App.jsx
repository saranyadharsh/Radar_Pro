/**
 * App.jsx — NexRadar Pro v4.3
 * Unified dashboard with NexRadarDashboard only
 */

import { useState, useEffect } from 'react'
import NexRadarDashboard from './components/NexRadarDashboard'
import { STORAGE_KEYS } from './config'

export default function App() {
  // Theme system: 'light', 'dark', 'high-contrast', 'auto'
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.THEME)
    return saved || 'auto'
  })
  
  // Compute actual dark mode based on theme setting
  const [darkMode, setDarkMode] = useState(true)
  
  useEffect(() => {
    let actualDarkMode = true
    
    if (theme === 'light') {
      actualDarkMode = false
    } else if (theme === 'dark' || theme === 'high-contrast') {
      actualDarkMode = true
    } else if (theme === 'auto') {
      // Auto mode: check system time (6 AM - 6 PM = light, otherwise dark)
      const hour = new Date().getHours()
      actualDarkMode = hour < 6 || hour >= 18
    }
    
    setDarkMode(actualDarkMode)
    
    // Save theme preference
    localStorage.setItem(STORAGE_KEYS.THEME, theme)
  }, [theme])

  return (
    <NexRadarDashboard 
      darkMode={darkMode}
      onThemeChange={setTheme}
      currentTheme={theme}
    />
  )
}
