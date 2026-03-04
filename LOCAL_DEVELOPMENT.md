# NexRadar Pro - Local Development Guide

## Prerequisites

### Required Software
- Python 3.9+ (with pip)
- Node.js 16+ (with npm)
- Git

### Required Accounts
- Supabase account (for database)
- Polygon.io account (for market data via Massive API)

---

## Initial Setup

### 1. Clone Repository
```bash
git clone <repository-url>
cd Radar_Pro
```

### 2. Environment Variables

Create `.env` file in project root:
```env
# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-service-role-key

# Polygon.io (Massive API)
MASSIVE_API_KEY=your-polygon-api-key

# Frontend Origin (for CORS)
FRONTEND_ORIGIN=http://localhost:5173

# Optional
PORTFOLIO_REFRESH_INTERVAL=3.0
```

Create `frontend/.env.local`:
```env
VITE_API_BASE=http://localhost:8000
VITE_WS_URL=ws://localhost:8000/ws/live
```

### 3. Database Setup

Run migration to populate stock_list:
```bash
python migrate_all.py
```

This will:
- Fetch 6,032 tickers from yfinance
- Populate Supabase stock_list table
- Add sector and company name data

---

## Running Backend (Python/FastAPI)

### Install Dependencies
```bash
pip install -r backend/requirements.txt
```

### Start Backend Server

**Windows PowerShell:**
```powershell
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
```

**Linux/Mac (bash):**
```bash
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
```

**Alternative (using Python module):**
```bash
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
```

### Verify Backend Running
Open browser to: http://localhost:8000/health

Should see:
```json
{"status":"ok","ts":1234567890}
```

Check metrics: http://localhost:8000/api/metrics

Should see:
```json
{
  "ws_health": "Healthy",
  "total_tickers": 6032,
  "live_count": 0,
  ...
}
```

---

## Running Frontend (React/Vite)

### Install Dependencies
```bash
cd frontend
npm install
```

### Start Development Server

**Windows PowerShell:**
```powershell
npm run dev
```

**Linux/Mac:**
```bash
npm run dev
```

### Access Application
Open browser to: http://localhost:5173

You should see:
- NexRadar Pro dashboard
- WebSocket connecting message
- After a few seconds, live data should appear

---

## Development Workflow

### Backend Development

**File Structure:**
```
backend/
├── main.py              # FastAPI app, routes, WebSocket
├── ws_engine.py         # WebSocket engine, data broadcast
├── supabase_db.py       # Database layer
├── Scalping_Signal.py   # Signal calculation engine
└── requirements.txt     # Python dependencies
```

**Hot Reload:**
- Backend auto-reloads when you save Python files (with `--reload` flag)
- No need to restart server during development

**Logging:**
- Check terminal for logs
- INFO level: Normal operations
- ERROR level: Issues to investigate

### Frontend Development

**File Structure:**
```
frontend/src/
├── App.jsx                          # Main app shell
├── components/
│   ├── NexRadarDashboard.jsx       # Elite dashboard (main)
│   ├── LiveDashboard.jsx           # Legacy live table
│   ├── SignalFeed.jsx              # Legacy signals
│   └── ...                         # Other components
├── hooks/
│   └── useWebSocket.js             # WebSocket hook
├── utils/
│   └── logger.js                   # Logging utility
└── config.js                       # Configuration
```

**Hot Reload:**
- Frontend auto-reloads when you save files
- Vite HMR (Hot Module Replacement) is very fast

**Browser Console:**
- Check for errors (should be none)
- Look for WebSocket connection messages
- Monitor network tab for API calls

---

## Common Development Tasks

### Add New Ticker to Database
```python
# In Python console or script
from backend.supabase_db import SupabaseDB
db = SupabaseDB()
db.client.table("stock_list").insert({
    "ticker": "NEWT",
    "company_name": "New Ticker Inc",
    "sector": "TECHNOLOGY",
    "is_active": 1
}).execute()
```

### Test WebSocket Connection
```javascript
// In browser console
const ws = new WebSocket('ws://localhost:8000/ws/live');
ws.onopen = () => console.log('Connected');
ws.onmessage = (e) => console.log('Message:', JSON.parse(e.data));
```

### Clear Browser Cache
```javascript
// In browser console
localStorage.clear();
location.reload();
```

### Reset Database
```bash
# Re-run migration
python migrate_all.py
```

---

## Troubleshooting

### Backend Won't Start

**Error: "ModuleNotFoundError"**
```bash
# Install dependencies
pip install -r backend/requirements.txt
```

