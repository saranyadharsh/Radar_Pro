#!/usr/bin/env bash
# ============================================================
#  NexRadar Dev — 15-Fix Regression Verification Script
#  Run from your project root:  bash verify_fixes.sh
# ============================================================

PASS=0
FAIL=0
WARN=0

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

pass() { echo -e "  ${GREEN}✅ PASS${RESET}  $1"; ((PASS++)); }
fail() { echo -e "  ${RED}❌ FAIL${RESET}  $1"; ((FAIL++)); }
warn() { echo -e "  ${YELLOW}⚠️  WARN${RESET}  $1"; ((WARN++)); }
header() { echo -e "\n${CYAN}${BOLD}$1${RESET}"; }

echo ""
echo -e "${BOLD}============================================================${RESET}"
echo -e "${BOLD}  NexRadar Dev — 15-Fix Verification Report${RESET}"
echo -e "${BOLD}============================================================${RESET}"

# ── File existence check ────────────────────────────────────
header "[ PRE-CHECK ] Required files present"

FILES=(
  "backend/main.py"
  "backend/Scalping_Signal.py"
  "backend/ws_engine.py"
  "frontend/src/components/AlertToast.jsx"
  "frontend/src/components/nexradar/PageLiveTable.jsx"
  "frontend/src/components/nexradar/PageScanner.jsx"
  "frontend/src/components/NexRadarDashboard.jsx"
  "frontend/src/components/nexradar/useTickerData.js"
  "frontend/src/components/nexradar/theme.js"
)

ALL_PRESENT=true
for f in "${FILES[@]}"; do
  if [ -f "$f" ]; then
    pass "$f exists"
  else
    fail "$f NOT FOUND"
    ALL_PRESENT=false
  fi
done

if [ "$ALL_PRESENT" = false ]; then
  echo -e "\n${RED}One or more required files are missing. Check your project root.${RESET}"
  echo -e "Expected layout:  backend/  and  frontend/src/\n"
fi

# ── BUG-01 ─────────────────────────────────────────────────
header "[ BUG-01 🔴 CRITICAL ] HTTPException at module-level import in main.py"
if grep -q "from fastapi import.*HTTPException" backend/main.py 2>/dev/null; then
  pass "HTTPException found in fastapi import line"
else
  fail "HTTPException NOT in module-level fastapi import — /api/mtf-scanner will crash on any exception"
fi

# ── BUG-02 ─────────────────────────────────────────────────
header "[ BUG-02 🔴 CRITICAL ] SmartAlertsEngine async broadcast fix"
if grep -q "run_coroutine_threadsafe" backend/Scalping_Signal.py 2>/dev/null; then
  pass "run_coroutine_threadsafe found in Scalping_Signal.py"
else
  fail "run_coroutine_threadsafe NOT found — Smart Alerts will silently never broadcast"
fi

if grep -q "loop=" backend/main.py 2>/dev/null; then
  pass "loop= parameter found when wiring SmartAlertsEngine in main.py"
else
  warn "loop= not detected in main.py — confirm SmartAlertsEngine receives event loop at init"
fi

# ── BUG-03 ─────────────────────────────────────────────────
header "[ BUG-03 🔴 CRITICAL ] SmartAlertsEngine stopped on server shutdown"
if grep -q "alerts_engine\.stop" backend/main.py 2>/dev/null; then
  pass "alerts_engine.stop() found in main.py lifespan teardown"
else
  fail "alerts_engine.stop() NOT found — daemon thread keeps running after SIGTERM (30s shutdown hang)"
fi

# ── BUG-04 ─────────────────────────────────────────────────
header "[ BUG-04 🟠 HIGH ] Dead pyexpat import removed from ws_engine.py"
if grep -q "from pyexpat.errors import messages" backend/ws_engine.py 2>/dev/null; then
  fail "pyexpat import STILL PRESENT — shadows 'messages' local variable in _on_message"
else
  pass "pyexpat dead import not found (correctly removed)"
