"""
market_monitor_api.py — NexRadar Pro  v3
=========================================
Tech analysis for the user's ★ watchlist tickers.
Called by GET /api/market-monitor.

ARCHITECTURE v3 — ZERO YFINANCE / ZERO PANDAS / ZERO HTTP on the hot path
═══════════════════════════════════════════════════════════════════════════════

v1/v2 (deprecated):
  Frontend request → yfinance.history("5m") × 50 tickers  ← 50 Yahoo HTTP req
  → pandas DataFrame → NumPy indicators → 900s cache → response (6-8s, 429 risk)

v3 (this file):
  Frontend request → signal_engine.get_scalp_snapshot(watchlist) ← memory read
  → field mapping + labels (~0.001s) → 60s cache → response

WHY THIS WORKS:
  ScalpingSignalEngine already maintains a 200-bar rolling IndicatorCalculator
  per watched ticker, fed by Polygon A.* (1-min aggregates) on the existing
  WebSocket connection. Every indicator v2 computed from yfinance 5m bars is
  available from _latest_ind, pre-computed per bar:
    RSI(14) Wilder, EMA(8/21) trend, BB(20,2σ ddof=1), ATR 5-min aggregated,
    VWAP intraday cumulative, MACD(12,26,9) streaming, Stochastic(14,3),
    ADX(14), Supertrend(10,3) Pine-aligned, Order Block, Volume delta

HYBRID WARM-UP — COLD START SAFETY NET:
  After a server restart mid-session the WS feed only delivers new bars.
  IndicatorCalculator needs 27+ bars before producing valid RSI/EMA/BB.
  Fix: seed_history_from_rest() in SignalWatchlistManager fetches today's
  1-min bars from Polygon REST on startup and on watchlist add.
  Called in lifespan() and watchlist_add() in main.py — no yfinance involved.

DEPENDENCY INJECTION:
  get_cached_monitor(watchlist_tickers, signal_engine, force_refresh=False)
  signal_engine = app.state.engine._signal_watcher, passed by the route handler.

RESPONSE SHAPE:
  Identical to v2 — all existing fields present with same types and label
  values. Zero frontend changes required.
  v3 extras (ignored by v2 consumers): signal, strength, vwap, macd_signal,
  adx, supertrend, order_block, confluence, tp, sl, rr, bars_count.

FIELD MAPPING (v2 → v3 source):
  rsi, rsi_signal     ← ind.rsi + _rsi_signal()      [identical Wilder math]
  trend, trend_detail ← EMA8/EMA21 stack              [replaces SMA50]
  bb_status           ← price vs bb_upper/bb_lower    [ddof=1, Pine-matched]
  candlestick         ← last 2 bars in calc.bars deque
  atr                 ← ind.atr_5m (5-min aggregated)
  rvol                ← ind.vol_ratio (20-bar rolling)
  inst_footprint      ← vol_ratio + vol_delta direction
  score, alerts       ← same v2 weights / confluence conditions
  sma_50              ← None  (unavailable from 1-min intraday)
  fcf_yield, de_ratio ← None  (never available without stock.info)
"""

import time
import logging
import threading
from typing import Dict, List, Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from Scalping_Signal import ScalpingSignalEngine

logger = logging.getLogger(__name__)

# ── Cache: 60s TTL (data updates every 1-min bar; 900s was unnecessarily stale)
_monitor_cache: Dict = {"data": [], "ts": 0, "tickers": []}
_monitor_lock  = threading.Lock()
_CACHE_TTL_SEC = 60


# ══════════════════════════════════════════════════════════════════════════════
# LABEL HELPERS  — pure functions, no I/O, no pandas, no yfinance
# ══════════════════════════════════════════════════════════════════════════════

def _rsi_signal(rsi: Optional[float]) -> str:
    if rsi is None: return "N/A"
    if rsi > 70:    return "Overbought"
    if rsi < 30:    return "Oversold"
    return "Neutral"


