# Tomorrow's Fix Plan - Remaining Issues

## 🎯 **Priority Order (High Impact → Low Effort)**

---

## ✅ **Phase 1: Quick Wins (1-2 hours)**

### 1. Remove Production Console Logs
**Impact**: High | **Effort**: Low | **Time**: 15 min

**Files to clean**:
- `frontend/src/components/LiveDashboard.jsx`
- `frontend/src/hooks/useWebSocket.js`
- `frontend/src/components/TickerDetailDrawer.jsx`

**Action**:
```javascript
// Replace all console.log with conditional logging
const isDev = import.meta.env.DEV
if (isDev) console.log('[LiveDashboard] ...')

// Or create a logger utility
const logger = {
  log: (...args) => import.meta.env.DEV && console.log(...args),
  error: (...args) => console.error(...args), // Always log errors
}
```

---

### 2. Add ARIA Labels & Accessibility
**Impact**: High | **Effort**: Low | **Time**: 30 min

**Files**:
- `frontend/src/App.jsx` (header buttons)
- `frontend/src/components/LiveDashboard.jsx` (filter buttons, table)

**Actions**:
```javascript
// Notification button
<button 
  onClick={() => setShowNotif(v => !v)}
  aria-label="Notifications"
  aria-expanded={showNotif}
  aria-haspopup="true"
>
  🔔
</button>

// Profile button
<button 
  aria-label="User profile menu"
  aria-expanded={showProfile}
>
  {user.name.charAt(0)}
</button>

// Filter cards
<button
  aria-label={`Filter by ${fc.label}`}
  aria-pressed={active}
>
  {fc.icon} {fc.label}
</button>

// Table
<table role="table" aria-label="Live stock data">
  <thead role="rowgroup">
    <tr role="row">
      <th role="columnheader" aria-sort={sortKey === 'ticker' ? 'descending' : 'none'}>
        Ticker
      </th>
    </tr>
  </thead>
</table>
```

---

### 3. Extract Magic Numbers to Constants
**Impact**: Medium | **Effort**: Low | **Time**: 20 min

**Files**:
- `frontend/src/components/LiveDashboard.jsx`
- `backend/ws_engine.py`

**Actions**:
```javascript
// frontend/src/components/LiveDashboard.jsx
const INITIAL_DISPLAY_COUNT = 50
const LOAD_MORE_INCREMENT = 50
const SCROLL_THRESHOLD_PX = 200
const SOURCE_SWITCH_DEBOUNCE_MS = 300
const AUTO_REFRESH_INTERVAL_MS = 3000

setDisplayCount(prev => Math.min(prev + LOAD_MORE_INCREMENT, rows.length))
```

```python
# backend/ws_engine.py
PORTFOLIO_REFRESH_DEFAULT_SEC = 3.0
BROADCAST_THROTTLE_SEC = 0.35
DB_FLUSH_INTERVAL_SEC = 1.0
PRICE_STALE_THRESHOLD_SEC = 300
```

---

### 4. Fix API Base URL Fallback
**Impact**: Medium | **Effort**: Low | **Time**: 10 min

**Files**:
- `frontend/src/components/LiveDashboard.jsx`
- `frontend/src/components/TickerDetailDrawer.jsx`
- `frontend/src/hooks/useWebSocket.js`

**Action**:
```javascript
// Create a config file
// frontend/src/config.js
export const API_BASE = import.meta.env.VITE_API_BASE || 
  (import.meta.env.PROD ? window.location.origin : 'http://localhost:8000')

export const WS_URL = import.meta.env.VITE_WS_URL || 
  (import.meta.env.PROD 
    ? `wss://${window.location.host}/ws/live`
    : 'ws://localhost:8000/ws/live')

// Use in components
import { API_BASE } from '../config'
```

---

## 🔥 **Phase 2: Performance Fixes (2-3 hours)**

### 5. Memoize Sparkline Generation
**Impact**: High | **Effort**: Medium | **Time**: 30 min

**File**: `frontend/src/components/LiveDashboard.jsx`

**Action**:
```javascript
// Create memoized sparkline component
const MemoizedSparkline = React.memo(({ data, width, height, color, isPositive, ticker }) => {
  return (
    <MiniSparkline
      data={data}
      width={width}
      height={height}
      color={color}
      isPositive={isPositive}
      ticker={ticker}
    />
  )
}, (prev, next) => {
  // Only re-render if these props change
  return prev.data === next.data && 
         prev.color === next.color && 
         prev.isPositive === next.isPositive
})

