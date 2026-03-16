/**
 * App.jsx — NexRadar Pro v4.4
 * Auth gate → Dashboard
 */

import { useState, useEffect } from 'react'
import { createClient } from '@supabase/supabase-js'
import NexRadarDashboard from './components/NexRadarDashboard'
import NexRadarAuth from './components/nexradar-auth'
import { STORAGE_KEYS } from './config'

// ── Supabase client ────────────────────────────────────────────────────────────
// Add to your .env file (same file where SUPABASE_URL already lives):
//   VITE_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
//   VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }
)

export default function App() {
  // ── Auth state ──────────────────────────────────────────────────────────────
  // undefined = still checking, null = not logged in, object = logged in
  const [user, setUser] = useState(undefined)

  useEffect(() => {
    // onAuthStateChange fires immediately with the current session AND
    // also fires when Google OAuth redirects back to the app (SIGNED_IN event).
    // This single listener handles all cases: page refresh, OAuth redirect, sign out.
    //
    // TOKEN_REFRESH_ERROR fix: when localStorage has a stale/expired refresh token
    // from a previous session, Supabase SDK retries → gets 400 repeatedly →
    // logs "AuthApiError: Invalid Refresh Token" in console → also causes the
    // SSE RECONNECTING banner because network errors interrupt the stream.
    // Fix: on TOKEN_REFRESH_ERROR, clear the bad session and sign out cleanly.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        setUser(session?.user ?? null)
      } else if (event === 'SIGNED_OUT') {
        setUser(null)
      } else if (event === 'TOKEN_REFRESH_ERROR') {
        // Stale / invalid refresh token in localStorage — clear it and force re-login.
        // Without this, the SDK retries the bad token on every page load → 400 loop.
        console.warn('[NexRadar] Refresh token invalid — clearing session')
        supabase.auth.signOut({ scope: 'local' }) // local only — no server round-trip needed
        setUser(null)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  // ── Theme system ────────────────────────────────────────────────────────────
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.THEME)
    return saved || 'auto'
  })
  const [darkMode, setDarkMode] = useState(true)

  useEffect(() => {
    let actualDarkMode = true
    if (theme === 'light') {
      actualDarkMode = false
    } else if (theme === 'dark' || theme === 'high-contrast') {
      actualDarkMode = true
    } else if (theme === 'auto') {
      const hour = new Date().getHours()
      actualDarkMode = hour < 6 || hour >= 18
    }
    setDarkMode(actualDarkMode)
    localStorage.setItem(STORAGE_KEYS.THEME, theme)
  }, [theme])

  // ── Sign out ────────────────────────────────────────────────────────────────
  const handleSignOut = async () => {
    await supabase.auth.signOut()
    // onAuthStateChange SIGNED_OUT handler sets user → null → auth page renders
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  // undefined = still resolving session (blank screen avoids flash)
  if (user === undefined) return null

  // Not logged in → show auth page
  if (!user) {
    return <NexRadarAuth onAuthenticated={setUser} supabase={supabase} />
  }

  // Logged in → show dashboard
  return (
    <NexRadarDashboard
      darkMode={darkMode}
      onThemeChange={setTheme}
      currentTheme={theme}
      user={user}
      onSignOut={handleSignOut}
    />
  )
}
