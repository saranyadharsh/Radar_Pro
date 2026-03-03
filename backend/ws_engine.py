"""
ws_engine.py — NexRadar Pro
============================
Cloud-safe WebSocket engine.

Uses:
  - Massive WebSocketClient (same import as original)
  - T.* trades + A.* aggregate subscriptions (identical to original)
  - ALL alert logic from Stock_dashboard_ws_smartalert.py (unchanged)
  - Scalping_Signal.py ScalpingSignalEngine + SignalWatchlistManager (identical)
  - Supabase writes instead of SQLite

Removed (Windows-only):
  winsound, pyttsx3, ctypes, webbrowser, rich.live, winotify
"""

import os
import time
import asyncio
import threading
import queue
import logging
import random
from datetime import datetime, time as dt_time
from typing import Dict, List, Optional, Set, Callable
from concurrent.futures import ThreadPoolExecutor

import pytz
import yfinance as yf
import requests



# ── SSL fix ──────────────────────────────────────────────────────────────────
import os as _os
_os.environ.pop("SSL_CERT_FILE", None)

from massive import WebSocketClient, RESTClient
from massive.websocket.models import WebSocketMessage, Market

from supabase_db import SupabaseDB

# ── Scalping Signal Engine — identical to original ───────────────────────────
# Change this in ws_engine.py:
from Scalping_Signal import (
    ScalpingSignalEngine,
    SignalWatchlistManager,
    OHLCVBar,
    TradeSignal,  # <--- Change from SignalPayload to TradeSignal
)

logger = logging.getLogger(__name__)

ET_TZ = pytz.timezone("America/New_York")

# ── Constants (identical to Stock_dashboard_ws_smartalert.py) ─────────────────
VOLUME_SPIKE_THRESHOLD       = 2.0
VOLUME_SPIKE_HIGH_THRESHOLD  = 5.0
GAP_THRESHOLD_PERCENT        = 3.0
GAP_EXTREME_THRESHOLD        = 10.0
AH_MOMENTUM_MULTIPLIER       = 1.5
PRICE_STALE_SECONDS          = 300
AH_CLOSE_REFRESH_INTERVAL    = 120
MAX_WEBSOCKET_TICKERS        = 1500
WS_BACKOFF_BASE_DELAY        = 1.0
WS_BACKOFF_MAX_DELAY         = 60.0

DEFAULT_SIGNAL_WATCHLIST = [
    "AAPL","LITE","GOOGL","LMT","SNDK","WDC","ORCL","MU","NVDA","SPOT",
    "SHOP","AMD","TSLA","GRMN","META","RKLB","STX","CHTR","AMZN","DE",
    "TER","IDCC","MSFT","MDB","AVGO",
]


def _market_session() -> str:
    t = datetime.now(ET_TZ).time()
    if dt_time(4, 0) <= t < dt_time(9, 30):   return "pre"
    elif dt_time(9, 30) <= t < dt_time(16, 0): return "market"
    elif dt_time(16, 0) <= t < dt_time(20, 0): return "after"
    return "closed"


def _get_market_status() -> str:
    """Mirrors get_market_status() from Radar_Production.py."""
    now = datetime.now(ET_TZ)
    t = now.time()
    if now.weekday() >= 5:
        return "CLOSED_WEEKEND"
    if dt_time(20, 0) <= t or t < dt_time(4, 0):
        return "OVERNIGHT_SLEEP"
    if dt_time(4, 0) <= t < dt_time(9, 30):
        return "PRE_MARKET"
    if dt_time(9, 30) <= t < dt_time(16, 0):
        return "MARKET_HOURS"
    if dt_time(16, 0) <= t < dt_time(20, 0):
        return "AFTER_HOURS"
    return "CLOSED"


def _calculate_backoff(retry_count: int) -> float:
    delay = min(WS_BACKOFF_BASE_DELAY * (2 ** retry_count), WS_BACKOFF_MAX_DELAY)
    return delay * random.uniform(0.8, 1.2)


