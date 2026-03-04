# Implementation Plan - Fixing All Issues

## Issue 1: Black Screen on Live Table, Earnings, Portfolio Tabs

**Root Cause**: The tabs are rendering LiveDashboard component, but the content might not be visible due to:
- Missing background color in light mode
- Content being rendered but hidden
- Empty states not showing properly

**Fix**:
1. Verify LiveDashboard has proper background colors for both themes
2. Ensure empty states are visible
3. Check if data is actually loading

**Files to Modify**:
- `frontend/src/components/LiveDashboard.jsx` - Add background colors, verify empty states

## Issue 2: Missing Sparkline in Dashboard

**Root Cause**: NexRadarDashboard doesn't use MiniSparkline component

**Fix**:
1. Import MiniSparkline into NexRadarDashboard.jsx
2. Add sparkline column to the table
3. Generate sparkline data for each ticker

**Files to Modify**:
- `frontend/src/components/NexRadarDashboard.jsx` - Add sparkline column

## Issue 3: Alert Cards Not Filtering

**Root Cause**: onClick handlers are empty, no filtering logic

**Fix**:
1. Implement filtering state in NexRadarDashboard
2. Filter table data based on clicked alert
3. Add visual feedback for active filter

**Files to Modify**:
- `frontend/src/components/NexRadarDashboard.jsx` - Implement filtering logic

## Issue 4: Load More Not Visible

**Root Cause**: Might be styling issue or logic not working

**Fix**:
1. Verify hasMore logic
2. Ensure button is visible in both themes
3. Check scroll detection

**Files to Modify**:
- `frontend/src/components/LiveDashboard.jsx` - Verify load more UI

## Implementation Order

1. Fix LiveDashboard background and visibility (CRITICAL)
2. Add sparklines to NexRadarDashboard (HIGH)
3. Implement alert card filtering (HIGH)
4. Verify load more functionality (MEDIUM)

## Testing Strategy

After each fix:
1. Build the project
2. Check for errors
3. Verify in browser (if possible)
4. Move to next fix

---

**Ready to implement**: YES
**Estimated time**: 30-45 minutes
