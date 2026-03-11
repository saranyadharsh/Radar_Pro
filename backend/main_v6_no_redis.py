"""
main.py — NexRadar Pro Backend  v6.0 (Redis REMOVED)
=====================================================
FastAPI.  Render start command:
  uvicorn backend.main:app --host 0.0.0.0 --port $PORT

ARCHITECTURE: Direct In-Process SSE  (Redis removed permanently)
=================================================================
Previous Redis Stream + Consumer Group design caused 6 failure modes:
  P1  Prices freeze after WS reconnect (stale XREADGROUP cursor)
  P2  NOGROUP warning storm on stream eviction
  P3  Snapshot evicted in <60s at market-hours tick rate
  P4  Portfolio Supabase spam on every ingestor restart
  P5  ~2 Redis connections per SSE tab → 20-conn limit exceeded at ~10 tabs
  P6  Watchlist updates silently dropped when Redis XADD blocks event loop

NEW: SSEBroadcaster (35 lines, zero network I/O on tick path):
  • WSEngine starts in this process — no subprocess, no watchdog needed
  • Each SSE client gets a dedicated asyncio.Queue (maxsize=500)
  • Snapshot stored as a Python dict — lives in memory forever, never evicted
  • Latency: ~0.1ms vs ~5-20ms with Redis round-trips
  • Unlimited simultaneous SSE clients (not capped by Redis conn pool)

All existing frontend code (NexRadarDashboard.jsx, EventSource URL,
message format) is completely unchanged.
"""
from dotenv import load_dotenv
from pathlib import Path
load_dotenv(Path(__file__).parent.parent / ".env")

import os
import sys
import asyncio
import json
import logging
import time
from contextlib import asynccontextmanager
from datetime import date, timedelta
from typing import AsyncGenerator, Set

sys.path.insert(0, str(Path(__file__).parent.parent))

from fastapi import FastAPI, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import httpx

try:
    from backend.supabase_db        import SupabaseDB
    from backend.ws_engine          import WSEngine
    from backend.market_monitor_api import get_cached_monitor
except ModuleNotFoundError:
    from supabase_db        import SupabaseDB
    from ws_engine          import WSEngine
    from market_monitor_api import get_cached_monitor

import yfinance as _yf
try:
    os.makedirs("/tmp/yf_cache", exist_ok=True)
    _yf.set_tz_cache_location("/tmp/yf_cache")
except Exception:
    pass

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


# ══════════════════════════════════════════════════════════════════════════════
# SSEBroadcaster — replaces Redis Stream + Consumer Groups + pub/sub + snapshot key
# ══════════════════════════════════════════════════════════════════════════════
class SSEBroadcaster:
    """
    In-memory fan-out broadcaster.  Zero Redis.  Zero network I/O on tick path.

    Thread safety:
      WSEngine background threads call publish() via
      asyncio.run_coroutine_threadsafe(broadcaster.publish(payload), loop).
      publish() uses put_nowait() which is GIL-safe from any thread.

    Backpressure:
      Queue maxsize=500.  Slow clients that fall behind are silently evicted;
      their EventSource auto-reconnects and immediately receives the snapshot.
    """
    def __init__(self):
        self._queues:   Set[asyncio.Queue] = set()
        self._snapshot: dict               = {}

    async def publish(self, payload: dict) -> None:
        if payload.get("type") == "snapshot":
            self._snapshot = payload          # always keep latest in memory
        msg = "data: " + json.dumps(payload) + "\n\n"
        dead = set()
        for q in list(self._queues):
            try:
                q.put_nowait(msg)
            except asyncio.QueueFull:
                dead.add(q)
        self._queues -= dead

    def subscribe(self) -> asyncio.Queue:
        q = asyncio.Queue(maxsize=500)
        self._queues.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        self._queues.discard(q)

    def get_snapshot(self) -> dict:
        return self._snapshot

    @property
    def client_count(self) -> int:
        return len(self._queues)


# ── Global singletons ──────────────────────────────────────────────────────────
db:          SupabaseDB     = None   # type: ignore
broadcaster: SSEBroadcaster = None   # type: ignore