class WSEngine:
    """
    Cloud WebSocket engine — mirrors StockDashboard from
    Stock_dashboard_ws_smartalert.py with all alert logic preserved.
    """

    def __init__(self, broadcast_cb: Optional[Callable] = None, loop=None):
        self.massive_api_key: str = os.getenv("MASSIVE_API_KEY", "")
        self.db = SupabaseDB()
        self._broadcast_cb = broadcast_cb
        self._loop = loop

        # ── State mirrors original StockDashboard ─────────────────────────────
        self.all_tickers: Set[str]            = set()
        self.company_map: Dict[str, str]      = {}
        self.alert_cache: Dict[str, Dict]     = {}
        self.alert_cache_lock                 = threading.Lock()
        self.historical_data: Dict[str, Dict] = {}
        self.historical_data_lock             = threading.Lock()
        self.intraday_highs: Dict[str, float] = {}

        # ── WebSocket state ───────────────────────────────────────────────────
        self.ws_health_status    = "connecting"
        self.ws_retry_count      = 0
        self.last_message_time   = time.time()
        self.polygon_ws_client: Optional[WebSocketClient] = None
        self.ws_lock             = threading.Lock()

        # ── AH close refresh ──────────────────────────────────────────────────
        self.last_ah_close_refresh = 0.0

        # ── Scalping Signal Engine (identical to original) ────────────────────
        self._signal_engine  = ScalpingSignalEngine()
        self._signal_watcher = SignalWatchlistManager(self._signal_engine)
        self._signal_watcher.set_watchlist(DEFAULT_SIGNAL_WATCHLIST)

        # Register signal callback → write to Supabase
        self._signal_engine.on_signal(self._on_signal)

        # ── Source stats (mirrors original source_stats) ──────────────────────
        self.source_stats = {
            "total_attempted": 0,
            "polygon_success": 0,
            "yfinance_fallback": 0,
        }

        # ── Threading ─────────────────────────────────────────────────────────
        self.run_event = threading.Event()
        self.run_event.set()

        self._pending_writes: Dict[str, Dict] = {}
        self._last_db_flush  = time.time()
        self._DB_FLUSH_INTERVAL = 1.0

        self.db_write_queue: queue.Queue = queue.Queue()
        self._db_thread = threading.Thread(
            target=self._db_writer_worker, daemon=True, name="DBWriter"
        )
        self._db_thread.start()

        logger.info("✅ WSEngine initialised")

    # ── START / STOP ──────────────────────────────────────────────────────────

    def start(self, tickers: List[str], company_map: Dict[str, str]):
        self.all_tickers = set(tickers[:MAX_WEBSOCKET_TICKERS])
        self.company_map = company_map

        threading.Thread(
            target=self._fetch_historical_batch,
            args=(list(self.all_tickers),),
            daemon=True, name="HistFetch"
        ).start()

        threading.Thread(
            target=self._ws_listener_loop, daemon=True, name="MassiveWS"
        ).start()

        logger.info(f"WSEngine started — {len(self.all_tickers)} tickers")

    def shutdown(self):
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

    # ── MASSIVE WS LISTENER (mirrors original _websocket_listener_thread) ────

    def _ws_listener_loop(self):
        last_subscribed: Set[str] = set()

        while self.run_event.is_set():
            with self.ws_lock:
                current = set(self.all_tickers)

            if current != last_subscribed and current:
                logger.info(f"🔄 WS: {len(current)} tickers (retry #{self.ws_retry_count}) …")

                if self.ws_retry_count > 0:
                    delay = _calculate_backoff(self.ws_retry_count)
                    logger.info(f"⏳ Backoff {delay:.1f}s")
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

                    # T.* (trades) + A.* (1-min aggregates) — identical to original
                    subs = []
                    for t in current:
                        subs.append(f"T.{t}")
                        subs.append(f"A.{t}")

                    self.polygon_ws_client.subscribe(*subs)
                    last_subscribed = current

                    self.ws_retry_count   = 0
                    self.ws_health_status = "Healthy"
                    logger.info("✅ Massive WS connected (T+A)")

                    # Blocking — mirrors original .run(handle_msg=...)
                    self.polygon_ws_client.run(handle_msg=self._on_websocket_message)

                except Exception as e:
                    logger.error(f"❌ WS error: {e}")
                    self.ws_health_status = f"Degraded (retry {self.ws_retry_count})"
                    self.ws_retry_count  += 1
            else:
                time.sleep(0.5)

    # ── MESSAGE HANDLER (mirrors original _on_websocket_message exactly) ──────

    def _on_websocket_message(self, msgs):
        if not self.run_event.is_set():
            return

        messages = msgs if isinstance(msgs, list) else [msgs]

        for msg in messages:
            ticker = getattr(msg, "symbol", None)
            if not ticker or ticker not in self.all_tickers:
                continue

            # Try all price attrs — T.* uses price/p, A.* uses close/c
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

            # Feed A.* bars to Scalping Signal Engine (identical to original)
            if hasattr(msg, "open") or hasattr(msg, "op"):
                self._signal_watcher.process_aggregate_message(msg)

        # AH close refresh every 2 min (mirrors original)
        if _market_session() == "after":
            now = time.time()
            if (now - self.last_ah_close_refresh) > AH_CLOSE_REFRESH_INTERVAL:
                self.last_ah_close_refresh = now
                threading.Thread(
                    target=self._refresh_ah_closing_prices, daemon=True
                ).start()

    # ── ALERT CACHE LOGIC (mirrors original _update_alert_cache_logic) ───────

    def _update_alert_cache_logic(self, ticker: str, live_price: float, msg=None):
        company_name = self.company_map.get(ticker, ticker)

        with self.historical_data_lock:
            hist = self.historical_data.get(ticker, {})

        ref_open    = hist.get("open",       live_price)
        ref_prev    = hist.get("prev_close", live_price)
        ref_avgvol  = hist.get("avg_volume", 0)
        today_close = hist.get("today_close", 0.0)

        # Change vs open (market hours) or today_close (AH)
        session = _market_session()
        if session == "after" and today_close > 0:
            base = today_close
        else:
            base = ref_open if ref_open else live_price

        change_value   = live_price - base if base else 0
        percent_change = (change_value / base * 100) if base else 0

        # Volume from A.* message if available
        with self.alert_cache_lock:
            prev = self.alert_cache.get(ticker, {})

        vol_to_use = prev.get("volume", 0)
        if msg and (hasattr(msg, "volume") or hasattr(msg, "v")):
            vol_raw = getattr(msg, "volume", None) or getattr(msg, "v", None)
            if vol_raw:
                try:
                    vol_to_use = float(vol_raw)
                    # Update avg_volume in historical
                    with self.historical_data_lock:
                        if ticker in self.historical_data:
                            self.historical_data[ticker]["last_volume"] = vol_to_use
                except (ValueError, TypeError):
                    pass

        vol_ratio  = (vol_to_use / ref_avgvol) if ref_avgvol > 0 else 0
        vol_spike  = vol_ratio >= VOLUME_SPIKE_THRESHOLD
        vol_level  = (
            "high"   if vol_ratio >= VOLUME_SPIKE_HIGH_THRESHOLD else
            "normal" if vol_spike else
            "none"
        )

        # Gap detection (vs prev close)
        gap_pct = ((ref_open - ref_prev) / ref_prev * 100) if ref_prev else 0
        is_gap  = abs(gap_pct) >= GAP_THRESHOLD_PERCENT
        gap_dir = "up" if gap_pct > 0 else ("down" if gap_pct < 0 else "none")
        gap_mag = (
            "extreme" if abs(gap_pct) >= GAP_EXTREME_THRESHOLD else
            "large"   if is_gap else
            "normal"
        )

        # Earnings gap play flag
        is_earnings_gap = is_gap and hasattr(self, "earning_date_map") and ticker in getattr(self, "earning_date_map", {})

        # AH momentum (mirrors original)
        ah_mom = False
        if session == "after" and today_close > 0:
            ah_move      = abs(live_price - today_close)
            regular_move = abs(today_close - ref_prev) if ref_prev else 0
            ah_mom = ah_move > regular_move * AH_MOMENTUM_MULTIPLIER

        # Intraday high-water mark (HWM) + pullback state
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

        # Positive / went_positive (60s sticky window — mirrors v4.2 fix)
        is_positive = change_value >= 0
        went_positive = 0
        with self.alert_cache_lock:
            prev_cv        = prev.get("change_value", 0)
            prev_wp        = prev.get("went_positive", 0)
            prev_wp_ts     = prev.get("went_positive_ts", 0)
        if prev_cv < 0 and change_value >= 0:
            went_positive = 1
            went_positive_ts = time.time()
        elif prev_wp == 1 and (time.time() - prev_wp_ts) < 60:
            went_positive    = 1
            went_positive_ts = prev_wp_ts
        else:
            went_positive_ts = prev.get("went_positive_ts", 0)

        cache_entry = {
            "ticker":              ticker,
            "company_name":        company_name,
            "live_price":          live_price,
            "open":                ref_open,
            "prev_close":          ref_prev,
            "today_close":         today_close,
            "hwm":                 hwm,
            "change_value":        round(change_value, 4),
            "percent_change":      round(percent_change, 4),
            "is_positive":         is_positive,
            "went_positive":       went_positive,
            "went_positive_ts":    went_positive_ts,
            "volume":              vol_to_use,
            "volume_spike":        vol_spike,
            "volume_spike_level":  vol_level,
            "volume_ratio":        round(vol_ratio, 2),
            "gap_percent":         round(gap_pct, 2),
            "is_gap_play":         is_gap,
            "gap_direction":       gap_dir,
            "gap_magnitude":       gap_mag,
            "is_earnings_gap_play": is_earnings_gap,
            "ah_momentum":         ah_mom,
            "pullback_state":      pullback_state,
            "pullback_pct":        round(pullback_pct, 2),
            "last_tick_time":      time.time(),
            "session":             session,
        }

        with self.alert_cache_lock:
            self.alert_cache[ticker] = cache_entry

        # Queue DB write
        self._pending_writes[ticker] = cache_entry
        now = time.time()
        if now - self._last_db_flush >= self._DB_FLUSH_INTERVAL:
            self.db_write_queue.put(list(self._pending_writes.values()))
            self._pending_writes.clear()
            self._last_db_flush = now

        # Broadcast to React
        if self._broadcast_cb and self._loop:
            asyncio.run_coroutine_threadsafe(
                self._broadcast_cb({"type": "tick", "ticker": ticker, "data": cache_entry}),
                self._loop,
            )

    # ── SIGNAL CALLBACK ───────────────────────────────────────────────────────

    def _on_signal(self, signal):
        """Fires when ScalpingSignalEngine emits a TradeSignal. Writes to Supabase."""
        try:
            row = {
                "symbol":       signal.symbol,
                "direction":    signal.direction(),
                "score":        signal.score,
                "confidence":   signal.confidence,
                "strength":     signal.strength,
                "entry_price":  signal.entry_price,
                "stop_loss":    signal.stop_loss,
                "take_profit":  signal.take_profit,
                "risk_reward":  signal.risk_reward,
                "reasons":      [{"type": r.get("type","warn"), "text": r.get("text","")} for r in signal.reasons],
                "session":      signal.session.value if hasattr(signal.session, "value") else str(signal.session),
                "timestamp":    signal.timestamp.strftime("%H:%M:%S"),
                "created_at":   datetime.utcnow().isoformat(),
            }
            self.db.insert_signal(row)
            logger.info(f"⚡ Signal: {signal}")
        except Exception as e:
            logger.error(f"Signal write error: {e}")

    # ── AH CLOSE REFRESH (mirrors original _refresh_ah_closing_prices) ────────

    def _refresh_ah_closing_prices(self):
        if not self.massive_api_key or not self.all_tickers:
            return
        try:
            with self.ws_lock:
                snap = set(self.all_tickers)

            url  = (
                f"https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers"
                f"?apiKey={self.massive_api_key}"
            )
            resp = requests.get(url, timeout=15)
            if resp.status_code != 200:
                return

            snap_map = {item["ticker"]: item for item in resp.json().get("tickers", [])}
            updated  = 0

            for ticker in snap:
                item = snap_map.get(ticker)
                if not item:
                    continue
                official_close = float(
                    item.get("day", {}).get("c", 0) or
                    item.get("lastTrade", {}).get("p", 0)
                )
                if official_close <= 0:
                    continue

                with self.historical_data_lock:
                    hist = self.historical_data.get(ticker)
                    if hist is None:
                        continue
                    old = hist.get("today_close", 0.0)
                    if abs(official_close - old) > 0.01:
                        hist["today_close"] = official_close
                        updated += 1

                with self.alert_cache_lock:
                    cur_live = self.alert_cache.get(ticker, {}).get("live_price", 0.0)
                if cur_live > 0:
                    self._update_alert_cache_logic(ticker, cur_live)

            logger.info(f"AH close refresh: {updated} tickers updated")
        except Exception as e:
            logger.error(f"AH close refresh: {e}")

    # ── HISTORICAL FETCH (mirrors original _fetch_historical_batch) ───────────

    def _fetch_historical_batch(self, tickers: List[str]):
        logger.info(f"Fetching historical data for {len(tickers)} tickers …")
        self.source_stats["total_attempted"] = len(tickers)

        def fetch_one(ticker):
            try:
                hist = yf.Ticker(ticker).history(period="5d", interval="1d")
                if hist.empty:
                    return
                today_close = float(hist["Close"].iloc[-1])
                prev_close  = float(hist["Close"].iloc[-2]) if len(hist) >= 2 else today_close
                open_price  = float(hist["Open"].iloc[-1])
                avg_vol     = float(hist["Volume"].mean()) if "Volume" in hist.columns else 0

                with self.historical_data_lock:
                    self.historical_data[ticker] = {
                        "open":        open_price,
                        "prev_close":  prev_close,
                        "today_close": today_close,
                        "avg_volume":  avg_vol,
                    }
                self.source_stats["yfinance_fallback"] += 1
            except Exception as e:
                logger.debug(f"Historical fetch failed {ticker}: {e}")

        with ThreadPoolExecutor(max_workers=30) as ex:
            ex.map(fetch_one, tickers)

        logger.info("Historical data fetch complete")

    # ── DB WRITER ─────────────────────────────────────────────────────────────

    def _db_writer_worker(self):
        while self.run_event.is_set() or not self.db_write_queue.empty():
            try:
                rows = self.db_write_queue.get(timeout=1.0)
            except queue.Empty:
                continue

            db_rows = []
            for c in rows:
                db_rows.append({
                    "ticker":              c["ticker"],
                    "company_name":        c.get("company_name", ""),
                    "live_price":          c.get("live_price", 0),
                    "open_price":          c.get("open", 0),
                    "prev_close":          c.get("prev_close", 0),
                    "day_high":            c.get("hwm", 0),
                    "volume":              c.get("volume", 0),
                    "change_value":        c.get("change_value", 0),
                    "percent_change":      c.get("percent_change", 0),
                    "last_update":         int(time.time()),
                    "is_positive":         1 if c.get("is_positive") else 0,
                    "went_positive":       c.get("went_positive", 0),
                    "volume_spike":        c.get("volume_spike", False),
                    "volume_spike_level":  c.get("volume_spike_level", "none"),
                    "volume_ratio":        c.get("volume_ratio", 0),
                    "gap_percent":         c.get("gap_percent", 0),
                    "is_gap_play":         c.get("is_gap_play", False),
                    "gap_direction":       c.get("gap_direction", "none"),
                    "gap_magnitude":       c.get("gap_magnitude", "normal"),
                    "ah_momentum":         c.get("ah_momentum", False),
                    "pullback_state":      c.get("pullback_state", "neutral"),
                    "today_close":         c.get("today_close", 0),
                })
            if db_rows:
                self.db.upsert_tickers(db_rows)

    # ── PUBLIC READ HELPERS ───────────────────────────────────────────────────

    def get_live_snapshot(
        self,
        limit: int = 1500,
        only_positive: bool = True,
        source: str = "all",
    ) -> List[Dict]:
        with self.alert_cache_lock:
            rows = list(self.alert_cache.values())

        # Source filter (mirrors data_source selector)
        if source == "monitor":
            rows = [r for r in rows if r["ticker"] in self._monitor_tickers]
        elif source == "portfolio":
            rows = [r for r in rows if r["ticker"] in self._portfolio_tickers]

        if only_positive:
            rows = [r for r in rows if r.get("is_positive")]

        rows.sort(key=lambda r: r.get("change_value", 0), reverse=True)
        return rows[:limit]

    def get_metrics(self) -> Dict:
        """Mirrors StockDashboard.get_metrics()."""
        with self.alert_cache_lock:
            cache_vals   = list(self.alert_cache.values())
        active_set   = self.all_tickers
        now_ts       = time.time()

        live_count   = sum(1 for v in cache_vals
                          if v.get("ticker") in active_set
                          and now_ts - v.get("last_tick_time", 0) <= 60)
        pos_count    = sum(1 for v in cache_vals if v.get("is_positive"))
        turned_count = sum(1 for v in cache_vals if v.get("went_positive") == 1)
        vol_spikes   = sum(1 for v in cache_vals if v.get("volume_spike"))
        gap_plays    = sum(1 for v in cache_vals if v.get("is_gap_play"))
        ah_mom       = sum(1 for v in cache_vals if v.get("ah_momentum"))
        earnings_gaps= sum(1 for v in cache_vals if v.get("is_earnings_gap_play"))
        diamond_cnt  = sum(1 for v in cache_vals if abs(v.get("percent_change", 0)) >= 5)

        last_msg = datetime.fromtimestamp(self.last_message_time).strftime("%H:%M:%S")

        return {
            "ws_health":        self.ws_health_status,
            "ws_retry_count":   self.ws_retry_count,
            "last_update":      last_msg,
            "last_tick":        last_msg,
            "total_tickers":    len(self.all_tickers),
            "cached_tickers":   len(self.alert_cache),
            "live_count":       live_count,
            "pos_count":        pos_count,
            "turned_positive":  turned_count,
            "volume_spikes":    vol_spikes,
            "gap_plays":        gap_plays,
            "ah_momentum":      ah_mom,
            "earnings_gap_plays": earnings_gaps,
            "diamond":          diamond_cnt,
            "session":          _get_market_status(),
            "source_stats":     self.source_stats,
            # Signal engine stats
            "signal_watched":   len(self._signal_watcher.watched),
            "signal_count":     len(self._signal_engine.signal_history),
            "signal_bars":      len(self._signal_engine._calcs),
        }
