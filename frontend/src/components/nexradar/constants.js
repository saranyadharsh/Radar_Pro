// constants.js — NexRadar Pro
// All static data: sectors, nav, intervals, session meta, limits

export const MAX_TICKERS = 1500;

export const SECTORS = [
  { id: "ALL",         label: "ALL",          color: "#00d4ff",    count: 6027 },
  { id: "TECHNOLOGY",  label: "TECHNOLOGY",   color: "#00d4ff",    count: 775  },
  { id: "CONSUMER",    label: "CONSUMER",     color: "#ffc400",    count: 823  },
  { id: "BANKING",     label: "BANKING",      color: "#00e676",    count: 1002 },
  { id: "BIO",         label: "BIO",          color: "#b388ff",    count: 1150 },
  { id: "BM & UENE",   label: "BM & UENE",    color: "#ff6d00",    count: 659  },
  { id: "REALCOM",     label: "REALCOM",      color: "#00bcd4",    count: 639  },
  { id: "INDUSTRIALS", label: "INDUSTRIALS",  color: "#78909c",    count: 979  },
  { id: "EARNINGS",    label: "EARNINGS",     color: "#ffc400",    count: null },
];

export const NAV = [
  { id: "dashboard", label: "Dashboard",  icon: "⬡" },
  { id: "screener",  label: "Screener",   icon: "⌖" },
  { id: "live",      label: "Live Table", icon: "◈" },
  { id: "chart",     label: "Chart",      icon: "◇" },
  { id: "scanner",   label: "Scanner",    icon: "◈" },
  { id: "signals",   label: "Signals",    icon: "◉" },
  { id: "earnings",  label: "Earnings",   icon: "◎" },
  { id: "portfolio", label: "Portfolio",  icon: "◆" },
];

// TradingView interval map: NexRadar TF keys → TradingView interval strings
export const TV_INTERVAL_MAP = {
  "1":"1", "5":"5", "15":"15", "60":"60", "240":"240",
  "D":"D", "W":"W",
  // PageChart TF_MAP aliases
  "1m":"1", "5m":"5", "15m":"15", "1H":"60", "4H":"240", "1D":"D", "1W":"W",
};

export const SESSION_META = {
  market: { chipLabel: "● MARKET OPEN",  chipColorKey: "green",  subMode: "MH" },
  pre:    { chipLabel: "● PRE-MARKET",   chipColorKey: "gold",   subMode: "AH" },
  after:  { chipLabel: "● AFTER HOURS",  chipColorKey: "purple", subMode: "AH" },
  closed: { chipLabel: "● OVERNIGHT",    chipColorKey: "text2",  subMode: "AH" },
};