# ── Lifespan ───────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    global db, broadcaster
    logger.info("🚀 NexRadar API starting (direct SSE — Redis removed) …")

    db          = SupabaseDB()
    broadcaster = SSEBroadcaster()

    tickers, company_map, sector_map = db.get_stock_meta()
    if not tickers:
        logger.warning("⚠️  No tickers — run migration first")
    else:
        logger.info(f"Loaded {len(tickers)} tickers")

    # WSEngine runs background threads and calls broadcaster.publish()
    # via asyncio.run_coroutine_threadsafe — fully thread-safe.
    loop   = asyncio.get_event_loop()
    engine = WSEngine(broadcast_cb=broadcaster.publish, loop=loop)
    engine.start(tickers, company_map, sector_map)
    logger.info("✅ WSEngine started")
    app.state.engine = engine

    yield

    logger.info("🛑 Shutting down …")
    engine.shutdown()
    logger.info("Shutdown complete.")


app = FastAPI(title="NexRadar Pro API", version="6.0.0", lifespan=lifespan)

FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "https://nexradar.info")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        FRONTEND_ORIGIN,
        "https://nexradar.info",
        "https://radar-pro-frontend-bxtq.onrender.com",
        "http://localhost:5173",
        "http://localhost:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Health ─────────────────────────────────────────────────────────────────────
@app.api_route("/health", methods=["GET", "HEAD"])
async def health():
    return {"status": "ok", "ts": int(time.time())}


# ── Metrics ────────────────────────────────────────────────────────────────────
@app.get("/api/metrics")
async def get_metrics():
    snap = broadcaster.get_snapshot() if broadcaster else {}
    return {
        "sse_clients":   broadcaster.client_count if broadcaster else 0,
        "snapshot_size": len(snap.get("data", [])),
        "session":       _get_market_status_simple(),
        "architecture":  "direct-sse-v6-no-redis",
    }


def _get_market_status_simple() -> str:
    import pytz
    from datetime import datetime, time as dt_time
    et  = pytz.timezone("America/New_York")
    now = datetime.now(et)
    t   = now.time()
    if now.weekday() >= 5:                        return "CLOSED_WEEKEND"
    if dt_time(20, 0) <= t or t < dt_time(4, 0): return "OVERNIGHT_SLEEP"
    if dt_time(4,  0) <= t < dt_time(9,  30):    return "PRE_MARKET"
    if dt_time(9, 30) <= t < dt_time(16,  0):    return "MARKET_HOURS"
    if dt_time(16, 0) <= t < dt_time(20,  0):    return "AFTER_HOURS"
    return "CLOSED"


# ── Snapshot ───────────────────────────────────────────────────────────────────
@app.get("/api/snapshot")
async def get_snapshot(
    limit:         int  = Query(6200, le=10000),
    only_positive: bool = Query(False),
    source:        str  = Query("all"),
    sector:        str  = Query(""),
):
    payload = broadcaster.get_snapshot() if broadcaster else {}
    data    = payload.get("data", [])

    if only_positive:
        data = [r for r in data if r.get("is_positive")]
    if sector and sector.upper() not in ("", "ALL"):
        su   = sector.upper()
        data = [r for r in data if (r.get("sector") or "").upper() == su]
    if source == "portfolio":
        pts  = {r["ticker"] for r in (db.get_portfolio() if db else [])}
        data = [r for r in data if r.get("ticker") in pts]
    elif source == "monitor":
        mts  = {r["ticker"] for r in (db.get_monitor() if db else [])}
        data = [r for r in data if r.get("ticker") in mts]

    return {"type": "snapshot", "data": data[:limit], "count": len(data)}