fi

# ── BUG-05 ─────────────────────────────────────────────────
header "[ BUG-05 🟠 HIGH ] Dead curses.raw import removed from ws_engine.py"
if grep -q "from curses import raw" backend/ws_engine.py 2>/dev/null; then
  fail "curses.raw import STILL PRESENT — dead import, confusingly named 'raw'"
else
  pass "curses.raw dead import not found (correctly removed)"
fi

# ── BUG-06 ─────────────────────────────────────────────────
header "[ BUG-06 🟠 HIGH ] Async handlers use asyncio.to_thread for Supabase calls"
COUNT=$(grep -c "asyncio\.to_thread" backend/main.py 2>/dev/null || echo 0)
if [ "$COUNT" -ge 3 ]; then
  pass "asyncio.to_thread found $COUNT times in main.py (expected ≥3)"
else
  fail "asyncio.to_thread found only $COUNT times — some sync Supabase calls still blocking event loop (expected ≥3)"
fi

# ── BUG-07 ─────────────────────────────────────────────────
header "[ BUG-07 🟠 HIGH ] _refresh_ah_closes scoped to watchlist + interval ≥ 300s"
if grep -q "AH_CLOSE_REFRESH_S\s*=\s*[3-9][0-9][0-9]" backend/ws_engine.py 2>/dev/null; then
  pass "AH_CLOSE_REFRESH_S is ≥300s"
else
  # Try to extract actual value
  VAL=$(grep "AH_CLOSE_REFRESH_S" backend/ws_engine.py 2>/dev/null | head -1)
  if [ -n "$VAL" ]; then
    fail "AH_CLOSE_REFRESH_S still set to low value: $VAL (should be ≥300)"
  else
    warn "AH_CLOSE_REFRESH_S not found — check ws_engine.py manually"
  fi
fi

# ── BUG-08 ─────────────────────────────────────────────────
header "[ BUG-08 🟠 HIGH ] Double _cache_lock acquisition eliminated in _handle_tick"
LOCK_COUNT=$(grep -c "_cache_lock" backend/ws_engine.py 2>/dev/null || echo 0)
if [ "$LOCK_COUNT" -le 6 ]; then
  pass "_cache_lock acquisition count looks correct ($LOCK_COUNT occurrences)"
else
  warn "_cache_lock appears $LOCK_COUNT times — verify _handle_tick doesn't acquire twice in same call"
fi

# ── BUG-09 ─────────────────────────────────────────────────
header "[ BUG-09 🟠 HIGH ] AlertToast unique React key (ts + type + ticker)"
if grep -qE "key=\{.*a\.ts.*a\.type|key=\{.*ts.*type.*ticker" frontend/src/components/AlertToast.jsx 2>/dev/null; then
  pass "AlertToast uses composite key (ts + type / ticker)"
else
  if grep -q "key={a\.ts}" frontend/src/components/AlertToast.jsx 2>/dev/null; then
    fail "AlertToast still uses key={a.ts} alone — simultaneous alerts will silently drop"
  else
    warn "AlertToast key pattern unclear — manually verify it's not just key={a.ts}"
  fi
fi

# ── BUG-10 ─────────────────────────────────────────────────
header "[ BUG-10 🟡 MEDIUM ] noiBySym uses useRef instead of spread-copy on every event"
if grep -q "noiBySymRef" frontend/src/components/PageLiveTable.jsx 2>/dev/null; then
  pass "noiBySymRef (useRef pattern) found in PageLiveTable.jsx"
else
  if grep -q "setNoiBySym.*prev.*\.\.\." frontend/src/components/PageLiveTable.jsx 2>/dev/null; then
    fail "setNoiBySym still uses spread {...prev} — full object copy on every NOI SSE event"
  else
    warn "noiBySym pattern unclear — manually verify ref-based flush approach is in place"
  fi
fi

