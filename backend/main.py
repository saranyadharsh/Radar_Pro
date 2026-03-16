"""
main.py — NexRadar Pro Backend  v6.2
=====================================================
FastAPI.  Render start command:
  uvicorn backend.main:app --host 0.0.0.0 --port $PORT

ARCHITECTURE: Direct In-Process SSE  (Redis removed permanently)
=================================================================
Previous Redis Stream + Consumer Group design caused 6 failure modes:
  P1  Prices freeze after WS reconnect (stale XREADGROUP cursor)
  P2  NOGROUP warning storm on stream eviction
  P3  Snapshot evicted in <60s at market-hours tick rate
  P4  Portfolio Supabase spam on every ingestor restart
  P5  ~2 Redis connections per SSE tab -> 20-conn limit exceeded at ~10 tabs
  P6  Watchlist updates silently dropped when Redis XADD blocks event loop

NEW: SSEBroadcaster (zero Redis, zero network I/O on tick path):
  • WSEngine starts in this process — no subprocess, no watchdog needed
  • Each SSE client gets a dedicated asyncio.Queue (maxsize=500)
  • Snapshot stored as a Python dict — lives in memory forever, never evicted
  • Latency: ~0.1ms vs ~5-20ms with Redis round-trips
  • Unlimited simultaneous SSE clients (not capped by Redis conn pool)

PATCHES IN THIS VERSION:
  PATCH-MAIN-1  Signal snapshot on SSE connect
                When a client subscribes to /api/stream, the SSE generator
                now sends a "signal_snapshot" message containing the last 50
                signals immediately after the price snapshot. This ensures
                clients that connect mid-session see existing signals without
                waiting for the next poll cycle.

  PATCH-MAIN-2  Race condition fix: REST fetch vs SSE delta on page mount
                PageScanner.jsx and PagePortfolio.jsx fire a REST GET on
                mount. If an SSE delta (portfolio_update, watchlist_update)
                arrives BEFORE the REST response resolves, the REST response
                was overwriting the newer SSE delta — showing stale data.
                FIX: All REST endpoints that return data also set an
                X-Data-Timestamp response header (Unix ms). The frontend
                must ignore REST responses whose timestamp is older than the
                last SSE delta timestamp it received for that data type.

  PATCH-MAIN-3  /api/stream sends watchlist snapshot on connect
                Similar to PATCH-MAIN-1, the current watchlist is included
                in the initial SSE burst so PageScanner/PagePortfolio don't
                need to fire a separate REST GET on mount at all.

  FIX-1         Zero-client guard in SSEBroadcaster.publish()
                json.dumps(6200 rows) was running 30x/min all day even with
                zero browsers connected — 150 GB/day of pointless work on
                Render, causing 43,200 GC cycles/day and CPU pressure that
                triggered queue fills and reconnect spirals after 2 weeks.
                FIX: _snapshot is always updated (needed for first connect).
                If _queues is empty, return immediately — skip serialisation.
                Impact: CPU -> 0 when no browser open. GC pressure eliminated.

  FIX-2         snapshot_delta support
                SSEBroadcaster now stores _snapshot_map (ticker -> row) in
                addition to _snapshot (full payload). When a client connects,
                it gets the full snapshot from _snapshot_map. During live
                streaming, ws_engine sends type="snapshot_delta" with only
                changed rows — broadcaster fans that out directly without
                touching the full snapshot.

  FIX-4 (frontend companion — see sseWorker.js)
                SharedWorker holds the single EventSource for the entire
                browser session. Tab switches, page refreshes, and navigation
                between Dashboard/LiveTable/Signals/Scanner never disconnect
                the SSE stream. The backend sees exactly one persistent
                connection regardless of user navigation behaviour.

  FIX-5         feed_status events (from ws_engine.py)
                ws_engine broadcasts {"type":"feed_status","ok":false/true}
                on Polygon WS close/auth_success. SSEBroadcaster fans this
                out normally. Frontend shows a reconnecting banner.

  client_ts handshake on /api/stream
                If the client passes ?client_ts=<unix_ms>, and the snapshot
                on the backend is less than 10 seconds newer than that
                timestamp, the full snapshot is skipped — the client's data
                is still fresh. Only a true first load or stale reconnect
                gets the full 3 MB blast.

  FRONTEND INTEGRATION NOTE (PATCH-MAIN-2):
    In PagePortfolio.jsx and PageScanner.jsx, after applying SSE deltas,
    store the delta's server timestamp:
      const lastSSETs = useRef(0);
      // on SSE portfolio_update: lastSSETs.current = Date.now();
      // on REST /api/portfolio response: only apply if Date.now() > lastSSETs.current + 500
    This 500ms grace period ensures the REST response (which races the SSE)
    never silently overwrites a more-recent SSE delta.

  FRONTEND INTEGRATION NOTE (snapshot_delta):
    The frontend must handle both message types from SSE:
      type="snapshot"       -> replace entire local state (first connect only)
      type="snapshot_delta" -> merge rows by ticker key into local state
    Example merge in sseWorker.js / useMarketData hook:
      if (msg.type === 'snapshot_delta') {
        msg.data.forEach(row => { cache[row.ticker] = row })
      }
"""
from dotenv import load_dotenv
from pathlib import Path
load_dotenv(Path(__file__).parent.parent / ".env")

import os
import sys
import asyncio
import json
import logging
import time
# GAP-4: orjson 3-5x faster than stdlib json for large snapshot payloads
try:
    import orjson as _orjson
    def _dumps(obj: dict) -> str:
        return _orjson.dumps(obj).decode()
except ImportError:
    def _dumps(obj: dict) -> str:  # type: ignore[misc]
        return json.dumps(obj)
from contextlib import asynccontextmanager
from datetime import date, timedelta
from typing import AsyncGenerator, Dict, Set, Deque
from collections import deque

sys.path.insert(0, str(Path(__file__).parent.parent))

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import httpx

try:
    from backend.supabase_db        import SupabaseDB
    from backend.ws_engine          import WSEngine
    from backend.market_monitor_api import get_cached_monitor
except ModuleNotFoundError:
    from supabase_db        import SupabaseDB
    from ws_engine          import WSEngine
    from market_monitor_api import get_cached_monitor

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


# ══════════════════════════════════════════════════════════════════════════════
# SSEBroadcaster
# ══════════════════════════════════════════════════════════════════════════════
class SSEBroadcaster:
    """
    In-memory fan-out broadcaster.  Zero Redis.  Zero network I/O on tick path.

    FIX-1: Zero-client guard
      publish() now returns immediately after updating _snapshot if _queues
      is empty. This skips json.dumps entirely when no browser is connected,
      eliminating 150 GB/day of pointless serialisation on Render and the
      resulting GC pressure that caused queue fills after 2 weeks of uptime.

    FIX-2: snapshot_delta support
      _snapshot_map stores ticker -> row dict, updated on every snapshot and
      snapshot_delta. On SSE connect, full snapshot is built from _snapshot_map
      only once. During streaming, snapshot_delta payloads pass through without
      touching _snapshot_map — only the initial type="snapshot" updates it.

    HOP-2-FIX: Slow-client eviction with TTL
      A client whose queue is full is not immediately killed — it may be a
      temporary hiccup (tab backgrounded, GC pause). It gets SLOW_CLIENT_TTL_S
      seconds to drain before being evicted. Evicted clients receive a DISCONNECT
      sentinel so their SSE generator exits cleanly and they auto-reconnect.

    HOP-2-FIX: Named clients
      subscribe() now accepts a client_id for logging. Slow/dead evictions log
      the client_id so you can correlate with access logs.

    Thread safety:
      publish() is an async coroutine — it only runs on the asyncio event loop
      thread. subscribe() and unsubscribe() are also called from async context
      (FastAPI route handlers on the same event loop thread). All _queues
      mutations are single-threaded by the event loop — no lock needed.
      WSEngine background threads schedule publish() via run_coroutine_threadsafe,
      never calling it directly — this is why dict mutation is safe without a lock.
    """

    QUEUE_MAXSIZE      = 500
    SLOW_CLIENT_TTL_S  = 10   # seconds a full queue is tolerated before eviction

    REPLAY_BUFFER_SIZE = 300   # keep last 300 batches (~5 min at 1/sec)

    def __init__(self):
        self._queues:       Dict[asyncio.Queue, str]  = {}  # queue -> client_id
        self._slow_since:   Dict[asyncio.Queue, float] = {} # queue -> monotonic time when full started
        self._snapshot:     dict                = {}
        self._snapshot_map: Dict[str, dict]     = {}
        # SEQ-FIX: sequence counter + replay buffer for gap recovery
        self._seq:          int                 = 0
        self._replay_buf:   deque               = deque(maxlen=self.REPLAY_BUFFER_SIZE)
        # TICKER-MAP: int ID map distributed to clients on connect
        self._ticker_map:   Dict[str, int]      = {}   # symbol -> int id
        self._ticker_map_rev: Dict[int, str]    = {}   # int id -> symbol
        # TIERED-RECONNECT: per-ticker last-update timestamp (ms)
        # Used to build a "changed since client_ts" delta instead of full snapshot
        self._ticker_ts:    Dict[str, int]      = {}   # symbol -> last update ms
        self._start_ts:     float               = time.monotonic()

    async def publish(self, payload: dict) -> None:
        msg_type = payload.get("type")

        # Always maintain the full snapshot map for new connects
        if msg_type == "snapshot":
            self._snapshot = payload
            _now_ms = payload.get("ts") or int(time.time() * 1000)
            for row in payload.get("data", []):
                tk = row.get("ticker")
                if tk:
                    self._snapshot_map[tk] = row
                    self._ticker_ts[tk]    = _now_ms
            # GAP-4: signal SSE connects waiting on snapshot_ready
            try:
                _ready_evt = getattr(app.state, "snapshot_ready", None)
                if _ready_evt and not _ready_evt.is_set():
                    _ready_evt.set()
                    logger.info("snapshot_ready event set — SSE connects unblocked")
            except Exception:
                pass

        elif msg_type == "snapshot_delta":
            _now_ms = payload.get("ts") or int(time.time() * 1000)
            for row in payload.get("data", []):
                tk = row.get("ticker")
                if tk:
                    self._snapshot_map[tk] = row
                    self._ticker_ts[tk]    = _now_ms
            # GAP-4b: after a WS reconnect the first broadcast is often a
            # snapshot_delta (not a full snapshot). Unblock waiting SSE connects
            # so they don't time out and serve $0.00 to Portfolio/Screener.
            try:
                _ready_evt = getattr(app.state, "snapshot_ready", None)
                if _ready_evt and not _ready_evt.is_set() and self._snapshot_map:
                    _ready_evt.set()
                    logger.info("snapshot_ready set via snapshot_delta — SSE connects unblocked")
            except Exception:
                pass

        elif msg_type == "tick_batch":
            _now_ms = int(time.time() * 1000)
            for row in payload.get("data", []):
                tk = row.get("ticker")
                if tk:
                    self._ticker_ts[tk] = _now_ms
            # GAP-4b: tick_batch may arrive before any snapshot on reconnect.
            # Unblock SSE connects if snapshot_map already has data seeded from
            # the engine cache fallback, otherwise they wait the full 8s timeout.
            try:
                _ready_evt = getattr(app.state, "snapshot_ready", None)
                if _ready_evt and not _ready_evt.is_set() and self._snapshot_map:
                    _ready_evt.set()
                    logger.info("snapshot_ready set via tick_batch — SSE connects unblocked")
            except Exception:
                pass

        # SEQ-FIX: stamp sequence number on every outgoing message
        self._seq += 1
        payload["seq"] = self._seq

        # FIX-1: zero-client guard
        if not self._queues:
            return

        msg  = "data: " + _dumps(payload) + "\n\n"  # GAP-4: orjson

        # SEQ-FIX: store in replay buffer (capped by deque maxlen=REPLAY_BUFFER_SIZE)
        self._replay_buf.append((self._seq, time.monotonic(), msg))
        now  = time.monotonic()
        dead = set()

        for q, client_id in list(self._queues.items()):
            try:
                q.put_nowait(msg)
                # Successful put — clear any slow-client timer
                self._slow_since.pop(q, None)
            except asyncio.QueueFull:
                # HOP-2-FIX: give the client SLOW_CLIENT_TTL_S to recover
                first_full = self._slow_since.get(q)
                if first_full is None:
                    self._slow_since[q] = now
                    logger.warning(f"SSE client {client_id}: queue full — starting eviction timer")
                elif now - first_full > self.SLOW_CLIENT_TTL_S:
                    logger.error(f"SSE client {client_id}: queue full >{self.SLOW_CLIENT_TTL_S}s — evicting")
                    dead.add(q)

        if dead:
            for q in dead:
                self._queues.pop(q, None)
                self._slow_since.pop(q, None)
                try:
                    # Drain and send DISCONNECT so generator exits cleanly
                    while not q.empty():
                        q.get_nowait()
                    q.put_nowait("DISCONNECT")
                except Exception:
                    pass

    def subscribe(self, client_id: str = "unknown") -> asyncio.Queue:
        q = asyncio.Queue(maxsize=self.QUEUE_MAXSIZE)
        self._queues[q] = client_id
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        self._queues.pop(q, None)
        self._slow_since.pop(q, None)

    def get_snapshot(self) -> dict:
        """Returns the last full snapshot payload (for REST /api/snapshot)."""
        return self._snapshot

    def get_changed_since(self, since_ms: int) -> list:
        """
        TIERED-RECONNECT: return only rows that changed after since_ms.
        Used for medium-gap reconnects (10s-30s) to avoid sending all 6027 rows.
        Returns full snapshot rows (not slim deltas) so client gets complete state.
        """
        return [
            row for tk, row in self._snapshot_map.items()
            if self._ticker_ts.get(tk, 0) >= since_ms
        ]

    def build_ticker_map(self, tickers: list) -> dict:
        """
        Build or return cached {symbol: int_id} map.
        IDs are stable for the server lifetime — assigned in the order
        tickers were loaded from stock_list at startup.
        """
        if not self._ticker_map and tickers:
            for i, sym in enumerate(sorted(tickers), start=1):
                self._ticker_map[sym]    = i
                self._ticker_map_rev[i]  = sym
        return self._ticker_map

    def get_replay(self, from_seq: int, to_seq: int) -> list:
        """
        Return serialized messages for seq range [from_seq, to_seq].
        Used by /api/replay for gap recovery.
        Returns empty list if range not in buffer (client should request snapshot).
        """
        return [
            msg for (seq, ts, msg) in self._replay_buf
            if from_seq <= seq <= to_seq
        ]

    def get_current_seq(self) -> int:
        return self._seq

    def get_snapshot_map(self) -> Dict[str, dict]:
        """Returns the always-current ticker->row map (for SSE connect burst)."""
        return self._snapshot_map

    @property
    def client_count(self) -> int:
        return len(self._queues)


