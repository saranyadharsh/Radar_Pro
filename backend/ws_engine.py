"""
ws_engine.py  -  NexRadar Pro
============================
Polygon WebSocket engine: manages the live market data feed, alert cache,
signal watcher, historical fetches, and all background threads.

Called exclusively by ingestor.py. NOT imported by main.py.

FIXES IN THIS VERSION:
  FIX-WS-5   yfinance Rate-Limit Bomb (Bug 5)
              ROOT: In _fetch_polygon_snapshot_bulk(), Fix-20a correctly
              forces today_close=0.0 during market hours to prevent AH base
              poisoning.  But the old fallback chain:
                  if open_price <= 0: open_price = today_close   ← 0.0!
                  if prev_close <= 0: prev_close = open_price    ← 0
                  if today_close <= 0: today_close = open_price  ← 0
              means any slightly illiquid stock with no 9:31 AM tick gets
              all three fields = 0 → pushed to failed[] → yfinance fallback
              fires 2000+ requests → HTTP 429 IP ban for rest of trading day.
              FIX: Exhaust all Polygon data sources before touching yfinance:
                   1. prev_day.c  (yesterday official close  -  always available,
                                   never poisoned by Fix-20a)
                   2. last_trade.p (only AH  -  intraday would re-poison Fix-20a)
                   3. Only push to failed[] if Polygon has ZERO data for ticker
"""

from __future__ import annotations

import asyncio
import logging
import os
import threading
import time
from collections import defaultdict, deque
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from typing import Callable, Dict, List, Optional, Tuple
from zoneinfo import ZoneInfo

import orjson
import requests
import websocket
import yfinance as yf

try:
    from backend.supabase_db     import SupabaseDB
    from backend.Scalping_Signal import ScalpingSignalEngine as ScalpingSignalWatcher
except ModuleNotFoundError:
    from supabase_db     import SupabaseDB
    from Scalping_Signal import ScalpingSignalEngine as ScalpingSignalWatcher

logger = logging.getLogger(__name__)

ET = ZoneInfo("America/New_York")

# ── Constants ──────────────────────────────────────────────────────────────────

POLYGON_WS_URL   = "wss://socket.polygon.io/stocks"
POLYGON_REST_URL = "https://api.polygon.io/v2"
SNAPSHOT_INTERVAL_S  = 15     # check for dirty tickers every 15s
PORTFOLIO_REFRESH_S  = 60   # PORTFIX-1: safety-net poll only; instant updates via /api/portfolio/sync
AH_CLOSE_REFRESH_S   = 60   # 1 min  -  refresh AH closes during extended hours
DB_WRITE_INTERVAL_S  = 300
HIST_FETCH_WORKERS   = 8
TICK_BATCH_SIZE      = 100    # ticks buffered before a flush

# ── Market session helpers ─────────────────────────────────────────────────────

def _get_session(now: datetime | None = None) -> str:
    """Return 'pre' | 'market' | 'after' | 'closed'."""
    if now is None:
        now = datetime.now(ET)
    # Weekends
    if now.weekday() >= 5:
        return "closed"
    t = now.time()
    from datetime import time as dtime
    if dtime(4, 0) <= t < dtime(9, 30):
        return "pre"
    if dtime(9, 30) <= t < dtime(16, 0):
        return "market"
    if dtime(16, 0) <= t < dtime(20, 0):
        return "after"
    return "closed"


def _market_open_today() -> bool:
    return _get_session() in ("pre", "market", "after")


# ── WSEngine ───────────────────────────────────────────────────────────────────

