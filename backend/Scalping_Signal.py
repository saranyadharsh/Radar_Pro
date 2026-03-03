"""
═══════════════════════════════════════════════════════════════════════
  SCALPING SIGNAL ENGINE  —  Radar Pro Integration
  File: Scalping_Signal.py
  
  Drop-in companion to Stock_dashboard_ws_smartalert.py
  Taps Polygon A.* (1-min aggregate) messages from the existing
  single WebSocket connection. No new connections. No new threads.

  DEFAULT WATCHLIST (25 symbols):
    AAPL, LITE, GOOGL, LMT, SNDK, WDC, ORCL, MU, NVDA, SPOT,
    SHOP, AMD, TSLA, GRMN, META, RKLB, STX, CHTR, AMZN, DE,
    TER, IDCC, MSFT, MDB, AVGO

  SIGNAL SCORING WEIGHTS:
    Trend    30%  — EMA stack + VWAP position
    Momentum 35%  — MACD, RSI, Stochastic  
    Volume   20%  — OBV + volume spike
    Strength 15%  — ADX trend quality

  SESSION FILTER (ET):
    ✅ 09:30–10:00  Open (80% weight)
    ✅ 10:00–11:30  Mid-Morning — BEST WINDOW (100% weight)
    🚫 11:30–14:00  Midday — SKIPPED (chop)
    ✅ 14:00–15:30  Afternoon (90% weight)
    ✅ 15:30–16:00  Power Hour (95% weight)
═══════════════════════════════════════════════════════════════════════
"""

# ── stdlib ────────────────────────────────────────────────────────────────────
import threading
import logging
import webbrowser
import subprocess
import sys
import os
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, time
from enum import Enum
from typing import Dict, List, Optional

# ── third-party ───────────────────────────────────────────────────────────────
import numpy as np

logger = logging.getLogger(__name__)

# ═══════════════════════════════════════════════════════════════════════════════
# CONFIGURATION  — tweak without touching the engine
# ═══════════════════════════════════════════════════════════════════════════════

MAX_WATCH_SYMBOLS   = 50       # Hard cap — user can select up to 50
MIN_SCORE_TRADE     = 0.45     # |score| threshold to emit a signal  (0–1)
MIN_CONFIDENCE      = 0.50
SIGNAL_COOLDOWN_SEC = 120      # Don't re-signal same ticker within 2 min
SIGNAL_DASHBOARD_PORT = 8502   # Streamlit port for the signal page


# ═══════════════════════════════════════════════════════════════════════════════
# ENUMS & DATA CLASSES
# ═══════════════════════════════════════════════════════════════════════════════

class Signal(Enum):
    STRONG_BUY  =  3
    BUY         =  2
    WEAK_BUY    =  1
    NEUTRAL     =  0
    WEAK_SELL   = -1
    SELL        = -2
    STRONG_SELL = -3


class MarketSession(Enum):
    PRE_MARKET  = "pre_market"
    OPEN        = "open"
    MID_MORNING = "mid_morning"   # ← best scalp window
    MIDDAY      = "midday"        # skip — low vol chop
    AFTERNOON   = "afternoon"
    POWER_HOUR  = "power_hour"
    AFTER_HOURS = "after_hours"


@dataclass
class OHLCVBar:
    timestamp: datetime
    open:   float
    high:   float
    low:    float
    close:  float
    volume: float


@dataclass
class TradeSignal:
    symbol:      str
    signal:      Signal
    score:       float          # –1.0 … +1.0
    confidence:  float          # 0.0 … 1.0
    strength:    str            # STRONG / MODERATE / WEAK
    entry_price: float
    stop_loss:   float
    take_profit: float
    risk_reward: float
    reasons:     List[dict] = field(default_factory=list)
    timestamp:   datetime   = field(default_factory=datetime.now)
    session:     MarketSession = MarketSession.MID_MORNING

    def direction(self) -> str:
        return "LONG" if self.score > 0 else "SHORT"

    def __str__(self):
        return (
            f"[{self.symbol}] {self.direction()} | "
            f"Score:{self.score:+.2f} Conf:{self.confidence:.0%} | "
            f"Entry:{self.entry_price:.2f} SL:{self.stop_loss:.2f} "
            f"TP:{self.take_profit:.2f} R:R 1:{self.risk_reward:.1f} | "
            f"{self.strength}"
        )


