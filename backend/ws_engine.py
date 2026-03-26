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

  BUG-1 FIX  open / open_price added to _DELTA_FIELDS.
              These fields were missing from slim tick_batch deltas, meaning
              after a market-open cache clear the OPEN column in MH mode
              showed $0.00 for up to 15s (the snapshot_delta window).
              Now ticks carry open so the column is always populated.

  OPEN-PRICE-AUTHORITATIVE-FIX:
              Polygon day.o is the first WS tick price, NOT the official
              NYSE/NASDAQ opening auction print. For illiquid or gapped
              stocks like LITE, day.o = $597 while Yahoo shows $709
              because Yahoo uses regularMarketOpen (the auction print).
              Fix: after _fetch_polygon_snapshot_bulk populates the cache
              on startup, _seed_official_opens() fetches the Polygon
              /v2/aggs/grouped/locale/us/market/stocks/{date} endpoint
              (one call for ALL stocks) and overwrites open_price with
              the grouped-daily 'o' field which IS the official open.
              This runs only once at startup and only during market hours
              (pre/market session) — no extra REST calls during normal tick flow.

  OVERNIGHT-RESTART-PREVCLOSE-FIX:
              When the backend restarts overnight (Render cold start) with
              today_close=0 in the cache (AH loop hasn't run yet for today),
              _session_reset_loop at 9:30 AM finds today_close=0 and skips
              the prev_close promotion → every %CHG wrong all day.
              Fix: _seed_prev_close_from_polygon() runs at startup if session
              is 'pre' or 'market' and any cached ticker has prev_close=0.
              Uses prevDay.c from the snapshot bulk endpoint — already fetched,
              just applied more defensively.

  BUG-2 FIX  _watchlist_tickers seeded at start() time.
              _ah_close_loop calls _refresh_ah_closes() which iterates
              self._watchlist_tickers to decide which tickers need today_close
              refreshed. That list was only populated via set_watchlist_tickers()
              which is only called on watchlist add/remove — never on startup.
              Result: today_close stayed 0 for the entire AH session unless
              the user edited the watchlist. AH $ CHG and AH % CHG both
              fell back to MH change_value (BUG-3). Fix: seed
              self._watchlist_tickers = watchlist in start() immediately after
              the watchlist is loaded from DB.
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
AH_CLOSE_REFRESH_S   = 60  # 5 min  -  refresh AH closes during extended hours
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
        # BUG-2 FIX: seeded at start() from DB, not lazily on first watchlist edit.
        self._watchlist_tickers: List[str] = []

        # WS reconnect counter — initialised here (not lazily in _ws_run) to
        # eliminate the hasattr read/write race between _on_open and _ws_run.
        self._ws_retry_count: int = 0

        # TIER3-9: freshness tracking — per-ticker last_tick_ts (monotonic)
        # Used by snapshot_loop to stamp last_tick_ts and flag stale:True
        # for tickers silent > STALE_TICK_S during market hours.
        self._last_tick_mono: Dict[str, float] = {}  # ticker → time.monotonic()
        self._tick_mono_lock = threading.Lock()

        # ── MOMENTUM-SCANNER: real-time intraday momentum scoring ──────────
        # Computes momentum_score for ALL tickers on every tick_flush.
        # Score = weighted(price_velocity_5m, vol_acceleration, vwap_distance).
        # Top 20 by |momentum_score| broadcast as 'momentum_leaders' every 30s.
        # No additional API calls — uses data already in _cache.
        self._momentum_scores: Dict[str, dict] = {}  # ticker → {score, velocity, vol_accel, vwap_dist, direction, ts}
        self._momentum_lock   = threading.Lock()
        self._price_history_5m: Dict[str, deque] = {}  # ticker → deque of (ts, price) tuples, maxlen=300 (5min@1s)

        # TIER3-10: Polygon WS message-rate monitor
        # Counts T/A messages per 10s window. If rate drops to 0 during market
        # hours for > FEED_SILENCE_S, broadcasts feed_warning (distinct from
        # the existing 60s ws_engine warning that only fires on snapshot cycle).
        self._poly_msg_count: int = 0          # incremented on every T/A message
        self._poly_msg_lock  = threading.Lock()
        self._poly_rate_warned: bool = False   # suppress repeat broadcasts

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
        raw_watchlist = self._db.get_signal_watchlist()
        watchlist = [row['ticker'] for row in raw_watchlist if 'ticker' in row]

        # BUG-2 FIX: seed _watchlist_tickers at startup so _ah_close_loop has
        # valid targets from the very first AH refresh cycle.  Previously this
        # list was only populated via set_watchlist_tickers() which is called
        # on add/remove — never on startup — causing today_close = 0 all session
        # and making AH $ CHG / % CHG silently fall back to MH day change.
        self._watchlist_tickers = list(watchlist)
        logger.info(f"WSEngine.start: seeded _watchlist_tickers with {len(self._watchlist_tickers)} tickers")

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

        # TIER3-10: Polygon message-rate monitor
        t = threading.Thread(target=self._feed_rate_monitor_loop, daemon=True, name="feed-rate-monitor")
        t.start()
        self._threads.append(t)

        # MOMENTUM-SCANNER: real-time intraday momentum scoring (30s interval)
        t = threading.Thread(target=self._momentum_loop, daemon=True, name="momentum-scanner")
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

    def force_reconnect(self) -> None:
        """
        GAP-1: Called by the WS watchdog in main.py when no tick is seen
        for >90s during market hours. Closes the current WS connection so
        _ws_run()'s while-loop reconnects with exponential backoff.
        Safe to call from any thread — ws.close() is thread-safe.
        """
        logger.warning("force_reconnect: closing Polygon WS to trigger reconnect")
        self._connected.clear()
        ws = self._ws
        if ws:
            try:
                ws.close()
            except Exception as e:
                logger.debug(f"force_reconnect ws.close(): {e}")

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
                # _ws_retry_count is initialised in __init__ — no hasattr race
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
            # OPEN-PRICE-STALE-FIX: "or price" fires when open_price=0
            # (zeroed by _session_reset_loop at 9:30 AM ET). The first tick
            # of the new session self-heals open_price to the opening print.
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
                # BUG-1 FIX: also kept here so the full cache entry always has both.
                "open":          open_price,
                "ts":            msg.get("t") or int(time.time() * 1000),
            }
            self._cache[ticker] = updated
            # GAP-5: mark ticker dirty for snapshot_delta + metrics
            self._dirty_tickers.add(ticker)
            self._last_tick_processed_ts = time.monotonic()

            # TIER3-9: stamp per-ticker monotonic time for freshness tracking
            with self._tick_mono_lock:
                self._last_tick_mono[ticker] = time.monotonic()

            # TIER3-10: count every T/A message for rate monitoring
            with self._poly_msg_lock:
                self._poly_msg_count += 1

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
            # MOMENTUM-SCANNER: track price history for velocity calculation
            _p = float(updated.get("live_price") or updated.get("price") or 0)
            if _p > 0:
                self._update_price_history(ticker, _p)

    # ── Tick flush loop ────────────────────────────────────────────────────────

    # BUG-1 FIX: "open" and "open_price" added to _DELTA_FIELDS.
    # Previously these were absent from the slim tick_batch delta, so after
    # a market-open cache clear the MH OPEN column showed $0.00 for up to 15s
    # (the snapshot_delta broadcast window).  With both fields included, the
    # very first tick for each ticker after reconnect carries the open price.
    #
    # DELTA-FIX: slim delta per tick_batch
    # change_value and live_price added so $ CHG / PRICE columns are always
    # live — without them the table shows stale snapshot values for $ CHG
    # even when % CHG is correct (percent_change IS in the delta).
    _DELTA_FIELDS = (
        "ticker", "price", "live_price", "change_value",
        "change_pct", "percent_change",
        "volume", "rvol", "ts",
        # BUG-1 FIX: open + open_price included so MH OPEN column is always current.
        "open", "open_price",
    )

    # TIER3-9: ticker silent > this many seconds during market hours → stale
    _STALE_TICK_S = 60

    def _make_delta(self, entry: dict) -> dict:
        return {f: entry[f] for f in self._DELTA_FIELDS if f in entry}

    def _tick_flush_loop(self) -> None:
        """
        DELTA-FIX: batch_data now sends slim 12-field delta instead of full entry.
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

    # ── Momentum Scanner ───────────────────────────────────────────────────────
    # Real-time intraday momentum scoring across ALL tickers.
    # Runs in its own thread, computes scores every 30s using cached price data.
    # Broadcasts top 20 momentum leaders via SSE for frontend rendering.
    #
    # Score formula (0-100 scale):
    #   momentum_score = (
    #     0.40 × price_velocity_5m_normalized +   -- price move vs 5min ago
    #     0.30 × vol_acceleration_normalized  +   -- current vol vs expected
    #     0.30 × vwap_distance_normalized         -- price distance from VWAP
    #   )
    #
    # No additional API calls — purely computed from the live _cache.

    def _update_price_history(self, ticker: str, price: float) -> None:
        """Track rolling 5-min price history for momentum velocity calculation."""
        now = time.monotonic()
        if ticker not in self._price_history_5m:
            self._price_history_5m[ticker] = deque(maxlen=300)
        self._price_history_5m[ticker].append((now, price))

    def _compute_momentum_scores(self) -> None:
        """
        Compute momentum scores for WATCHLIST tickers only.

        WATCHLIST-SCOPE-FIX: Originally computed for ALL 5,500+ tickers which
        was wasteful — the user only cares about their starred tickers for
        momentum tracking. Now reads self._watchlist_tickers (same list used
        by the signal engine, max 50).

        Also includes intraday_pct (price vs today's open) for cleaner frontend
        rendering without recomputation.
        """
        now_mono = time.monotonic()

        # Read watchlist tickers
        watchlist = list(self._watchlist_tickers) if self._watchlist_tickers else []
        if not watchlist:
            with self._momentum_lock:
                self._momentum_scores = {}
            return

        # Pre-compute ET time once (outside the loop)
        from datetime import datetime
        from zoneinfo import ZoneInfo
        et_now = datetime.now(ZoneInfo("America/New_York"))
        mins_since_open = (et_now.hour - 9) * 60 + (et_now.minute - 30)

        with self._cache_lock:
            cache_snap = {tk: self._cache[tk] for tk in watchlist if tk in self._cache}

        scores = {}
        for ticker, row in cache_snap.items():
            price = float(row.get("live_price") or row.get("price") or 0)
            if price <= 0:
                continue
            volume    = float(row.get("volume") or 0)
            vwap      = float(row.get("vwap") or 0)
            avg_vol   = float(row.get("avg_volume") or row.get("avg_vol") or 0)
            open_price = float(row.get("open") or row.get("open_price") or 0)

            # ── Intraday % (price vs open) ──
            intraday_pct = 0.0
            if open_price > 0:
                intraday_pct = ((price - open_price) / open_price) * 100

            # ── Price velocity: 5-min price change % ──
            velocity_pct = 0.0
            hist = self._price_history_5m.get(ticker)
            if hist and len(hist) >= 2:
                target_ts = now_mono - 300
                old_price = None
                for ts, p in hist:
                    if ts <= target_ts:
                        old_price = p
                    else:
                        break
                if old_price and old_price > 0:
                    velocity_pct = ((price - old_price) / old_price) * 100

            # ── Volume acceleration: current / expected ──
            vol_accel = 0.0
            if avg_vol > 0 and volume > 0 and 0 < mins_since_open <= 390:
                expected_fraction = mins_since_open / 390.0
                expected_vol = avg_vol * expected_fraction
                if expected_vol > 0:
                    vol_accel = volume / expected_vol  # 1.0 = normal, 2.0 = 2× expected

            # ── VWAP distance % ──
            vwap_dist_pct = 0.0
            if vwap > 0:
                vwap_dist_pct = ((price - vwap) / vwap) * 100

            # ── Composite score (signed: + = bullish momentum, - = bearish) ──
            # Normalize each component to roughly -10..+10 range before weighting
            vel_norm  = max(-10, min(10, velocity_pct * 5))    # ±2% move → ±10
            vol_norm  = max(-5,  min(10, (vol_accel - 1) * 5)) # 3× vol → +10
            vwap_norm = max(-10, min(10, vwap_dist_pct * 3))   # ±3.3% from VWAP → ±10

            raw_score = (0.40 * vel_norm + 0.30 * vol_norm + 0.30 * vwap_norm)
            direction = "UP" if raw_score > 0 else "DOWN" if raw_score < 0 else "FLAT"

            scores[ticker] = {
                "ticker":       ticker,
                "score":        round(raw_score, 2),
                "velocity_5m":  round(velocity_pct, 3),
                "vol_accel":    round(vol_accel, 2),
                "vwap_dist":    round(vwap_dist_pct, 3),
                "intraday_pct": round(intraday_pct, 3),
                "direction":    direction,
                "price":        round(price, 2),
                "volume":       int(volume),
                "sector":       self._sector_map.get(ticker, ""),
            }

        with self._momentum_lock:
            self._momentum_scores = scores

    def _momentum_loop(self) -> None:
        """Background thread: compute + broadcast momentum leaders every 30s."""
        while not self._shutdown.is_set():
            time.sleep(30)
            try:
                self._compute_momentum_scores()

                with self._momentum_lock:
                    all_scores = list(self._momentum_scores.values())

                if not all_scores:
                    continue

                # Top 20 by absolute score (strongest momentum in either direction)
                leaders = sorted(all_scores, key=lambda x: abs(x["score"]), reverse=True)[:20]

                self._broadcast({
                    "type": "momentum_leaders",
                    "data": leaders,
                    "ts":   int(time.time() * 1000),
                })
            except Exception as e:
                logger.debug(f"Momentum scanner error: {e}")

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

            # DATA-RACE-FIX: shallow-copy each row before mutation.
            # The original code held references to the actual dicts inside _cache.
            # Mutating row["stale"] / row["last_tick_ts"] below without the lock
            # raced with _handle_tick writing to the same dict on the WS thread.
            # dict() copy is O(fields) per row — negligible vs. the broadcast cost.
            with self._cache_lock:
                delta_rows = [dict(self._cache[t]) for t in dirty if t in self._cache]

            if delta_rows:
                # TIER3-9: stamp last_tick_ts on every delta row and flag stale
                # A ticker not ticked in > STALE_TICK_S during market hours gets
                # stale:True so the frontend can dim/blur its price cells.
                session_now = _get_session()
                now_mono    = time.monotonic()
                now_ms      = int(time.time() * 1000)
                if session_now == "market":
                    with self._tick_mono_lock:
                        mono_snap = dict(self._last_tick_mono)
                    for row in delta_rows:
                        t  = row.get("ticker", "")
                        lm = mono_snap.get(t, now_mono)
                        row["last_tick_ts"] = now_ms - int((now_mono - lm) * 1000)
                        row["stale"]        = (now_mono - lm) > self._STALE_TICK_S
                else:
                    for row in delta_rows:
                        row["stale"] = False

                self._broadcast({"type": "snapshot_delta", "data": delta_rows,
                                 "ts": now_ms})

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

    # TIER3-10: Polygon WS message-rate monitor
    # ──────────────────────────────────────────────────────────────────────────
    # Checks the raw T/A message count every 10s.
    # If the count stays at 0 for > FEED_SILENCE_S during market hours,
    # broadcasts feed_warning (Polygon silently stopped sending).
    # Separate from the existing 60s snapshot-loop check because:
    #   - snapshot_loop only fires every 15s and checks _last_tick_processed_ts
    #   - this loop measures the RAW wire count before any filtering,
    #     catching cases where Polygon sends messages but all are filtered out
    #     (e.g. non-watchlist symbols) vs. actually silent.

    _FEED_SILENCE_S  = 30   # 3 × 10s windows with 0 messages → warn
    _FEED_RATE_POLL  = 10   # sample every 10 seconds

    def _feed_rate_monitor_loop(self) -> None:
        consecutive_zero = 0
        while not self._shutdown.is_set():
            time.sleep(self._FEED_RATE_POLL)
            session = _get_session()

            with self._poly_msg_lock:
                count              = self._poly_msg_count
                self._poly_msg_count = 0   # reset counter each window

            if session != "market":
                # Pre/AH/closed: Polygon legitimately sends fewer messages — reset
                consecutive_zero   = 0
                if self._poly_rate_warned:
                    self._poly_rate_warned = False
                    self._broadcast({"type": "feed_warning", "ok": True,
                                     "msg": "Feed rate restored (non-market hours)"})
                continue

            if count == 0:
                consecutive_zero += 1
                silence_s = consecutive_zero * self._FEED_RATE_POLL
                if silence_s >= self._FEED_SILENCE_S and not self._poly_rate_warned:
                    self._poly_rate_warned = True
                    self._broadcast({"type": "feed_warning", "ok": False,
                                     "msg": f"Polygon WS silent for {silence_s}s — no T/A messages received"})
                    logger.warning(
                        f"TIER3-10 FEED RATE: 0 Polygon T/A messages in {silence_s}s "
                        f"during market hours — possible silent drop"
                    )
            else:
                consecutive_zero = 0
                if self._poly_rate_warned:
                    self._poly_rate_warned = False
                    self._broadcast({"type": "feed_warning", "ok": True,
                                     "msg": f"Feed restored — {count} messages in last {self._FEED_RATE_POLL}s"})
                    logger.info(f"TIER3-10 FEED RATE: restored — {count} msgs/10s")

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

        # SSL-RETRY-FIX: Supabase SSL connections sometimes fail with
        # "sslv3 alert bad record mac" on first attempt (transient TLS issue).
        # Without a retry, get_snapshot_cache() returns [] → triggers full
        # Polygon REST fetch (25+ batches, 30-60s) → SSE snapshot_ready event
        # fires too late → clients time out and receive empty snapshot → 0 tickers.
        cached_rows = []
        for _attempt in range(3):
            try:
                cached_rows = self._db.get_snapshot_cache()
                if cached_rows:
                    break
            except Exception as e:
                logger.warning(f"get_snapshot_cache attempt {_attempt+1}/3 failed: {e}")
                if _attempt < 2:
                    time.sleep(2)
                else:
                    logger.error("get_snapshot_cache all retries failed — falling back to Polygon")

        if cached_rows:
            loaded = 0
            for row in cached_rows:
                ticker = row.get("ticker")
                if not ticker or ticker not in self._tickers:
                    continue

                last_update = int(row.get("last_update") or 0)
                age_s = now_ts - last_update

                # OPEN-PRICE-STALE-FIX: also flag rows from a prior calendar date
                # as stale, regardless of how many hours ago they were updated.
                # A row from 3:55 PM ET yesterday is only 7h old but carries
                # yesterday's open_price — it must be refreshed for today's session.
                # Use ET midnight as the day boundary (matches market convention).
                from datetime import datetime as _dt_local
                try:
                    row_et_date  = _dt_local.fromtimestamp(last_update, tz=ET).date()
                    today_et     = _dt_local.now(ET).date()
                    if row_et_date < today_et:
                        age_s = self._STALE_THRESHOLD_S + 1  # force into stale list
                except Exception:
                    pass

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
        batch_size  = 100   # OOM-FIX: was 250 — 100 limits per-batch JSON to ~150KB
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
                        # BUG-1 FIX: both "open" and "open_price" stored so every
                        # code path reading either alias finds the correct value.
                        "open":           open_price,
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

        # OPEN-PRICE-AUTHORITATIVE-FIX: overwrite open_price with the official
        # grouped-daily open (NYSE/NASDAQ auction print) so it matches Yahoo Finance.
        # Polygon day.o on the snapshot endpoint is the first WS tick, not the
        # official open. The grouped daily bars endpoint returns the actual 9:30
        # auction 'o' field, which is what every other data source calls "Open".
        if session_now in ("pre", "market"):
            try:
                self._seed_official_opens()
            except Exception as e:
                logger.warning(f"_seed_official_opens failed (non-fatal): {e}")

        # OVERNIGHT-RESTART-PREVCLOSE-FIX: if any ticker has prev_close=0 after
        # the bulk fetch (e.g. overnight restart before AH loop populated today_close),
        # use prevDay.c which is always present in the bulk snapshot response.
        # This is already applied in _fetch_polygon_snapshot_bulk but this guard
        # catches tickers that came only from the Supabase cache with stale data.
        self._repair_zero_prev_close()

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

    def _seed_official_opens(self) -> None:
        """
        OPEN-PRICE-AUTHORITATIVE-FIX: Polygon day.o (snapshot endpoint) is the
        first WS trade price, NOT the official NYSE/NASDAQ opening auction print.
        For gapped or illiquid stocks this causes a mismatch vs Yahoo Finance.
        Fetches grouped daily bars (one call, all tickers) and overwrites
        open_price with the authoritative exchange auction open.
        Called once at startup during pre/market sessions only.
        """
        if not self._api_key:
            return
        from datetime import date as _date
        trading_date = datetime.now(ET).date()
        while trading_date.weekday() >= 5:
            trading_date -= timedelta(days=1)
        date_str = trading_date.isoformat()
        url = (
            f"https://api.polygon.io/v2/aggs/grouped/locale/us/market/stocks/{date_str}"
            f"?adjusted=true&apiKey={self._api_key}"
        )
        try:
            resp = requests.get(url, timeout=30)
            resp.raise_for_status()
            results = resp.json().get("results") or []
            if not results:
                logger.info(f"_seed_official_opens: no grouped daily results for {date_str}")
                return
            updated = 0
            with self._cache_lock:
                for bar in results:
                    tk = bar.get("T", "")
                    official_open = float(bar.get("o", 0) or 0)
                    if not tk or official_open <= 0:
                        continue
                    if tk in self._cache:
                        self._cache[tk]["open"]       = official_open
                        self._cache[tk]["open_price"] = official_open
                        updated += 1
            logger.info(
                f"OPEN-PRICE-AUTHORITATIVE-FIX: Overwrote open_price for {updated} tickers "
                f"with official grouped-daily auction open for {date_str}"
            )
        except Exception as e:
            logger.warning(f"_seed_official_opens: {e}")

    def _repair_zero_prev_close(self) -> None:
        """
        OVERNIGHT-RESTART-PREVCLOSE-FIX: Fixes tickers with prev_close=0 after
        overnight Render cold-start, so %CHG is correct all day from the start.
        Fetches prevDay.c from Polygon snapshot for affected tickers only.
        """
        with self._cache_lock:
            zero_pc = [tk for tk, row in self._cache.items()
                       if float(row.get("prev_close", 0) or 0) <= 0
                       and float(row.get("price", 0) or 0) > 0]
        if not zero_pc:
            logger.info("_repair_zero_prev_close: all tickers have valid prev_close ✓")
            return
        logger.info(f"_repair_zero_prev_close: {len(zero_pc)} tickers missing prev_close — fetching from Polygon")
        batch_size = 100
        for i in range(0, len(zero_pc), batch_size):
            batch  = zero_pc[i:i + batch_size]
            params = {"tickers": ",".join(batch), "apiKey": self._api_key}
            try:
                resp = requests.get(
                    f"{POLYGON_REST_URL}/snapshot/locale/us/markets/stocks/tickers",
                    params=params, timeout=20
                )
                resp.raise_for_status()
                for item in resp.json().get("tickers", []):
                    tk        = item.get("ticker", "")
                    prev_day  = item.get("prevDay") or {}
                    prev_close = float(prev_day.get("c", 0) or 0)
                    if tk and prev_close > 0:
                        with self._cache_lock:
                            if tk in self._cache:
                                self._cache[tk]["prev_close"] = prev_close
                                price = float(self._cache[tk].get("price", 0) or 0)
                                if price > 0:
                                    chg_pct = (price - prev_close) / prev_close * 100
                                    self._cache[tk]["percent_change"] = round(chg_pct, 4)
                                    self._cache[tk]["change_cpt"]     = round(chg_pct, 4)
                                    self._cache[tk]["change_value"]   = round(price - prev_close, 4)
                                    self._cache[tk]["is_positive"]    = 1 if chg_pct >= 0 else 0
            except Exception as e:
                logger.warning(f"_repair_zero_prev_close batch {i//batch_size}: {e}")
        logger.info("_repair_zero_prev_close: repair complete")

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
                        # BUG-1 FIX: "open" alias always present.
                        "open":           open_price,
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
        # PORTFOLIO-FIRST-FAST: broadcast within 5s on startup so newly-opened
        # tabs see portfolio data immediately without waiting 60s for the normal
        # interval. After the first broadcast, resume the standard 60s cadence.
        _first = True
        while not self._shutdown.is_set():
            try:
                portfolio = self._db.get_portfolio()
                # PORTFIX-2: enrich each row with live price + computed P&L fields
                # from the live cache. DB rows only have shares/avg_cost/open_price;
                # live_price, change_value, day_pl, total_pl must be computed here
                # so the Portfolio tab always shows live data rather than $0.00.
                enriched = []
                with self._cache_lock:
                    for row in portfolio:
                        tk = row.get("ticker", "")
                        live = self._cache.get(tk, {})
                        shares    = float(row.get("shares", 0) or 0)
                        avg_cost  = float(row.get("avg_cost", 0) or 0)
                        live_price = (
                            float(live.get("live_price") or live.get("price") or
                                  row.get("live_price") or row.get("price") or 0)
                        )
                        open_price = float(
                            live.get("open_price") or live.get("open") or
                            row.get("open_price") or row.get("open") or 0
                        )
                        prev_close = float(
                            live.get("prev_close") or row.get("prev_close") or 0
                        )
                        # PORTFIX-3 / INTRADAY-CONSISTENCY-FIX: use open_price as baseline,
                        # matching Live Table $ CHG (also price − open). Fallback chain:
                        # open_price → prev_close → cached change fields.
                        if open_price > 0 and live_price > 0:
                            change_value   = round(live_price - open_price, 4)
                            percent_change = round((live_price - open_price) / open_price * 100, 4)
                        elif prev_close > 0 and live_price > 0:
                            change_value   = round(live_price - prev_close, 4)
                            percent_change = round((live_price - prev_close) / prev_close * 100, 4)
                        else:
                            change_value   = float(live.get("change_value") or row.get("change_value") or 0)
                            percent_change = float(live.get("percent_change") or live.get("change_cpt") or
                                                   row.get("percent_change") or 0)
                        # Day P&L: (live_price - open_price) x shares
                        day_pl   = round((live_price - open_price) * shares, 2) if open_price > 0 else 0.0
                        # Total P&L: (live_price - avg_cost) x shares
                        total_pl = round((live_price - avg_cost) * shares, 2) if avg_cost > 0 else 0.0
                        # Current market value
                        value    = round(live_price * shares, 2)
                        enriched.append({
                            **row,
                            "live_price":     live_price,
                            "open_price":     open_price,
                            "prev_close":     prev_close,
                            "change_value":   round(change_value, 4),
                            "percent_change": round(percent_change, 4),
                            "day_pl":         day_pl,
                            "total_pl":       total_pl,
                            "value":          value,
                            # Aliases used by different frontend versions
                            "price":          live_price,
                            "open":           open_price,
                            "change_pct":     round(percent_change, 4),
                        })
                # TIME-IMPORT-FIX: removed `import time as _time_mod` from inside the while loop.
                # `time` is already imported at module level (line 73). The repeated import was
                # harmless (Python caches imports) but wasteful and confusing.
                self._broadcast({"type": "portfolio_update", "data": enriched, "server_ts": int(time.time() * 1000)})
            except Exception as e:
                logger.warning(f"Portfolio refresh error: {e}")
            _interval = 5 if _first else PORTFOLIO_REFRESH_S
            _first = False
            for _ in range(_interval):
                if self._shutdown.is_set():
                    return
                time.sleep(1)

    # ── AH close refresh loop ──────────────────────────────────────────────────

    def _ah_close_loop(self) -> None:
        """
        During after-hours, periodically refresh today_close for all cached
        tickers so the AH change% is always relative to the correct EOD close.
        Skips entirely during market hours (Fix-20a: today_close stays 0.0).

        BUG-2 FIX: _watchlist_tickers is now seeded at start() so this loop
        has valid targets from the very first refresh cycle, not just after the
        user edits the watchlist.
        """
        while not self._shutdown.is_set():
            for _ in range(AH_CLOSE_REFRESH_S):
                if self._shutdown.is_set():
                    return
                time.sleep(1)
            if _get_session() in ("after", "pre"):
                # PRE-MARKET-AH-FIX: also refresh during pre-market (4:00–9:30 AM ET).
                # Previously only "after" triggered a refresh. Pre-market extended-hours
                # trading also needs a current today_close to compute ah_dollar/ah_pct —
                # without this, pre-market % was wrong for the first cycle (~60s) because
                # it was using a stale today_close from the prior evening's AH session.
                try:
                    self._refresh_ah_closes()
                except Exception as e:
                    logger.warning(f"AH close refresh error: {e}")

    def _refresh_ah_closes(self) -> None:
        """
        OOM-FIX: was iterating ALL 5,544 cached tickers (22 batches × 375KB = 8MB/run).
        Now only refreshes watchlist tickers (30 tickers = 1 batch = ~150KB/run).
        AH % only needs to be live for tickers the user is watching.
        Interval stays 300s (safe at 1-batch scope). Batch size 100.
        gc.collect() + sleep(0.5) between batches yields GIL so tick processing
        is never blocked, eliminating the 30s live-table freeze during AH.

        DIRTY-TICKERS-FIX: removed `active |= self._dirty_tickers`.
        _dirty_tickers holds every ticker that printed a trade since the last
        snapshot_delta broadcast (resets every 15s). During AH, hundreds of
        tickers trade actively — merging dirty into the AH close target caused
        500-ticker Polygon fetches instead of the intended 30-ticker watchlist
        fetch. _dirty_tickers is for snapshot_delta routing only, not for
        determining which closing prices to refresh. AH % change is only
        displayed for watchlist tickers in the Portfolio and Watchlist pages.
        """
        import gc
        from datetime import date as _date

        with self._cache_lock:
            target = list(self._watchlist_tickers)

        # EARNINGS-AH-FIX: include tickers reporting earnings today so their
        # AH move (e.g. NVDA +12% post-earnings) shows correct ah_dollar / ah_pct
        # even when the user hasn't starred them.
        # today_close is required to compute ah_dollar = live_price - today_close.
        # Without this, earnings tickers not in the watchlist show "—" in AH mode
        # for the entire post-earnings session — the most critical number of the day.
        # Network cost: typically 5-30 extra tickers — stays well within 1 REST batch.
        try:
            today = _date.today().isoformat()
            earn_rows = self._db.get_earnings_for_range(today, today)
            earn_tickers = [r.get("ticker", "") for r in (earn_rows or []) if r.get("ticker")]
            if earn_tickers:
                with self._cache_lock:
                    cached_set = set(self._cache.keys())
                # Union watchlist + today's earnings tickers, capped to those in cache
                target = list(set(target) | {t for t in earn_tickers if t in cached_set})
                logger.info(
                    f"EARNINGS-AH-FIX: {len(earn_tickers)} earnings tickers merged "
                    f"into AH close scope (total target: {len(target)})"
                )
        except Exception as e:
            logger.debug(f"EARNINGS-AH-FIX: earnings fetch skipped: {e}")

        if not target:
            logger.debug("_refresh_ah_closes: target empty — skipping")
            return

        batch_size = 100
        for i in range(0, len(target), batch_size):
            if self._shutdown.is_set():
                return
            batch  = target[i:i + batch_size]
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
                del resp
            except Exception as e:
                logger.warning(f"AH close batch {i//batch_size} failed: {e}")
            gc.collect()
            time.sleep(0.5)

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

            logger.info("9:30 AM ET  -  session reset: promoting today_close → prev_close, clearing AH fields")
            # OOM-FIX: replaced _fetch_polygon_snapshot_bulk() (22 batches, 8MB peak)
            # with in-memory field clear. The Polygon WS feed updates live prices
            # within seconds of market open — no REST fetch needed here.
            #
            # BUG-10 FIX: prev_close is set once at boot from Polygon prevDay.c.
            # After market close, today_close holds yesterday's EOD (set by
            # _refresh_ah_closes reading day.c).  But nothing ever promotes
            # today_close → prev_close, so after any overnight restart the cache
            # still carries the PREVIOUS session's prev_close — making every
            # $CHG / %CHG calculation wrong all next day.
            #
            # Fix: at 9:30 AM, before zeroing AH fields, copy today_close into
            # prev_close for every ticker that has a valid today_close.
            # The 9:30 AM timer is already ET-aware and skips weekends.
            # _db_write_loop will persist the updated rows to Supabase within
            # DB_WRITE_INTERVAL_S seconds, so any subsequent restart reads the
            # correct prev_close from the cache.
            try:
                import gc
                promoted = 0
                with self._cache_lock:
                    for row in self._cache.values():
                        # Promote today's EOD close as tomorrow's prev_close baseline
                        tc = float(row.get("today_close", 0) or 0)
                        if tc > 0:
                            row["prev_close"] = tc
                            promoted += 1
                        row["today_close"] = 0.0
                        row["ah_dollar"]   = 0.0
                        row["ah_pct"]      = 0.0
                        row["ah_momentum"] = False
                        # OPEN-PRICE-STALE-FIX: zero open_price so _handle_tick's
                        # "or price" fallback fires on the first 9:30 AM trade,
                        # setting a correct open instead of carrying yesterday's
                        # open_price forward indefinitely.
                        # Polygon snapshot_bulk at next startup also repopulates
                        # open_price from day.o for any ticker that's been refreshed.
                        row["open"]       = 0.0
                        row["open_price"] = 0.0
                gc.collect()
                logger.info(
                    f"Session reset complete — prev_close promoted for {promoted} tickers, "
                    f"AH fields cleared in-memory"
                )
            except Exception as e:
                logger.error(f"Session reset clear failed: {e}")

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
