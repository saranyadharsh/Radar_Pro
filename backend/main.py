"""
main.py — NexRadar Pro Backend
================================
FastAPI. Render start command:
  uvicorn backend.main:app --host 0.0.0.0 --port $PORT

Endpoints:
  GET  /health                 → Render health check + UptimeRobot ping
  GET  /api/metrics            → WS health, alert counts, signal engine stats
  GET  /api/tickers            → live snapshot
  GET  /api/tickers?source=    → filter: all / monitor / portfolio / stock_list
  GET  /api/tickers?sector=    → filter by sector (only when source=stock_list)
  GET  /api/earnings           → earnings calendar
  GET  /api/signals            → scalping signals (latest 200)
  POST /api/signals            → insert signal
  GET  /api/portfolio          → portfolio rows
  GET  /api/monitor            → monitor rows
  GET  /api/signal-watchlist   → current signal watchlist
  POST /api/signal-watchlist   → update signal watchlist
  POST /api/signal-vwap-reset  → reset VWAP for all signal symbols
  WS   /ws/live                → real-time tick broadcast to React
"""
from dotenv import load_dotenv
from pathlib import Path
load_dotenv(Path(__file__).parent.parent / ".env")

import os
import sys
import asyncio
import logging
import time
from contextlib import asynccontextmanager
from datetime import date, timedelta
from typing import Set, List

# Add parent directory to path for imports to work in both dev and production
sys.path.insert(0, str(Path(__file__).parent.parent))

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware

# Try both import styles for compatibility
try:
    from backend.supabase_db import SupabaseDB
    from backend.ws_engine    import WSEngine
except ModuleNotFoundError:
    from supabase_db import SupabaseDB
    from ws_engine    import WSEngine


import yfinance as _yf
try:
    import os as _os
    _os.makedirs("/tmp/yf_cache", exist_ok=True)
    _yf.set_tz_cache_location("/tmp/yf_cache")
except Exception:
    pass

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

db:     SupabaseDB = None   # type: ignore
engine: WSEngine   = None   # type: ignore
_clients: Set[WebSocket]  = set()
_clients_lock = asyncio.Lock()


async def _broadcast(data: dict):
    import orjson
    payload = orjson.dumps(data)
    async with _clients_lock:
        dead = set()
        for ws in _clients:
            try:
                await ws.send_bytes(payload)
            except Exception:
                dead.add(ws)
        _clients.difference_update(dead)


@asynccontextmanager
async def lifespan(app: FastAPI):
    global db, engine

    logger.info("🚀 NexRadar backend starting …")

    db   = SupabaseDB()
    loop = asyncio.get_event_loop()
    engine = WSEngine(broadcast_cb=_broadcast, loop=loop)

    # FIX: use get_stock_meta() — one paginated pass instead of three separate calls
    tickers, company_map, sector_map = db.get_stock_meta()

    if not tickers:
        logger.warning("No tickers in stock_list — run migrate_all.py first.")
    else:
        logger.info(f"Loaded {len(tickers)} tickers")
        engine.start(tickers, company_map, sector_map)

    yield

    logger.info("Shutting down …")
    if engine:
        engine.shutdown()


app = FastAPI(title="NexRadar Pro API", version="4.2.0", lifespan=lifespan)

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
    return engine.get_metrics() if engine else {"error": "not ready"}


# ── Debug: Sector Map ──────────────────────────────────────────────────────────
@app.get("/api/debug/sectors")
async def debug_sectors():
    """Debug endpoint to check sector map"""
    if not engine:
        return {"error": "engine not ready"}
    
    sector_map = engine.sector_map
    
    # Count tickers per sector
    sector_counts = {}
    for ticker, sector in sector_map.items():
        sector_counts[sector] = sector_counts.get(sector, 0) + 1
    
    # Sample tickers per sector
    sector_samples = {}
    for sector in sector_counts.keys():
        samples = [t for t, s in sector_map.items() if s == sector][:5]
        sector_samples[sector] = samples
    
    return {
        "total_tickers": len(sector_map),
        "sector_counts": sector_counts,
        "sector_samples": sector_samples,
        "sample_tickers": dict(list(sector_map.items())[:10])
    }


# ── Live tickers ───────────────────────────────────────────────────────────────
@app.get("/api/tickers")
async def get_tickers(
    limit:         int  = Query(1500, le=2000),
    only_positive: bool = Query(True),
    source:        str  = Query("all"),
    sector:        str  = Query(""),        # ← SECTOR: new param
):
    """
    source values: all | monitor | portfolio | stock_list
    sector values: "" (all) | Technology | Financials | Healthcare | etc.
    sector only applies when source=stock_list (ignored otherwise)
    """
    if not engine:
        return []

    # Sector filter only makes sense for stock_list source
    effective_sector = sector if source in ("stock_list", "all") else ""

    return engine.get_live_snapshot(
        limit=limit,
        only_positive=only_positive,
        source=source,
        sector=effective_sector,     # ← SECTOR
    )


# ── Earnings ───────────────────────────────────────────────────────────────────
@app.get("/api/earnings")
async def get_earnings(
    start: str = Query(default=None),
    end:   str = Query(default=None),
):
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
    """
    Returns FULL portfolio rows [{ticker, shares, avg_cost, notes, ...}].
    Frontend needs full rows (not just ticker strings) so ALL 1039 portfolio
    symbols are visible even when not currently in the live WS feed.
    Live prices are enriched client-side from the WS tickers map.
    """
    rows = db.get_portfolio()
    return rows  # full list of dicts — no stripping to ticker-only


