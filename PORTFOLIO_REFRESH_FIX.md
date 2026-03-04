# Portfolio/Monitor Refresh Rate Fix

## Problem
- **Local (SQLite)**: Portfolio/Monitor data refreshes every 3 seconds
- **Production (Supabase)**: Portfolio/Monitor data only refreshed every 30 seconds
- **Result**: Inconsistent user experience between environments

## Solution Applied

### 1. Backend: Configurable Refresh Interval
**File**: `backend/ws_engine.py`

Changed from hardcoded 30 seconds to configurable 3 seconds:

```python
# Before
self._PORTFOLIO_REFRESH_INTERVAL = 30.0

# After
self._PORTFOLIO_REFRESH_INTERVAL = float(os.getenv("PORTFOLIO_REFRESH_INTERVAL", "3.0"))
```

**Benefits**:
- ✅ Matches local SQLite behavior (3 seconds)
- ✅ Configurable via environment variable
- ✅ Can be adjusted per deployment without code changes

### 2. Frontend: Debounced Source Switching
**File**: `frontend/src/components/LiveDashboard.jsx`

Added 300ms debounce to prevent rapid API calls:

```javascript
useEffect(() => {
  const timeoutId = setTimeout(() => {
    // Fetch data after 300ms delay
  }, 300)
  
  return () => clearTimeout(timeoutId) // Cancel if source changes again
}, [source])
```

**Benefits**:
- ✅ Prevents unnecessary API calls when user rapidly switches sources
- ✅ Reduces server load
- ✅ Smoother user experience

### 3. Frontend: Auto-Refresh for Portfolio/Monitor
**File**: `frontend/src/components/LiveDashboard.jsx`

Added automatic refresh every 3 seconds when viewing portfolio or monitor:

```javascript
useEffect(() => {
  if (source !== 'portfolio' && source !== 'monitor') {
    return // Only auto-refresh for portfolio and monitor
  }

  const refreshInterval = setInterval(() => {
    // Fetch updated data
  }, 3000) // Refresh every 3 seconds

  return () => clearInterval(refreshInterval)
}, [source])
```

**Benefits**:
- ✅ Real-time updates for portfolio/monitor views
- ✅ Matches backend refresh rate
- ✅ Only refreshes when viewing those sources (efficient)

### 4. Visual Indicator
**File**: `frontend/src/components/LiveDashboard.jsx`

Added visual indicator showing auto-refresh status:

```javascript
{(source === 'portfolio' || source === 'monitor') && (
  <span className="flex items-center gap-1 text-[10px]">
    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
    Auto-refresh: 3s
  </span>
)}
```

**Benefits**:
- ✅ User knows data is being refreshed
- ✅ Builds confidence in data freshness
- ✅ Professional appearance

### 5. Deployment Configuration
**File**: `render.yaml`

Added environment variable for easy configuration:

```yaml
envVars:
  - key: PORTFOLIO_REFRESH_INTERVAL
    value: "3.0"
```

**Benefits**:
- ✅ Easy to adjust without code changes
- ✅ Can be different per environment
- ✅ Documented in deployment config

## Performance Impact

### Before
- Backend: Refreshed every 30 seconds
- Frontend: No auto-refresh
- User Experience: Stale data for up to 30 seconds

### After
- Backend: Refreshes every 3 seconds (10x faster)
- Frontend: Auto-refreshes every 3 seconds when viewing portfolio/monitor
- User Experience: Near real-time updates

### Load Analysis
**Backend**:
- Old: 2 API calls/minute (portfolio + monitor)
- New: 20 API calls/minute (portfolio + monitor)
- Impact: 10x increase, but still very light (Supabase can handle this easily)

**Frontend**:
- Old: 1 API call on source switch
- New: 1 API call on source switch + 20 calls/minute while viewing
- Impact: Minimal - only refreshes when actively viewing portfolio/monitor

## Configuration Options

### Adjust Refresh Rate
To change the refresh interval, set the environment variable:

```bash
# Faster (1 second)
PORTFOLIO_REFRESH_INTERVAL=1.0

# Slower (10 seconds)
PORTFOLIO_REFRESH_INTERVAL=10.0

# Default (3 seconds)
PORTFOLIO_REFRESH_INTERVAL=3.0
```

### Disable Auto-Refresh (Frontend)
If needed, comment out the auto-refresh useEffect in `LiveDashboard.jsx`

## Testing

### Local Testing
1. Start backend: `python -m uvicorn backend.main:app --reload`
2. Start frontend: `npm run dev`
3. Switch to Portfolio or Monitor view
4. Watch console logs for refresh messages
5. Verify "Auto-refresh: 3s" indicator appears

### Production Testing
1. Deploy to Render
2. Check logs for refresh messages
3. Verify portfolio/monitor data updates quickly
4. Monitor Supabase API usage

## Monitoring

### Backend Logs
```
[DEBUG] backend.ws_engine: Refreshed portfolio/monitor: 10 portfolio, 308 monitor tickers
```

### Frontend Console
```
[LiveDashboard] Auto-refreshing portfolio data
[LiveDashboard] Portfolio data: {tickers: [...]}
```

## Rollback Plan

If issues arise, revert to 30-second refresh:

1. Set environment variable: `PORTFOLIO_REFRESH_INTERVAL=30.0`
2. Comment out frontend auto-refresh useEffect
3. Redeploy

## Related Issues Fixed

This also addresses:
- ✅ Inconsistent behavior between local and production
- ✅ Stale portfolio/monitor data
- ✅ User confusion about data freshness
- ✅ Lack of visual feedback for data updates

---

**Status**: ✅ FIXED
**Date**: 2026-03-03
**Impact**: High - Significantly improves user experience
**Risk**: Low - Configurable and easily reversible
