"""
ingestor.py — NexRadar Pro
===========================
Standalone Polygon WebSocket ingestor.  Runs as a separate Render service
(or background worker) from main.py.

Responsibilities:
  1. Connect to Polygon WebSocket (T.* + A.* for all tickers)
  2. Process every tick through WSEngine._update_alert_cache_logic()
  3. Batch processed tick payloads → Redis Stream  (XADD live_prices)
  4. Own all background threads: historical fetch, portfolio refresh,
     session reset, AH close refresh, DB writer

NOT responsible for:
  • Serving HTTP requests (that's main.py)
  • Broadcasting to SSE clients (that's main.py)

Redis keys written by this process:
  live_prices              Stream  MAXLEN~2000 — ephemeral tick feed
  nexradar:snapshot        String  no-TTL      — latest full snapshot JSON
  nexradar:watchlist_cmds  PubSub channel      — receives watchlist commands
                                                 from main.py (add/remove)

FIXES IN THIS VERSION:
  BUG-4  Event Loop Gridlock (sync redis blocked asyncio loop)
         OLD: import redis (sync) + r.xadd() inside an async coroutine
              blocked the loop 1–5ms per tick → queue backlog → RAM bloat.
         FIX: import redis.asyncio; every Redis write is await-ed.

  BUG-1  Ephemeral Snapshot (snapshot evicted from stream in <60s)
         OLD: snapshot pushed only to the capped stream; 2000 ticks during
              market hours fill the stream in <60s, evicting the snapshot.
         FIX: _redis_broadcast() also calls await _redis.set(SNAPSHOT_KEY)
              on every snapshot payload — persistent, no TTL.

  BUG-2  Deaf Signal Engine (ingestor blind to watchlist changes)
         OLD: main.py wrote to DB; ingestor never knew about the change;
              new starred tickers never received Scalp signals until restart.
         FIX: _watchlist_cmd_listener() subscribes to nexradar:watchlist_cmds
              and calls engine._signal_watcher.set_watchlist() live.

  REDIS-RESILIENCY  Connection retry + TLS support
         OLD: _init_redis() called aioredis.from_url() once; any startup
              failure (Redis not ready, network blip) crashed the process.
         FIX: _init_redis_with_retry() retries up to MAX_REDIS_RETRIES times
              with linear back-off (2s, 4s, 6s …).  Also detects rediss://
              (TLS — used by Render's external Redis URL) and disables
              certificate verification so self-signed certs don't block
              connection (ssl_cert_reqs=None).  Internal redis:// URLs use
              the default (no TLS, no cert check needed).

Render start command:  python backend/ingestor.py
Env vars: MASSIVE_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY, REDIS_URL
"""
import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
from pathlib import Path
load_dotenv(Path(__file__).parent.parent / ".env")

import os
import sys
import time
import logging

sys.path.insert(0, str(Path(__file__).parent.parent))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

import asyncio as _asyncio
import redis.asyncio as aioredis   # BUG-4 FIX: async client — never blocks event loop
import orjson

try:
    from backend.supabase_db import SupabaseDB
    from backend.ws_engine   import WSEngine
except ModuleNotFoundError:
    from supabase_db import SupabaseDB
    from ws_engine   import WSEngine


# ── Redis config ──────────────────────────────────────────────────────────────

REDIS_URL         = os.getenv("REDIS_URL", "redis://localhost:6379")
STREAM_KEY         = "live_prices"
STREAM_MAXLEN      = 1000
SNAPSHOT_KEY       = "nexradar:snapshot"        # BUG-1: persistent snapshot key
WATCHLIST_CHANNEL  = "nexradar:watchlist_cmds"  # BUG-2: pub/sub channel
SCALP_SNAPSHOT_KEY = "nexradar:scalp_snapshot"  # in-memory signal engine → main.py
SCALP_PUSH_TTL     = 120                        # 2-min TTL; pusher fires every 10 s

# Single async Redis client — created once inside the running event loop
_redis: aioredis.Redis = None  # type: ignore

# Reference to the running WSEngine so the pub/sub listener can call
# engine._signal_watcher.set_watchlist() without a restart (BUG-2)
_engine_ref: "WSEngine | None" = None  # type: ignore


# ── Redis initialisation with retry + TLS support ────────────────────────────

MAX_REDIS_RETRIES = 5   # give up after this many attempts
_REDIS_BASE_WAIT  = 2   # seconds — attempt N waits N×2s (2, 4, 6, 8, 10)


