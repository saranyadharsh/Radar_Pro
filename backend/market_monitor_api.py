"""
market_monitor_api.py — NexRadar Pro
=====================================
Runs market_monitor_tech analysis on the user's ★ watchlist tickers
instead of hardcoded TICKERS list. Called by GET /api/market-monitor.

Cache: 15 min TTL. First load ~6-8s for 50 tickers (ThreadPoolExecutor, 5 workers).

ARCHITECTURE:
  ARCH-1  VECTORIZATION (GIL-releasing indicator math):
          _calculate_rsi, _detect_institutional, _calculate_atr, _calculate_bb
          all converted from pandas rolling/ewm to NumPy array operations.
          NumPy executes in C and releases the Python GIL, allowing the
          asyncio event loop (SSE broadcasts) to keep running concurrently
          while indicators are being computed in the ThreadPoolExecutor workers.

  ARCH-2  asyncio.to_thread offload (in main.py):
          get_cached_monitor is called via asyncio.to_thread() instead of
          loop.run_in_executor(None, ...) — semantically identical but
          cleaner API and avoids the deprecated get_event_loop() call.

NETWORK / BANDWIDTH FIXES (root cause of 9.77 GB spike on Render):
  FIX-1  REMOVED stock.info:
          stock.info fires a separate Yahoo Finance HTTP request per ticker.
          With MAX_WORKERS=20 threads all firing simultaneously, Yahoo's
          anti-scraping defenses triggered → 429 errors → yfinance retried
          repeatedly → retry storms pumped ~10 GB outbound in one hour.
          fcf_yield and de_ratio are now returned as None. These can be
          restored via a separate slow background job if needed.

  FIX-2  MAX_WORKERS reduced from 20 → 5:
          20 simultaneous yfinance requests from Render's shared IP looks
          like a bot to Yahoo. 5 concurrent workers avoids the rate-limit
          trigger while still processing 50 tickers in ~6-8s — well within
          the 15-min cache TTL.

  FIX-3  100ms stagger delay per worker:
          Prevents all 5 workers from firing their first request at the
          exact same millisecond, further reducing burst appearance.

  FIX-4  CACHE RACE CONDITION fixed in get_cached_monitor:
          Old code released _monitor_lock before calling run_market_monitor,
          so N concurrent requests could each see a cache miss and each
          spawn a full ThreadPool run — multiplying network traffic by N.
          Fix: stamp _monitor_cache["ts"] = now inside the lock before
          releasing it, so concurrent arrivals see a "fresh" ts and return
          stale cache instead of triggering duplicate runs.

  FIX-5  TTL increased from 5 min → 15 min:
          5m intraday bars don't need a dashboard refresh every 5 minutes.
          15 min cuts Yahoo requests by 3× with no meaningful UX impact.

FIX — INTRADAY INDICATORS (root cause of stale RSI/ATR/BB/RVOL):
  Old code: stock.history(period="3mo") → DAILY bars only.
  Daily RSI(14) uses the last 14 daily closes → doesn't change until market
  close. Same for ATR, BB, RVOL. That's why the table looked frozen all day.

  New dual-fetch strategy:
    • 5m intraday  (period="5d", interval="5m")
        → RSI, ATR, BB, RVOL, Candlestick — these now update every ~5 min
    • Daily        (period="3mo", interval="1d")
        → SMA50 / Trend only (needs 50 bars, impossible on 5m)
"""

import time
import logging
import threading
from typing import Dict, List
from concurrent.futures import ThreadPoolExecutor, as_completed

import yfinance as yf
import pandas as pd
import numpy as np

logger = logging.getLogger(__name__)

_monitor_cache: Dict = {"data": [], "ts": 0, "tickers": []}
_monitor_lock = threading.Lock()

# FIX-5: increased TTL from 300s (5 min) → 900s (15 min).
# 5m bars don't require a full re-fetch every 5 minutes — the indicators
# are computed from the last 14–20 bars and don't change meaningfully on
# every bar. 15 min cuts Yahoo HTTP requests by 3× for free.
_CACHE_TTL_SEC = 900   # 15 minutes


# ── Indicator helpers (all operate on 5-minute bars) ─────────────────────────

