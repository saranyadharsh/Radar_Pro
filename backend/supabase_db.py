"""
supabase_db.py — NexRadar Pro
==============================
Supabase PostgreSQL layer.

FIXES applied in this version:
  #1  get_stock_meta() replaces the old triple-scan (get_all_tickers +
      get_company_map + get_sector_map). One paginated pass through
      stock_list instead of three, cutting startup DB time by 2/3.

  #2  upsert_tickers() maps cache key "open" → DB column "open_price"
      explicitly, so REST /api/tickers path never returns open_price=0.

  #3  upsert_tickers() always writes "sector" to live_tickers so the
      REST fallback path returns correct sector data for filtering.

  #9  get_portfolio() and get_monitor() now use offset pagination —
      portfolio already has 1 039 rows (over the 1 000-row hard cap),
      was silently truncating. get_live_tickers() also paginated.
      get_earnings_for_range() paginated for high-volume weeks.

  LIVE_DISPLAY_CAP (1 600):
      If a user selects sectors totalling > 1 600 tickers, results are
      sorted by change_value desc then sliced to 1 600 — keeping the
      top movers and leaving the tail out.  Portfolio / monitor sources
      are never capped (users own those positions and expect full lists).
"""

import os
import time
import logging
from typing import Dict, List, Tuple

import os as _os
_os.environ.pop("SSL_CERT_FILE", None)

from supabase import create_client, Client

logger = logging.getLogger(__name__)

SUPABASE_URL         = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")

# Supabase REST hard cap per single request — never raise this value
_PAGE = 1000

# Max tickers sent to the frontend live table at once.
# 1 500 visible + 100 buffer for frontend sort/filter headroom.
LIVE_DISPLAY_CAP = 1600


def _get_client() -> Client:
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        raise RuntimeError(
            "SUPABASE_URL and SUPABASE_SERVICE_KEY env vars must be set."
        )
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)


def _paginate(
    client: Client,
    table: str,
    select: str,
    filters: list = None,
) -> List[Dict]:
    """
    Generic offset-paginated full-table fetch.

    filters — list of (method, *args) tuples applied to the query builder
    before .range().  Example:
        [("eq", "is_active", 1), ("order", "earnings_date")]
    """
    results: List[Dict] = []
    offset = 0
    while True:
        try:
            q = client.table(table).select(select)
            for method, *args in (filters or []):
                q = getattr(q, method)(*args)
            batch = q.range(offset, offset + _PAGE - 1).execute().data or []
            results.extend(batch)
            if len(batch) < _PAGE:
                break
            offset += _PAGE
        except Exception as e:
            logger.error(f"_paginate {table} offset={offset}: {e}")
            break
    return results