# ── Global singletons ──────────────────────────────────────────────────────────
db:          SupabaseDB     = None   # type: ignore
broadcaster: SSEBroadcaster = None   # type: ignore


# ── Lifespan ───────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    global db, broadcaster
    logger.info("NexRadar API starting (direct SSE v6.5 + AI proxy + stock-data) …")

    db          = SupabaseDB()
    broadcaster = SSEBroadcaster()

    tickers, company_map, sector_map = db.get_stock_meta()
    if not tickers:
        logger.warning("No tickers — run migration first")
    else:
        logger.info(f"Loaded {len(tickers)} tickers")

    # SPY-FIX: guarantee SPY + QQQ are always subscribed and cached.
    # opportunity-scanner and RS calculations read directly from engine._cache.
    # If SPY/QQQ are not in the master tickers list (e.g. not in live_tickers DB),
    # the cache lookup returns None → spy_pct = None → Scanner shows "—".
    _BENCHMARK_TICKERS = ["SPY", "QQQ"]
    for _bt in _BENCHMARK_TICKERS:
        if _bt not in tickers:
            tickers = list(tickers) + [_bt]
            company_map[_bt] = _bt
            sector_map[_bt]  = "INDEX"
            logger.info(f"SPY-FIX: added {_bt} to tickers list for RS calculations")

    loop   = asyncio.get_event_loop()
    engine = WSEngine(broadcast_cb=broadcaster.publish, loop=loop)
    engine.start(tickers, company_map, sector_map)
    logger.info("WSEngine started")
    app.state.engine = engine

    # GAP-1: WS watchdog — detects a stalled feed during market hours
    # and forces a reconnect if no tick is processed for >90s.
    async def _ws_watchdog():
        await asyncio.sleep(120)   # allow warm-up before monitoring
        while True:
            await asyncio.sleep(30)
            eng = getattr(app.state, "engine", None)
            if not eng or eng._shutdown.is_set():
                break
            last_ts = getattr(eng, "_last_tick_processed_ts", 0)
            if last_ts == 0:
                continue
            stale_s = time.monotonic() - last_ts
            if stale_s > 90 and _get_market_status_simple() == "MARKET_HOURS":
                logger.error(
                    f"WS watchdog: no tick for {stale_s:.0f}s during market hours — forcing reconnect"
                )
                try:
                    eng.force_reconnect()
                except Exception as _e:
                    logger.warning(f"WS watchdog force_reconnect failed: {_e}")

    asyncio.create_task(_ws_watchdog())

    # GAP-4: snapshot_ready event — SSE connect waits on this instead of polling
    app.state.snapshot_ready = asyncio.Event()

    try:
        from backend.Scalping_Signal import SmartAlertsEngine
    except ModuleNotFoundError:
        from Scalping_Signal import SmartAlertsEngine
    _ae = SmartAlertsEngine(engine=engine._signal_watcher, broadcast_cb=broadcaster.publish, loop=loop)
    try:
        _ae_rows = db.get_signal_watchlist()
        _ae.set_watchlist([r["ticker"] for r in _ae_rows if r.get("ticker")])
    except Exception:
        pass
    _ae.start()
    app.state.alerts_engine = _ae
    logger.info("SmartAlertsEngine started")

    # v6.3-2 HYBRID WARM-UP: seed today's 1-min bars from Polygon REST so every
    # watchlist ticker's IndicatorCalculator has 27+ bars immediately on startup.
    # Without this, RSI/EMA/BB are unavailable for 27 min after a mid-session restart.
    #
    # ROOT CAUSE FIX: seed_history_from_rest() lives on SignalWatchlistManager,
    # but engine._signal_watcher is a ScalpingSignalEngine. We call the seed
    # function directly using urllib.request + Polygon REST, feeding bars into
    # engine._signal_watcher.process_aggregate_bar() which ScalpingSignalEngine
    # already exposes. Runs in a background thread — startup is not blocked.
    try:
        _api_key = engine._api_key
        _sw      = engine._signal_watcher   # ScalpingSignalEngine instance
        if _api_key and _sw:
            import threading as _threading
            import urllib.request as _urllib
            import json as _json
            import pytz as _pytz
            from datetime import datetime as _dt

            try:
                from backend.Scalping_Signal import OHLCVBar
            except ModuleNotFoundError:
                from Scalping_Signal import OHLCVBar

            def _seed_on_startup():
                try:
                    et_tz   = _pytz.timezone("America/New_York")
                    today   = _dt.now(et_tz).strftime("%Y-%m-%d")
                    targets = list(_sw._watched) if hasattr(_sw, "_watched") else []
                    if not targets:
                        # Fallback: read watchlist from DB directly
                        _rows   = db.get_signal_watchlist()
                        targets = [r["ticker"] for r in _rows if r.get("ticker")]
                    if not targets:
                        logger.info("Startup seed: watchlist empty — skipping")
                        return
                    logger.info(f"v6.3: Seeding {len(targets)} tickers from Polygon REST…")
                    seeded = 0
                    for sym in targets:
                        try:
                            url = (
                                f"https://api.polygon.io/v2/aggs/ticker/{sym}"
                                f"/range/1/minute/{today}/{today}"
                                f"?adjusted=true&sort=asc&limit=390&apiKey={_api_key}"
                            )
                            with _urllib.urlopen(url, timeout=10) as _resp:
                                _data = _json.loads(_resp.read().decode())
                            for r in _data.get("results", []):
                                ts  = _dt.fromtimestamp(r["t"] / 1000.0, tz=et_tz)
                                bar = OHLCVBar(
                                    timestamp = ts,
                                    open      = float(r.get("o", 0)),
                                    high      = float(r.get("h", 0)),
                                    low       = float(r.get("l", 0)),
                                    close     = float(r.get("c", 0)),
                                    volume    = float(r.get("v", 0)),
                                )
                                if bar.close > 0:
                                    _sw.process_aggregate_bar(sym, bar)
                            seeded += 1
                        except Exception as _e:
                            logger.debug(f"Startup seed {sym}: {_e}")
                    logger.info(f"v6.3: Seeded {seeded}/{len(targets)} watchlist tickers")
                except Exception as _e:
                    logger.error(f"Startup seed thread error: {_e}")

            _threading.Thread(target=_seed_on_startup, daemon=True, name="StartupSeed").start()
    except Exception as _e:
        logger.warning(f"Startup seed setup failed: {_e}")

    # ── Loop 1: EDGAR watchlist poller ────────────────────────────────────────
    # Every 10 min — all material forms across full watchlist.
    # seen_accessions dedupes so each filing fires exactly one SSE alert.
    async def _edgar_watchlist_loop():
        POLL_INTERVAL_S = 600
        LOOKBACK_DAYS   = 1          # yesterday → catches overnight pre-market filings
        FORMS           = ["8-K", "SC 13D", "SC 13G", "S-4", "DEFR14A", "10-Q", "10-K"]
        seen_accessions : set  = set()
        seen_ts         : dict = {}  # accession → date string for daily pruning

        await asyncio.sleep(45)

        while True:
            try:
                eng = getattr(app.state, "engine", None)
                if not eng or eng._shutdown.is_set():
                    break
                startdt   = (date.today() - timedelta(days=LOOKBACK_DAYS)).isoformat()
                wl_rows   = await asyncio.to_thread(db.get_signal_watchlist)
                watchlist = [r["ticker"] for r in wl_rows if r.get("ticker")]

                for sym in watchlist:
                    for form in FORMS:
                        raw_hits = await _edgar_fetch_form(sym, form, startdt)
                        for hit in raw_hits:
                            accession = hit.get("_id", "")
                            if not accession or accession in seen_accessions:
                                continue
                            items_str  = hit.get("_source", {}).get("items", "")
                            item_codes = {i.strip() for i in items_str.split(",")} if items_str else set()
                            if form == "8-K" and not (item_codes & _EDGAR_MATERIAL_8K):
                                continue
                            seen_accessions.add(accession)
                            seen_ts[accession] = date.today().isoformat()
                            await broadcaster.publish(_edgar_build_alert(sym, form, hit))
                            logger.info(f"EDGAR alert: {sym} {form} items={items_str or '—'}")
                    await asyncio.sleep(0.3)

                cutoff = (date.today() - timedelta(days=2)).isoformat()
                for a in [k for k, v in seen_ts.items() if v < cutoff]:
                    seen_accessions.discard(a); seen_ts.pop(a, None)

            except Exception as _e:
                logger.warning(f"_edgar_watchlist_loop: {_e}")
            await asyncio.sleep(POLL_INTERVAL_S)

    asyncio.create_task(_edgar_watchlist_loop())
    logger.info("EDGAR watchlist poller started (10-min, 7 form types)")

    # ── Loop 2: Earnings proximity alert loop ─────────────────────────────────
    # Every 30 min — Supabase earnings table only (EDGAR has no forward calendar).
    # T-1 = tomorrow's earnings, T-0 = today pre-market/market open.
    # EDGAR 8-K Item 2.02 fires separately (Loop 1) when the actual result drops.
    async def _earnings_alert_loop():
        POLL_INTERVAL_S = 1800
        alerted : dict  = {}   # "{sym}_{horizon}_{date}": date_str

        await asyncio.sleep(90)

        while True:
            try:
                today    = date.today()
                tomorrow = today + timedelta(days=1)
                session  = _get_market_status_simple()
                wl_rows  = await asyncio.to_thread(db.get_signal_watchlist)
                watchlist = [r["ticker"] for r in wl_rows if r.get("ticker")]
                earn_rows = await asyncio.to_thread(
                    db.get_earnings_for_range, today.isoformat(), tomorrow.isoformat()
                )
                earn_map = {r["ticker"]: r for r in (earn_rows or [])}

                for sym in watchlist:
                    earn = earn_map.get(sym)
                    if not earn:
                        continue
                    earn_date = earn.get("report_date") or earn.get("date", "")
                    when      = earn.get("when", "")
                    eps_est   = earn.get("eps_estimate")
                    rev_est   = earn.get("revenue_estimate")
                    when_str  = f"{when}-market" if when else "time TBD"

                    k1 = f"{sym}_T1_{today.isoformat()}"
                    if earn_date == tomorrow.isoformat() and k1 not in alerted:
                        alerted[k1] = today.isoformat()
                        await broadcaster.publish({
                            "type": "earnings_alert", "ticker": sym, "horizon": "T-1",
                            "title": f"{sym} earnings tomorrow",
                            "sub": f"Reports {when_str} · EPS est. {eps_est if eps_est is not None else '—'}",
                            "earn_date": earn_date, "when": when,
                            "eps_est": eps_est, "rev_est": rev_est,
                            "color": "cyan", "emoji": "📅",
                        })
                        logger.info(f"Earnings T-1 alert: {sym} {earn_date}")

                    k0 = f"{sym}_T0_{today.isoformat()}"
                    if (earn_date == today.isoformat()
                            and session in ("PRE_MARKET", "MARKET_HOURS")
                            and k0 not in alerted):
                        alerted[k0] = today.isoformat()
                        await broadcaster.publish({
                            "type": "earnings_alert", "ticker": sym, "horizon": "T-0",
                            "title": f"{sym} earnings TODAY",
                            "sub": f"Reports {when_str} · EPS est. {eps_est if eps_est is not None else '—'}",
                            "earn_date": earn_date, "when": when,
                            "eps_est": eps_est, "rev_est": rev_est,
                            "color": "gold", "emoji": "⚡",
                        })
                        logger.info(f"Earnings T-0 alert: {sym} {earn_date}")

                yesterday = (today - timedelta(days=1)).isoformat()
                alerted   = {k: v for k, v in alerted.items() if v > yesterday}

            except Exception as _e:
                logger.warning(f"_earnings_alert_loop: {_e}")
            await asyncio.sleep(POLL_INTERVAL_S)

    asyncio.create_task(_earnings_alert_loop())
    logger.info("Earnings proximity alert loop started (30-min, T-1 + T-0)")

    # ── Loop 3: FDA approvals poller ──────────────────────────────────────────
    # Every 30 min — openFDA drug approvals API, filtered to watchlist companies.
    # Matches by company name substring (case-insensitive) since FDA uses full
    # legal names (e.g. "SANDISK LLC" matches watchlist ticker SNDK).
    # Fires fda_alert SSE event — gold toast, links to openFDA record.
    #
    # Why openFDA: free, no API key, real-time approvals/accelerated approvals.
    # Covers: NDA, ANDA, BLA approvals — material for pharma/biotech watchlist tickers.
    async def _fda_alert_loop():
        POLL_INTERVAL_S = 1800       # 30 minutes
        FDA_BASE        = "https://api.fda.gov/drug/drugsfda.json"
        seen_applnos    : set  = set()
        seen_ts         : dict = {}

        # company name keywords per ticker — built from Polygon company_map at startup
        # Falls back to ticker symbol if no company name available
        await asyncio.sleep(120)     # warm-up — let engine cache populate first

        while True:
            try:
                eng = getattr(app.state, "engine", None)
                if not eng or eng._shutdown.is_set():
                    break

                wl_rows   = await asyncio.to_thread(db.get_signal_watchlist)
                watchlist = [r["ticker"] for r in wl_rows if r.get("ticker")]

                # Build ticker → company name keyword map from engine cache
                company_map : dict = {}
                if eng and eng._cache:
                    with eng._cache_lock:
                        for tk in watchlist:
                            row = eng._cache.get(tk, {})
                            name = (row.get("company_name") or row.get("company") or "").strip()
                            if name and name != tk:
                                # Use first meaningful word (avoids "Inc", "Corp" false matches)
                                keyword = name.split()[0].upper().rstrip(".,")
                                if len(keyword) > 3:
                                    company_map[tk] = keyword

                if not company_map:
                    await asyncio.sleep(POLL_INTERVAL_S)
                    continue

                # Build OR search query: "SANDISK+HIMS+MODERNA+..."
                keywords = list(set(company_map.values()))
                # FDA full-text search — batch up to 20 keywords per call
                for i in range(0, len(keywords), 20):
                    batch   = keywords[i:i+20]
                    query   = "+".join(f'"{k}"' for k in batch)
                    fda_url = (
                        f"{FDA_BASE}?search=openfda.manufacturer_name:({query})"
                        f"&sort=submissions.submission_status_date:desc&limit=20"
                    )
                    try:
                        async with httpx.AsyncClient(timeout=10) as client:
                            resp = await client.get(fda_url)
                            if resp.status_code == 404:
                                continue   # no results for this batch
                            resp.raise_for_status()
                            results = resp.json().get("results", [])
                    except Exception:
                        continue

                    for rec in results:
                        appl_no = rec.get("application_number", "")
                        if not appl_no or appl_no in seen_applnos:
                            continue

                        # Find latest approval submission
                        subs = rec.get("submissions", [])
                        approved = [
                            s for s in subs
                            if s.get("submission_status", "").upper() == "AP"
                        ]
                        if not approved:
                            continue
                        latest  = sorted(approved, key=lambda s: s.get("submission_status_date",""), reverse=True)[0]
                        appr_dt = latest.get("submission_status_date", "")

                        # Only alert on approvals within last 2 days
                        try:
                            from datetime import datetime as _dt2
                            age_days = (date.today() - _dt2.strptime(appr_dt[:10], "%Y-%m-%d").date()).days
                            if age_days > 2:
                                continue
                        except Exception:
                            continue

                        # Match back to watchlist ticker
                        mfr_names = [
                            n.upper() for n in
                            (rec.get("openfda", {}).get("manufacturer_name") or [])
                        ]
                        matched_ticker = None
                        for tk, kw in company_map.items():
                            if any(kw in mfr for mfr in mfr_names):
                                matched_ticker = tk
                                break
                        if not matched_ticker:
                            continue

                        seen_applnos.add(appl_no)
                        seen_ts[appl_no] = date.today().isoformat()

                        brand  = (rec.get("openfda", {}).get("brand_name") or [""])[0]
                        generic = (rec.get("openfda", {}).get("generic_name") or [""])[0]
                        drug   = brand or generic or appl_no
                        sub_type = latest.get("submission_type", "")
                        fda_url_rec = f"https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo={appl_no.replace('NDA','').replace('ANDA','').replace('BLA','')}"

                        await broadcaster.publish({
                            "type":      "fda_alert",
                            "ticker":    matched_ticker,
                            "title":     f"{matched_ticker} FDA Approval — {drug}",
                            "sub":       f"{sub_type} approved · {appr_dt[:10]}",
                            "drug":      drug,
                            "appl_no":   appl_no,
                            "appr_date": appr_dt[:10],
                            "url":       fda_url_rec,
                            "color":     "gold",
                            "emoji":     "💊",
                        })
                        logger.info(f"FDA alert: {matched_ticker} {drug} {appl_no} approved {appr_dt[:10]}")

                    await asyncio.sleep(0.5)

                # Prune seen set daily
                cutoff = (date.today() - timedelta(days=3)).isoformat()
                for a in [k for k, v in seen_ts.items() if v < cutoff]:
                    seen_applnos.discard(a); seen_ts.pop(a, None)

            except Exception as _e:
                logger.warning(f"_fda_alert_loop: {_e}")
            await asyncio.sleep(POLL_INTERVAL_S)

    asyncio.create_task(_fda_alert_loop())
    logger.info("FDA approvals poller started (30-min, openFDA drug approvals)")

    # ── Loop 4: News watchlist poller ─────────────────────────────────────────
    # Every 15 min — Polygon /v2/reference/news for each watchlist ticker.
    # Dedupes by article URL. Pushes news_alert SSE event so frontend can
    # display a notification toast with headline + sentiment + source link.
    # Only fires for articles published within the last 2 hours to avoid
    # flooding on startup with old news.
    async def _news_watchlist_loop():
        POLL_INTERVAL_S = 900        # 15 minutes
        MAX_AGE_HOURS   = 2          # only alert on very recent articles
        seen_urls       : set  = set()
        seen_ts         : dict = {}

        api_key = os.getenv("MASSIVE_API_KEY", "")
        if not api_key:
            logger.warning("NEWS poller: MASSIVE_API_KEY not set — skipping news loop")
            return

        await asyncio.sleep(150)     # warm-up after FDA loop

        while True:
            try:
                eng = getattr(app.state, "engine", None)
                if not eng or eng._shutdown.is_set():
                    break

                wl_rows   = await asyncio.to_thread(db.get_signal_watchlist)
                watchlist = [r["ticker"] for r in wl_rows if r.get("ticker")]

                from datetime import datetime as _dt3, timezone as _tz
                now_utc    = _dt3.now(_tz.utc)
                cutoff_iso = (now_utc - timedelta(hours=MAX_AGE_HOURS)).strftime("%Y-%m-%dT%H:%M:%SZ")

                for sym in watchlist:
                    news_url = (
                        f"https://api.polygon.io/v2/reference/news"
                        f"?ticker={sym}&limit=5&order=desc&sort=published_utc"
                        f"&published_utc.gte={cutoff_iso}&apiKey={api_key}"
                    )
                    try:
                        async with httpx.AsyncClient(timeout=8) as client:
                            resp = await client.get(news_url)
                            resp.raise_for_status()
                            articles = resp.json().get("results", [])
                    except Exception:
                        await asyncio.sleep(0.2)
                        continue

                    for art in articles:
                        art_url = art.get("article_url", "")
                        if not art_url or art_url in seen_urls:
                            continue
                        seen_urls.add(art_url)
                        seen_ts[art_url] = date.today().isoformat()

                        headline  = art.get("title", "")
                        source    = (art.get("publisher") or {}).get("name", "")
                        published = art.get("published_utc", "")
                        sentiment = (art.get("insights") or [{}])[0].get("sentiment", "neutral")
                        sent_color = (
                            "green" if sentiment == "positive"
                            else "red" if sentiment == "negative"
                            else "cyan"
                        )
                        await broadcaster.publish({
                            "type":      "news_alert",
                            "ticker":    sym,
                            "title":     f"{sym} — {headline[:60]}{'…' if len(headline)>60 else ''}",
                            "sub":       f"{source} · {sentiment}",
                            "headline":  headline,
                            "source":    source,
                            "published": published,
                            "sentiment": sentiment,
                            "url":       art_url,
                            "color":     sent_color,
                            "emoji":     "📰",
                        })
                        logger.debug(f"News alert: {sym} '{headline[:50]}' ({source})")

                    await asyncio.sleep(0.25)  # rate-limit between tickers

                # Prune seen URLs daily
                cutoff = (date.today() - timedelta(days=1)).isoformat()
                for u in [k for k, v in seen_ts.items() if v < cutoff]:
                    seen_urls.discard(u); seen_ts.pop(u, None)

            except Exception as _e:
                logger.warning(f"_news_watchlist_loop: {_e}")
            await asyncio.sleep(POLL_INTERVAL_S)

    asyncio.create_task(_news_watchlist_loop())
    logger.info("News watchlist poller started (15-min, Polygon news, 2hr recency filter)")

    yield

    logger.info("Shutting down …")
    try:
        app.state.alerts_engine.stop()
        logger.info("SmartAlertsEngine stopped.")
    except Exception:
        pass
    engine.shutdown()
    logger.info("Shutdown complete.")