// In table row
const sparklineData = useMemo(() => 
  generateSparklineData(row.live_price || 0, row.percent_change || 0, 20),
  [row.live_price, row.percent_change]
)
```

---

### 6. Optimize Infinite Scroll
**Impact**: High | **Effort**: Medium | **Time**: 45 min

**File**: `frontend/src/components/LiveDashboard.jsx`

**Action**:
```javascript
// Use useCallback for scroll handler
const handleScroll = useCallback(() => {
  if (isLoadingMore || !hasMore) return
  const scrollPosition = window.innerHeight + window.scrollY
  const threshold = document.documentElement.scrollHeight - SCROLL_THRESHOLD_PX
  if (scrollPosition >= threshold) {
    loadMore()
  }
}, [isLoadingMore, hasMore, loadMore])

// Throttle scroll events
useEffect(() => {
  let timeoutId
  const throttledScroll = () => {
    if (timeoutId) return
    timeoutId = setTimeout(() => {
      handleScroll()
      timeoutId = null
    }, 100) // Throttle to 100ms
  }
  
  window.addEventListener('scroll', throttledScroll, { passive: true })
  return () => {
    window.removeEventListener('scroll', throttledScroll)
    if (timeoutId) clearTimeout(timeoutId)
  }
}, [handleScroll])
```

---

### 7. Memoize Child Components
**Impact**: High | **Effort**: Medium | **Time**: 45 min

**File**: `frontend/src/App.jsx`

**Action**:
```javascript
// Memoize expensive components
const MemoizedLiveDashboard = React.memo(LiveDashboard)
const MemoizedSidebar = React.memo(Sidebar)
const MemoizedFilterCards = React.memo(FilterCards)

// Use in render
{activeTab === 'live' && (
  <MemoizedLiveDashboard
    tickers={tickers}
    wsStatus={wsStatus}
    activeFilter={activeFilter}
    metrics={metrics}
    source={source}
    sector={sector}
    darkMode={darkMode}
    onSelectTicker={handleSelectTicker}
  />
)}
```

---

## 🛡️ **Phase 3: Backend Improvements (2-3 hours)**

### 8. Add Rate Limiting
**Impact**: High | **Effort**: Medium | **Time**: 45 min

**File**: `backend/main.py`

**Action**:
```python
# Install: pip install slowapi
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# Apply to endpoints
@app.get("/api/metrics")
@limiter.limit("60/minute")
async def get_metrics():
    return engine.get_metrics() if engine else {"error": "not ready"}

@app.get("/api/tickers")
@limiter.limit("120/minute")
async def get_tickers(...):
    # ...

@app.get("/api/portfolio")
@limiter.limit("60/minute")
async def get_portfolio():
    # ...
```

**Update requirements.txt**:
```
slowapi==0.1.9
```

---

### 9. Add Sector Map Refresh
**Impact**: Medium | **Effort**: Medium | **Time**: 30 min

**File**: `backend/ws_engine.py`

**Action**:
```python
# Add to __init__
self._last_sector_refresh = 0.0
self._SECTOR_REFRESH_INTERVAL = 86400.0  # 24 hours

# Add refresh method
def _refresh_sector_map(self):
    """Refresh sector map from database (called daily)."""
    try:
        self.sector_map = self.db.get_sector_map()
        logger.info(f"Sector map refreshed: {len(self.sector_map)} tickers")
    except Exception as e:
        logger.error(f"Sector map refresh error: {e}")

# Add to _portfolio_monitor_refresh_loop
def _portfolio_monitor_refresh_loop(self):
    while self.run_event.is_set():
        try:
            time.sleep(self._PORTFOLIO_REFRESH_INTERVAL)
            self._refresh_portfolio_monitor()
            
            # Refresh sector map daily
            now = time.time()
            if now - self._last_sector_refresh > self._SECTOR_REFRESH_INTERVAL:
                self._refresh_sector_map()
                self._last_sector_refresh = now
        except Exception as e:
            logger.error(f"Refresh loop error: {e}")
```

---

### 10. Optimize Historical Data Refresh
**Impact**: Medium | **Effort**: Medium | **Time**: 45 min

**File**: `backend/ws_engine.py`

**Action**:
```python
# Add to __init__
self._last_historical_refresh = 0.0
self._HISTORICAL_REFRESH_INTERVAL = 86400.0  # Daily at market open

# Add method
def _should_refresh_historical(self) -> bool:
    """Check if it's time to refresh historical data (daily at 9:30 AM ET)."""
    now = datetime.now(ET_TZ)
    market_open = now.replace(hour=9, minute=30, second=0, microsecond=0)
    
    # If it's after market open and we haven't refreshed today
    if now > market_open:
        last_refresh = datetime.fromtimestamp(self._last_historical_refresh, ET_TZ)
        if last_refresh.date() < now.date():
            return True
    return False

# Add to _portfolio_monitor_refresh_loop
if self._should_refresh_historical():
    logger.info("Refreshing historical data (daily)")
    threading.Thread(
        target=self._fetch_historical_batch,
        args=(list(self.all_tickers),),
        daemon=True
    ).start()
    self._last_historical_refresh = time.time()
