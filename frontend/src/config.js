/**
 * config.js - Application configuration
 * Centralized configuration for API endpoints and WebSocket URLs
 */

// API Base URL - auto-detects production vs development
export const API_BASE = import.meta.env.VITE_API_BASE || 
  (import.meta.env.PROD 
    ? window.location.origin 
    : 'http://localhost:8000');

// WebSocket URL - auto-detects production vs development
export const WS_URL = import.meta.env.VITE_WS_URL || 
  (import.meta.env.PROD 
    ? `wss://${window.location.host}/ws/live`
    : 'ws://localhost:8000/ws/live');

// Refresh intervals (milliseconds)
export const REFRESH_INTERVALS = {
  METRICS: 5000,           // Poll metrics every 5s
  PORTFOLIO: 30000,        // Auto-refresh portfolio every 30s
  MONITOR: 30000,          // Auto-refresh monitor every 30s
  SIGNALS: 10000,          // Poll signals every 10s
  EARNINGS: 30000,         // Poll earnings every 30s
};

// Display settings
export const DISPLAY_SETTINGS = {
  INITIAL_ROW_COUNT: 500,  // ← FIXED: Show up to 500 rows initially (was 50)
  LOAD_MORE_INCREMENT: 250, // ← FIXED: Load 250 more at a time (was 50)
  SCROLL_THRESHOLD_PX: 200, // Pixels from bottom to trigger auto-load
  DEBOUNCE_MS: 300,        // Debounce delay for source switching
};

// Thresholds
export const THRESHOLDS = {
  STALE_PRICE_SECONDS: 300, // 5 minutes - price considered stale
  DIAMOND_PERCENT: 5,       // 5% change = diamond alert
  VOLUME_SPIKE_RATIO: 2,    // 2x volume = spike
  VOLUME_SURGE_RATIO: 5,    // 5x volume = surge
};

// LocalStorage keys
export const STORAGE_KEYS = {
  THEME: 'nexradar-theme',  // 'light', 'dark', 'high-contrast', 'auto'
  DARK_MODE: 'nexradar-dark-mode',  // Legacy - kept for backwards compatibility
  LAST_TAB: 'nexradar-last-tab',
  LAST_SOURCE: 'nexradar-last-source',
  LAST_SECTOR: 'nexradar-last-sector',
};

export default {
  API_BASE,
  WS_URL,
  REFRESH_INTERVALS,
  DISPLAY_SETTINGS,
  THRESHOLDS,
  STORAGE_KEYS,
};