**Error: "Port already in use"**
```bash
# Windows: Find and kill process
netstat -ano | findstr :8000
taskkill /PID <process_id> /F

# Linux/Mac: Find and kill process
lsof -ti:8000 | xargs kill -9
```

**Error: "Supabase connection failed"**
- Check SUPABASE_URL and SUPABASE_KEY in .env
- Verify Supabase project is active
- Check internet connection

**Error: "Massive API key invalid"**
- Check MASSIVE_API_KEY in .env
- Verify Polygon.io subscription is active
- Check API key hasn't expired

### Frontend Won't Start

**Error: "Cannot find module"**
```bash
# Delete node_modules and reinstall
cd frontend
rm -rf node_modules package-lock.json
npm install
```

**Error: "Port 5173 already in use"**
```bash
# Kill process on port 5173
# Windows:
netstat -ano | findstr :5173
taskkill /PID <process_id> /F

# Linux/Mac:
lsof -ti:5173 | xargs kill -9
```

**Error: "WebSocket connection failed"**
- Check backend is running on port 8000
- Verify VITE_WS_URL in frontend/.env.local
- Check browser console for CORS errors

### No Live Data Showing

**Check Backend Logs:**
```
Should see:
- "WSEngine started — 6032 tickers"
- "Loaded sector map: 6032 tickers"
- "WS client connected"
```

**Check Frontend Console:**
```
Should see:
- "[NexRadar] WebSocket connected"
- "snapshot" message with data array
```

**Check Network Tab:**
- WebSocket connection should be "101 Switching Protocols"
- Should see messages flowing

**Common Causes:**
1. Backend not running
2. Wrong WebSocket URL in frontend/.env.local
3. Firewall blocking WebSocket
4. Polygon API key invalid (no market data)

---

## Testing

### Backend Tests
```bash
# Test health endpoint
curl http://localhost:8000/health

# Test metrics endpoint
curl http://localhost:8000/api/metrics

# Test tickers endpoint
curl http://localhost:8000/api/tickers?limit=10

# Test with sector filter
curl "http://localhost:8000/api/tickers?sector=TECHNOLOGY&limit=10"
```

### Frontend Tests
```bash
# Build for production
cd frontend
npm run build

# Preview production build
npm run preview
```

---

## Development Tips

### Backend Performance
- Use `--reload` only in development
- Monitor memory usage (should stay under 512MB)
- Check WebSocket connection count in metrics
- Use logging instead of print statements

### Frontend Performance
- Use React DevTools to check re-renders
- Monitor WebSocket message rate
- Check memory usage in browser DevTools
- Use useMemo/useCallback for expensive operations

### Code Quality
- Follow existing code style
- Add comments for complex logic
- Use logger instead of console.log
- Handle errors gracefully
- Add loading and empty states

---

## Building for Production

### Backend
```bash
# No build step needed for Python
# Just ensure all dependencies in requirements.txt
pip freeze > backend/requirements.txt
```

### Frontend
```bash
cd frontend
npm run build
# Output in frontend/dist/
```

---

## Environment-Specific Notes

### Windows (PowerShell)
- Use `$env:VARIABLE_NAME` for environment variables
- Use `;` instead of `&&` for command chaining
- Use `\` or `/` for paths (both work)

### Linux/Mac (bash)
- Use `export VARIABLE_NAME=value` for environment variables
- Use `&&` for command chaining
- Use `/` for paths

### Python Virtual Environment (Recommended)
```bash
# Create virtual environment
python -m venv venv

# Activate (Windows PowerShell)
.\venv\Scripts\Activate.ps1

# Activate (Linux/Mac)
source venv/bin/activate

# Install dependencies
pip install -r backend/requirements.txt
```

---

## Quick Start Commands

### Start Everything (Windows PowerShell)
```powershell
# Terminal 1 - Backend
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload

# Terminal 2 - Frontend
cd frontend
npm run dev
```

### Start Everything (Linux/Mac)
```bash
# Terminal 1 - Backend
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload

# Terminal 2 - Frontend
cd frontend && npm run dev
```

---

## Support

### Documentation
- `PRODUCTION_READINESS.md` - Complete system verification
- `DEPLOYMENT_CHECKLIST.md` - Production deployment guide
- `1_ISSUES_FIXED.md` - All bug fixes
- `2_IMPLEMENTATION_SUMMARY.md` - Architecture overview

### Common Issues
- Check backend logs for errors
- Check browser console for errors
- Verify environment variables set correctly
- Ensure all dependencies installed
- Check firewall/antivirus settings

---

**Happy Coding! 🚀**