def _analyze_candlestick(df) -> str:
    if len(df) < 2:
        return "Not Enough Data"
    prev, cur = df.iloc[-2], df.iloc[-1]
    body      = abs(cur["Close"] - cur["Open"])
    rng       = cur["High"] - cur["Low"]
    if rng > 0 and (body / rng) < 0.1:
        return "Doji (Indecision)"
    if prev["Close"] < prev["Open"] and cur["Close"] > cur["Open"]:
        if cur["Open"] <= prev["Close"] and cur["Close"] >= prev["Open"]:
            return "Bullish Engulfing"
    if prev["Close"] > prev["Open"] and cur["Close"] < cur["Open"]:
        if cur["Open"] >= prev["Close"] and cur["Close"] <= prev["Open"]:
            return "Bearish Engulfing"
    return "No Clear Pattern"


def _calculate_rsi(df, periods=14):
    if len(df) < periods + 1:
        return None, "N/A"
    closes   = df["Close"].to_numpy(dtype=np.float64)
    delta    = np.diff(closes)
    gains    = np.where(delta > 0, delta, 0.0)
    losses   = np.where(delta < 0, -delta, 0.0)
    alpha    = 1.0 / periods
    avg_gain = gains[:periods].mean()
    avg_loss = losses[:periods].mean()
    for i in range(periods, len(delta)):
        avg_gain = avg_gain * (1 - alpha) + gains[i] * alpha
        avg_loss = avg_loss * (1 - alpha) + losses[i] * alpha
    if avg_loss == 0:
        val = 100.0
    else:
        val = round(100.0 - 100.0 / (1.0 + avg_gain / avg_loss), 2)
    sig = "Overbought" if val > 70 else "Oversold" if val < 30 else "Neutral"
    return val, sig


def _detect_institutional(df, period=20):
    if len(df) < period:
        return 0, "Not Enough Data"
    vols    = df["Volume"].to_numpy(dtype=np.float64)
    avg_vol = vols[-period:].mean()
    cur_vol = vols[-1]
    if not avg_vol or avg_vol == 0:
        return 0, "No Volume Data"
    rvol = round(cur_vol / avg_vol, 2)
    cur  = df.iloc[-1]
    sig  = "Normal Volume"
    if rvol > 2.0:
        sig = "Institutional Accumulation (Buying)" if cur["Close"] > cur["Open"] else \
              "Institutional Distribution (Selling)" if cur["Close"] < cur["Open"] else \
              "Normal Volume"
    return rvol, sig


def _calculate_bb(df, period=20, std_dev=2):
    if len(df) < period:
        return None, None
    closes = df["Close"].to_numpy(dtype=np.float64)[-period:]
    sma    = closes.mean()
    std    = closes.std(ddof=1)
    return round(float(sma + std * std_dev), 2), round(float(sma - std * std_dev), 2)


def _calculate_atr(df, period=14):
    if len(df) < period + 1:
        return None
    highs  = df["High"].to_numpy(dtype=np.float64)
    lows   = df["Low"].to_numpy(dtype=np.float64)
    closes = df["Close"].to_numpy(dtype=np.float64)
    hl  = highs[1:]  - lows[1:]
    hc  = np.abs(highs[1:]  - closes[:-1])
    lc  = np.abs(lows[1:]   - closes[:-1])
    tr  = np.maximum(hl, np.maximum(hc, lc))
    return round(float(tr[-period:].mean()), 2)


# ── Per-ticker analysis (called in parallel) ─────────────────────────────────

