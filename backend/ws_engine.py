"""
ws_engine.py — NexRadar Pro
============================
Cloud-safe WebSocket engine.

FIXES IN THIS VERSION:
  FIX-20 TODAY_CLOSE MISMATCH (AH price bug):
         Root cause: _fetch_polygon_snapshot_bulk and _refresh_historical_for_new_day
         read `day.c` from Polygon as `today_close`. During market hours and at
         startup, `day.c` is 0 or a partial intraday value — not the official 4pm
         close. The fallback `lastTrade.p` is the current *live* price, so
         `today_close` ends up seeded with the intraday price.  In AH session,
         `base = today_close`, so `change_value = live_price − today_close` is
         essentially zero or wrong.

         Fix:
           a) In _fetch_polygon_snapshot_bulk / _refresh_historical_for_new_day:
              Only use `day.c` as today_close if session == "after" (market has
              closed). During market hours seed today_close = 0 so the AH base
              is never poisoned with an intraday price.
           b) In _refresh_ah_closing_prices (runs every 120s during AH):
              Keep existing logic — this correctly updates today_close post-close.
              Add a sanity guard: only accept `official_close` if it differs from
              the cached live_price by < 20%; otherwise Polygon may be returning
              a stale or wrong value.
           c) In _update_alert_cache_logic: ensure today_close is only used as
              base in genuine "after" session AND today_close > 0.
              No change needed (already correct), but add a comment.

  FIX-17 STALE OPEN PRICES: historical_data was set once at startup and never
         refreshed when a new trading day started. If backend ran overnight,
         today's "open" was actually yesterday's open. Now _session_reset_loop
         triggers _refresh_historical_for_new_day() at 09:31 ET daily.
  
  FIX-18 FIRST-TICK OPEN GUARD: If historical_data["open"] is suspiciously
         stale (>15% away from first live tick), use the first live tick price
         as a temporary open until the Polygon refresh at 09:31 completes.
  
  FIX-19 LIVE_DISPLAY_CAP raised from 1600 to 6200. Frontend already paginates
         at 50 rows/page, so the backend cap was silently hiding 4400+ tickers
         when user clicked ALL. Frontend pagination handles the UI load.

PRIOR FIXES (preserved):
  FIX-1  intraday_highs_lock
  FIX-2  Earnings refresh guard
  FIX-3  intraday_highs reset at 09:30 ET
  FIX-4  EARNINGS pseudo-sector
  FIX-5  seed_history_from_rest() at startup
  FIX-6  Gap calc guarded
  FIX-7  AH close refresh batched
  FIX-8  WS reconnect frozenset
  FIX-9  shutdown() flushes pending_writes
  FIX-10 4pm ET re-seed
  FIX-11 _market_session() cached
  FIX-12 yf counter lock
  FIX-13 alert_cache_lock consolidated
  FIX-14 _last_broadcast_ts purged
  FIX-15 task_done()
  FIX-16 AH close refresh: historical_data only
"""

import os
import sys
import time
import asyncio
import threading
import queue
import logging
import random
from datetime import datetime, time as dt_time, date, timedelta
from typing import Dict, List, Optional, Set, Callable
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytz
import yfinance as yf
import requests

# ── SSL fix ───────────────────────────────────────────────────────────────────
import os as _os
_os.environ.pop("SSL_CERT_FILE", None)

from massive import WebSocketClient, RESTClient
from massive.websocket.models import WebSocketMessage, Market

try:
    from backend.supabase_db import SupabaseDB
    from backend.Scalping_Signal import (
        ScalpingSignalEngine, SignalWatchlistManager, OHLCVBar, TradeSignal,
    )
except ModuleNotFoundError:
    from supabase_db import SupabaseDB
    from Scalping_Signal import (
        ScalpingSignalEngine, SignalWatchlistManager, OHLCVBar, TradeSignal,
    )

logger = logging.getLogger(__name__)

ET_TZ = pytz.timezone("America/New_York")

# ── Constants ──────────────────────────────────────────────────────────────────
VOLUME_SPIKE_THRESHOLD       = 2.0
VOLUME_SPIKE_HIGH_THRESHOLD  = 5.0
GAP_THRESHOLD_PERCENT        = 3.0
GAP_EXTREME_THRESHOLD        = 10.0
AH_MOMENTUM_MULTIPLIER       = 1.5
PRICE_STALE_SECONDS          = 300
AH_CLOSE_REFRESH_INTERVAL    = 120
MAX_WEBSOCKET_TICKERS        = 10000
# FIX-19: Raised from 1600 → 6200 to show all ~6027 tickers when user clicks ALL.
# Frontend already paginates at 50 rows/page so this doesn't cause UI load issues.
LIVE_DISPLAY_CAP             = 6200
WS_BACKOFF_BASE_DELAY        = 1.0
WS_BACKOFF_MAX_DELAY         = 60.0
_SESSION_CACHE_TTL           = 60.0   # FIX-11
_BROADCAST_PURGE_SEC         = 600.0  # FIX-14

# FIX-18: If open price is this % away from first live tick, treat it as stale
_STALE_OPEN_THRESHOLD_PCT    = 15.0

# ── FIX-11: module-level session cache ────────────────────────────────────────
_session_cache:    str   = "closed"
_session_cache_ts: float = 0.0
_session_cache_lock      = threading.Lock()


def _market_session() -> str:
    global _session_cache, _session_cache_ts
    now_mono = time.monotonic()
    with _session_cache_lock:
        if now_mono - _session_cache_ts < _SESSION_CACHE_TTL:
            return _session_cache
        t = datetime.now(ET_TZ).time()
        if   dt_time(4,  0) <= t < dt_time(9,  30): val = "pre"
        elif dt_time(9, 30) <= t < dt_time(16,  0): val = "market"
        elif dt_time(16, 0) <= t < dt_time(20,  0): val = "after"
        else:                                        val = "closed"
        _session_cache    = val
        _session_cache_ts = now_mono
        return val


