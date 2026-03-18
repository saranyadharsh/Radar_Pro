# run.py — NexRadar Pro local dev launcher
# Usage:  python run.py
#
# ── THE REAL ROOT CAUSE (why loop="asyncio" still crashed) ───────────────────
#
# Uvicorn's internal asyncio_setup() function explicitly FORCES the wrong policy:
#
#   # uvicorn/loops/asyncio.py
#   def asyncio_setup(use_subprocess: bool = False) -> None:
#       if sys.platform == "win32" and use_subprocess:
#           asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
#
# Because RELOAD=True means use_subprocess=True, Uvicorn calls this function
# and forcibly sets WindowsSelectorEventLoopPolicy right before your app loads —
# overriding everything we set in the parent process.
# WindowsSelectorEventLoopPolicy → SelectorEventLoop → 512 FD hard ceiling →
# ValueError: too many file descriptors in select()
#
# ── THE CORRECT PERMANENT FIX ────────────────────────────────────────────────
#
# Don't fight Uvicorn's subprocess path at all. Remove --reload entirely.
#
# With RELOAD=False:
#   - Uvicorn runs as a SINGLE process (no SpawnProcess workers)
#   - asyncio_setup() is called with use_subprocess=False
#   - The WindowsSelectorEventLoopPolicy branch is NEVER entered
#   - Our WindowsProactorEventLoopPolicy set below takes full effect
#   - No FD ceiling. No crash. Ever.
#
# For local development without auto-reload: save your file, then Ctrl+C
# and re-run `python run.py`. Takes ~2s. Much faster than debugging crashes.
#
# If you need auto-reload, use WSL2 instead — identical to Render, no FD issues.
#
# ─────────────────────────────────────────────────────────────────────────────

import sys
import uvicorn

if sys.platform == "win32":
    import asyncio
    # Set ProactorEventLoop BEFORE uvicorn.run() is called.
    # With RELOAD=False (single process), this policy is respected because
    # asyncio_setup(use_subprocess=False) does NOT override it on Windows.
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    print("[run.py] Windows: ProactorEventLoop policy set (IOCP, no FD limit)")

if __name__ == "__main__":
    uvicorn.run(
        "backend.main:app",
        host="0.0.0.0",
        port=8000,
        # RELOAD=False is the permanent fix for Windows.
        # Uvicorn's asyncio_setup() explicitly forces WindowsSelectorEventLoopPolicy
        # when use_subprocess=True (i.e. reload=True), overriding everything else.
        # With reload=False: single process, no subprocess spawning,
        # ProactorEventLoop policy above takes full effect, zero FD ceiling.
        reload=False,
        # Keep loop="asyncio" as a belt-and-suspenders measure — it nudges
        # Uvicorn's Config to use asyncio.new_event_loop as factory, which on
        # Windows returns ProactorEventLoop by default since Python 3.8.
        loop="asyncio",
    )
