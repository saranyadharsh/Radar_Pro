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

from fastapi import FastAPI, HTTPException, Query, Request  # BUG-01 FIX: HTTPException at module level
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

    Memory:
      _snapshot holds the latest snapshot dict only — replaced on every snapshot
      broadcast, so it never grows.  The snapshot data list itself is bounded by
      LIVE_DISPLAY_CAP in supabase_db (6200 rows × ~500 bytes ≈ 3 MB max).
      Dead queues are removed atomically inside publish() so _queues never
      accumulates stale entries from disconnected clients.
    """
    def __init__(self):
        self._queues:   Set[asyncio.Queue] = set()
        self._snapshot: dict               = {}

    async def publish(self, payload: dict) -> None:
        if payload.get("type") == "snapshot":
            self._snapshot = payload          # replace — never accumulates
        msg = "data: " + json.dumps(payload) + "\n\n"
        dead = set()
        for q in list(self._queues):
            try:
                q.put_nowait(msg)
            except asyncio.QueueFull:
                dead.add(q)
        # Evicted queues: send poison pill so the generator breaks out immediately
        # instead of waiting for the 15s keepalive timeout to notice data stopped.
        # The frontend's EventSource will auto-reconnect and get a fresh snapshot.
        if dead:
            for q in dead:
                try:
                    while not q.empty():   # drain first so put_nowait has room
                        q.get_nowait()
                    q.put_nowait("DISCONNECT")
                except Exception:
                    pass
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

    # Feature #1 — Smart Alerts Engine
    try:
        from backend.Scalping_Signal import SmartAlertsEngine
    except ModuleNotFoundError:
        from Scalping_Signal import SmartAlertsEngine
    _ae = SmartAlertsEngine(engine=engine._signal_watcher, broadcast_cb=broadcaster.publish, loop=loop)  # BUG-02 FIX: pass loop
    try:
        _ae_rows = db.get_signal_watchlist()
        _ae.set_watchlist([r["ticker"] for r in _ae_rows if r.get("ticker")])
    except Exception:
        pass
    _ae.start()
    app.state.alerts_engine = _ae
    logger.info("✅ SmartAlertsEngine started")

    yield

    logger.info("🛑 Shutting down …")
    # BUG-03 FIX: Stop SmartAlertsEngine BEFORE WSEngine so poll thread
    # doesn't access signal_watcher after it's torn down.
    try:
        app.state.alerts_engine.stop()
        logger.info("SmartAlertsEngine stopped.")
    except Exception:
        pass
    engine.shutdown()
    logger.info("Shutdown complete.")


app = FastAPI(title="NexRadar Pro API", version="6.0.0", lifespan=lifespan)

FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "https://nexradar.info").rstrip("/")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        FRONTEND_ORIGIN,
        "https://nexradar.info",
        "https://www.nexradar.info",
        "https://radar-pro-frontend-zgy9.onrender.com",
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

    # Ensure every row has the "open" alias the frontend MH table reads
    for row in data:
        if "open" not in row or not row["open"]:
            row["open"] = row.get("open_price", 0)
        if "company_name" not in row or not row["company_name"]:
            row["company_name"] = row.get("company", "")

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
    SSE endpoint — zero Redis.

    subscribe() is called INSIDE the generator, not before it.
    This prevents a queue leak in the rare case where StreamingResponse
    raises before the generator coroutine ever runs (e.g. CORS pre-flight
    reuse, early client disconnect during response construction).

    On disconnect: unsubscribe() runs in the generator's finally block.
    On slow client: queue fills to maxsize=500 → put_nowait raises QueueFull
    → broadcaster evicts that queue → client's EventSource auto-reconnects
    and immediately receives the latest snapshot (no data loss for UI).
    """
    async def _generate() -> AsyncGenerator[str, None]:
        q = broadcaster.subscribe()
        try:
            snap = broadcaster.get_snapshot()
            if snap:
                yield "data: " + json.dumps(snap) + "\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    msg = await asyncio.wait_for(q.get(), timeout=15.0)
                    if msg == "DISCONNECT":
                        # Poison pill from broadcaster — queue was evicted (too slow).
                        # Break so EventSource reconnects and gets a fresh snapshot.
                        break
                    yield msg
                except asyncio.TimeoutError:
                    yield 'data: {"type":"keepalive"}\n\n'
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
    # asyncio.to_thread: Supabase client is synchronous (httpx/requests under the hood).
    # Calling it directly in an async route blocks the event loop — all SSE clients
    # stall until the query returns.  to_thread() offloads it to the thread pool.
    return await asyncio.to_thread(db.get_earnings_for_range, s, e)


