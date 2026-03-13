"""
═══════════════════════════════════════════════════════════════════════
  SCALPING SIGNAL ENGINE  —  Radar Pro Integration
  File: Scalping_Signal.py

  Drop-in companion to Stock_dashboard_ws_smartalert.py
  Taps Polygon A.* (1-min aggregate) messages from the existing
  single WebSocket connection. No new connections. No new threads.

  WATCHLIST:
    Empty by default - managed via frontend UI
    User can add/remove symbols dynamically
    Max 50 symbols

  SIGNAL SCORING WEIGHTS (approximate max contributions):
    Trend    ~30%  — EMA stack (0.15) + VWAP position (0.15)
    Momentum ~35%  — MACD (0.12) + RSI (0.12) + Stochastic (0.11)
    Volume   ~20%  — Vol spike (0.15) + OBV (0.05)
    Extras   ~10%  — BB extremes (0.05), ADX multiplier (0.85-1.30x)
    Phase 3  ~25%  — Supertrend (0.10) + Order Block (0.15) — additive
    Note: ADX is applied as a multiplier, not an additive weight.
          Session multiplier applied last (0.60-1.00x).

  PINE SCRIPT ALIGNMENT (v3):
    ALIGN-1  EMA 9→8 to match Pine's EMA(8)
    ALIGN-2  Stochastic K period 5→14 to match Pine's ta.stoch(close,high,low,14)
    ALIGN-3  Bollinger Bands std: population→sample (ddof=1) to match Pine ta.stdev
    ALIGN-4  Supertrend: simplified→stateful band tracking (matches Pine logic)
    ALIGN-5  TP/SL: 5-min aggregated ATR with Pine-matching multipliers (1.5 SL, 3.0 TP)
    ALIGN-6  Volume delta: added buy/sell split by wick ratio (matches Pine)
    ALIGN-7  get_scalp_snapshot TP/SL now uses class constants + atr_5m (was hardcoded)

  SESSION FILTER (ET):
    ✅ 09:30-10:00  Open (80% weight)
    ✅ 10:00-11:30  Mid-Morning — BEST WINDOW (100% weight)
    🚫 11:30-14:00  Midday — SKIPPED (chop)
    ✅ 14:00-15:30  Afternoon (90% weight)
    ✅ 15:30-16:00  Power Hour (95% weight)
    ⚠️  16:00+       After Hours (70% weight) — seeded via REST bars

  FIXES APPLIED (v2):
    FIX-1  OBV reset daily at market open (was never reset — multi-day drift)
    FIX-2  RSI condition overlap removed (was biasing toward LONG signals)
    FIX-3  AH signals: seed_history_from_rest() added for AH + fast warmup
    FIX-4  MACD signal line: true streaming EMA via _macd_history deque
    FIX-5  VWAP reset: date-guard instead of exact-second poll (Windows safe)
    FIX-6  Cooldown checked BEFORE indicator compute (saves CPU per bar)
    FIX-7  AFTER_HOURS + PRE_MARKET explicit in s_mult dict
    FIX-8  Removed duplicate webbrowser import
    FIX-9  Weight docstring corrected (was incorrectly stated as summing to 1.0)
    FIX-10 _last_sig purged every 10 min (was unbounded growth)
═══════════════════════════════════════════════════════════════════════
"""

# ── stdlib ────────────────────────────────────────────────────────────────────
import asyncio
import threading
import logging
import sys
import os
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, time, date
from enum import Enum
from typing import Dict, List, Optional
from zoneinfo import ZoneInfo
import time as std_time
import pytz

# ── third-party ───────────────────────────────────────────────────────────────
import numpy as np

logger = logging.getLogger(__name__)

# ═══════════════════════════════════════════════════════════════════════════════
# CONFIGURATION  — tweak without touching the engine
# ═══════════════════════════════════════════════════════════════════════════════

