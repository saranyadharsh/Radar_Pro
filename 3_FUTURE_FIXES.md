# NexRadar Pro - Future Fixes & Roadmap

## Overview
This document outlines planned improvements, optimizations, and future features for NexRadar Pro.

---

## 🎯 Priority Roadmap

### Phase 1: Performance Optimizations (2-3 hours)
**Status**: Not Started | **Priority**: High

#### 1.1 Memoize Sparkline Generation
**Impact**: High | **Effort**: Medium | **Time**: 30 min

**Problem**: Sparklines regenerate on every render

**Solution**:
```javascript
const MemoizedSparkline = React.memo(MiniSparkline, (prev, next) => {
  return prev.data === next.data && 
         prev.color === next.color && 
         prev.isPositive === next.isPositive
})

const sparklineData = useMemo(() => 
  generateSparklineData(row.live_price, row.percent_change, 20),
  [row.live_price, row.percent_change]
)
```

**Files**: `frontend/src/components/LiveDashboard.jsx`

---

#### 1.2 Optimize Infinite Scroll
**Impact**: High | **Effort**: Medium | **Time**: 45 min

**Problem**: Scroll handler fires too frequently

**Solution**:
```javascript
// Throttle scroll events to 100ms
const throttledScroll = useCallback(() => {
  if (timeoutId) return
  timeoutId = setTimeout(() => {
    handleScroll()
    timeoutId = null
  }, 100)
}, [handleScroll])

// Use passive listener
window.addEventListener('scroll', throttledScroll, { passive: true })
```

**Files**: `frontend/src/components/LiveDashboard.jsx`

---

#### 1.3 Memoize Child Components
**Impact**: High | **Effort**: Medium | **Time**: 45 min

**Problem**: Components re-render unnecessarily

**Solution**:
```javascript
const MemoizedLiveDashboard = React.memo(LiveDashboard)
const MemoizedSidebar = React.memo(Sidebar)
const MemoizedFilterCards = React.memo(FilterCards)
```

**Files**: `frontend/src/App.jsx`

---

### Phase 2: Backend Improvements (2-3 hours)
**Status**: Not Started | **Priority**: High

#### 2.1 Add Rate Limiting
**Impact**: High | **Effort**: Medium | **Time**: 45 min

**Problem**: No protection against API abuse

**Solution**:
```python
# Install: pip install slowapi
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)

@app.get("/api/metrics")
@limiter.limit("60/minute")
async def get_metrics():
    return engine.get_metrics()
```

**Files**: `backend/main.py`, `backend/requirements.txt`

---

#### 2.2 Add Sector Map Refresh
**Impact**: Medium | **Effort**: Medium | **Time**: 30 min

**Problem**: Sector map never refreshes (stale data)

**Solution**:
```python
# Refresh sector map daily at market open
def _refresh_sector_map(self):
    self.sector_map = self.db.get_sector_map()
    logger.info(f"Sector map refreshed: {len(self.sector_map)} tickers")

# Add to refresh loop
if now - self._last_sector_refresh > 86400:  # 24 hours
    self._refresh_sector_map()
    self._last_sector_refresh = now
```

**Files**: `backend/ws_engine.py`

---

#### 2.3 Optimize Historical Data Refresh
**Impact**: Medium | **Effort**: Medium | **Time**: 45 min

**Problem**: Historical data fetched too frequently

**Solution**:
```python
# Refresh only once daily at market open (9:30 AM ET)
def _should_refresh_historical(self) -> bool:
    now = datetime.now(ET_TZ)
    market_open = now.replace(hour=9, minute=30, second=0)
    
    if now > market_open:
        last_refresh = datetime.fromtimestamp(self._last_historical_refresh, ET_TZ)
        if last_refresh.date() < now.date():
            return True
    return False
```

**Files**: `backend/ws_engine.py`

---

### Phase 3: Mobile & UX (2-3 hours)
**Status**: Not Started | **Priority**: Medium

#### 3.1 Add Mobile Responsiveness
**Impact**: High | **Effort**: High | **Time**: 90 min

**Problem**: Dashboard not optimized for mobile

**Solution**:
```javascript
// Header - scrollable on mobile
<div className="overflow-x-auto">
  <div className="min-w-max flex items-center gap-6">
    {/* Header content */}
  </div>
</div>

// Table - horizontal scroll
<div className="overflow-x-auto -mx-4 px-4">
  <table className="min-w-full">
    {/* Table content */}
  </table>
</div>

// Filter cards - stack on mobile
<div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
  {/* Filter cards */}
</div>

// Hide columns on mobile
<th className="hidden md:table-cell">Company</th>
```

**Files**: 
- `frontend/src/App.jsx`
- `frontend/src/components/LiveDashboard.jsx`

---

#### 3.2 Add Skeleton Loaders
**Impact**: Medium | **Effort**: Medium | **Time**: 45 min

**Problem**: No loading states, feels slow

**Solution**:
```javascript
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
```

**Files**: `frontend/src/components/TickerDetailDrawer.jsx`

---

### Phase 4: Testing & Quality (1-2 hours)
**Status**: Not Started | **Priority**: Medium

#### 4.1 Add Unit Tests
**Impact**: Medium | **Effort**: High | **Time**: 2 hours

**Coverage**:
- Component rendering
- Hook behavior
- Utility functions
- API calls

**Tools**: Vitest, React Testing Library

---

#### 4.2 Add E2E Tests
**Impact**: Medium | **Effort**: High | **Time**: 2 hours

