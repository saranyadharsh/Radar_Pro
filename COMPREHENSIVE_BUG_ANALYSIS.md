# NexRadar Pro - Comprehensive Bug Analysis & Fixes

## 🔴 CRITICAL ISSUES

### 1. **Module Import Path Issues on Render**
**Location**: `backend/main.py`, `backend/ws_engine.py`
**Issue**: Absolute imports fail on Render deployment due to different working directory
```python
# Failed on Render
from backend.supabase_db import SupabaseDB
# ModuleNotFoundError: No module named 'backend'
```
**Fix**: ✅ FIXED - Added sys.path manipulation and fallback imports
```python
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

# Try both import styles for compatibility
try:
    from backend.supabase_db import SupabaseDB
except ModuleNotFoundError:
    from supabase_db import SupabaseDB
```

### 2. **WebSocket Status Mapping Mismatch**
**Location**: `frontend/src/App.jsx`
**Issue**: WebSocket status from backend returns `'open'` but frontend expects `'Healthy'`
```javascript
// Current mapping is inconsistent
const wsHealthColor = { 
  Healthy: 'text-emerald-400',  // ❌ Backend never sends 'Healthy'
  open: 'text-emerald-400',      // ✅ Backend sends 'open'
  connecting: 'text-amber-400',
  // ...
}
```
**Fix**: ✅ FIXED - Added 'open' status to mapping

### 3. **Portfolio/Monitor API Response Format**
**Location**: `backend/main.py` endpoints `/api/portfolio` and `/api/monitor`
**Issue**: Endpoints return full row objects but frontend expects `{tickers: [...]}`
```python
# Current
@app.get("/api/portfolio")
async def get_portfolio():
    return db.get_portfolio()  # Returns [{ticker: 'AAPL', ...}, ...]

# Frontend expects
{tickers: ['AAPL', 'GOOGL', ...]}
```
**Fix**: ✅ FIXED - Transform response format
```python
@app.get("/api/portfolio")
async def get_portfolio():
    rows = db.get_portfolio()
    return {"tickers": [r.get("ticker") for r in rows if r.get("ticker")]}
```

### 4. **Earnings API Date Range**
**Location**: `frontend/src/components/LiveDashboard.jsx`
**Issue**: Hardcoded date range may miss current earnings
```javascript
const start = new Date(Date.now() - 30 * 86400000)  // 30 days ago
const end   = new Date(Date.now() + 60 * 86400000)  // 60 days future
```
**Fix**: Make date range configurable or use more reasonable defaults

---

## 🟡 HIGH PRIORITY BUGS

### 4. **Sector Filter Case Sensitivity**
**Location**: `backend/ws_engine.py` line ~580
**Issue**: Sector comparison is case-sensitive but data may have inconsistent casing
```python
if sector and sector not in ("", "all"):
    rows = [r for r in rows if r.get("sector", "").lower() == sector.lower()]
```
**Status**: ✅ Already fixed with `.lower()` comparison

### 5. **Missing Error Handling in Data Fetching**
**Location**: `frontend/src/components/LiveDashboard.jsx`
**Issue**: API fetch errors don't show user-friendly messages
```javascript
fetch(`${API}/api/portfolio`)
  .then(r => r.json())
  .then(data => setPortfolioData(data.tickers || []))
  .catch(() => setPortfolioData([]))  // ❌ Silent failure
```
**Fix**: Add toast notifications or error states

### 6. **Race Condition in Portfolio Refresh**
**Location**: `backend/ws_engine.py`
**Issue**: Portfolio/monitor refresh happens every 30s but no debouncing
```python
self._PORTFOLIO_REFRESH_INTERVAL = 30.0
```
**Risk**: Multiple rapid source changes could cause unnecessary API calls
**Fix**: Add debouncing or cancel pending requests

### 7. **Stale Price Detection**
**Location**: `frontend/src/components/LiveDashboard.jsx`
**Issue**: Stale price threshold (300s) may be too aggressive during low-volume periods
```javascript
const isStale = (r) => (Date.now() / 1000 - (r.last_tick_time ?? 0)) > 300
```
**Fix**: Make threshold configurable or session-aware

---

## 🟢 MEDIUM PRIORITY ISSUES

### 8. **Infinite Scroll Performance**
**Location**: `frontend/src/components/LiveDashboard.jsx`
**Issue**: Scroll listener not cleaned up properly, may cause memory leaks
```javascript
useEffect(() => {
  const handleScroll = () => { /* ... */ }
  window.addEventListener('scroll', handleScroll)
  return () => window.removeEventListener('scroll', handleScroll)
}, [isLoadingMore, hasMore, displayCount])  // ❌ Dependencies may cause re-registration
```
**Fix**: Use useCallback for handleScroll

### 9. **Sparkline Data Generation**
**Location**: `frontend/src/components/LiveDashboard.jsx`
**Issue**: Sparkline data is generated on every render (expensive)
```javascript
const sparklineData = generateSparklineData(
  row.live_price || 0,
  row.percent_change || 0,
  20
)
```
**Fix**: Memoize sparkline data or generate server-side