# ── BUG-11 ─────────────────────────────────────────────────
header "[ BUG-11 🟡 MEDIUM ] _pending_ticks uses deque(maxlen=5000)"
if grep -q "deque(maxlen=5000)" backend/ws_engine.py 2>/dev/null; then
  pass "deque(maxlen=5000) found for _pending_ticks in ws_engine.py"
else
  if grep -q "_pending_ticks\s*=\s*\[\]" backend/ws_engine.py 2>/dev/null; then
    fail "_pending_ticks still initialized as plain list — 2.5MB copy under lock on every cap hit"
  else
    warn "_pending_ticks initialization pattern unclear — verify deque is used"
  fi
fi

# ── BUG-12 ─────────────────────────────────────────────────
header "[ BUG-12 🟡 MEDIUM ] Halt notif type prefixed to avoid ticker name collision"
if grep -qE "luld_halt|luld_resume" frontend/src/hooks/useTickerData.js 2>/dev/null; then
  pass "luld_halt / luld_resume prefixed types found in useTickerData.js"
else
  if grep -qE "type: 'halt'|type: \"halt\"" frontend/src/hooks/useTickerData.js 2>/dev/null; then
    fail "Halt notif type is still plain 'halt' — can collide with ticker named HALT"
  else
    warn "Halt notif type unclear — check useTickerData.js manually"
  fi
fi

# ── BUG-13 ─────────────────────────────────────────────────
header "[ BUG-13 🟡 MEDIUM ] Settings panel shows correct constant values"
if grep -q "250ms\|250 ms" frontend/src/components/NexRadarDashboard.jsx 2>/dev/null; then
  pass "Broadcast throttle shows 250ms (correct) in Settings panel"
else
  if grep -q "350ms\|350 ms" frontend/src/components/NexRadarDashboard.jsx 2>/dev/null; then
    fail "Settings still shows 350ms broadcast throttle (should be 250ms)"
  else
    warn "Broadcast throttle value not found — verify Settings panel manually"
  fi
fi

if grep -q "300s\|300 s" frontend/src/components/NexRadarDashboard.jsx 2>/dev/null; then
  pass "AH Close Refresh shows 300s (correct) in Settings panel"
else
  if grep -q "120s\|120 s" frontend/src/components/NexRadarDashboard.jsx 2>/dev/null; then
    fail "Settings still shows 120s AH refresh (should be 300s)"
  else
    warn "AH close refresh value not found — verify Settings panel manually"
  fi
fi

# ── BUG-14 ─────────────────────────────────────────────────
header "[ BUG-14 🟢 LOW ] scheduleMidnight uses ET timezone (America/New_York)"
if grep -q "America/New_York" frontend/src/hooks/useTickerData.js 2>/dev/null; then
  pass "America/New_York timezone found in useTickerData.js scheduleMidnight"
else
  fail "America/New_York NOT found — scheduleMidnight fires at local browser time, not ET (fires 2hrs late in Denver/MT)"
fi

# ── BUG-15 ─────────────────────────────────────────────────
header "[ BUG-15 🟢 LOW ] Dead subprocess import removed from Scalping_Signal.py"
if grep -q "^import subprocess" backend/Scalping_Signal.py 2>/dev/null; then
  fail "import subprocess STILL PRESENT — dead Streamlit-era import"
else
  pass "import subprocess not found (correctly removed)"
fi

# ── Feature presence checks ─────────────────────────────────
header "[ FEATURES ] Core feature markers"

grep -q "SmartAlertsEngine" backend/Scalping_Signal.py 2>/dev/null \
  && pass "SmartAlertsEngine class present in Scalping_Signal.py" \
  || fail "SmartAlertsEngine NOT found in Scalping_Signal.py"

grep -q "get_mtf_snapshot\|get_mtf_indicators" backend/Scalping_Signal.py 2>/dev/null \
  && pass "MTF methods (get_mtf_snapshot / get_mtf_indicators) present" \
  || fail "MTF methods NOT found in Scalping_Signal.py"

