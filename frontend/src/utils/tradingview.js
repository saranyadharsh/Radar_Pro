/**
 * tradingview.js - TradingView symbol utilities
 * Determines correct exchange prefix for TradingView charts
 */

// Common NYSE-listed tickers
// This is a curated list of well-known NYSE stocks
// For unknown tickers, we default to NASDAQ
const NYSE_TICKERS = new Set([
  // Major Banks & Financial Services
  'BAC', 'JPM', 'WFC', 'C', 'GS', 'MS', 'USB', 'PNC', 'TFC', 'BK', 'STT', 'BLK',
  'AXP', 'COF', 'DFS', 'SYF', 'BX', 'KKR', 'APO', 'CG', 'SCHW',
  
  // Retail & Consumer
  'WMT', 'TGT', 'HD', 'LOW', 'KSS', 'M', 'JWN', 'DG', 'DLTR', 'BBY',
  
  // Food & Beverage
  'KO', 'PEP', 'MCD', 'SBUX', 'YUM', 'CMG', 'DPZ', 'QSR', 'WEN',
  
  // Pharmaceuticals & Healthcare
  'PFE', 'JNJ', 'MRK', 'ABT', 'LLY', 'BMY', 'ABBV', 'TMO', 'DHR', 'CVS', 'CI', 'HUM', 'UNH',
  
  // Energy
  'XOM', 'CVX', 'COP', 'SLB', 'EOG', 'PSX', 'VLO', 'MPC', 'OXY', 'HAL', 'BKR',
  
  // Industrials & Manufacturing
  'BA', 'CAT', 'MMM', 'GE', 'HON', 'UPS', 'LMT', 'RTX', 'DE', 'EMR', 'ETN',
  
  // Automotive
  'GM', 'F', 'TM', 'HMC', 'STLA',
  
  // Telecommunications
  'T', 'VZ', 'TMUS',
  
  // Technology (NYSE-listed)
  'IBM', 'HPE', 'HPQ', 'DELL', 'SNOW', 'PLTR', 'U', 'RBLX', 'DASH', 'ABNB',
  
  // Media & Entertainment
  'DIS', 'CMCSA', 'PARA', 'WBD', 'NFLX', 'SPOT',
  
  // Payment Networks
  'V', 'MA', 'AXP', 'DFS', 'SYF',
  
  // Airlines
  'DAL', 'UAL', 'AAL', 'LUV', 'ALK', 'JBLU',
  
  // Utilities
  'NEE', 'DUK', 'SO', 'D', 'AEP', 'EXC', 'SRE', 'PEG', 'XEL', 'ED',
  
  // Real Estate
  'AMT', 'PLD', 'CCI', 'EQIX', 'PSA', 'SPG', 'O', 'WELL', 'AVB', 'EQR',
  
  // Insurance
  'BRK.A', 'BRK.B', 'PGR', 'TRV', 'ALL', 'AIG', 'MET', 'PRU', 'AFL', 'HIG',
  
  // Materials & Chemicals
  'LIN', 'APD', 'ECL', 'SHW', 'DD', 'DOW', 'PPG', 'NEM', 'FCX',
  
  // Consumer Goods
  'PG', 'KMB', 'CL', 'EL', 'CLX',
  
  // Misc
  'UNF', 'NKE', 'LULU', 'TJX', 'ROST', 'GPS', 'ANF', 'AEO',
  'FDX', 'UBER', 'LYFT', 'ABNB', 'DASH',
  'BABA', 'JD', 'PDD', 'BIDU',
  'TSM', 'ASML',
  'RIO', 'BHP', 'VALE',
  'SQ', 'PYPL', 'COIN',
  'SHOP', 'MELI',
  'ZM', 'DOCU', 'TWLO', 'NET', 'DDOG', 'MDB',
  'PINS', 'SNAP', 'MTCH',
  'UBER', 'LYFT', 'DASH', 'ABNB',
  'RIVN', 'LCID',
  'SOFI', 'AFRM', 'UPST',
  'HOOD', 'COIN',
  'RBLX', 'U', 'DKNG', 'PENN',
  'TDOC', 'HIMS', 'DOCS',
  'PTON', 'LULU', 'NKE',
  'ETSY', 'W', 'CHWY',
  'BYND', 'TTCF',
  'SPCE', 'ASTR',
  'OPEN', 'RDFN', 'Z', 'COMP',
  'CVNA', 'KMX', 'AN',
  'WYNN', 'LVS', 'MGM', 'CZR',
  'MAR', 'HLT', 'H', 'IHG',
  'RCL', 'CCL', 'NCLH',
  'EXPE', 'BKNG', 'ABNB',
  'SBNY', 'PACW', 'WAL', 'ZION', 'HBAN', 'RF', 'KEY', 'CFG', 'FITB', 'MTB',
]);

/**
 * Get the correct TradingView symbol with exchange prefix
 * @param {string} ticker - Stock ticker symbol (e.g., 'AAPL', 'UNF')
 * @returns {string} - TradingView symbol with exchange (e.g., 'NASDAQ:AAPL', 'NYSE:UNF')
 */
export function getTradingViewSymbol(ticker) {
  if (!ticker) return '';
  
  const upperTicker = ticker.toUpperCase();
  
  // Check if it's a known NYSE ticker
  if (NYSE_TICKERS.has(upperTicker)) {
    return `NYSE:${upperTicker}`;
  }
  
  // For unknown tickers, let TradingView auto-detect the exchange
  // This works better than defaulting to NASDAQ
  return upperTicker;
}

/**
 * Get TradingView chart URL
 * @param {string} ticker - Stock ticker symbol
 * @returns {string} - Full TradingView chart URL
 */
export function getTradingViewChartUrl(ticker) {
  return `https://www.tradingview.com/chart/?symbol=${getTradingViewSymbol(ticker)}`;
}