# ═══════════════════════════════════════════════════════════════════════════════
# INDICATOR CALCULATOR  (per-symbol, streaming)
# ═══════════════════════════════════════════════════════════════════════════════

class IndicatorCalculator:
    """Maintains a rolling window of OHLCV bars and computes indicators."""

    def __init__(self, symbol: str, max_bars: int = 200):
        self.symbol = symbol
        self.bars: deque = deque(maxlen=max_bars)
        self._obv = 0.0
        self._vwap_cum_pv  = 0.0
        self._vwap_cum_vol = 0.0

    def reset_vwap(self):
        self._vwap_cum_pv  = 0.0
        self._vwap_cum_vol = 0.0

    def add_bar(self, bar: OHLCVBar) -> Optional[dict]:
        """Add bar → return indicator dict or None if warming up."""
        self.bars.append(bar)
        if len(self.bars) < 27:
            return None
        return self._compute(bar)

    # ── helpers ──────────────────────────────────────────────────────────────

    def _arr(self, attr: str) -> np.ndarray:
        return np.array([getattr(b, attr) for b in self.bars])

    @staticmethod
    def _ema(s: np.ndarray, p: int) -> float:
        k = 2 / (p + 1)
        v = s[0]
        for x in s[1:]:
            v = x * k + v * (1 - k)
        return float(v)

    def _rsi(self, closes: np.ndarray, p: int = 14) -> float:
        d = np.diff(closes[-(p + 2):])
        g = d[d > 0].mean() if (d > 0).any() else 0.0
        l = (-d[d < 0]).mean() if (d < 0).any() else 0.0
        if l == 0:
            return 100.0
        return 100 - 100 / (1 + g / l)

    def _stoch(self, highs, lows, closes, kp=5, dp=3):
        h = np.max(highs[-kp:])
        lo = np.min(lows[-kp:])
        k = 100 * (closes[-1] - lo) / (h - lo + 1e-10)
        d = np.mean([
            100 * (closes[-(i+1)] - np.min(lows[-(i+1)-kp:-(i+1) or None]))
              / (np.max(highs[-(i+1)-kp:-(i+1) or None])
                 - np.min(lows[-(i+1)-kp:-(i+1) or None]) + 1e-10)
            for i in range(dp)
        ])
        return float(k), float(d)

    @staticmethod
    def _atr(highs, lows, closes, p=14) -> float:
        tr = [max(highs[i]-lows[i],
                  abs(highs[i]-closes[i-1]),
                  abs(lows[i]-closes[i-1]))
              for i in range(1, len(highs))]
        return float(np.mean(tr[-p:])) if tr else 0.0

    @staticmethod
    def _adx(highs, lows, closes, p=14) -> float:
        if len(highs) < p + 2:
            return 0.0
        tr, pdm, ndm = [], [], []
        for i in range(1, len(highs)):
            tr.append(max(highs[i]-lows[i],
                          abs(highs[i]-closes[i-1]),
                          abs(lows[i]-closes[i-1])))
            up   = highs[i] - highs[i-1]
            down = lows[i-1] - lows[i]
            pdm.append(up   if up > down   and up > 0   else 0)
            ndm.append(down if down > up   and down > 0 else 0)
        ts  = np.mean(tr[-p:])   + 1e-10
        di_p = 100 * np.mean(pdm[-p:]) / ts
        di_n = 100 * np.mean(ndm[-p:]) / ts
        return float(100 * abs(di_p - di_n) / (di_p + di_n + 1e-10))

    def _compute(self, bar: OHLCVBar) -> dict:
        closes  = self._arr('close')
        highs   = self._arr('high')
        lows    = self._arr('low')
        volumes = self._arr('volume')

        # VWAP (intraday cumulative)
        tp = (bar.high + bar.low + bar.close) / 3
        self._vwap_cum_pv  += tp * bar.volume
        self._vwap_cum_vol += bar.volume
        vwap = self._vwap_cum_pv / (self._vwap_cum_vol + 1e-10)

        # EMAs
        ema9  = self._ema(closes, 9)
        ema21 = self._ema(closes, 21)

        # MACD (12/26/9)
        macd_line = self._ema(closes, 12) - self._ema(closes, 26)
        # signal line — approximate with last 9 macd values
        macd_vals = np.array([
            self._ema(closes[:-(9-i) or None], 12) - self._ema(closes[:-(9-i) or None], 26)
            for i in range(9)
        ])
        macd_signal = self._ema(macd_vals, 9)
        macd_hist   = macd_line - macd_signal

        # RSI
        rsi = self._rsi(closes)

        # Stochastic
        stoch_k, stoch_d = self._stoch(highs, lows, closes)

        # Bollinger Bands
        bb_mid   = float(np.mean(closes[-20:]))
        bb_std   = float(np.std(closes[-20:]))
        bb_upper = bb_mid + 2 * bb_std
        bb_lower = bb_mid - 2 * bb_std

        # ATR / ADX
        atr = self._atr(highs, lows, closes)
        adx = self._adx(highs, lows, closes)

        # OBV
        if len(self.bars) >= 2:
            prev = list(self.bars)[-2]
            if bar.close > prev.close:
                self._obv += bar.volume
            elif bar.close < prev.close:
                self._obv -= bar.volume

        # Volume ratio
        avg_vol = float(np.mean(volumes[-20:])) if len(volumes) >= 20 else float(volumes.mean())
        vol_ratio = bar.volume / (avg_vol + 1e-10)

        return dict(
            ema9=ema9, ema21=ema21, vwap=vwap,
            macd_line=macd_line, macd_signal=macd_signal, macd_hist=macd_hist,
            rsi=rsi, stoch_k=stoch_k, stoch_d=stoch_d,
            bb_upper=bb_upper, bb_mid=bb_mid, bb_lower=bb_lower,
            atr=atr, adx=adx, obv=self._obv, vol_ratio=vol_ratio,
            close=bar.close,
        )