```

---

## 📱 **Phase 4: Mobile & UX (2-3 hours)**

### 11. Add Mobile Responsiveness
**Impact**: High | **Effort**: High | **Time**: 90 min

**Files**:
- `frontend/src/App.jsx` (header)
- `frontend/src/components/LiveDashboard.jsx` (table)

**Actions**:
```javascript
// Header - make scrollable on mobile
<div className="overflow-x-auto">
  <div className="min-w-max flex items-center gap-6 px-6">
    {/* Header content */}
  </div>
</div>

// Table - horizontal scroll on mobile
<div className="overflow-x-auto -mx-4 px-4">
  <table className="min-w-full">
    {/* Table content */}
  </table>
</div>

// Filter cards - stack on mobile
<div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
  {/* Filter cards */}
</div>

// Hide less important columns on mobile
<th className="hidden md:table-cell">Company</th>
<td className="hidden md:table-cell">{row.company_name}</td>
```

---

### 12. Add Skeleton Loaders
**Impact**: Medium | **Effort**: Medium | **Time**: 45 min

**File**: `frontend/src/components/TickerDetailDrawer.jsx`

**Action**:
```javascript
// Create skeleton component
const TickerDetailSkeleton = ({ darkMode }) => (
  <div className="p-4 space-y-4 animate-pulse">
    <div className={clsx('h-8 rounded', darkMode ? 'bg-white/10' : 'bg-slate-200')} />
    <div className={clsx('h-32 rounded', darkMode ? 'bg-white/10' : 'bg-slate-200')} />
    <div className="grid grid-cols-2 gap-3">
      {[1,2,3,4,5,6].map(i => (
        <div key={i} className={clsx('h-16 rounded', darkMode ? 'bg-white/10' : 'bg-slate-200')} />
      ))}
    </div>
  </div>
)

// Use in drawer
{loading ? (
  <TickerDetailSkeleton darkMode={darkMode} />
) : (
  <OverviewTab data={data} />
)}
```

---

## 🧪 **Phase 5: Testing & Validation (1 hour)**

### 13. Test All Fixes
**Time**: 60 min

**Checklist**:
- [ ] Console logs removed/conditional
- [ ] ARIA labels working (test with screen reader)
- [ ] Constants extracted and used
- [ ] API fallback works
- [ ] Sparklines render fast
- [ ] Infinite scroll smooth
- [ ] Rate limiting works (test with curl)
- [ ] Sector map refreshes
- [ ] Historical data refreshes
- [ ] Mobile responsive (test on phone)
- [ ] Skeleton loaders show
- [ ] No TypeScript/lint errors

---

## 📦 **Phase 6: Documentation & Deployment (30 min)**

### 14. Update Documentation
**Time**: 20 min

**Files to update**:
- `FIXES_SUMMARY.md` - Add new fixes
- `COMPREHENSIVE_BUG_ANALYSIS.md` - Mark as fixed
- `README.md` - Update if needed

### 15. Deploy
**Time**: 10 min

**Steps**:
1. Commit all changes
2. Push to GitHub
3. Verify Render auto-deploys
4. Test production deployment
5. Monitor logs for issues

---

## ⏱️ **Time Estimate**

| Phase | Tasks | Time |
|-------|-------|------|
| Phase 1: Quick Wins | 4 tasks | 1-2 hours |
| Phase 2: Performance | 3 tasks | 2-3 hours |
| Phase 3: Backend | 3 tasks | 2-3 hours |
| Phase 4: Mobile/UX | 2 tasks | 2-3 hours |
| Phase 5: Testing | 1 task | 1 hour |
| Phase 6: Deploy | 2 tasks | 30 min |
| **TOTAL** | **15 tasks** | **8-12 hours** |

---

## 🎯 **Success Criteria**

- [ ] All console.log statements conditional or removed
- [ ] All interactive elements have ARIA labels
- [ ] No magic numbers in code
- [ ] API endpoints have rate limiting
- [ ] Sparklines render without lag
- [ ] Infinite scroll is smooth
- [ ] Mobile layout works on phone
- [ ] Skeleton loaders show during loading
- [ ] Sector map refreshes daily
- [ ] Historical data refreshes at market open
- [ ] All tests pass
- [ ] Production deployment successful

---

## 📝 **Notes**

- Start with Phase 1 (quick wins) for immediate impact
- Phase 2 & 3 can be done in parallel (frontend/backend)
- Phase 4 is optional if time is limited
- Phase 5 is critical - don't skip testing
- Keep commits small and focused

---

**Prepared**: 2026-03-03
**Estimated Completion**: 2026-03-04
**Priority**: High
**Status**: Ready to Execute
