"""
main.py — NexRadar Pro Backend  v6.2
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
  P5  ~2 Redis connections per SSE tab -> 20-conn limit exceeded at ~10 tabs
  P6  Watchlist updates silently dropped when Redis XADD blocks event loop

NEW: SSEBroadcaster (zero Redis, zero network I/O on tick path):
  • WSEngine starts in this process — no subprocess, no watchdog needed
  • Each SSE client gets a dedicated asyncio.Queue (maxsize=500)
  • Snapshot stored as a Python dict — lives in memory forever, never evicted
  • Latency: ~0.1ms vs ~5-20ms with Redis round-trips
  • Unlimited simultaneous SSE clients (not capped by Redis conn pool)

PATCHES IN THIS VERSION:
  PATCH-MAIN-1  Signal snapshot on SSE connect
                When a client subscribes to /api/stream, the SSE generator
                now sends a "signal_snapshot" message containing the last 50
                signals immediately after the price snapshot. This ensures
                clients that connect mid-session see existing signals without
                waiting for the next poll cycle.

  PATCH-MAIN-2  Race condition fix: REST fetch vs SSE delta on page mount
                PageScanner.jsx and PagePortfolio.jsx fire a REST GET on
                mount. If an SSE delta (portfolio_update, watchlist_update)
                arrives BEFORE the REST response resolves, the REST response
                was overwriting the newer SSE delta — showing stale data.
                FIX: All REST endpoints that return data also set an
                X-Data-Timestamp response header (Unix ms). The frontend
                must ignore REST responses whose timestamp is older than the
                last SSE delta timestamp it received for that data type.

  PATCH-MAIN-3  /api/stream sends watchlist snapshot on connect
                Similar to PATCH-MAIN-1, the current watchlist is included
                in the initial SSE burst so PageScanner/PagePortfolio don't
                need to fire a separate REST GET on mount at all.

  FIX-1         Zero-client guard in SSEBroadcaster.publish()
                json.dumps(6200 rows) was running 30x/min all day even with
                zero browsers connected — 150 GB/day of pointless work on
                Render, causing 43,200 GC cycles/day and CPU pressure that
                triggered queue fills and reconnect spirals after 2 weeks.
                FIX: _snapshot is always updated (needed for first connect).
                If _queues is empty, return immediately — skip serialisation.
                Impact: CPU -> 0 when no browser open. GC pressure eliminated.

  FIX-2         snapshot_delta support
                SSEBroadcaster now stores _snapshot_map (ticker -> row) in
                addition to _snapshot (full payload). When a client connects,
                it gets the full snapshot from _snapshot_map. During live
                streaming, ws_engine sends type="snapshot_delta" with only
                changed rows — broadcaster fans that out directly without
                touching the full snapshot.

  FIX-4 (frontend companion — see sseWorker.js)
                SharedWorker holds the single EventSource for the entire
                browser session. Tab switches, page refreshes, and navigation
                between Dashboard/LiveTable/Signals/Scanner never disconnect
                the SSE stream. The backend sees exactly one persistent
                connection regardless of user navigation behaviour.

  FIX-5         feed_status events (from ws_engine.py)
                ws_engine broadcasts {"type":"feed_status","ok":false/true}
                on Polygon WS close/auth_success. SSEBroadcaster fans this
                out normally. Frontend shows a reconnecting banner.

  client_ts handshake on /api/stream
                If the client passes ?client_ts=<unix_ms>, and the snapshot
                on the backend is less than 10 seconds newer than that
                timestamp, the full snapshot is skipped — the client's data
                is still fresh. Only a true first load or stale reconnect
                gets the full 3 MB blast.

  FRONTEND INTEGRATION NOTE (PATCH-MAIN-2):
    In PagePortfolio.jsx and PageScanner.jsx, after applying SSE deltas,
    store the delta's server timestamp:
      const lastSSETs = useRef(0);
      // on SSE portfolio_update: lastSSETs.current = Date.now();
      // on REST /api/portfolio response: only apply if Date.now() > lastSSETs.current + 500
    This 500ms grace period ensures the REST response (which races the SSE)
    never silently overwrites a more-recent SSE delta.

  FRONTEND INTEGRATION NOTE (snapshot_delta):
    The frontend must handle both message types from SSE:
      type="snapshot"       -> replace entire local state (first connect only)
      type="snapshot_delta" -> merge rows by ticker key into local state
    Example merge in sseWorker.js / useMarketData hook:
      if (msg.type === 'snapshot_delta') {
        msg.data.forEach(row => { cache[row.ticker] = row })
      }
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
# GAP-4: orjson 3-5x faster than stdlib json for large snapshot payloads
try:
    import orjson as _orjson
    def _dumps(obj: dict) -> str:
        return _orjson.dumps(obj).decode()
except ImportError:
    def _dumps(obj: dict) -> str:  # type: ignore[misc]
        return json.dumps(obj)
from contextlib import asynccontextmanager
from datetime import date, timedelta
from typing import AsyncGenerator, Dict, Set

sys.path.insert(0, str(Path(__file__).parent.parent))

from fastapi import FastAPI, HTTPException, Query, Request
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

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


# ══════════════════════════════════════════════════════════════════════════════
# SSEBroadcaster
# ══════════════════════════════════════════════════════════════════════════════
class SSEBroadcaster:
    """
    In-memory fan-out broadcaster.  Zero Redis.  Zero network I/O on tick path.

    FIX-1: Zero-client guard
      publish() now returns immediately after updating _snapshot if _queues
      is empty. This skips json.dumps entirely when no browser is connected,
      eliminating 150 GB/day of pointless serialisation on Render and the
      resulting GC pressure that caused queue fills after 2 weeks of uptime.

    FIX-2: snapshot_delta support
      _snapshot_map stores ticker -> row dict, updated on every snapshot and
      snapshot_delta. On SSE connect, full snapshot is built from _snapshot_map
      only once. During streaming, snapshot_delta payloads pass through without
      touching _snapshot_map — only the initial type="snapshot" updates it.

    HOP-2-FIX: Slow-client eviction with TTL
      A client whose queue is full is not immediately killed — it may be a
      temporary hiccup (tab backgrounded, GC pause). It gets SLOW_CLIENT_TTL_S
      seconds to drain before being evicted. Evicted clients receive a DISCONNECT
      sentinel so their SSE generator exits cleanly and they auto-reconnect.

    HOP-2-FIX: Named clients
      subscribe() now accepts a client_id for logging. Slow/dead evictions log
      the client_id so you can correlate with access logs.

    Thread safety:
      publish() is an async coroutine — it only runs on the asyncio event loop
      thread. subscribe() and unsubscribe() are also called from async context
      (FastAPI route handlers on the same event loop thread). All _queues
      mutations are single-threaded by the event loop — no lock needed.
      WSEngine background threads schedule publish() via run_coroutine_threadsafe,
      never calling it directly — this is why dict mutation is safe without a lock.
    """

    QUEUE_MAXSIZE      = 500
    SLOW_CLIENT_TTL_S  = 10   # seconds a full queue is tolerated before eviction

    def __init__(self):
        self._queues:       Dict[asyncio.Queue, str]  = {}  # queue -> client_id
        self._slow_since:   Dict[asyncio.Queue, float] = {} # queue -> monotonic time when full started
        self._snapshot:     dict                = {}
        self._snapshot_map: Dict[str, dict]     = {}

    async def publish(self, payload: dict) -> None:
        msg_type = payload.get("type")

        # Always maintain the full snapshot map for new connects
        if msg_type == "snapshot":
            self._snapshot = payload
            for row in payload.get("data", []):
                tk = row.get("ticker")
                if tk:
                    self._snapshot_map[tk] = row

        elif msg_type == "snapshot_delta":
            for row in payload.get("data", []):
                tk = row.get("ticker")
                if tk:
                    self._snapshot_map[tk] = row

        # FIX-1: zero-client guard
        if not self._queues:
            return

        msg  = "data: " + _dumps(payload) + "\n\n"  # GAP-4: orjson
        now  = time.monotonic()
        dead = set()

        for q, client_id in list(self._queues.items()):
            try:
                q.put_nowait(msg)
                # Successful put — clear any slow-client timer
                self._slow_since.pop(q, None)
            except asyncio.QueueFull:
                # HOP-2-FIX: give the client SLOW_CLIENT_TTL_S to recover
                first_full = self._slow_since.get(q)
                if first_full is None:
                    self._slow_since[q] = now
                    logger.warning(f"SSE client {client_id}: queue full — starting eviction timer")
                elif now - first_full > self.SLOW_CLIENT_TTL_S:
                    logger.error(f"SSE client {client_id}: queue full >{self.SLOW_CLIENT_TTL_S}s — evicting")
                    dead.add(q)

        if dead:
            for q in dead:
                self._queues.pop(q, None)
                self._slow_since.pop(q, None)
                try:
                    # Drain and send DISCONNECT so generator exits cleanly
                    while not q.empty():
                        q.get_nowait()
                    q.put_nowait("DISCONNECT")
                except Exception:
                    pass

    def subscribe(self, client_id: str = "unknown") -> asyncio.Queue:
        q = asyncio.Queue(maxsize=self.QUEUE_MAXSIZE)
        self._queues[q] = client_id
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        self._queues.pop(q, None)
        self._slow_since.pop(q, None)

    def get_snapshot(self) -> dict:
        """Returns the last full snapshot payload (for REST /api/snapshot)."""
        return self._snapshot

    def get_snapshot_map(self) -> Dict[str, dict]:
        """Returns the always-current ticker->row map (for SSE connect burst)."""
        return self._snapshot_map

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
    logger.info("NexRadar API starting (direct SSE v6.3) …")

    db          = SupabaseDB()
    broadcaster = SSEBroadcaster()

    tickers, company_map, sector_map = db.get_stock_meta()
    if not tickers:
        logger.warning("No tickers — run migration first")
    else:
        logger.info(f"Loaded {len(tickers)} tickers")

    loop   = asyncio.get_event_loop()
    engine = WSEngine(broadcast_cb=broadcaster.publish, loop=loop)
    engine.start(tickers, company_map, sector_map)
    logger.info("WSEngine started")
    app.state.engine = engine

    try:
        from backend.Scalping_Signal import SmartAlertsEngine
    except ModuleNotFoundError:
        from Scalping_Signal import SmartAlertsEngine
    _ae = SmartAlertsEngine(engine=engine._signal_watcher, broadcast_cb=broadcaster.publish, loop=loop)
    try:
        _ae_rows = db.get_signal_watchlist()
        _ae.set_watchlist([r["ticker"] for r in _ae_rows if r.get("ticker")])
    except Exception:
        pass
    _ae.start()
    app.state.alerts_engine = _ae
    logger.info("SmartAlertsEngine started")

    # v6.3-2 HYBRID WARM-UP: seed today's 1-min bars from Polygon REST so every
    # watchlist ticker's IndicatorCalculator has 27+ bars immediately on startup.
    # Without this, RSI/EMA/BB are unavailable for 27 min after a mid-session restart.
    # seed_history_from_rest() runs in a background thread — startup is not blocked.
    try:
        _api_key = engine._api_key
        if _api_key and engine._signal_watcher:
            logger.info("v6.3: Seeding indicator history from Polygon REST (background)…")
            engine._signal_watcher.seed_history_from_rest(_api_key)
    except Exception as _e:
        logger.warning(f"seed_history_from_rest on startup failed: {_e}")

    yield

    logger.info("Shutting down …")
    try:
        app.state.alerts_engine.stop()
        logger.info("SmartAlertsEngine stopped.")
    except Exception:
        pass
    engine.shutdown()
    logger.info("Shutdown complete.")


app = FastAPI(title="NexRadar Pro API", version="6.3.0", lifespan=lifespan)

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
    snap_map = broadcaster.get_snapshot_map() if broadcaster else {}
    engine: WSEngine = getattr(app.state, "engine", None)
    # GAP-5: compute worker health — seconds since last tick processed.
    # tick_stale_s > 30 during market hours = compute worker stalled.
    tick_stale_s = None
    if engine and getattr(engine, "_last_tick_processed_ts", 0) > 0:
        tick_stale_s = round(time.monotonic() - engine._last_tick_processed_ts, 1)
    return {
        "sse_clients":    broadcaster.client_count if broadcaster else 0,
        "snapshot_size":  len(snap_map),
        "session":        _get_market_status_simple(),
        "architecture":   "direct-sse-v6.3-delta-engine",
        "tick_queue_len": len(engine._tick_queue) if engine else None,
        "tick_stale_s":   tick_stale_s,
        "dirty_tickers":  len(engine._dirty_tickers) if engine else None,
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
    # Use snapshot_map for always-current data (updated by both snapshot + snapshot_delta)
    snap_map = broadcaster.get_snapshot_map() if broadcaster else {}
    data     = list(snap_map.values())

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
async def sse_stream(request: Request, client_ts: int = Query(0)):
    """
    SSE endpoint — zero Redis.

    client_ts handshake (FIX: no reconnect blast):
      The client passes ?client_ts=<unix_ms_of_last_snapshot_received>.
      If the backend snapshot is less than 10 seconds newer than client_ts,
      the client's data is still fresh — skip the full snapshot and send only
      a lightweight reconnected ack. This eliminates the 3 MB blast on every
      tab switch / page refresh when using the SharedWorker (sseWorker.js).

    On connect (true first load or stale data):
      1. Full snapshot built from _snapshot_map (always current)
      2. signal_snapshot — last 50 signals (PATCH-MAIN-1)
      3. watchlist_snapshot — current watchlist (PATCH-MAIN-3)

    On reconnect with fresh data (client_ts < 10s old):
      1. Lightweight {"type":"reconnected"} ack only

    Live stream:
      type="snapshot_delta"  — only changed tickers (FIX-2, ~20 KB not 3 MB)
      type="tick_batch"      — 250ms coalesced tick data
      type="feed_status"     — Polygon WS up/down (FIX-5)
      type="session_change"  — MH/AH boundary crossed (FIX-3)
      type="keepalive"       — every 15s to keep TCP alive
    """
    async def _generate() -> AsyncGenerator[str, None]:
        import uuid
        client_id = str(uuid.uuid4())[:8]
        q = broadcaster.subscribe(client_id)
        logger.info(f"SSE client {client_id} connected (total: {broadcaster.client_count})")
        try:
            snap_map = broadcaster.get_snapshot_map()
            snap_ts  = int(time.time() * 1000)
            age_ms   = snap_ts - client_ts

            # Decide whether to send full snapshot or just ack
            if client_ts == 0 or age_ms > 10_000 or not snap_map:
                # True first load or stale — send full snapshot from map
                if snap_map:
                    full_snap = {
                        "type": "snapshot",
                        "data": list(snap_map.values()),
                        "ts":   snap_ts,
                    }
                    yield "data: " + json.dumps(full_snap) + "\n\n"

                # PATCH-MAIN-1: Signal snapshot on connect
                try:
                    signals = await asyncio.to_thread(db.get_recent_signals, 50)
                    if signals:
                        yield "data: " + json.dumps({
                            "type":      "signal_snapshot",
                            "data":      signals,
                            "server_ts": int(time.time() * 1000),
                        }) + "\n\n"
                except Exception as e:
                    logger.warning(f"SSE connect: signal_snapshot failed: {e}")

                # PATCH-MAIN-3: Watchlist snapshot on connect
                try:
                    wl_rows = await asyncio.to_thread(db.get_signal_watchlist)
                    wl      = [r["ticker"] for r in wl_rows if r.get("ticker")]
                    if wl:
                        yield "data: " + json.dumps({
                            "type":      "watchlist_snapshot",
                            "watchlist": wl,
                            "server_ts": int(time.time() * 1000),
                        }) + "\n\n"
                except Exception as e:
                    logger.warning(f"SSE connect: watchlist_snapshot failed: {e}")

            else:
                # Client has fresh data — skip 3 MB snapshot entirely
                yield f'data: {{"type":"reconnected","ts":{snap_ts}}}\n\n'

            # Live stream
            while True:
                if await request.is_disconnected():
                    break
                try:
                    msg = await asyncio.wait_for(q.get(), timeout=15.0)
                    if msg == "DISCONNECT":
                        break
                    yield msg
                except asyncio.TimeoutError:
                    # HOP-2-FIX: SSE comment heartbeat every 15s.
                    # SSE comments (": ...") keep TCP alive through Nginx/Cloudflare/proxies
                    # without triggering client onmessage handlers — zero JS overhead.
                    yield ": heartbeat\n\n"
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error(f"SSE generator error: {e}")
        finally:
            broadcaster.unsubscribe(q)
            logger.info(f"SSE client {client_id} disconnected (total: {broadcaster.client_count})")

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
    return await asyncio.to_thread(db.get_earnings_for_range, s, e)


# ── Signals ────────────────────────────────────────────────────────────────────
@app.get("/api/signals")
async def get_signals(limit: int = Query(200, le=500)):
    """PATCH-MAIN-2: X-Data-Timestamp header added."""
    data = await asyncio.to_thread(db.get_recent_signals, limit)
    from fastapi.responses import JSONResponse
    return JSONResponse(
        content=data,
        headers={"X-Data-Timestamp": str(int(time.time() * 1000))},
    )

@app.post("/api/signals")
async def post_signal(payload: dict):
    return {"ok": await asyncio.to_thread(db.insert_signal, payload)}


# ── Portfolio / Monitor ────────────────────────────────────────────────────────
@app.get("/api/portfolio")
async def get_portfolio():
    """PATCH-MAIN-2: X-Data-Timestamp header added."""
    data = await asyncio.to_thread(db.get_portfolio)
    from fastapi.responses import JSONResponse
    return JSONResponse(
        content=data,
        headers={"X-Data-Timestamp": str(int(time.time() * 1000))},
    )

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
    """Push updated watchlist to WSEngine signal watcher + SmartAlertsEngine."""
    try:
        engine = app.state.engine
        if engine and engine._signal_watcher:
            rows    = await asyncio.to_thread(db.get_signal_watchlist)
            tickers = [r["ticker"] for r in rows if r.get("ticker")]
            engine._signal_watcher.set_watchlist(tickers)
            try:
                engine.set_watchlist_tickers(tickers)
            except AttributeError:
                pass
            try:
                app.state.alerts_engine.set_watchlist(tickers)
            except AttributeError:
                pass
    except Exception as e:
        logger.warning(f"_refresh_signal_watcher: {e}")


@app.get("/api/watchlist")
async def watchlist_get():
    """PATCH-MAIN-2: X-Data-Timestamp header added."""
    rows = await asyncio.to_thread(db.get_signal_watchlist)
    tickers = [r["ticker"] for r in rows if r.get("ticker")]
    from fastapi.responses import JSONResponse
    return JSONResponse(
        content={"watchlist": tickers, "count": len(tickers)},
        headers={"X-Data-Timestamp": str(int(time.time() * 1000))},
    )


@app.post("/api/watchlist/add")
async def watchlist_add(body: WatchlistBody):
    try:
        ticker = body.ticker.upper().strip()
        await asyncio.to_thread(db.add_signal_watchlist, ticker)
        await _refresh_signal_watcher()
        # v6.3-2 HYBRID WARM-UP: seed the newly-added ticker immediately so
        # its tech indicators are available within seconds, not 27 minutes.
        try:
            _eng = getattr(app.state, "engine", None)
            if _eng and getattr(_eng, "_api_key", None) and _eng._signal_watcher:
                _eng._signal_watcher.seed_history_from_rest(
                    _eng._api_key, symbols=[ticker]
                )
        except Exception as _e:
            logger.warning(f"watchlist_add seed failed for {ticker}: {_e}")
        rows = await asyncio.to_thread(db.get_signal_watchlist)
        wl   = sorted([r["ticker"] for r in rows if r.get("ticker")])
        await broadcaster.publish({
            "type":      "watchlist_update",
            "action":    "add",
            "ticker":    ticker,
            "watchlist": wl,
            "server_ts": int(time.time() * 1000),
        })
        return {"ok": True, "action": "add", "ticker": ticker}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@app.post("/api/watchlist/remove")
async def watchlist_remove(body: WatchlistBody):
    try:
        ticker = body.ticker.upper().strip()
        await asyncio.to_thread(db.remove_signal_watchlist, ticker)
        await _refresh_signal_watcher()
        rows = await asyncio.to_thread(db.get_signal_watchlist)
        wl   = sorted([r["ticker"] for r in rows if r.get("ticker")])
        await broadcaster.publish({
            "type":      "watchlist_update",
            "action":    "remove",
            "ticker":    ticker,
            "watchlist": wl,
            "server_ts": int(time.time() * 1000),
        })
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
    # v6.3-3 DEPENDENCY INJECTION: pass signal_engine so get_cached_monitor
    # reads from live IndicatorCalculator state — zero yfinance, zero HTTP.
    _eng          = getattr(app.state, "engine", None)
    signal_engine = _eng._signal_watcher if _eng else None
    result = await asyncio.to_thread(
        get_cached_monitor, tickers, signal_engine, bool(refresh)
    )
    return result


# ── Scalp Analysis ─────────────────────────────────────────────────────────────
@app.get("/api/scalp-analysis")
async def get_scalp_analysis():
    rows              = await asyncio.to_thread(db.get_signal_watchlist)
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
    rows = await asyncio.to_thread(db.get_signal_watchlist)
    watchlist_tickers = {r["ticker"] for r in rows if r.get("ticker")}
    if not watchlist_tickers:
        return {"data": [], "spy_pct": None, "message": "No tickers in watchlist."}

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

    scalp_rows = []
    try:
        eng = app.state.engine
        if eng and eng._signal_watcher:
            scalp_rows = eng._signal_watcher.get_scalp_snapshot(list(watchlist_tickers))
    except Exception as e:
        logger.warning(f"opportunity-scanner: scalp snapshot failed: {e}")

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

        rs_bonus  = max(-0.10, min(0.10, rs_spy * 0.02)) if rs_spy is not None else 0.0
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

    return {
        "data":         enriched,
        "spy_pct":      round(spy_pct, 3) if spy_pct is not None else None,
        "qqq_pct":      round(qqq_pct, 3) if qqq_pct is not None else None,
        "ticker_count": len(enriched),
        "generated_at": int(time.time()),
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
        rows = await asyncio.to_thread(db.get_signal_watchlist)
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
        raise HTTPException(status_code=502, detail=str(e))


# ── Polygon Proxy — OHLCV bars ─────────────────────────────────────────────────
@app.get("/api/chart/{symbol}")
async def get_chart_bars(symbol: str, interval: str = "1", range: str = "1d"):
    import pytz
    from datetime import datetime, timedelta

    api_key = os.getenv("MASSIVE_API_KEY", "")
    if not api_key:
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
        raise HTTPException(status_code=502, detail=str(e))


# ── Debug: Sector Map ──────────────────────────────────────────────────────────
@app.get("/api/debug/sectors")
async def debug_sectors():
    snap_map = broadcaster.get_snapshot_map() if broadcaster else {}
    data     = list(snap_map.values())
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
