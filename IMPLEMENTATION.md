# NexRadar Pro - Implementation Guide

Complete technical documentation for the NexRadar Pro real-time stock trading dashboard.

---

## Table of Contents
1. [Architecture Overview](#architecture-overview)
2. [Technology Stack](#technology-stack)
3. [System Components](#system-components)
4. [Data Flow](#data-flow)
5. [Configuration](#configuration)
6. [Database Schema](#database-schema)
7. [API Reference](#api-reference)
8. [Development Guide](#development-guide)
9. [Deployment](#deployment)

---

## Architecture Overview

NexRadar Pro is a full-stack real-time trading dashboard with:
- **Frontend**: React 18 + Vite + TailwindCSS
- **Backend**: FastAPI (Python) + WebSocket
- **Database**: Supabase (PostgreSQL)
- **Data Source**: Polygon.io (via Massive API)

### High-Level Architecture
```
┌─────────────────┐
│  Polygon.io     │ Market Data
│  WebSocket      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Backend        │ FastAPI + WebSocket Engine
│  (Python)       │ - Data processing
│                 │ - Alert detection
│                 │ - Signal generation
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Frontend       │ React + WebSocket Client
│  (React)        │ - Real-time UI
│                 │ - Multi-page dashboard
│                 │ - Theme system
└─────────────────┘
         │
         ▼
┌─────────────────┐
│  Supabase       │ PostgreSQL Database
│  (Database)     │ - Stock list
│                 │ - Portfolio
│                 │ - Signals
└─────────────────┘
```

---

## Technology Stack

### Frontend
| Technology | Version | Purpose |
|------------|---------|---------|
| React | 18.x | UI framework |
| Vite | 4.x | Build tool |
| TailwindCSS | 3.x | Styling |
| TradingView Widget | Latest | Charts |
| React Hot Toast | 2.x | Notifications |

### Backend
| Technology | Version | Purpose |
|------------|---------|---------|
| FastAPI | 0.104+ | Web framework |
| Uvicorn | 0.24+ | ASGI server |
| Supabase Client | 2.x | Database |
| yfinance | 0.2+ | Market data fallback |
| WebSocket | Built-in | Real-time streaming |

### Infrastructure
| Service | Purpose |
|---------|---------|
| Render | Hosting (frontend + backend) |
| Supabase | PostgreSQL database |
| Polygon.io | Market data API |

---

## System Components

### Frontend Structure
```
frontend/
├── src/
│   ├── App.jsx                      # Main app shell
│   ├── main.jsx                     # Entry point
│   ├── index.css                    # Global styles
│   ├── config.js                    # Configuration
│   ├── components/
│   │   ├── NexRadarDashboard.jsx   # Main dashboard (v5.0)
│   │   ├── LiveDashboard.jsx       # Legacy live table
│   │   ├── SignalFeed.jsx          # Legacy signals
│   │   ├── ChartPanel.jsx          # TradingView integration
│   │   ├── Sidebar.jsx             # Navigation
│   │   ├── TickerDetailDrawer.jsx  # Stock details
│   │   ├── UserProfile.jsx         # User menu
│   │   ├── MiniSparkline.jsx       # Price charts
│   │   ├── EmptyState.jsx          # Empty states
│   │   ├── SkeletonLoader.jsx      # Loading states
│   │   └── SectorFilter.jsx        # Sector filtering
│   ├── hooks/
│   │   └── useWebSocket.js         # WebSocket hook
│   └── utils/
│       └── logger.js               # Logging utility
├── public/                          # Static assets
├── package.json                     # Dependencies
├── vite.config.js                   # Vite config
└── tailwind.config.js               # Tailwind config
```

### Backend Structure
```
backend/
├── main.py              # FastAPI app + routes
├── ws_engine.py         # WebSocket engine
├── supabase_db.py       # Database layer
├── Scalping_Signal.py   # Signal detection
├── requirements.txt     # Dependencies
└── __init__.py          # Package init
```

---

## Data Flow

### Real-Time Data Pipeline
```
1. Polygon.io WebSocket
   ↓ (Market data stream)
2. Backend ws_engine.py
   ↓ (Process, enrich, detect alerts)
3. In-Memory Cache
   ↓ (Broadcast every 350ms)
4. Frontend WebSocket
   ↓ (Update React state)
5. UI Components
   ↓ (Render with live data)
```

### REST API Flow
```
1. Frontend Request
   ↓ (HTTP GET/POST)
2. FastAPI Endpoint
   ↓ (Validate, process)
3. Supabase Query
   ↓ (SQL query)
4. Database Response
   ↓ (JSON data)
5. Frontend State Update
   ↓ (React setState)
6. UI Re-render
```

### WebSocket Message Types
```javascript
// Snapshot (on connect)
{
  "type": "snapshot",
  "data": [
    {
      "ticker": "AAPL",
      "live_price": 175.50,
      "percent_change": 1.25,
      "volume": 50000000,
      "sector": "TECHNOLOGY",
      // ... more fields
    }
  ]
}

// Tick (real-time update)
{
  "type": "tick",
  "ticker": "AAPL",
  "data": {
    "live_price": 175.55,
    "percent_change": 1.28,
    "volume": 50100000
  }
}
```

---

## Configuration

### Environment Variables

#### Frontend (.env.local)
```bash
# API Configuration
VITE_API_BASE=http://localhost:8000          # Development
VITE_API_BASE=https://api.nexradar.info      # Production

# WebSocket Configuration
VITE_WS_URL=ws://localhost:8000/ws/live      # Development
VITE_WS_URL=wss://api.nexradar.info/ws/live  # Production
```

#### Backend (.env)
```bash
# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-service-role-key

# Polygon.io
MASSIVE_API_KEY=your-polygon-api-key

# CORS
FRONTEND_ORIGIN=http://localhost:5173        # Development
FRONTEND_ORIGIN=https://nexradar.info        # Production

# Optional
PORTFOLIO_REFRESH_INTERVAL=3.0               # Seconds
```

### Application Configuration (config.js)
```javascript
// API URLs (auto-detected)
export const API_BASE = import.meta.env.VITE_API_BASE || 
  (import.meta.env.PROD 
    ? 'https://api.nexradar.info' 
    : 'http://localhost:8000')

// Refresh Intervals (milliseconds)
export const REFRESH_INTERVALS = {
  METRICS: 5000,      // 5 seconds
  PORTFOLIO: 30000,   // 30 seconds
  MONITOR: 30000,     // 30 seconds
  SIGNALS: 10000,     // 10 seconds
  EARNINGS: 30000,    // 30 seconds
}

// Display Settings
export const DISPLAY_SETTINGS = {
  INITIAL_ROW_COUNT: 50,
  LOAD_MORE_INCREMENT: 50,
  SCROLL_THRESHOLD_PX: 200,
  DEBOUNCE_MS: 300,
}

// Thresholds
export const THRESHOLDS = {
  STALE_PRICE_SECONDS: 300,  // 5 minutes
  DIAMOND_PERCENT: 5,         // 5% change
  VOLUME_SPIKE_RATIO: 2,      // 2x volume
  VOLUME_SURGE_RATIO: 5,      // 5x volume
}

// Storage Keys
export const STORAGE_KEYS = {
  DARK_MODE: 'nexradar-dark-mode',
  THEME: 'nexradar-theme',
  FILTERS: 'nexradar-filters',
}
```

---

## Database Schema

### stock_list
Primary table with all tracked tickers.

| Column | Type | Description |
|--------|------|-------------|
| ticker | TEXT (PK) | Stock symbol |
| company_name | TEXT | Full company name |
| sector | TEXT | Sector classification |
| market_cap | BIGINT | Market capitalization |
| avg_volume | BIGINT | Average daily volume |
| is_active | INTEGER | 1 = active, 0 = inactive |

**Indexes**: ticker (PK), sector

### live_tickers
Real-time price data (updated via WebSocket).

| Column | Type | Description |
|--------|------|-------------|
| ticker | TEXT (PK) | Stock symbol |
| live_price | REAL | Current price |
| change_value | REAL | Price change ($) |
| percent_change | REAL | Price change (%) |
| volume | BIGINT | Current volume |
| volume_spike | INTEGER | 1 if volume spike |
| is_gap_play | INTEGER | 1 if gap play |
| ah_momentum | INTEGER | 1 if AH momentum |
| last_update | TIMESTAMP | Last update time |

**Indexes**: ticker (PK), last_update

### portfolio
User's portfolio holdings.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER (PK) | Auto-increment ID |
| ticker | TEXT | Stock symbol |
| shares | REAL | Number of shares |
| avg_cost | REAL | Average cost basis |
| notes | TEXT | User notes |

**Indexes**: id (PK), ticker

### monitor
User's watchlist.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER (PK) | Auto-increment ID |
| ticker | TEXT | Stock symbol |
| added_at | TIMESTAMP | Date added |

**Indexes**: id (PK), ticker

### signals
Generated scalping signals.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER (PK) | Auto-increment ID |
| symbol | TEXT | Stock symbol |
| direction | TEXT | LONG or SHORT |
| entry_price | REAL | Entry price |
| stop_loss | REAL | Stop loss price |
| take_profit | REAL | Take profit price |
| risk_reward | REAL | Risk:Reward ratio |
| score | INTEGER | Signal score (0-100) |
| confidence | TEXT | WEAK/MEDIUM/STRONG |
| created_at | TIMESTAMP | Signal timestamp |

**Indexes**: id (PK), symbol, created_at

### earnings
Earnings calendar.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER (PK) | Auto-increment ID |
| ticker | TEXT | Stock symbol |
| earnings_date | DATE | Earnings date |
| earnings_time | TEXT | BMO or AMC |
| company_name | TEXT | Company name |

**Indexes**: id (PK), ticker, earnings_date

---

## API Reference

### REST Endpoints

#### GET /health
Health check endpoint.

**Response**:
```json
{
  "status": "ok",
  "ts": 1234567890
}
```

#### GET /api/metrics
System metrics and alert counts.

**Response**:
```json
{
  "ws_health": "Healthy",
  "total_tickers": 6032,
  "live_count": 1500,
  "volume_spikes": 45,
  "gap_plays": 12,
  "diamonds": 8,
  "ah_momentum": 23
}
```

#### GET /api/tickers
Live stock data with filtering.

**Query Parameters**:
- `limit` (int): Max results (default: 100)
- `only_positive` (bool): Only positive changes
- `source` (str): Filter by source (all/portfolio/monitor/earnings)
- `sector` (str): Filter by sector

**Response**:
```json
[
  {
    "ticker": "AAPL",
    "company_name": "Apple Inc",
    "live_price": 175.50,
    "change_value": 2.15,
    "percent_change": 1.24,
    "volume": 50000000,
    "sector": "TECHNOLOGY",
    "volume_spike": 0,
    "is_gap_play": 0
  }
]
```

#### GET /api/portfolio
User's portfolio holdings.

**Response**:
```json
[
  {
    "ticker": "AAPL",
    "shares": 100,
    "avg_cost": 150.00,
    "notes": "Long-term hold"
  }
]
```

#### GET /api/monitor
User's watchlist.

**Response**:
```json
[
  {
    "ticker": "TSLA",
    "added_at": "2026-03-01T10:00:00Z"
  }
]
```

#### GET /api/earnings
Earnings calendar.

**Query Parameters**:
- `start` (date): Start date (YYYY-MM-DD)
- `end` (date): End date (YYYY-MM-DD)

**Response**:
```json
[
  {
    "ticker": "AAPL",
    "earnings_date": "2026-03-15",
    "earnings_time": "AMC",
    "company_name": "Apple Inc"
  }
]
```

#### GET /api/signals
Recent scalping signals.

**Query Parameters**:
- `limit` (int): Max results (default: 50)

**Response**:
```json
[
  {
    "symbol": "AAPL",
    "direction": "LONG",
    "entry_price": 175.50,
    "stop_loss": 173.00,
    "take_profit": 180.00,
    "risk_reward": 1.8,
    "score": 75,
    "confidence": "STRONG",
    "created_at": "2026-03-04T14:30:00Z"
  }
]
```

#### POST /api/signals
Insert new signal.

**Request Body**:
```json
{
  "symbol": "AAPL",
  "direction": "LONG",
  "entry_price": 175.50,
  "stop_loss": 173.00,
  "take_profit": 180.00,
  "risk_reward": 1.8,
  "score": 75,
  "confidence": "STRONG"
}
```

**Response**:
```json
{
  "success": true,
  "id": 123
}
```

### WebSocket Endpoint

#### WS /ws/live
Real-time stock data stream.

**Connection**:
```javascript
const ws = new WebSocket('ws://localhost:8000/ws/live')
```

**Messages**:
1. **Snapshot** (on connect): Full data array
2. **Tick** (real-time): Individual ticker updates

**Example**:
```javascript
ws.onmessage = async (event) => {
  let data = event.data
  if (data instanceof Blob) {
    data = await data.text()
  }
  const msg = JSON.parse(data)
  
  if (msg.type === 'snapshot') {
    // Initial data load
    console.log('Received', msg.data.length, 'tickers')
  } else if (msg.type === 'tick') {
    // Real-time update
    console.log('Update for', msg.ticker, msg.data)
  }
}
```

---

## Development Guide

### Local Setup

#### Prerequisites
- Python 3.9+
- Node.js 16+
- Supabase account
- Polygon.io API key

#### Backend Setup
```bash
# Install dependencies
pip install -r backend/requirements.txt

# Set environment variables
cp .env.example .env
# Edit .env with your credentials

# Run migration
python migrate_all.py

# Start server
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
```

#### Frontend Setup
```bash
# Install dependencies
cd frontend
npm install

# Set environment variables
cp .env.example .env.local
# Edit .env.local with API URLs

# Start dev server
npm run dev
```

### Development Workflow

#### Hot Reload
- Backend: Auto-reloads on file save (with `--reload` flag)
- Frontend: Vite HMR (instant updates)

#### Logging
```javascript
// Frontend (use logger, not console.log)
import { logger } from './utils/logger'
logger.log('[Component] Message')  // Dev only
logger.error('[Component] Error')  // Always shown
```

```python
# Backend (use logging module)
import logging
logger = logging.getLogger(__name__)
logger.info('[Module] Message')
logger.error('[Module] Error')
```

#### Testing
```bash
# Backend health check
curl http://localhost:8000/health

# Frontend build test
cd frontend
npm run build
npm run preview
```

---

## Deployment

### Backend (Render)

**Build Command**:
```bash
pip install -r backend/requirements.txt
```

**Start Command**:
```bash
uvicorn backend.main:app --host 0.0.0.0 --port $PORT
```

**Environment Variables**:
- SUPABASE_URL
- SUPABASE_KEY
- MASSIVE_API_KEY
- FRONTEND_ORIGIN

### Frontend (Render/Vercel)

**Build Command**:
```bash
cd frontend && npm install && npm run build
```

**Publish Directory**:
```
frontend/dist
```

**Environment Variables**:
- VITE_API_BASE
- VITE_WS_URL

### Database (Supabase)

**Migration**:
```bash
python migrate_all.py
```

**Verification**:
```sql
SELECT COUNT(*) FROM stock_list;
-- Should return 6032
```

---

## Performance Optimization

### Implemented
- WebSocket message throttling (350ms)
- Database batch writes (1s flush)
- React useMemo for expensive calculations
- Conditional logging (dev only)
- 30s refresh for portfolio/monitor (90% fewer API calls)

### Monitoring
- Backend: Render dashboard (CPU, memory, requests)
- Frontend: Browser DevTools (network, performance)
- Database: Supabase dashboard (queries, connections)

---

## Security

### Best Practices
- Environment variables for sensitive data
- CORS configuration for production domains
- HTTPS enforcement in production
- WebSocket authentication (API key)
- Input validation on all endpoints
- Parameterized SQL queries (no injection)

---

## Support

### Documentation
- `CHANGELOG.md` - All changes and fixes
- `ROADMAP.md` - Future plans
- `DEPLOYMENT_CHECKLIST.md` - Production deployment
- `LOCAL_DEVELOPMENT.md` - Local setup

### Resources
- GitHub: [repository URL]
- Website: https://nexradar.info
- API Docs: https://api.nexradar.info/docs

---

**Last Updated**: 2026-03-04  
**Version**: 5.0.0  
**Status**: Production Ready ✅
