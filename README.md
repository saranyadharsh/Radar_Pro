# 🚀 NexRadar Pro - Real-Time Stock Market Dashboard

Professional-grade trading dashboard with real-time WebSocket data, scalping signals, and comprehensive market analytics.

![NexRadar Pro](https://img.shields.io/badge/Status-Production%20Ready-success)
![Python](https://img.shields.io/badge/Python-3.8+-blue)
![React](https://img.shields.io/badge/React-18.3-61dafb)
![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688)

---

## ✨ Features

### 📊 Real-Time Market Data
- Live WebSocket streaming from Polygon.io
- 1,500+ tickers tracked simultaneously
- Sub-second price updates
- Volume spike detection
- Gap play identification
- After-hours momentum tracking

### ⚡ Scalping Signal Engine
- AI-powered signal generation
- Multi-indicator analysis (MACD, RSI, Stochastic, ADX)
- VWAP-based entry/exit points
- Risk/reward ratio calculation
- Session-aware filtering (best scalp windows)
- Customizable watchlist (up to 50 symbols)

### 🎯 Advanced Features
- Sector-based filtering
- Earnings calendar integration
- Portfolio tracking
- Custom alert system
- Export functionality
- Dark/Light mode
- Mobile responsive

### 🎨 Modern UI/UX
- Professional empty states
- Loading skeletons
- Toast notifications
- Ticker detail drawer
- Connection status monitoring
- Real-time updates

---

## 🚀 Quick Start

### Option 1: One-Click Start (Windows)

Double-click `start-all.bat` - it will:
1. Start backend server
2. Start frontend dev server
3. Open browser automatically

### Option 2: Manual Start

**Terminal 1 - Backend:**
```bash
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

**Terminal 2 - Frontend:**
```bash
cd frontend
npm run dev
```

**Browser:** http://localhost:5173

---

## 📋 Prerequisites

### Required
- **Python 3.8+** - Backend server
- **Node.js 16+** - Frontend build
- **Supabase Account** - Database (free tier works)
- **Polygon.io API Key** - Market data (free tier: 5 requests/min)

### Optional
- **Git** - Version control
- **VS Code** - Recommended editor

---

## 🔧 Installation

### 1. Clone Repository
```bash
git clone <your-repo-url>
cd Radar_Pro
```

### 2. Backend Setup
```bash
# Install Python dependencies
pip install -r backend/requirements.txt

# Create .env file
copy .env.example .env  # Windows
# cp .env.example .env  # Mac/Linux

# Edit .env with your credentials:
# MASSIVE_API_KEY=your_polygon_api_key
# SUPABASE_URL=your_supabase_url
# SUPABASE_SERVICE_KEY=your_service_key
```

### 3. Database Setup
```bash
# Run migration to create tables and populate stock list
python migrate_all.py
```

### 4. Frontend Setup
```bash
cd frontend

# Install dependencies
npm install

# Create .env.local
copy .env.example .env.local  # Windows
# cp .env.example .env.local  # Mac/Linux

# Should contain:
# VITE_API_BASE=http://localhost:8000
# VITE_WS_URL=ws://localhost:8000/ws/live
```

---

## 🎯 Usage

### Starting the Application

**Windows:**
```bash
start-all.bat
```

**Mac/Linux:**
```bash
# Terminal 1
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000

# Terminal 2
cd frontend && npm run dev
```

### Accessing the Dashboard

- **Frontend:** http://localhost:5173
- **Backend API:** http://localhost:8000
- **API Docs:** http://localhost:8000/docs
- **Health Check:** http://localhost:8000/health

### Key Endpoints

```
GET  /api/metrics            - System metrics
GET  /api/tickers            - Live ticker data
GET  /api/signals            - Scalping signals
GET  /api/earnings           - Earnings calendar
GET  /api/portfolio          - Portfolio holdings
WS   /ws/live                - Real-time WebSocket
```

---

## 📊 Dashboard Tabs

### 🏠 Dashboard
- Market overview
- Sector heatmap
- Top movers
- Alert summary

### 📊 Live Table
- Real-time ticker data
- Sortable columns
- Advanced filtering
- Matrix/Table view toggle

### 🔍 Chart
- TradingView integration
- Multiple timeframes
- Technical indicators
- Symbol search

### ⚡ Signals
- Live scalping signals
- Entry/exit points
- Risk/reward ratios
- Signal history

---

## 🎨 Features in Detail

### Real-Time Alerts
- 🔊 **Volume Spikes** - 2x+ average volume
- 📊 **Gap Plays** - 3%+ overnight gaps
- 🌙 **AH Momentum** - After-hours moves
- 💎 **Diamond** - 5%+ intraday moves
- 📰 **Earnings Gaps** - Pre/post earnings moves

### Signal Engine
- **Trend Analysis** (30%) - EMA stack + VWAP
- **Momentum** (35%) - MACD, RSI, Stochastic
- **Volume** (20%) - OBV + volume confirmation
- **Strength** (15%) - ADX trend quality

### Filtering Options
- Price range
- Volume thresholds
- Market cap
- Sector/Industry
- Alert types
- Custom combinations

---

## 🔒 Security

### Implemented
- ✅ Environment variable configuration
- ✅ CORS protection
- ✅ Input validation
- ✅ Rate limiting ready
- ✅ Secure WebSocket connections

### Recommended
- [ ] Add API authentication
- [ ] Implement user sessions
- [ ] Enable HTTPS in production
- [ ] Add request logging
- [ ] Set up monitoring

---

## 🚀 Deployment

### Backend (Render/Railway)
```bash
# Build command
pip install -r backend/requirements.txt

# Start command
uvicorn backend.main:app --host 0.0.0.0 --port $PORT
```

### Frontend (Vercel/Netlify)
```bash
# Build command
cd frontend && npm run build

# Output directory
frontend/dist
```

### Environment Variables
Set these in your deployment platform:
- `MASSIVE_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- `FRONTEND_ORIGIN`

---

## 📚 Documentation

- **[STARTUP_GUIDE.md](STARTUP_GUIDE.md)** - Detailed startup instructions
- **[INTEGRATION_COMPLETE.md](INTEGRATION_COMPLETE.md)** - Recent improvements
- **[IMPROVEMENTS_ROADMAP.md](IMPROVEMENTS_ROADMAP.md)** - Future features
- **[IMPLEMENTATION_GUIDE.md](IMPLEMENTATION_GUIDE.md)** - Development guide

---

## 🐛 Troubleshooting

### "Connecting to live feed..." stuck
**Solution:** Start the backend server
```bash
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

### No data showing
**Solution:** Run database migration
```bash
python migrate_all.py
```

### Port already in use
**Solution:** Kill the process
```bash
# Windows
netstat -ano | findstr :8000
taskkill /PID <PID> /F

# Mac/Linux
lsof -ti:8000 | xargs kill -9
```

### WebSocket connection fails
**Solution:** Check environment variables
```bash
# frontend/.env.local
VITE_WS_URL=ws://localhost:8000/ws/live
```

---

## 🤝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit changes (`git commit -m 'Add AmazingFeature'`)
4. Push to branch (`git push origin feature/AmazingFeature`)
5. Open Pull Request

---

## 📝 License

This project is proprietary. All rights reserved.

---

## 🙏 Acknowledgments

- **Polygon.io** - Real-time market data
- **Supabase** - Database infrastructure
- **FastAPI** - Backend framework
- **React** - Frontend framework
- **TradingView** - Charting library

---

## 📞 Support

For issues and questions:
1. Check [STARTUP_GUIDE.md](STARTUP_GUIDE.md)
2. Review [Troubleshooting](#-troubleshooting)
3. Check browser console (F12)
4. Check backend logs

---

## 🎯 Roadmap

### ✅ Completed
- [x] Real-time WebSocket streaming
- [x] Scalping signal engine
- [x] Sector filtering
- [x] Empty states & loading skeletons
- [x] Toast notifications
- [x] Ticker detail drawer
- [x] Connection status monitoring

### 🔜 Coming Soon
- [ ] Price alerts system
- [ ] Performance analytics
- [ ] Export functionality
- [ ] Advanced charting
- [ ] Mobile app
- [ ] Multi-user support

---

**Built with ❤️ for traders**
