/**
 * useWebSocket.js
 * ---------------
 * Connects to the NexRadar backend /ws/live endpoint.
 *
 * On mount:    connects & receives initial snapshot
 * On tick:     merges single-ticker update into state
 * On drop:     auto-reconnects with exponential backoff
 *
 * Returns: { tickers, metrics, wsStatus }
 *   tickers  — Map<string, TickerRow> (keyed by ticker symbol)
 *   wsStatus — 'connecting' | 'open' | 'closed' | 'error'
 */

import { useState, useEffect, useRef, useCallback } from 'react'

const WS_URL     = import.meta.env.VITE_WS_URL || 'ws://localhost:8000/ws/live'
const MAX_DELAY  = 30_000   // 30s max backoff
const BASE_DELAY = 1_000

export function useWebSocket() {
  const [tickers,  setTickers]  = useState(new Map())
  const [wsStatus, setStatus]   = useState('connecting')

  const wsRef      = useRef(null)
  const retryTimer = useRef(null)
  const delay      = useRef(BASE_DELAY)

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    console.log('[WS] Connecting to:', WS_URL)
    setStatus('connecting')
    const ws = new WebSocket(WS_URL)
    wsRef.current = ws

    ws.onopen = () => {
      console.log('[WS] Connected successfully')
      setStatus('open')
      delay.current = BASE_DELAY   // reset backoff on success
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(
          event.data instanceof Blob
            ? undefined   // handled below
            : event.data
        )
        handleMessage(msg)
      } catch {
        // Binary (orjson bytes)
        const reader = new FileReader()
        reader.onload = () => {
          try {
            const msg = JSON.parse(reader.result)
            handleMessage(msg)
          } catch (e) {
            console.warn('[WS] Parse error:', e)
          }
        }
        if (event.data instanceof Blob) reader.readAsText(event.data)
      }
    }

    ws.onerror = (err) => {
      console.error('[WS] Error:', err)
      setStatus('error')
    }

    ws.onclose = (event) => {
      console.log('[WS] Closed:', event.code, event.reason)
      setStatus('closed')
      // Exponential backoff reconnect
      const jitter = Math.random() * 0.4 + 0.8
      const wait   = Math.min(delay.current * jitter, MAX_DELAY)
      delay.current = Math.min(delay.current * 2, MAX_DELAY)
      console.log('[WS] Reconnecting in', Math.round(wait), 'ms')
      retryTimer.current = setTimeout(connect, wait)
    }
  }, []) // eslint-disable-line

  function handleMessage(msg) {
    if (!msg?.type) {
      console.warn('[WS] Message missing type:', msg)
      return
    }

    if (msg.type === 'snapshot') {
      // Full initial load
      console.log('[WS] Snapshot received:', msg.data?.length, 'tickers')
      setTickers(() => {
        const m = new Map()
        for (const row of msg.data ?? []) {
          m.set(row.ticker, row)
        }
        return m
      })
    } else if (msg.type === 'tick') {
      // Single ticker update
      setTickers(prev => {
        const next = new Map(prev)
        next.set(msg.ticker, { ...(prev.get(msg.ticker) ?? {}), ...msg.data })
        return next
      })
    } else {
      console.warn('[WS] Unknown message type:', msg.type)
    }
  }

  useEffect(() => {
    connect()
    return () => {
      clearTimeout(retryTimer.current)
      wsRef.current?.close()
    }
  }, [connect])

  return { tickers, wsStatus }
}
