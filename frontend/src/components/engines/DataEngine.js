// ═══════════════════════════════════════════════════════════════
// DataEngine.js — Layer 1: FREE · AUTO · ALWAYS ON
// Sources: Polygon.io Professional + EDGAR (SEC)
// No Claude. No AI. No cost per call.
// Runs independently — works even if AIEngine is down
//
// PRODUCTION INTEGRATION NOTES:
//   - Place at: src/components/engines/DataEngine.js
//   - Requires env var: VITE_POLYGON_API_KEY
//   - Add to frontend Render env vars alongside VITE_API_BASE
// ═══════════════════════════════════════════════════════════════

const POLYGON_KEY = import.meta.env.VITE_POLYGON_API_KEY || "";
// Backend API base — used for stock-data proxy (no frontend Polygon key needed)
const API_BASE = import.meta.env.VITE_API_BASE || "";
const POLYGON_BASE = "https://api.polygon.io";
const EDGAR_BASE   = "https://efts.sec.gov/LATEST/search-index";

async function polyGet(path, params = {}) {
  const url = new URL(POLYGON_BASE + path);
  url.searchParams.set("apiKey", POLYGON_KEY);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Polygon ${res.status}: ${path}`);
  return res.json();
}

const edgarCache = {};

async function edgarGet(symbol) {
  const today = new Date().toISOString().slice(0, 10);
  const url = `${EDGAR_BASE}?q=%22${symbol}%22&forms=8-K&dateRange=custom&startdt=${today}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`EDGAR ${res.status}`);
  return res.json();
}

export async function getSnapshot(symbol) {
  try {
    const data = await polyGet(`/v2/snapshot/locale/us/markets/stocks/tickers/${symbol}`);
    const t = data.ticker || {};
    const d = t.day || {};
    const prev = t.prevDay || {};
    return {
      symbol,
      price:     t.lastTrade?.p || d.c || 0,
      open:      d.o || 0,
      high:      d.h || 0,
      low:       d.l || 0,
      close:     d.c || 0,
      volume:    d.v || 0,
      vwap:      d.vw || 0,
      prevClose: prev.c || 0,
      change:    t.todaysChange || 0,
      changePct: t.todaysChangePerc || 0,
      avgVolume: prev.v || 0,
    };
  } catch (e) {
    console.warn("getSnapshot failed:", e.message);
    return null;
  }
}

export async function getTechnicals(symbol) {
  try {
    const [rsi, macd, sma20, sma50, sma200, ema9] = await Promise.all([
      polyGet(`/v1/indicators/rsi/${symbol}`,  { timespan:"day", window:14,  series_type:"close", limit:1 }),
      polyGet(`/v1/indicators/macd/${symbol}`, { timespan:"day", short_window:12, long_window:26, signal_window:9, series_type:"close", limit:1 }),
      polyGet(`/v1/indicators/sma/${symbol}`,  { timespan:"day", window:20,  series_type:"close", limit:1 }),
      polyGet(`/v1/indicators/sma/${symbol}`,  { timespan:"day", window:50,  series_type:"close", limit:1 }),
      polyGet(`/v1/indicators/sma/${symbol}`,  { timespan:"day", window:200, series_type:"close", limit:1 }),
      polyGet(`/v1/indicators/ema/${symbol}`,  { timespan:"day", window:9,   series_type:"close", limit:1 }),
    ]);
    return {
      rsi14:      rsi?.results?.values?.[0]?.value,
      macd:       macd?.results?.values?.[0]?.value,
      macdSignal: macd?.results?.values?.[0]?.signal,
      macdHist:   macd?.results?.values?.[0]?.histogram,
      sma20:      sma20?.results?.values?.[0]?.value,
      sma50:      sma50?.results?.values?.[0]?.value,
      sma200:     sma200?.results?.values?.[0]?.value,
      ema9:       ema9?.results?.values?.[0]?.value,
    };
  } catch (e) {
    console.warn("getTechnicals failed:", e.message);
    return {};
  }
}