@app.get("/api/monitor")
async def get_monitor():
    """
    Returns FULL monitor rows [{ticker, ...}].
    """
    rows = db.get_monitor()
    return rows  # full list of dicts


# ── Stock List ─────────────────────────────────────────────────────────────────
@app.get("/api/stock-list")
async def get_stock_list():
    """
    Returns ALL symbols from stock_list with sector, company_name, etc.
    Used by the Dashboard 'ALL' source so sector column is always populated
    for every symbol, even those not yet streaming via WebSocket.
    """
    try:
        # FIX: use get_stock_meta() — one paginated pass for all three maps
        tickers, company_map, sector_map = db.get_stock_meta()
        result = []
        for t in tickers:
            result.append({
                "ticker":       t,
                "company_name": company_map.get(t) or "—",
                "sector":       sector_map.get(t)  or "—",
            })
        return result
    except Exception as e:
        logger.error(f"stock-list error: {e}")
        if engine:
            return engine.get_live_snapshot(limit=5000, only_positive=False)
        return []


# ── Signal Watchlist (dynamic — persisted to Supabase) ────────────────────────
# Frontend ★ star button calls POST /api/watchlist/add or /api/watchlist/remove.
# GET /api/watchlist returns the current list for initial ★ render on page load.

from pydantic import BaseModel

class WatchlistBody(BaseModel):
    ticker: str

@app.get("/api/watchlist")
async def watchlist_get():
    """GET current starred tickers. Called on page load to render ★ state."""
    if not engine:
        return {"watchlist": [], "count": 0}
    return engine.get_signal_watchlist()


@app.post("/api/watchlist/add")
async def watchlist_add(body: WatchlistBody):
    """Star a ticker — persists to DB + activates live signal engine immediately."""
    if not engine:
        return {"ok": False, "error": "engine not ready"}
    return engine.add_signal_ticker(body.ticker)


@app.post("/api/watchlist/remove")
async def watchlist_remove(body: WatchlistBody):
    """Un-star a ticker — removes from DB + deactivates + clears stale indicator bars."""
    if not engine:
        return {"ok": False, "error": "engine not ready"}
    return engine.remove_signal_ticker(body.ticker)


# ── Legacy signal-watchlist routes (bulk set — kept for backward compat) ───────
@app.get("/api/signal-watchlist")
async def get_signal_watchlist():
    """Legacy bulk GET — returns same data as /api/watchlist."""
    if not engine:
        return {"symbols": [], "count": 0, "max": 50}
    wl = engine.get_signal_watchlist()
    return {
        "symbols": wl["watchlist"],
        "count":   wl["count"],
        "max":     50,
    }


@app.post("/api/signal-watchlist")
async def set_signal_watchlist(payload: dict):
    """Legacy bulk POST — replaces entire watchlist. Persists each ticker to DB."""
    if not engine:
        return {"error": "not ready"}
    symbols = payload.get("symbols", [])
    corrections = {"ORACL": "ORCL", "TESLA": "TSLA"}
    symbols = [corrections.get(s.upper(), s.upper()) for s in symbols]
    # Persist each ticker to DB so it survives restart
    for ticker in symbols:
        db.add_signal_watchlist(ticker)
    accepted = engine._signal_watcher.set_watchlist(symbols)
    logger.info(f"Signal watchlist bulk-set via legacy API: {len(accepted)} symbols")
    return {"accepted": accepted, "count": len(accepted)}


@app.post("/api/signal-vwap-reset")
async def reset_vwap():
    if not engine:
        return {"error": "not ready"}
    engine._signal_engine.reset_vwap_all()
    return {"ok": True}


# ── WebSocket ──────────────────────────────────────────────────────────────────
@app.websocket("/ws/live")
async def ws_live(websocket: WebSocket):
    await websocket.accept()
    async with _clients_lock:
        _clients.add(websocket)
    logger.info(f"WS client connected — total: {len(_clients)}")

    try:
        if engine:
            import orjson
            try:
                snapshot = engine.get_live_snapshot()
                ticker_count = len(snapshot)
                logger.info(f"Sending snapshot with {ticker_count} tickers")
                await websocket.send_bytes(orjson.dumps({
                    "type": "snapshot",
                    "data": snapshot,
                }))
                logger.info("Snapshot sent successfully")
                
                # If snapshot is empty, it means historical data is still loading
                # The engine will broadcast updates via _broadcast() once data arrives
                if ticker_count == 0:
                    logger.info("Snapshot empty - historical data still loading, client will receive updates via broadcast")
            except Exception as snap_err:
                logger.error(f"Error sending snapshot: {snap_err}", exc_info=True)
                # Send empty snapshot on error
                await websocket.send_bytes(orjson.dumps({
                    "type": "snapshot",
                    "data": [],
                }))

        while True:
            await websocket.receive_text()

    except WebSocketDisconnect:
        logger.info("WS client disconnected normally")
    except Exception as e:
        logger.error(f"WS error: {e}", exc_info=True)
    finally:
        async with _clients_lock:
            _clients.discard(websocket)
        logger.info(f"WS client disconnected — remaining: {len(_clients)}")