# ═══════════════════════════════════════════════════════════════════════════════
# SIGNAL ENGINE
# ═══════════════════════════════════════════════════════════════════════════════

class ScalpingSignalEngine:
    """
    Core signal evaluator.
    Scoring weights:  Trend 30% | Momentum 35% | Volume 20% | Strength 15%
    """

    # Thresholds
    RSI_OB, RSI_OS        = 70, 30
    RSI_BULL, RSI_BEAR    = 55, 45
    STOCH_OB, STOCH_OS    = 80, 20
    ADX_TREND, ADX_STRONG = 25, 40
    VOL_SPIKE, VOL_HIGH   = 1.5, 2.0
    ATR_SL_MULT           = 1.5
    ATR_TP_MULT           = 2.5

    def __init__(self):
        self._calcs:     Dict[str, IndicatorCalculator] = {}
        self._last_sig:  Dict[str, float] = {}          # ticker → epoch of last signal
        self._callbacks: List = []
        self._lock = threading.Lock()
        # Ring buffer of last 200 signals (for dashboard)
        self.signal_history: deque = deque(maxlen=200)

    # ── public API ───────────────────────────────────────────────────────────

    def on_signal(self, cb):
        """Register callback: fn(signal: TradeSignal)"""
        self._callbacks.append(cb)

    def reset_vwap_all(self):
        """Call at market open (9:30 ET) to reset VWAP for all tracked symbols."""
        with self._lock:
            for c in self._calcs.values():
                c.reset_vwap()
        logger.info("VWAP reset for all symbols.")

    def process_aggregate_bar(self, symbol: str, bar: OHLCVBar) -> Optional[TradeSignal]:
        """
        Feed a 1-min aggregate bar (from Polygon A.* message).
        Returns TradeSignal if conditions met, else None.
        """
        with self._lock:
            if symbol not in self._calcs:
                self._calcs[symbol] = IndicatorCalculator(symbol)
            indicators = self._calcs[symbol].add_bar(bar)

        if indicators is None:
            return None

        session = _get_session(bar.timestamp)
        if session == MarketSession.MIDDAY:
            return None      # skip low-volume chop 11:30–14:00 ET

        sig = self._evaluate(symbol, bar, indicators, session)
        if sig is None:
            return None

        # Cooldown check
        now = bar.timestamp.timestamp()
        last = self._last_sig.get(symbol, 0)
        if now - last < SIGNAL_COOLDOWN_SEC:
            return None

        self._last_sig[symbol] = now
        self.signal_history.appendleft(sig)

        for cb in self._callbacks:
            try:
                cb(sig)
            except Exception as e:
                logger.error(f"Signal callback error: {e}")

        return sig

    # ── scoring ──────────────────────────────────────────────────────────────

    def _evaluate(self, symbol, bar, ind, session) -> Optional[TradeSignal]:
        bull = bear = 0.0
        reasons = []

        close     = ind['close']
        ema9      = ind['ema9']
        ema21     = ind['ema21']
        vwap      = ind['vwap']
        macd_hist = ind['macd_hist']
        macd_line = ind['macd_line']
        macd_sig  = ind['macd_signal']
        rsi       = ind['rsi']
        stk       = ind['stoch_k']
        std       = ind['stoch_d']
        vol_ratio = ind['vol_ratio']
        adx       = ind['adx']
        bb_upper  = ind['bb_upper']
        bb_lower  = ind['bb_lower']
        atr       = ind['atr']

        # ── TREND (30%) ──────────────────────────────────────────────────
        if close > ema9 > ema21:
            bull += 0.15; reasons.append({"text": "Bullish EMA stack", "type": "bull"})
        elif close < ema9 < ema21:
            bear += 0.15; reasons.append({"text": "Bearish EMA stack", "type": "bear"})

        vwap_pct = (close - vwap) / vwap * 100
        if close > vwap:
            bull += 0.15; reasons.append({"text": f"Above VWAP +{vwap_pct:.2f}%", "type": "bull"})
        else:
            bear += 0.15; reasons.append({"text": f"Below VWAP {vwap_pct:.2f}%", "type": "bear"})

        # ── MOMENTUM (35%) ───────────────────────────────────────────────
        if macd_hist > 0 and macd_line > macd_sig:
            bull += 0.12; reasons.append({"text": f"MACD bullish hist:{macd_hist:.4f}", "type": "bull"})
        elif macd_hist < 0 and macd_line < macd_sig:
            bear += 0.12; reasons.append({"text": f"MACD bearish hist:{macd_hist:.4f}", "type": "bear"})

        if 40 < rsi < self.RSI_OB:
            if rsi > self.RSI_BULL:
                bull += 0.12; reasons.append({"text": f"RSI bull zone {rsi:.0f}", "type": "bull"})
            else:
                bull += 0.05
        elif self.RSI_OS < rsi < 60:
            if rsi < self.RSI_BEAR:
                bear += 0.12; reasons.append({"text": f"RSI bear zone {rsi:.0f}", "type": "bear"})
            else:
                bear += 0.05
        elif rsi >= self.RSI_OB:
            bear += 0.08; reasons.append({"text": f"RSI overbought {rsi:.0f}", "type": "warn"})
        elif rsi <= self.RSI_OS:
            bull += 0.08; reasons.append({"text": f"RSI oversold {rsi:.0f}", "type": "warn"})

        if stk > std and stk < self.STOCH_OB:
            bull += 0.11; reasons.append({"text": f"Stoch K{stk:.0f}↑D{std:.0f}", "type": "bull"})
        elif stk < std and stk > self.STOCH_OS:
            bear += 0.11; reasons.append({"text": f"Stoch K{stk:.0f}↓D{std:.0f}", "type": "bear"})

        # ── VOLUME (20%) ─────────────────────────────────────────────────
        if vol_ratio >= self.VOL_HIGH:
            if bull > bear:
                bull += 0.15; reasons.append({"text": f"Vol spike {vol_ratio:.1f}x ✅", "type": "bull"})
            else:
                bear += 0.15; reasons.append({"text": f"Vol spike {vol_ratio:.1f}x ✅", "type": "bear"})
        elif vol_ratio >= self.VOL_SPIKE:
            if bull > bear:
                bull += 0.10; reasons.append({"text": f"Vol {vol_ratio:.1f}x avg", "type": "bull"})
            else:
                bear += 0.10; reasons.append({"text": f"Vol {vol_ratio:.1f}x avg", "type": "bear"})
        else:
            reasons.append({"text": f"Low vol {vol_ratio:.1f}x", "type": "warn"})

        obv = ind['obv']
        if obv > 0: bull += 0.05
        elif obv < 0: bear += 0.05

        # ── ADX / TREND STRENGTH (15%) ────────────────────────────────────
        mult = 1.3 if adx >= self.ADX_STRONG else (1.1 if adx >= self.ADX_TREND else 0.85)
        if adx >= self.ADX_TREND:
            reasons.append({"text": f"ADX {adx:.0f} trending", "type": "bull"})
        else:
            reasons.append({"text": f"ADX {adx:.0f} choppy — caution", "type": "warn"})
        bull *= mult; bear *= mult

        # BB extremes
        if close > bb_upper:
            bear += 0.05; reasons.append({"text": "Above BB upper — reversal risk", "type": "warn"})
        elif close < bb_lower:
            bull += 0.05; reasons.append({"text": "Below BB lower — bounce possible", "type": "warn"})

        # Session multiplier
        s_mult = {
            MarketSession.OPEN:        0.80,
            MarketSession.MID_MORNING: 1.00,
            MarketSession.AFTERNOON:   0.90,
            MarketSession.POWER_HOUR:  0.95,
        }.get(session, 0.70)
        bull *= s_mult; bear *= s_mult

        net = bull - bear
        if abs(net) < MIN_SCORE_TRADE:
            return None

        direction = 1 if net > 0 else -1
        conf      = min(abs(net) / 0.8, 1.0)
        if conf < MIN_CONFIDENCE:
            return None

        abs_net = abs(net)
        if abs_net >= 0.75:
            sig = Signal.STRONG_BUY  if direction > 0 else Signal.STRONG_SELL
            strength = "STRONG"
        elif abs_net >= 0.55:
            sig = Signal.BUY         if direction > 0 else Signal.SELL
            strength = "MODERATE"
        else:
            sig = Signal.WEAK_BUY    if direction > 0 else Signal.WEAK_SELL
            strength = "WEAK"

        safe_atr = atr if atr > 0 else close * 0.002
        if direction > 0:
            sl = close - safe_atr * self.ATR_SL_MULT
            tp = close + safe_atr * self.ATR_TP_MULT
        else:
            sl = close + safe_atr * self.ATR_SL_MULT
            tp = close - safe_atr * self.ATR_TP_MULT

        risk   = abs(close - sl) + 1e-10
        reward = abs(tp - close)

        return TradeSignal(
            symbol      = symbol,
            signal      = sig,
            score       = round(net, 3),
            confidence  = round(conf, 3),
            strength    = strength,
            entry_price = round(close, 2),
            stop_loss   = round(sl, 2),
            take_profit = round(tp, 2),
            risk_reward = round(reward / risk, 2),
            reasons     = reasons,
            timestamp   = bar.timestamp,
            session     = session,
        )