app = FastAPI(title="NexRadar Pro API", version="6.5.0", lifespan=lifespan)

FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "https://nexradar.info").rstrip("/")
# GZip REST compression — applies to all non-SSE endpoints automatically.
# StreamingResponse (SSE /api/stream) is excluded by FastAPI because
# GZipMiddleware checks Content-Type and skips text/event-stream.
# Saves 70-80% on /api/snapshot, /api/market-monitor, /api/stock-data etc.
from fastapi.middleware.gzip import GZipMiddleware
app.add_middleware(GZipMiddleware, minimum_size=500)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        FRONTEND_ORIGIN,
        "https://nexradar.info",
        "https://www.nexradar.info",
        "https://radar-pro-frontend-zgy9.onrender.com",
        "http://localhost:5173",
        "http://localhost:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Health ─────────────────────────────────────────────────────────────────────
@app.api_route("/health", methods=["GET", "HEAD"])
async def health():
    return {"status": "ok", "ts": int(time.time())}


# ── Metrics ────────────────────────────────────────────────────────────────────
# ── Health / Cold-start detection ─────────────────────────────────────────────
# Frontend polls this on first connect to detect if server just woke up.
@app.get("/api/health")
async def get_api_health():
    uptime_s  = time.monotonic() - broadcaster._start_ts if broadcaster else 999
    eng       = getattr(app.state, "engine", None)
    ws_ready  = bool(getattr(eng, "_connected", None) and eng._connected.is_set())
    cache_size = len(eng._cache) if eng else 0
    return {
        "ok":           True,
        "uptime_s":     round(uptime_s, 1),
        "warming_up":   uptime_s < 90,
        "ws_ready":     ws_ready,
        "ticker_count": cache_size,
    }