MAX_WATCH_SYMBOLS     = 50       # Hard cap — user can select up to 50
MIN_SCORE_TRADE       = 0.45     # |score| threshold to emit a signal  (0-1)
MIN_CONFIDENCE        = 0.50
SIGNAL_COOLDOWN_SEC   = 120      # Don't re-signal same ticker within 2 min
SIGNAL_DASHBOARD_PORT = 8502     # Streamlit port for the signal page
_COOLDOWN_PURGE_SEC   = 600      # FIX-10: purge stale cooldown entries every 10 min


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
    MID_MORNING = "mid_morning"   # best scalp window
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
    score:       float          # -1.0 ... +1.0
    confidence:  float          # 0.0 ... 1.0
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
        # FIX-4: store true streaming MACD line values for accurate signal EMA
        self._macd_history: deque = deque(maxlen=50)
        # ALIGN-6: store volume delta values for EMA(10) momentum detection
        self._delta_history: deque = deque(maxlen=50)
        # Cache most-recent computed indicators for live snapshot API
        self._latest_ind: Optional[dict] = None

    def reset_vwap(self):
        """
        FIX-1: Reset VWAP, OBV, and MACD history together at market open.
        Original only reset VWAP — OBV accumulated cross-day making it meaningless.
        """
        self._vwap_cum_pv  = 0.0
        self._vwap_cum_vol = 0.0
        self._obv          = 0.0          # FIX-1
        self._macd_history.clear()        # fresh MACD signal baseline each day
        self._delta_history.clear()       # ALIGN-6: fresh delta baseline each day

    def add_bar(self, bar: OHLCVBar) -> Optional[dict]:
        """Add bar -> return indicator dict or None if warming up."""
        self.bars.append(bar)
        if len(self.bars) < 27:
            return None
        ind = self._compute(bar)
        self._latest_ind = ind   # cache for snapshot API
        return ind

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
        if len(closes) <= p:
            return 50.0

        diffs  = np.diff(closes)
        gains  = np.maximum(diffs, 0.0)
        losses = np.abs(np.minimum(diffs, 0.0))

        # Wilder smoothing: SMA seed -> RMA
        avg_gain = np.mean(gains[:p])
        avg_loss = np.mean(losses[:p])

        for i in range(p, len(gains)):
            avg_gain = (avg_gain * (p - 1) + gains[i]) / p
            avg_loss = (avg_loss * (p - 1) + losses[i]) / p

        if avg_loss == 0:
            return 100.0

        rs = avg_gain / avg_loss
        return 100.0 - (100.0 / (1.0 + rs))

    def _stoch(self, highs, lows, closes, kp=14, dp=3):
        # ALIGN-2: K period 5→14 to match Pine's ta.stoch(close,high,low,14)
        # K line (Fast Stochastic)
        h  = np.max(highs[-kp:])
        lo = np.min(lows[-kp:])
        k  = 100 * (closes[-1] - lo) / (h - lo + 1e-10)

        # D line: 3-period SMA of K values
        d_vals = []
        for i in range(dp):
            end_idx       = -(i) if i != 0 else None
            start_idx     = -(i + kp)
            window_highs  = highs[start_idx:end_idx]
            window_lows   = lows[start_idx:end_idx]
            current_close = closes[-(i + 1)]
            lowest        = np.min(window_lows)
            highest       = np.max(window_highs)
            k_val         = 100 * (current_close - lowest) / (highest - lowest + 1e-10)
            d_vals.append(k_val)

        d = np.mean(d_vals)
        return float(k), float(d)

    @staticmethod
    def _atr(highs, lows, closes, p=14) -> float:
        tr = [max(highs[i] - lows[i],
                  abs(highs[i] - closes[i-1]),
                  abs(lows[i]  - closes[i-1]))
              for i in range(1, len(highs))]
        return float(np.mean(tr[-p:])) if tr else 0.0

    @staticmethod
    def _adx(highs, lows, closes, p=14) -> float:
        if len(highs) <= p:
            return 0.0

        tr, pdm, ndm = [0.0], [0.0], [0.0]

        for i in range(1, len(highs)):
            tr.append(max(highs[i] - lows[i],
                          abs(highs[i] - closes[i-1]),
                          abs(lows[i]  - closes[i-1])))
            up   = highs[i] - highs[i-1]
            down = lows[i-1] - lows[i]
            pdm.append(up   if up > down   and up   > 0 else 0.0)
            ndm.append(down if down > up   and down > 0 else 0.0)

        # Wilder smoothing: SMA seed -> RMA
        atr_val = np.mean(tr[1:p+1])
        pdi_val = np.mean(pdm[1:p+1])
        ndi_val = np.mean(ndm[1:p+1])

        adx_vals = []
        for i in range(p+1, len(highs)):
            atr_val = (atr_val * (p - 1) + tr[i])  / p
            pdi_val = (pdi_val * (p - 1) + pdm[i]) / p
            ndi_val = (ndi_val * (p - 1) + ndm[i]) / p

            di_p = 100 * (pdi_val / atr_val) if atr_val > 0 else 0
            di_n = 100 * (ndi_val / atr_val) if atr_val > 0 else 0
            dx   = 100 * abs(di_p - di_n) / (di_p + di_n + 1e-10)
            adx_vals.append(dx)

        if not adx_vals:
            return 0.0

        adx_final = np.mean(adx_vals[:p])
        for i in range(p, len(adx_vals)):
            adx_final = (adx_final * (p - 1) + adx_vals[i]) / p

        return float(adx_final)

    def _supertrend(self, highs: np.ndarray, lows: np.ndarray,
                    closes: np.ndarray, period: int = 10,
                    multiplier: float = 3.0) -> tuple:
        """
        ALIGN-4: Stateful Supertrend matching Pine Script logic.
        Returns (st_value: float, st_dir: str) where st_dir is 'UP', 'DOWN', or 'NEUTRAL'.

        Pine logic:
          lowerBand := close[1] > prevLowerBand ? max(lowerBandRaw, prevLowerBand) : lowerBandRaw
          upperBand := close[1] < prevUpperBand ? min(upperBandRaw, prevUpperBand) : upperBandRaw
          Direction flips only when close crosses the active band.
        """
        if len(closes) <= period + 1:
            return 0.0, "NEUTRAL"

        # Compute ATR for each bar using a simple rolling window
        n = len(closes)
        tr = np.empty(n - 1)
        for i in range(1, n):
            tr[i - 1] = max(highs[i] - lows[i],
                            abs(highs[i] - closes[i - 1]),
                            abs(lows[i] - closes[i - 1]))

        # Walk forward with stateful band logic (matches Pine bar-by-bar)
        direction = 1  # 1 = downtrend (price below upper), -1 = uptrend (price above lower)
        upper_band = 0.0
        lower_band = 0.0

        for i in range(period, n):
            # Rolling ATR for this bar
            atr_val = float(np.mean(tr[max(0, i - period):i]))
            if atr_val == 0:
                continue

            hl2 = (highs[i] + lows[i]) / 2.0
            raw_upper = hl2 + multiplier * atr_val
            raw_lower = hl2 - multiplier * atr_val

            if i == period:
                upper_band = raw_upper
                lower_band = raw_lower
            else:
                # Pine: lowerBand := close[1] > prevLowerBand ? max(raw, prev) : raw
                lower_band = max(raw_lower, lower_band) if closes[i - 1] > lower_band else raw_lower
                # Pine: upperBand := close[1] < prevUpperBand ? min(raw, prev) : raw
                upper_band = min(raw_upper, upper_band) if closes[i - 1] < upper_band else raw_upper

            prev_dir = direction
            if prev_dir == -1:
                direction = 1 if closes[i] < lower_band else -1
            else:
                direction = -1 if closes[i] > upper_band else 1

        # Pine convention: direction == -1 means uptrend (isUptrend)
        if direction == -1:
            return float(lower_band), "UP"
        else:
            return float(upper_band), "DOWN"

    def _detect_order_block(self, opens: np.ndarray, highs: np.ndarray,
                             lows: np.ndarray, closes: np.ndarray,
                             volumes: np.ndarray, lookback: int = 5) -> tuple:
        """
        Detects high-volume impulsive engulfing moves that signal institutional
        order-block activity. Returns (ob_active: bool, ob_dir: str).

        Criteria (all three must be met):
          1. Body size >= 1.5× ATR(14) — confirms an impulsive move
          2. Candle volume >= 1.5× rolling-average volume (lookback) — confirms
             institutional participation
          3. Direction determined by close vs open of the triggering candle

        Returns ('BULLISH_OB' | 'BEARISH_OB' | 'NONE')
        """
        if len(closes) < lookback + 2:
            return False, "NONE"

        atr = self._atr(highs, lows, closes, p=14)
        if atr == 0:
            return False, "NONE"

        body_size = abs(closes[-1] - opens[-1])
        if body_size < atr * 1.5:
            return False, "NONE"

        # Safe slice: ensure we don't underflow on short deque
        vol_window = volumes[-(lookback + 1):-1] if len(volumes) > lookback else volumes[:-1]
        if len(vol_window) == 0:
            return False, "NONE"

        avg_vol = float(np.mean(vol_window))
        if avg_vol == 0 or volumes[-1] < avg_vol * 1.5:
            return False, "NONE"

        if closes[-1] > opens[-1]:
            return True, "BULLISH_OB"
        else:
            return True, "BEARISH_OB"

    @staticmethod
    def _atr_5m(highs, lows, closes, n_agg=5, p=14) -> float:
        """
        ALIGN-5: Aggregate 1-min bars into 5-min, then compute ATR.
        This produces ATR values comparable to Pine's ta.atr(14) on a 5-min chart.
        Used exclusively for TP/SL calculation so dollar distances are meaningful.
        """
        n = len(highs)
        if n < n_agg * (p + 1):
            # Not enough bars — fall back to raw ATR scaled up
            tr = [max(highs[i] - lows[i],
                      abs(highs[i] - closes[i - 1]),
                      abs(lows[i] - closes[i - 1]))
                  for i in range(1, n)]
            return float(np.mean(tr[-p:])) * 1.8 if tr else 0.0

        agg_h, agg_l, agg_c = [], [], []
        for i in range(0, n - n_agg + 1, n_agg):
            agg_h.append(np.max(highs[i:i + n_agg]))
            agg_l.append(np.min(lows[i:i + n_agg]))
            agg_c.append(closes[i + n_agg - 1])

        if len(agg_h) < p + 1:
            tr = [max(highs[i] - lows[i],
                      abs(highs[i] - closes[i - 1]),
                      abs(lows[i] - closes[i - 1]))
                  for i in range(1, n)]
            return float(np.mean(tr[-p:])) * 1.8 if tr else 0.0

        agg_h = np.array(agg_h)
        agg_l = np.array(agg_l)
        agg_c = np.array(agg_c)

        tr = [max(agg_h[i] - agg_l[i],
                  abs(agg_h[i] - agg_c[i - 1]),
                  abs(agg_l[i] - agg_c[i - 1]))
              for i in range(1, len(agg_h))]
        return float(np.mean(tr[-p:])) if tr else 0.0

    @staticmethod
    def _aggregate_bars(bars_list: list, n: int) -> list:
        """Aggregate 1-min bars into n-min OHLCV dicts. Used by MTF scanner."""
        result = []
        for i in range(0, len(bars_list) - n + 1, n):
            chunk = bars_list[i:i + n]
            result.append({
                "open":   chunk[0].open,
                "high":   max(b.high   for b in chunk),
                "low":    min(b.low    for b in chunk),
                "close":  chunk[-1].close,
                "volume": sum(b.volume for b in chunk),
            })
        return result

    def get_mtf_indicators(self) -> dict:
        """
        Compute 5m and 15m trend/momentum indicators from the existing 1m bars deque.
        Returns: { "5m": {...}, "15m": {...}, "weighted_sub": float, "aligned": bool }
        Called by ScalpingSignalEngine.get_mtf_snapshot().
        """
        bars_list = list(self.bars)

        def _ema_arr(values, period):
            if len(values) < period:
                return float(np.mean(values)) if len(values) > 0 else 0.0
            k = 2.0 / (period + 1)
            ema = float(np.mean(values[:period]))
            for v in values[period:]:
                ema = v * k + ema * (1 - k)
            return ema

        def _rsi_arr(closes, period=14):
            if len(closes) < period + 1:
                return 50.0
            deltas = np.diff(closes)
            gains  = np.where(deltas > 0, deltas, 0.0)
            losses = np.where(deltas < 0, -deltas, 0.0)
            avg_g  = float(np.mean(gains[-period:]))
            avg_l  = float(np.mean(losses[-period:]))
            if avg_l == 0:
                return 100.0
            return round(100.0 - 100.0 / (1 + avg_g / avg_l), 1)

        vwap_ref = 0.0
        if self._vwap_cum_vol > 0:
            vwap_ref = self._vwap_cum_pv / self._vwap_cum_vol

        def _tf_indicators(agg_bars):
            if len(agg_bars) < 5:
                return None
            closes = np.array([b["close"] for b in agg_bars])
            ema8   = _ema_arr(closes, 8)
            ema21  = _ema_arr(closes, 21)
            rsi    = _rsi_arr(closes)
            last_c = float(closes[-1])
            vwap_above = last_c > vwap_ref if vwap_ref > 0 else None
            if ema8 > ema21 and last_c > ema8:
                trend = "Bullish"
            elif ema8 < ema21 and last_c < ema8:
                trend = "Bearish"
            else:
                trend = "Sideways"
            return {"ema8": round(ema8, 4), "ema21": round(ema21, 4),
                    "rsi": rsi, "vwap_above": vwap_above,
                    "trend": trend, "bars_count": len(agg_bars)}

        tf5  = _tf_indicators(self._aggregate_bars(bars_list, 5))
        tf15 = _tf_indicators(self._aggregate_bars(bars_list, 15))

        def _score(tf):
            if tf is None: return 0
            return 1 if tf["trend"] == "Bullish" else -1 if tf["trend"] == "Bearish" else 0

        weighted_sub = _score(tf5) * 0.35 + _score(tf15) * 0.25
        aligned = (tf5 is not None and tf15 is not None
                   and tf5["trend"] == tf15["trend"]
                   and tf5["trend"] != "Sideways")

        return {"5m": tf5, "15m": tf15,
                "weighted_sub": round(weighted_sub, 3), "aligned": aligned,
                "vwap_ref": round(vwap_ref, 4)}

    def _compute(self, bar: OHLCVBar) -> dict:
        closes  = self._arr('close')
        opens   = self._arr('open')          # needed for order block + volume delta
        highs   = self._arr('high')
        lows    = self._arr('low')
        volumes = self._arr('volume')

        # VWAP (intraday cumulative, resets daily via reset_vwap)
        tp = (bar.high + bar.low + bar.close) / 3
        self._vwap_cum_pv  += tp * bar.volume
        self._vwap_cum_vol += bar.volume
        vwap = self._vwap_cum_pv / (self._vwap_cum_vol + 1e-10)

        # ALIGN-1: EMAs — EMA(8) to match Pine's ema8, keep ema21
        ema8  = self._ema(closes, 8)
        ema21 = self._ema(closes, 21)

        # FIX-4: True streaming MACD signal line
        macd_line = self._ema(closes, 12) - self._ema(closes, 26)
        self._macd_history.append(macd_line)
        if len(self._macd_history) >= 9:
            macd_signal = self._ema(np.array(self._macd_history), 9)
        else:
            macd_signal = float(np.mean(self._macd_history))
        macd_hist = macd_line - macd_signal

        # RSI (Wilder) — matches Pine ta.rsi(close, 14)
        rsi = self._rsi(closes)

        # ALIGN-2: Stochastic — kp=14 to match Pine ta.stoch(close,high,low,14)
        stoch_k, stoch_d = self._stoch(highs, lows, closes)

        # ALIGN-3: Bollinger Bands (20-period) — ddof=1 to match Pine ta.stdev
        bb_mid   = float(np.mean(closes[-20:]))
        bb_std   = float(np.std(closes[-20:], ddof=1))
        bb_upper = bb_mid + 2 * bb_std
        bb_lower = bb_mid - 2 * bb_std

        # ATR (1-min) / ADX — used for indicators, NOT for TP/SL
        atr = self._atr(highs, lows, closes)
        adx = self._adx(highs, lows, closes)

        # ALIGN-5: 5-min aggregated ATR for TP/SL calculation
        atr_5m = self._atr_5m(highs, lows, closes)

        # OBV (FIX-1: _obv reset daily alongside VWAP in reset_vwap)
        if len(self.bars) >= 2:
            prev = list(self.bars)[-2]
            if bar.close > prev.close:
                self._obv += bar.volume
            elif bar.close < prev.close:
                self._obv -= bar.volume

        # Volume ratio — safe floor prevents divide-by-zero / extreme multipliers
        raw_avg_vol  = float(np.mean(volumes[-20:])) if len(volumes) >= 20 else float(volumes.mean())
        safe_avg_vol = max(raw_avg_vol, 500.0)
        vol_ratio    = bar.volume / safe_avg_vol

        # ALIGN-6: Volume Delta — buy/sell split by wick ratio (matches Pine logic)
        #   Pine: buyVolume  = candleRange > 0 ? volume * (close - low) / candleRange : volume * 0.5
        #         sellVolume = candleRange > 0 ? volume * (high - close) / candleRange : volume * 0.5
        candle_range = bar.high - bar.low
        if candle_range > 0 and bar.volume > 0:
            buy_vol  = bar.volume * (bar.close - bar.low) / candle_range
            sell_vol = bar.volume * (bar.high - bar.close) / candle_range
        else:
            buy_vol  = bar.volume * 0.5
            sell_vol = bar.volume * 0.5
        vol_delta = buy_vol - sell_vol

        # Volume Delta EMA(10) for momentum detection
        self._delta_history.append(vol_delta)
        if len(self._delta_history) >= 10:
            delta_ema = self._ema(np.array(self._delta_history), 10)
        else:
            delta_ema = float(np.mean(self._delta_history)) if self._delta_history else 0.0
        delta_momentum = vol_delta > delta_ema
        delta_bullish  = vol_delta > 0
        delta_bearish  = vol_delta < 0

        # ALIGN-4: Supertrend — stateful band tracking (matches Pine)
        st_val, st_dir = self._supertrend(highs, lows, closes)

        # Order Block detection — GIL-safe
        ob_active, ob_dir = self._detect_order_block(opens, highs, lows, closes, volumes)

        return dict(
            ema8=ema8, ema21=ema21, vwap=vwap,
            macd_line=macd_line, macd_signal=macd_signal, macd_hist=macd_hist,
            rsi=rsi, stoch_k=stoch_k, stoch_d=stoch_d,
            bb_upper=bb_upper, bb_mid=bb_mid, bb_lower=bb_lower,
            atr=atr, atr_5m=atr_5m, adx=adx,
            obv=self._obv, vol_ratio=vol_ratio,
            vol_delta=vol_delta, delta_ema=delta_ema,
            delta_momentum=delta_momentum,
            delta_bullish=delta_bullish, delta_bearish=delta_bearish,
            close=bar.close,
            supertrend_val=st_val, supertrend_dir=st_dir,
            ob_active=ob_active, ob_dir=ob_dir,
            day_high=float(np.max(highs)),   # session high across rolling window
            day_low=float(np.min(lows)),     # session low  across rolling window
        )

