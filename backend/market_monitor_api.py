"""
market_monitor_api.py — NexRadar Pro
=====================================
Runs market_monitor_tech analysis on the user's ★ watchlist tickers
instead of hardcoded TICKERS list. Called by GET /api/market-monitor.

Cache: 5 min TTL. First load ~15-60s depending on watchlist size (max 50).
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
_CACHE_TTL_SEC = 300


# ── Technical Analysis (from market_monitor_tech.py) ─────────────────────────

def _analyze_candlestick(hist_data) -> str:
    if len(hist_data) < 2:
        return "Not Enough Data"
    yest, today = hist_data.iloc[-2], hist_data.iloc[-1]
    body_size = abs(today["Close"] - today["Open"])
    daily_range = today["High"] - today["Low"]
    if daily_range > 0 and (body_size / daily_range) < 0.1:
        return "Doji (Indecision)"
    if (yest["Close"] < yest["Open"]) and (today["Close"] > today["Open"]):
        if (today["Open"] <= yest["Close"]) and (today["Close"] >= yest["Open"]):
            return "Bullish Engulfing"
    if (yest["Close"] > yest["Open"]) and (today["Close"] < today["Open"]):
        if (today["Open"] >= yest["Close"]) and (today["Close"] <= yest["Open"]):
            return "Bearish Engulfing"
    return "No Clear Pattern"


def _calculate_rsi(hist_data, periods=14):
    delta = hist_data["Close"].diff()
    gain = delta.where(delta > 0, 0)
    loss = -delta.where(delta < 0, 0)
    avg_gain = gain.ewm(alpha=1 / periods, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1 / periods, adjust=False).mean()
    rs = avg_gain / avg_loss
    rsi = 100 - (100 / (1 + rs))
    current_rsi = round(rsi.iloc[-1], 2)
    sig = "Overbought" if current_rsi > 70 else "Oversold" if current_rsi < 30 else "Neutral"
    return current_rsi, sig


def _detect_institutional(hist_data, period=20):
    if len(hist_data) < period:
        return 0, "Not Enough Data"
    avg_vol = hist_data["Volume"].rolling(window=period).mean().iloc[-1]
    cur_vol = hist_data["Volume"].iloc[-1]
    if avg_vol == 0:
        return 0, "No Volume Data"
    rvol = round(cur_vol / avg_vol, 2)
    today = hist_data.iloc[-1]
    sig = "Normal Volume"
    if rvol > 2.0:
        if today["Close"] > today["Open"]:
            sig = "Institutional Accumulation (Buying)"
        elif today["Close"] < today["Open"]:
            sig = "Institutional Distribution (Selling)"
    return rvol, sig


def _calculate_bb(hist_data, period=20, std_dev=2):
    sma = hist_data["Close"].rolling(window=period).mean()
    std = hist_data["Close"].rolling(window=period).std()
    return round((sma + std * std_dev).iloc[-1], 2), round((sma - std * std_dev).iloc[-1], 2)


def _calculate_atr(hist_data, period=14):
    hl = hist_data["High"] - hist_data["Low"]
    hc = abs(hist_data["High"] - hist_data["Close"].shift())
    lc = abs(hist_data["Low"] - hist_data["Close"].shift())
    tr = pd.concat([hl, hc, lc], axis=1).max(axis=1)
    return round(tr.rolling(window=period).mean().iloc[-1], 2)


# ── Main Analysis ────────────────────────────────────────────────────────────

def run_market_monitor(ticker_list: List[str]) -> List[Dict]:
    results = []
    for ticker in ticker_list:
        try:
            stock = yf.Ticker(ticker)
            info = stock.info
            market_cap = info.get("marketCap", 0)
            fcf = info.get("freeCashflow", 0)
            de_raw = info.get("debtToEquity", None)
            de = round(de_raw / 100, 2) if de_raw is not None else None
            fcf_yield = round((fcf / market_cap) * 100, 2) if market_cap and fcf and market_cap > 0 else None

            hist = stock.history(period="3mo")
            if not hist.empty and len(hist) >= 50:
                price = round(hist["Close"].iloc[-1], 2)
                sma50 = round(hist["Close"].rolling(window=50).mean().iloc[-1], 2)
                trend = "Bullish" if price > sma50 else "Bearish"
                candle = _analyze_candlestick(hist)
                rsi, rsi_sig = _calculate_rsi(hist)
                rvol, inst = _detect_institutional(hist)
                atr = _calculate_atr(hist)
                bb_upper, bb_lower = _calculate_bb(hist)
                bb_status = "Overextended (High)" if price >= bb_upper else "Potential Bounce (Low)" if price <= bb_lower else "Neutral"

                score = 0
                if rsi_sig == "Oversold": score += 2
                elif rsi_sig == "Overbought": score -= 2
                score += 1 if trend == "Bullish" else -1
                if bb_status == "Potential Bounce (Low)": score += 1.5
                elif bb_status == "Overextended (High)": score -= 1.5
                if isinstance(rvol, (int, float)) and rvol > 2.0:
                    score += 1
                    if "Accumulation" in str(inst): score += 1.5
                    elif "Distribution" in str(inst): score -= 1.5
                if candle == "Bullish Engulfing": score += 1.5
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
                    "atr": atr, "bb_status": bb_status, "bb_upper": bb_upper, "bb_lower": bb_lower,
                    "trend": trend, "trend_detail": f"{'>' if price > sma50 else '<'} 50 SMA ({sma50})",
                    "candlestick": candle, "rsi": rsi, "rsi_signal": rsi_sig,
                    "rvol": rvol if isinstance(rvol, (int, float)) else 0,
                    "inst_footprint": inst, "fcf_yield": fcf_yield, "de_ratio": de,
                    "score": round(score, 2), "alerts": alerts, "status": "ok",
                })
            else:
                results.append({
                    "ticker": ticker, "price": info.get("currentPrice", 0) or 0,
                    "sma_50": None, "atr": None, "bb_status": "N/A",
                    "bb_upper": None, "bb_lower": None, "trend": "N/A",
                    "trend_detail": "Insufficient data", "candlestick": "N/A",
                    "rsi": None, "rsi_signal": "N/A", "rvol": 0,
                    "inst_footprint": "N/A", "fcf_yield": fcf_yield, "de_ratio": de,
                    "score": 0, "alerts": [], "status": "insufficient_data",
                })
            time.sleep(0.05)
        except Exception as e:
            logger.warning(f"market_monitor error {ticker}: {e}")
            results.append({
                "ticker": ticker, "price": 0, "sma_50": None, "atr": None,
                "bb_status": "Error", "bb_upper": None, "bb_lower": None,
                "trend": "Error", "trend_detail": str(e)[:80], "candlestick": "Error",
                "rsi": None, "rsi_signal": "Error", "rvol": 0,
                "inst_footprint": "Error", "fcf_yield": None, "de_ratio": None,
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
            return {"data": _monitor_cache["data"], "cached": True,
                    "cached_at": _monitor_cache["ts"], "ticker_count": len(_monitor_cache["data"])}

    logger.info(f"Running market monitor on {len(watchlist_tickers)} watchlist tickers...")
    start = time.time()
    data = run_market_monitor(watchlist_tickers)
    elapsed = round(time.time() - start, 1)
    logger.info(f"Market monitor complete: {len(data)} tickers in {elapsed}s")

    with _monitor_lock:
        _monitor_cache["data"] = data
        _monitor_cache["ts"] = time.time()
        _monitor_cache["tickers"] = list(watchlist_tickers)

    return {"data": data, "cached": False, "elapsed_sec": elapsed, "ticker_count": len(data)}