async def _init_redis_with_retry() -> None:
    """
    REDIS-RESILIENCY FIX: replaces the single-shot _init_redis().

    Two improvements over the bare aioredis.from_url() call:

    1. TLS detection
       Render's *internal* Redis URL starts with redis:// (plain TCP, no TLS).
       The *external* URL (used in local dev via REDIS_URL env var pointing at
       the Render Redis instance) starts with rediss:// (TLS).
       Standard ssl_cert_reqs="required" rejects Render's self-signed cert,
       causing an SSL handshake failure.  We set ssl_cert_reqs=None for
       rediss:// connections so the cert is accepted without verification.
       Internal redis:// connections skip the ssl argument entirely.

    2. Exponential back-off retry
       Render starts the web service and the ingestor subprocess almost
       simultaneously.  Redis may not be ready for 2–10 seconds.  Without
       retries a timing blip crashes the ingestor immediately, leaving the
       dashboard with no live data until the next Render restart.
       We retry MAX_REDIS_RETRIES times with a linearly increasing wait
       (2s, 4s, 6s, 8s, 10s) before giving up and raising SystemExit.
    """
    global _redis

    is_tls = REDIS_URL.startswith("rediss://")

    for attempt in range(1, MAX_REDIS_RETRIES + 1):
        try:
            kwargs: dict = dict(
                decode_responses=False,   # we handle bytes via orjson
                socket_connect_timeout=10,
                socket_timeout=10,
                socket_keepalive=True,    # detect stale connections early
                retry_on_timeout=True,    # auto-retry transient timeouts
            )
            if is_tls:
                # rediss:// — TLS required, but Render uses self-signed certs
                kwargs["ssl_cert_reqs"] = None  # skip cert verification

            client = aioredis.from_url(REDIS_URL, **kwargs)
            await client.ping()

            _redis = client
            proto  = "External/TLS (rediss://)" if is_tls else "Internal (redis://)"
            logger.info(f"✅ Redis connected [{proto}]  attempt {attempt}/{MAX_REDIS_RETRIES}")
            return

        except Exception as exc:
            wait = attempt * _REDIS_BASE_WAIT
            if attempt < MAX_REDIS_RETRIES:
                logger.warning(
                    f"⚠️  Redis connection failed "
                    f"(attempt {attempt}/{MAX_REDIS_RETRIES}): {exc}"
                )
                logger.info(f"🔄 Retrying in {wait}s …")
                await _asyncio.sleep(wait)
            else:
                logger.error(
                    f"❌ Redis unreachable after {MAX_REDIS_RETRIES} attempts. "
                    f"Last error: {exc}"
                )
                raise SystemExit(1) from exc


# ── BUG-4 FIX: fully async broadcast callback ─────────────────────────────────
# WSEngine calls this via asyncio.run_coroutine_threadsafe(coro, loop).
# Every Redis I/O is now awaited — the event loop is never blocked.

async def _redis_broadcast(payload: dict) -> None:
    """
    BUG-4/REDIS-TYPE FIX: Ensures payload is a string to avoid encoding errors.
    BUG-1 FIX: Persists the latest snapshot to a dedicated key.
    """
    if _redis is None:
        return
    try:
        # BUG FIX: Convert bytes to string. Many Redis clients struggle 
        # with bytes-in-dict if not configured for raw binary.
        raw_bytes = orjson.dumps(payload)
        raw_str   = raw_bytes.decode("utf-8")

        await _redis.xadd(
            STREAM_KEY,
            {"data": raw_str},
            maxlen=STREAM_MAXLEN,
            approximate=True,
        )
        
        if payload.get("type") == "snapshot":
            await _redis.set(SNAPSHOT_KEY, raw_str)
            
    except Exception as e:
        logger.warning(f"Redis publish failed (dropping): {e}")


# ── BUG-2 FIX: watchlist pub/sub listener ────────────────────────────────────

async def _scalp_snapshot_pusher() -> None:
    """
    Every 10 s: read the in-memory ScalpingSignalEngine snapshot and write it
    to nexradar:scalp_snapshot in Redis so main.py can serve it via
    GET /api/scalp-analysis without any Supabase round-trip.

    Why 10 s?  The frontend polls every 30 s.  Pushing every 10 s means data is
    always < 10 s stale when the browser polls — fast enough for signal alerting.
    """
    PUSH_INTERVAL = 10  # seconds

    while True:
        await asyncio.sleep(PUSH_INTERVAL)
        if _redis is None or _engine_ref is None:
            continue
        try:
            sig_watcher = _engine_ref._signal_watcher
            if sig_watcher is None:
                continue
            watched = list(getattr(sig_watcher, "_watched", set()) or set())
            if not watched:
                continue
            rows    = sig_watcher.get_scalp_snapshot(watched)
            payload = orjson.dumps({"data": rows, "ts": int(__import__("time").time())})
            await _redis.set(SCALP_SNAPSHOT_KEY, payload, ex=SCALP_PUSH_TTL)
        except Exception as exc:
            logger.debug(f"Scalp snapshot push: {exc}")


