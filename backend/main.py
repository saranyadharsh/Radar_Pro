"""
main.py — NexRadar Pro Backend
================================
FastAPI. Render start command:
  uvicorn backend.main:app --host 0.0.0.0 --port $PORT

Endpoints:
  GET  /health                 → Render health check + UptimeRobot ping
  GET  /api/metrics            → WS health, alert counts, signal engine stats
  GET  /api/tickers            → live snapshot
  GET  /api/tickers?source=    → filter by source: all / monitor / portfolio
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

import os
import asyncio
import logging
import time
from contextlib import asynccontextmanager
from datetime import date, timedelta
from typing import Set, List

import certifi
os.environ.setdefault("SSL_CERT_FILE", certifi.where())

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware

from supabase_db import SupabaseDB
from ws_engine    import WSEngine

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

    tickers     = db.get_all_tickers()
    company_map = db.get_company_map()

    if not tickers:
        logger.warning("No tickers in stock_list — run migrate_all.py first.")
    else:
        logger.info(f"Loaded {len(tickers)} tickers")
        engine.start(tickers, company_map)

    yield

    logger.info("Shutting down …")
    if engine:
        engine.shutdown()


app = FastAPI(title="NexRadar Pro API", version="4.2.0", lifespan=lifespan)

# Ensure FRONTEND_ORIGIN is set to https://nexradar.info in Render Env Vars
FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "https://nexradar.info")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        FRONTEND_ORIGIN,
        "https://nexradar.info",                        # Your custom domain
        "https://radar-pro-frontend-bxtq.onrender.com",  # Your Render frontend URL
        "http://localhost:5173",                         # Local Vite dev
        "http://localhost:3000",                         # Local React dev
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Health ─────────────────────────────────────────────────────────────────────
@app.get("/health")
async def health():
    return {"status": "ok", "ts": int(time.time())}


# ── Metrics ────────────────────────────────────────────────────────────────────
@app.get("/api/metrics")
async def get_metrics():
    return engine.get_metrics() if engine else {"error": "not ready"}


# ── Live tickers ───────────────────────────────────────────────────────────────
@app.get("/api/tickers")
async def get_tickers(
    limit:         int  = Query(1500, le=2000),
    only_positive: bool = Query(True),
    source:        str  = Query("all"),
):
    if not engine:
        return []
    return engine.get_live_snapshot(limit=limit, only_positive=only_positive, source=source)


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
    return db.get_portfolio()


@app.get("/api/monitor")
async def get_monitor():
    return db.get_monitor()


# ── Signal Watchlist ───────────────────────────────────────────────────────────
@app.get("/api/signal-watchlist")
async def get_signal_watchlist():
    if not engine:
        return {"symbols": []}
    return {
        "symbols": sorted(engine._signal_watcher.watched),
        "count":   len(engine._signal_watcher.watched),
        "max":     50,
    }


@app.post("/api/signal-watchlist")
async def set_signal_watchlist(payload: dict):
    """
    Body: { "symbols": ["AAPL", "TSLA", ...] }
    Mirrors sidebar Apply Watchlist button.
    """
    if not engine:
        return {"error": "not ready"}

    symbols = payload.get("symbols", [])
    corrections = {"ORACL": "ORCL", "TESLA": "TSLA"}
    symbols = [corrections.get(s.upper(), s.upper()) for s in symbols]
    accepted = engine._signal_watcher.set_watchlist(symbols)
    logger.info(f"Signal watchlist updated via API: {len(accepted)} symbols")
    return {"accepted": accepted, "count": len(accepted)}


@app.post("/api/signal-vwap-reset")
async def reset_vwap():
    """Mirrors 'Reset VWAP (Market Open)' button."""
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
        # Full snapshot on connect so UI isn't blank
        if engine:
            import orjson
            snapshot = engine.get_live_snapshot()
            await websocket.send_bytes(orjson.dumps({
                "type": "snapshot",
                "data": snapshot,
            }))

        while True:
            await websocket.receive_text()

    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.debug(f"WS error: {e}")
    finally:
        async with _clients_lock:
            _clients.discard(websocket)
        logger.info(f"WS client disconnected — remaining: {len(_clients)}")