def _bb_status(price: float,
               bb_upper: Optional[float],
               bb_lower: Optional[float]) -> str:
    if bb_upper is None or bb_lower is None:
        return "N/A"
    if price >= bb_upper: return "Overextended (High)"
    if price <= bb_lower: return "Potential Bounce (Low)"
    return "Neutral"


def _inst_footprint(vol_ratio: float,
                    delta_bullish: bool,
                    delta_bearish: bool) -> str:
    """
    Volume ratio + delta direction → institutional footprint label.
    Volume delta (buy/sell split by wick ratio) is a more accurate directional
    proxy than v2's close-vs-open comparison.
    """
    if vol_ratio >= 2.0:
        if delta_bullish:  return "Institutional Accumulation (Buying)"
        if delta_bearish:  return "Institutional Distribution (Selling)"
        return "High Volume (Neutral)"
    if vol_ratio >= 1.5:   return "Above Average Volume"
    return "Normal Volume"


def _score_and_alerts(snap: dict) -> tuple:
    """v2-identical scoring weights so sort order on Signals page is unchanged."""
    rsi_sig = snap.get("rsi_signal", "N/A")
    trend   = snap.get("trend",      "N/A")
    bb_stat = snap.get("bb_status",  "N/A")
    rvol    = snap.get("rvol",       0.0)
    inst    = snap.get("inst_footprint", "")
    candle  = snap.get("candlestick",   "")

    score = 0.0
    if rsi_sig == "Oversold":                score += 2.0
    elif rsi_sig == "Overbought":            score -= 2.0
    if trend == "Bullish":                   score += 1.0
    elif trend == "Bearish":                 score -= 1.0
    if bb_stat == "Potential Bounce (Low)":  score += 1.5
    elif bb_stat == "Overextended (High)":   score -= 1.5
    if isinstance(rvol, (int, float)) and rvol > 2.0:
        score += 1.0
        if "Accumulation" in str(inst):      score += 1.5
        elif "Distribution" in str(inst):    score -= 1.5
    if candle == "Bullish Engulfing":        score += 1.5
    elif candle == "Bearish Engulfing":      score -= 1.5

    alerts = []
    if "Accumulation" in str(inst):
        alerts.append({"type": "whale",
                        "text": f"Whale Accumulation (RVOL: {rvol:.1f}x)"})
    if (rsi_sig == "Oversold"
            and bb_stat == "Potential Bounce (Low)"
            and candle == "Bullish Engulfing"):
        alerts.append({"type": "triple_bounce",
                        "text": "Triple-Confluence Bounce"})
    elif rsi_sig == "Oversold" and candle == "Bullish Engulfing":
        alerts.append({"type": "prime_setup",
                        "text": "Prime Setup (Oversold + Engulfing)"})

    return round(score, 2), alerts


# ══════════════════════════════════════════════════════════════════════════════
# SNAPSHOT ROW → v2-COMPATIBLE RESULT DICT
# ══════════════════════════════════════════════════════════════════════════════