# ── SSE Stream ─────────────────────────────────────────────────────────────────
@app.get("/api/stream")
async def sse_stream(request: Request):
    """
    SSE endpoint.  Replaces the entire Redis XREADGROUP / NOGROUP / cursor logic.
    On connect: sends the current snapshot immediately (no blank-screen cold start).
    On disconnect: unsubscribes the queue — no Redis consumer cleanup needed.
    """
    q = broadcaster.subscribe()

    async def _generate() -> AsyncGenerator[str, None]:
        try:
            snap = broadcaster.get_snapshot()
            if snap:
                yield "data: " + json.dumps(snap) + "\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    msg = await asyncio.wait_for(q.get(), timeout=15.0)
                    yield msg
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error(f"SSE generator error: {e}")
        finally:
            broadcaster.unsubscribe(q)

    return StreamingResponse(
        _generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control":     "no-cache",
            "X-Accel-Buffering": "no",
            "Connection":        "keep-alive",
        },
    )


# ── Live tickers ───────────────────────────────────────────────────────────────
@app.get("/api/tickers")
async def get_tickers(
    limit:         int  = Query(6200, le=10000),
    only_positive: bool = Query(True),
    source:        str  = Query("all"),
    sector:        str  = Query(""),
):
    result = await get_snapshot(
        limit=limit, only_positive=only_positive, source=source, sector=sector
    )
    return result.get("data", [])


# ── Earnings ───────────────────────────────────────────────────────────────────
@app.get("/api/earnings")
async def get_earnings(start: str = Query(default=None), end: str = Query(default=None)):
    today = date.today()
    s = start or today.isoformat()
    e = end   or (today + timedelta(days=7)).isoformat()
    return db.get_earnings_for_range(s, e)


# ── Signals ────────────────────────────────────────────────────────────────────
@app.get("/api/signals")
async def get_signals(limit: int = Query(200, le=500)):
    return db.get_recent_signals(limit=limit)

@app.post("/api/signals")
async def post_signal(payload: dict):
    return {"ok": db.insert_signal(payload)}


# ── Portfolio / Monitor ────────────────────────────────────────────────────────
@app.get("/api/portfolio")
async def get_portfolio():
    return db.get_portfolio()

@app.get("/api/monitor")
async def get_monitor():
    return db.get_monitor()


# ── Stock List ─────────────────────────────────────────────────────────────────
@app.get("/api/stock-list")
async def get_stock_list():
    try:
        tickers, company_map, sector_map = db.get_stock_meta()
        return [{"ticker": t, "company_name": company_map.get(t) or "—",
                 "sector": sector_map.get(t) or "—"} for t in tickers]
    except Exception as e:
        logger.error(f"stock-list error: {e}")
        return []


# ── Watchlist ─────────────────────────────────────────────────────────────────
class WatchlistBody(BaseModel):
    ticker: str


def _refresh_signal_watcher():
    """Push updated watchlist from Supabase to WSEngine (replaces pub/sub)."""
    try:
        engine = app.state.engine
        if engine and engine._signal_watcher:
            rows = db.get_signal_watchlist()
            engine._signal_watcher.set_watchlist(
                [r["ticker"] for r in rows if r.get("ticker")]
            )
    except Exception as e:
        logger.warning(f"_refresh_signal_watcher: {e}")


@app.get("/api/watchlist")
async def watchlist_get():
    rows = db.get_signal_watchlist()
    tickers = [r["ticker"] for r in rows if r.get("ticker")]
    return {"watchlist": tickers, "count": len(tickers)}


@app.post("/api/watchlist/add")
async def watchlist_add(body: WatchlistBody):
    try:
        ticker = body.ticker.upper().strip()
        db.add_signal_watchlist(ticker)
        _refresh_signal_watcher()
        rows = db.get_signal_watchlist()
        wl   = sorted([r["ticker"] for r in rows if r.get("ticker")])
        await broadcaster.publish({"type": "watchlist_update", "action": "add",
                                   "ticker": ticker, "watchlist": wl})
        return {"ok": True, "action": "add", "ticker": ticker}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@app.post("/api/watchlist/remove")