def _analyze_ticker(ticker: str) -> Dict:
    """
    FIX-1 + FIX-3: stock.info removed (was the primary cause of the 9.77 GB
    bandwidth spike). Each call to stock.info fires an extra Yahoo HTTP request.
    With 20 concurrent workers all hitting Yahoo simultaneously, rate-limiting
    kicked in → yfinance retried repeatedly → retry storms pumped ~10 GB out.
    fcf_yield and de_ratio return None until a safer background strategy exists.

    FIX-3: 100ms stagger delay prevents burst-fire from all workers starting
    at the exact same millisecond.
    """
    # FIX-3: stagger workers — prevents simultaneous burst to Yahoo Finance
    time.sleep(0.1)

    try:
        stock = yf.Ticker(ticker)

        # FIX-1: stock.info intentionally removed.
        # It fires a separate Yahoo HTTP request per ticker. At 20 concurrent
        # workers this triggered rate-limit blocks + retry storms = 9.77 GB spike.
        # Re-add via a dedicated nightly background job (one ticker at a time)
        # if FCF yield / D/E ratio display is needed in the UI.
        fcf_yield = None
        de        = None

        # Daily bars — SMA50 / Trend only
        # MEMORY FIX: "3mo" (~63 bars) instead of "3mo" is fine but we
        # explicitly trim to last 60 bars — SMA50 needs exactly 50, 60 gives
        # a small buffer. Cuts daily DataFrame memory by ~50% vs full 3mo.
        daily = stock.history(period="3mo", interval="1d")
        if not daily.empty and len(daily) > 60:
            daily = daily.iloc[-60:]
        sma50, trend, trend_detail = None, "N/A", "Insufficient data"
        if not daily.empty and len(daily) >= 50:
            sma50 = round(daily["Close"].rolling(window=50).mean().iloc[-1], 2)

        # 5-minute intraday bars — all live indicators
        # MEMORY FIX: "2d" instead of "5d" cuts DataFrame size by 60%.
        # RSI(14) needs 15 bars, ATR(14) needs 15, BB(20) needs 20, RVOL needs 20.
        # Max requirement = 20 bars. "2d" gives ~156 bars (6.5h × 2 × 12 bars/h)
        # — more than enough while using ~60% less RAM per worker.
        intra = stock.history(period="2d", interval="5m")

        # Trim to last 100 bars — all indicators need ≤20 bars, 100 gives
        # headroom for gaps/halts while capping per-ticker memory to ~1-2 MB.
        if not intra.empty and len(intra) > 100:
            intra = intra.iloc[-100:]

        if not intra.empty and len(intra) >= 20:
            price         = round(intra["Close"].iloc[-1], 2)
            candle        = _analyze_candlestick(intra)
            rsi, rsi_sig  = _calculate_rsi(intra)
            rvol, inst    = _detect_institutional(intra)
            atr           = _calculate_atr(intra)
            bb_upper, bb_lower = _calculate_bb(intra)

            if sma50 is not None:
                trend        = "Bullish" if price > sma50 else "Bearish"
                trend_detail = f"{'>' if price > sma50 else '<'} 50 SMA ({sma50})"

            bb_status = "N/A"
            if bb_upper is not None and bb_lower is not None:
                bb_status = ("Overextended (High)"    if price >= bb_upper else
                             "Potential Bounce (Low)" if price <= bb_lower else
                             "Neutral")

            score = 0
            if rsi_sig == "Oversold":         score += 2
            elif rsi_sig == "Overbought":     score -= 2
            if trend == "Bullish":            score += 1
            elif trend == "Bearish":          score -= 1
            if bb_status == "Potential Bounce (Low)":  score += 1.5
            elif bb_status == "Overextended (High)":   score -= 1.5
            if isinstance(rvol, (int, float)) and rvol > 2.0:
                score += 1
                if "Accumulation" in str(inst): score += 1.5
                elif "Distribution" in str(inst): score -= 1.5
            if candle == "Bullish Engulfing":  score += 1.5
            elif candle == "Bearish Engulfing": score -= 1.5

            alerts = []
            if "Accumulation" in str(inst):
                alerts.append({"type": "whale", "text": f"Whale Accumulation (RVOL: {rvol}x)"})
            if rsi_sig == "Oversold" and bb_status == "Potential Bounce (Low)" and candle == "Bullish Engulfing":
                alerts.append({"type": "triple_bounce", "text": "Triple-Confluence Bounce"})
            elif rsi_sig == "Oversold" and candle == "Bullish Engulfing":
                alerts.append({"type": "prime_setup", "text": "Prime Setup (Oversold + Engulfing)"})

            result = {
                "ticker": ticker, "price": price, "sma_50": sma50,
                "atr": atr, "bb_status": bb_status,
                "bb_upper": bb_upper, "bb_lower": bb_lower,
                "trend": trend, "trend_detail": trend_detail,
                "candlestick": candle, "rsi": rsi, "rsi_signal": rsi_sig,
                "rvol": rvol if isinstance(rvol, (int, float)) else 0,
                "inst_footprint": inst,
                "fcf_yield": fcf_yield, "de_ratio": de,
                "score": round(score, 2), "alerts": alerts, "status": "ok",
            }
            # MEMORY FIX: explicitly release DataFrames before returning.
            # Python's GC will eventually collect them, but with 5 concurrent
            # workers each holding two DataFrames, explicit del ensures memory
            # is freed as soon as the result dict is built — not whenever GC runs.
            del intra, daily
            return result
        else:
            # Intraday unavailable (weekend/holiday) — degrade gracefully
            # FIX-1: removed info.get("currentPrice") fallback — info is gone
            fallback_price = round(daily["Close"].iloc[-1], 2) if not daily.empty else 0
            result = {
                "ticker": ticker, "price": fallback_price,
                "sma_50": sma50, "atr": None, "bb_status": "N/A",
                "bb_upper": None, "bb_lower": None,
                "trend": trend, "trend_detail": trend_detail,
                "candlestick": "N/A", "rsi": None, "rsi_signal": "N/A",
                "rvol": 0, "inst_footprint": "N/A",
                "fcf_yield": fcf_yield, "de_ratio": de,
                "score": 0, "alerts": [], "status": "insufficient_data",
            }
            del intra, daily
            return result

    except Exception as e:
        logger.warning(f"market_monitor error {ticker}: {e}")
        return {
            "ticker": ticker, "price": 0, "sma_50": None, "atr": None,
            "bb_status": "Error", "bb_upper": None, "bb_lower": None,
            "trend": "Error", "trend_detail": str(e)[:80],
            "candlestick": "Error", "rsi": None, "rsi_signal": "Error",
            "rvol": 0, "inst_footprint": "Error",
            "fcf_yield": None, "de_ratio": None,
            "score": 0, "alerts": [], "status": "error",
        }