@app.get("/api/metrics")
async def get_metrics():
    snap_map = broadcaster.get_snapshot_map() if broadcaster else {}
    engine: WSEngine = getattr(app.state, "engine", None)
    # GAP-5: compute worker health — seconds since last tick processed.
    # tick_stale_s > 30 during market hours = compute worker stalled.
    tick_stale_s = None
    if engine and getattr(engine, "_last_tick_processed_ts", 0) > 0:
        tick_stale_s = round(time.monotonic() - engine._last_tick_processed_ts, 1)
    return {
        "sse_clients":    broadcaster.client_count if broadcaster else 0,
        "snapshot_size":  len(snap_map),
        "session":        _get_market_status_simple(),
        "architecture":   "direct-sse-v6.5-ai-proxy-stock-data",
        "tick_queue_len": len(engine._tick_queue) if engine else None,
        "tick_stale_s":   tick_stale_s,
        "dirty_tickers":  len(engine._dirty_tickers) if engine else None,
    }


def _get_market_status_simple() -> str:
    import pytz
    from datetime import datetime, time as dt_time
    et  = pytz.timezone("America/New_York")
    now = datetime.now(et)
    t   = now.time()
    if now.weekday() >= 5:                        return "CLOSED_WEEKEND"
    if dt_time(20, 0) <= t or t < dt_time(4, 0): return "OVERNIGHT_SLEEP"
    if dt_time(4,  0) <= t < dt_time(9,  30):    return "PRE_MARKET"
    if dt_time(9, 30) <= t < dt_time(16,  0):    return "MARKET_HOURS"
    if dt_time(16, 0) <= t < dt_time(20,  0):    return "AFTER_HOURS"
    return "CLOSED"


# ── Snapshot ───────────────────────────────────────────────────────────────────
@app.get("/api/snapshot")
async def get_snapshot(
    limit:         int  = Query(6200, le=10000),
    only_positive: bool = Query(False),
    source:        str  = Query("all"),
    sector:        str  = Query(""),
):
    # Use snapshot_map for always-current data (updated by both snapshot + snapshot_delta)
    snap_map = broadcaster.get_snapshot_map() if broadcaster else {}
    data     = list(snap_map.values())

    for row in data:
        if "open" not in row or not row["open"]:
            row["open"] = row.get("open_price", 0)
        if "company_name" not in row or not row["company_name"]:
            row["company_name"] = row.get("company", "")

    if only_positive:
        data = [r for r in data if r.get("is_positive")]
    if sector and sector.upper() not in ("", "ALL"):
        su   = sector.upper()
        data = [r for r in data if (r.get("sector") or "").upper() == su]
    if source == "portfolio":
        pts  = {r["ticker"] for r in (db.get_portfolio() if db else [])}
        data = [r for r in data if r.get("ticker") in pts]
    elif source == "monitor":
        mts  = {r["ticker"] for r in (db.get_monitor() if db else [])}
        data = [r for r in data if r.get("ticker") in mts]

    return {"type": "snapshot", "data": data[:limit], "count": len(data)}


# ── SSE Stream ─────────────────────────────────────────────────────────────────
@app.get("/api/stream")
async def sse_stream(request: Request, client_ts: int = Query(0)):
    """
    SSE endpoint — zero Redis.

    client_ts handshake (FIX: no reconnect blast):
      The client passes ?client_ts=<unix_ms_of_last_snapshot_received>.
      If the backend snapshot is less than 10 seconds newer than client_ts,
      the client's data is still fresh — skip the full snapshot and send only
      a lightweight reconnected ack. This eliminates the 3 MB blast on every
      tab switch / page refresh when using the SharedWorker (sseWorker.js).

    On connect (true first load or stale data):
      1. Full snapshot built from _snapshot_map (always current)
      2. signal_snapshot — last 50 signals (PATCH-MAIN-1)
      3. watchlist_snapshot — current watchlist (PATCH-MAIN-3)

    On reconnect with fresh data (client_ts < 10s old):
      1. Lightweight {"type":"reconnected"} ack only

    Live stream:
      type="snapshot_delta"  — only changed tickers (FIX-2, ~20 KB not 3 MB)
      type="tick_batch"      — 250ms coalesced tick data
      type="feed_status"     — Polygon WS up/down (FIX-5)
      type="session_change"  — MH/AH boundary crossed (FIX-3)
      type="keepalive"       — every 15s to keep TCP alive
    """
    async def _generate() -> AsyncGenerator[str, None]:
        import uuid
        client_id = str(uuid.uuid4())[:8]
        q = broadcaster.subscribe(client_id)
        logger.info(f"SSE client {client_id} connected (total: {broadcaster.client_count})")
        try:
            # GAP-4: wait on snapshot_ready Event instead of a spin-wait loop.
            # All concurrent SSE connects block here without holding any lock —
            # zero serialisation contention during cold-start multi-tab connects.
            # The event is set in lifespan once WSEngine broadcasts its first snapshot.
            _snapshot_ready_evt = getattr(app.state, "snapshot_ready", None)
            _eng = getattr(app.state, "engine", None)
            snap_map = broadcaster.get_snapshot_map()
            if not snap_map:
                if _snapshot_ready_evt:
                    try:
                        await asyncio.wait_for(_snapshot_ready_evt.wait(), timeout=8.0)
                    except asyncio.TimeoutError:
                        logger.warning(f"SSE {client_id}: snapshot_ready timeout after 8s")
                # After event fires, prefer broadcaster map; fall back to engine cache
                snap_map = broadcaster.get_snapshot_map()
                if not snap_map and _eng and _eng._cache:
                    with _eng._cache_lock:
                        snap_map = {tk: dict(row) for tk, row in _eng._cache.items()}
                    logger.info(f"SSE {client_id}: engine cache fallback "
                                f"({len(snap_map)} tickers — broadcaster not yet synced)")
                if not snap_map:
                    logger.warning(f"SSE {client_id}: cache still empty after wait")

            snap_ts  = int(time.time() * 1000)
            age_ms   = snap_ts - client_ts

            # ── TIERED RECONNECT ──────────────────────────────────────────────
            # Tier 1  client_ts == 0 (no prior data)  → full snapshot only
            # Tier 2  client_ts > 0, age > 10s        → delta of changed rows only
            # Tier 3  age <= 10s                       → lightweight ack only
            #
            # Full snapshot is ONLY sent on true first load (client_ts==0).
            # Every reconnect after that uses get_changed_since(client_ts) which
            # returns only rows updated while the client was away — works for any
            # gap length. A 10min gap returns ~2000 rows (~1MB) not all 6027 (~3MB).
            # After-hours / weekends: near zero rows, near zero bytes.

            FRESH_THRESHOLD_MS = 10_000   # <= 10s → ack only, data still current
            is_first_load      = client_ts == 0 or not snap_map

            if is_first_load:
                # Tier 1: First ever load — client has nothing, send everything
                ticker_map = broadcaster.build_ticker_map(
                    list(snap_map.keys()) if snap_map else []
                )
                if ticker_map:
                    yield "data: " + _dumps({
                        "type": "ticker_map",
                        "map":  ticker_map,
                        "seq":  broadcaster.get_current_seq(),
                    }) + "\n\n"
                if snap_map:
                    yield "data: " + _dumps({
                        "type": "snapshot",
                        "data": list(snap_map.values()),
                        "ts":   snap_ts,
                    }) + "\n\n"

                # PATCH-MAIN-1: Signal snapshot on connect
                try:
                    signals = await asyncio.to_thread(db.get_recent_signals, 50)
                    if signals:
                        # Normalize ticker field — signals table may store as 'symbol'
                        for s in signals:
                            if not s.get("ticker") and s.get("symbol"):
                                s["ticker"] = s["symbol"]
                        yield "data: " + _dumps({
                            "type":      "signal_snapshot",
                            "data":      signals,
                            "server_ts": int(time.time() * 1000),
                        }) + "\n\n"
                except Exception as e:
                    logger.warning(f"SSE connect: signal_snapshot failed: {e}")

                # PATCH-MAIN-3: Watchlist snapshot on connect
                try:
                    wl_rows = await asyncio.to_thread(db.get_signal_watchlist)
                    wl      = [r["ticker"] for r in wl_rows if r.get("ticker")]
                    if wl:
                        yield "data: " + _dumps({
                            "type":      "watchlist_snapshot",
                            "watchlist": wl,
                            "server_ts": int(time.time() * 1000),
                        }) + "\n\n"
                except Exception as e:
                    logger.warning(f"SSE connect: watchlist_snapshot failed: {e}")

            elif age_ms > FRESH_THRESHOLD_MS:
                # Tier 2: Any reconnect with a known prior state.
                # Send only rows that changed since client_ts — any gap length.
                # Peak market hours + 10min away → ~2000 rows, not 6027.
                # After-hours or quiet market → often 0 rows → pure ack.
                changed = broadcaster.get_changed_since(client_ts)
                if changed:
                    yield "data: " + _dumps({
                        "type":    "snapshot_delta",
                        "data":    changed,
                        "ts":      snap_ts,
                        "partial": True,
                    }) + "\n\n"
                    logger.info(
                        f"SSE {client_id}: tier-2 reconnect "
                        f"gap={age_ms//1000}s {len(changed)}/{len(snap_map)} rows"
                    )
                else:
                    yield f'data: {{"type":"reconnected","ts":{snap_ts}}}\n\n'

            else:
                # Tier 3: age <= 10s — data still current, ack only
                yield f'data: {{"type":"reconnected","ts":{snap_ts}}}\n\n'
            # Live stream
            while True:
                if await request.is_disconnected():
                    break
                try:
                    msg = await asyncio.wait_for(q.get(), timeout=15.0)
                    if msg == "DISCONNECT":
                        break
                    yield msg
                except asyncio.TimeoutError:
                    # KEEPALIVE-FIX: send as proper data message not SSE comment.
                    # SSE comments (': ...') are silently ignored by EventSource —
                    # they don't trigger onmessage so sseWorker watchdog (25s) was
                    # firing every cycle during weekend/pre-market when no ticks flow.
                    yield "data: {\"type\":\"keepalive\"}\n\n"
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error(f"SSE generator error: {e}")
        finally:
            broadcaster.unsubscribe(q)
            logger.info(f"SSE client {client_id} disconnected (total: {broadcaster.client_count})")

    return StreamingResponse(
        _generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control":     "no-cache",
            "X-Accel-Buffering": "no",
            "Connection":        "keep-alive",
        },
    )


