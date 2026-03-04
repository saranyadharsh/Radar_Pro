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
        tickers = db.get_all_tickers()          # returns list of ticker strings
        company_map = db.get_company_map()       # returns {ticker: {company_name, sector, ...}}
        result = []
        for t in tickers:
            meta = company_map.get(t, {})
            result.append({
                "ticker":       t,
                "company_name": meta.get("company_name") or meta.get("name") or "—",
                "sector":       meta.get("sector") or "—",
            })
        return result
    except Exception as e:
        logger.error(f"stock-list error: {e}")
        # Fallback: return WS snapshot which includes sector from v_live_enriched
        if engine:
            return engine.get_live_snapshot(limit=5000, only_positive=False)
        return []


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