async def _watchlist_cmd_listener() -> None:
    """
    Listens on the nexradar:watchlist_cmds Pub/Sub channel.
    Refreshes the signal watcher watchlist from Supabase whenever a change is detected.
    """
    # 1. Build kwargs mirroring connection resiliency for TLS support
    _is_tls = REDIS_URL.startswith("rediss://")
    _pubsub_kwargs: dict = dict(
        decode_responses=False,    # orjson handles bytes directly
        socket_connect_timeout=10,
        socket_timeout=None,       # block indefinitely while listening
        socket_keepalive=True,
    )
    if _is_tls:
        _pubsub_kwargs["ssl_cert_reqs"] = None

    pubsub_client = aioredis.from_url(REDIS_URL, **_pubsub_kwargs)
    pubsub = pubsub_client.pubsub(ignore_subscribe_messages=True)
    await pubsub.subscribe(WATCHLIST_CHANNEL)
    logger.info(f"✅ Pub/Sub listening on '{WATCHLIST_CHANNEL}'")

    try:
        async for message in pubsub.listen():
            if message is None or "data" not in message:
                continue
            try:
                # Use orjson for high-performance byte-decoding
                cmd = orjson.loads(message["data"])
            except Exception:
                continue

            action = cmd.get("action", "") 
            ticker = cmd.get("ticker", "").upper()
            logger.info(f"Watchlist cmd received: action={action} ticker={ticker}")

            # Safety check for the global engine reference
            if _engine_ref is None or _engine_ref._signal_watcher is None:
                continue

            try:
                # 2. Re-read canonical watchlist from Supabase
                # Creating a local instance ensures we don't hold a stale session
                from backend.supabase_db import SupabaseDB
                db = SupabaseDB()
                rows = db.get_signal_watchlist()
                
                # Extract ticker strings
                watchlist = [r["ticker"] for r in rows if r.get("ticker")]
                
                # 3. Push the new list to the watcher
                _engine_ref._signal_watcher.set_watchlist(watchlist)
                logger.info(f"Signal watcher refreshed: {len(watchlist)} tickers active")
                
            except Exception as exc:
                logger.warning(f"Watchlist refresh error: {exc}")
                
    except Exception as exc:
        logger.warning(f"Pub/Sub listener crashed: {exc}")
  # ingestor.py — Updated cleanup logic for _watchlist_cmd_listener
    finally:
        try:
            # Unsubscribe first
            await pubsub.unsubscribe(WATCHLIST_CHANNEL)
            # Create a separate task for closing to ensure it's tracked
            await pubsub_client.aclose()
            logger.info("✅ Watchlist listener cleaned up.")
        except Exception as e:
            # Suppress errors during shutdown to prevent loop crashes
            logger.debug(f"Cleanup suppressed: {e}")

# ── Event loop helper ─────────────────────────────────────────────────────────

_ingestor_loop: _asyncio.AbstractEventLoop = None  # type: ignore


def _get_loop() -> _asyncio.AbstractEventLoop:
    global _ingestor_loop
    if _ingestor_loop is None or _ingestor_loop.is_closed():
        _ingestor_loop = _asyncio.new_event_loop()
    return _ingestor_loop


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    logger.info("🚀 NexRadar ingestor starting …")

    loop = _get_loop()

    # REDIS-RESILIENCY FIX: retry with TLS detection instead of single-shot init
    loop.run_until_complete(_init_redis_with_retry())

    # Create the consumer group once (idempotent)
    async def _ensure_group():
        try:
            await _redis.xgroup_create(STREAM_KEY, "nexradar_sse", id="$", mkstream=True)
            logger.info("Redis Stream group 'nexradar_sse' created")
        except aioredis.ResponseError as exc:
            if "BUSYGROUP" in str(exc):
                logger.info("Redis Stream group 'nexradar_sse' already exists — OK")
            else:
                logger.warning(f"XGROUP CREATE: {exc}")

    loop.run_until_complete(_ensure_group())

    db  = SupabaseDB()
    engine = WSEngine(broadcast_cb=_redis_broadcast, loop=loop)

    # BUG-2 FIX: store engine ref so the pub/sub listener can reach signal_watcher
    global _engine_ref
    _engine_ref = engine

    tickers, company_map, sector_map = db.get_stock_meta()
    if not tickers:
        logger.warning("No tickers in stock_list — run migrate_all.py first.")
    else:
        logger.info(f"Loaded {len(tickers)} tickers")
        engine.start(tickers, company_map, sector_map)

    # BUG-2/CLEANUP FIX: Track the task reference for proper shutdown
    watchlist_task  = loop.create_task(_watchlist_cmd_listener())
    scalp_push_task = loop.create_task(_scalp_snapshot_pusher())
    logger.info("Scalp snapshot pusher started (10 s interval → nexradar:scalp_snapshot)")
    logger.info("Watchlist pub/sub listener task started")

    logger.info("Ingestor running — Ctrl-C to stop")

    try:
        loop.run_forever()
    except KeyboardInterrupt:
        logger.info("KeyboardInterrupt — shutting down …")
    finally:
        # CLEANUP FIX: Stop the background task before closing the loop
        watchlist_task.cancel()
        scalp_push_task.cancel()
        
        engine.shutdown()
        
        if _redis:
            try:
                loop.run_until_complete(_redis.aclose())
            except Exception:
                pass
                
        # Give the cancelled task a moment to finish its 'finally' block
        try:
            loop.run_until_complete(watchlist_task)
        except _asyncio.CancelledError:
            pass
            
        loop.close()
        logger.info("Ingestor stopped.")


if __name__ == "__main__":
    main()