# ── Live tickers ───────────────────────────────────────────────────────────────
@app.get("/api/tickers")
async def get_tickers(
    limit:         int  = Query(6200, le=10000),
    only_positive: bool = Query(True),
    source:        str  = Query("all"),
    sector:        str  = Query(""),
):
    result = await get_snapshot(
        limit=limit, only_positive=only_positive, source=source, sector=sector
    )
    return result.get("data", [])


# ── Earnings ───────────────────────────────────────────────────────────────────
@app.get("/api/earnings")
async def get_earnings(start: str = Query(default=None), end: str = Query(default=None)):
    """
    Enriched earnings calendar for PageEarnings.jsx.

    Base:        Supabase earnings table  → ticker, report_date, when, eps_estimate, rev_estimate
    +sector:     engine._sector_map       → zero HTTP, in-memory
    +company:    engine._company_map      → zero HTTP, in-memory
    +live_price: engine._cache            → zero HTTP, in-memory
    +market_cap: Polygon /v3/reference/tickers/{sym} batched concurrently
    +surprise:   Polygon /v1/meta/symbols/{sym}/earnings last 4Q, batched concurrently

    All enrichment is non-blocking — missing data shows as null/[] not an error.
    """
    today = date.today()
    s = start or today.isoformat()
    e = end   or (today + timedelta(days=7)).isoformat()

    # ── Base rows from Supabase ────────────────────────────────────────────────
    rows = await asyncio.to_thread(db.get_earnings_for_range, s, e)
    if not rows:
        return []

    # ── In-memory enrichment (zero HTTP) ──────────────────────────────────────
    eng         = getattr(app.state, "engine", None)
    company_map = getattr(eng, "_company_map", {}) if eng else {}
    sector_map  = getattr(eng, "_sector_map",  {}) if eng else {}
    cache       = eng._cache if eng else {}

    enriched = []
    for row in rows:
        sym  = (row.get("ticker") or "").upper()
        live = {}
        if eng and sym in cache:
            with eng._cache_lock:
                live = dict(cache.get(sym, {}))
        enriched.append({
            **row,
            "ticker":         sym,
            "company_name":   row.get("company_name") or company_map.get(sym, ""),
            "sector":         row.get("sector")       or sector_map.get(sym, ""),
            "live_price":     live.get("live_price")  or live.get("price"),
            "percent_change": live.get("percent_change"),
            "market_cap":     None,       # filled below via Polygon
            "surprise_history": [],       # filled below via Polygon
        })

    api_key = os.getenv("MASSIVE_API_KEY", "")
    if not api_key:
        return enriched

    tickers_in_range = [r["ticker"] for r in enriched if r.get("ticker")]

    # ── Polygon surprise history: last 4 reported quarters ────────────────────
    async def _fetch_surprise(sym: str) -> tuple:
        url = f"https://api.polygon.io/v1/meta/symbols/{sym}/earnings?limit=4&apiKey={api_key}"
        try:
            async with httpx.AsyncClient(timeout=6) as client:
                r = await client.get(url)
                r.raise_for_status()
                history = [
                    {
                        "quarter":      e.get("quarter"),
                        "year":         e.get("year"),
                        "eps_est":      (e.get("eps") or {}).get("estimate"),
                        "eps_actual":   (e.get("eps") or {}).get("actual"),
                        "surprise_pct": (e.get("eps") or {}).get("surprisePercent"),
                    }
                    for e in (r.json().get("results") or [])
                    if (e.get("eps") or {}).get("actual") is not None
                ]
                return sym, history
        except Exception:
            return sym, []

    # ── Polygon market cap: /v3/reference/tickers/{sym} ───────────────────────
    async def _fetch_mktcap(sym: str) -> tuple:
        url = f"https://api.polygon.io/v3/reference/tickers/{sym}?apiKey={api_key}"
        try:
            async with httpx.AsyncClient(timeout=6) as client:
                r = await client.get(url)
                r.raise_for_status()
                mkt_cap = (r.json().get("results") or {}).get("market_cap")
                return sym, mkt_cap
        except Exception:
            return sym, None

    # Run both enrichment batches concurrently
    surprise_res, mktcap_res = await asyncio.gather(
        asyncio.gather(*[_fetch_surprise(sym) for sym in tickers_in_range], return_exceptions=True),
        asyncio.gather(*[_fetch_mktcap(sym)  for sym in tickers_in_range], return_exceptions=True),
    )

    surprise_map = {r[0]: r[1] for r in surprise_res if isinstance(r, tuple)}
    mktcap_map   = {r[0]: r[1] for r in mktcap_res   if isinstance(r, tuple)}

    for row in enriched:
        sym = row["ticker"]
        row["surprise_history"] = surprise_map.get(sym, [])
        row["market_cap"]       = mktcap_map.get(sym)

    return enriched


# ── Signals ────────────────────────────────────────────────────────────────────
@app.get("/api/signals")
async def get_signals(limit: int = Query(200, le=500)):
    """PATCH-MAIN-2: X-Data-Timestamp header added."""
    data = await asyncio.to_thread(db.get_recent_signals, limit)
    from fastapi.responses import JSONResponse
    return JSONResponse(
        content=data,
        headers={"X-Data-Timestamp": str(int(time.time() * 1000))},
    )

@app.post("/api/signals")
async def post_signal(payload: dict):
    return {"ok": await asyncio.to_thread(db.insert_signal, payload)}


# ── Portfolio / Monitor ────────────────────────────────────────────────────────
@app.get("/api/portfolio")
async def get_portfolio():
    """PATCH-MAIN-2: X-Data-Timestamp header added."""
    data = await asyncio.to_thread(db.get_portfolio)
    from fastapi.responses import JSONResponse
    return JSONResponse(
        content=data,
        headers={"X-Data-Timestamp": str(int(time.time() * 1000))},
    )

@app.get("/api/monitor")
async def get_monitor():
    return await asyncio.to_thread(db.get_monitor)


# ── Stock List ─────────────────────────────────────────────────────────────────
@app.get("/api/stock-list")
async def get_stock_list():
    try:
        tickers, company_map, sector_map = await asyncio.to_thread(db.get_stock_meta)
        return [{"ticker": t, "company_name": company_map.get(t) or "—",
                 "sector": sector_map.get(t) or "—"} for t in tickers]
    except Exception as e:
        logger.error(f"stock-list error: {e}")
        return []


# ── Watchlist ─────────────────────────────────────────────────────────────────
class WatchlistBody(BaseModel):
    ticker: str


async def _refresh_signal_watcher():
    """Push updated watchlist to WSEngine signal watcher + SmartAlertsEngine."""
    try:
        engine = app.state.engine
        if engine and engine._signal_watcher:
            rows    = await asyncio.to_thread(db.get_signal_watchlist)
            tickers = [r["ticker"] for r in rows if r.get("ticker")]
            engine._signal_watcher.set_watchlist(tickers)
            try:
                engine.set_watchlist_tickers(tickers)
            except AttributeError:
                pass
            try:
                app.state.alerts_engine.set_watchlist(tickers)
            except AttributeError:
                pass
    except Exception as e:
        logger.warning(f"_refresh_signal_watcher: {e}")


@app.get("/api/watchlist")
async def watchlist_get():
    """PATCH-MAIN-2: X-Data-Timestamp header added."""
    rows = await asyncio.to_thread(db.get_signal_watchlist)
    tickers = [r["ticker"] for r in rows if r.get("ticker")]
    from fastapi.responses import JSONResponse
    return JSONResponse(
        content={"watchlist": tickers, "count": len(tickers)},
        headers={"X-Data-Timestamp": str(int(time.time() * 1000))},
    )


@app.post("/api/watchlist/add")
async def watchlist_add(body: WatchlistBody):
    try:
        ticker = body.ticker.upper().strip()
        await asyncio.to_thread(db.add_signal_watchlist, ticker)
        await _refresh_signal_watcher()
        # v6.3-2 HYBRID WARM-UP: seed the newly-added ticker immediately so
        # its tech indicators are available within seconds, not 27 minutes.
        # Uses process_aggregate_bar on ScalpingSignalEngine directly —
        # seed_history_from_rest lives on SignalWatchlistManager, not here.
        try:
            _eng = getattr(app.state, "engine", None)
            _sw  = _eng._signal_watcher if _eng else None
            _key = getattr(_eng, "_api_key", None)
            if _sw and _key:
                import threading as _t2
                import urllib.request as _ur2
                import json as _j2
                import pytz as _tz2
                from datetime import datetime as _dt2

                try:
                    from backend.Scalping_Signal import OHLCVBar as _Bar
                except ModuleNotFoundError:
                    from Scalping_Signal import OHLCVBar as _Bar

                def _seed_ticker(_sym=ticker, _sw=_sw, _key=_key):
                    try:
                        et  = _tz2.timezone("America/New_York")
                        day = _dt2.now(et).strftime("%Y-%m-%d")
                        url = (
                            f"https://api.polygon.io/v2/aggs/ticker/{_sym}"
                            f"/range/1/minute/{day}/{day}"
                            f"?adjusted=true&sort=asc&limit=390&apiKey={_key}"
                        )
                        with _ur2.urlopen(url, timeout=10) as r:
                            data = _j2.loads(r.read().decode())
                        count = 0
                        for rb in data.get("results", []):
                            ts  = _dt2.fromtimestamp(rb["t"] / 1000.0, tz=et)
                            bar = _Bar(
                                timestamp=ts,
                                open=float(rb.get("o", 0)),
                                high=float(rb.get("h", 0)),
                                low=float(rb.get("l", 0)),
                                close=float(rb.get("c", 0)),
                                volume=float(rb.get("v", 0)),
                            )
                            if bar.close > 0:
                                _sw.process_aggregate_bar(_sym, bar)
                                count += 1
                        logger.info(f"watchlist_add seed: {_sym} {count} bars")
                    except Exception as e:
                        logger.debug(f"watchlist_add seed {_sym}: {e}")

                _t2.Thread(target=_seed_ticker, daemon=True, name=f"Seed-{ticker}").start()
        except Exception as _e:
            logger.debug(f"watchlist_add seed setup: {_e}")
        rows = await asyncio.to_thread(db.get_signal_watchlist)
        wl   = sorted([r["ticker"] for r in rows if r.get("ticker")])
        await broadcaster.publish({
            "type":      "watchlist_update",
            "action":    "add",
            "ticker":    ticker,
            "watchlist": wl,
            "server_ts": int(time.time() * 1000),
        })
        return {"ok": True, "action": "add", "ticker": ticker}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@app.post("/api/watchlist/remove")