class WSEngine:
    """
    Manages Polygon WebSocket connection and all market-data processing.

    broadcast_cb: async coroutine (payload: dict) -> None
        Called for every processed tick and snapshot payload.
        Must be scheduled into `loop` via run_coroutine_threadsafe.

    loop: asyncio event loop running in the ingestor process.
        WSEngine itself is synchronous/threaded; it pushes results to the
        async world via asyncio.run_coroutine_threadsafe(coro, loop).
    """

    def __init__(
        self,
        broadcast_cb: Callable,
        loop: asyncio.AbstractEventLoop,
    ):
        self._broadcast_cb  = broadcast_cb
        self._loop          = loop
        # Try dev key first (local), fall back to prod key (Render)
        self._api_key       = (
            os.getenv("Massive_API_Key_DEV") or
            os.getenv("MASSIVE_API_KEY", "")
        )

        self._db            = SupabaseDB()
        self._signal_watcher: Optional[ScalpingSignalWatcher] = None

        # Live cache: ticker → latest processed data dict
        self._cache:      Dict[str, dict] = {}
        self._cache_lock  = threading.Lock()

        # Polygon WS
        self._ws:         Optional[websocket.WebSocketApp] = None
        self._ws_thread:  Optional[threading.Thread]       = None
        self._connected   = threading.Event()
        self._shutdown    = threading.Event()

        # Pending DB writes
        self._pending_ticks: List[dict] = []
        self._pending_lock  = threading.Lock()
        _PENDING_CAP        = 5000   # drop oldest if backlog grows beyond this

        # Tick batch: accumulate 250ms of ticks, broadcast as single array
        # Reduces SSE message volume from ~1000/s to ~4/s
        self._tick_batch: Dict[str, dict] = {}
        self._batch_lock  = threading.Lock()

        # Portfolio change-detection hash (PATCH-WSE-2)
        self._last_portfolio_hash: str = ""

        # Background threads
        self._threads: List[threading.Thread] = []

        # Ticker metadata
        self._tickers:     List[str]       = []
        self._company_map: Dict[str, str]  = {}
        self._sector_map:  Dict[str, str]  = {}

        # ── GAP-5 / main.py compatibility ─────────────────────────────────────
        # main.py /api/metrics reads these to surface compute worker health.
        # _tick_queue: deque of pending ticks (replaces _tick_batch for metrics)
        # _dirty_tickers: set of tickers changed since last snapshot broadcast
        # _last_tick_processed_ts: monotonic ts of last processed tick
        self._tick_queue: deque = deque(maxlen=2000)
        self._dirty_tickers: set = set()
        self._last_tick_processed_ts: float = 0.0
        self._feed_warned: bool = False  # TIER1-1.2

        # _watchlist_tickers: subset of all tickers — signal + AH scope
        self._watchlist_tickers: List[str] = []

    # ── Public API ─────────────────────────────────────────────────────────────

    def start(
        self,
        tickers:     List[str],
        company_map: Dict[str, str],
        sector_map:  Dict[str, str],
    ) -> None:
        self._tickers     = tickers
        self._company_map = company_map
        self._sector_map  = sector_map

        # Signal watcher
        # Signal watcher - Corrected method name and ticker extraction
        raw_watchlist = self._db.get_signal_watchlist()
        watchlist = [row['ticker'] for row in raw_watchlist if 'ticker' in row]

        self._signal_watcher = ScalpingSignalWatcher(
            db=self._db,
            broadcast_cb=self._broadcast,
        )
        self._signal_watcher.set_watchlist(watchlist)
        self._signal_watcher.start()

        # Historical data fetch (threaded, non-blocking)
        t = threading.Thread(target=self._fetch_history, daemon=True, name="hist-fetch")
        t.start()
        self._threads.append(t)

        # Polygon WS
        self._start_ws()

        # Snapshot broadcaster
        t = threading.Thread(target=self._snapshot_loop, daemon=True, name="snapshot")
        t.start()
        self._threads.append(t)

        # Portfolio refresh
        t = threading.Thread(target=self._portfolio_loop, daemon=True, name="portfolio")
        t.start()
        self._threads.append(t)

        # DB writer
        t = threading.Thread(target=self._db_write_loop, daemon=True, name="db-writer")
        t.start()
        self._threads.append(t)

        # Session reset (fires at market open each day)
        t = threading.Thread(target=self._session_reset_loop, daemon=True, name="session-reset")
        t.start()
        self._threads.append(t)

        # AH close refresh
        t = threading.Thread(target=self._ah_close_loop, daemon=True, name="ah-close")
        t.start()
        self._threads.append(t)

        # Tick batch flush — coalesces per-tick broadcasts into 250ms batches
        t = threading.Thread(target=self._tick_flush_loop, daemon=True, name="tick-flush")
        t.start()
        self._threads.append(t)

        logger.info(f"WSEngine started  -  {len(tickers)} tickers")

    def shutdown(self) -> None:
        logger.info("WSEngine shutting down …")
        self._shutdown.set()
        if self._ws:
            try:
                self._ws.close()
            except Exception:
                pass
        if self._signal_watcher:
            self._signal_watcher.stop()
        for t in self._threads:
            t.join(timeout=5)
        logger.info("WSEngine stopped.")

    def set_watchlist_tickers(self, tickers: List[str]) -> None:
        """Called from main.py _refresh_signal_watcher to keep AH scope in sync."""
        self._watchlist_tickers = list(tickers)

    # ── Broadcast helper ───────────────────────────────────────────────────────

    def _broadcast(self, payload: dict) -> None:
        """
        Thread-safe: schedules async broadcast_cb on the main event loop.

        Memory-leak fixes:
          1. Guard against closed/None loop  -  avoids RuntimeError after shutdown.
          2. Add done_callback to discard the future as soon as it completes.
             Without this, run_coroutine_threadsafe accumulates completed futures
             in the loop's internal tracking structures (one per tick = ~500/s).
          3. If scheduling fails, explicitly close the unawaited coroutine so
             Python doesn't log a 'coroutine was never awaited' ResourceWarning.
        """
        if self._shutdown.is_set():
            return
        loop = self._loop
        if loop is None or loop.is_closed():
            return
        coro = self._broadcast_cb(payload)
        try:
            future = asyncio.run_coroutine_threadsafe(coro, loop)
            # Discard the future the moment it finishes  -  prevents accumulation
            future.add_done_callback(lambda f: f.exception() if not f.cancelled() else None)
        except Exception:
            # Loop may have shut down between the guard above and here.
            # Close the unawaited coroutine to suppress ResourceWarning.
            try:
                coro.close()
            except Exception:
                pass

    # ── Polygon WebSocket ──────────────────────────────────────────────────────

    def _start_ws(self) -> None:
        self._ws_thread = threading.Thread(
            target=self._ws_run, daemon=True, name="polygon-ws"
        )
        self._ws_thread.start()
        self._threads.append(self._ws_thread)

    def _ws_run(self) -> None:
        while not self._shutdown.is_set():
            try:
                self._ws = websocket.WebSocketApp(
                    POLYGON_WS_URL,
                    on_open=self._on_open,
                    on_message=self._on_message,
                    on_error=self._on_error,
                    on_close=self._on_close,
                )
                # No ping_interval  -  Polygon's servers do not accept client-initiated
                # WebSocket ping frames and respond with a clean close (opcode=8,
                # code=1000) which was causing reconnects every ~60s.
                # Polygon sends its own keepalive; we rely on their heartbeat instead.
                self._ws.run_forever()
            except Exception as e:
                logger.error(f"WS run_forever exception: {e}")
            if not self._shutdown.is_set():
                self._connected.clear()
                if not hasattr(self, "_ws_retry_count"):
                    self._ws_retry_count = 0
                wait_s = min(5 * (2 ** self._ws_retry_count), 60)
                self._ws_retry_count += 1
                logger.info(f"WS disconnected — reconnecting in {wait_s}s "
                            f"(attempt {self._ws_retry_count}) …")
                self._broadcast({"type": "feed_status", "ok": False})
                time.sleep(wait_s)

    def _on_open(self, ws) -> None:
        self._ws_retry_count = 0
        logger.info("Polygon WS connected")

    def _on_close(self, ws, code, msg) -> None:
        self._connected.clear()
        logger.info(f"Polygon WS closed ({code}: {msg})")

    def _on_error(self, ws, error) -> None:
        err_str = str(error)
        if "NoneType" in err_str and "sock" in err_str:
            logger.debug("Polygon WS socket cleanup (expected on disconnect)")
            return
        logger.warning(f"Polygon WS error: {error}")

    def _on_message(self, ws, raw: str) -> None:
        try:
            messages = orjson.loads(raw)
        except Exception:
            return

        for msg in messages:
            ev = msg.get("ev")
            # Log every control message from Polygon for diagnostics
            if ev not in ("T", "A"):
                logger.info(f"Polygon msg: {msg}")
            # Polygon uses ev="status" for both connect and auth events,
            # not ev="connected" / ev="auth_success" as documented elsewhere.
            if ev == "status" and msg.get("status") == "connected":
                ws.send(orjson.dumps({"action": "auth", "params": self._api_key}).decode())
                return
            if ev == "status" and msg.get("status") == "auth_success":
                # Wildcard subscription  -  one 44-byte frame instead of a
                # 130 KB frame listing 12,054 individual T./A. symbols.
                # The old per-ticker approach caused Polygon to close the
                # connection immediately after auth (opcode=8, code=1000).
                # _handle_tick already filters to self._tickers so we only
                # process symbols in our watchlist.
                ws.send(orjson.dumps({"action": "subscribe", "params": "T.*,A.*"}).decode())
                self._connected.set()
                self._broadcast({"type": "feed_status", "ok": True})
                logger.info(f"Subscribed T.*/A.* ({len(self._tickers)} tickers in watchlist)")
                return
            if ev in ("T", "A"):
                self._handle_tick(msg)

    def _handle_tick(self, msg: dict) -> None:
        ticker = msg.get("sym") or msg.get("s", "")
        if not ticker:
            return

        # Wildcard subscription delivers ticks for every stock on the market.
        # Filter to only symbols in our watchlist so we don't burn CPU on
        # 8000+ irrelevant tickers.
        if ticker not in self._cache and ticker not in self._tickers:
            return

        price = float(msg.get("p") or msg.get("vw") or msg.get("c") or 0)
        if price <= 0:
            return

        with self._cache_lock:
            entry = self._cache.get(ticker, {})
            prev_close  = entry.get("prev_close", 0) or 0
            open_price  = entry.get("open_price", 0) or price
            today_close = entry.get("today_close", 0) or 0

            change_pct = ((price - prev_close) / prev_close * 100) if prev_close > 0 else 0
            change_val = round(price - prev_close, 4) if prev_close > 0 else 0

            # Polygon "av" is CUMULATIVE accumulated volume for the day.
            # "v" on aggregate bar is the bar's own volume.
            # To compute RVOL we need a per-interval volume comparison.
            # Strategy: track cumulative volume from last tick; derive tick_vol = cur_vol - prev_cum_vol.
            # We EMA the tick_vol to get avg_tick_vol, then rvol = tick_vol / avg_tick_vol.
            cur_vol_cum  = int(msg.get("av") or msg.get("v") or entry.get("volume", 0) or 0)
            prev_vol_cum = int(entry.get("volume_cum", 0) or 0)
            tick_vol     = max(0, cur_vol_cum - prev_vol_cum) if prev_vol_cum > 0 else int(msg.get("v") or 0)

            avg_tick_vol = entry.get("avg_tick_vol", 0) or 0
            if avg_tick_vol <= 0 or tick_vol <= 0:
                # Seed on first tick: avg = tick_vol, rvol = 1.0
                avg_tick_vol = tick_vol if tick_vol > 0 else 0
                rvol = 1.0
            else:
                avg_tick_vol = int(avg_tick_vol * 0.90 + tick_vol * 0.10)  # faster EMA (alpha=0.10)
                rvol = round(tick_vol / avg_tick_vol, 2) if avg_tick_vol > 0 else 1.0

            # Gap play: open deviated >1.5% from prev_close (session-agnostic  -  day open gap)
            gap_pct = abs(open_price - prev_close) / prev_close * 100 if prev_close > 0 else 0
            is_gap_play = gap_pct >= 1.5

            # Volume spike: per-tick RVOL >= 2x the rolling average
            volume_spike = rvol >= 2.0

            # AH momentum: after session and price moved >0.5% from today_close
            session_now = _get_session()
            ah_pct  = ((price - today_close) / today_close * 100) if today_close > 0 else 0
            ah_momentum = session_now in ("after", "pre") and abs(ah_pct) >= 0.5

            updated = {
                **entry,
                "ticker":        ticker,
                "price":         price,
                # Frontend-expected aliases
                "live_price":    price,
                "percent_change": round(change_pct, 4),
                "change_value":  change_val,
                "is_positive":   1 if change_pct >= 0 else 0,
                "prev_close":    prev_close,
                "open_price":    open_price,
                "today_close":   today_close,
                "change_pct":    round(change_pct, 4),
                "volume":        cur_vol_cum,
                "volume_cum":    cur_vol_cum,
                "tick_vol":      tick_vol,
                "avg_tick_vol":  avg_tick_vol,
                "rvol":          rvol,
                "volume_spike":  volume_spike,
                "is_gap_play":   is_gap_play,
                "ah_momentum":   ah_momentum,
                "ah_pct":        round(ah_pct, 4),
                "ah_dollar":     round(price - today_close, 4) if today_close > 0 else 0,
                # company_name: frontend reads ticker.company_name; keep "company" for legacy
                "company_name":  self._company_map.get(ticker, ""),
                "company":       self._company_map.get(ticker, ""),
                "sector":        self._sector_map.get(ticker, ""),
                # "open" alias: frontend MH table renders ticker.open (not open_price)
                "open":          open_price,
                "ts":            msg.get("t") or int(time.time() * 1000),
            }
            self._cache[ticker] = updated
            # GAP-5: mark ticker dirty for snapshot_delta + metrics
            self._dirty_tickers.add(ticker)
            self._last_tick_processed_ts = time.monotonic()

            # TIER1-1.6: Cache size guard
            if len(self._cache) > 10_000:
                known  = set(self._tickers) | {ticker}
                evict  = [k for k in list(self._cache) if k not in known]
                for k in evict:
                    self._cache.pop(k, None)
                    self._dirty_tickers.discard(k)
                logger.info(f"Cache eviction: removed {len(evict)} unknown tickers")

        # Feed to signal watcher
        if self._signal_watcher:
            self._signal_watcher.on_tick(ticker, price, msg.get("t"))

        # Buffer for DB write  -  capped to prevent unbounded growth during DB outage
        with self._pending_lock:
            self._pending_ticks.append({"ticker": ticker, "price": price,
                                         "ts": updated["ts"]})
            if len(self._pending_ticks) > 5000:
                self._pending_ticks = self._pending_ticks[-5000:]

        # GAP-5: track queue depth for /api/metrics health monitoring
        self._tick_queue.append(ticker)

        # THRESHOLD-FIX: only push to SSE batch if price moved >= 0.05%
        # OR >= 5s have passed since last send for this ticker.
        # Eliminates ~60% of micro-movement ticks invisible to the human eye.
        # Signal watcher + DB write still receive every tick above (unchanged).
        last_sent_price = entry.get("_last_sent_price", 0)
        last_sent_ts    = entry.get("_last_sent_ts", 0)
        now_ms          = updated["ts"]
        price_moved_pct = (abs(price - last_sent_price) / last_sent_price * 100
                           if last_sent_price > 0 else 100)
        secs_since_sent = (now_ms - last_sent_ts) / 1000 if last_sent_ts > 0 else 99

        if price_moved_pct >= 0.05 or secs_since_sent >= 5:
            updated["_last_sent_price"] = price
            updated["_last_sent_ts"]    = now_ms
            self._cache[ticker]["_last_sent_price"] = price
            self._cache[ticker]["_last_sent_ts"]    = now_ms
            with self._batch_lock:
                self._tick_batch[ticker] = updated

    # ── Tick flush loop ────────────────────────────────────────────────────────

    # DELTA-FIX: 7-field slim delta per tick_batch (~100B vs ~500B full entry)
    _DELTA_FIELDS = ("ticker", "price", "change_pct", "percent_change", "volume", "rvol", "ts")

    def _make_delta(self, entry: dict) -> dict:
        return {f: entry[f] for f in self._DELTA_FIELDS if f in entry}

    def _tick_flush_loop(self) -> None:
        """
        DELTA-FIX: batch_data now sends slim 7-field delta instead of full entry.
        Reduces tick_batch from ~1.3 GB/hr to ~0.27 GB/hr per client.
        Frontend must merge delta via Object.assign(priceMap[t], delta).
        Full row available from snapshot (every 5min) or on SSE connect.
        """
        while not self._shutdown.is_set():
            time.sleep(0.25)
            with self._batch_lock:
                if not self._tick_batch:
                    continue
                batch_data = [self._make_delta(v) for v in self._tick_batch.values()]
                self._tick_batch.clear()
            self._broadcast({"type": "tick_batch", "data": batch_data})

    # ── Snapshot loop ──────────────────────────────────────────────────────────

    def _snapshot_loop(self) -> None:
        """
        Broadcasts snapshot_delta every 15s — only tickers that changed
        since the last flush (_dirty_tickers). Zero bytes when nothing changed.

        Full snapshot is NOT sent periodically because every data path is
        already covered without it:
          • tick_batch (250ms)     — live price/volume for active tickers
          • snapshot_delta (15s)   — all fields for any ticker that ticked
          • SSE connect burst      — full snapshot from broadcaster._snapshot_map
                                     sent to every new/reconnected client
          • client_ts handshake    — skips connect burst if client data is fresh

        The old 5-min full snapshot was 3MB × 12/hr = 36 MB/hr wasted.
        Now: ~300 dirty rows × 500B / 15s = ~10 MB/hr. Zero during quiet markets.
        """
        while not self._shutdown.is_set():
            time.sleep(SNAPSHOT_INTERVAL_S)

            # Atomically drain dirty set
            with self._cache_lock:
                if not self._dirty_tickers:
                    continue  # nothing changed — zero bytes sent
                dirty = list(self._dirty_tickers)
                self._dirty_tickers.clear()

            # Read rows outside the lock — individual dict reads are safe
            with self._cache_lock:
                delta_rows = [self._cache[t] for t in dirty if t in self._cache]

            if delta_rows:
                self._broadcast({"type": "snapshot_delta", "data": delta_rows,
                                 "ts": int(time.time() * 1000)})

            # TIER1-1.2: Feed health check
            _silence_s = time.monotonic() - self._last_tick_processed_ts
            if _get_session() == "market" and self._last_tick_processed_ts > 0:
                if _silence_s > 60 and not self._feed_warned:
                    self._feed_warned = True
                    self._broadcast({"type": "feed_warning", "ok": False,
                                     "msg": f"No ticks for {int(_silence_s)}s — Polygon feed may be down"})
                    logger.warning(f"FEED WARNING: no ticks for {int(_silence_s)}s")
                elif _silence_s < 30 and self._feed_warned:
                    self._feed_warned = False
                    self._broadcast({"type": "feed_warning", "ok": True, "msg": "Feed restored"})

    # ── Historical / snapshot fetch from Polygon REST ─────────────────────────

    # DEPLOY-FIX: rows older than this are considered stale and need Polygon refresh.
    # 8 hours covers overnight + weekend gaps cleanly.
    _STALE_THRESHOLD_S = 8 * 3600

    def _fetch_history(self) -> None:
        """
        DEPLOY-FIX: On startup, populate the cache from live_tickers (Supabase)
        first, then only call Polygon REST for tickers that are genuinely missing
        or stale (> _STALE_THRESHOLD_S seconds old).

        Before this fix: every deploy triggered 25 Polygon REST batch calls
        (6027 tickers ÷ 250 per batch) regardless of how fresh the data was.

        After this fix:
          - Mid-day redeploy   → 0 Polygon REST calls (all rows fresh)
          - Overnight/weekend  → 25 Polygon REST calls (all rows stale)
          - First-ever deploy  → 25 Polygon REST calls (no rows exist yet)
        """
        logger.info("DEPLOY-FIX: Loading snapshot from live_tickers (Supabase) …")
        stale: list[str] = []
        now_ts = int(time.time())

        try:
            cached_rows = self._db.get_snapshot_cache()
        except Exception as e:
            logger.error(f"get_snapshot_cache failed: {e} — falling back to Polygon")
            cached_rows = []

        if cached_rows:
            loaded = 0
            for row in cached_rows:
                ticker = row.get("ticker")
                if not ticker or ticker not in self._tickers:
                    continue

                last_update = int(row.get("last_update") or 0)
                age_s = now_ts - last_update

                # Re-map DB column names back to cache field names
                cache_row = {
                    **row,
                    # DB stores open_price; cache and frontend expect both
                    "open":       row.get("open_price", 0),
                    "open_price": row.get("open_price", 0),
                    # Ensure aliases expected by _handle_tick and the frontend exist
                    "live_price":     row.get("price", 0),
                    "percent_change": row.get("change_pct", 0),
                    "change_value":   row.get("change_value", 0),
                    "company_name":   row.get("company_name") or self._company_map.get(ticker, ""),
                    "company":        row.get("company_name") or self._company_map.get(ticker, ""),
                    "sector":         row.get("sector") or self._sector_map.get(ticker, "Unknown"),
                    "ts":             int(row.get("ts") or (last_update * 1000)),
                }

                with self._cache_lock:
                    self._cache[ticker] = cache_row
                loaded += 1

                if age_s > self._STALE_THRESHOLD_S:
                    stale.append(ticker)

            logger.info(
                f"DEPLOY-FIX: Seeded {loaded} tickers from Supabase "
                f"({len(stale)} stale > {self._STALE_THRESHOLD_S//3600}h — will refresh from Polygon)"
            )
        else:
            # No cached rows at all (first-ever deploy) — need full Polygon fetch
            stale = list(self._tickers)
            logger.info("DEPLOY-FIX: No Supabase cache found — full Polygon fetch required")

        # Also add any tickers completely absent from live_tickers
        with self._cache_lock:
            cached_set = set(self._cache.keys())
        missing = [t for t in self._tickers if t not in cached_set]
        if missing:
            logger.info(f"DEPLOY-FIX: {len(missing)} tickers absent from live_tickers — adding to refresh list")
            stale = list(set(stale) | set(missing))

        if not stale:
            logger.info("DEPLOY-FIX: All tickers fresh — skipping Polygon REST bulk fetch ✓")
            # Still broadcast the loaded snapshot immediately so SSE clients get data
            with self._cache_lock:
                data = list(self._cache.values())
            if data:
                self._broadcast({"type": "snapshot", "data": data,
                                 "ts": int(time.time() * 1000)})
            return

        # LOAD-FIX: broadcast Supabase data immediately before Polygon refresh
        with self._cache_lock:
            early_data = [v for v in self._cache.values() if v.get("price", 0) > 0]
        if early_data:
            self._broadcast({"type": "snapshot", "data": early_data,
                             "ts": int(time.time() * 1000)})
            logger.info(f"LOAD-FIX: Early snapshot — {len(early_data)} tickers from Supabase")

        logger.info(f"DEPLOY-FIX: Refreshing {len(stale)} stale/missing tickers from Polygon …")
        try:
            self._fetch_polygon_snapshot_bulk(tickers_override=stale)
        except Exception as e:
            logger.error(f"Polygon partial refresh failed: {e}")

    def _fetch_polygon_snapshot_bulk(self, tickers_override: List[str] = None) -> None:
        """
        Fetches Polygon /v2/snapshot/locale/us/markets/stocks/tickers bulk API.

        DEPLOY-FIX: tickers_override — when provided, only fetch these tickers
        instead of all self._tickers. Used by _fetch_history to refresh only
        the stale/missing subset, skipping Polygon calls for fresh rows.

        FIX-WS-5: The fallback chain after Fix-20a is completely rewritten to
        prevent the yfinance rate-limit bomb. See module docstring for details.
        """
        if not self._api_key:
            logger.warning("No MASSIVE_API_KEY  -  skipping Polygon snapshot fetch")
            return

        target_tickers = tickers_override if tickers_override is not None else self._tickers
        session_now = _get_session()
        batch_size  = 250
        failed: List[str] = []

        for i in range(0, len(target_tickers), batch_size):
            batch   = target_tickers[i:i + batch_size]
            params  = {"tickers": ",".join(batch), "apiKey": self._api_key}
            try:
                resp = requests.get(
                    f"{POLYGON_REST_URL}/snapshot/locale/us/markets/stocks/tickers",
                    params=params, timeout=30
                )
                resp.raise_for_status()
                results = resp.json().get("tickers", [])
            except Exception as e:
                logger.warning(f"Polygon snapshot batch {i//batch_size} failed: {e}")
                failed.extend(batch)
                continue

            for item in results:
                ticker     = item.get("ticker", "")
                day        = item.get("day", {}) or {}
                prev_day   = item.get("prevDay", {}) or {}
                last_trade = item.get("lastTrade", {}) or {}
                last_quote = item.get("lastQuote", {}) or {}

                # Raw Polygon values
                open_price  = float(day.get("o", 0) or 0)
                today_close = float(day.get("c", 0) or 0)
                prev_close  = float(prev_day.get("c", 0) or 0)
                volume      = float(day.get("v", 0) or 0)
                last_price  = (
                    float(last_trade.get("p", 0) or 0) or
                    float(last_quote.get("P", 0) or 0) or
                    float(day.get("c", 0) or 0)
                )

                # ── Fix-20a: force today_close=0.0 during market hours ────────
                # Prevents intraday last-price from poisoning the AH base.
                # Do NOT use today_close as a fallback for open_price (Bug 5).
                if session_now == "market":
                    today_close = 0.0

                # ── FIX-WS-5: exhaustive Polygon fallback before yfinance ─────
                #
                # OLD (broken):
                #   if open_price  <= 0: open_price  = today_close  ← 0.0 market hours!
                #   if prev_close  <= 0: prev_close  = open_price
                #   if today_close <= 0: today_close = open_price
                #   → illiquid stocks: all three = 0 → failed[] → 2000 yf reqs → 429 ban
                #
                # NEW: safe priority order through Polygon-only sources first.
                if open_price <= 0:
                    # prev_day.c = yesterday's official EOD close.
                    # Always available for any ticker that traded yesterday.
                    # Never touched by Fix-20a (it's a historical field).
                    open_price = float(prev_day.get("c", 0) or 0)

                if open_price <= 0:
                    # last_trade.p is only safe as open proxy OUTSIDE market hours.
                    # During market hours it IS the live intraday price  -  using it
                    # would re-introduce the Fix-20a AH poisoning problem.
                    if session_now in ("pre", "after"):
                        open_price = float(last_trade.get("p", 0) or 0)

                # Propagate to related fields using their own Polygon values first.
                if prev_close <= 0:
                    prev_close = float(prev_day.get("c", 0) or 0) or open_price

                if today_close <= 0:
                    # Keep today_close=0 during market hours (Fix-20a correct).
                    # For pre/after sessions we can use open_price as proxy.
                    if session_now in ("pre", "after"):
                        today_close = open_price

                # ── yfinance gate ─────────────────────────────────────────────
                # Push to failed[] ONLY if Polygon has genuinely no data at all.
                # An illiquid stock with a valid prev_day.c is NOT a yf candidate.
                if open_price <= 0 and prev_close <= 0:
                    logger.debug(f"FIX-WS-5: {ticker} no Polygon data → yfinance")
                    failed.append(ticker)
                    continue
                elif open_price <= 0:
                    # Have prev_close but no open  -  use prev_close as proxy.
                    # No need for yfinance; Polygon data is sufficient.
                    open_price = prev_close
                    logger.debug(
                        f"FIX-WS-5: {ticker} open=0, using prev_close={prev_close:.2f}"
                    )

                # ── Compute display price ─────────────────────────────────────
                price      = last_price or open_price
                change_pct = ((price - prev_close) / prev_close * 100) if prev_close > 0 else 0
                change_val = round(price - prev_close, 4) if prev_close > 0 else 0
                gap_pct    = abs(open_price - prev_close) / prev_close * 100 if prev_close > 0 else 0
                ah_pct     = ((price - today_close) / today_close * 100) if today_close > 0 else 0

                with self._cache_lock:
                    self._cache[ticker] = {
                        "ticker":         ticker,
                        "price":          price,
                        # Frontend-expected aliases
                        "live_price":     price,
                        "percent_change": round(change_pct, 4),
                        "change_value":   change_val,
                        "is_positive":    1 if change_pct >= 0 else 0,
                        "open_price":     open_price,
                        "prev_close":     prev_close,
                        "today_close":    today_close,
                        "change_pct":     round(change_pct, 4),
                        "volume":         volume,
                        "avg_volume":     volume,   # seed; EMA builds up on ticks
                        "rvol":           1.0,
                        "volume_spike":   False,
                        "is_gap_play":    gap_pct >= 1.5,
                        "ah_momentum":    session_now in ("after", "pre") and abs(ah_pct) >= 0.5,
                        "ah_pct":         round(ah_pct, 4),
                        "ah_dollar":      round(price - today_close, 4) if today_close > 0 else 0,
                        "company_name":   self._company_map.get(ticker, ""),
                        "company":        self._company_map.get(ticker, ""),
                        "sector":         self._sector_map.get(ticker, ""),
                        "open":           open_price,  # frontend MH col reads .open
                        "ts":             int(time.time() * 1000),
                    }

        # yfinance fallback  -  only truly Polygon-absent tickers
        if failed:
            logger.info(f"yfinance fallback for {len(failed)} tickers (no Polygon data)")
            self._fetch_yfinance_fallback(failed, session_now)

        logger.info(
            f"Polygon snapshot loaded: {len(self._cache)} tickers "
            f"({len(failed)} yfinance fallbacks)"
        )

        # BROADCAST-FIX: broadcast full snapshot now that Polygon data is loaded.
        # _fetch_polygon_snapshot_bulk fills self._cache but never broadcasts —
        # so broadcaster._snapshot_map stays empty and every SSE client hits the
        # engine cache fallback indefinitely.
        # This single broadcast populates _snapshot_map so all future SSE connects
        # get served from broadcaster directly (no more fallback log messages).
        with self._cache_lock:
            final_data = [v for v in self._cache.values() if v.get("price", 0) > 0]
        if final_data:
            self._broadcast({"type": "snapshot", "data": final_data,
                             "ts": int(time.time() * 1000)})
            logger.info(f"BROADCAST-FIX: Full snapshot broadcast after Polygon load "
                        f"— {len(final_data)} tickers. broadcaster._snapshot_map now populated.")

    def _fetch_yfinance_fallback(self, tickers: List[str], session_now: str) -> None:
        """
        Fetches basic price data from yfinance for tickers absent from Polygon.
        Runs in a thread pool to avoid blocking.
        Limited intentionally: this should only be called for a small set of
        truly Polygon-absent tickers (FIX-WS-5 prevents the 2000-ticker flood).
        """
        def _fetch_one(ticker: str) -> None:
            try:
                t    = yf.Ticker(ticker)
                info = t.fast_info
                price      = float(getattr(info, "last_price", 0) or 0)
                prev_close = float(getattr(info, "previous_close", 0) or 0)
                open_price = float(getattr(info, "open", 0) or 0) or prev_close
                if price <= 0 and prev_close <= 0:
                    return
                change_pct = ((price - prev_close) / prev_close * 100) if prev_close > 0 else 0
                with self._cache_lock:
                    self._cache[ticker] = {
                        "ticker":      ticker,
                        "price":       price or open_price,
                        "open_price":  open_price,
                        "prev_close":  prev_close,
                        "today_close":    0.0 if session_now == "market" else price,
                        "change_pct":     round(change_pct, 4),
                        # Frontend-expected aliases
                        "live_price":     price or open_price,
                        "percent_change": round(change_pct, 4),
                        "change_value":   round(price - prev_close, 4) if prev_close > 0 else 0,
                        "is_positive":    1 if change_pct >= 0 else 0,
                        "volume":         0,
                        "avg_volume":     0,
                        "rvol":           1.0,
                        "volume_spike":   False,
                        "is_gap_play":    False,
                        "ah_momentum":    False,
                        "ah_pct":         0,
                        "ah_dollar":      0,
                        "company_name":   self._company_map.get(ticker, ""),
                        "company":        self._company_map.get(ticker, ""),
                        "sector":         self._sector_map.get(ticker, ""),
                        "open":           open_price,  # frontend MH col reads .open
                        "ts":             int(time.time() * 1000),
                        "source":         "yfinance",
                    }
            except Exception as e:
                logger.debug(f"yfinance {ticker}: {e}")

        # Rate-limit conscious: max 4 workers, 0.1s sleep between tasks
        with ThreadPoolExecutor(max_workers=4) as pool:
            futures = []
            for tk in tickers:
                futures.append(pool.submit(_fetch_one, tk))
                time.sleep(0.1)   # ~40 req/min  -  well under Yahoo's soft limit
            for f in futures:
                try:
                    f.result(timeout=15)
                except Exception:
                    pass

    # ── Portfolio refresh loop ─────────────────────────────────────────────────

    def _portfolio_loop(self) -> None:
        while not self._shutdown.is_set():
            try:
                portfolio = self._db.get_portfolio()
                self._broadcast({"type": "portfolio_update", "data": portfolio})
            except Exception as e:
                logger.warning(f"Portfolio refresh error: {e}")
            for _ in range(PORTFOLIO_REFRESH_S):
                if self._shutdown.is_set():
                    return
                time.sleep(1)

    # ── AH close refresh loop ──────────────────────────────────────────────────

    def _ah_close_loop(self) -> None:
        """
        During after-hours, periodically refresh today_close for all cached
        tickers so the AH change% is always relative to the correct EOD close.
        Skips entirely during market hours (Fix-20a: today_close stays 0.0).
        """
        while not self._shutdown.is_set():
            for _ in range(AH_CLOSE_REFRESH_S):
                if self._shutdown.is_set():
                    return
                time.sleep(1)
            if _get_session() == "after":
                try:
                    self._refresh_ah_closes()
                except Exception as e:
                    logger.warning(f"AH close refresh error: {e}")

    def _refresh_ah_closes(self) -> None:
        """Update today_close for cached tickers using Polygon prev_day data."""
        batch_size = 250
        tickers = list(self._cache.keys())
        for i in range(0, len(tickers), batch_size):
            batch  = tickers[i:i + batch_size]
            params = {"tickers": ",".join(batch), "apiKey": self._api_key}
            try:
                resp = requests.get(
                    f"{POLYGON_REST_URL}/snapshot/locale/us/markets/stocks/tickers",
                    params=params, timeout=30
                )
                resp.raise_for_status()
                for item in resp.json().get("tickers", []):
                    tk = item.get("ticker", "")
                    c  = float(item.get("day", {}).get("c", 0) or 0)
                    if tk and c > 0:
                        with self._cache_lock:
                            if tk in self._cache:
                                self._cache[tk]["today_close"] = c
            except Exception as e:
                logger.warning(f"AH close batch {i//batch_size} failed: {e}")

    # ── Session reset loop ─────────────────────────────────────────────────────

    def _session_reset_loop(self) -> None:
        """
        Fires just after 9:30 AM ET each trading day.
        Clears stale AH prices so the dashboard shows fresh market-open data.
        """
        while not self._shutdown.is_set():
            now = datetime.now(ET)
            # Next 9:30 AM
            next_open = now.replace(hour=9, minute=30, second=5, microsecond=0)
            if now >= next_open:
                next_open += timedelta(days=1)
            # Skip weekends
            while next_open.weekday() >= 5:
                next_open += timedelta(days=1)

            sleep_s = (next_open - datetime.now(ET)).total_seconds()
            logger.info(f"Session reset in {sleep_s/3600:.1f}h")
            for _ in range(int(sleep_s)):
                if self._shutdown.is_set():
                    return
                time.sleep(1)

            if self._shutdown.is_set():
                return

            logger.info("9:30 AM ET  -  session reset: clearing AH cache prices")
            # Re-fetch fresh snapshot from Polygon
            try:
                self._fetch_polygon_snapshot_bulk()
            except Exception as e:
                logger.error(f"Session reset snapshot failed: {e}")

    # ── DB write loop ──────────────────────────────────────────────────────────

    def _db_write_loop(self) -> None:
        while not self._shutdown.is_set():
            time.sleep(DB_WRITE_INTERVAL_S)
            with self._pending_lock:
                batch = self._pending_ticks[:]
                self._pending_ticks.clear()
            if not batch:
                continue
            # Build upsert rows from the live cache (has all required fields).
            # _pending_ticks only records {ticker, price, ts}  -  not enough for
            # upsert_tickers which needs open_price, sector, etc.
            tickers_to_write = list({row["ticker"] for row in batch})
            with self._cache_lock:
                rows = [self._cache[t] for t in tickers_to_write if t in self._cache]
            if rows:
                try:
                    self._db.upsert_tickers(rows)
                except Exception as e:
                    logger.warning(f"DB upsert batch failed: {e}")
