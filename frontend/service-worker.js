/**
 * service-worker.js — NexRadar Pro
 * ===================================
 * Caches the app shell so a network drop shows the last known UI
 * with a "Disconnected" banner instead of a white/error page.
 *
 * Strategy: Cache-first for static assets, network-first for API.
 *
 * What it caches:
 *   - App shell: index.html, JS/CSS bundles, fonts, icons
 *   - Static assets from /assets/ (Vite build output)
 *
 * What it does NOT cache:
 *   - /api/* — always network. SSE stream cannot be cached.
 *   - External URLs (TradingView iframes, Polygon WS)
 *
 * Offline behaviour:
 *   - Static assets → serve from cache (app loads)
 *   - /api/* → network fails → page stays up, useTickerData
 *     SSE onerror fires → wsStatus = 'connecting' → banner shows
 *   - No cache hit at all → show offline fallback page
 *
 * Lifecycle:
 *   install  → pre-cache app shell
 *   activate → delete old caches, claim clients immediately
 *   fetch    → route requests through strategy
 */

'use strict'

// CACHE-VERSION-FIX: a static 'nexradar-v1' string is never bumped between
// deploys — the SW keeps serving stale JS/CSS bundles indefinitely.
// Using Date.now() at SW install time means each new SW file (content-changed
// by the deploy) generates a unique cache name, triggering activate → old
// cache deletion automatically. No manual version bumping needed.
const CACHE_VERSION  = `nexradar-${Date.now()}`
const SHELL_CACHE    = `${CACHE_VERSION}-shell`
const OFFLINE_URL    = '/offline.html'

// App shell files to pre-cache on install.
// Vite generates hashed filenames — we cache the root index.html
// and rely on the pattern match below for /assets/ bundles.
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/sseWorker.js',
  '/sortWorker.js',
  OFFLINE_URL,
]

// ── Install: pre-cache app shell ──────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(cache => {
      // addAll fails silently for individual URLs — use Promise.allSettled
      // so a missing /offline.html doesn't abort the whole install.
      return Promise.allSettled(
        PRECACHE_URLS.map(url => cache.add(url).catch(() => null))
      )
    }).then(() => {
      // Skip waiting so the new SW activates immediately without requiring
      // all tabs to close first. Safe here because we cache-bust via version.
      return self.skipWaiting()
    })
  )
})

// ── Activate: clean up old caches, claim clients ──────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key.startsWith('nexradar-') && key !== SHELL_CACHE)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  )
})

// ── Fetch: route requests ─────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  // 1. Never intercept: SSE stream, API calls, non-GET, cross-origin
  // ERR_CACHE_READ_FAILURE fix: cross-origin requests (Google Fonts, CDN assets)
  // must never go through the cache — the browser blocks cross-origin cache reads
  // for opaque responses under certain conditions, causing ERR_CACHE_READ_FAILURE.
  if (request.method !== 'GET')            return
  if (url.pathname.startsWith('/api/'))    return
  if (url.origin !== self.location.origin) return  // ← blocks fonts.gstatic.com etc.

  // VITE-DEV-FIX: never intercept Vite's internal dev-server paths.
  // /@vite/client, /@react-refresh, /@fs/*, ?t=HMR_TIMESTAMP are HMR/WebSocket
  // endpoints that must go directly to the dev server — caching them causes
  // "Failed to convert value to Response" and breaks hot module replacement.
  if (url.pathname.startsWith('/@'))       return
  if (url.pathname.startsWith('/@fs'))     return
  if (url.search.includes('t='))           return  // HMR timestamp query strings
  if (url.pathname === '/src/main.jsx')    return  // Vite entry point

  // 2. Static assets (/assets/*, /sseWorker.js, /sortWorker.js, etc.)
  //    Strategy: cache-first, then network, then offline fallback.
  if (
    url.pathname.startsWith('/assets/') ||
    url.pathname.startsWith('/icons/')  ||
    url.pathname.endsWith('.js')        ||
    url.pathname.endsWith('.css')       ||
    url.pathname.endsWith('.woff2')     ||
    url.pathname.endsWith('.png')       ||
    url.pathname.endsWith('.svg')
  ) {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached
        return fetch(request).then(response => {
          if (response.ok) {
            const clone = response.clone()
            caches.open(SHELL_CACHE).then(cache => cache.put(request, clone))
          }
          return response
        }).catch(() => caches.match(OFFLINE_URL))
      })
    )
    return
  }

  // 3. Navigation requests (HTML pages)
  //    Strategy: network-first, fall back to cached index.html (SPA),
  //    then offline page.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match('/index.html').then(cached =>
          cached ?? caches.match(OFFLINE_URL)
        )
      )
    )
    return
  }

  // 4. Everything else: network with cache fallback
  event.respondWith(
    fetch(request).catch(() => caches.match(request))
  )
})