export async function getSupportResistance(symbol) {
  try {
    const to   = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
    const data = await polyGet(`/v2/aggs/ticker/${symbol}/range/1/day/${from}/${to}`,
      { adjusted:"true", sort:"asc", limit:90 });
    const bars = data.results || [];
    if (!bars.length) return { support:null, resistance:null };
    const highs = bars.map(b => b.h).sort((a, b) => b - a);
    const lows  = bars.map(b => b.l).sort((a, b) => a - b);
    const resistance = highs.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
    const support    = lows.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
    const atrs = bars.slice(-14).map((b, i, arr) => {
      if (i === 0) return b.h - b.l;
      const prev = arr[i - 1];
      return Math.max(b.h - b.l, Math.abs(b.h - prev.c), Math.abs(b.l - prev.c));
    });
    const atr = atrs.reduce((a, b) => a + b, 0) / atrs.length;
    return {
      support:    Math.round(support * 100) / 100,
      resistance: Math.round(resistance * 100) / 100,
      atr:        Math.round(atr * 100) / 100,
      bars,
    };
  } catch (e) {
    console.warn("getSupportResistance failed:", e.message);
    return { support:null, resistance:null, atr:null, bars:[] };
  }
}

export async function getOptions(symbol) {
  try {
    const data = await polyGet(`/v3/snapshot/options/${symbol}`, { limit:50 });
    const results = data.results || [];
    const snap  = await getSnapshot(symbol);
    const price = snap?.price || 0;
    const atm   = results.filter(o => {
      const strike = o.details?.strike_price || 0;
      return Math.abs(strike - price) / price < 0.05;
    });
    const avgIV = atm.length
      ? atm.reduce((a, b) => a + (b.greeks?.implied_volatility || 0), 0) / atm.length
      : 0;
    const impliedMove    = avgIV * Math.sqrt(1 / 365) * price;
    const impliedMovePct = price > 0 ? (impliedMove / price) * 100 : 0;
    return {
      impliedMovePct:   Math.round(impliedMovePct * 100) / 100,
      impliedMoveDollar: Math.round(impliedMove * 100) / 100,
      avgIV:            Math.round(avgIV * 10000) / 100,
      optionCount:      results.length,
      raw:              results.slice(0, 10),
    };
  } catch (e) {
    console.warn("getOptions failed:", e.message);
    return { impliedMovePct:null, avgIV:null };
  }
}