# ═══════════════════════════════════════════════════════════════════════════════
# WATCHLIST MANAGER  (user selects up to 50 symbols)
# ═══════════════════════════════════════════════════════════════════════════════

class SignalWatchlistManager:
    """
    Bridges user-selected symbols ↔ ScalpingSignalEngine.
    Tap this from Radar Pro's existing all_tickers set.
    """

    def __init__(self, engine: ScalpingSignalEngine):
        self.engine = engine
        self._watched: set = set()
        self._lock = threading.Lock()

    @property
    def watched(self) -> set:
        with self._lock:
            return set(self._watched)

    def set_watchlist(self, symbols: List[str]) -> List[str]:
        """
        Replace watchlist (max 50 symbols).
        Returns the accepted list.
        """
        clean = [s.upper().strip() for s in symbols if s.strip()][:MAX_WATCH_SYMBOLS]
        with self._lock:
            self._watched = set(clean)
        logger.info(f"Signal watchlist updated: {len(clean)} symbols → {clean}")
        return clean

    def load_from_file(self, path: str = "Cache/signal_watchlist.json"):
        """
        Load watchlist from JSON file on disk.
        Called automatically at StockDashboard init so the engine
        starts watching immediately without sidebar interaction.
        Falls back to DEFAULT_WATCHLIST if file not found.
        """
        import json
        DEFAULT_WATCHLIST = [
            "AAPL","LITE","GOOGL","LMT","SNDK","WDC","ORCL","MU","NVDA","SPOT",
            "SHOP","AMD","TSLA","GRMN","META","RKLB","STX","CHTR","AMZN","DE",
            "TER","IDCC","MSFT","MDB","AVGO",
        ]
        try:
            if os.path.exists(path):
                with open(path, "r") as f:
                    symbols = json.load(f)
                accepted = self.set_watchlist(symbols)
                logger.info(f"⚡ Signal watchlist loaded from {path}: {len(accepted)} symbols")
            else:
                accepted = self.set_watchlist(DEFAULT_WATCHLIST)
                # Save default to disk for next run
                os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
                with open(path, "w") as f:
                    json.dump(DEFAULT_WATCHLIST, f, indent=2)
                logger.info(f"⚡ Signal watchlist defaulted to {len(accepted)} symbols, saved to {path}")
        except Exception as e:
            logger.warning(f"Signal watchlist load failed ({e}), using defaults")
            self.set_watchlist(DEFAULT_WATCHLIST)

    def add(self, symbol: str) -> bool:
        with self._lock:
            if len(self._watched) >= MAX_WATCH_SYMBOLS:
                return False
            self._watched.add(symbol.upper().strip())
        return True

    def remove(self, symbol: str):
        with self._lock:
            self._watched.discard(symbol.upper().strip())

    def is_watched(self, symbol: str) -> bool:
        with self._lock:
            return symbol.upper() in self._watched

    def process_aggregate_message(self, msg) -> Optional[TradeSignal]:
        """
        Pass a raw Polygon Aggregate WebSocket message here.
        Returns TradeSignal if signal fires, else None.
        """
        ticker = getattr(msg, "symbol", None) or getattr(msg, "sym", None)
        if not ticker or not self.is_watched(ticker):
            return None

        # Polygon Aggregate (A.*) attributes
        try:
            bar = OHLCVBar(
                timestamp = datetime.now(),     # use now; or parse msg.start_timestamp
                open      = float(getattr(msg, 'open',   getattr(msg, 'op', 0))),
                high      = float(getattr(msg, 'high',   getattr(msg, 'h',  0))),
                low       = float(getattr(msg, 'low',    getattr(msg, 'l',  0))),
                close     = float(getattr(msg, 'close',  getattr(msg, 'c',  getattr(msg, 'close', 0)))),
                volume    = float(getattr(msg, 'volume', getattr(msg, 'v',  0))),
            )
        except (TypeError, ValueError) as e:
            logger.warning(f"SignalEngine: could not parse aggregate for {ticker}: {e}")
            return None

        if bar.close <= 0:
            return None

        return self.engine.process_aggregate_bar(ticker, bar)