grep -q "/api/mtf-scanner" backend/main.py 2>/dev/null \
  && pass "/api/mtf-scanner endpoint present in main.py" \
  || fail "/api/mtf-scanner endpoint NOT found in main.py"

grep -q "/api/alerts" backend/main.py 2>/dev/null \
  && pass "/api/alerts endpoint present in main.py" \
  || fail "/api/alerts endpoint NOT found in main.py"

grep -q "_handle_advanced_indicators\|halt_alert" backend/ws_engine.py 2>/dev/null \
  && pass "LULD halt detection (_handle_advanced_indicators / halt_alert) present in ws_engine.py" \
  || fail "LULD halt detection NOT found in ws_engine.py"

grep -q "halt.alert\|nexradar_halt" frontend/src/hooks/useTickerData.js 2>/dev/null \
  && pass "halt_alert SSE handler present in useTickerData.js" \
  || fail "halt_alert SSE handler NOT found in useTickerData.js"

grep -q "AlertToast\|AlertHistoryPanel" frontend/src/components/AlertToast.jsx 2>/dev/null \
  && pass "AlertToast component present" \
  || fail "AlertToast component NOT found"

grep -q "isMobile\|mobile-tabbar\|mobileDrawer" frontend/src/components/NexRadarDashboard.jsx 2>/dev/null \
  && pass "Mobile nav (isMobile / mobile-tabbar) present in NexRadarDashboard.jsx" \
  || fail "Mobile nav NOT found in NexRadarDashboard.jsx"

grep -q "haltPulse\|halt-badge\|noi-bar" frontend/src/theme.js 2>/dev/null \
  && pass "Halt/NOI CSS (haltPulse / halt-badge / noi-bar) present in theme.js" \
  || fail "Halt/NOI CSS NOT found in theme.js"

# ── Git status ──────────────────────────────────────────────
header "[ GIT ] Repo status"
if git -C . rev-parse --is-inside-work-tree &>/dev/null; then
  BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
  LAST_COMMIT=$(git log --oneline -1 2>/dev/null)
  UNCOMMITTED=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')

  pass "Git repo detected — branch: ${BRANCH}"
  pass "Last commit: ${LAST_COMMIT}"

  if [ "$UNCOMMITTED" -gt 0 ]; then
    warn "$UNCOMMITTED uncommitted file(s) — run 'git status' to see what hasn't been pushed"
  else
    pass "Working tree clean — all changes committed"
  fi

  REMOTE=$(git remote get-url origin 2>/dev/null)
  if echo "$REMOTE" | grep -q "Radar_Dev"; then
    pass "Remote origin points to Radar_Dev: $REMOTE"
  else
    warn "Remote origin is: $REMOTE — confirm this is the correct repo"
  fi
else
  warn "Not inside a git repo — run this script from your project root"
fi

# ── Summary ─────────────────────────────────────────────────
TOTAL=$((PASS + FAIL + WARN))
echo ""
echo -e "${BOLD}============================================================${RESET}"
echo -e "${BOLD}  RESULTS: ${GREEN}${PASS} PASS${RESET}  ${RED}${FAIL} FAIL${RESET}  ${YELLOW}${WARN} WARN${RESET}  (${TOTAL} checks)"
echo -e "${BOLD}============================================================${RESET}"

if [ "$FAIL" -eq 0 ] && [ "$WARN" -eq 0 ]; then
  echo -e "\n${GREEN}${BOLD}🎉 All checks passed — safe to deploy to Render.${RESET}\n"
elif [ "$FAIL" -eq 0 ]; then
  echo -e "\n${YELLOW}${BOLD}⚠️  No failures but ${WARN} warnings — review warnings before deploying.${RESET}\n"
else
  echo -e "\n${RED}${BOLD}🚨 ${FAIL} check(s) failed — fix before deploying.${RESET}"
  echo -e "${RED}   Critical (🔴) failures will cause runtime crashes or silent data loss.${RESET}\n"
fi

exit $FAIL
