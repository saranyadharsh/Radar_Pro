# 🚀 NexRadar Pro - Real-Time Stock Market Dashboard

Professional-grade trading dashboard with real-time WebSocket data, scalping signals, and comprehensive market analytics.

![Python](https://img.shields.io/badge/Python-3.8+-blue) ![React](https://img.shields.io/badge/React-18.3-61dafb) ![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688)

---

## ✨ Features

- **Real-Time Data**: Live WebSocket streaming from Polygon.io (1,500+ tickers)
- **Scalping Signals**: AI-powered signal generation with MACD, RSI, Stochastic, ADX
- **Advanced Filtering**: Sector-based, volume spikes, gap plays, earnings gaps
- **Modern UI/UX**: Empty states, loading skeletons, toast notifications, ticker detail drawer
- **Portfolio Tracking**: Monitor holdings with P&L calculations
- **Earnings Calendar**: Track upcoming earnings with pre/post market indicators

---

## 🚀 Quick Start

### Prerequisites
- Python 3.8+
- Node.js 16+
- Supabase account (free tier)
- Polygon.io API key (free tier: 5 req/min)

### Installation

**1. Clone and setup backend:**
```bash
# Install dependencies
pip install -r backend/requirements.txt

# Create .env file
cp .env.example .env

# Edit .env with your credentials:
# MASSIVE_API_KEY=your_polygon_api_key
# SUPABASE_URL=your_supabase_url
# SUPABASE_SERVICE_KEY=your_service_key

# Run database migration
python migrate_all.py
```

**2. Setup frontend:**
```bash
cd frontend
npm install

# Create .env.local
cp .env.example .env.local

# Should contain:
# VITE_API_BASE=http://localhost:8000
# VITE_WS_URL=ws://localhost:8000/ws/live
```

### Running the Application

**Terminal 1 - Backend:**
```bash
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

**Terminal 2 - Frontend:**
```bash
cd frontend
npm run dev
```

**Access:** http://localhost:5173

---

## 📊 API Endpoints

```
GET  /health                 - Health check
GET  /api/metrics            - System metrics
GET  /api/tickers            - Live ticker data
GET  /api/signals            - Scalping signals
GET  /api/earnings           - Earnings calendar
GET  /api/portfolio          - Portfolio holdings
GET  /api/monitor            - Watchlist
WS   /ws/live                - Real-time WebSocket
```

---

## 🎯 Dashboard Features

### Real-Time Alerts
- 🔊 **Volume Spikes** - 2x+ average volume
- 📊 **Gap Plays** - 3%+ overnight gaps
- 🌙 **AH Momentum** - After-hours moves
- 💎 **Diamond** - 5%+ intraday moves
- 📰 **Earnings Gaps** - Pre/post earnings

### Signal Engine
- **Trend Analysis** (30%) - EMA stack + VWAP
- **Momentum** (35%) - MACD, RSI, Stochastic
- **Volume** (20%) - OBV + volume confirmation
- **Strength** (15%) - ADX trend quality

### UI Components
- **Empty States** - Helpful messages when no data
- **Loading Skeletons** - Smooth loading animations
- **Toast Notifications** - Real-time feedback
- **Ticker Drawer** - Detailed ticker information
- **Connection Banner** - WebSocket status monitoring

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
```bash
# Windows
netstat -ano | findstr :8000
taskkill /PID <PID> /F

# Mac/Linux
lsof -ti:8000 | xargs kill -9
```

### WebSocket connection fails
Check `frontend/.env.local`:
```
VITE_WS_URL=ws://localhost:8000/ws/live
```

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
Set in deployment platform:
- `MASSIVE_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- `FRONTEND_ORIGIN`

---

## 🔒 Security

### Implemented
- ✅ Environment variable configuration
- ✅ CORS protection
- ✅ Input validation
- ✅ Secure WebSocket connections
- ✅ .gitignore configured for secrets

### Best Practices
- Never commit `.env` files
- Use `.env.example` for templates
- Rotate API keys if exposed
- Enable HTTPS in production

---

## 📦 Project Structure

```
nexradar-pro/
├── backend/
│   ├── main.py              # FastAPI application
│   ├── supabase_db.py       # Database layer
│   ├── ws_engine.py         # WebSocket engine
│   ├── Scalping_Signal.py   # Signal generation
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── App.jsx
│   │   ├── components/
│   │   │   ├── EmptyState.jsx
│   │   │   ├── SkeletonLoader.jsx
│   │   │   ├── TickerDetailDrawer.jsx
│   │   │   ├── LiveDashboard.jsx
│   │   │   └── ...
│   │   └── hooks/
│   │       └── useWebSocket.js
│   ├── package.json
│   └── vite.config.js
├── .env.example             # Environment template
├── .gitignore
├── schema.sql               # Database schema
└── README.md
```

---

## 🎨 Recent Improvements

### UI/UX Enhancements
- ✅ Professional empty states with helpful messages
- ✅ Loading skeletons for better perceived performance
- ✅ Toast notifications for user feedback
- ✅ Ticker detail drawer for comprehensive information
- ✅ Connection status banner for WebSocket monitoring
- ✅ Enhanced error handling and messaging

### Technical Improvements
- ✅ Optimized WebSocket connection with auto-reconnect
- ✅ Improved state management
- ✅ Better error boundaries
- ✅ Enhanced animations with Tailwind
- ✅ Mobile-responsive design

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

For issues:
1. Check backend is running: `http://localhost:8000/health`
2. Check browser console (F12) for errors
3. Verify environment variables are set
4. Check WebSocket connection in Network tab

---

**Built with ❤️ for traders**
