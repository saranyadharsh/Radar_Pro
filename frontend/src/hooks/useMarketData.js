/**
 * useMarketData.js — NexRadar Pro
 * =================================
 * React hook that connects to the SharedWorker (sseWorker.js) and
 * subscribes to live market data.
 *
 * Usage in any page component:
 *   import { useMarketData, useFeedStatus } from './useMarketData'
 *
 *   function PageLiveTable() {
 *     const rows       = useMarketData()        // array of ticker rows
 *     const feedOnline = useFeedStatus()        // bool — Polygon WS status
 *     ...
 *   }
 *
 * What this replaces:
 *   - Any existing useEffect that creates new EventSource(...)
 *   - Any existing useState/useEffect that fetches /api/snapshot on mount
 *
 * Tab switch behaviour:
 *   Component unmounts -> useEffect cleanup removes the onmessage handler
 *   BUT the SharedWorker keeps running and SSE keeps streaming.
 *   When the tab is re-activated, component mounts again -> posts
 *   'get_snapshot' -> worker returns current cache from memory instantly.
 *   Zero network round-trip. Zero backend contact.
 *
 * Page refresh behaviour:
 *   Browser reloads the page JS but the SharedWorker survives.
 *   New page connects to the same worker via a new port.
 *   'get_snapshot' returns the cache that was already in the worker.
 *   Zero reconnect. Zero new SSE connection.
 */

import { useState, useEffect, useRef } from 'react'

// ── Singleton worker — created once per browser, shared across all pages ──────
let _worker = null

function getWorker() {
  if (!_worker && typeof SharedWorker !== 'undefined') {
    _worker = new SharedWorker('/sseWorker.js')
    _worker.port.start()
  }
  return _worker
}

// ── Shared state store outside React — avoids re-creating on every mount ──────
const _store = {
  rows:      {},           // ticker -> row (latest)
  feedOk:    true,
  listeners: new Set(),    // React setState callbacks
}

function notifyListeners() {
  _store.listeners.forEach(fn => fn(Object.values(_store.rows)))
}

// Bootstrap worker message handler once globally
let _workerBootstrapped = false
function bootstrapWorker() {
  if (_workerBootstrapped) return
  _workerBootstrapped = true

  const worker = getWorker()
  if (!worker) return

  worker.port.onmessage = (e) => {
    const msg = e.data
    if (!msg || !msg.type) return

    if (msg.type === 'snapshot') {
      // Full cache from worker memory — replace local store
      _store.rows = {}
      if (Array.isArray(msg.data)) {
        msg.data.forEach(row => {
          if (row.ticker) _store.rows[row.ticker] = row
        })
      }
      notifyListeners()
    }
    else if (msg.type === 'snapshot_delta') {
      // Only changed rows — merge
      if (Array.isArray(msg.data)) {
        msg.data.forEach(row => {
          if (row.ticker) _store.rows[row.ticker] = row
        })
        notifyListeners()
      }
    }
    else if (msg.type === 'tick_batch') {
      // 250ms batch — merge
      if (Array.isArray(msg.data)) {
        msg.data.forEach(row => {
          if (row.ticker) _store.rows[row.ticker] = row
        })
        notifyListeners()
      }
    }
    else if (msg.type === 'feed_status') {
      _store.feedOk = msg.ok
      _store.listeners.forEach(fn => fn(Object.values(_store.rows)))
    }
    // Other types (session_change, halt_alert, etc.) are handled by
    // specialised hooks or ignored here
  }

  // Request current cache from worker immediately
  worker.port.postMessage('get_snapshot')
}

/**
 * useMarketData() — returns array of all ticker rows, live-updated.
 *
 * @param {function} [filter] - optional filter function (row) => bool
 * @returns {Array} ticker rows
 */
export function useMarketData(filter = null) {
  const [rows, setRows] = useState(() => Object.values(_store.rows))

  useEffect(() => {
    bootstrapWorker()

    const listener = (allRows) => {
      setRows(filter ? allRows.filter(filter) : allRows)
    }

    _store.listeners.add(listener)

    // Immediately populate from current store (handles page refresh case
    // where worker already has data before this hook mounts)
    if (Object.keys(_store.rows).length > 0) {
      listener(Object.values(_store.rows))
    }

    return () => {
      _store.listeners.delete(listener)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return rows
}

/**
 * useFeedStatus() — returns true if Polygon WS is connected, false if down.
 * Use this to show a "feed reconnecting..." banner.
 */
export function useFeedStatus() {
  const [feedOk, setFeedOk] = useState(_store.feedOk)

  useEffect(() => {
    bootstrapWorker()

    const listener = () => setFeedOk(_store.feedOk)
    _store.listeners.add(listener)

    return () => _store.listeners.delete(listener)
  }, [])

  return feedOk
}

/**
 * useSessionChange() — calls callback when MH/AH session boundary is crossed.
 * Useful for pages that need to refresh derived calculations at session change.
 *
 * @param {function} callback (session: 'market' | 'after' | 'pre') => void
 */
export function useSessionChange(callback) {
  const callbackRef = useRef(callback)
  callbackRef.current = callback

  useEffect(() => {
    bootstrapWorker()
    const worker = getWorker()
    if (!worker) return

    const prevHandler = worker.port.onmessage
    worker.port.onmessage = (e) => {
      if (prevHandler) prevHandler(e)
      if (e.data?.type === 'session_change') {
        callbackRef.current(e.data.session)
      }
    }
  }, [])
}