class SupabaseDB:

    def __init__(self):
        self.client: Client = _get_client()
        logger.info("✅ SupabaseDB connected")

    # ── Stock list ────────────────────────────────────────────────────────────

    def get_stock_meta(self) -> Tuple[List[str], Dict[str, str], Dict[str, str]]:
        """
        FIX #1 — Single paginated scan of stock_list that returns all three
        maps needed at startup in one pass.

        Returns:
            tickers      List[str]        all active ticker strings
            company_map  Dict[str, str]   {ticker: company_name}
            sector_map   Dict[str, str]   {ticker: sector}
        """
        rows = _paginate(
            self.client,
            "stock_list",
            "ticker, company_name, sector",
            [("eq", "is_active", 1)],
        )
        tickers:     List[str]      = []
        company_map: Dict[str, str] = {}
        sector_map:  Dict[str, str] = {}

        for r in rows:
            t = r.get("ticker")
            if not t:
                continue
            tickers.append(t)
            company_map[t] = r.get("company_name") or ""
            sector_map[t]  = r.get("sector")       or "Unknown"

        logger.info(
            f"get_stock_meta: {len(tickers)} tickers, "
            f"{len(sector_map)} sectors loaded in one pass"
        )
        return tickers, company_map, sector_map

    # ── Legacy helpers — kept so any callers outside main.py still work ───────

    def get_all_tickers(self) -> List[str]:
        """Kept for backward-compat. Prefer get_stock_meta()."""
        rows = _paginate(
            self.client, "stock_list", "ticker",
            [("eq", "is_active", 1)],
        )
        result = [r["ticker"] for r in rows if r.get("ticker")]
        logger.info(f"get_all_tickers: {len(result)} tickers")
        return result

    def get_company_map(self) -> Dict[str, str]:
        """Kept for backward-compat. Prefer get_stock_meta()."""
        rows = _paginate(
            self.client, "stock_list", "ticker, company_name",
            [("eq", "is_active", 1)],
        )
        return {r["ticker"]: r.get("company_name") or ""
                for r in rows if r.get("ticker")}

    def get_sector_map(self) -> Dict[str, str]:
        """Kept for backward-compat. Prefer get_stock_meta()."""
        rows = _paginate(
            self.client, "stock_list", "ticker, sector",
            [("eq", "is_active", 1)],
        )
        return {r["ticker"]: r.get("sector") or "Unknown"
                for r in rows if r.get("ticker")}

    # ── Live tickers ──────────────────────────────────────────────────────────

    def upsert_tickers(self, rows: List[Dict]) -> bool:
        """
        FIX #2 — maps cache key 'open' → DB column 'open_price' so the REST
                  path never returns open_price=0.
        FIX #3 — always writes 'sector' so sector filtering works on REST path.
        """
        if not rows:
            return True
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
                    r[f] = int(bool(r[f]))
            # FIX #2: normalise cache key 'open' → DB column 'open_price'
            if "open" in r and "open_price" not in r:
                r["open_price"] = r.pop("open")
            # FIX #3: ensure sector is always persisted
            if "sector" not in r or not r["sector"]:
                r["sector"] = "Unknown"
            cleaned.append(r)
        try:
            self.client.table("live_tickers").upsert(cleaned).execute()
            return True
        except Exception as e:
            logger.error(f"upsert_tickers: {e}")
            return False

    def get_live_tickers(
        self,
        only_positive: bool = True,
        window_hours: int = 12,
        sectors: List[str] = None,
        source: str = "all",
        portfolio_tickers: List[str] = None,
        monitor_tickers: List[str] = None,
    ) -> List[Dict]:
        """
        FIX #9 — full offset pagination; no silent 1 000-row truncation.

        Sector cap logic:
          · Sectors are passed as a list.  If "ALL" is in the list (or list
            is empty / None), no sector filter is applied.
          · When selecting multiple sectors that total > LIVE_DISPLAY_CAP
            rows (1 600), results are sorted desc by change_value and sliced
            to LIVE_DISPLAY_CAP — keeping the top movers, leaving the tail.
          · Portfolio / monitor views are NEVER capped — users own every
            position and need to see them all.
        """
        cutoff  = int(time.time()) - (window_hours * 3600)
        results: List[Dict] = []
        offset  = 0

        while True:
            try:
                q = (
                    self.client.table("live_tickers")
                    .select("*")
                    .gt("last_update", cutoff)
                    .order("change_value", desc=True)
                )
                if only_positive:
                    q = q.eq("is_positive", 1)

                # Source-based ticker filter
                if source == "portfolio" and portfolio_tickers:
                    q = q.in_("ticker", list(portfolio_tickers))
                elif source == "monitor" and monitor_tickers:
                    q = q.in_("ticker", list(monitor_tickers))

                # Sector filter — normalise to flat list, skip if ALL present
                if sectors:
                    flat = []
                    for s in sectors:
                        flat.extend([x.strip() for x in s.split(",")])
                    flat = [s for s in flat if s and s.upper() != "ALL"]
                    if flat:
                        q = q.in_("sector", flat)

                batch = q.range(offset, offset + _PAGE - 1).execute().data or []
                results.extend(batch)
                if len(batch) < _PAGE:
                    break
                offset += _PAGE

            except Exception as e:
                logger.error(f"get_live_tickers offset={offset}: {e}")
                break

        # Always sort final merged result desc by change_value
        results.sort(key=lambda r: r.get("change_value", 0), reverse=True)

        # Apply display cap only for non-personal sources
        if source in ("all", "stock_list") and len(results) > LIVE_DISPLAY_CAP:
            logger.info(
                f"get_live_tickers: {len(results)} rows → "
                f"capped to LIVE_DISPLAY_CAP={LIVE_DISPLAY_CAP}"
            )
            results = results[:LIVE_DISPLAY_CAP]

        return results

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
        """
        FIX #9 — paginated; earnings weeks can exceed 1 000 rows in peak season.
        """
        rows = _paginate(
            self.client,
            "earnings",
            "ticker, company_name, earnings_date, earnings_time",
            [
                ("gte", "earnings_date", start),
                ("lte", "earnings_date", end),
                ("order", "earnings_date"),
            ],
        )
        return rows

    # ── Monitor / Portfolio — FIX #9 ─────────────────────────────────────────

    def get_monitor(self) -> List[Dict]:
        """FIX #9 — was single .execute() call, capped at 1 000 rows."""
        rows = _paginate(self.client, "monitor", "*")
        logger.debug(f"get_monitor: {len(rows)} rows")
        return rows

    def get_portfolio(self) -> List[Dict]:
        """
        FIX #9 — portfolio has 1 039 rows; old single call returned only 1 000.
        Now fully paginated.
        """
        rows = _paginate(self.client, "portfolio", "*")
        logger.debug(f"get_portfolio: {len(rows)} rows")
        return rows

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
