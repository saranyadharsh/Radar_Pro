/**
 * App.jsx — NexRadar Pro v4.5
 * Auth gate → Dashboard
 *
 * FIXES IN THIS VERSION:
 *
 *   STALE-TOKEN-FIX: Supabase SDK logs "AuthApiError: Invalid Refresh Token"
 *     in the browser console (and the network tab shows a 400 from the token
 *     endpoint) even though our TOKEN_REFRESH_ERROR handler correctly clears
 *     the bad session. The 400 appears because the SDK makes the HTTP call
 *     FIRST, gets the 400 back, logs the error to console, and THEN emits the
 *     TOKEN_REFRESH_ERROR event — by which time our handler can't suppress the
 *     already-printed console error.
 *
 *     Fix: on mount, call supabase.auth.getSession() immediately. If it returns
 *     null (no valid session) but localStorage still has stale auth data, clear
 *     the storage before the SDK's autoRefreshToken loop fires. This eliminates
 *     the 400 network call entirely — the SDK never tries to refresh a token
 *     we already know is invalid.
 *
 *     The TOKEN_REFRESH_ERROR handler is kept as a belt-and-suspenders fallback
 *     for tokens that are present but expire mid-session (after initial mount).
 *
 *   SW-DEV-FIX (existing): unregister stale Service Worker in dev mode to
 *     prevent HMR interference.
 */

import { useState, useEffect } from 'react'
import { createClient } from '@supabase/supabase-js'
import NexRadarDashboard from './components/NexRadarDashboard'
import NexRadarAuth from './components/nexradar-auth'
import { STORAGE_KEYS } from './config'

// ── Supabase client ────────────────────────────────────────────────────────────
const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }
)

// ── Stale token pre-cleaner ────────────────────────────────────────────────────
// Called ONCE on mount before the auth listener fires.
// If localStorage has Supabase auth keys but getSession() returns no valid
// session, purge those keys immediately so the SDK never attempts a refresh
// call that will return 400 and pollute the console / network log.
async function clearStaleAuthIfNeeded() {
  try {
    const { data, error } = await supabase.auth.getSession()
    // A 400-class error from getSession means the stored token is already invalid.
    // signOut({ scope: 'local' }) removes the localStorage entries without making
    // any server round-trip (scope:'local' skips the server revoke call).
    if (error || !data?.session) {
      const hasStoredData = Object.keys(localStorage).some(k =>
        k.startsWith('sb-') || k.includes('supabase')
      )
      if (hasStoredData) {
        console.info('[NexRadar] Stale auth token detected — clearing before SDK refresh attempt')
        await supabase.auth.signOut({ scope: 'local' })
      }
    }
  } catch {
    // getSession itself can throw if token is malformed — catch silently
    try { await supabase.auth.signOut({ scope: 'local' }) } catch {}
  }
}

export default function App() {
  // SW-DEV-FIX: unregister stale Service Worker in dev mode
  useEffect(() => {
    if (import.meta.env.PROD) return
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(regs => {
        regs.forEach(reg => {
          reg.unregister()
          console.log('[NexRadar] Dev mode: unregistered SW', reg.scope)
        })
      }).catch(() => {})
    }
  }, [])

  // ── Auth state ───────────────────────────────────────────────────────────────
  // undefined = still checking, null = not logged in, object = logged in
  const [user, setUser] = useState(undefined)

  useEffect(() => {
    // AUTH-RACE-FIX: clearStaleAuthIfNeeded() is async. Previously it was called
    // without awaiting, so onAuthStateChange was registered immediately after —
    // if the async signOut({ scope:'local' }) resolved at the same moment as the
    // SDK firing INITIAL_SESSION, both setUser(null) and setUser(session.user)
    // could execute in undefined order, causing a brief dashboard flash before
    // the login screen appeared.
    //
    // Fix: register the auth listener INSIDE the .then() of clearStaleAuthIfNeeded
    // so it is always set up AFTER the stale-token cleanup is complete.
    // The subscription ref is stored so the cleanup function can still unsubscribe.
    let subscription = null;

    clearStaleAuthIfNeeded().then(() => {
      const { data } = supabase.auth.onAuthStateChange((event, session) => {
        if (
          event === 'INITIAL_SESSION' ||
          event === 'SIGNED_IN'       ||
          event === 'TOKEN_REFRESHED'
        ) {
          setUser(session?.user ?? null)
        } else if (event === 'SIGNED_OUT') {
          setUser(null)
        } else if (event === 'TOKEN_REFRESH_ERROR') {
          console.warn('[NexRadar] Refresh token invalid — clearing session')
          supabase.auth.signOut({ scope: 'local' })
          setUser(null)
        }
      })
      subscription = data.subscription
    })

    return () => { subscription?.unsubscribe() }
  }, [])

  // ── Theme system ─────────────────────────────────────────────────────────────
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

  // ── Sign out ─────────────────────────────────────────────────────────────────
  const handleSignOut = async () => {
    await supabase.auth.signOut()
    // SIGNED_OUT event → setUser(null) → auth page renders
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  // undefined = session check in progress → blank screen (avoids auth flash)
  if (user === undefined) return null

  if (!user) {
    return <NexRadarAuth onAuthenticated={setUser} supabase={supabase} />
  }

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