def _snap_to_result(snap: dict) -> dict:
    ticker = snap.get("ticker", "")
    status = snap.get("status", "ok")
    bars   = snap.get("bars_count", 0)

    # ── Warming up (< 27 bars, seed_history_from_rest() not yet complete) ──
    if status == "warming_up":
        return {
            "ticker":       ticker, "price": 0, "sma_50": None, "atr": None,
            "bb_status":    "Warming Up", "bb_upper": None, "bb_lower": None,
            "trend":        "N/A",
            "trend_detail": f"Seeding indicators… ({bars}/27 bars)",
            "candlestick":  "N/A", "rsi": None, "rsi_signal": "N/A",
            "rvol": 0, "inst_footprint": "N/A",
            "fcf_yield": None, "de_ratio": None,
            "score": 0, "alerts": [], "status": "warming_up",
            "bars_count": bars,
        }

    # ── Full indicator row ────────────────────────────────────────────────
    price = snap.get("price", 0.0)
    rsi   = snap.get("rsi")
    rsi_sig   = snap.get("rsi_signal") or _rsi_signal(rsi)
    trend     = snap.get("trend", "N/A")
    atr       = snap.get("atr_5m") or snap.get("atr")

    # BB: get_scalp_snapshot exposes support/resistance (BB ± day range).
    # This is richer than raw BB bands and better for the UI.
    bb_upper_raw = snap.get("resistance")
    bb_lower_raw = snap.get("support")
    bb_stat      = _bb_status(price, bb_upper_raw, bb_lower_raw)

    # Candlestick: engine uses short labels; normalise to v2 strings
    candle = snap.get("candle", "No Clear Pattern") or "No Clear Pattern"
    _candle_map = {
        "Bullish": "Bullish Candle",
        "Bearish": "Bearish Candle",
        "Doji":    "Doji (Indecision)",
    }
    candle = _candle_map.get(candle, candle)

    rvol          = snap.get("volume",    0.0) or 0.0   # vol_ratio in engine
    vol_delta_val = snap.get("vol_delta", 0.0) or 0.0
    inst          = _inst_footprint(
        rvol,
        delta_bullish = vol_delta_val > 0,
        delta_bearish = vol_delta_val < 0,
    )

    trend_detail = (
        "EMA8 > EMA21 — Bullish stack"    if trend == "Bullish" else
        "EMA8 < EMA21 — Bearish stack"    if trend == "Bearish" else
        "EMA8 ≈ EMA21 — Sideways / Chop"
    )

    result = {
        # v2-compatible fields
        "ticker":         ticker,
        "price":          price,
        "sma_50":         None,
        "atr":            round(atr, 2) if atr is not None else None,
        "bb_status":      bb_stat,
        "bb_upper":       bb_upper_raw,
        "bb_lower":       bb_lower_raw,
        "trend":          trend,
        "trend_detail":   trend_detail,
        "candlestick":    candle,
        "rsi":            round(rsi, 2) if rsi is not None else None,
        "rsi_signal":     rsi_sig,
        "rvol":           round(rvol, 2),
        "inst_footprint": inst,
        "fcf_yield":      None,
        "de_ratio":       None,
        "status":         "ok",
        # v3 extras
        "signal":         snap.get("signal",     "HOLD"),
        "strength":       snap.get("strength",   "WEAK"),
        "confidence":     snap.get("confidence", 0.0),
        "prediction":     round(snap.get("confidence", 0.0) * 100, 1),
        "vwap":           snap.get("vwap"),
        "vwap_status":    snap.get("vwap_status"),
        "vwap_pct":       snap.get("vwap_pct"),
        "macd_signal":    snap.get("macd_signal"),
        "macd_hist":      snap.get("macd_hist"),
        "stoch_k":        snap.get("stoch_k"),
        "stoch_d":        snap.get("stoch_d"),
        "adx":            snap.get("adx"),
        "adx_label":      snap.get("adx_label"),
        "supertrend":     snap.get("supertrend"),
        "order_block":    snap.get("order_block") or "NONE",
        "confluence":     snap.get("confluence"),
        "tp":             snap.get("tp"),
        "sl":             snap.get("sl"),
        "rr":             snap.get("rr"),
        "bars_count":     bars,
    }
    result["score"], result["alerts"] = _score_and_alerts(result)
    return result


# ══════════════════════════════════════════════════════════════════════════════
# PUBLIC API
# ══════════════════════════════════════════════════════════════════════════════