# ═══════════════════════════════════════════════════════════════════════════════
# SIGNAL ENGINE
# ═══════════════════════════════════════════════════════════════════════════════

class ScalpingSignalEngine:
    """
    Core signal evaluator.
    Scoring: Trend ~30% | Momentum ~35% | Volume ~20% | ADX multiplier | Session multiplier
    """

    # Thresholds
    RSI_OB, RSI_OS        = 70, 30
    RSI_BULL, RSI_BEAR    = 55, 45
    STOCH_OB, STOCH_OS    = 80, 20
    ADX_TREND, ADX_STRONG = 25, 40
    VOL_SPIKE, VOL_HIGH   = 1.5, 2.0
    ATR_SL_MULT           = 1.5       # ALIGN-5: matches Pine slMultiplier (uses atr_5m)
    ATR_TP_MULT           = 3.0       # ALIGN-5: SL × R:R(2.0) = 1.5 × 2.0 = 3.0

    def __init__(self, db=None, broadcast_cb=None):
        self._db = db
        self._broadcast_cb = broadcast_cb
        self._calcs:      Dict[str, IndicatorCalculator] = {}
        self._last_sig:   Dict[str, float] = {}   # FIX-10: purged every 10 min
        self._last_purge: float = std_time.time()
        self._callbacks:  List  = []
        self._lock        = threading.Lock()
        
        # New: Tracked symbols for filtering on_tick
        self._watched: set = set()

        # Ring buffer of last 200 signals (for dashboard /api/signals)
        self.signal_history: deque = deque(maxlen=200)

        # FIX-5: date-guard prevents missed/double VWAP reset
        self._vwap_reset_date: Optional[date] = None

        # If a broadcast_cb was passed, register it
        if broadcast_cb:
            self.on_signal(broadcast_cb)

        self._start_vwap_scheduler()

    @property
    def watched(self):
        """Used by ws_engine metrics."""
        return list(self._watched)

    def set_watchlist(self, symbols: List[str]):
        """Updates the active watchlist symbols."""
        with self._lock:
            self._watched = set([s.upper().strip() for s in symbols])
            # Optional: Clear calculators for symbols no longer watched
            to_remove = [s for s in self._calcs if s not in self._watched]
            for s in to_remove:
                del self._calcs[s]
        logger.info(f"Signal Watchlist updated: {len(self._watched)} symbols")

    def start(self):
        """Hook for future async/thread initialization if needed."""
        logger.info("Scalping Signal Engine started")

    def stop(self):
        """Hook for cleanup."""
        logger.info("Scalping Signal Engine stopped")

    def on_tick(
        self,
        ticker: str,
        price: float,
        ts_ms: Optional[int] = None,
        # ── Feature: LULD circuit breaker ─────────────────────────────────────
        is_halted: bool      = False,
        halt_state: Optional[int] = None,
        # ── Feature: NOI institutional filter ─────────────────────────────────
        imbalance_size: int  = 0,
        imbalance_side: str  = "N",   # "B"=buy, "S"=sell, "N"=none
    ):
        """
        Entry point from ws_engine.py.
        Receives live tick data enriched with Advanced plan indicators.

        Circuit breaker (is_halted):
          Immediately returns if the stock is in an LULD halt — prevents
          generating signals on frozen prices / bad ticks during the halt.

        AH NOI filter (imbalance_side):
          In pre/after-hours sessions, rejects momentum signals whose price
          direction conflicts with institutional order imbalance, avoiding
          'bull traps' and 'bear traps' caused by thin retail liquidity.
        """
        if ticker not in self._watched:
            return

        # ── LULD circuit breaker ───────────────────────────────────────────────
        if is_halted:
            # Stock is frozen — do NOT process bars or generate signals.
            # Avoids: slippage on halt entry, RSI skew from bad ticks,
            # false volume-spike signals from halt-related prints.
            logger.debug(f"SIGNAL SUPPRESSED: {ticker} LULD halt state={halt_state}")
            return

        et_tz = pytz.timezone("America/New_York")
        ts = datetime.fromtimestamp(ts_ms/1000.0, tz=et_tz) if ts_ms else datetime.now(et_tz)

        # ── NOI institutional AH filter ────────────────────────────────────────
        # Only active during pre-market / after-hours when liquidity is thin.
        # Filters: rising price + institutional SELL imbalance = likely bull trap.
        #          falling price + institutional BUY  imbalance = likely bear trap.
        if imbalance_side in ("B", "S") and imbalance_size > 0:
            session = _get_session(ts)
            if session in (MarketSession.PRE, MarketSession.AFTER):
                with self._lock:
                    calc = self._calcs.get(ticker)
                    if calc and calc._latest_ind is not None:
                        last_close = calc._latest_ind.get("close", price)
                        price_rising  = price > last_close * 1.001   # >0.1% up
                        price_falling = price < last_close * 0.999   # >0.1% down
                        if price_rising  and imbalance_side == "S":
                            logger.debug(f"NOI FILTER: {ticker} price↑ but imbalance=SELL — skipping")
                            return
                        if price_falling and imbalance_side == "B":
                            logger.debug(f"NOI FILTER: {ticker} price↓ but imbalance=BUY — skipping")
                            return

        # Create a 'pseudo-bar' from the live tick.
        # (WSEngine provides 1m aggregates 'A' or live trades 'T' through this)
        bar = OHLCVBar(
            timestamp=ts,
            open=price, high=price, low=price, close=price, volume=0
        )

        self.process_aggregate_bar(ticker, bar)
    # ── public API ───────────────────────────────────────────────────────────

    def on_signal(self, cb):
        """Register callback: fn(signal: TradeSignal)"""
        self._callbacks.append(cb)

    def reset_vwap_all(self):
        """Reset VWAP + OBV + MACD history for all tracked symbols at market open."""
        with self._lock:
            for c in self._calcs.values():
                c.reset_vwap()   # FIX-1: also resets OBV and MACD history
        logger.info("VWAP + OBV + MACD history reset for all symbols.")

    def get_scalp_snapshot(self, watchlist: List[str]) -> List[dict]:
        """
        Return the latest indicator snapshot + derived signal for every
        symbol in *watchlist* that has enough bars (>=27).
        Called by GET /api/scalp-analysis.
        """
        rows = []
        with self._lock:
            calcs_copy = {k: v for k, v in self._calcs.items() if k in watchlist}

        for sym, calc in calcs_copy.items():
            ind = calc._latest_ind
            if ind is None:
                rows.append({
                    "ticker": sym, "status": "warming_up",
                    "bars_count": len(calc.bars),
                })
                continue

            close   = ind["close"]
            vwap    = ind["vwap"]
            rsi     = ind["rsi"]
            stoch_k = ind["stoch_k"]
            stoch_d = ind["stoch_d"]
            macd_h  = ind["macd_hist"]
            macd_l  = ind["macd_line"]
            macd_s  = ind["macd_signal"]
            adx     = ind["adx"]
            ema8    = ind["ema8"]
            ema21   = ind["ema21"]
            vol     = ind["vol_ratio"]
            atr     = ind["atr"]
            atr_5m  = ind.get("atr_5m", atr)   # ALIGN-5: prefer 5-min ATR for TP/SL
            bb_u    = ind["bb_upper"]
            bb_l    = ind["bb_lower"]
            day_high = ind["day_high"]
            day_low  = ind["day_low"]
            # ALIGN-6: volume delta fields
            vol_delta      = ind.get("vol_delta", 0)
            delta_bullish  = ind.get("delta_bullish", False)
            delta_bearish  = ind.get("delta_bearish", False)
            delta_momentum = ind.get("delta_momentum", False)

            # ── Derived labels ───────────────────────────────────────────────
            vwap_pct    = (close - vwap) / vwap * 100 if vwap else 0
            vwap_status = "ABOVE" if close > vwap else "BELOW"

            macd_sig_lbl = ("Bullish" if macd_h > 0 and macd_l > macd_s
                            else "Bearish" if macd_h < 0 and macd_l < macd_s
                            else "Neutral")

            rsi_lbl = ("Overbought" if rsi >= 70 else
                       "Oversold"   if rsi <= 30 else
                       "Bull zone"  if rsi > 55  else
                       "Bear zone"  if rsi < 45  else "Neutral")

            stoch_sig = ("Bullish" if stoch_k > stoch_d and stoch_k < 80
                         else "Bearish" if stoch_k < stoch_d and stoch_k > 20
                         else "Neutral")

            trend_lbl = ("Bullish" if close > ema8 > ema21
                         else "Bearish" if close < ema8 < ema21
                         else "Sideways")

            adx_lbl   = ("Strong"   if adx >= 40
                         else "Trending" if adx >= 25
                         else "Choppy")

            # Phase 3: Supertrend + Order Block
            st_dir    = ind.get("supertrend_dir", "NEUTRAL")
            ob_active = ind.get("ob_active",      False)
            ob_dir    = ind.get("ob_dir",         "NONE")

            # Candle (very last 2 bars)
            bars_list = list(calc.bars)
            if len(bars_list) >= 2:
                y, t = bars_list[-2], bars_list[-1]
                body = abs(t.close - t.open)
                rng  = t.high - t.low or 0.001
                if body / rng < 0.1:
                    candle = "Doji"
                elif y.close < y.open and t.close > t.open and t.open <= y.close and t.close >= y.open:
                    candle = "Bullish Engulfing"
                elif y.close > y.open and t.close < t.open and t.open >= y.close and t.close <= y.open:
                    candle = "Bearish Engulfing"
                elif t.close > t.open:
                    candle = "Bullish"
                else:
                    candle = "Bearish"
            else:
                candle = "—"

            # ── Quick score (mirrors _evaluate logic, WITH session multiplier) ─
            bull = bear = 0.0
            confluence = 0
            if close > vwap:     bull += 0.15; confluence += 1
            else:                bear += 0.15
            if close > ema8 > ema21: bull += 0.15; confluence += 1
            elif close < ema8 < ema21: bear += 0.15
            if macd_h > 0 and macd_l > macd_s: bull += 0.12; confluence += 1
            elif macd_h < 0 and macd_l < macd_s: bear += 0.12
            if rsi > 55:  bull += 0.12; confluence += 1
            elif rsi < 45: bear += 0.12
            if stoch_k > stoch_d and stoch_k < 80: bull += 0.11; confluence += 1
            elif stoch_k < stoch_d and stoch_k > 20: bear += 0.11
            if vol >= 1.5:
                if bull > bear: bull += 0.12; confluence += 1
                else:           bear += 0.12
            # ALIGN-6: Volume delta confluence
            if delta_bullish and delta_momentum:
                bull += 0.08; confluence += 1
            elif delta_bearish and not delta_momentum:
                bear += 0.08
            adx_mult = 1.3 if adx >= 40 else (1.1 if adx >= 25 else 0.85)
            bull *= adx_mult; bear *= adx_mult

            # Apply same session quality multiplier as _evaluate so snapshot
            # scores match what the full evaluation engine produces
            now_ts = datetime.now(ZoneInfo("America/New_York"))
            cur_session = _get_session(now_ts)
            s_mult = {
                MarketSession.OPEN:        0.80,
                MarketSession.MID_MORNING: 1.00,
                MarketSession.AFTERNOON:   0.90,
                MarketSession.POWER_HOUR:  0.95,
                MarketSession.AFTER_HOURS: 0.70,
                MarketSession.PRE_MARKET:  0.60,
            }.get(cur_session, 0.70)
            bull *= s_mult; bear *= s_mult

            net = bull - bear

            # Map to direction / signal label
            if abs(net) < 0.45:
                direction = "NEUTRAL"; signal = "HOLD"
                strength  = "WEAK"
            elif net > 0:
                direction = "LONG";  signal = "BUY"
                strength  = "STRONG" if abs(net) >= 0.75 else ("MODERATE" if abs(net) >= 0.55 else "WEAK")
            else:
                direction = "SHORT"; signal = "SELL"
                strength  = "STRONG" if abs(net) >= 0.75 else ("MODERATE" if abs(net) >= 0.55 else "WEAK")

            conf = min(abs(net) / 0.8, 1.0)

            # ALIGN-5/7: Use 5-min ATR for TP/SL (matches Pine ATR on 5m chart)
            safe_atr = atr_5m if atr_5m > 0 else (atr if atr > 0 else close * 0.002)
            if direction == "LONG":
                sl = round(close - safe_atr * ScalpingSignalEngine.ATR_SL_MULT, 2)
                tp = round(close + safe_atr * ScalpingSignalEngine.ATR_TP_MULT, 2)
            elif direction == "SHORT":
                sl = round(close + safe_atr * ScalpingSignalEngine.ATR_SL_MULT, 2)
                tp = round(close - safe_atr * ScalpingSignalEngine.ATR_TP_MULT, 2)
            else:
                sl = round(close - safe_atr * ScalpingSignalEngine.ATR_SL_MULT, 2)
                tp = round(close + safe_atr * ScalpingSignalEngine.ATR_TP_MULT, 2)
            rr = round(abs(tp - close) / (abs(close - sl) + 1e-10), 2)

            rows.append({
                "ticker":       sym,
                "status":       "ok",
                "bars_count":   len(calc.bars),
                "price":        round(close, 2),
                "direction":    direction,
                "signal":       signal,
                "strength":     strength,
                "score":        round(net, 3),
                "confidence":   round(conf, 3),
                "prediction":   round(conf * 100, 1),
                "vwap":         round(vwap, 2),
                "vwap_status":  vwap_status,
                "vwap_pct":     round(vwap_pct, 2),
                "support":      round(min(day_low,  bb_l), 2),
                "resistance":   round(max(day_high, bb_u), 2),
                "candle":       candle,
                "macd_signal":  macd_sig_lbl,
                "macd_hist":    round(macd_h, 6),
                "rsi":          round(rsi, 1),
                "rsi_signal":   rsi_lbl,
                "stoch_k":      round(stoch_k, 1),
                "stoch_d":      round(stoch_d, 1),
                "stoch_signal": stoch_sig,
                "volume":       round(vol, 2),
                "trend":        trend_lbl,
                "adx":          round(adx, 1),
                "adx_label":    adx_lbl,
                "supertrend":   st_dir,
                "order_block":  ob_dir if ob_active else "NONE",
                "confluence":   confluence,
                "tp":           tp,
                "sl":           sl,
                "rr":           rr,
                "atr":          round(atr, 2),
                "atr_5m":       round(atr_5m, 2),
                "vol_delta":    round(vol_delta, 2),
            })

        # Sort: BUY first, then SELL, then HOLD/warming; within group by confidence desc
        order = {"BUY": 0, "SELL": 1, "HOLD": 2, "warming_up": 3}
        rows.sort(key=lambda r: (order.get(r.get("signal", "warming_up"), 3),
                                  -r.get("confidence", 0)))
        return rows

    def get_mtf_snapshot(self, watchlist: list) -> list:
        """
        Multi-timeframe confluence scanner.
        Returns per-watchlist-symbol rows with 1m/5m/15m trend alignment.
        Called by GET /api/mtf-scanner.
        """
        rows = []
        with self._lock:
            calcs_copy = {k: v for k, v in self._calcs.items() if k in watchlist}

        for symbol, calc in calcs_copy.items():
            if len(calc.bars) < 27:
                continue

            snap_list = self.get_scalp_snapshot([symbol])
            snap_1m   = next((r for r in snap_list if r.get("status") != "warming_up"), None)
            if snap_1m is None:
                continue

            mtf = calc.get_mtf_indicators()
            tf5  = mtf.get("5m")
            tf15 = mtf.get("15m")

            trend_1m = snap_1m.get("trend", "Sideways")
            score_1m = snap_1m.get("score", 0.0)
            trend_score_1m = 1 if trend_1m == "Bullish" else (-1 if trend_1m == "Bearish" else 0)
            confluence = round(
                max(-1.0, min(1.0, trend_score_1m * 0.40 + mtf["weighted_sub"])),
                3
            )

            abs_c = abs(confluence)
            tier  = "A" if abs_c >= 0.75 else "B" if abs_c >= 0.50 else "C" if abs_c >= 0.30 else "D"
            direction = "BULL" if confluence > 0.05 else ("BEAR" if confluence < -0.05 else "NEUTRAL")

            rows.append({
                "ticker":          symbol,
                "price":           snap_1m.get("price", 0),
                "signal_1m":       snap_1m.get("signal", "HOLD"),
                "score_1m":        round(score_1m, 3),
                "strength":        snap_1m.get("strength", "WEAK"),
                "trend_1m":        trend_1m,
                "trend_5m":        tf5["trend"]  if tf5  else "—",
                "trend_15m":       tf15["trend"] if tf15 else "—",
                "rsi_1m":          snap_1m.get("rsi", 50),
                "rsi_5m":          tf5["rsi"]    if tf5  else None,
                "rsi_15m":         tf15["rsi"]   if tf15 else None,
                "vwap_above_5m":   tf5["vwap_above"]  if tf5  else None,
                "vwap_above_15m":  tf15["vwap_above"] if tf15 else None,
                "bars_5m":         tf5["bars_count"]  if tf5  else 0,
                "bars_15m":        tf15["bars_count"] if tf15 else 0,
                "aligned":         mtf["aligned"],
                "confluence":      confluence,
                "direction":       direction,
                "tier":            tier,
                "bars_count":      len(calc.bars),
            })

        rows.sort(key=lambda r: (not r["aligned"], -abs(r["confluence"])))
        return rows

    # FIX-5: date-guard scheduler
    def _start_vwap_scheduler(self):
        """
        Background daemon that resets indicators at 09:30 ET on weekdays.

        FIX-5: Uses a date guard + 10-second poll instead of exact-second check.
        Original polled every 0.5s checking second==0 — on Windows (15ms sleep
        resolution) this frequently missed the window, leaving stale VWAP all day.
        Now: checks every 10s, fires once per calendar day (date guard ensures
        no double-trigger even if the check runs at 09:30:05 or 09:30:50).
        """
        def scheduler_loop():
            et_tz = pytz.timezone("America/New_York")
            while True:
                now_et = datetime.now(et_tz)
                today  = now_et.date()

                if (now_et.weekday() < 5
                        and now_et.hour == 9
                        and now_et.minute == 30
                        and self._vwap_reset_date != today):
                    self._vwap_reset_date = today
                    self.reset_vwap_all()
                    logger.info("⏰ Auto VWAP+OBV Reset triggered at market open")

                std_time.sleep(10)

        t = threading.Thread(target=scheduler_loop, daemon=True, name="AutoVWAP")
        t.start()

    def process_aggregate_bar(self, symbol: str, bar: OHLCVBar) -> Optional[TradeSignal]:
        """
        Feed a 1-min aggregate bar (from Polygon A.* or synthetic AH bar).
        Returns TradeSignal if conditions met, else None.
        """
        # FIX-6: check cooldown BEFORE running expensive indicator math
        now  = bar.timestamp.timestamp()
        last = self._last_sig.get(symbol, 0)
        if now - last < SIGNAL_COOLDOWN_SEC:
            # Still feed bar into deque so indicators warm up during cooldown
            with self._lock:
                if symbol not in self._calcs:
                    self._calcs[symbol] = IndicatorCalculator(symbol)
                self._calcs[symbol].add_bar(bar)
            return None

        with self._lock:
            if symbol not in self._calcs:
                self._calcs[symbol] = IndicatorCalculator(symbol)
            indicators = self._calcs[symbol].add_bar(bar)

        if indicators is None:
            return None

        session = _get_session(bar.timestamp)
        if session == MarketSession.MIDDAY:
            return None      # skip low-volume chop 11:30-14:00 ET

        sig = self._evaluate(symbol, bar, indicators, session)
        if sig is None:
            return None

        self._last_sig[symbol] = now
        self._maybe_purge_cooldowns(now)   # FIX-10
        self.signal_history.appendleft(sig)

        for cb in self._callbacks:
            try:
                cb(sig)
            except Exception as e:
                logger.error(f"Signal callback error: {e}")

        return sig

    # FIX-10: bounded cooldown dict — purge entries older than cooldown window
    def _maybe_purge_cooldowns(self, now: float):
        if now - self._last_purge < _COOLDOWN_PURGE_SEC:
            return
        cutoff = now - SIGNAL_COOLDOWN_SEC
        stale  = [k for k, v in self._last_sig.items() if v < cutoff]
        for k in stale:
            del self._last_sig[k]
        self._last_purge = now
        if stale:
            logger.debug(f"Purged {len(stale)} stale cooldown entries")

    # ── scoring ──────────────────────────────────────────────────────────────

    def _evaluate(self, symbol, bar, ind, session) -> Optional[TradeSignal]:
        bull = bear = 0.0
        reasons = []

        close     = ind['close']
        ema8      = ind['ema8']
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
        atr_5m    = ind.get('atr_5m', atr)  # ALIGN-5: 5-min ATR for TP/SL

        # ALIGN-1: EMA stack uses EMA(8) to match Pine
        # ── TREND (~30%) ─────────────────────────────────────────────────
        if close > ema8 > ema21:
            bull += 0.15
            reasons.append({"text": "Bullish EMA stack", "type": "bull"})
        elif close < ema8 < ema21:
            bear += 0.15
            reasons.append({"text": "Bearish EMA stack", "type": "bear"})

        vwap_pct = (close - vwap) / vwap * 100 if vwap else 0
        if close > vwap:
            bull += 0.15
            reasons.append({"text": f"Above VWAP +{vwap_pct:.2f}%", "type": "bull"})
        else:
            bear += 0.15
            reasons.append({"text": f"Below VWAP {vwap_pct:.2f}%", "type": "bear"})

        # ── MOMENTUM (~35%) ──────────────────────────────────────────────
        if macd_hist > 0 and macd_line > macd_sig:
            bull += 0.12
            reasons.append({"text": f"MACD bullish hist:{macd_hist:.4f}", "type": "bull"})
        elif macd_hist < 0 and macd_line < macd_sig:
            bear += 0.12
            reasons.append({"text": f"MACD bearish hist:{macd_hist:.4f}", "type": "bear"})

        # FIX-2: non-overlapping RSI zones
        if rsi >= self.RSI_OB:
            bear += 0.08
            reasons.append({"text": f"RSI overbought {rsi:.0f}", "type": "warn"})
        elif rsi <= self.RSI_OS:
            bull += 0.08
            reasons.append({"text": f"RSI oversold {rsi:.0f}", "type": "warn"})
        elif rsi > self.RSI_BULL:
            bull += 0.12
            reasons.append({"text": f"RSI bull zone {rsi:.0f}", "type": "bull"})
        elif rsi < self.RSI_BEAR:
            bear += 0.12
            reasons.append({"text": f"RSI bear zone {rsi:.0f}", "type": "bear"})
        elif rsi >= 50:
            bull += 0.04
        else:
            bear += 0.04

        if stk > std and stk < self.STOCH_OB:
            bull += 0.11
            reasons.append({"text": f"Stoch K{stk:.0f}↑D{std:.0f}", "type": "bull"})
        elif stk < std and stk > self.STOCH_OS:
            bear += 0.11
            reasons.append({"text": f"Stoch K{stk:.0f}↓D{std:.0f}", "type": "bear"})

        # ── VOLUME (~20%) ────────────────────────────────────────────────
        if vol_ratio >= self.VOL_HIGH:
            if bull > bear:
                bull += 0.15
                reasons.append({"text": f"Vol spike {vol_ratio:.1f}x ✅", "type": "bull"})
            else:
                bear += 0.15
                reasons.append({"text": f"Vol spike {vol_ratio:.1f}x ✅", "type": "bear"})
        elif vol_ratio >= self.VOL_SPIKE:
            if bull > bear:
                bull += 0.10
                reasons.append({"text": f"Vol {vol_ratio:.1f}x avg", "type": "bull"})
            else:
                bear += 0.10
                reasons.append({"text": f"Vol {vol_ratio:.1f}x avg", "type": "bear"})
        else:
            reasons.append({"text": f"Low vol {vol_ratio:.1f}x", "type": "warn"})

        obv = ind['obv']   # FIX-1: resets daily
        if obv > 0:
            bull += 0.05
        elif obv < 0:
            bear += 0.05

        # ALIGN-6: Volume Delta (matches Pine's buy/sell volume split)
        delta_bullish  = ind.get('delta_bullish', False)
        delta_bearish  = ind.get('delta_bearish', False)
        delta_momentum = ind.get('delta_momentum', False)
        vol_delta      = ind.get('vol_delta', 0)
        if delta_bullish and delta_momentum:
            bull += 0.08
            reasons.append({"text": "Delta Strong Buy ⚡", "type": "bull"})
        elif delta_bullish:
            bull += 0.04
            reasons.append({"text": "Delta Buy ↑", "type": "bull"})
        elif delta_bearish and not delta_momentum:
            bear += 0.08
            reasons.append({"text": "Delta Strong Sell ⚡", "type": "bear"})
        elif delta_bearish:
            bear += 0.04
            reasons.append({"text": "Delta Sell ↓", "type": "bear"})

        # ── ADX / TREND STRENGTH (multiplier, not additive weight) ───────
        mult = 1.3 if adx >= self.ADX_STRONG else (1.1 if adx >= self.ADX_TREND else 0.85)
        if adx >= self.ADX_TREND:
            reasons.append({"text": f"ADX {adx:.0f} trending", "type": "bull"})
        else:
            reasons.append({"text": f"ADX {adx:.0f} choppy — caution", "type": "warn"})
        bull *= mult
        bear *= mult

        # ── SUPERTREND (~10% additive weight) ────────────────────────────
        st_dir = ind.get('supertrend_dir', 'NEUTRAL')
        if st_dir == 'UP':
            bull += 0.10
            reasons.append({"text": "Supertrend UP ▲", "type": "bull"})
        elif st_dir == 'DOWN':
            bear += 0.10
            reasons.append({"text": "Supertrend DOWN ▼", "type": "bear"})

        # ── ORDER BLOCK (~15% additive weight) ───────────────────────────
        ob_active = ind.get('ob_active', False)
        ob_dir    = ind.get('ob_dir',    'NONE')
        if ob_active:
            if ob_dir == 'BULLISH_OB':
                bull += 0.15
                reasons.append({"text": "Bullish Order Block 🐋", "type": "bull"})
            elif ob_dir == 'BEARISH_OB':
                bear += 0.15
                reasons.append({"text": "Bearish Order Block 🔻", "type": "bear"})

        # BB extremes (bonus, not in core weights)
        if close > bb_upper:
            bear += 0.05
            reasons.append({"text": "Above BB upper — reversal risk", "type": "warn"})
        elif close < bb_lower:
            bull += 0.05
            reasons.append({"text": "Below BB lower — bounce possible", "type": "warn"})

        # FIX-7: AFTER_HOURS and PRE_MARKET explicitly in s_mult dict
        # Original: both fell through to default 0.70 — now self-documenting
        s_mult = {
            MarketSession.OPEN:        0.80,
            MarketSession.MID_MORNING: 1.00,
            MarketSession.AFTERNOON:   0.90,
            MarketSession.POWER_HOUR:  0.95,
            MarketSession.AFTER_HOURS: 0.70,   # lower quality — limited bar data
            MarketSession.PRE_MARKET:  0.60,   # very thin liquidity
        }.get(session, 0.70)
        bull *= s_mult
        bear *= s_mult

        net = bull - bear
        if abs(net) < MIN_SCORE_TRADE:
            return None

        direction = 1 if net > 0 else -1
        conf      = min(abs(net) / 0.8, 1.0)
        if conf < MIN_CONFIDENCE:
            return None

        abs_net = abs(net)
        if abs_net >= 0.75:
            sig      = Signal.STRONG_BUY  if direction > 0 else Signal.STRONG_SELL
            strength = "STRONG"
        elif abs_net >= 0.55:
            sig      = Signal.BUY         if direction > 0 else Signal.SELL
            strength = "MODERATE"
        else:
            sig      = Signal.WEAK_BUY    if direction > 0 else Signal.WEAK_SELL
            strength = "WEAK"

        # ALIGN-5: Use 5-min ATR for TP/SL (matches Pine ATR on 5m chart)
        safe_atr = atr_5m if atr_5m > 0 else (atr if atr > 0 else close * 0.002)
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
# SMART ALERTS ENGINE  — Feature #1
# ═══════════════════════════════════════════════════════════════════════════════

