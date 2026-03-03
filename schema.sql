-- ============================================================
-- NexRadar Pro — Supabase PostgreSQL Schema
-- Migrated from SQLite (RadarProDatabase)
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor)
-- ============================================================

-- Enable realtime on live_tickers for instant frontend updates
-- (Set in Supabase Dashboard → Database → Replication)

-- ============================================================
-- TABLE 1: STOCK_LIST
-- ============================================================
CREATE TABLE IF NOT EXISTS stock_list (
    ticker       TEXT PRIMARY KEY,
    company_name TEXT NOT NULL,
    sector       TEXT,
    sub_sector   TEXT,
    market_cap   REAL,
    last_updated BIGINT NOT NULL,
    is_active    INTEGER DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_stock_sector ON stock_list(sector, sub_sector) WHERE is_active = 1;

-- ============================================================
-- TABLE 2: MONITOR (watchlist)
-- ============================================================
CREATE TABLE IF NOT EXISTS monitor (
    ticker       TEXT PRIMARY KEY,
    company_name TEXT,
    added_date   BIGINT NOT NULL,
    notes        TEXT
);

-- ============================================================
-- TABLE 3: PORTFOLIO
-- ============================================================
CREATE TABLE IF NOT EXISTS portfolio (
    ticker       TEXT PRIMARY KEY,
    company_name TEXT,
    shares       REAL,
    avg_cost     REAL,
    added_date   BIGINT NOT NULL,
    notes        TEXT
);

-- ============================================================
-- TABLE 4: EARNINGS CALENDAR
-- ============================================================
CREATE TABLE IF NOT EXISTS earnings (
    ticker         TEXT NOT NULL,
    company_name   TEXT,
    earnings_date  TEXT NOT NULL,
    earnings_time  TEXT,
    last_sync      BIGINT NOT NULL,
    source         TEXT DEFAULT 'api',
    PRIMARY KEY (ticker, earnings_date)
);

CREATE INDEX IF NOT EXISTS idx_earnings_date ON earnings(earnings_date, earnings_time);

-- ============================================================
-- TABLE 5: LIVE_TICKERS (core real-time table)
-- ============================================================
CREATE TABLE IF NOT EXISTS live_tickers (
    ticker          TEXT PRIMARY KEY,
    company_name    TEXT,
    live_price      REAL NOT NULL,
    open_price      REAL DEFAULT 0,
    prev_close      REAL DEFAULT 0,
    day_high        REAL DEFAULT 0,
    day_low         REAL DEFAULT 0,
    volume          BIGINT DEFAULT 0,
    change_value    REAL DEFAULT 0,
    percent_change  REAL DEFAULT 0,
    last_update     BIGINT NOT NULL,
    update_count    INTEGER DEFAULT 1,
    source          TEXT DEFAULT 'websocket',
    is_positive     INTEGER DEFAULT 1,
    went_positive   INTEGER DEFAULT 0,
    -- Extended alert fields
    volume_spike        BOOLEAN DEFAULT FALSE,
    volume_spike_level  TEXT DEFAULT 'none',
    volume_ratio        REAL DEFAULT 0,
    gap_percent         REAL DEFAULT 0,
    is_gap_play         BOOLEAN DEFAULT FALSE,
    gap_direction       TEXT DEFAULT 'none',
    gap_magnitude       TEXT DEFAULT 'normal',
    ah_momentum         BOOLEAN DEFAULT FALSE,
    pullback_state      TEXT DEFAULT 'neutral',
    today_close         REAL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_live_update  ON live_tickers(last_update DESC);
CREATE INDEX IF NOT EXISTS idx_live_change  ON live_tickers(change_value DESC) WHERE is_positive = 1;
CREATE INDEX IF NOT EXISTS idx_live_percent ON live_tickers(percent_change DESC) WHERE is_positive = 1;

-- ============================================================
-- TABLE 6: SCALPING SIGNALS
-- ============================================================
CREATE TABLE IF NOT EXISTS signals (
    id           BIGSERIAL PRIMARY KEY,
    symbol       TEXT NOT NULL,
    direction    TEXT NOT NULL,       -- LONG | SHORT
    score        REAL,
    confidence   REAL,
    strength     TEXT,                -- STRONG | MODERATE | WEAK
    entry_price  REAL,
    stop_loss    REAL,
    take_profit  REAL,
    risk_reward  REAL,
    reasons      JSONB,
    session      TEXT,
    created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_signals_time   ON signals(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_signals_symbol ON signals(symbol, created_at DESC);

-- ============================================================
-- TABLE 7: ERROR_LOG
-- ============================================================
CREATE TABLE IF NOT EXISTS error_log (
    id            BIGSERIAL PRIMARY KEY,
    ticker        TEXT NOT NULL,
    error_type    TEXT NOT NULL,
    error_message TEXT,
    timestamp     BIGINT NOT NULL,
    retry_count   INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_error_ticker ON error_log(ticker, timestamp DESC);


-- ============================================================
-- ROW LEVEL SECURITY (RLS) — Public read, service-role write
-- ============================================================
ALTER TABLE live_tickers  ENABLE ROW LEVEL SECURITY;
ALTER TABLE signals       ENABLE ROW LEVEL SECURITY;
ALTER TABLE earnings      ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_list    ENABLE ROW LEVEL SECURITY;

-- Allow anyone to SELECT (frontend reads without auth)
CREATE POLICY "public_read_live"     ON live_tickers  FOR SELECT USING (true);
CREATE POLICY "public_read_signals"  ON signals       FOR SELECT USING (true);
CREATE POLICY "public_read_earnings" ON earnings      FOR SELECT USING (true);
CREATE POLICY "public_read_stocks"   ON stock_list    FOR SELECT USING (true);

-- Only service role (backend) can INSERT/UPDATE/DELETE
-- (The service key in your backend env bypasses RLS automatically)