async def watchlist_remove(body: WatchlistBody):
    try:
        ticker = body.ticker.upper().strip()
        await asyncio.to_thread(db.remove_signal_watchlist, ticker)
        await _refresh_signal_watcher()
        rows = await asyncio.to_thread(db.get_signal_watchlist)
        wl   = sorted([r["ticker"] for r in rows if r.get("ticker")])
        await broadcaster.publish({
            "type":      "watchlist_update",
            "action":    "remove",
            "ticker":    ticker,
            "watchlist": wl,
            "server_ts": int(time.time() * 1000),
        })
        return {"ok": True, "action": "remove", "ticker": ticker}
    except Exception as e:
        return {"ok": False, "error": str(e)}


# ── Legacy signal-watchlist ────────────────────────────────────────────────────
@app.get("/api/signal-watchlist")
async def get_signal_watchlist():
    rows = await asyncio.to_thread(db.get_signal_watchlist)
    tickers = [r["ticker"] for r in rows if r.get("ticker")]
    return {"symbols": tickers, "count": len(tickers), "max": 50}


@app.post("/api/signal-watchlist")
async def set_signal_watchlist(payload: dict):
    symbols = payload.get("symbols", [])
    corrections = {"ORACL": "ORCL", "TESLA": "TSLA"}
    symbols = [corrections.get(s.upper(), s.upper()) for s in symbols]
    for ticker in symbols:
        await asyncio.to_thread(db.add_signal_watchlist, ticker)
    logger.info(f"Signal watchlist bulk-set: {len(symbols)} symbols")
    await _refresh_signal_watcher()
    return {"accepted": symbols, "count": len(symbols)}


@app.post("/api/signal-vwap-reset")
async def reset_vwap():
    await broadcaster.publish({"type": "control", "action": "vwap_reset"})
    try:
        engine = app.state.engine
        if engine and engine._signal_watcher:
            engine._signal_watcher.reset_vwap()
    except Exception:
        pass
    return {"ok": True, "note": "vwap_reset applied immediately"}


# ── Market Monitor ─────────────────────────────────────────────────────────────
@app.get("/api/market-monitor")
async def get_market_monitor(refresh: int = Query(0)):
    rows    = await asyncio.to_thread(db.get_signal_watchlist)
    tickers = [r["ticker"] for r in rows if r.get("ticker")]
    if not tickers:
        return {"data": [], "ticker_count": 0,
                "message": "No tickers in watchlist."}
    # v6.3-3 DEPENDENCY INJECTION: pass signal_engine so get_cached_monitor
    # reads from live IndicatorCalculator state — zero yfinance, zero HTTP.
    _eng          = getattr(app.state, "engine", None)
    signal_engine = _eng._signal_watcher if _eng else None

    # PRICE-FILL: pass ws_engine._cache so warming_up/seeding rows get a live
    # Polygon price instead of price=0. ws_engine._cache is always populated
    # from the bulk Polygon REST snapshot at startup.
    _price_cache = None
    try:
        if _eng and hasattr(_eng, "_cache"):
            _price_cache = dict(_eng._cache)  # shallow copy — safe across threads
    except Exception:
        pass

    result = await asyncio.to_thread(
        get_cached_monitor, tickers, signal_engine, bool(refresh), _price_cache
    )
    return result



# ── AI Proxy — Amazon Bedrock ─────────────────────────────────────────────────
# Routes Claude API calls through Amazon Bedrock.
# Frontend payload is identical to Anthropic API — no frontend changes needed.
# Requires env vars: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION
# Uses $200 AWS credits — no separate Anthropic billing account needed.
@app.post("/api/ai/chat")
async def ai_chat_proxy(payload: dict):
    """
    Proxies Claude API requests from AgenticPanel / AIEngine.js via Bedrock.
    The frontend sends the standard Anthropic messages payload — this endpoint
    translates it to the Bedrock API format transparently.
    Rate-limiting note: each full analysis fires ~3 requests (brief + tech + verdict).
    AI toggle is OFF by default — user must explicitly enable in Dashboard Settings.
    """
    import boto3, json as _json
    from botocore.exceptions import ClientError, NoCredentialsError

    aws_key    = os.getenv("AWS_ACCESS_KEY_ID", "")
    aws_secret = os.getenv("AWS_SECRET_ACCESS_KEY", "")
    aws_region = os.getenv("AWS_REGION", "us-east-1")

    if not aws_key or not aws_secret:
        raise HTTPException(status_code=503, detail="AI not configured — set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in Render env vars.")

    # Bedrock model ID — Claude Sonnet 4.5
    model_id = "us.anthropic.claude-sonnet-4-6"

    # Bedrock requires anthropic_version in the body
    bedrock_body = {
        "anthropic_version": "bedrock-2023-05-31",
        "max_tokens":        payload.get("max_tokens", 1000),
        "messages":          payload.get("messages", []),
    }
    if payload.get("system"):
        bedrock_body["system"] = payload["system"]

    try:
        client = boto3.client(
            service_name          = "bedrock-runtime",
            region_name           = aws_region,
            aws_access_key_id     = aws_key,
            aws_secret_access_key = aws_secret,
        )
        response = await asyncio.to_thread(
            client.invoke_model,
            modelId     = model_id,
            body        = _json.dumps(bedrock_body),
            contentType = "application/json",
            accept      = "application/json",
        )
        result = _json.loads(response["body"].read())
        return result

    except NoCredentialsError:
        raise HTTPException(status_code=503, detail="AWS credentials invalid or expired.")
    except ClientError as e:
        code = e.response["Error"]["Code"]
        msg  = e.response["Error"]["Message"]
        logger.warning(f"/api/ai/chat Bedrock error {code}: {msg}")
        raise HTTPException(status_code=502, detail=f"Bedrock error: {msg}")
    except Exception as e:
        logger.error(f"/api/ai/chat error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# ── Scalp Analysis ─────────────────────────────────────────────────────────────
@app.get("/api/scalp-analysis")
async def get_scalp_analysis():
    rows              = await asyncio.to_thread(db.get_signal_watchlist)
    watchlist_tickers = {r["ticker"] for r in rows if r.get("ticker")}
    if not watchlist_tickers:
        return {"data": [], "message": "No tickers in watchlist."}
    try:
        engine = app.state.engine
        if engine and engine._signal_watcher:
            scalp_rows = engine._signal_watcher.get_scalp_snapshot(
                list(watchlist_tickers)
            )
            ok_rows = [r for r in scalp_rows
                       if not r.get("status") or r.get("status") == "ok"]
            return {"data": scalp_rows, "ticker_count": len(scalp_rows),
                    "ok_count": len(ok_rows),
                    "warming_count": max(0, len(watchlist_tickers) - len(scalp_rows))}
    except Exception as e:
        logger.warning(f"/api/scalp-analysis: {e}")

    warming_rows = [{"ticker": t, "status": "warming_up", "bars_count": 0}
                    for t in watchlist_tickers]
    return {"data": warming_rows, "ticker_count": len(warming_rows),
            "ok_count": 0, "warming_count": len(warming_rows),
            "message": "Signal engine seeding — live signals appear within 10s."}


# ── Opportunity Scanner + Relative Strength ─────────────────────────────────────
@app.get("/api/opportunity-scanner")
async def get_opportunity_scanner():
    rows = await asyncio.to_thread(db.get_signal_watchlist)
    watchlist_tickers = {r["ticker"] for r in rows if r.get("ticker")}
    if not watchlist_tickers:
        return {"data": [], "spy_pct": None, "message": "No tickers in watchlist."}

    spy_pct = None
    qqq_pct = None
    try:
        eng   = app.state.engine
        cache = eng._cache if eng else {}
        spy_e = cache.get("SPY") or cache.get("spy")
        qqq_e = cache.get("QQQ") or cache.get("qqq")
        if spy_e:
            spy_pct = spy_e.get("percent_change") or spy_e.get("change_pct")
        if qqq_e:
            qqq_pct = qqq_e.get("percent_change") or qqq_e.get("change_pct")
        # SPY-FIX: if still None after cache lookup (cold-start or not subscribed),
        # fall back to Polygon REST snapshot for SPY/QQQ immediately.
        api_key = os.getenv("MASSIVE_API_KEY", "")
        if (spy_pct is None or qqq_pct is None) and api_key:
            for sym, attr in [("SPY", "spy_pct"), ("QQQ", "qqq_pct")]:
                if locals().get(attr.split("_")[0] + "_pct") is not None:
                    continue
                try:
                    async with httpx.AsyncClient(timeout=5) as _c:
                        _r = await _c.get(
                            f"https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers/{sym}",
                            params={"apiKey": api_key}
                        )
                        _t   = (_r.json().get("ticker") or {})
                        _day = _t.get("day") or {}
                        _prev= _t.get("prevDay") or {}
                        _p   = float(_t.get("lastTrade", {}).get("p") or _day.get("c") or 0)
                        _pc  = float(_prev.get("c") or 0)
                        if _p > 0 and _pc > 0:
                            _pct = round((_p - _pc) / _pc * 100, 3)
                            if sym == "SPY": spy_pct = _pct
                            else:           qqq_pct = _pct
                except Exception as _fe:
                    logger.debug(f"SPY-FIX REST fallback {sym}: {_fe}")
    except Exception as e:
        logger.warning(f"opportunity-scanner: SPY/QQQ cache read failed: {e}")

    scalp_rows = []
    try:
        eng = app.state.engine
        if eng and eng._signal_watcher:
            scalp_rows = eng._signal_watcher.get_scalp_snapshot(list(watchlist_tickers))
    except Exception as e:
        logger.warning(f"opportunity-scanner: scalp snapshot failed: {e}")

    live_cache = {}
    try:
        live_cache = app.state.engine._cache if app.state.engine else {}
    except Exception:
        pass

    def rs_label(rs):
        if rs is None:    return "—"
        if rs >=  2.0:    return "VERY STRONG"
        if rs >=  0.75:   return "STRONG"
        if rs >=  0.25:   return "MODERATE"
        if rs >= -0.25:   return "NEUTRAL"
        if rs >= -0.75:   return "WEAK"
        return "VERY WEAK"

    enriched = []
    for row in scalp_rows:
        if row.get("status") == "warming_up":
            continue
        ticker  = row["ticker"]
        score   = row.get("score", 0.0)
        live    = live_cache.get(ticker, {})
        pct_chg = live.get("percent_change") or live.get("change_pct") or 0.0
        rvol    = live.get("rvol", row.get("volume", 1.0))
        sector  = live.get("sector", "")
        price   = live.get("live_price") or live.get("price") or row.get("price", 0)

        rs_spy  = round(pct_chg - spy_pct, 3) if spy_pct is not None else None
        rs_qqq  = round(pct_chg - qqq_pct, 3) if qqq_pct is not None else None

        rs_bonus  = max(-0.10, min(0.10, rs_spy * 0.02)) if rs_spy is not None else 0.0
        composite = round(score + rs_bonus, 3)

        abs_comp = abs(composite)
        tier = "A" if abs_comp >= 0.75 else "B" if abs_comp >= 0.55 else "C" if abs_comp >= 0.40 else "D"

        enriched.append({
            **row,
            "price":           round(float(price), 2) if price else row.get("price", 0),
            "pct_change":      round(float(pct_chg), 3),
            "rvol":            round(float(rvol), 2),
            "sector":          sector,
            "rs_spy":          rs_spy,
            "rs_qqq":          rs_qqq,
            "rs_label":        rs_label(rs_spy),
            "composite_score": composite,
            "tier":            tier,
        })

    tier_ord   = {"A": 0, "B": 1, "C": 2, "D": 3}
    signal_ord = {"BUY": 0, "SELL": 1, "HOLD": 2}
    enriched.sort(key=lambda r: (
        tier_ord.get(r["tier"], 9),
        signal_ord.get(r.get("signal", "HOLD"), 9),
        -abs(r["composite_score"]),
    ))

    return {
        "data":         enriched,
        "spy_pct":      round(spy_pct, 3) if spy_pct is not None else None,
        "qqq_pct":      round(qqq_pct, 3) if qqq_pct is not None else None,
        "ticker_count": len(enriched),
        "generated_at": int(time.time()),
    }


# ── Feature #1: Smart Alerts ──────────────────────────────────────────────────
@app.get("/api/alerts")
async def get_alerts(limit: int = Query(50, ge=1, le=200)):
    """Returns recent alerts from SmartAlertsEngine. Real-time via SSE type:alert."""
    try:
        ae = app.state.alerts_engine
        return {
            "data":         ae.get_recent_alerts(limit),
            "count":        len(ae.alert_history),
            "generated_at": int(time.time()),
        }
    except AttributeError:
        return {"data": [], "count": 0, "message": "Alert engine not initialised"}


# ── Feature #4: Multi-Timeframe Scanner ──────────────────────────────────────
@app.get("/api/mtf-scanner")
async def get_mtf_scanner():
    """1m + 5m + 15m trend confluence scanner for watchlist symbols."""
    try:
        rows = await asyncio.to_thread(db.get_signal_watchlist)
        watchlist = [r["ticker"] for r in rows if r.get("ticker")]
        if not watchlist:
            return {"data": [], "message": "No watchlist symbols configured"}

        eng  = app.state.engine
        data = eng._signal_watcher.get_mtf_snapshot(watchlist) if eng and eng._signal_watcher else []

        cache = eng._cache if eng else {}
        spy_e = cache.get("SPY", {})
        qqq_e = cache.get("QQQ", {})

        return {
            "data":         data,
            "ticker_count": len(data),
            "spy_pct":      spy_e.get("percent_change"),
            "qqq_pct":      qqq_e.get("percent_change"),
            "generated_at": int(time.time()),
        }
    except Exception as e:
        logger.error(f"MTF scanner error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# ── Yahoo Finance Proxy — Quote ────────────────────────────────────────────────
_YF_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "application/json, text/xml, */*",
}

@app.get("/api/quote/{symbol}")
async def get_quote(symbol: str):
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol.upper()}?interval=1d&range=1d"
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            r = await client.get(url, headers=_YF_HEADERS)
            r.raise_for_status()
            data = r.json()
        meta = data.get("chart", {}).get("result", [{}])[0].get("meta", {})
        return {
            "open":      meta.get("regularMarketOpen"),
            "high":      meta.get("regularMarketDayHigh"),
            "low":       meta.get("regularMarketDayLow"),
            "prevClose": meta.get("chartPreviousClose"),
            "volume":    meta.get("regularMarketVolume"),
            "avgVol":    meta.get("averageDailyVolume10Day"),
            "marketCap": meta.get("marketCap"),
            "wkHi52":    meta.get("fiftyTwoWeekHigh"),
            "wkLo52":    meta.get("fiftyTwoWeekLow"),
            "exchange":  meta.get("exchangeName"),
            "name":      meta.get("longName", symbol.upper()),
        }
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