ALERT_COOLDOWN_SEC = 300   # 5 min per ticker+type


class SmartAlertsEngine:
    """
    Edge-triggered alert engine on top of ScalpingSignalEngine.
    Polls get_scalp_snapshot() every POLL_SEC seconds, diffs indicator
    state, fires SSE type:"alert" events on state transitions only.

    Alert types: VWAP_RECLAIM, VWAP_BREAK, EMA_BULL_CROSS, EMA_BEAR_CROSS,
                 RVOL_SPIKE, HOD_BREAK, LOD_BREAK, STRONG_BUY, STRONG_SELL

    BUG-02 FIX: broadcast_cb is SSEBroadcaster.publish which is async def.
    Calling it synchronously from this background thread returns an unawaited
    coroutine — silently dropped. Fix: store event loop, use
    asyncio.run_coroutine_threadsafe() identically to WSEngine._broadcast().
    """

    POLL_SEC = 10

    def __init__(self, engine: "ScalpingSignalEngine", broadcast_cb=None, loop=None):
        self._engine       = engine
        self._broadcast_cb = broadcast_cb
        self._loop         = loop          # BUG-02: asyncio event loop for threadsafe dispatch
        self._watchlist: list = []
        self._prev:      dict = {}
        self._cooldowns: dict = {}
        self._lock        = threading.Lock()
        self.alert_history = deque(maxlen=100)
        self._shutdown    = threading.Event()

    def set_watchlist(self, symbols: list):
        with self._lock:
            self._watchlist = list(symbols)

    def start(self):
        t = threading.Thread(target=self._loop, daemon=True, name="smart-alerts")
        t.start()
        logger.info("SmartAlertsEngine started")

    def stop(self):
        self._shutdown.set()

    def get_recent_alerts(self, limit: int = 50) -> list:
        with self._lock:
            return list(self.alert_history)[:limit]

    def _loop(self):
        while not self._shutdown.is_set():
            try:
                self._check()
            except Exception as exc:
                logger.warning(f"SmartAlertsEngine poll error: {exc}")
            self._shutdown.wait(self.POLL_SEC)

    def _check(self):
        with self._lock:
            watchlist = list(self._watchlist)
        if not watchlist:
            return

        rows = self._engine.get_scalp_snapshot(watchlist)
        now  = std_time.time()

        for row in rows:
            if row.get("status") == "warming_up":
                continue

            ticker     = row["ticker"]
            prev       = self._prev.get(ticker, {})

            close      = row.get("price", 0)
            vwap       = row.get("vwap", 0)
            vwap_pos   = row.get("vwap_status", "")
            trend      = row.get("trend", "")
            vol_ratio  = row.get("volume", 1.0)
            signal     = row.get("signal", "HOLD")
            strength   = row.get("strength", "WEAK")
            score      = row.get("score", 0.0)
            resistance = row.get("resistance", 0)
            support    = row.get("support", 0)

            p_vwap_pos   = prev.get("vwap_pos", "")
            p_trend      = prev.get("trend", "")
            p_vol_ratio  = prev.get("vol_ratio", 0)
            p_signal     = prev.get("signal", "HOLD")
            p_close      = prev.get("close", close)
            p_resistance = prev.get("resistance", resistance)
            p_support    = prev.get("support", support)

            candidates = []

            if p_vwap_pos == "BELOW" and vwap_pos == "ABOVE" and vwap > 0:
                candidates.append(("VWAP_RECLAIM", "🔼", "VWAP Reclaim",
                    f"Reclaimed VWAP at ${close:.2f} (VWAP ${vwap:.2f})", "green"))

            if p_vwap_pos == "ABOVE" and vwap_pos == "BELOW" and vwap > 0:
                candidates.append(("VWAP_BREAK", "🔽", "VWAP Break",
                    f"Broke below VWAP at ${close:.2f} (VWAP ${vwap:.2f})", "red"))

            if p_trend in ("Bearish", "Sideways") and trend == "Bullish":
                candidates.append(("EMA_BULL_CROSS", "📈", "EMA Bull Cross",
                    f"EMA 8 crossed above EMA 21 at ${close:.2f}", "green"))

            if p_trend in ("Bullish", "Sideways") and trend == "Bearish":
                candidates.append(("EMA_BEAR_CROSS", "📉", "EMA Bear Cross",
                    f"EMA 8 crossed below EMA 21 at ${close:.2f}", "red"))

            if p_vol_ratio < 2.0 and vol_ratio >= 2.0:
                candidates.append(("RVOL_SPIKE", "🔥", "Volume Spike",
                    f"RVOL {vol_ratio:.1f}× — unusual volume surge", "gold"))

            if p_close < p_resistance and close >= resistance and resistance > 0:
                candidates.append(("HOD_BREAK", "🚀", "HOD Break",
                    f"Breaking session high at ${close:.2f}", "cyan"))

            if p_close > p_support and close <= support and support > 0:
                candidates.append(("LOD_BREAK", "🕳", "LOD Break",
                    f"Breaking session low at ${close:.2f}", "red"))

            if p_signal != "BUY" and signal == "BUY" and strength in ("STRONG", "MODERATE"):
                candidates.append(("STRONG_BUY", "⚡", "Strong Buy Signal",
                    f"Score {score:+.2f} — {strength} conviction LONG", "green"))

            if p_signal != "SELL" and signal == "SELL" and strength in ("STRONG", "MODERATE"):
                candidates.append(("STRONG_SELL", "⚡", "Strong Sell Signal",
                    f"Score {score:+.2f} — {strength} conviction SHORT", "red"))

            for (atype, emoji, title, message, color) in candidates:
                key = (ticker, atype)
                if now - self._cooldowns.get(key, 0) < ALERT_COOLDOWN_SEC:
                    continue
                self._cooldowns[key] = now

                alert = {
                    "type":     atype,
                    "emoji":    emoji,
                    "title":    f"{ticker} {title}",
                    "message":  message,
                    "color":    color,
                    "ticker":   ticker,
                    "price":    close,
                    "score":    round(score, 3),
                    "signal":   signal,
                    "strength": strength,
                    "ts":       int(now * 1000),
                }
                with self._lock:
                    self.alert_history.appendleft(alert)

                if self._broadcast_cb:
                    # BUG-02 FIX: broadcaster.publish is async def — calling it
                    # synchronously returns a coroutine that is never awaited,
                    # silently dropping every alert. Use run_coroutine_threadsafe
                    # exactly as WSEngine._broadcast() does.
                    try:
                        if self._loop and not self._loop.is_closed():
                            coro   = self._broadcast_cb({"type": "alert", "data": alert})
                            future = asyncio.run_coroutine_threadsafe(coro, self._loop)
                            future.add_done_callback(
                                lambda f: f.exception() if not f.cancelled() else None
                            )
                        else:
                            # Fallback: loop not available (unit tests / Streamlit mode)
                            logger.debug("Alert broadcast: no event loop — alert stored in history only")
                    except Exception as exc:
                        logger.warning(f"Alert broadcast error: {exc}")

                logger.info(f"ALERT {emoji} {atype} {ticker} @ ${close:.2f}")

            self._prev[ticker] = {
                "vwap_pos":   vwap_pos,
                "trend":      trend,
                "vol_ratio":  vol_ratio,
                "signal":     signal,
                "strength":   strength,
                "close":      close,
                "support":    support,
                "resistance": resistance,
            }