# ═══════════════════════════════════════════════════════════════════════════════
# CHROME TAB LAUNCHER
# ═══════════════════════════════════════════════════════════════════════════════

_dashboard_process = None
_dashboard_launched = False


def launch_signal_dashboard():
    """
    Starts signal_dashboard_page.py on port 8502 and opens it in the browser.
    Safe to call multiple times — relaunches if the process has died.

    Windows 11 browser-open strategy (in order):
      1. Chrome via registry / known paths
      2. Edge fallback
      3. Windows  start  shell command (always works — uses default browser)
      4. Python webbrowser module
    """
    global _dashboard_process, _dashboard_launched

    # Allow re-launch if process has died
    if _dashboard_launched and _dashboard_process is not None:
        if _dashboard_process.poll() is None:
            logger.info("Signal dashboard already running — just opening URL")
            _open_browser_url(f"http://localhost:{SIGNAL_DASHBOARD_PORT}")
            return
        else:
            logger.info("Signal dashboard process had died — restarting")
            _dashboard_launched = False

    _dashboard_launched = True
    dashboard_script = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                    "signal_dashboard_page.py")

    if not os.path.exists(dashboard_script):
        logger.error(
            f"signal_dashboard_page.py not found at {dashboard_script}. "
            "Make sure the file is in the same folder as Scalping_Signal.py."
        )
        return

    try:
        _dashboard_process = subprocess.Popen(
            [sys.executable, "-m", "streamlit", "run",
             dashboard_script,
             "--server.port",            str(SIGNAL_DASHBOARD_PORT),
             "--server.address",         "localhost",
             "--server.headless",        "true",
             "--browser.gatherUsageStats", "false",
             "--server.runOnSave",       "false"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            cwd=os.path.dirname(os.path.abspath(__file__)),
        )
        logger.info(f"✅ Signal dashboard process started (PID {_dashboard_process.pid})")

    except Exception as e:
        logger.error(f"Failed to start signal dashboard process: {e}")
        _dashboard_launched = False
        return

    # Open browser after giving Streamlit time to bind the port
    def _open_after_startup():
        import time as _time
        url = f"http://localhost:{SIGNAL_DASHBOARD_PORT}"

        # Poll until port is open (max 15 s)
        import socket
        for attempt in range(15):
            _time.sleep(1)
            try:
                with socket.create_connection(("localhost", SIGNAL_DASHBOARD_PORT), timeout=1):
                    logger.info(f"✅ Port {SIGNAL_DASHBOARD_PORT} is open after {attempt+1}s")
                    break
            except OSError:
                continue
        else:
            logger.warning(f"Port {SIGNAL_DASHBOARD_PORT} did not open in 15s — trying to open anyway")

        _open_browser_url(url)

    threading.Thread(target=_open_after_startup, daemon=True).start()


def _open_browser_url(url: str):
    """
    Open a URL in Chrome / Edge / default browser on Windows 11 / Mac / Linux.
    Uses 4 strategies in order — one will always work.
    """
    chrome_path = _find_chrome()

    # Strategy 1: Chrome or Edge found via _find_chrome
    if chrome_path:
        try:
            subprocess.Popen([chrome_path, "--new-tab", url],
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            #logger.info(f"✅ Opened in browser via path: {chrome_path}")
            return
        except Exception as e:
            logger.warning(f"Direct browser launch failed ({e}) — trying fallbacks")

    # Strategy 2: Windows  start  command (uses default browser, always works)
    if sys.platform == "win32":
        try:
            os.startfile(url)          # simplest Windows call
            logger.info(f"✅ Opened via os.startfile: {url}")
            return
        except Exception:
            pass
        try:
            subprocess.Popen(f'start "" "{url}"', shell=True)
            logger.info(f"✅ Opened via shell start: {url}")
            return
        except Exception as e:
            logger.warning(f"Shell start failed: {e}")

    # Strategy 3: webbrowser module (cross-platform)
    try:
        import webbrowser
        webbrowser.open_new_tab(url)
        logger.info(f"✅ Opened via webbrowser module: {url}")
    except Exception as e:
        logger.error(
            f"All browser-open strategies failed. "
            f"Please open manually: {url}  (error: {e})"
        )


def _find_chrome() -> Optional[str]:
    """
    Find Chrome executable on Windows 11 / Mac / Linux.
    Search order:
      1. Windows registry  (most reliable — works for all install types)
      2. Common fixed paths (Program Files, user profile, local AppData)
      3. Mac / Linux paths
    Returns path string or None.
    """
    # ── Windows: registry + all known install locations ──────────────────────
    if sys.platform == "win32":
        # 1. Registry lookup (handles per-user and system installs)
        try:
            import winreg
            for root in (winreg.HKEY_LOCAL_MACHINE, winreg.HKEY_CURRENT_USER):
                for sub in (
                    r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe",
                    r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe",
                ):
                    try:
                        with winreg.OpenKey(root, sub) as k:
                            path, _ = winreg.QueryValueEx(k, "")
                            if path and os.path.exists(path):
                                return path
                    except FileNotFoundError:
                        continue
        except Exception:
            pass

        # 2. All known Windows paths including user-profile installs
        user_profile = os.environ.get("USERPROFILE", "C:\\Users\\User")
        local_app    = os.environ.get("LOCALAPPDATA", os.path.join(user_profile, "AppData", "Local"))
        prog_files   = os.environ.get("PROGRAMFILES",       r"C:\Program Files")
        prog_files86 = os.environ.get("PROGRAMFILES(X86)",  r"C:\Program Files (x86)")

        candidates = [
            os.path.join(local_app,    "Google", "Chrome", "Application", "chrome.exe"),
            os.path.join(prog_files,   "Google", "Chrome", "Application", "chrome.exe"),
            os.path.join(prog_files86, "Google", "Chrome", "Application", "chrome.exe"),
            # Chrome Beta / Dev / Canary
            os.path.join(local_app, "Google", "Chrome Beta",   "Application", "chrome.exe"),
            os.path.join(local_app, "Google", "Chrome Dev",    "Application", "chrome.exe"),
            os.path.join(local_app, "Google", "Chrome SxS",    "Application", "chrome.exe"),
            # Microsoft Edge (Chromium) — good fallback
            os.path.join(prog_files,   "Microsoft", "Edge", "Application", "msedge.exe"),
            os.path.join(prog_files86, "Microsoft", "Edge", "Application", "msedge.exe"),
        ]
        for c in candidates:
            if os.path.exists(c):
                return c
        return None  # fall through to webbrowser / start fallback

    # ── Mac ───────────────────────────────────────────────────────────────────
    mac_candidates = [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ]
    for c in mac_candidates:
        if os.path.exists(c):
            return c

    # ── Linux ─────────────────────────────────────────────────────────────────
    for cmd in ("google-chrome", "google-chrome-stable", "chromium-browser", "chromium"):
        result = subprocess.run(["which", cmd], capture_output=True, text=True)
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout.strip()

    return None


# ═══════════════════════════════════════════════════════════════════════════════
# HELPER UTILITY
# ═══════════════════════════════════════════════════════════════════════════════

def _get_session(ts: datetime) -> MarketSession:
    t = ts.time()
    if   t < time(9, 30):  return MarketSession.PRE_MARKET
    elif t < time(10, 0):  return MarketSession.OPEN
    elif t < time(11, 30): return MarketSession.MID_MORNING
    elif t < time(14, 0):  return MarketSession.MIDDAY
    elif t < time(15, 30): return MarketSession.AFTERNOON
    elif t < time(16, 0):  return MarketSession.POWER_HOUR
    else:                  return MarketSession.AFTER_HOURS