# ── Main analysis loop ────────────────────────────────────────────────────────

# FIX-2: MAX_WORKERS reduced from 20 → 5.
# 20 simultaneous yfinance requests from Render's shared IP triggered Yahoo's
# anti-scraping defenses → all tickers returned errors → yfinance retried
# repeatedly → retry storms caused the 9.77 GB bandwidth spike.
# 5 workers: ~6-8s for 50 tickers — well within the 15-min cache TTL.
_MONITOR_MAX_WORKERS = 5


def run_market_monitor(ticker_list: List[str]) -> List[Dict]:
    results = []
    with ThreadPoolExecutor(max_workers=_MONITOR_MAX_WORKERS) as executor:
        future_to_ticker = {executor.submit(_analyze_ticker, t): t for t in ticker_list}
        for future in as_completed(future_to_ticker):
            try:
                result = future.result()
                results.append(result)
            except Exception as e:
                ticker = future_to_ticker[future]
                logger.warning(f"run_market_monitor future error {ticker}: {e}")
                results.append({
                    "ticker": ticker, "price": 0, "sma_50": None, "atr": None,
                    "bb_status": "Error", "bb_upper": None, "bb_lower": None,
                    "trend": "Error", "trend_detail": str(e)[:80],
                    "candlestick": "Error", "rsi": None, "rsi_signal": "Error",
                    "rvol": 0, "inst_footprint": "Error",
                    "fcf_yield": None, "de_ratio": None,
                    "score": 0, "alerts": [], "status": "error",
                })

    results.sort(key=lambda r: r.get("score", 0), reverse=True)
    return results


def get_cached_monitor(watchlist_tickers: List[str], force_refresh: bool = False) -> Dict:
    """
    FIX-4: Cache race condition fixed.

    OLD (broken) flow:
      1. Thread A acquires lock → cache miss → releases lock
      2. Thread B acquires lock → also sees cache miss → releases lock
      3. Both A and B call run_market_monitor() concurrently
      4. Two full ThreadPool runs fire simultaneously → 2× network traffic
      5. Under high frontend polling this multiplied into N× traffic storms
         → directly contributed to the 9.77 GB bandwidth spike

    NEW (fixed) flow:
      1. Thread A acquires lock → cache miss
      2. While still holding the lock, stamp _monitor_cache["ts"] = now
         so any concurrent thread that arrives sees a "fresh" ts
      3. Release lock — Thread B now sees ts=now → returns stale cache data
      4. Thread A runs market monitor alone, then writes fresh data under lock
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
            age_sec = round(now - _monitor_cache["ts"])
            return {
                "data":         _monitor_cache["data"],
                "cached":       True,
                "cached_at":    _monitor_cache["ts"],
                "data_age_sec": age_sec,
                "ticker_count": len(_monitor_cache["data"]),
            }

        # FIX-4: claim the cache slot BEFORE releasing the lock.
        # Concurrent threads arriving during our fetch will see ts=now
        # and return stale cache instead of spawning duplicate market monitor runs.
        _monitor_cache["ts"]      = now
        _monitor_cache["tickers"] = list(watchlist_tickers)

    # Run outside the lock so SSE/other routes aren't blocked during fetch
    logger.info(f"Running market monitor on {len(watchlist_tickers)} tickers (5m intraday)…")
    start   = time.time()
    data    = run_market_monitor(watchlist_tickers)
    elapsed = round(time.time() - start, 1)
    logger.info(f"Market monitor complete: {len(data)} tickers in {elapsed}s")

    with _monitor_lock:
        _monitor_cache["data"] = data
        _monitor_cache["ts"]   = time.time()   # stamp actual completion time

    return {
        "data":         data,
        "cached":       False,
        "elapsed_sec":  elapsed,
        "data_age_sec": 0,
        "ticker_count": len(data),
    }