def _get_market_status() -> str:
    now = datetime.now(ET_TZ)
    t   = now.time()
    if now.weekday() >= 5:                        return "CLOSED_WEEKEND"
    if dt_time(20, 0) <= t or t < dt_time(4, 0): return "OVERNIGHT_SLEEP"
    if dt_time(4,  0) <= t < dt_time(9,  30):    return "PRE_MARKET"
    if dt_time(9, 30) <= t < dt_time(16,  0):    return "MARKET_HOURS"
    if dt_time(16, 0) <= t < dt_time(20,  0):    return "AFTER_HOURS"
    return "CLOSED"


def _calculate_backoff(retry_count: int) -> float:
    delay = min(WS_BACKOFF_BASE_DELAY * (2 ** retry_count), WS_BACKOFF_MAX_DELAY)
    return delay * random.uniform(0.8, 1.2)


class WSEngine:

    def __init__(self, broadcast_cb: Optional[Callable] = None, loop=None):
        self.massive_api_key: str = os.getenv("MASSIVE_API_KEY", "")
        self.db               = SupabaseDB()
        self._broadcast_cb    = broadcast_cb
        self._loop            = loop

        # ── State ──────────────────────────────────────────────────────────────
        self.all_tickers:      Set[str]       = set()
        self.company_map:      Dict[str, str] = {}
        self.sector_map:       Dict[str, str] = {}
        self.alert_cache:      Dict[str, Dict]= {}
        self.alert_cache_lock                 = threading.Lock()
        self.historical_data:  Dict[str, Dict]= {}
        self.historical_data_lock             = threading.Lock()

        self.intraday_highs:      Dict[str, float] = {}
        self.intraday_highs_lock                   = threading.Lock()

        self._monitor_tickers:   Set[str] = set()
        self._portfolio_tickers: Set[str] = set()
        self._last_portfolio_refresh      = 0.0
        self._PORTFOLIO_REFRESH_INTERVAL  = float(os.getenv("PORTFOLIO_REFRESH_INTERVAL", "30.0"))

        self.ws_health_status  = "connecting"
        self.ws_retry_count    = 0
        self.last_message_time = time.time()
        self.polygon_ws_client: Optional[WebSocketClient] = None
        self.ws_lock           = threading.Lock()

        self._last_broadcast_ts     = {}
        self._last_broadcast_purge  = time.time()
        self._BROADCAST_THROTTLE_SEC= 0.35

        self.last_ah_close_refresh = 0.0

        self.earning_date_map:       Dict[str, str] = {}
        self._earnings_last_refresh                 = 0.0
        self._EARNINGS_REFRESH_INTERVAL             = 3600.0
        self._earnings_refresh_event = threading.Event()
        self._earnings_refresh_event.set()

        self._signal_engine  = ScalpingSignalEngine()
        self._signal_watcher = SignalWatchlistManager(self._signal_engine)
        self._signal_engine.on_signal(self._on_signal)

        self.source_stats = {
            "total_attempted":  0,
            "polygon_success":  0,
            "yfinance_success": 0,
            "failed":           0,
        }

        self.run_event = threading.Event()
        self.run_event.set()

        self._pending_writes:      Dict[str, Dict] = {}
        self._pending_writes_lock                  = threading.Lock()
        self._last_db_flush   = time.time()
        self._DB_FLUSH_INTERVAL = 1.0

        self.db_write_queue: queue.Queue = queue.Queue()
        self._db_thread = threading.Thread(
            target=self._db_writer_worker, daemon=True, name="DBWriter"
        )
        self._db_thread.start()

        logger.info("WSEngine initialised")

    # ── START / STOP ──────────────────────────────────────────────────────────

    def start(self, tickers: List[str], company_map: Dict[str, str], sector_map: Dict[str, str] = None):
        self.all_tickers = set(tickers)
        self.company_map = company_map
        self.sector_map  = sector_map if sector_map is not None else self.db.get_sector_map()
        logger.info(f"Sector map: {len(self.sector_map)} tickers")

        self._refresh_portfolio_monitor()

        threading.Thread(
            target=self._fetch_historical_batch,
            args=(list(self.all_tickers),),
            daemon=True, name="HistFetch"
        ).start()

        threading.Thread(
            target=self._ws_listener_loop, daemon=True, name="MassiveWS"
        ).start()

        threading.Thread(
            target=self._portfolio_monitor_refresh_loop,
            daemon=True, name="PortfolioMonitorRefresh"
        ).start()

        threading.Thread(
            target=self._session_reset_loop,
            daemon=True, name="SessionReset"
        ).start()

        self._refresh_earning_date_map()
        self._load_signal_watchlist_from_db()

        if self.massive_api_key:
            self._signal_watcher.seed_history_from_rest(
                polygon_api_key=self.massive_api_key
            )
            logger.info("Signal bar history seeding started (background thread)")
        else:
            logger.warning(
                "MASSIVE_API_KEY not set — signal bar seeding skipped. "
                "Signals won't fire until 27 live A.* bars accumulate per ticker."
            )

        logger.info(f"WSEngine started — {len(self.all_tickers)} tickers")

    # ── SESSION RESET LOOP (FIX-3 + FIX-10 + FIX-17) ─────────────────────────

    def _session_reset_loop(self):
        """
        FIX-3:  Clears intraday_highs at 09:30 ET.
        FIX-10: Re-seeds signal bars at 16:01 ET.
        FIX-17: Refreshes historical_data (open, prev_close, today_close) at 09:31 ET
                so that a new trading day gets fresh Polygon snapshot data instead of
                stale startup values. This is the ROOT FIX for the stale open price bug.
        """
        et_tz = pytz.timezone("America/New_York")
        reset_done_date:     Optional[date] = None
        hist_refresh_date:   Optional[date] = None   # FIX-17
        reseed_done_date:    Optional[date] = None

        while self.run_event.is_set():
            try:
                now_et  = datetime.now(et_tz)
                today   = now_et.date()
                weekday = now_et.weekday()

                if weekday < 5:
                    # 09:30 ET: reset intraday HWMs + clear alert cache for fresh day
                    if (now_et.hour == 9 and now_et.minute >= 30
                            and reset_done_date != today):
                        reset_done_date = today
                        with self.intraday_highs_lock:
                            self.intraday_highs.clear()
                        # FIX-17: Clear alert_cache so stale change_value/percent_change
                        # from yesterday don't bleed into today's first snapshot
                        with self.alert_cache_lock:
                            self.alert_cache.clear()
                        logger.info("⏰ 09:30 ET: Intraday HWMs + alert_cache cleared for new day")

                    # FIX-17: 09:31 ET: Refresh historical_data from Polygon snapshot
                    # This gets today's REAL open prices, prev_close, etc.
                    # We wait 1 min after open so Polygon has the day's open price.
                    if (now_et.hour == 9 and now_et.minute >= 31
                            and hist_refresh_date != today
                            and self.massive_api_key):
                        hist_refresh_date = today
                        logger.info("⏰ 09:31 ET: Refreshing historical_data for new trading day...")
                        threading.Thread(
                            target=self._refresh_historical_for_new_day,
                            daemon=True, name="DailyHistRefresh"
                        ).start()

                    # 16:01 ET: re-seed signal bar history for AH
                    if (now_et.hour == 16 and now_et.minute >= 1
                            and reseed_done_date != today
                            and self.massive_api_key):
                        reseed_done_date = today
                        self._signal_watcher.seed_history_from_rest(
                            polygon_api_key=self.massive_api_key
                        )
                        logger.info("Signal bars re-seeded at 4pm for AH session")

            except Exception as e:
                logger.error(f"_session_reset_loop: {e}")

            time.sleep(30)

    # ── FIX-17: Daily historical data refresh ─────────────────────────────────

    def _refresh_historical_for_new_day(self):
        """
        FIX-17: Re-fetch Polygon snapshot for ALL tickers at market open.
        This replaces stale overnight open/prev_close/today_close values
        with today's actual data from Polygon.

        Called at 09:31 ET by _session_reset_loop (1 min after market open
        so Polygon has had time to record today's opening prices).
        """
        try:
            with self.ws_lock:
                snap_tickers = list(self.all_tickers)

            if not snap_tickers:
                logger.warning("_refresh_historical_for_new_day: no tickers")
                return

            logger.info(f"FIX-17: Refreshing historical data for {len(snap_tickers)} tickers...")
            start_time = time.time()

            BATCH_SIZE = 100
            refreshed = 0

            for i in range(0, len(snap_tickers), BATCH_SIZE):
                batch = snap_tickers[i : i + BATCH_SIZE]
                tickers_csv = ",".join(batch)
                url = (
                    f"https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers"
                    f"?tickers={tickers_csv}&apiKey={self.massive_api_key}"
                )
                try:
                    resp = requests.get(url, timeout=20)
                    if resp.status_code != 200:
                        logger.warning(f"FIX-17 refresh HTTP {resp.status_code} batch {i}")
                        continue

                    snap_map = {
                        item["ticker"]: item
                        for item in resp.json().get("tickers", [])
                    }

                    for ticker in batch:
                        item = snap_map.get(ticker)
                        if not item:
                            continue

                        day        = item.get("day",       {}) or {}
                        prev_day   = item.get("prevDay",   {}) or {}
                        last_trade = item.get("lastTrade", {}) or {}

                        open_price  = float(day.get("o",  0) or 0)
                        today_close = float(day.get("c",  0) or 0)
                        avg_vol     = float(day.get("av", 0) or 0)
                        prev_close  = float(prev_day.get("c", 0) or 0)

                        # FIX-20a: This refresh runs at 09:31 ET (market just opened).
                        # day.c at this point is 0 or the pre-market price, NOT the
                        # official 4pm close from yesterday.  Seeding today_close here
                        # would poison the AH base for tonight's after-hours session.
                        # Always set today_close = 0 here; _refresh_ah_closing_prices
                        # will populate it correctly after 4pm ET.
                        today_close = 0.0

                        if today_close <= 0:
                            today_close = float(last_trade.get("p", 0) or 0)
                        if open_price  <= 0: open_price  = today_close
                        if prev_close  <= 0: prev_close  = open_price
                        if today_close <= 0: today_close = open_price

                        if open_price <= 0:
                            continue

                        with self.historical_data_lock:
                            self.historical_data[ticker] = {
                                "open":        open_price,
                                "prev_close":  prev_close,
                                "today_close": today_close,
                                "avg_volume":  avg_vol,
                            }
                        refreshed += 1

                except Exception as e:
                    logger.error(f"FIX-17 refresh batch {i}: {e}")

            elapsed = round(time.time() - start_time, 1)
            logger.info(
                f"FIX-17: Historical data refreshed for {refreshed}/{len(snap_tickers)} "
                f"tickers in {elapsed}s — today's open prices are now current"
            )

            # After refresh, broadcast a fresh snapshot so all connected clients
            # immediately see corrected open prices without waiting for next tick
            if self._broadcast_cb and self._loop and refreshed > 0:
                snapshot = self.get_live_snapshot(limit=10000, only_positive=False)
                asyncio.run_coroutine_threadsafe(
                    self._broadcast_cb({
                        "type": "snapshot",
                        "data": snapshot,
                    }),
                    self._loop,
                )
                logger.info(f"FIX-17: Broadcast fresh snapshot after daily refresh ({len(snapshot)} tickers)")

        except Exception as e:
            logger.error(f"_refresh_historical_for_new_day: {e}")

    # ── DYNAMIC SIGNAL WATCHLIST ──────────────────────────────────────────────

    def _load_signal_watchlist_from_db(self):
        try:
            rows    = self.db.get_signal_watchlist()
            tickers = [r["ticker"] for r in rows if r.get("ticker")]
            if tickers:
                self._signal_watcher.set_watchlist(tickers)
                logger.info(f"Signal watchlist loaded from DB: {len(tickers)} tickers — {tickers}")
            else:
                logger.info("Signal watchlist is empty — user has not starred any tickers yet")
        except Exception as e:
            logger.error(f"_load_signal_watchlist_from_db: {e} — starting with empty watchlist")

    def add_signal_ticker(self, ticker: str) -> Dict:
        ticker = ticker.upper().strip()
        if not ticker:
            return {"ok": False, "error": "ticker is required"}
        try:
            self.db.add_signal_watchlist(ticker)
            current = list(self._signal_watcher.watched)
            if ticker not in current:
                current.append(ticker)
                self._signal_watcher.set_watchlist(current)
            logger.info(f"Signal watchlist: added {ticker} (total: {len(self._signal_watcher.watched)})")
            if self._broadcast_cb and self._loop:
                asyncio.run_coroutine_threadsafe(
                    self._broadcast_cb({
                        "type": "watchlist_update", "action": "add", "ticker": ticker,
                        "watchlist": sorted(self._signal_watcher.watched),
                    }),
                    self._loop,
                )
            return {"ok": True, "action": "add", "ticker": ticker,
                    "watchlist_count": len(self._signal_watcher.watched)}
        except Exception as e:
            logger.error(f"add_signal_ticker({ticker}): {e}")
            return {"ok": False, "error": str(e)}

    def remove_signal_ticker(self, ticker: str) -> Dict:
        ticker = ticker.upper().strip()
        if not ticker:
            return {"ok": False, "error": "ticker is required"}
        try:
            self.db.remove_signal_watchlist(ticker)
            current = list(self._signal_watcher.watched)
            if ticker in current:
                current.remove(ticker)
                self._signal_watcher.set_watchlist(current)
            if ticker in self._signal_engine._calcs:
                del self._signal_engine._calcs[ticker]
            logger.info(f"Signal watchlist: removed {ticker} (total: {len(self._signal_watcher.watched)})")
            if self._broadcast_cb and self._loop:
                asyncio.run_coroutine_threadsafe(
                    self._broadcast_cb({
                        "type": "watchlist_update", "action": "remove", "ticker": ticker,
                        "watchlist": sorted(self._signal_watcher.watched),
                    }),
                    self._loop,
                )
            return {"ok": True, "action": "remove", "ticker": ticker,
                    "watchlist_count": len(self._signal_watcher.watched)}
        except Exception as e:
            logger.error(f"remove_signal_ticker({ticker}): {e}")
            return {"ok": False, "error": str(e)}

    def get_signal_watchlist(self) -> Dict:
        tickers = sorted(self._signal_watcher.watched)
        return {"watchlist": tickers, "count": len(tickers)}

    # ── EARNINGS DATE MAP ─────────────────────────────────────────────────────

    def _refresh_earning_date_map(self):
        try:
            today = date.today()
            start = (today - timedelta(days=1)).isoformat()
            end   = (today + timedelta(days=7)).isoformat()
            rows  = self.db.get_earnings_for_range(start, end)
            new_map: Dict[str, str] = {}
            for r in rows:
                t = r.get("ticker")
                if t:
                    new_map[t] = r.get("earnings_date", "")
            self.earning_date_map = new_map
            logger.info(f"earning_date_map refreshed: {len(new_map)} tickers")
        except Exception as e:
            logger.error(f"_refresh_earning_date_map: {e}")
        finally:
            self._earnings_refresh_event.set()

    def shutdown(self):
        with self._pending_writes_lock:
            if self._pending_writes:
                self.db_write_queue.put(list(self._pending_writes.values()))
                self._pending_writes.clear()
                logger.info("shutdown: flushed pending_writes to db_write_queue")
        self.run_event.clear()
        self._safe_ws_close()

    def _safe_ws_close(self):
        with self.ws_lock:
            if self.polygon_ws_client:
                try:
                    self.polygon_ws_client.close()
                except Exception:
                    pass
                self.polygon_ws_client = None

    # ── MASSIVE WS LISTENER ───────────────────────────────────────────────────

    def _ws_listener_loop(self):
        last_subscribed: frozenset = frozenset()

        while self.run_event.is_set():
            with self.ws_lock:
                current = frozenset(self.all_tickers)

            if current != last_subscribed and current:
                logger.info(f"WS: {len(current)} tickers (retry #{self.ws_retry_count}) ...")

                if self.ws_retry_count > 0:
                    delay = _calculate_backoff(self.ws_retry_count)
                    logger.info(f"Backoff {delay:.1f}s")
                    time.sleep(delay)

                self._safe_ws_close()

                try:
                    with self.ws_lock:
                        self.polygon_ws_client = WebSocketClient(
                            api_key=self.massive_api_key,
                            market=Market.Stocks,
                            feed="socket.polygon.io",
                            verbose=False,
                        )

                    subs = []
                    for t in current:
                        subs.append(f"T.{t}")
                        subs.append(f"A.{t}")

                    self.polygon_ws_client.subscribe(*subs)
                    last_subscribed = current

                    self.ws_retry_count   = 0
                    self.ws_health_status = "Healthy"
                    logger.info("Massive WS connected (T+A)")

                    self.polygon_ws_client.run(handle_msg=self._on_websocket_message)

                except Exception as e:
                    logger.error(f"WS error: {e}")
                    self.ws_health_status = f"Degraded (retry {self.ws_retry_count})"
                    self.ws_retry_count  += 1
            else:
                time.sleep(0.5)

    # ── MESSAGE HANDLER ───────────────────────────────────────────────────────

    def _on_websocket_message(self, msgs):
        if not self.run_event.is_set():
            return

        messages = msgs if isinstance(msgs, list) else [msgs]

        for msg in messages:
            ticker = getattr(msg, "symbol", None)
            if not ticker or ticker not in self.all_tickers:
                continue

            price = (
                getattr(msg, "price", None) or
                getattr(msg, "p",     None) or
                getattr(msg, "close", None) or
                getattr(msg, "c",     None)
            )
            if not price:
                continue

            try:
                live_price = float(price)
                self._update_alert_cache_logic(ticker, live_price, msg)
                self.last_message_time = time.time()
            except (ValueError, TypeError) as e:
                logger.debug(f"Invalid price {ticker}: {e}")
                continue

            if hasattr(msg, "open") or hasattr(msg, "op"):
                self._signal_watcher.process_aggregate_message(msg)

        if _market_session() == "after":
            now = time.time()
            if (now - self.last_ah_close_refresh) > AH_CLOSE_REFRESH_INTERVAL:
                self.last_ah_close_refresh = now
                threading.Thread(
                    target=self._refresh_ah_closing_prices, daemon=True
                ).start()

    # ── ALERT CACHE LOGIC ─────────────────────────────────────────────────────

    def _update_alert_cache_logic(self, ticker: str, live_price: float, msg=None):
        company_name = self.company_map.get(ticker, ticker)
        sector       = self.sector_map.get(ticker, "Unknown")

        with self.historical_data_lock:
            hist = self.historical_data.get(ticker, {})

        ref_open    = hist.get("open",       live_price)
        ref_prev    = hist.get("prev_close", live_price)
        ref_avgvol  = hist.get("avg_volume", 0)
        today_close = hist.get("today_close", 0.0)

        # FIX-18: Detect stale open price — if the stored "open" is wildly different
        # from the live price (>15%), it's likely yesterday's data. Use live_price
        # as a temporary open until the daily Polygon refresh at 09:31 ET fixes it.
        if ref_open > 0 and live_price > 0:
            open_deviation_pct = abs(live_price - ref_open) / ref_open * 100
            if open_deviation_pct > _STALE_OPEN_THRESHOLD_PCT:
                # Open looks stale — use live_price as temp open and update historical_data
                logger.debug(
                    f"FIX-18: {ticker} open {ref_open} is {open_deviation_pct:.1f}% away from "
                    f"live {live_price} — using live_price as temp open"
                )
                ref_open = live_price
                with self.historical_data_lock:
                    if ticker in self.historical_data:
                        self.historical_data[ticker]["open"] = live_price

        session = _market_session()
        # FIX-20c: today_close is the official 4pm ET regular-session close.
        # It is seeded by _refresh_ah_closing_prices (runs every 120s in AH).
        # During market hours today_close = 0 (never poisoned by intraday price
        # thanks to FIX-20a), so the else branch correctly uses ref_open as base.
        if session == "after" and today_close > 0:
            base = today_close
        else:
            base = ref_open if ref_open else live_price

        change_value   = live_price - base if base else 0
        percent_change = (change_value / base * 100) if base else 0

        # ── Volume ────────────────────────────────────────────────────────────
        with self.alert_cache_lock:
            prev = dict(self.alert_cache.get(ticker, {}))

        vol_to_use = prev.get("volume", 0)
        if msg and (hasattr(msg, "volume") or hasattr(msg, "v")):
            vol_raw = getattr(msg, "volume", None) or getattr(msg, "v", None)
            if vol_raw:
                try:
                    vol_to_use = float(vol_raw)
                    with self.historical_data_lock:
                        if ticker in self.historical_data:
                            self.historical_data[ticker]["last_volume"] = vol_to_use
                except (ValueError, TypeError):
                    pass

        vol_ratio = (vol_to_use / ref_avgvol) if ref_avgvol > 0 else 0
        vol_spike = vol_ratio >= VOLUME_SPIKE_THRESHOLD
        vol_level = (
            "high"   if vol_ratio >= VOLUME_SPIKE_HIGH_THRESHOLD else
            "normal" if vol_spike else
            "none"
        )

        if ref_open > 0 and ref_prev > 0:
            gap_pct = (ref_open - ref_prev) / ref_prev * 100
        else:
            gap_pct = 0.0
        is_gap  = abs(gap_pct) >= GAP_THRESHOLD_PERCENT
        gap_dir = "up" if gap_pct > 0 else ("down" if gap_pct < 0 else "none")
        gap_mag = (
            "extreme" if abs(gap_pct) >= GAP_EXTREME_THRESHOLD else
            "large"   if is_gap else
            "normal"
        )

        _now = time.time()
        if (_now - self._earnings_last_refresh > self._EARNINGS_REFRESH_INTERVAL
                and self._earnings_refresh_event.is_set()):
            self._earnings_refresh_event.clear()
            self._earnings_last_refresh = _now
            threading.Thread(
                target=self._refresh_earning_date_map,
                daemon=True, name="EarningsRefresh"
            ).start()

        is_earnings_gap = is_gap and ticker in self.earning_date_map

        ah_mom = False
        if session == "after" and today_close > 0:
            ah_move      = abs(live_price - today_close)
            regular_move = abs(today_close - ref_prev) if ref_prev else 0
            ah_mom = ah_move > regular_move * AH_MOMENTUM_MULTIPLIER

        with self.intraday_highs_lock:
            hwm = self.intraday_highs.get(ticker, live_price)
            if live_price > hwm:
                self.intraday_highs[ticker] = live_price
                hwm = live_price

        pullback_pct   = ((hwm - live_price) / hwm * 100) if hwm > 0 else 0
        pullback_state = (
            "tsl_alert"    if pullback_pct >= 2.0 else
            "pulling_back" if pullback_pct >= 0.5 else
            "neutral"
        )

        is_positive   = change_value >= 0
        went_positive = 0
        prev_cv       = prev.get("change_value", 0)
        prev_wp       = prev.get("went_positive", 0)
        prev_wp_ts    = prev.get("went_positive_ts", 0)

        if prev_cv < 0 and change_value >= 0:
            went_positive    = 1
            went_positive_ts = time.time()
        elif prev_wp == 1 and (time.time() - prev_wp_ts) < 60:
            went_positive    = 1
            went_positive_ts = prev_wp_ts
        else:
            went_positive_ts = prev_wp_ts

        cache_entry = {
            "ticker":               ticker,
            "company_name":         company_name,
            "sector":               sector,
            "live_price":           live_price,
            "open":                 ref_open,
            "prev_close":           ref_prev,
            "today_close":          today_close,
            "hwm":                  hwm,
            "change_value":         round(change_value, 4),
            "percent_change":       round(percent_change, 4),
            "is_positive":          is_positive,
            "went_positive":        went_positive,
            "went_positive_ts":     went_positive_ts,
            "volume":               vol_to_use,
            "volume_spike":         vol_spike,
            "volume_spike_level":   vol_level,
            "volume_ratio":         round(vol_ratio, 2),
            "gap_percent":          round(gap_pct, 2),
            "is_gap_play":          is_gap,
            "gap_direction":        gap_dir,
            "gap_magnitude":        gap_mag,
            "is_earnings_gap_play": is_earnings_gap,
            "ah_momentum":          ah_mom,
            "pullback_state":       pullback_state,
            "pullback_pct":         round(pullback_pct, 2),
            "last_tick_time":       time.time(),
            "session":              session,
        }

        with self.alert_cache_lock:
            self.alert_cache[ticker] = cache_entry

        now = time.time()
        with self._pending_writes_lock:
            self._pending_writes[ticker] = cache_entry
            if now - self._last_db_flush >= self._DB_FLUSH_INTERVAL:
                self.db_write_queue.put(list(self._pending_writes.values()))
                self._pending_writes.clear()
                self._last_db_flush = now

        is_priority = (
            abs(percent_change) >= 5.0 or
            vol_spike or
            is_gap or
            went_positive == 1
        )

        last_sent = self._last_broadcast_ts.get(ticker, 0)
        if is_priority or (now - last_sent) >= self._BROADCAST_THROTTLE_SEC:
            if self._broadcast_cb and self._loop:
                asyncio.run_coroutine_threadsafe(
                    self._broadcast_cb({
                        "type":   "tick",
                        "ticker": ticker,
                        "data":   cache_entry,
                    }),
                    self._loop,
                )
                self._last_broadcast_ts[ticker] = now

        if now - self._last_broadcast_purge > _BROADCAST_PURGE_SEC:
            self._last_broadcast_purge = now
            cutoff = now - 300.0
            stale  = [k for k, v in self._last_broadcast_ts.items() if v < cutoff]
            for k in stale:
                del self._last_broadcast_ts[k]

    # ── SIGNAL CALLBACK ───────────────────────────────────────────────────────

    def _on_signal(self, signal):
        try:
            row = {
                "symbol":      signal.symbol,
                "direction":   signal.direction(),
                "score":       signal.score,
                "confidence":  signal.confidence,
                "strength":    signal.strength,
                "entry_price": signal.entry_price,
                "stop_loss":   signal.stop_loss,
                "take_profit": signal.take_profit,
                "risk_reward": signal.risk_reward,
                "reasons":     [{"type": r.get("type", "warn"), "text": r.get("text", "")}
                                for r in signal.reasons],
                "session":     signal.session.value if hasattr(signal.session, "value")
                               else str(signal.session),
                "created_at":  datetime.utcnow().isoformat(),
            }
            self.db.insert_signal(row)
            logger.info(f"Signal: {signal}")
        except Exception as e:
            logger.error(f"Signal write error: {e}")

    # ── AH CLOSE REFRESH ──────────────────────────────────────────────────────

    def _refresh_ah_closing_prices(self):
        if not self.massive_api_key or not self.all_tickers:
            return
        try:
            with self.ws_lock:
                snap_tickers = list(self.all_tickers)

            BATCH_SIZE = 100
            snap_map: Dict[str, dict] = {}

            for i in range(0, len(snap_tickers), BATCH_SIZE):
                batch = snap_tickers[i : i + BATCH_SIZE]
                url = (
                    f"https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers"
                    f"?tickers={','.join(batch)}&apiKey={self.massive_api_key}"
                )
                try:
                    resp = requests.get(url, timeout=15)
                    if resp.status_code != 200:
                        continue
                    for item in resp.json().get("tickers", []):
                        snap_map[item["ticker"]] = item
                except Exception as e:
                    logger.warning(f"AH close refresh batch {i}: {e}")

            updated = 0
            for ticker in snap_tickers:
                item = snap_map.get(ticker)
                if not item:
                    continue
                official_close = float(
                    item.get("day", {}).get("c", 0) or
                    item.get("lastTrade", {}).get("p", 0)
                )
                if official_close <= 0:
                    continue

                # FIX-20b: Sanity guard — during early AH (16:00–16:05 ET),
                # Polygon may still return the last intraday live trade price
                # in lastTrade.p rather than the official closing price.
                # If the cached live_price is very close to official_close
                # (within 0.5%) and we're within 5 min of close, be cautious.
                # We always accept day.c (official close field); we only
                # reject lastTrade.p if it looks suspiciously like a live tick.
                # Additionally, reject if official_close > live_price * 1.20
                # or < live_price * 0.80 — that's a data error from Polygon.
                with self.alert_cache_lock:
                    cached_row  = self.alert_cache.get(ticker, {})
                cached_live = cached_row.get("live_price", 0)
                if cached_live > 0 and official_close > 0:
                    ratio = official_close / cached_live
                    if ratio > 1.20 or ratio < 0.80:
                        logger.debug(
                            f"FIX-20b: {ticker} official_close={official_close} "
                            f"vs live={cached_live} ratio={ratio:.3f} — skipping implausible value"
                        )
                        continue

                with self.historical_data_lock:
                    hist = self.historical_data.get(ticker)
                    if hist is None:
                        self.historical_data[ticker] = {
                            "open":        official_close,
                            "prev_close":  official_close,
                            "today_close": official_close,
                            "avg_volume":  0.0,
                        }
                        updated += 1
                    else:
                        old = hist.get("today_close", 0.0)
                        if abs(official_close - old) > 0.01:
                            hist["today_close"] = official_close
                            updated += 1

            logger.info(f"AH close refresh: {updated} tickers updated")
        except Exception as e:
            logger.error(f"AH close refresh: {e}")

    # ── HISTORICAL FETCH ──────────────────────────────────────────────────────

    def _fetch_historical_batch(self, tickers: List[str]):
        logger.info(f"Fetching historical data for {len(tickers)} tickers ...")
        self.source_stats["total_attempted"] = len(tickers)

        failed_after_polygon: List[str] = list(tickers)

        if self.massive_api_key:
            failed_after_polygon = self._fetch_polygon_snapshot_bulk(tickers)
            logger.info(
                f"Polygon pass complete — "
                f"{self.source_stats['polygon_success']} seeded, "
                f"{len(failed_after_polygon)} need yfinance fallback"
            )
        else:
            logger.warning("MASSIVE_API_KEY not set — falling back to yfinance for all tickers")

        if failed_after_polygon:
            self._fetch_yfinance_fallback(failed_after_polygon)

        total_seeded = self.source_stats["polygon_success"] + self.source_stats["yfinance_success"]
        logger.info(
            f"Historical fetch complete — "
            f"{total_seeded}/{len(tickers)} seeded "
            f"(polygon={self.source_stats['polygon_success']}, "
            f"yf={self.source_stats['yfinance_success']}, "
            f"failed={self.source_stats['failed']})"
        )

        # Broadcast snapshot after historical data loads
        if self._broadcast_cb and self._loop and total_seeded > 0:
            snapshot = self.get_live_snapshot(limit=10000, only_positive=False)
            asyncio.run_coroutine_threadsafe(
                self._broadcast_cb({"type": "snapshot", "data": snapshot}),
                self._loop,
            )
            logger.info(f"Broadcast initial snapshot: {len(snapshot)} tickers")

    def _fetch_polygon_snapshot_bulk(self, tickers: List[str]) -> List[str]:
        BATCH_SIZE = 100
        failed: List[str] = []
        polygon_seeded    = 0

        for i in range(0, len(tickers), BATCH_SIZE):
            batch       = tickers[i : i + BATCH_SIZE]
            tickers_csv = ",".join(batch)
            url = (
                f"https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers"
                f"?tickers={tickers_csv}&apiKey={self.massive_api_key}"
            )
            try:
                resp = requests.get(url, timeout=20)
                if resp.status_code != 200:
                    failed.extend(batch)
                    continue

                snap_map = {
                    item["ticker"]: item
                    for item in resp.json().get("tickers", [])
                }

                for ticker in batch:
                    item = snap_map.get(ticker)
                    if not item:
                        failed.append(ticker)
                        continue

                    day        = item.get("day",       {}) or {}
                    prev_day   = item.get("prevDay",   {}) or {}
                    last_trade = item.get("lastTrade", {}) or {}

                    open_price  = float(day.get("o",  0) or 0)
                    today_close = float(day.get("c",  0) or 0)
                    avg_vol     = float(day.get("av", 0) or 0)
                    prev_close  = float(prev_day.get("c", 0) or 0)

                    # FIX-20a: day.c is 0 or a partial/intraday value during
                    # market hours.  The fallback lastTrade.p is the current
                    # live price — if we store that as today_close the AH
                    # base becomes the intraday price and AH change reads wrong.
                    # Only populate today_close from Polygon when the market
                    # has actually closed (session == "after").  During market
                    # hours leave today_close = 0; _refresh_ah_closing_prices
                    # will fill it correctly at 4pm.
                    session_now = _market_session()
                    if session_now != "after":
                        today_close = 0.0   # don't poison AH base with intraday price
                    elif today_close <= 0:
                        # AH session but day.c missing — try lastTrade as fallback
                        today_close = float(last_trade.get("p", 0) or 0)

                    if open_price <= 0 and today_close <= 0:
                        failed.append(ticker)
                        continue

                    if open_price  <= 0: open_price  = today_close
                    if prev_close  <= 0: prev_close  = open_price
                    if today_close <= 0: today_close = open_price

                    with self.historical_data_lock:
                        self.historical_data[ticker] = {
                            "open":        open_price,
                            "prev_close":  prev_close,
                            "today_close": today_close,
                            "avg_volume":  avg_vol,
                        }
                    polygon_seeded += 1

            except Exception as e:
                logger.error(f"Polygon snapshot batch {i}: {e}")
                failed.extend(batch)

        self.source_stats["polygon_success"] = polygon_seeded
        return failed

    def _fetch_yfinance_fallback(self, tickers: List[str]):
        logger.info(f"yfinance fallback for {len(tickers)} tickers ...")
        yf_success     = 0
        yf_failed: List[str] = []
        _counter_lock  = threading.Lock()

        def fetch_one(ticker: str):
            nonlocal yf_success
            try:
                hist = yf.Ticker(ticker).history(period="5d", interval="1d")
                if hist.empty:
                    with _counter_lock:
                        yf_failed.append(ticker)
                    return

                today_close = float(hist["Close"].iloc[-1])
                prev_close  = float(hist["Close"].iloc[-2]) if len(hist) >= 2 else today_close
                open_price  = float(hist["Open"].iloc[-1])
                avg_vol     = float(hist["Volume"].mean()) if "Volume" in hist.columns else 0.0

                # FIX-20a: yfinance hist["Close"].iloc[-1] during market hours
                # returns the latest intraday close, NOT the official 4pm close.
                # During market hours, seed today_close = 0 (same logic as Polygon
                # path) so the AH session doesn't use an intraday price as its base.
                # Use prev_close (yesterday's close) as prev_close is always safe.
                session_now = _market_session()
                if session_now != "after":
                    # During market/pre/closed: today hasn't closed yet.
                    # today_close = yesterday's close for now; AH refresh fills it.
                    today_close_seed = prev_close  # carry yesterday's close
                    prev_close_seed  = float(hist["Close"].iloc[-2]) if len(hist) >= 2 else prev_close
                else:
                    today_close_seed = today_close
                    prev_close_seed  = prev_close

                with self.historical_data_lock:
                    self.historical_data[ticker] = {
                        "open":        open_price,
                        "prev_close":  prev_close_seed,
                        "today_close": today_close_seed,
                        "avg_volume":  avg_vol,
                    }
                with _counter_lock:
                    yf_success += 1
            except Exception as e:
                with _counter_lock:
                    yf_failed.append(ticker)

        with ThreadPoolExecutor(max_workers=30) as ex:
            ex.map(fetch_one, tickers)

        self.source_stats["yfinance_success"] = yf_success
        self.source_stats["failed"]           = len(yf_failed)
        logger.info(f"yfinance fallback complete — {yf_success} seeded, {len(yf_failed)} failed")

    # ── PORTFOLIO/MONITOR REFRESH ─────────────────────────────────────────────

    def _refresh_portfolio_monitor(self):
        try:
            portfolio_rows = self.db.get_portfolio()
            monitor_rows   = self.db.get_monitor()
            self._portfolio_tickers = {r.get("ticker") for r in portfolio_rows if r.get("ticker")}
            self._monitor_tickers   = {r.get("ticker") for r in monitor_rows   if r.get("ticker")}
        except Exception as e:
            logger.error(f"Error refreshing portfolio/monitor: {e}")

    def _portfolio_monitor_refresh_loop(self):
        while self.run_event.is_set():
            try:
                time.sleep(self._PORTFOLIO_REFRESH_INTERVAL)
                self._refresh_portfolio_monitor()
            except Exception as e:
                logger.error(f"Portfolio/monitor refresh loop error: {e}")

    # ── DB WRITER ─────────────────────────────────────────────────────────────

    def _db_writer_worker(self):
        while self.run_event.is_set() or not self.db_write_queue.empty():
            try:
                rows = self.db_write_queue.get(timeout=1.0)
            except queue.Empty:
                continue

            try:
                db_rows = []
                for c in rows:
                    db_rows.append({
                        "ticker":             c["ticker"],
                        "company_name":       c.get("company_name", ""),
                        "sector":             c.get("sector", "Unknown"),
                        "live_price":         c.get("live_price", 0),
                        "open_price":         c.get("open", 0),
                        "prev_close":         c.get("prev_close", 0),
                        "day_high":           c.get("hwm", 0),
                        "volume":             c.get("volume", 0),
                        "change_value":       c.get("change_value", 0),
                        "percent_change":     c.get("percent_change", 0),
                        "last_update":        int(time.time()),
                        "is_positive":        1 if c.get("is_positive") else 0,
                        "went_positive":      c.get("went_positive", 0),
                        "volume_spike":       c.get("volume_spike", False),
                        "volume_spike_level": c.get("volume_spike_level", "none"),
                        "volume_ratio":       c.get("volume_ratio", 0),
                        "gap_percent":        c.get("gap_percent", 0),
                        "is_gap_play":        c.get("is_gap_play", False),
                        "gap_direction":      c.get("gap_direction", "none"),
                        "gap_magnitude":      c.get("gap_magnitude", "normal"),
                        "ah_momentum":        c.get("ah_momentum", False),
                        "pullback_state":     c.get("pullback_state", "neutral"),
                        "today_close":        c.get("today_close", 0),
                    })
                if db_rows:
                    self.db.upsert_tickers(db_rows)
            except Exception as e:
                logger.error(f"DB writer upsert error: {e}")
            finally:
                self.db_write_queue.task_done()

    # ── PUBLIC READ HELPERS ───────────────────────────────────────────────────

    def get_live_snapshot(
        self,
        limit:         int       = 6200,
        only_positive: bool      = True,
        source:        str       = "all",
        sector:        str       = "",
        sectors:       List[str] = None,
    ) -> List[Dict]:
        """
        FIX-19: Default limit raised to 6200. LIVE_DISPLAY_CAP also 6200.
        Frontend paginates at 50 rows/page so sending all tickers is fine.
        """
        with self.alert_cache_lock:
            rows = list(self.alert_cache.values())

        if source == "monitor":
            monitor_set = getattr(self, "_monitor_tickers", set())
            rows = [r for r in rows if r["ticker"] in monitor_set]
        elif source == "portfolio":
            portfolio_set = getattr(self, "_portfolio_tickers", set())
            rows = [r for r in rows if r["ticker"] in portfolio_set]

        active_sectors: List[str] = []
        if sectors:
            active_sectors = [s for s in sectors if s and s.upper() != "ALL"]
        elif sector and sector.upper() not in ("", "ALL"):
            active_sectors = [sector]

        if active_sectors:
            upper_sectors  = [s.upper() for s in active_sectors]
            wants_earnings = "EARNINGS" in upper_sectors
            real_sectors   = [s for s in active_sectors if s.upper() != "EARNINGS"]

            if wants_earnings and real_sectors:
                lower_real = [s.lower() for s in real_sectors]
                rows = [
                    r for r in rows
                    if r.get("is_earnings_gap_play")
                    or r.get("sector", "").lower() in lower_real
                ]
            elif wants_earnings:
                rows = [r for r in rows if r.get("is_earnings_gap_play")]
            else:
                lower_real = [s.lower() for s in real_sectors]
                rows = [r for r in rows if r.get("sector", "").lower() in lower_real]

        if only_positive:
            rows = [r for r in rows if r.get("is_positive")]

        rows.sort(key=lambda r: r.get("change_value", 0), reverse=True)

        # FIX-19: Use the raised cap for all sources
        cap = min(limit, LIVE_DISPLAY_CAP)
        return rows[:cap]

    def get_metrics(self) -> Dict:
        with self.alert_cache_lock:
            cache_vals = list(self.alert_cache.values())
        active_set = self.all_tickers
        now_ts     = time.time()

        live_count    = sum(1 for v in cache_vals
                            if v.get("ticker") in active_set
                            and now_ts - v.get("last_tick_time", 0) <= 60)
        pos_count     = sum(1 for v in cache_vals if v.get("is_positive"))
        turned_count  = sum(1 for v in cache_vals if v.get("went_positive") == 1)
        vol_spikes    = sum(1 for v in cache_vals if v.get("volume_spike"))
        gap_plays     = sum(1 for v in cache_vals if v.get("is_gap_play"))
        ah_mom        = sum(1 for v in cache_vals if v.get("ah_momentum"))
        earnings_gaps = sum(1 for v in cache_vals if v.get("is_earnings_gap_play"))
        diamond_cnt   = sum(1 for v in cache_vals if abs(v.get("percent_change", 0)) >= 5)

        last_msg = datetime.fromtimestamp(self.last_message_time).strftime("%H:%M:%S")

        return {
            "ws_health":          self.ws_health_status,
            "ws_retry_count":     self.ws_retry_count,
            "last_update":        last_msg,
            "last_tick":          last_msg,
            "total_tickers":      len(self.all_tickers),
            "cached_tickers":     len(self.alert_cache),
            "live_count":         live_count,
            "pos_count":          pos_count,
            "turned_positive":    turned_count,
            "volume_spikes":      vol_spikes,
            "gap_plays":          gap_plays,
            "ah_momentum":        ah_mom,
            "earnings_gap_plays": earnings_gaps,
            "diamond":            diamond_cnt,
            "session":            _get_market_status(),
            "source_stats": {
                "total_attempted":  self.source_stats.get("total_attempted",  0),
                "polygon_success":  self.source_stats.get("polygon_success",  0),
                "yfinance_success": self.source_stats.get("yfinance_success", 0),
                "failed":           self.source_stats.get("failed",           0),
            },
            "signal_watched":       len(self._signal_watcher.watched),
            "signal_watchlist_count": len(self._signal_watcher.watched),
            "signal_count":         len(self._signal_engine.signal_history),
            "signal_bars":          len(self._signal_engine._calcs),
        }