def get_cached_monitor(
    watchlist_tickers: List[str],
    signal_engine:     "ScalpingSignalEngine",
    force_refresh:     bool = False,
    price_cache:       Optional[Dict] = None,
) -> Dict:
    """
    Returns tech indicator data for watchlist tickers from the live in-memory
    ScalpingSignalEngine. Zero network calls. Always current (1-min resolution).

    Thread safety:
      _monitor_lock guards the cache dict.
      FIX-4 race condition (from v2) preserved: ts is stamped inside the lock
      before release so concurrent requests see fresh ts and return stale cache
      rather than triggering parallel engine reads.

    Args:
        watchlist_tickers : list of ticker symbols to analyse
        signal_engine     : app.state.engine._signal_watcher (ScalpingSignalEngine)
        force_refresh     : bypass cache — useful after watchlist change
        price_cache       : optional dict {ticker: row} from ws_engine._cache —
                            used to fill price=0 for warming_up/seeding rows
                            so the frontend always shows a live price
    """
    now = time.time()

    with _monitor_lock:
        cache_valid = (
            not force_refresh
            and (now - _monitor_cache["ts"]) < _CACHE_TTL_SEC
            and set(_monitor_cache["tickers"]) == set(watchlist_tickers)
            and _monitor_cache["data"]
        )
        if cache_valid:
            return {
                "data":         _monitor_cache["data"],
                "cached":       True,
                "cached_at":    _monitor_cache["ts"],
                "data_age_sec": round(now - _monitor_cache["ts"]),
                "ticker_count": len(_monitor_cache["data"]),
                "source":       "engine",
            }

        # Stamp ts before releasing lock (FIX-4 preserved)
        _monitor_cache["ts"]      = now
        _monitor_cache["tickers"] = list(watchlist_tickers)

    # ── Engine read — lock-free, get_scalp_snapshot is thread-safe ─────────
    start = time.time()

    if signal_engine is None:
        logger.warning("get_cached_monitor: signal_engine not ready")
        data = [{
            "ticker": t, "price": 0, "sma_50": None, "atr": None,
            "bb_status": "Engine Starting", "bb_upper": None, "bb_lower": None,
            "trend": "N/A", "trend_detail": "Signal engine starting up…",
            "candlestick": "N/A", "rsi": None, "rsi_signal": "N/A",
            "rvol": 0, "inst_footprint": "N/A", "fcf_yield": None,
            "de_ratio": None, "score": 0, "alerts": [], "status": "engine_starting",
        } for t in watchlist_tickers]
    else:
        try:
            snap_rows = signal_engine.get_scalp_snapshot(watchlist_tickers)
        except Exception as e:
            logger.error(f"get_cached_monitor: get_scalp_snapshot error: {e}")
            snap_rows = []

        data = [_snap_to_result(row) for row in snap_rows]

        # Tickers in watchlist but not yet in engine (seed in progress)
        returned = {r["ticker"] for r in data}
        for ticker in watchlist_tickers:
            if ticker not in returned:
                data.append({
                    "ticker":       ticker, "price": 0, "sma_50": None, "atr": None,
                    "bb_status":    "Seeding…", "bb_upper": None, "bb_lower": None,
                    "trend":        "N/A",
                    "trend_detail": "seed_history_from_rest() in progress",
                    "candlestick":  "N/A", "rsi": None, "rsi_signal": "N/A",
                    "rvol": 0, "inst_footprint": "N/A", "fcf_yield": None,
                    "de_ratio": None, "score": 0, "alerts": [],
                    "status": "seeding", "bars_count": 0,
                })

        # Enrich price=0 rows (warming_up/seeding) from ws_engine live cache
        if price_cache:
            for row in data:
                if not row.get("price"):
                    live = price_cache.get(row["ticker"])
                    if live:
                        row["price"] = float(live.get("price") or live.get("live_price") or 0)

        data.sort(key=lambda r: r.get("score", 0), reverse=True)

    elapsed = round(time.time() - start, 4)
    logger.info(
        f"market_monitor v3: {len(data)} tickers in {elapsed}s "
        f"[zero HTTP — was 6-8s + yfinance]"
    )

    with _monitor_lock:
        _monitor_cache["data"] = data
        _monitor_cache["ts"]   = time.time()

    return {
        "data":         data,
        "cached":       False,
        "elapsed_sec":  elapsed,
        "data_age_sec": 0,
        "ticker_count": len(data),
        "source":       "engine",
    }