export async function getNews(symbol) {
  try {
    const data = await polyGet(`/v2/reference/news`,
      { ticker:symbol, limit:5, order:"desc", sort:"published_utc" });
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
  try {
    const data = await polyGet(`/v1/meta/symbols/${symbol}/earnings`, { limit:8 });
    return (data.results || []).map(e => ({
      quarter:       e.quarter,
      year:          e.year,
      epsEst:        e.eps?.estimate,
      epsActual:     e.eps?.actual,
      epsSurprise:   e.eps?.surprise,
      surprisePct:   e.eps?.surprisePercent,
      revenueEst:    e.revenue?.estimate,
      revenueActual: e.revenue?.actual,
    }));
  } catch (e) {
    console.warn("getEarningsEstimate failed:", e.message);
    return [];
  }
}

export async function getFundamentals(symbol) {
  try {
    const [details, financials] = await Promise.all([
      polyGet(`/v3/reference/tickers/${symbol}`),
      polyGet(`/vX/reference/financials`, {
        ticker:symbol, limit:1, sort:"period_of_report_date", order:"desc"
      }),
    ]);
    const d  = details.results || {};
    const f  = financials.results?.[0]?.financials || {};
    const is = f.income_statement || {};
    const bs = f.balance_sheet || {};
    return {
      companyName:      d.name,
      description:      d.description,
      sector:           d.sic_description,
      marketCap:        d.market_cap,
      employees:        d.total_employees,
      homepage:         d.homepage_url,
      revenue:          is.revenues?.value,
      netIncome:        is.net_income_loss?.value,
      eps:              is.basic_earnings_per_share?.value,
      totalAssets:      bs.assets?.value,
      totalLiabilities: bs.liabilities?.value,
    };
  } catch (e) {
    console.warn("getFundamentals failed:", e.message);
    return {};
  }
}

export async function getFullStockData(symbol) {
  // PRIMARY: use backend proxy /api/stock-data/{symbol}
  // - Polygon key stays on server (no VITE_POLYGON_API_KEY needed)
  // - Results cached 5min in stock_data_cache table
  // - All 7 Polygon calls run in parallel server-side (~300ms)
  try {
    const res = await fetch(`${API_BASE}/api/stock-data/${symbol.toUpperCase()}`);
    if (res.ok) {
      const data = await res.json();
      return { ...data, bars: data.bars || [] };
    }
  } catch (e) {
    console.warn("getFullStockData backend proxy failed, falling back:", e.message);
  }

  // FALLBACK: direct Polygon calls if backend proxy unavailable
  const [snapshot, technicals, levels, options, news, earnings, fundamentals] = await Promise.all([
    getSnapshot(symbol),
    getTechnicals(symbol),
    getSupportResistance(symbol),
    getOptions(symbol),
    getNews(symbol),
    getEarningsEstimate(symbol),
    getFundamentals(symbol),
  ]);
  return {
    symbol,
    price:           snapshot?.price,
    change:          snapshot?.change,
    changePct:       snapshot?.changePct,
    open:            snapshot?.open,
    high:            snapshot?.high,
    low:             snapshot?.low,
    close:           snapshot?.close,
    volume:          snapshot?.volume,
    vwap:            snapshot?.vwap,
    avgVolume:       snapshot?.avgVolume,
    prevClose:       snapshot?.prevClose,
    rsi14:           technicals?.rsi14,
    macd:            technicals?.macd,
    macdSignal:      technicals?.macdSignal,
    macdHist:        technicals?.macdHist,
    sma20:           technicals?.sma20,
    sma50:           technicals?.sma50,
    sma200:          technicals?.sma200,
    ema9:            technicals?.ema9,
    support:         levels?.support,
    resistance:      levels?.resistance,
    atr:             levels?.atr,
    bars:            levels?.bars || [],
    impliedMovePct:  options?.impliedMovePct,
    avgIV:           options?.avgIV,
    news:            news || [],
    earningsHistory: earnings || [],
    companyName:     fundamentals?.companyName,
    description:     fundamentals?.description,
    sector:          fundamentals?.sector,
    marketCap:       fundamentals?.marketCap,
    employees:       fundamentals?.employees,
    revenue:         fundamentals?.revenue,
    netIncome:       fundamentals?.netIncome,
    eps:             fundamentals?.eps,
  };
}

// ── WebSocket live price push ─────────────────────────────────
let wsInstance  = null;
const wsCallbacks = new Map();

export function connectWebSocket(symbols, onPriceUpdate) {
  symbols.forEach(sym => {
    if (!wsCallbacks.has(sym)) wsCallbacks.set(sym, []);
    wsCallbacks.get(sym).push(onPriceUpdate);
  });
  if (wsInstance && wsInstance.readyState === WebSocket.OPEN) {
    wsInstance.send(JSON.stringify({
      action:"subscribe",
      params: symbols.map(s => `A.${s}`).join(","),
    }));
    return wsInstance;
  }
  wsInstance = new WebSocket("wss://socket.polygon.io/stocks");
  wsInstance.onopen = () => {
    wsInstance.send(JSON.stringify({ action:"auth", params:POLYGON_KEY }));
  };
  wsInstance.onmessage = (event) => {
    const messages = JSON.parse(event.data);
    messages.forEach(msg => {
      if (msg.ev === "auth_success") {
        wsInstance.send(JSON.stringify({
          action:"subscribe",
          params:[...wsCallbacks.keys()].map(s => `A.${s}`).join(","),
        }));
      }
      if (msg.ev === "A") {
        const update = { symbol:msg.sym, price:msg.c, open:msg.o,
          high:msg.h, low:msg.l, volume:msg.av, vwap:msg.vw, timestamp:msg.e };
        wsCallbacks.get(msg.sym)?.forEach(cb => cb(update));
      }
    });
  };
  wsInstance.onerror  = (e) => console.warn("DataEngine WS error:", e);
  wsInstance.onclose  = () => {
    setTimeout(() => {
      if (wsCallbacks.size > 0) connectWebSocket([...wsCallbacks.keys()], onPriceUpdate);
    }, 3000);
  };
  return wsInstance;
}

export function disconnectWebSocket() {
  wsCallbacks.clear();
  wsInstance?.close();
  wsInstance = null;
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
  const poll = async () => {
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