# ── Signals ────────────────────────────────────────────────────────────────────
@app.get("/api/signals")
async def get_signals(limit: int = Query(200, le=500)):
    return await asyncio.to_thread(db.get_recent_signals, limit)

@app.post("/api/signals")
async def post_signal(payload: dict):
    return {"ok": await asyncio.to_thread(db.insert_signal, payload)}


# ── Portfolio / Monitor ────────────────────────────────────────────────────────
@app.get("/api/portfolio")
async def get_portfolio():
    return await asyncio.to_thread(db.get_portfolio)

@app.get("/api/monitor")
async def get_monitor():
    return await asyncio.to_thread(db.get_monitor)


# ── Stock List ─────────────────────────────────────────────────────────────────
@app.get("/api/stock-list")
async def get_stock_list():
    try:
        tickers, company_map, sector_map = await asyncio.to_thread(db.get_stock_meta)
        return [{"ticker": t, "company_name": company_map.get(t) or "—",
                 "sector": sector_map.get(t) or "—"} for t in tickers]
    except Exception as e:
        logger.error(f"stock-list error: {e}")
        return []


# ── Watchlist ─────────────────────────────────────────────────────────────────
class WatchlistBody(BaseModel):
    ticker: str


async def _refresh_signal_watcher():
    """Push updated watchlist to WSEngine signal watcher + SmartAlertsEngine.
    BUG-06 FIX: Made async; Supabase call offloaded to thread pool via to_thread().
    Was: synchronous db call blocked the event loop for 50-200ms per watchlist edit,
    stalling ALL SSE clients. Now: non-blocking, event loop stays responsive.
    """
    try:
        engine = app.state.engine
        if engine and engine._signal_watcher:
            rows    = await asyncio.to_thread(db.get_signal_watchlist)
            tickers = [r["ticker"] for r in rows if r.get("ticker")]
            engine._signal_watcher.set_watchlist(tickers)
            # Keep AH close refresh scoped to watchlist (BUG-07 companion fix)
            try:
                engine.set_watchlist_tickers(tickers)
            except AttributeError:
                pass
            # Also sync alerts engine
            try:
                app.state.alerts_engine.set_watchlist(tickers)
            except AttributeError:
                pass
    except Exception as e:
        logger.warning(f"_refresh_signal_watcher: {e}")


@app.get("/api/watchlist")
async def watchlist_get():
    rows = await asyncio.to_thread(db.get_signal_watchlist)
    tickers = [r["ticker"] for r in rows if r.get("ticker")]
    return {"watchlist": tickers, "count": len(tickers)}


@app.post("/api/watchlist/add")
async def watchlist_add(body: WatchlistBody):
    try:
        ticker = body.ticker.upper().strip()
        await asyncio.to_thread(db.add_signal_watchlist, ticker)
        await _refresh_signal_watcher()  # BUG-06 FIX: await async version
        rows = await asyncio.to_thread(db.get_signal_watchlist)
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
        await asyncio.to_thread(db.remove_signal_watchlist, ticker)
        await _refresh_signal_watcher()  # BUG-06 FIX: await async version
        rows = await asyncio.to_thread(db.get_signal_watchlist)
        wl   = sorted([r["ticker"] for r in rows if r.get("ticker")])
        await broadcaster.publish({"type": "watchlist_update", "action": "remove",
                                   "ticker": ticker, "watchlist": wl})
        return {"ok": True, "action": "remove", "ticker": ticker}
    except Exception as e:
        return {"ok": False, "error": str(e)}


