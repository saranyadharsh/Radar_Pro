"""
market_monitor_api.py — NexRadar Pro
=====================================
Runs market_monitor_tech analysis on the user's ★ watchlist tickers
instead of hardcoded TICKERS list. Called by GET /api/market-monitor.

Cache: 5 min TTL. First load ~15-60s depending on watchlist size (max 50).

FIX — INTRADAY INDICATORS (root cause of stale RSI/ATR/BB/RVOL):
  Old code: stock.history(period="3mo") → DAILY bars only.
  Daily RSI(14) uses the last 14 daily closes → doesn't change until market
  close. Same for ATR, BB, RVOL. That's why the table looked frozen all day.

  New dual-fetch strategy:
    • 5m intraday  (period="5d", interval="5m")
        → RSI, ATR, BB, RVOL, Candlestick — these now update every ~5 min
    • Daily        (period="3mo", interval="1d")
        → SMA50 / Trend only (needs 50 bars, impossible on 5m)
    • Fundamentals (stock.info)
        → FCF yield, D/E — static, unchanged
"""

import time
import logging
import threading
from typing import Dict, List

import yfinance as yf
import pandas as pd
import numpy as np

logger = logging.getLogger(__name__)

_monitor_cache: Dict = {"data": [], "ts": 0, "tickers": []}
_monitor_lock = threading.Lock()
_CACHE_TTL_SEC = 300   # 5 minutes — matches 5m bar cadence


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
    delta    = df["Close"].diff()
    gain     = delta.where(delta > 0, 0)
    loss     = -delta.where(delta < 0, 0)
    avg_gain = gain.ewm(alpha=1 / periods, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1 / periods, adjust=False).mean()
    rs       = avg_gain / avg_loss
    val      = round((100 - (100 / (1 + rs))).iloc[-1], 2)
    sig      = "Overbought" if val > 70 else "Oversold" if val < 30 else "Neutral"
    return val, sig


def _detect_institutional(df, period=20):
    if len(df) < period:
        return 0, "Not Enough Data"
    avg_vol = df["Volume"].rolling(window=period).mean().iloc[-1]
    cur_vol = df["Volume"].iloc[-1]
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
    sma = df["Close"].rolling(window=period).mean()
    std = df["Close"].rolling(window=period).std()
    return round((sma + std * std_dev).iloc[-1], 2), round((sma - std * std_dev).iloc[-1], 2)


def _calculate_atr(df, period=14):
    if len(df) < period + 1:
        return None
    hl = df["High"] - df["Low"]
    hc = abs(df["High"] - df["Close"].shift())
    lc = abs(df["Low"]  - df["Close"].shift())
    tr = pd.concat([hl, hc, lc], axis=1).max(axis=1)
    return round(tr.rolling(window=period).mean().iloc[-1], 2)


# ── Main analysis loop ────────────────────────────────────────────────────────

def run_market_monitor(ticker_list: List[str]) -> List[Dict]:
    results = []
    for ticker in ticker_list:
        try:
            stock = yf.Ticker(ticker)

            # Fundamentals — static
            info      = stock.info
            mkt_cap   = info.get("marketCap", 0)
            fcf       = info.get("freeCashflow", 0)
            de_raw    = info.get("debtToEquity", None)
            de        = round(de_raw / 100, 2) if de_raw is not None else None
            fcf_yield = round((fcf / mkt_cap) * 100, 2) if mkt_cap and fcf and mkt_cap > 0 else None

            # Daily bars — SMA50 / Trend only
            daily = stock.history(period="3mo", interval="1d")
            sma50, trend, trend_detail = None, "N/A", "Insufficient data"
            if not daily.empty and len(daily) >= 50:
                sma50 = round(daily["Close"].rolling(window=50).mean().iloc[-1], 2)

            # 5-minute intraday bars — all live indicators
            intra = stock.history(period="5d", interval="5m")

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

                results.append({
                    "ticker": ticker, "price": price, "sma_50": sma50,
                    "atr": atr, "bb_status": bb_status,
                    "bb_upper": bb_upper, "bb_lower": bb_lower,
                    "trend": trend, "trend_detail": trend_detail,
                    "candlestick": candle, "rsi": rsi, "rsi_signal": rsi_sig,
                    "rvol": rvol if isinstance(rvol, (int, float)) else 0,
                    "inst_footprint": inst,
                    "fcf_yield": fcf_yield, "de_ratio": de,
                    "score": round(score, 2), "alerts": alerts, "status": "ok",
                })
            else:
                # Intraday unavailable (weekend/holiday) — degrade gracefully
                fallback_price = round(daily["Close"].iloc[-1], 2) if not daily.empty else (info.get("currentPrice", 0) or 0)
                results.append({
                    "ticker": ticker, "price": fallback_price,
                    "sma_50": sma50, "atr": None, "bb_status": "N/A",
                    "bb_upper": None, "bb_lower": None,
                    "trend": trend, "trend_detail": trend_detail,
                    "candlestick": "N/A", "rsi": None, "rsi_signal": "N/A",
                    "rvol": 0, "inst_footprint": "N/A",
                    "fcf_yield": fcf_yield, "de_ratio": de,
                    "score": 0, "alerts": [], "status": "insufficient_data",
                })

            time.sleep(0.05)

        except Exception as e:
            logger.warning(f"market_monitor error {ticker}: {e}")
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
    now = time.time()
    with _monitor_lock:
        if (not force_refresh
                and (now - _monitor_cache["ts"]) < _CACHE_TTL_SEC
                and set(_monitor_cache["tickers"]) == set(watchlist_tickers)
                and _monitor_cache["data"]):
            age_sec = round(now - _monitor_cache["ts"])
            return {
                "data":         _monitor_cache["data"],
                "cached":       True,
                "cached_at":    _monitor_cache["ts"],
                "data_age_sec": age_sec,
                "ticker_count": len(_monitor_cache["data"]),
            }

    logger.info(f"Running market monitor on {len(watchlist_tickers)} tickers (5m intraday)…")
    start   = time.time()
    data    = run_market_monitor(watchlist_tickers)
    elapsed = round(time.time() - start, 1)
    logger.info(f"Market monitor complete: {len(data)} tickers in {elapsed}s")

    with _monitor_lock:
        _monitor_cache["data"]    = data
        _monitor_cache["ts"]      = time.time()
        _monitor_cache["tickers"] = list(watchlist_tickers)

    return {
        "data":         data,
        "cached":       False,
        "elapsed_sec":  elapsed,
        "data_age_sec": 0,
        "ticker_count": len(data),
    }
