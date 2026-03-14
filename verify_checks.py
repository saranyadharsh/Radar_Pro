import subprocess, sys
checks = [
("backend/main.py",                                                    "from fastapi import FastAPI, HTTPException, Query, Request"),
("backend/main.py",                                                    "broadcast_cb=broadcaster.publish, loop=loop"),
("backend/main.py",                                                    "async def _refresh_signal_watcher():"),
("backend/main.py",                                                    "app.state.alerts_engine.stop()"),
("backend/main.py",                                                    "rows    = await asyncio.to_thread(db.get_signal_watchlist)"),
("backend/ws_engine.py",                                               "AH_CLOSE_REFRESH_S   = 300"),
("backend/ws_engine.py",                                               "def set_watchlist_tickers(self, tickers"),
("backend/ws_engine.py",                                               "self._pending_ticks: deque = deque(maxlen=5000)"),
("backend/ws_engine.py",                                               "is_halted      = updated.get(\"is_halted\", False)"),
("backend/Scalping_Signal.py",                                         "def __init__(self, engine: \"ScalpingSignalEngine\", broadcast_cb=None, loop=None):"),
("backend/Scalping_Signal.py",                                         "asyncio.run_coroutine_threadsafe(coro, self._loop)"),
("frontend/src/components/AlertToast.jsx",                    "`${a.ts}_${a.type}_${a.ticker}`"),
("frontend/src/components/nexradar/PageLiveTable.jsx",                 "noiBySymRef     = useRef({})"),
("frontend/src/components/nexradar/PageLiveTable.jsx",                 "noiBySymRef.current[ticker] = { imbalance_side, imbalance_size }"),
("frontend/src/components/nexradar/useTickerData.js",                  "type:   'luld_halt'"),
("frontend/src/components/nexradar/useTickerData.js",                  "timeZone: \"America/New_York\""),
("frontend/src/components/NexRadarDashboard.jsx",                      "value:'250ms'"),
("frontend/src/components/NexRadarDashboard.jsx",                      "value:'300s'"),
]
absent = [
("backend/ws_engine.py",        "from pyexpat.errors import messages"),
("backend/ws_engine.py",        "from curses import raw"),
("backend/Scalping_Signal.py",  "import subprocess"),
]
ok = err = 0
for path, pat in checks:
    src = open(path, encoding='utf-8').read()
    if pat in src: ok += 1; print(f"✅  {path.split('/')[-1]}: {pat[:60]}")
    else:          err += 1; print(f"❌  {path.split('/')[-1]}: MISSING — {pat[:60]}")
for path, pat in absent:
    src = open(path, encoding='utf-8').read()
    if pat not in src: ok += 1; print(f"✅  {path.split('/')[-1]}: CORRECTLY ABSENT — {pat[:50]}")
    else:              err += 1; print(f"❌  {path.split('/')[-1]}: STILL PRESENT (should be removed) — {pat[:50]}")
print(f"\n{'='*55}\n  {ok}/{ok+err} checks passed {'✅ ALL GOOD' if not err else f'❌ {err} FAILURES'}\n{'='*55}")
