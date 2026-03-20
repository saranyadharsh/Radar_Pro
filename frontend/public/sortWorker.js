/**
 * sortWorker.js — NexRadar Pro  Web Worker
 * =========================================
 * Runs the O(N log N) sort + filter pipeline off the main thread.
 * Eliminates jank on mobile when sorting 6,000+ tickers on every data update.
 *
 * Why a Web Worker (not SharedWorker):
 *   - Sorting is CPU-bound and synchronous — needs its own thread
 *   - SharedWorker holds the SSE connection; this is compute-only
 *   - One instance per PageLiveTable mount (terminates on unmount)
 *
 * Message in  (main → worker):
 *   { type: 'sort', payload: { tickers, sortKey, sortDir, minDelta,
 *                               quickFilter, source, watchlist, selectedSectors,
 *                               earningsTickers, subMode } }
 *
 * Message out (worker → main):
 *   { type: 'result', symbols: string[] }   — sorted symbol array only
 *   { type: 'error',  message: string }
 *
 * Design notes:
 *   - Returns symbol strings only, NOT full ticker objects.
 *     Main thread does O(1) tickers.get(sym) per rendered row — always fresh.
 *   - Transfer is tiny: 6,000 symbols × ~6 chars avg = ~36 KB JSON.
 *   - Worker receives a plain array snapshot of the Map (serialisable).
 *     Map itself cannot be transferred across the worker boundary.
 */

'use strict'

// ── Sector normalizer (mirrors utils.js normalizeSector) ─────────────────────
const SECTOR_ALIASES = {
  'technology':             'Technology',
  'tech':                   'Technology',
  'communication services': 'Communication',
  'communication':          'Communication',
  'communications':         'Communication',
  'consumer cyclical':      'Consumer Cyclical',
  'consumer defensive':     'Consumer Defensive',
  'consumer staples':       'Consumer Defensive',
  'financial services':     'Financial',
  'financials':             'Financial',
  'financial':              'Financial',
  'healthcare':             'Healthcare',
  'health care':            'Healthcare',
  'industrials':            'Industrials',
  'industrial':             'Industrials',
  'basic materials':        'Materials',
  'materials':              'Materials',
  'real estate':            'Real Estate',
  'utilities':              'Utilities',
  'energy':                 'Energy',
}

function normalizeSector(s) {
  if (!s) return ''
  return SECTOR_ALIASES[s.toLowerCase()] ?? s
}

// ── Sort comparator ───────────────────────────────────────────────────────────

function getVal(t, sortKey, subMode) {
  switch (sortKey) {
    case 'symbol':      return null   // handled separately (string compare)
    case 'open':        return t.open        || 0
    case 'price':       return t.live_price  || 0
    case 'change':      return subMode === 'AH'
      ? (t.ah_dollar || 0)
      : (t.open > 0 && t.live_price > 0 ? t.live_price - t.open : (t.change_value || 0))
    case 'pct':         return subMode === 'AH'
      ? (t.ah_pct    || 0)
      : (t.open > 0 && t.live_price > 0 ? (t.live_price - t.open) / t.open * 100 : (t.percent_change || 0))
    case 'volume':      return t.volume       || 0
    case 'prev_close':  return t.prev_close   || 0
    case 'today_close': return t.today_close  || 0
    case 'live_price':  return t.live_price   || 0
    default:            return t.open > 0 && t.live_price > 0 ? t.live_price - t.open : (t.change_value || 0)
  }
}

// ── Main message handler ──────────────────────────────────────────────────────

self.onmessage = (e) => {
  if (e.data?.type !== 'sort') return

  try {
    const {
      tickers,         // plain Array of ticker objects (snapshot of Map.values())
      sortKey,
      sortDir,
      minDelta,
      quickFilter,
      source,
      watchlist,       // Array of watched symbols (Set serialised as Array)
      selectedSectors, // Array of selected sector strings
      earningsTickers, // Array of earnings ticker symbols
      subMode,         // 'MH' | 'AH'
    } = e.data.payload

    const watchSet    = new Set(watchlist    ?? [])
    const earningsSet = new Set(earningsTickers ?? [])
    const dir = sortDir === 'desc' ? -1 : 1

    // ── Step 1: source filter ─────────────────────────────────────────────
    let arr = tickers
    if (source === 'WATCHLIST') arr = arr.filter(t => watchSet.has(t.ticker))

    // ── Step 2: sector filter ─────────────────────────────────────────────
    if (!selectedSectors.includes('ALL')) {
      arr = arr.filter(t => {
        if (selectedSectors.includes('EARNINGS') &&
            (t.is_earnings_gap_play || earningsSet.has(t.ticker))) return true
        const s = normalizeSector(t.sector)
        return s && selectedSectors.some(sel => s === sel && sel !== 'EARNINGS')
      })
    }

    // ── Step 3: minDelta + quickFilter ────────────────────────────────────
    // minDelta filter: use intraday (vs open) change for MH, AH dollar for AH
    const getChgAbs = (t) => subMode === 'AH'
      ? Math.abs(t.ah_dollar || 0)
      : Math.abs(t.open > 0 && t.live_price > 0 ? t.live_price - t.open : (t.change_value || 0))
    arr = arr.filter(t => getChgAbs(t) >= (minDelta || 0))
    if (quickFilter === 'VOL_SPIKES') arr = arr.filter(t => t.volume_spike)
    if (quickFilter === 'GAP_PLAYS')  arr = arr.filter(t => t.is_gap_play)
    if (quickFilter === 'AH_MOMT')    arr = arr.filter(t => t.ah_momentum)
    if (quickFilter === 'EARN_GAPS')  arr = arr.filter(t => t.is_earnings_gap_play)
    if (quickFilter === 'DIAMOND')    arr = arr.filter(t => {
      const pct = subMode === 'AH'
        ? Math.abs(t.ah_pct || 0)
        : Math.abs(t.open > 0 && t.live_price > 0 ? (t.live_price - t.open) / t.open * 100 : (t.percent_change || 0))
      return pct >= 5
    })

    // ── Step 4: sort ──────────────────────────────────────────────────────
    arr = arr.slice().sort((a, b) => {
      if (sortKey === 'symbol') return dir * (a.ticker || '').localeCompare(b.ticker || '')
      return dir * (getVal(a, sortKey, subMode) - getVal(b, sortKey, subMode))
    })

    // ── Step 5: return symbol strings only ───────────────────────────────
    self.postMessage({ type: 'result', symbols: arr.map(t => t.ticker) })

  } catch (err) {
    self.postMessage({ type: 'error', message: err.message })
  }
}