# ═══════════════════════════════════════════════════════════════════════════════
# WATCHLIST MANAGER  (user selects up to 50 symbols)
# ═══════════════════════════════════════════════════════════════════════════════

class SignalWatchlistManager:
    """
    Bridges user-selected symbols <-> ScalpingSignalEngine.
    Tap this from Radar Pro's existing all_tickers set.

    FIX-3: seed_history_from_rest() seeds today's intraday bars from Polygon REST.
    Call this at startup so:
      - Indicators warm up immediately (no 27-bar wait for first signal)
      - AH signals fire via seeded bars when Polygon A.* stops at 4pm
    """

    def __init__(self, engine: ScalpingSignalEngine):
        self.engine   = engine
        self._watched: set = set()
        self._lock    = threading.Lock()

    @property
    def watched(self) -> set:
        with self._lock:
            return set(self._watched)

    def set_watchlist(self, symbols: List[str]) -> List[str]:
        """Replace watchlist (max 50 symbols). Returns the accepted list."""
        clean = [s.upper().strip() for s in symbols if s.strip()][:MAX_WATCH_SYMBOLS]
        with self._lock:
            self._watched = set(clean)
        logger.info(f"Signal watchlist updated: {len(clean)} symbols -> {clean}")
        return clean

    def load_from_file(self, path: str = "Cache/signal_watchlist.json"):
        """
        Load watchlist from JSON file on disk.
        Falls back to empty watchlist if file not found.
        """
        import json
        DEFAULT_WATCHLIST = []
        try:
            if os.path.exists(path):
                with open(path, "r") as f:
                    symbols = json.load(f)
                accepted = self.set_watchlist(symbols)
                logger.info(f"Signal watchlist loaded from {path}: {len(accepted)} symbols")
            else:
                accepted = self.set_watchlist(DEFAULT_WATCHLIST)
                os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
                with open(path, "w") as f:
                    json.dump(DEFAULT_WATCHLIST, f, indent=2)
                logger.info(f"Signal watchlist initialized empty, saved to {path}")
        except Exception as e:
            logger.warning(f"Signal watchlist load failed ({e}), using empty list")
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

        unix_ms = getattr(msg, 'e', getattr(msg, 'end_timestamp', None))
        et_tz   = pytz.timezone("America/New_York")

        if unix_ms:
            true_time = datetime.fromtimestamp(unix_ms / 1000.0, tz=et_tz)
        else:
            true_time = datetime.now(et_tz)

        try:
            bar = OHLCVBar(
                timestamp = true_time,
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

    # FIX-3: Seed indicator history from Polygon REST API
    def seed_history_from_rest(self, polygon_api_key: str, symbols: Optional[List[str]] = None):
        """
        Fetch today's 1-min bars from Polygon REST for each watched symbol
        and feed them into the indicator calculators. Runs in a background thread.

        WHY: Polygon A.* (aggregate WebSocket) messages stop at 4:00pm ET.
             Without seeded bars, AH signals never fire because the 27-bar
             warm-up window is never reached from live ticks alone.
             Also eliminates the 27-minute wait at market open before first signal.

        CALL AT:
          1. Startup / watchlist load — warm up indicators immediately
          2. 4:00pm ET — re-seed so AH signals have a full indicator history

        Args:
            polygon_api_key : Your Polygon.io API key (same one used by ws_engine)
            symbols         : Override list. Defaults to current watchlist.
        """
        def _seed():
            try:
                import urllib.request
                import json as _json

                et_tz   = pytz.timezone("America/New_York")
                today   = datetime.now(et_tz).strftime("%Y-%m-%d")
                targets = symbols or list(self.watched)

                if not targets:
                    logger.info("seed_history_from_rest: watchlist empty — nothing to seed")
                    return

                logger.info(f"Seeding bar history for {len(targets)} symbols ({today})...")
                seeded = 0

                for sym in targets:
                    try:
                        url = (
                            f"https://api.polygon.io/v2/aggs/ticker/{sym}/range/1/minute"
                            f"/{today}/{today}"
                            f"?adjusted=true&sort=asc&limit=390&apiKey={polygon_api_key}"
                        )
                        with urllib.request.urlopen(url, timeout=10) as resp:
                            data = _json.loads(resp.read().decode())

                        bars_raw = data.get("results", [])
                        if not bars_raw:
                            logger.debug(f"seed_history: no bars returned for {sym}")
                            continue

                        for r in bars_raw:
                            ts  = datetime.fromtimestamp(r["t"] / 1000.0, tz=et_tz)
                            bar = OHLCVBar(
                                timestamp = ts,
                                open      = float(r.get("o", 0)),
                                high      = float(r.get("h", 0)),
                                low       = float(r.get("l", 0)),
                                close     = float(r.get("c", 0)),
                                volume    = float(r.get("v", 0)),
                            )
                            if bar.close > 0:
                                self.engine.process_aggregate_bar(sym, bar)

                        seeded += 1
                        logger.debug(f"Seeded {len(bars_raw)} bars for {sym}")

                    except Exception as e:
                        logger.warning(f"seed_history: failed for {sym}: {e}")

                logger.info(f"Bar history seeded for {seeded}/{len(targets)} symbols")

            except Exception as e:
                logger.error(f"seed_history_from_rest thread error: {e}")

        t = threading.Thread(target=_seed, daemon=True, name="BarHistorySeed")
        t.start()


# ═══════════════════════════════════════════════════════════════════════════════
# CHROME TAB LAUNCHER
# ═══════════════════════════════════════════════════════════════════════════════

_dashboard_process  = None
_dashboard_launched = False


def launch_signal_dashboard():
    """
    Starts signal_dashboard_page.py on port 8502 and opens it in the browser.
    Safe to call multiple times — relaunches if the process has died.

    Windows 11 browser-open strategy (in order):
      1. Chrome via registry / known paths
      2. Edge fallback
      3. Windows start shell command (uses default browser)
      4. Python webbrowser module
    """
    global _dashboard_process, _dashboard_launched

    if _dashboard_launched and _dashboard_process is not None:
        if _dashboard_process.poll() is None:
            logger.info("Signal dashboard already running — just opening URL")
            _open_browser_url(f"http://localhost:{SIGNAL_DASHBOARD_PORT}")
            return
        else:
            logger.info("Signal dashboard process had died — restarting")
            _dashboard_launched = False

    _dashboard_launched = True
    dashboard_script = os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        "signal_dashboard_page.py"
    )

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
             "--server.port",              str(SIGNAL_DASHBOARD_PORT),
             "--server.address",           "localhost",
             "--server.headless",          "true",
             "--browser.gatherUsageStats", "false",
             "--server.runOnSave",         "false"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            cwd=os.path.dirname(os.path.abspath(__file__)),
        )
        logger.info(f"Signal dashboard process started (PID {_dashboard_process.pid})")

    except Exception as e:
        logger.error(f"Failed to start signal dashboard process: {e}")
        _dashboard_launched = False
        return

    def _open_after_startup():
        import socket
        url = f"http://localhost:{SIGNAL_DASHBOARD_PORT}"
        for attempt in range(15):
            std_time.sleep(1)
            try:
                with socket.create_connection(("localhost", SIGNAL_DASHBOARD_PORT), timeout=1):
                    logger.info(f"Port {SIGNAL_DASHBOARD_PORT} open after {attempt+1}s")
                    break
            except OSError:
                continue
        else:
            logger.warning(f"Port {SIGNAL_DASHBOARD_PORT} did not open in 15s — opening anyway")
        _open_browser_url(url)

    threading.Thread(target=_open_after_startup, daemon=True).start()


