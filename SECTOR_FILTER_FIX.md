# Sector Filter Issue - "BM & ENERGY" Not Found

## Problem
When selecting "BM & UENE" sector from dropdown, shows "No Results Found"

## Root Cause Analysis

### Frontend Sector Name
```javascript
// In SectorFilter.jsx and NexRadarDashboard.jsx
'BM & UENE'  // ← Frontend expects this
```

### Possible Database Sector Names
The database might have any of these variations:
- `BM & ENERGY` (full name)
- `BM & Energy` (mixed case)
- `BM&UENE` (no spaces)
- `BM&ENERGY` (no spaces)
- `BASIC MATERIALS & ENERGY`
- `MATERIALS`

## Solution Options

### Option 1: Fix Database (Recommended)
Update all sector values in `stock_list` table to match frontend:

```sql
-- Check current sector names
SELECT DISTINCT sector FROM stock_list ORDER BY sector;

-- Update to match frontend
UPDATE stock_list 
SET sector = 'BM & UENE' 
WHERE sector IN ('BM & ENERGY', 'BM&ENERGY', 'BASIC MATERIALS & ENERGY', 'MATERIALS');
```

### Option 2: Add Sector Name Mapping (Quick Fix)
Add a normalization function in frontend:

```javascript
// Normalize sector names to handle variations
const normalizeSector = (sector) => {
  const normalized = (sector ?? '').trim().toUpperCase();
  
  // Map variations to standard names
  const sectorMap = {
    'BM & ENERGY': 'BM & UENE',
    'BM&ENERGY': 'BM & UENE',
    'BASIC MATERIALS & ENERGY': 'BM & UENE',
    'MATERIALS': 'BM & UENE',
    'REAL ESTATE': 'REALCOM',
    'COMMUNICATIONS': 'REALCOM',
    'HEALTHCARE': 'BIO',
    'BIOTECHNOLOGY': 'BIO',
  };
  
  return sectorMap[normalized] || sector;
};

// Use in filter
arr = arr.filter(r => {
  const dbSector = normalizeSector(r.sector);
  const filterSector = normalizeSector(sector);
  return dbSector === filterSector;
});
```

### Option 3: Use Fuzzy Matching
```javascript
// Match if sector contains key words
const matchesSector = (dbSector, filterSector) => {
  const db = (dbSector ?? '').toUpperCase();
  const filter = filterSector.toUpperCase();
  
  // Extract key words
  const dbWords = db.split(/[&\s]+/).filter(w => w.length > 2);
  const filterWords = filter.split(/[&\s]+/).filter(w => w.length > 2);
  
  // Match if any key word matches
  return filterWords.some(fw => dbWords.some(dw => dw.includes(fw) || fw.includes(dw)));
};
```

## Debugging Steps

1. **Check what sectors are in database**:
```javascript
// In browser console after page loads
const uniqueSectors = [...new Set(Array.from(tickers.values()).map(r => r.sector).filter(Boolean))];
console.log('Database sectors:', uniqueSectors);
```

2. **Check what's being filtered**:
```javascript
// Already added in LiveDashboard.jsx
// Look for these console logs:
[LiveDashboard] All unique sectors in data: [...]
[LiveDashboard] Filtering by sector: BM & UENE
[LiveDashboard] Before sector filter: 1088
[LiveDashboard] Exact match results: 0
[LiveDashboard] Case-insensitive match results: 0
```

3. **Check backend data**:
```bash
# Check what backend sends
curl http://localhost:8000/api/metrics
# Look at sector_stats field
```

## Implementation

I've already added enhanced debugging to LiveDashboard.jsx. Now:

1. **Open browser console** (F12)
2. **Select "Stock List" data source**
3. **Select "BM & Energy" sector**
4. **Check console logs** for:
   - What sectors exist in data
   - What sector you're filtering by
   - How many matches found

5. **Share the console output** so I can see exact sector names

## Expected Console Output

```
[LiveDashboard] All unique sectors in data: ["TECHNOLOGY", "CONSUMER", "BANKING", "BIO", "BM & ENERGY", "REALCOM", "INDUSTRIALS"]
[LiveDashboard] Filtering by sector: BM & UENE
[LiveDashboard] Before sector filter: 1088
[LiveDashboard] Exact match results: 0
[LiveDashboard] Case-insensitive match results: 0
[LiveDashboard] No stocks found for sector: BM & UENE
[LiveDashboard] Available sectors: ["TECHNOLOGY", "CONSUMER", ...]
```

This will tell us the exact mismatch!
