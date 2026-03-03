"""
supabase_db.py — NexRadar Pro
==============================
Supabase PostgreSQL layer. Replaces all SQLite reads/writes.
"""

import os
import time
import logging
from typing import Dict, List



# ── SSL fix: remove SSL_CERT_FILE so httpx uses its own bundled certs ─────────
import os as _os
_os.environ.pop("SSL_CERT_FILE", None)   # prevents httpx FileNotFoundError on Windows

from supabase import create_client, Client

logger = logging.getLogger(__name__)

SUPABASE_URL         = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")


def _get_client() -> Client:
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY env vars must be set.")
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)


class SupabaseDB:

    def __init__(self):
        self.client: Client = _get_client()
        logger.info("✅ SupabaseDB connected")

    # ── Stock list ────────────────────────────────────────────────────────────
    def get_all_tickers(self) -> List[str]:
        try:
            resp = (
                self.client.table("stock_list")
                .select("ticker")
                .eq("is_active", 1)
                .execute()
            )
            return [r["ticker"] for r in (resp.data or [])]
        except Exception as e:
            logger.error(f"get_all_tickers: {e}")
            return []

    def get_company_map(self) -> Dict[str, str]:
        try:
            resp = (
                self.client.table("stock_list")
                .select("ticker, company_name")
                .eq("is_active", 1)
                .execute()
            )
            return {r["ticker"]: r["company_name"] for r in (resp.data or [])}
        except Exception as e:
            logger.error(f"get_company_map: {e}")
            return {}

    # ── Live tickers ──────────────────────────────────────────────────────────
    def upsert_tickers(self, rows: List[Dict]) -> bool:
        if not rows:
            return True
        # Cast types — Supabase rejects Python floats for BIGINT/BOOLEAN columns
        INT_FIELDS  = ("volume", "last_update", "update_count")
        BOOL_FIELDS = ("volume_spike", "is_gap_play", "ah_momentum",
                       "went_positive", "is_positive")
        cleaned = []
        for row in rows:
            r = dict(row)
            for f in INT_FIELDS:
                if f in r and r[f] is not None:
                    try:    r[f] = int(float(r[f]))
                    except: r[f] = 0
            for f in BOOL_FIELDS:
                if f in r and r[f] is not None:
                    r[f] = bool(r[f])
            cleaned.append(r)
        try:
            self.client.table("live_tickers").upsert(cleaned).execute()
            return True
        except Exception as e:
            logger.error(f"upsert_tickers: {e}")
            return False

    def get_live_tickers(
        self,
        limit: int = 1500,
        only_positive: bool = True,
        window_hours: int = 12,
    ) -> List[Dict]:
        cutoff = int(time.time()) - (window_hours * 3600)
        try:
            q = (
                self.client.table("live_tickers")
                .select("*")
                .gt("last_update", cutoff)
                .order("change_value", desc=True)
                .limit(limit)
            )
            if only_positive:
                q = q.eq("is_positive", 1)
            return q.execute().data or []
        except Exception as e:
            logger.error(f"get_live_tickers: {e}")
            return []

    # ── Signals ───────────────────────────────────────────────────────────────
    def insert_signal(self, signal: Dict) -> bool:
        try:
            self.client.table("signals").insert(signal).execute()
            return True
        except Exception as e:
            logger.error(f"insert_signal: {e}")
            return False

    def get_recent_signals(self, limit: int = 200) -> List[Dict]:
        try:
            return (
                self.client.table("signals")
                .select("*")
                .order("created_at", desc=True)
                .limit(limit)
                .execute()
                .data or []
            )
        except Exception as e:
            logger.error(f"get_recent_signals: {e}")
            return []

    # ── Earnings ──────────────────────────────────────────────────────────────
    def get_earnings_for_range(self, start: str, end: str) -> List[Dict]:
        try:
            return (
                self.client.table("earnings")
                .select("ticker, company_name, earnings_date, earnings_time")
                .gte("earnings_date", start)
                .lte("earnings_date", end)
                .order("earnings_date")
                .execute()
                .data or []
            )
        except Exception as e:
            logger.error(f"get_earnings_for_range: {e}")
            return []

    # ── Monitor / Portfolio ───────────────────────────────────────────────────
    def get_monitor(self) -> List[Dict]:
        try:
            return self.client.table("monitor").select("*").execute().data or []
        except Exception as e:
            logger.error(f"get_monitor: {e}")
            return []

    def get_portfolio(self) -> List[Dict]:
        try:
            return self.client.table("portfolio").select("*").execute().data or []
        except Exception as e:
            logger.error(f"get_portfolio: {e}")
            return []

    # ── Error log ─────────────────────────────────────────────────────────────
    def log_error(self, ticker: str, error_type: str, message: str):
        try:
            self.client.table("error_log").insert({
                "ticker":        ticker,
                "error_type":    error_type,
                "error_message": message[:500],
                "timestamp":     int(time.time() * 1000),
                "retry_count":   0,
            }).execute()
        except Exception as e:
            logger.warning(f"log_error insert failed: {e}")