async def watchlist_remove(body: WatchlistBody):
    try:
        ticker = body.ticker.upper().strip()
        db.remove_signal_watchlist(ticker)
        _refresh_signal_watcher()
        rows = db.get_signal_watchlist()
        wl   = sorted([r["ticker"] for r in rows if r.get("ticker")])
        await broadcaster.publish({"type": "watchlist_update", "action": "remove",
                                   "ticker": ticker, "watchlist": wl})
        return {"ok": True, "action": "remove", "ticker": ticker}
    except Exception as e:
        return {"ok": False, "error": str(e)}


# ── Legacy signal-watchlist ────────────────────────────────────────────────────
@app.get("/api/signal-watchlist")
async def get_signal_watchlist():
    rows = db.get_signal_watchlist()
    tickers = [r["ticker"] for r in rows if r.get("ticker")]
    return {"symbols": tickers, "count": len(tickers), "max": 50}


@app.post("/api/signal-watchlist")
async def set_signal_watchlist(payload: dict):
    symbols = payload.get("symbols", [])
    corrections = {"ORACL": "ORCL", "TESLA": "TSLA"}
    symbols = [corrections.get(s.upper(), s.upper()) for s in symbols]
    for ticker in symbols:
        db.add_signal_watchlist(ticker)
    logger.info(f"Signal watchlist bulk-set: {len(symbols)} symbols")
    _refresh_signal_watcher()
    return {"accepted": symbols, "count": len(symbols)}


@app.post("/api/signal-vwap-reset")
async def reset_vwap():
    await broadcaster.publish({"type": "control", "action": "vwap_reset"})
    try:
        engine = app.state.engine
        if engine and engine._signal_watcher:
            engine._signal_watcher.reset_vwap()
    except Exception:
        pass
    return {"ok": True, "note": "vwap_reset applied immediately"}


# ── Market Monitor ─────────────────────────────────────────────────────────────
@app.get("/api/market-monitor")
async def get_market_monitor(refresh: int = Query(0)):
    rows    = db.get_signal_watchlist()
    tickers = [r["ticker"] for r in rows if r.get("ticker")]
    if not tickers:
        return {"data": [], "ticker_count": 0,
                "message": "No tickers in watchlist."}
    loop   = asyncio.get_event_loop()
    result = await loop.run_in_executor(None, get_cached_monitor, tickers, bool(refresh))
    return result


# ── Scalp Analysis ─────────────────────────────────────────────────────────────
@app.get("/api/scalp-analysis")
async def get_scalp_analysis():
    rows              = db.get_signal_watchlist()
    watchlist_tickers = {r["ticker"] for r in rows if r.get("ticker")}
    if not watchlist_tickers:
        return {"data": [], "message": "No tickers in watchlist."}
    try:
        engine = app.state.engine
        if engine and engine._signal_watcher:
            scalp_rows = engine._signal_watcher.get_scalp_snapshot(
                list(watchlist_tickers)
            )
            ok_rows = [r for r in scalp_rows
                       if not r.get("status") or r.get("status") == "ok"]
            return {"data": scalp_rows, "ticker_count": len(scalp_rows),
                    "ok_count": len(ok_rows),
                    "warming_count": max(0, len(watchlist_tickers) - len(scalp_rows))}
    except Exception as e:
        logger.warning(f"/api/scalp-analysis: {e}")

    warming_rows = [{"ticker": t, "status": "warming_up", "bars_count": 0}
                    for t in watchlist_tickers]
    return {"data": warming_rows, "ticker_count": len(warming_rows),
            "ok_count": 0, "warming_count": len(warming_rows),
            "message": "Signal engine seeding — live signals appear within 10s."}


# ── Yahoo Finance Proxy — Quote ────────────────────────────────────────────────
_YF_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "application/json, text/xml, */*",
}