### 10. **Missing Ticker Validation**
**Location**: `backend/main.py` `/api/signal-watchlist`
**Issue**: No validation that tickers exist in stock_list
```python
symbols = [corrections.get(s.upper(), s.upper()) for s in symbols]
accepted = engine._signal_watcher.set_watchlist(symbols)
```
**Fix**: Validate against `db.get_all_tickers()` before accepting

### 11. **WebSocket Reconnection Backoff**
**Location**: `frontend/src/hooks/useWebSocket.js`
**Issue**: Exponential backoff may be too aggressive
```javascript
delay.current = Math.min(delay.current * 2, MAX_DELAY)
```
**Fix**: Add jitter and consider network conditions

### 12. **Missing CORS for WebSocket**
**Location**: `backend/main.py`
**Issue**: CORS middleware doesn't apply to WebSocket connections
```python
app.add_middleware(CORSMiddleware, ...)  # Only applies to HTTP
```
**Fix**: Add WebSocket origin validation in `/ws/live` endpoint

---

## 🔵 LOW PRIORITY / ENHANCEMENTS

### 13. **Hardcoded API Base URL**
**Location**: Multiple frontend files
**Issue**: Falls back to empty string if env var not set
```javascript
const API = import.meta.env.VITE_API_BASE || ''
```
**Fix**: Use window.location.origin as fallback

### 14. **Missing Loading States**
**Location**: `frontend/src/components/TickerDetailDrawer.jsx`
**Issue**: No skeleton loader while fetching ticker details
**Fix**: Add skeleton UI during loading

### 15. **Unused State Variables**
**Location**: `frontend/src/App.jsx`
**Issue**: `showUserProfile` and `autoSession` are declared but never used
```javascript
const [showUserProfile, setShowUserProfile] = useState(false)  // ❌ Never used
const [autoSession, setAutoSession] = useState(true)           // ❌ Never used
```
**Fix**: Remove or implement functionality

### 16. **Console Logging in Production**
**Location**: Multiple files
**Issue**: Debug console.log statements left in code
```javascript
console.log('[LiveDashboard] Filtering - source:', source)
console.log('[WS] Connecting to:', WS_URL)
```
**Fix**: Use environment-based logging or remove

### 17. **Magic Numbers**
**Location**: Throughout codebase
**Issue**: Hardcoded values without constants
```javascript
setDisplayCount(prev => Math.min(prev + 50, rows.length))  // Why 50?
if (now - last_sent) >= self._BROADCAST_THROTTLE_SEC:      // 0.35s
```
**Fix**: Extract to named constants with comments

### 18. **Missing TypeScript/PropTypes**
**Location**: All React components
**Issue**: No type checking for props
**Fix**: Add PropTypes or migrate to TypeScript

---

## 🛡️ SECURITY CONCERNS

### 19. **API Key Exposure**
**Location**: `backend/ws_engine.py`
**Issue**: Polygon API key used in client-facing URLs
```python
url = f"https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers?apiKey={self.massive_api_key}"
```
**Status**: ✅ OK - This is server-side only

### 20. **No Rate Limiting**
**Location**: `backend/main.py`
**Issue**: No rate limiting on API endpoints
**Fix**: Add rate limiting middleware (e.g., slowapi)

### 21. **SQL Injection Risk**
**Location**: `backend/supabase_db.py`
**Issue**: Using Supabase client (safe) but no input validation
**Status**: ✅ OK - Supabase client handles escaping

---

## 📊 DATA CONSISTENCY ISSUES

### 22. **Sector Data Sync**
**Location**: `backend/ws_engine.py`
**Issue**: Sector map loaded once at startup, never refreshed
```python
self.sector_map = self.db.get_sector_map()  # Only called in start()
```
**Fix**: Periodic refresh or invalidation strategy

### 23. **Historical Data Staleness**
**Location**: `backend/ws_engine.py`
**Issue**: Historical data fetched once, never updated
```python
def _fetch_historical_batch(self, tickers: List[str]):
    # Called once at startup, never again
```
**Fix**: Periodic refresh (daily at market open)

### 24. **Volume Ratio Calculation**
**Location**: `backend/ws_engine.py`
**Issue**: Uses last_volume from historical data which may be stale
```python
vol_ratio = (vol_to_use / ref_avgvol) if ref_avgvol > 0 else 0
```
**Fix**: Update avg_volume periodically

---

## 🎨 UI/UX ISSUES

### 25. **Empty State Confusion**
**Location**: `frontend/src/components/LiveDashboard.jsx`
**Issue**: Multiple empty states with similar messaging
**Fix**: Clearer differentiation between:
- No data from backend
- No data for selected source
- All data filtered out

