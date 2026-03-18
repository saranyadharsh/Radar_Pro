// ═══════════════════════════════════════════════════════════════
// DataEngine.js — Layer 1: FREE · AUTO · ALWAYS ON
// Sources: Polygon.io Professional + EDGAR (SEC)
// No Claude. No AI. No cost per call.
// Runs independently — works even if AIEngine is down
//
// PRODUCTION INTEGRATION NOTES:
//   - Place at: src/components/engines/DataEngine.js
//   - All Polygon calls route through backend proxy /api/stock-data/{sym}
//   - NO VITE_POLYGON_API_KEY needed — key lives only on the Render server
//   - Add VITE_API_BASE to frontend Render env vars (already set)
// ═══════════════════════════════════════════════════════════════

// API-KEY-FIX + WS-FIX: POLYGON_KEY removed entirely.
//   VITE_* env vars are baked into the JS bundle at build time by Vite.
//   Anyone with DevTools can see the key in the network tab or bundle source.
//   All Polygon data now routes exclusively through the backend proxy:
//     /api/stock-data/{sym}  — snapshot + technicals + levels + options (5-min cache)
//     /api/news/{sym}        — Polygon news (already proxied)
//     /api/edgar/{sym}       — EDGAR EFTS (already proxied, CORS-blocked direct)
//   The Polygon API key is only on the Render server as POLYGON_API_KEY (no VITE_ prefix).
const API_BASE = import.meta.env.VITE_API_BASE || "";


async function edgarGet(symbol) {
  // Proxy through backend — efts.sec.gov blocks direct browser requests (CORS)
  return fetch(`${API_BASE}/api/edgar/${symbol.toUpperCase()}`)
    .then(r => { if (!r.ok) throw new Error(`EDGAR proxy ${r.status}`); return r.json(); });
}

// API-KEY-FIX: getSnapshot, getTechnicals, getSupportResistance, getOptions,
// getEarningsEstimate, getFundamentals previously called polyGet() directly,
// sending VITE_POLYGON_API_KEY as a URL param visible to anyone in DevTools.
// All data is now fetched exclusively via the backend proxy /api/stock-data/{sym}
// which handles all 7 Polygon calls server-side with the key in env (no VITE_ prefix).
// These individual exports are preserved as thin wrappers over getFullStockData
// so any callers that import them individually continue to work.
export async function getSnapshot(symbol)          { return (await getFullStockData(symbol)) || null; }
export async function getTechnicals(symbol)        { const d = await getFullStockData(symbol); return { rsi14:d?.rsi14, macd:d?.macd, macdSignal:d?.macdSignal, macdHist:d?.macdHist, sma20:d?.sma20, sma50:d?.sma50, sma200:d?.sma200, ema9:d?.ema9 }; }
export async function getSupportResistance(symbol) { const d = await getFullStockData(symbol); return { support:d?.support, resistance:d?.resistance, atr:d?.atr, bars:d?.bars||[] }; }
export async function getOptions(symbol)           { const d = await getFullStockData(symbol); return { impliedMovePct:d?.impliedMovePct, avgIV:d?.avgIV }; }

export async function getNews(symbol) {
  try {
    // Proxy through backend — MASSIVE_API_KEY stays server-side, no VITE_POLYGON_API_KEY needed
    const res = await fetch(`${API_BASE}/api/news/${symbol.toUpperCase()}`);
    if (!res.ok) throw new Error(`News proxy ${res.status}`);
    const data = await res.json();
    return (data.results || []).map(n => ({
      headline:  n.title,
      source:    n.publisher?.name,
      url:       n.article_url,
      published: n.published_utc,
      sentiment: n.insights?.[0]?.sentiment || "neutral",
      summary:   n.description,
    }));
  } catch (e) {
    console.warn("getNews failed:", e.message);
    return [];
  }
}

export async function getEarningsEstimate(symbol) {
  const d = await getFullStockData(symbol);
  return d?.earningsHistory || [];
}

export async function getFundamentals(symbol) {
  const d = await getFullStockData(symbol);
  return {
    companyName: d?.companyName, description: d?.description,
    sector: d?.sector, marketCap: d?.marketCap, employees: d?.employees,
    homepage: d?.homepage, revenue: d?.revenue, netIncome: d?.netIncome, eps: d?.eps,
  };
}

export async function getFullStockData(symbol) {
  // All Polygon data fetched via backend proxy — API key never leaves the server.
  // /api/stock-data/{sym} runs all 7 Polygon calls in parallel server-side
  // with a 5-min cache in Supabase (stock_data_cache table).
  try {
    const res = await fetch(`${API_BASE}/api/stock-data/${symbol.toUpperCase()}`);
    if (res.ok) {
      const data = await res.json();
      return { ...data, bars: data.bars || [] };
    }
    throw new Error(`Backend proxy returned ${res.status}`);
  } catch (e) {
    console.warn("[DataEngine] getFullStockData failed:", e.message);
    return null;
  }
}

