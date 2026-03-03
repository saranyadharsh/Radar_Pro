# 🚀 NexRadar Pro - Startup Guide

## Quick Start (2 Steps)

### Step 1: Start Backend (Terminal 1)

```bash
# Navigate to project root
cd D:\Share_Tracking\Shares\Radar_Pro

# Activate virtual environment (if you have one)
# venv\Scripts\activate  # Windows
# source venv/bin/activate  # Mac/Linux

# Start backend server
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

**Expected output:**
```
INFO:     Uvicorn running on http://0.0.0.0:8000 (Press CTRL+C to quit)
INFO:     Started reloader process
INFO:     Started server process
INFO:     Waiting for application startup.
🚀 NexRadar backend starting …
Loaded 1500 tickers
INFO:     Application startup complete.
```

### Step 2: Start Frontend (Terminal 2)

```bash
# Navigate to frontend folder
cd D:\Share_Tracking\Shares\Radar_Pro\frontend

# Start development server
npm run dev
```

**Expected output:**
```
VITE v5.4.21  ready in 500 ms

➜  Local:   http://localhost:5173/
➜  Network: use --host to expose
```

### Step 3: Open Browser

Visit: **http://localhost:5173**

---

## 🐛 Troubleshooting

### Issue: "Connecting to live feed..." stuck

**Cause:** Backend is not running

**Solution:**
1. Open a new terminal
2. Run: `uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000`
3. Wait for "Application startup complete"
4. Refresh browser

### Issue: "Connection Error" banner

**Cause:** Backend crashed or WebSocket URL is wrong

**Solution:**
1. Check backend terminal for errors
2. Verify `.env` has correct credentials:
   ```
   MASSIVE_API_KEY=your_key
   SUPABASE_URL=your_url
   SUPABASE_SERVICE_KEY=your_key
   ```
3. Check `frontend/.env.local`:
   ```
   VITE_API_BASE=http://localhost:8000
   VITE_WS_URL=ws://localhost:8000/ws/live
   ```

### Issue: No data showing

**Cause:** Database is empty or API keys are invalid

**Solution:**
1. Run migration: `python migrate_all.py`
2. Check Supabase credentials in `.env`
3. Verify MASSIVE_API_KEY is valid

### Issue: Port already in use

**Backend (8000):**
```bash
# Windows
netstat -ano | findstr :8000
taskkill /PID <PID> /F

# Mac/Linux
lsof -ti:8000 | xargs kill -9
```

**Frontend (5173):**
```bash
# Windows
netstat -ano | findstr :5173
taskkill /PID <PID> /F

# Mac/Linux
lsof -ti:5173 | xargs kill -9
```

---

## 📊 Verify Everything is Working

### 1. Check Backend Health
Visit: http://localhost:8000/health

**Expected:** `{"status":"ok","ts":1234567890}`

### 2. Check API Endpoints
Visit: http://localhost:8000/api/metrics

**Expected:** JSON with metrics like:
```json
{
  "ws_health": "Healthy",
  "total_tickers": 1500,
  "live_count": 1234,
  ...
}
```

### 3. Check WebSocket
Open browser console (F12) → Network tab → WS filter

**Expected:** Connection to `ws://localhost:8000/ws/live` with status 101

### 4. Check Frontend
Visit: http://localhost:5173

**Expected:** 
- Dashboard loads
- Tickers appear in table
- No "Connecting..." message
- Green "LIVE" indicator in header

---

## 🔧 Development Workflow

### Normal Startup (Every Day)

1. **Terminal 1 - Backend:**
   ```bash
   cd D:\Share_Tracking\Shares\Radar_Pro
   uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
   ```

2. **Terminal 2 - Frontend:**
   ```bash
   cd D:\Share_Tracking\Shares\Radar_Pro\frontend
   npm run dev
   ```

3. **Browser:** http://localhost:5173

### Making Changes

**Backend changes:**
- Edit Python files
- Server auto-reloads (--reload flag)
- Check terminal for errors

**Frontend changes:**
- Edit React files
- Vite auto-reloads
- Check browser console for errors

### Stopping

**Backend:** Press `Ctrl+C` in Terminal 1

**Frontend:** Press `Ctrl+C` in Terminal 2

---

## 📦 Production Build

### Build Frontend
```bash
cd frontend
npm run build
```

Output: `dist/` folder with optimized files

### Test Production Build
```bash
npm run preview
```

Visit: http://localhost:4173

### Deploy
- Backend: Deploy to Render/Railway/Heroku
- Frontend: Deploy to Vercel/Netlify/Cloudflare Pages

---

## 🎯 Quick Commands Reference

```bash
# Backend
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000

# Frontend Dev
npm run dev

# Frontend Build
npm run build

# Frontend Preview
npm run preview

# Install Dependencies
pip install -r backend/requirements.txt  # Backend
npm install                               # Frontend

# Database Migration
python migrate_all.py

# Check Health
curl http://localhost:8000/health
```

---

## 🆘 Still Having Issues?

1. **Check Python version:** `python --version` (need 3.8+)
2. **Check Node version:** `node --version` (need 16+)
3. **Check dependencies:**
   ```bash
   pip list | grep fastapi
   npm list react
   ```
4. **Clear cache:**
   ```bash
   # Frontend
   rm -rf node_modules package-lock.json
   npm install
   
   # Backend
   pip install --upgrade -r backend/requirements.txt
   ```

5. **Check logs:**
   - Backend: Terminal 1 output
   - Frontend: Browser console (F12)
   - Network: Browser DevTools → Network tab

---

## ✅ Success Checklist

- [ ] Backend running on port 8000
- [ ] Frontend running on port 5173
- [ ] Browser shows dashboard
- [ ] Green "LIVE" indicator visible
- [ ] Tickers loading in table
- [ ] No error messages
- [ ] WebSocket connected (check Network tab)
- [ ] Can click tickers to see details

If all checked, you're good to go! 🎉