# ── Legacy signal-watchlist ────────────────────────────────────────────────────
@app.get("/api/signal-watchlist")
async def get_signal_watchlist():
    rows = await asyncio.to_thread(db.get_signal_watchlist)
    tickers = [r["ticker"] for r in rows if r.get("ticker")]
    return {"symbols": tickers, "count": len(tickers), "max": 50}


@app.post("/api/signal-watchlist")
async def set_signal_watchlist(payload: dict):
    symbols = payload.get("symbols", [])
    corrections = {"ORACL": "ORCL", "TESLA": "TSLA"}
    symbols = [corrections.get(s.upper(), s.upper()) for s in symbols]
    for ticker in symbols:
        await asyncio.to_thread(db.add_signal_watchlist, ticker)
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
    rows    = await asyncio.to_thread(db.get_signal_watchlist)
    tickers = [r["ticker"] for r in rows if r.get("ticker")]
    if not tickers:
        return {"data": [], "ticker_count": 0,
                "message": "No tickers in watchlist."}
    # run_in_executor is equivalent to asyncio.to_thread for sync callables.
    # get_cached_monitor internally uses a ThreadPoolExecutor (20 workers) to
    # fetch yfinance data for all watchlist tickers concurrently, so the total
    # wall time is ~2-3s for 50 tickers instead of the ~25s sequential baseline.
    result = await asyncio.to_thread(get_cached_monitor, tickers, bool(refresh))
    return result


# ── Scalp Analysis ─────────────────────────────────────────────────────────────
@app.get("/api/scalp-analysis")
async def get_scalp_analysis():
    rows              = await asyncio.to_thread(db.get_signal_watchlist)  # BUG-06 FIX
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



