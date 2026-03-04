/**
 * logger.js - Conditional logging utility
 * Only logs in development mode to keep production console clean
 */

const isDev = import.meta.env.DEV;

export const logger = {
  log: (...args) => {
    if (isDev) console.log(...args);
  },
  
  warn: (...args) => {
    if (isDev) console.warn(...args);
  },
  
  error: (...args) => {
    // Always log errors, even in production
    console.error(...args);
  },
  
  info: (...args) => {
    if (isDev) console.info(...args);
  },
  
  debug: (...args) => {
    if (isDev) console.debug(...args);
  },
  
  table: (...args) => {
    if (isDev) console.table(...args);
  },
};

export default logger;