// ── WebSocket live price push ─────────────────────────────────
// WS-FIX: Direct client-side Polygon WebSocket is DISABLED.
//
// Why: ws_engine.py on the Render backend holds the ONE permanent
// Polygon WS connection (Standard/Advanced tiers enforce a strict 1-connection
// limit). Opening a second connection from the browser would trigger an endless
// reconnect war — each side kicks the other off, dropping the live feed entirely.
//
// All live tick data flows through:
//   backend Polygon WS → ws_engine.py cache → SSE broadcaster → useTickerData.js
//
// Callers that previously used connectWebSocket for live prices should instead
// read from the `tickers` Map provided by useTickerData's SSE connection.
// The SSE stream carries tick_batch, snapshot_delta, and snapshot messages
// which already contain all the fields (price, open, high, low, volume, vwap).

export function connectWebSocket(symbols, onPriceUpdate) {
  console.warn(
    "[DataEngine] connectWebSocket() is disabled — direct Polygon WS would conflict " +
    "with ws_engine.py's single backend connection. Use useTickerData SSE instead."
  );
  return null;
}

export function disconnectWebSocket() {
  // No-op — nothing to disconnect.
}

// ── EDGAR event detection ─────────────────────────────────────
const edgarSeenFilings = {};

export async function checkEdgarFilings(symbol) {
  try {
    const data  = await edgarGet(symbol);
    const hits  = data.hits?.hits || [];
    if (!edgarSeenFilings[symbol]) {
      edgarSeenFilings[symbol] = new Set(hits.map(h => h._id));
      return { newFiling:false, total: data.hits?.total?.value || 0 };
    }
    const newHits = hits.filter(h => !edgarSeenFilings[symbol].has(h._id));
    if (newHits.length > 0) {
      newHits.forEach(h => edgarSeenFilings[symbol].add(h._id));
      const filing = newHits[0]._source || {};
      return {
        newFiling:   true,
        filingId:    newHits[0]._id,
        formType:    filing.form_type,
        filedAt:     filing.file_date,
        period:      filing.period_of_report,
        description: filing.entity_name,
        rawFiling:   filing,
      };
    }
    return { newFiling:false, total: data.hits?.total?.value || 0 };
  } catch (e) {
    console.warn("EDGAR check failed:", e.message);
    return { newFiling:false, error:e.message };
  }
}

export async function pollEdgarForWatchlist(symbols) {
  const results = {};
  await Promise.all(symbols.map(async sym => {
    results[sym] = await checkEdgarFilings(sym);
  }));
  return results;
}

// ── News push polling ─────────────────────────────────────────
const newsCache   = {};
const newsPollers = {};

export function startNewsPoll(symbols, onNewsAlert, intervalMs = 120000) {
  const pollerId = `poll_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const seed = async () => {
    await Promise.all(symbols.map(async sym => {
      try {
        const items = await getNews(sym);
        if (items?.length) newsCache[sym] = items[0].headline;
      } catch {}
    }));
  };
  // POLL-OVERLAP-FIX: inflight guard prevents overlapping fetches if a batch
  // takes longer than intervalMs (e.g. backend outage, 429 rate limiting).
  let inflight = false;
  const poll = async () => {
    if (inflight) return;
    inflight = true;
    try {
      await Promise.all(symbols.map(async sym => {
        try {
          const items  = await getNews(sym);
          if (!items?.length) return;
          const latest = items[0];
          const cached = newsCache[sym];
          if (cached && latest.headline !== cached) {
            newsCache[sym] = latest.headline;
            onNewsAlert({ symbol:sym, headline:latest.headline, source:latest.source,
              url:latest.url, published:latest.published,
              sentiment:latest.sentiment, summary:latest.summary, isNew:true });
          }
          if (!cached) newsCache[sym] = latest.headline;
        } catch {}
      }));
    } finally {
      inflight = false;
    }
  };
  seed().then(() => { newsPollers[pollerId] = setInterval(poll, intervalMs); });
  return pollerId;
}

export function stopNewsPoll(pollerId) {
  if (newsPollers[pollerId]) { clearInterval(newsPollers[pollerId]); delete newsPollers[pollerId]; }
}

export function stopAllNewsPolls() {
  Object.keys(newsPollers).forEach(id => { clearInterval(newsPollers[id]); delete newsPollers[id]; });
}

const DataEngine = {
  getSnapshot, getTechnicals, getSupportResistance, getOptions,
  getNews, getEarningsEstimate, getFundamentals, getFullStockData,
  connectWebSocket, disconnectWebSocket,
  checkEdgarFilings, pollEdgarForWatchlist,
  startNewsPoll, stopNewsPoll, stopAllNewsPolls,
};
export default DataEngine;