def _open_browser_url(url: str):
    """
    Open a URL in Chrome / Edge / default browser on Windows 11 / Mac / Linux.
    FIX-8: removed duplicate `import webbrowser` at top of original function.
    """
    chrome_path = _find_chrome()

    if chrome_path:
        try:
            subprocess.Popen([chrome_path, "--new-tab", url],
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return
        except Exception as e:
            logger.warning(f"Direct browser launch failed ({e}) — trying fallbacks")

    if sys.platform == "win32":
        try:
            os.startfile(url)
            logger.info(f"Opened via os.startfile: {url}")
            return
        except Exception:
            pass
        try:
            subprocess.Popen(f'start "" "{url}"', shell=True)
            logger.info(f"Opened via shell start: {url}")
            return
        except Exception as e:
            logger.warning(f"Shell start failed: {e}")

    try:
        import webbrowser   # stdlib fallback — cross-platform
        webbrowser.open_new_tab(url)
        logger.info(f"Opened via webbrowser module: {url}")
    except Exception as e:
        logger.error(
            f"All browser-open strategies failed. "
            f"Please open manually: {url}  (error: {e})"
        )


def _find_chrome() -> Optional[str]:
    """
    Find Chrome executable on Windows 11 / Mac / Linux.
    Search order:
      1. Windows registry  (most reliable — handles all install types)
      2. Common fixed paths (Program Files, user profile, local AppData)
      3. Mac / Linux paths
    Returns path string or None.
    """
    if sys.platform == "win32":
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

        user_profile = os.environ.get("USERPROFILE", "C:\\Users\\User")
        local_app    = os.environ.get("LOCALAPPDATA",     os.path.join(user_profile, "AppData", "Local"))
        prog_files   = os.environ.get("PROGRAMFILES",     r"C:\Program Files")
        prog_files86 = os.environ.get("PROGRAMFILES(X86)", r"C:\Program Files (x86)")

        candidates = [
            os.path.join(local_app,    "Google", "Chrome",      "Application", "chrome.exe"),
            os.path.join(prog_files,   "Google", "Chrome",      "Application", "chrome.exe"),
            os.path.join(prog_files86, "Google", "Chrome",      "Application", "chrome.exe"),
            os.path.join(local_app,    "Google", "Chrome Beta", "Application", "chrome.exe"),
            os.path.join(local_app,    "Google", "Chrome Dev",  "Application", "chrome.exe"),
            os.path.join(local_app,    "Google", "Chrome SxS",  "Application", "chrome.exe"),
            os.path.join(prog_files,   "Microsoft", "Edge",     "Application", "msedge.exe"),
            os.path.join(prog_files86, "Microsoft", "Edge",     "Application", "msedge.exe"),
        ]
        for c in candidates:
            if os.path.exists(c):
                return c
        return None

    mac_candidates = [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ]
    for c in mac_candidates:
        if os.path.exists(c):
            return c

    for cmd in ("google-chrome", "google-chrome-stable", "chromium-browser", "chromium"):
        result = subprocess.run(["which", cmd], capture_output=True, text=True)
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout.strip()

    return None


# ═══════════════════════════════════════════════════════════════════════════════
# HELPER UTILITY
# ═══════════════════════════════════════════════════════════════════════════════

def _get_session(ts: datetime) -> MarketSession:
    """Convert a timestamp to its ET market session."""
    et_tz = pytz.timezone("America/New_York")
    if ts.tzinfo is None:
        ts = pytz.utc.localize(ts).astimezone(et_tz)
    else:
        ts = ts.astimezone(et_tz)
    t = ts.time()
    if   t < time(9,  30): return MarketSession.PRE_MARKET
    elif t < time(10,  0): return MarketSession.OPEN
    elif t < time(11, 30): return MarketSession.MID_MORNING
    elif t < time(14,  0): return MarketSession.MIDDAY
    elif t < time(15, 30): return MarketSession.AFTERNOON
    elif t < time(16,  0): return MarketSession.POWER_HOUR
    else:                  return MarketSession.AFTER_HOURS