### 26. **Loading Indicator Placement**
**Location**: `frontend/src/components/LiveDashboard.jsx`
**Issue**: Loading spinner in stock count area is easy to miss
```javascript
{isLoadingSource ? (
  <span className="flex items-center gap-2">
    <svg className="animate-spin h-3 w-3">...</svg>
    Loading {source}...
  </span>
) : (
  <span>{rows.length} stocks shown</span>
)}
```
**Fix**: Add full-screen overlay or skeleton table

### 27. **No Feedback on Filter Application**
**Location**: `frontend/src/components/LiveDashboard.jsx`
**Issue**: Filters apply instantly without confirmation
**Fix**: Add brief toast notification

### 28. **Mobile Responsiveness**
**Location**: Header and tables
**Issue**: Header overflows on mobile, tables not scrollable
**Fix**: Add responsive breakpoints and horizontal scroll

### 29. **Accessibility Issues**
**Location**: Multiple components
**Issues**:
- Missing ARIA labels on icon buttons
- No keyboard navigation for dropdowns
- Poor color contrast in some states
**Fix**: Add ARIA attributes and keyboard handlers

---

## ⚡ PERFORMANCE ISSUES

### 30. **Unnecessary Re-renders**
**Location**: `frontend/src/App.jsx`
**Issue**: Metrics polling every 3s causes full app re-render
```javascript
useEffect(() => {
  const poll = () => fetch(`${API}/api/metrics`)...
  const id = setInterval(poll, 3000)
  return () => clearInterval(id)
}, [])
```
**Fix**: Memoize child components or use React.memo

### 31. **Large Ticker Map in Memory**
**Location**: `frontend/src/hooks/useWebSocket.js`
**Issue**: Stores full ticker objects in Map (could be 1000+ items)
```javascript
const [tickers, setTickers] = useState(new Map())
```
**Fix**: Consider pagination or virtualization

### 32. **Broadcast Throttling**
**Location**: `backend/ws_engine.py`
**Issue**: Throttle of 0.35s may still cause too many updates
```python
self._BROADCAST_THROTTLE_SEC = 0.35
```
**Fix**: Increase to 0.5-1.0s or batch updates

### 33. **Database Write Batching**
**Location**: `backend/ws_engine.py`
**Issue**: Flushes every 1 second regardless of batch size
```python
self._DB_FLUSH_INTERVAL = 1.0
```
**Fix**: Flush on batch size OR time threshold

---

## 🔧 CODE QUALITY ISSUES

### 34. **Inconsistent Error Handling**
**Location**: Throughout codebase
**Issue**: Mix of try/catch, .catch(), and no handling
**Fix**: Standardize error handling pattern

### 35. **Missing JSDoc Comments**
**Location**: All JavaScript files
**Issue**: No function documentation
**Fix**: Add JSDoc comments for public functions

### 36. **Long Functions**
**Location**: `backend/ws_engine.py` `_update_alert_cache_logic`
**Issue**: 150+ line function doing too much
**Fix**: Break into smaller functions

### 37. **Duplicate Code**
**Location**: Empty state handling in LiveDashboard
**Issue**: Similar empty state logic repeated for table and matrix views
**Fix**: Extract to shared component

---

## 🎯 RECOMMENDED FIXES PRIORITY

### Immediate (This Week)
1. Fix WebSocket status mapping (#1)
2. Fix portfolio/monitor API response format (#2)
3. Add error handling to data fetching (#5)
4. Remove unused state variables (#15)

### Short Term (This Month)
5. Add rate limiting (#20)
6. Improve empty states (#25)
7. Fix infinite scroll performance (#8)
8. Add loading indicators (#26)
9. Memoize expensive computations (#30)

### Long Term (Next Quarter)
10. Add TypeScript (#18)
11. Implement proper error boundaries
12. Add comprehensive testing
13. Performance optimization (virtualization)
14. Accessibility improvements (#29)

---

## 📝 TESTING RECOMMENDATIONS

### Unit Tests Needed
- Indicator calculations in Scalping_Signal.py
- Data filtering logic in LiveDashboard
- WebSocket message handling

### Integration Tests Needed
- API endpoint responses
- WebSocket connection lifecycle
- Database operations

### E2E Tests Needed
- User flows (filter → select ticker → view chart)
- Source switching
- Real-time data updates

---

## 🚀 DEPLOYMENT CHECKLIST

Before deploying to production:
- [ ] Remove all console.log statements
- [ ] Add environment-based configuration
- [ ] Set up error tracking (Sentry)
- [ ] Add performance monitoring
- [ ] Configure CORS properly
- [ ] Set up rate limiting
- [ ] Add health check endpoints
- [ ] Configure proper logging levels
- [ ] Set up database backups
- [ ] Add API documentation (Swagger)

---

## 📚 DOCUMENTATION GAPS

1. No API documentation
2. No component prop documentation
3. No deployment guide
4. No development setup guide
5. No architecture diagram
6. No data flow documentation

---

**Generated**: 2026-03-03
**Status**: Comprehensive analysis complete
**Next Steps**: Prioritize and create GitHub issues for tracking
