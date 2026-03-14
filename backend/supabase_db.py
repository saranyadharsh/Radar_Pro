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

  PATCH-SDB-1  Supabase retry/backoff on read failures
      get_portfolio() and get_monitor() previously had no retry logic.
      A transient Supabase timeout silently returned [] which
      _portfolio_loop would then broadcast as empty portfolio data.
      FIX: _paginate() now retries up to MAX_READ_RETRIES times with
      exponential backoff (1s → 2s → 4s) before returning partial
      results. A logger.error is emitted on every failed attempt so
      Render logs surface the issue immediately.
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
LIVE_DISPLAY_CAP = 6200

# ── PATCH-SDB-1: Retry configuration ─────────────────────────────────────────
# Applied to all _paginate() read calls (get_portfolio, get_monitor,
# get_recent_signals, get_earnings_for_range, get_stock_meta, etc.)
MAX_READ_RETRIES    = 3      # total attempts (1 original + 2 retries)
RETRY_BACKOFF_BASE  = 1.0    # seconds — doubles each attempt: 1s, 2s, 4s


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

    PATCH-SDB-1: Each page request retries up to MAX_READ_RETRIES times
    with exponential backoff before giving up and returning whatever was
    collected so far. This prevents a single Supabase network hiccup from
    silently returning [] and causing _portfolio_loop to broadcast an
    empty portfolio to all SSE clients.

    filters — list of (method, *args) tuples applied to the query builder
    before .range().  Example:
        [("eq", "is_active", 1), ("order", "earnings_date")]
    """
    results: List[Dict] = []
    offset = 0
    while True:
        # PATCH-SDB-1: retry loop per page ────────────────────────────────────
        page_data = None
        for attempt in range(MAX_READ_RETRIES):
            try:
                q = client.table(table).select(select)
                for method, *args in (filters or []):
                    q = getattr(q, method)(*args)
                page_data = q.range(offset, offset + _PAGE - 1).execute().data or []
                break  # success — exit retry loop
            except Exception as e:
                wait = RETRY_BACKOFF_BASE * (2 ** attempt)
                if attempt < MAX_READ_RETRIES - 1:
                    logger.warning(
                        f"_paginate {table} offset={offset} attempt={attempt+1} "
                        f"failed ({e}) — retrying in {wait:.0f}s"
                    )
                    time.sleep(wait)
                else:
                    logger.error(
                        f"_paginate {table} offset={offset} all {MAX_READ_RETRIES} "
                        f"attempts failed: {e} — returning partial results"
                    )
        # ─────────────────────────────────────────────────────────────────────

        if page_data is None:
            # All retries exhausted for this page — stop pagination
            break

        results.extend(page_data)
        if len(page_data) < _PAGE:
            break
        offset += _PAGE

    return results


class SupabaseDB:

    def __init__(self):
        self.client: Client = _get_client()
        logger.info("✅ SupabaseDB connected")
        self._live_ticker_cols: set = self._discover_live_ticker_cols()

    def _discover_live_ticker_cols(self) -> set:
        """
        Fetch one row from live_tickers to discover the actual column names.
        Permanent fix for PGRST204 — never guess the schema, read it at startup.
        Falls back to a minimal safe set if the table is empty or unreachable.
        """
        SAFE_FALLBACK = {"ticker", "sector", "price", "live_price",
                         "open_price", "prev_close", "ts"}
        try:
            resp = self.client.table("live_tickers").select("*").limit(1).execute()
            if resp.data:
                cols = set(resp.data[0].keys())
                logger.info(f"live_tickers schema: {sorted(cols)}")
                return cols
            logger.warning("live_tickers empty — using fallback column set")
            return SAFE_FALLBACK
        except Exception as e:
            logger.error(f"_discover_live_ticker_cols failed: {e}")
            return SAFE_FALLBACK

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
        Upserts rows into live_tickers.
        Uses self._live_ticker_cols (discovered at startup by reading one row)
        to filter the payload — permanently immune to PGRST204 schema errors
        regardless of what fields ws_engine adds to the cache in future.
        """
        if not rows:
            return True

        allowed     = self._live_ticker_cols
        INT_FIELDS  = {"volume", "avg_volume", "last_update", "update_count"}
        BOOL_FIELDS = {"volume_spike", "is_gap_play", "is_positive",
                       "went_positive", "ah_momentum"}

        cleaned = []
        for row in rows:
            r = {k: v for k, v in row.items() if k in allowed}

            # Map cache alias 'open' → 'open_price' if needed
            if "open_price" in allowed and "open_price" not in r and "open" in row:
                r["open_price"] = row["open"]

            for f in INT_FIELDS:
                if f in r and r[f] is not None:
                    try:    r[f] = int(float(r[f]))
                    except: r[f] = 0
            for f in BOOL_FIELDS:
                if f in r and r[f] is not None:
                    r[f] = int(bool(r[f]))

            if not r.get("sector"):
                r["sector"] = "Unknown"

            # last_update has NOT NULL constraint — seed with current epoch if missing
            if "last_update" in allowed and not r.get("last_update"):
                r["last_update"] = int(time.time())

            if r.get("ticker"):
                cleaned.append(r)

        for attempt in range(2):
            try:
                self.client.table("live_tickers").upsert(cleaned).execute()
                return True
            except Exception as e:
                err_str = str(e)
                # Transient network/SSL errors — reconnect client and retry once
                TRANSIENT = ("SSL", "WinError", "ConnectionError", "RemoteProtocolError",
                             "forcibly closed", "Connection reset", "BrokenPipe", "httpx")
                if attempt == 0 and any(x in err_str for x in TRANSIENT):
                    logger.warning(f"upsert_tickers transient error (retrying): {e}")
                    try:
                        self.client = _get_client()
                    except Exception:
                        pass
                    continue
                logger.error(f"upsert_tickers: {e}")
                return False
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

        PATCH-SDB-1 — retries are handled inside _paginate(). If all retries
        exhaust, _paginate returns whatever partial data it collected (could be
        []) and logs logger.error. The caller (_portfolio_loop) checks for empty
        result and skips broadcast rather than pushing an empty portfolio.
        """
        rows = _paginate(self.client, "portfolio", "*")
        logger.debug(f"get_portfolio: {len(rows)} rows")
        return rows

    # ── Signal Watchlist ──────────────────────────────────────────────────────
    # Persists the user's ★ starred tickers across server restarts.
    # Table DDL (run once in Supabase):
    #   CREATE TABLE IF NOT EXISTS signal_watchlist (
    #     ticker    TEXT PRIMARY KEY,
    #     added_at  TIMESTAMPTZ DEFAULT now()
    #   );

    def get_signal_watchlist(self) -> List[Dict]:
        """Return all starred tickers: [{"ticker": "AAPL"}, ...]"""
        try:
            res = (
                self.client.table("signal_watchlist")
                .select("ticker")
                .order("added_at", desc=False)
                .execute()
            )
            return res.data or []
        except Exception as e:
            logger.error(f"get_signal_watchlist: {e}")
            return []

    def add_signal_watchlist(self, ticker: str) -> None:
        """Upsert a ticker into signal_watchlist (safe to call for duplicates)."""
        try:
            self.client.table("signal_watchlist").upsert(
                {"ticker": ticker.upper()},
                on_conflict="ticker",
            ).execute()
        except Exception as e:
            logger.error(f"add_signal_watchlist({ticker}): {e}")

    def remove_signal_watchlist(self, ticker: str) -> None:
        """Delete a ticker from signal_watchlist (safe to call for missing rows)."""
        try:
            self.client.table("signal_watchlist").delete().eq(
                "ticker", ticker.upper()
            ).execute()
        except Exception as e:
            logger.error(f"remove_signal_watchlist({ticker}): {e}")

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