**Coverage**:
- User flows (login, filter, search)
- Data source switching
- Chart loading
- Error handling

**Tools**: Playwright or Cypress

---

#### 4.3 Performance Testing
**Impact**: Medium | **Effort**: Medium | **Time**: 1 hour

**Metrics**:
- Load time
- Time to interactive
- API response time
- WebSocket latency
- Memory usage

**Tools**: Lighthouse, Chrome DevTools

---

### Phase 5: Features & Enhancements (3-5 hours)
**Status**: Not Started | **Priority**: Low

#### 5.1 Add User Authentication
**Impact**: High | **Effort**: High | **Time**: 3 hours

**Features**:
- Login/Signup
- Session management
- Protected routes
- User preferences

**Tools**: Supabase Auth or Auth0

---

#### 5.2 Add Portfolio Management
**Impact**: High | **Effort**: High | **Time**: 2 hours

**Features**:
- Add/remove stocks
- Edit shares/cost basis
- P&L tracking
- Transaction history

---

#### 5.3 Add Alerts & Notifications
**Impact**: Medium | **Effort**: Medium | **Time**: 2 hours

**Features**:
- Price alerts
- Volume alerts
- Email/SMS notifications
- Browser notifications

---

#### 5.4 Add Export Functionality
**Impact**: Low | **Effort**: Low | **Time**: 30 min

**Features**:
- Export to CSV
- Export to Excel
- Export to PDF
- Custom date ranges

---

#### 5.5 Add Watchlist Management
**Impact**: Medium | **Effort**: Medium | **Time**: 1 hour

**Features**:
- Multiple watchlists
- Drag & drop reorder
- Share watchlists
- Import from CSV

---

## 🐛 Known Issues (Low Priority)

### 1. WebSocket Reconnection Delay
**Impact**: Low | **Priority**: Low

**Issue**: Max reconnection delay is 30s
**Solution**: Reduce max delay to 10s

---

### 2. Sparkline Tooltip Position
**Impact**: Low | **Priority**: Low

**Issue**: Tooltip sometimes goes off-screen
**Solution**: Add boundary detection

---

### 3. Dark Mode Flash on Load
**Impact**: Low | **Priority**: Low

**Issue**: Brief flash of light mode before dark mode loads
**Solution**: Add inline script to set theme before React loads

---

### 4. Search Debouncing
**Impact**: Low | **Priority**: Low

**Issue**: Search triggers on every keystroke
**Solution**: Add 300ms debounce

---

## 🔮 Future Ideas (Backlog)

### Advanced Features
- [ ] Multi-timeframe analysis
- [ ] Technical indicators (RSI, MACD, etc.)
- [ ] Backtesting engine
- [ ] Paper trading
- [ ] Social features (share trades, follow traders)
- [ ] AI-powered insights
- [ ] Voice commands
- [ ] Mobile app (React Native)

### Integrations
- [ ] Broker integration (TD Ameritrade, Interactive Brokers)
- [ ] News feed integration
- [ ] Social media sentiment
- [ ] Economic calendar
- [ ] Earnings transcripts

### Analytics
- [ ] Performance analytics
- [ ] Risk metrics
- [ ] Correlation analysis
- [ ] Sector rotation
- [ ] Market breadth indicators

---

## 📊 Estimated Timeline

### Short Term (1-2 weeks)
- Phase 1: Performance Optimizations
- Phase 2: Backend Improvements
- Phase 3: Mobile & UX

### Medium Term (1-2 months)
- Phase 4: Testing & Quality
- Phase 5: Features & Enhancements
- Known Issues fixes

### Long Term (3-6 months)
- Advanced Features
- Integrations
- Analytics

---

## 🎯 Success Criteria

### Performance
- [ ] Load time < 2 seconds
- [ ] Time to interactive < 3 seconds
- [ ] API response time < 500ms
- [ ] WebSocket latency < 100ms
- [ ] Memory usage < 100MB

### Quality
- [ ] 80%+ test coverage
- [ ] 0 critical bugs
- [ ] < 5 known issues
- [ ] WCAG 2.1 Level AA compliance
- [ ] Lighthouse score > 90

### User Experience
- [ ] Mobile responsive
- [ ] Accessible (screen reader compatible)
- [ ] Fast (no lag or jank)
- [ ] Intuitive (easy to use)
- [ ] Professional (polished UI)

---

## 📝 Notes

### Development Principles
1. **Performance First**: Optimize before adding features
2. **Mobile First**: Design for mobile, enhance for desktop
3. **Accessibility First**: WCAG compliance from the start
4. **Test First**: Write tests before code (TDD)
5. **User First**: Focus on user needs, not tech

### Code Quality
- Follow React best practices
- Use TypeScript (planned migration)
- Write clean, readable code
- Document complex logic
- Keep components small (<300 lines)

### Deployment
- Continuous deployment (CD)
- Feature flags for gradual rollout
- Monitoring and alerting
- Rollback capability
- Blue-green deployment

---

## 🤝 Contributing

### How to Contribute
1. Pick an issue from this document
2. Create a branch: `feature/issue-name`
3. Implement the fix/feature
4. Write tests
5. Update documentation
6. Submit pull request

### Code Review Checklist
- [ ] Code follows style guide
- [ ] Tests pass
- [ ] Documentation updated
- [ ] No console.log in production
- [ ] Accessibility checked
- [ ] Performance tested

---

**Last Updated**: 2026-03-04
**Status**: Roadmap Active
**Next Review**: 2026-03-11