# ── Yahoo Finance Proxy — News ─────────────────────────────────────────────────
@app.get("/api/news/{symbol}")
async def get_news(symbol: str):
    url = f"https://feeds.finance.yahoo.com/rss/2.0/headline?s={symbol.upper()}&region=US&lang=en-US"
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            r = await client.get(url, headers=_YF_HEADERS)
            r.raise_for_status()
        import xml.etree.ElementTree as ET
        root  = ET.fromstring(r.text)
        items = []
        for item in root.findall(".//item")[:8]:
            items.append({
                "title":   (item.findtext("title")   or "").strip(),
                "link":    (item.findtext("link")    or "#").strip(),
                "pubDate": (item.findtext("pubDate") or "").strip(),
                "source":  (item.findtext("source")  or "Yahoo Finance").strip(),
            })
        return {"items": items}
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


# ── Polygon Proxy — OHLCV bars ─────────────────────────────────────────────────
@app.get("/api/chart/{symbol}")
async def get_chart_bars(symbol: str, interval: str = "1", range: str = "1d"):
    import pytz
    from datetime import datetime, timedelta

    api_key = os.getenv("MASSIVE_API_KEY", "")
    if not api_key:
        raise HTTPException(status_code=503, detail="Polygon API key not configured")

    sym        = symbol.upper()
    multiplier = int(interval) if interval.isdigit() else 1
    timespan   = "minute" if multiplier < 60 else "hour"
    if multiplier == 60:
        multiplier = 1

    et     = pytz.timezone("America/New_York")
    now_et = datetime.now(et)
    from_dt = now_et - timedelta(days=7 if range == "5d" else 35 if range == "1mo" else 1)

    url = (
        f"https://api.polygon.io/v2/aggs/ticker/{sym}/range/{multiplier}/{timespan}"
        f"/{from_dt.strftime('%Y-%m-%d')}/{now_et.strftime('%Y-%m-%d')}"
        f"?adjusted=true&sort=asc&limit=50000&apiKey={api_key}"
    )
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(url)
            r.raise_for_status()
            data = r.json()
        bars = [{"t": b["t"], "o": b["o"], "h": b["h"], "l": b["l"],
                  "c": b["c"], "v": b.get("v", 0)}
                for b in (data.get("results") or [])]
        return {"bars": bars, "symbol": sym, "interval": multiplier, "count": len(bars)}
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))



# ── AgenticPanel: Full Stock Data ─────────────────────────────────────────────
# Proxies all Polygon REST calls for DataEngine.getFullStockData() server-side.
# Eliminates need for VITE_POLYGON_API_KEY on the frontend — the backend's
# MASSIVE_API_KEY is used instead. Results cached in stock_data_cache table
# (5min TTL) so repeat clicks are instant with zero Polygon API calls.
@app.get("/api/stock-data/{symbol}")
async def get_stock_data(symbol: str, force: bool = False):
    """
    Full stock data for AgenticPanel: price, technicals, support/resistance,
    options IV, news, earnings estimates, fundamentals.
    Cached 5min in stock_data_cache. Used by DataEngine.getFullStockData().
    """
    sym     = symbol.upper().strip()
    api_key = os.getenv("MASSIVE_API_KEY", "")
    if not api_key:
        raise HTTPException(status_code=503, detail="Polygon API key not configured")

    # ── Cache read ─────────────────────────────────────────────────────────────
    if not force:
        try:
            cached = await asyncio.to_thread(db.get_stock_data_cache, sym)
            if cached:
                return {**cached, "cached": True}
        except Exception:
            pass

    # ── Parallel Polygon REST fetch ────────────────────────────────────────────
    base = "https://api.polygon.io"
    from datetime import datetime, timedelta

    async def _get(path, params=None):
        params = params or {}
        params["apiKey"] = api_key
        try:
            async with httpx.AsyncClient(timeout=8) as client:
                r = await client.get(f"{base}{path}", params=params)
                if r.is_success:
                    return r.json()
        except Exception:
            pass
        return {}

    today = datetime.utcnow().strftime("%Y-%m-%d")
    ago90 = (datetime.utcnow() - timedelta(days=90)).strftime("%Y-%m-%d")

    snap, rsi, macd, sma20, sma50, sma200, ema9, bars90, options, news, earnings, details = (
        await asyncio.gather(
            _get(f"/v2/snapshot/locale/us/markets/stocks/tickers/{sym}"),
            _get(f"/v1/indicators/rsi/{sym}",  {"timespan":"day","window":14,"series_type":"close","limit":1}),
            _get(f"/v1/indicators/macd/{sym}", {"timespan":"day","short_window":12,"long_window":26,"signal_window":9,"series_type":"close","limit":1}),
            _get(f"/v1/indicators/sma/{sym}",  {"timespan":"day","window":20,"series_type":"close","limit":1}),
            _get(f"/v1/indicators/sma/{sym}",  {"timespan":"day","window":50,"series_type":"close","limit":1}),
            _get(f"/v1/indicators/sma/{sym}",  {"timespan":"day","window":200,"series_type":"close","limit":1}),
            _get(f"/v1/indicators/ema/{sym}",  {"timespan":"day","window":9,"series_type":"close","limit":1}),
            _get(f"/v2/aggs/ticker/{sym}/range/1/day/{ago90}/{today}", {"adjusted":"true","sort":"asc","limit":90}),
            _get(f"/v3/snapshot/options/{sym}", {"limit":50}),
            _get(f"/v2/reference/news", {"ticker":sym,"limit":5,"order":"desc","sort":"published_utc"}),
            _get(f"/v1/meta/symbols/{sym}/earnings", {"limit":8}),
            _get(f"/v3/reference/tickers/{sym}"),
        )
    )

    # ── Parse snapshot ─────────────────────────────────────────────────────────
    t         = snap.get("ticker") or {}
    day       = t.get("day") or {}
    prev_day  = t.get("prevDay") or {}
    last_tr   = t.get("lastTrade") or {}
    price     = float(last_tr.get("p") or day.get("c") or 0)
    prev_cl   = float(prev_day.get("c") or 0)
    change    = round(price - prev_cl, 4) if prev_cl > 0 else 0
    chg_pct   = round(change / prev_cl * 100, 4) if prev_cl > 0 else 0

    # ── Parse technicals ──────────────────────────────────────────────────────
    rsi_val   = (rsi.get("results") or {}).get("values", [{}])[0].get("value")
    macd_v    = ((macd.get("results") or {}).get("values") or [{}])[0]
    sma20_v   = ((sma20.get("results") or {}).get("values") or [{}])[0].get("value")
    sma50_v   = ((sma50.get("results") or {}).get("values") or [{}])[0].get("value")
    sma200_v  = ((sma200.get("results") or {}).get("values") or [{}])[0].get("value")
    ema9_v    = ((ema9.get("results") or {}).get("values") or [{}])[0].get("value")

    # ── Support / Resistance from 90-day bars ─────────────────────────────────
    bars      = bars90.get("results") or []
    highs     = sorted([b.get("h",0) for b in bars], reverse=True)
    lows      = sorted([b.get("l",0) for b in bars])
    resistance= round(sum(highs[:5])/5, 2) if len(highs) >= 5 else None
    support   = round(sum(lows[:5])/5, 2) if len(lows) >= 5 else None
    atrs = []
    for i in range(max(0, len(bars)-14), len(bars)):
        b = bars[i]
        if i == 0:
            atrs.append(b.get("h",0) - b.get("l",0))
        else:
            pc = bars[i-1].get("c", 0)
            atrs.append(max(b.get("h",0)-b.get("l",0),
                           abs(b.get("h",0)-pc), abs(b.get("l",0)-pc)))
    atr = round(sum(atrs)/len(atrs), 2) if atrs else None

    # ── Options IV ────────────────────────────────────────────────────────────
    opts      = options.get("results") or []
    atm_opts  = [o for o in opts if abs((o.get("details",{}).get("strike_price",0) or 0) - price) / max(price,1) < 0.05]
    avg_iv    = sum(o.get("greeks",{}).get("implied_volatility",0) or 0 for o in atm_opts) / max(len(atm_opts),1) if atm_opts else 0
    impl_move = round(avg_iv * (1/365)**0.5 * price, 2) if avg_iv > 0 else None
    impl_pct  = round(impl_move / price * 100, 2) if impl_move and price > 0 else None

    # ── News ──────────────────────────────────────────────────────────────────
    news_items = [{"headline": n.get("title"), "source": (n.get("publisher") or {}).get("name"),
                   "url": n.get("article_url"), "published": n.get("published_utc"),
                   "sentiment": (n.get("insights") or [{}])[0].get("sentiment","neutral"),
                   "summary": n.get("description")} for n in (news.get("results") or [])]

    # ── Earnings ──────────────────────────────────────────────────────────────
    earn_items = [{"quarter": e.get("quarter"), "year": e.get("year"),
                   "epsEst": e.get("eps",{}).get("estimate"),
                   "epsActual": e.get("eps",{}).get("actual"),
                   "surprisePct": e.get("eps",{}).get("surprisePercent")}
                  for e in (earnings.get("results") or [])]

    # ── Fundamentals ──────────────────────────────────────────────────────────
    d  = details.get("results") or {}
    fin_url = f"/vX/reference/financials"
    fin = await _get(fin_url, {"ticker": sym, "limit":1, "sort":"period_of_report_date", "order":"desc"})
    fin_r = (fin.get("results") or [{}])[0].get("financials") or {}
    inc   = fin_r.get("income_statement") or {}
    bs    = fin_r.get("balance_sheet") or {}

    result = {
        "symbol":        sym,
        "price":         price,
        "change":        change,
        "changePct":     chg_pct,
        "open":          float(day.get("o") or 0),
        "high":          float(day.get("h") or 0),
        "low":           float(day.get("l") or 0),
        "close":         float(day.get("c") or 0),
        "volume":        float(day.get("v") or 0),
        "vwap":          float(day.get("vw") or 0),
        "prevClose":     prev_cl,
        "avgVolume":     float((prev_day.get("v") or 0)),
        # Technicals
        "rsi14":         rsi_val,
        "macd":          macd_v.get("value"),
        "macdSignal":    macd_v.get("signal"),
        "macdHist":      macd_v.get("histogram"),
        "sma20":         sma20_v,
        "sma50":         sma50_v,
        "sma200":        sma200_v,
        "ema9":          ema9_v,
        # Levels
        "support":       support,
        "resistance":    resistance,
        "atr":           atr,
        # Options
        "impliedMovePct":   impl_pct,
        "impliedMoveDollar": impl_move,
        "avgIV":            round(avg_iv * 100, 2) if avg_iv else None,
        # News
        "news":          news_items,
        # Earnings
        "earningsHistory": earn_items,
        # Fundamentals
        "companyName":   d.get("name"),
        "description":   d.get("description"),
        "sector":        d.get("sic_description"),
        "marketCap":     d.get("market_cap"),
        "employees":     d.get("total_employees"),
        "homepage":      d.get("homepage_url"),
        "revenue":       (inc.get("revenues") or {}).get("value"),
        "netIncome":     (inc.get("net_income_loss") or {}).get("value"),
        "eps":           (inc.get("basic_earnings_per_share") or {}).get("value"),
        "totalAssets":   (bs.get("assets") or {}).get("value"),
        "totalLiabilities": (bs.get("liabilities") or {}).get("value"),
        "cached":        False,
    }

    # ── Cache result for 5 minutes ─────────────────────────────────────────────
    try:
        await asyncio.to_thread(db.save_stock_data_cache, sym, result, 300)
    except Exception:
        pass

    return result


