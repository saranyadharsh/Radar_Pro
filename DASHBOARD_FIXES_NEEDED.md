# Dashboard Issues & Fixes

## Issues Identified from Screenshots

### 1. Portfolio Button Selected but Shows ALL Data ❌
**Problem**: Clicking "PORTFOLIO" button doesn't filter the data - still shows all stocks
**Root Cause**: 
- NexRadarDashboard has internal `dataSource` state initialized from props
- When parent changes `source` prop, child doesn't re-sync
- The `useEffect` sync exists but may not be triggering properly

**Fix**: Ensure proper prop synchronization

### 2. Fake Animations in Dashboard ❌
**Problem**: Candle charts and sparklines show fake/generated data instead of real market data
**Root Cause**:
- `CandleChart` component uses `Math.random()` and `Math.sin()` to generate fake candles
- `MiniSparkline` may be using generated data instead of real price history
- No real historical price data being fetched or stored

**Current Fake Code**:
```javascript
// Line 64-68 in NexRadarDashboard.jsx
const candles = useMemo(()=>Array.from({length:40},(_,i)=>{
  const base=100+Math.sin((i+seed)*0.3)*20+i*0.5;
  const o=base+(Math.random()-0.5)*8,c=base+(Math.random()-0.5)*8+1;
  return{o,c,h:Math.max(o,c)+Math.random()*4,l:Math.min(o,c)-Math.random()*4,vol:30+Math.random()*50};
}),[symbol]);
```

**Fix Options**:
1. **Remove fake charts** - Show only price/change without animation
2. **Use TradingView widget** - Embed real TradingView chart (recommended)
3. **Fetch real historical data** - Add backend endpoint for OHLCV data

### 3. Sector Auto-Detection ✅
**Question**: "How does it automatically fetch sector data?"
**Answer**: 
- Backend WebSocket sends sector with each ticker via `v_live_enriched` view
- This view JOINs `live_tickers` with `stock_list` table
- `stock_list` contains sector information for each ticker
- No client-side fetching needed - comes with live data

**Backend SQL View**:
```sql
CREATE VIEW v_live_enriched AS
SELECT 
  lt.*,
  sl.sector,
  sl.company_name,
  sl.market_cap
FROM live_tickers lt
LEFT JOIN stock_list sl ON lt.ticker = sl.ticker;
```

## Priority Fixes

### HIGH PRIORITY
1. **Fix Portfolio/Watchlist Selection** - Users can't filter their portfolio
2. **Remove Fake Charts** - Misleading users with fake data

### MEDIUM PRIORITY  
3. **Add Real TradingView Charts** - Professional chart experience
4. **Fix Sparkline Data** - Use real price history from WebSocket

### LOW PRIORITY
5. **Add Historical Data API** - For custom chart rendering

## Recommended Solution

### Quick Fix (5 minutes)
1. Remove fake candle chart - show simple price card instead
2. Fix portfolio selection sync issue
3. Use real price history for sparklines (already tracked in priceHistory Map)

### Professional Fix (30 minutes)
1. Embed TradingView widget for selected stock
2. Fix data source selection
3. Use real sparkline data from WebSocket price history

## Implementation Plan

### Step 1: Fix Portfolio Selection
```javascript
// In NexRadarDashboard.jsx, improve useEffect sync
useEffect(()=>{
  setDS(sourceProp);
},[sourceProp]);

useEffect(()=>{
  setSector(sectorProp);
},[sectorProp]);
```

### Step 2: Remove Fake Chart
Replace `CandleChart` component with TradingView widget or simple price display

### Step 3: Fix Sparklines
Use real `priceHistory` Map data instead of generated data

## Files to Modify
- `frontend/src/components/NexRadarDashboard.jsx` - Main dashboard component
- `frontend/src/components/MiniSparkline.jsx` - Sparkline component (check if using real data)