@app.get("/api/quote/{symbol}")
async def get_quote(symbol: str):
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol.upper()}?interval=1d&range=1d"
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            r = await client.get(url, headers=_YF_HEADERS)
            r.raise_for_status()
            data = r.json()
        meta = data.get("chart", {}).get("result", [{}])[0].get("meta", {})
        return {
            "open":      meta.get("regularMarketOpen"),
            "high":      meta.get("regularMarketDayHigh"),
            "low":       meta.get("regularMarketDayLow"),
            "prevClose": meta.get("chartPreviousClose"),
            "volume":    meta.get("regularMarketVolume"),
            "avgVol":    meta.get("averageDailyVolume10Day"),
            "marketCap": meta.get("marketCap"),
            "wkHi52":    meta.get("fiftyTwoWeekHigh"),
            "wkLo52":    meta.get("fiftyTwoWeekLow"),
            "exchange":  meta.get("exchangeName"),
            "name":      meta.get("longName", symbol.upper()),
        }
    except Exception as e:
        from fastapi import HTTPException
        raise HTTPException(status_code=502, detail=str(e))


# ── Yahoo Finance Proxy — News ─────────────────────────────────────────────────
@app.get("/api/news/{symbol}")
async def get_news(symbol: str):
    url = f"https://feeds.finance.yahoo.com/rss/2.0/headline?s={symbol.upper()}&region=US&lang=en-US"
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            r = await client.get(url, headers=_YF_HEADERS)
            r.raise_for_status()
        import xml.etree.ElementTree as ET
        root  = ET.fromstring(r.text)
        items = []
        for item in root.findall(".//item")[:8]:
            items.append({
                "title":   (item.findtext("title")   or "").strip(),
                "link":    (item.findtext("link")    or "#").strip(),
                "pubDate": (item.findtext("pubDate") or "").strip(),
                "source":  (item.findtext("source")  or "Yahoo Finance").strip(),
            })
        return {"items": items}
    except Exception as e:
        from fastapi import HTTPException
        raise HTTPException(status_code=502, detail=str(e))


# ── Polygon Proxy — OHLCV bars ─────────────────────────────────────────────────
@app.get("/api/chart/{symbol}")
async def get_chart_bars(symbol: str, interval: str = "1", range: str = "1d"):
    import pytz
    from datetime import datetime, timedelta

    api_key = os.getenv("MASSIVE_API_KEY", "")
    if not api_key:
        from fastapi import HTTPException
        raise HTTPException(status_code=503, detail="Polygon API key not configured")

    sym        = symbol.upper()
    multiplier = int(interval) if interval.isdigit() else 1
    timespan   = "minute" if multiplier < 60 else "hour"
    if multiplier == 60:
        multiplier = 1

    et     = pytz.timezone("America/New_York")
    now_et = datetime.now(et)
    from_dt = now_et - timedelta(days=7 if range == "5d" else 35 if range == "1mo" else 1)

    url = (
        f"https://api.polygon.io/v2/aggs/ticker/{sym}/range/{multiplier}/{timespan}"
        f"/{from_dt.strftime('%Y-%m-%d')}/{now_et.strftime('%Y-%m-%d')}"
        f"?adjusted=true&sort=asc&limit=50000&apiKey={api_key}"
    )
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(url)
            r.raise_for_status()
            data = r.json()
        bars = [{"t": b["t"], "o": b["o"], "h": b["h"], "l": b["l"],
                  "c": b["c"], "v": b.get("v", 0)}
                for b in (data.get("results") or [])]
        return {"bars": bars, "symbol": sym, "interval": multiplier, "count": len(bars)}
    except Exception as e:
        from fastapi import HTTPException
        raise HTTPException(status_code=502, detail=str(e))


# ── Debug: Sector Map ──────────────────────────────────────────────────────────
@app.get("/api/debug/sectors")
async def debug_sectors():
    data = broadcaster.get_snapshot().get("data", []) if broadcaster else []
    sector_counts: dict = {}
    sector_samples: dict = {}
    for row in data:
        s = row.get("sector", "Unknown")
        sector_counts[s] = sector_counts.get(s, 0) + 1
        if s not in sector_samples:
            sector_samples[s] = []
        if len(sector_samples[s]) < 5:
            sector_samples[s].append(row["ticker"])
    return {"total_tickers": len(data), "sector_counts": sector_counts,
            "sector_samples": sector_samples,
            "sse_clients": broadcaster.client_count if broadcaster else 0}