# ── EDGAR / News / FDA — shared constants & helpers ───────────────────────────
#
# Forms covered by watchlist poller + on-demand endpoint:
#   8-K  items 1.01 1.02 1.03 2.01 2.02 5.02 7.01 8.01 — material events
#   SC 13D / SC 13G   — activist / institutional stake buildup
#   S-4               — merger registration
#   DEFR14A           — shareholder M&A vote proxy
#   10-Q / 10-K       — quarterly / annual financials
#
# FDA approvals: polled from openFDA drug approvals API every 30 min,
#   filtered to watchlist tickers by company name substring match.
#
# News: Polygon /v2/reference/news polled every 15 min per watchlist ticker,
#   deduped by article URL, pushed as news_alert SSE event.

_EDGAR_MATERIAL_8K = {"1.01","1.02","1.03","2.01","2.02","5.02","7.01","8.01"}
_EDGAR_ITEM_LABELS = {
    "1.01": "Material agreement signed",
    "1.02": "Agreement terminated",
    "1.03": "Bankruptcy / receivership",
    "2.01": "Asset acquisition or disposal",
    "2.02": "Earnings results released",
    "5.02": "CEO / CFO change",
    "7.01": "Reg FD disclosure",
    "8.01": "Other material event",
}
_EDGAR_FORM_LABELS = {
    "SC 13D":  "Activist stake — potential M&A",
    "SC 13G":  "Institutional stake",
    "S-4":     "Merger registration",
    "DEFR14A": "Shareholder M&A vote (proxy)",
    "10-Q":    "Quarterly financials (10-Q)",
    "10-K":    "Annual report (10-K)",
}
_EDGAR_UA = {"User-Agent": "NexRadar/1.0 contact@nexradar.info"}

async def _edgar_fetch_form(sym: str, form: str, startdt: str) -> list:
    """Fetch EDGAR EFTS hits for one ticker + one form. Returns list of raw hit dicts."""
    url = (
        f"https://efts.sec.gov/LATEST/search-index"
        f"?q=%22{sym}%22&forms={form}&dateRange=custom&startdt={startdt}"
    )
    try:
        async with httpx.AsyncClient(timeout=8, headers=_EDGAR_UA) as client:
            r = await client.get(url)
            r.raise_for_status()
            return r.json().get("hits", {}).get("hits", [])
    except Exception as e:
        logger.debug(f"EDGAR fetch {sym}/{form}: {e}")
        return []

def _edgar_build_alert(sym: str, form: str, hit: dict) -> dict:
    """Normalise a raw EDGAR hit into a structured edgar_alert SSE payload."""
    src        = hit.get("_source", {})
    items_str  = src.get("items", "")
    item_codes = {i.strip() for i in items_str.split(",")} if items_str else set()
    filed_at   = src.get("file_date", "")
    entity_id  = src.get("entity_id", "")
    accession  = hit.get("_id", "")
    acc_clean  = accession.replace("-", "")
    doc_url    = (
        f"https://www.sec.gov/Archives/edgar/data/{entity_id}/{acc_clean}/{accession}-index.htm"
        if entity_id and accession else ""
    )
    if form == "8-K":
        matched = item_codes & _EDGAR_MATERIAL_8K
        title   = "8-K Filing · Item " + ", ".join(sorted(matched)) if matched else "8-K Filing"
        sub     = " · ".join(_EDGAR_ITEM_LABELS.get(c, c) for c in sorted(matched)) if matched else items_str
        emoji   = "⚠️" if "5.02" in matched else "📋"
        color   = "gold" if "5.02" in matched or "2.01" in matched else "cyan"
    elif form in ("10-Q", "10-K"):
        title   = _EDGAR_FORM_LABELS[form]
        sub     = f"Period: {src.get('period_of_report', filed_at)}"
        emoji   = "📊"
        color   = "cyan"
    else:
        title   = _EDGAR_FORM_LABELS.get(form, form)
        sub     = f"Filed {filed_at}"
        emoji   = "🚨" if form in ("SC 13D", "S-4") else "📋"
        color   = "gold" if form in ("SC 13D", "S-4", "DEFR14A") else "cyan"
    return {
        "type":      "edgar_alert",
        "ticker":    sym,
        "form":      form,
        "items":     items_str,
        "title":     title,
        "sub":       sub,
        "filed_at":  filed_at,
        "url":       doc_url,
        "accession": accession,
        "emoji":     emoji,
        "color":     color,
    }


# ── EDGAR on-demand proxy (user click + background poller) ─────────────────────
@app.get("/api/edgar/{symbol}")
async def edgar_proxy(symbol: str, days: int = Query(default=7, le=90)):
    """
    On-demand EDGAR lookup for all material forms.
    days=7 default covers last week. Frontend passes days=30 for chart deep-history.
    Also used by _edgar_watchlist_loop internally via _edgar_fetch_form().
    """
    sym     = symbol.upper().strip()
    startdt = (date.today() - timedelta(days=days)).isoformat()
    forms   = ["8-K", "SC 13D", "SC 13G", "S-4", "DEFR14A", "10-Q", "10-K"]
    alerts  = []
    for form in forms:
        raw_hits = await _edgar_fetch_form(sym, form, startdt)
        for hit in raw_hits:
            items_str  = hit.get("_source", {}).get("items", "")
            item_codes = {i.strip() for i in items_str.split(",")} if items_str else set()
            if form == "8-K" and not (item_codes & _EDGAR_MATERIAL_8K):
                continue
            alerts.append(_edgar_build_alert(sym, form, hit))
    return {"alerts": alerts, "ticker": sym, "days": days, "count": len(alerts)}


# ── Sequence Gap Recovery ──────────────────────────────────────────────────────
# Client calls this when it detects a seq gap < 30s old.
# Returns the missed batches from the in-memory replay buffer.
# If gap > 30s or buffer doesn't cover the range, client should reconnect
# (sseWorker handles this automatically via client_ts handshake).
@app.get("/api/replay")
async def get_replay(from_seq: int = Query(...), to_seq: int = Query(...)):
    if not broadcaster:
        raise HTTPException(status_code=503, detail="Broadcaster not ready")
    gap = to_seq - from_seq
    if gap > 300:
        # Too large — cheaper to send fresh snapshot via reconnect
        return {"ok": False, "reason": "gap_too_large", "gap": gap}
    messages = broadcaster.get_replay(from_seq, to_seq)
    if not messages:
        return {"ok": False, "reason": "not_in_buffer"}
    return {"ok": True, "from_seq": from_seq, "to_seq": to_seq,
            "count": len(messages), "messages": messages}

# ── Debug: Sector Map ──────────────────────────────────────────────────────────
@app.get("/api/debug/sectors")
async def debug_sectors():
    snap_map = broadcaster.get_snapshot_map() if broadcaster else {}
    data     = list(snap_map.values())
    sector_counts: dict = {}
    sector_samples: dict = {}
    for row in data:
        s = row.get("sector", "Unknown")
        sector_counts[s] = sector_counts.get(s, 0) + 1
        if s not in sector_samples:
            sector_samples[s] = []
        if len(sector_samples[s]) < 5:
            sector_samples[s].append(row["ticker"])
    return {"total_tickers": len(data), "sector_counts": sector_counts,
            "sector_samples": sector_samples,
            "sse_clients": broadcaster.client_count if broadcaster else 0}