# ── Opportunity Scanner + Relative Strength ─────────────────────────────────────
@app.get("/api/opportunity-scanner")
async def get_opportunity_scanner():
    """
    #2 AI Trade Opportunity Scanner + #3 Relative Strength Scanner.

    For every watchlist ticker with a live scalp snapshot:
      - Appends RS = ticker_pct_change - spy_pct_change (live from WS cache)
      - Appends composite_score = scalp score + RS bonus
      - Returns ranked list (best opportunities first, tiered A-D)

    RS source: ws_engine._cache["SPY"]["percent_change"] — live Polygon tick,
    no extra network calls, no new data source.
    """
    rows = await asyncio.to_thread(db.get_signal_watchlist)  # BUG-06 FIX
    watchlist_tickers = {r["ticker"] for r in rows if r.get("ticker")}
    if not watchlist_tickers:
        return {"data": [], "spy_pct": None, "message": "No tickers in watchlist."}

    # Pull SPY / QQQ % change from live WS cache
    spy_pct = None
    qqq_pct = None
    try:
        eng   = app.state.engine
        cache = eng._cache if eng else {}
        spy_e = cache.get("SPY") or cache.get("spy")
        qqq_e = cache.get("QQQ") or cache.get("qqq")
        if spy_e:
            spy_pct = spy_e.get("percent_change") or spy_e.get("change_pct")
        if qqq_e:
            qqq_pct = qqq_e.get("percent_change") or qqq_e.get("change_pct")
    except Exception as e:
        logger.warning(f"opportunity-scanner: SPY/QQQ cache read failed: {e}")

    # Get scalp snapshot for watchlist
    scalp_rows = []
    try:
        eng = app.state.engine
        if eng and eng._signal_watcher:
            scalp_rows = eng._signal_watcher.get_scalp_snapshot(list(watchlist_tickers))
    except Exception as e:
        logger.warning(f"opportunity-scanner: scalp snapshot failed: {e}")

    # Enrich each row with RS + composite score
    live_cache = {}
    try:
        live_cache = app.state.engine._cache if app.state.engine else {}
    except Exception:
        pass

    def rs_label(rs):
        if rs is None:    return "—"
        if rs >=  2.0:    return "VERY STRONG"
        if rs >=  0.75:   return "STRONG"
        if rs >=  0.25:   return "MODERATE"
        if rs >= -0.25:   return "NEUTRAL"
        if rs >= -0.75:   return "WEAK"
        return "VERY WEAK"

    enriched = []
    for row in scalp_rows:
        if row.get("status") == "warming_up":
            continue
        ticker  = row["ticker"]
        score   = row.get("score", 0.0)
        live    = live_cache.get(ticker, {})
        pct_chg = live.get("percent_change") or live.get("change_pct") or 0.0
        rvol    = live.get("rvol", row.get("volume", 1.0))
        sector  = live.get("sector", "")
        price   = live.get("live_price") or live.get("price") or row.get("price", 0)

        rs_spy  = round(pct_chg - spy_pct, 3) if spy_pct is not None else None
        rs_qqq  = round(pct_chg - qqq_pct, 3) if qqq_pct is not None else None

        # RS bonus: up to ±0.10 so it nudges rank without overriding signal score
        rs_bonus = max(-0.10, min(0.10, rs_spy * 0.02)) if rs_spy is not None else 0.0
        composite = round(score + rs_bonus, 3)

        abs_comp = abs(composite)
        tier = "A" if abs_comp >= 0.75 else "B" if abs_comp >= 0.55 else "C" if abs_comp >= 0.40 else "D"

        enriched.append({
            **row,
            "price":           round(float(price), 2) if price else row.get("price", 0),
            "pct_change":      round(float(pct_chg), 3),
            "rvol":            round(float(rvol), 2),
            "sector":          sector,
            "rs_spy":          rs_spy,
            "rs_qqq":          rs_qqq,
            "rs_label":        rs_label(rs_spy),
            "composite_score": composite,
            "tier":            tier,
        })

    tier_ord   = {"A": 0, "B": 1, "C": 2, "D": 3}
    signal_ord = {"BUY": 0, "SELL": 1, "HOLD": 2}
    enriched.sort(key=lambda r: (
        tier_ord.get(r["tier"], 9),
        signal_ord.get(r.get("signal", "HOLD"), 9),
        -abs(r["composite_score"]),
    ))

    import time as _time
    return {
        "data":         enriched,
        "spy_pct":      round(spy_pct, 3) if spy_pct is not None else None,
        "qqq_pct":      round(qqq_pct, 3) if qqq_pct is not None else None,
        "ticker_count": len(enriched),
        "generated_at": int(_time.time()),
    }


# ── Feature #1: Smart Alerts ──────────────────────────────────────────────────
@app.get("/api/alerts")
async def get_alerts(limit: int = Query(50, ge=1, le=200)):
    """Returns recent alerts from SmartAlertsEngine. Real-time via SSE type:alert."""
    try:
        ae = app.state.alerts_engine
        return {
            "data":         ae.get_recent_alerts(limit),
            "count":        len(ae.alert_history),
            "generated_at": int(time.time()),
        }
    except AttributeError:
        return {"data": [], "count": 0, "message": "Alert engine not initialised"}


# ── Feature #4: Multi-Timeframe Scanner ──────────────────────────────────────
@app.get("/api/mtf-scanner")
async def get_mtf_scanner():
    """1m + 5m + 15m trend confluence scanner for watchlist symbols."""
    try:
        rows = await asyncio.to_thread(db.get_signal_watchlist)  # BUG-06 FIX
        watchlist = [r["ticker"] for r in rows if r.get("ticker")]
        if not watchlist:
            return {"data": [], "message": "No watchlist symbols configured"}

        eng  = app.state.engine
        data = eng._signal_watcher.get_mtf_snapshot(watchlist) if eng and eng._signal_watcher else []

        cache = eng._cache if eng else {}
        spy_e = cache.get("SPY", {})
        qqq_e = cache.get("QQQ", {})

        return {
            "data":         data,
            "ticker_count": len(data),
            "spy_pct":      spy_e.get("percent_change"),
            "qqq_pct":      qqq_e.get("percent_change"),
            "generated_at": int(time.time()),
        }
    except Exception as e:
        logger.error(f"MTF scanner error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


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
