// utils.js — NexRadar Pro
// Pure helper functions: formatters, sector normalization, week dates, sector totals

import { SECTORS, MAX_TICKERS } from './constants.js';

export const fmt2   = n => Number(n || 0).toFixed(2);
export const pct    = n => `${n >= 0 ? "+" : ""}${Number(n || 0).toFixed(2)}%`;
export const fmtK   = n => n >= 1e9 ? `$${(n/1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n/1e6).toFixed(0)}M` : n ? `$${n}` : "—";
export const fmtVol = n => n >= 1e9 ? `${(n/1e9).toFixed(1)}B` : n >= 1e6 ? `${(n/1e6).toFixed(1)}M` : n >= 1e3 ? `${(n/1e3).toFixed(0)}K` : n ? `${n}` : "—";

export function fmtBig(n) {
  if (!n) return "—";
  if (n >= 1e12) return `$${(n/1e12).toFixed(2)}T`;
  if (n >= 1e9)  return `$${(n/1e9).toFixed(2)}B`;
  if (n >= 1e6)  return `$${(n/1e6).toFixed(2)}M`;
  return `$${n.toLocaleString()}`;
}
export function fmtVolBig(n) {
  if (!n) return "—";
  if (n >= 1e9) return `${(n/1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n/1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n/1e3).toFixed(1)}K`;
  return String(n);
}
export function timeAgo(d) {
  if (!d) return "";
  const m = Math.floor((Date.now() - new Date(d)) / 60000);
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.floor(m/60)}h ago`;
  return `${Math.floor(m/1440)}d ago`;
}

// ─── Market session detection (ET, client-side) ─────────────────────────────
export function getMarketSession() {
  const et  = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day = et.getDay();
  const hm  = et.getHours() * 60 + et.getMinutes();
  if (day === 0 || day === 6)            return "closed";
  if (hm >= 20 * 60 || hm < 4 * 60)    return "closed";
  if (hm < 9 * 60 + 30)                 return "pre";
  if (hm < 16 * 60)                     return "market";
  if (hm < 20 * 60)                     return "after";
  return "closed";
}

// ─── Sector normalization ────────────────────────────────────────────────────
export function normalizeSector(sectorName) {
  if (!sectorName) return null;
  const s = sectorName.toUpperCase().trim();
  if (s === "TECHNOLOGY" || s === "TECH") return "TECHNOLOGY";
  if (s === "CONSUMER" || s === "CONSUMER DISCRETIONARY" || s === "CONSUMER STAPLES") return "CONSUMER";
  if (s === "BANKING" || s === "FINANCIALS" || s === "FINANCIAL SERVICES") return "BANKING";
  if (s === "BIO" || s === "BIOTECHNOLOGY" || s === "HEALTHCARE" || s === "HEALTH CARE") return "BIO";
  if (s === "BM & UENE" || s === "BM&ENERGY" || s === "BASIC MATERIALS" || s === "ENERGY" || s === "UTILITIES") return "BM & UENE";
  if (s === "REALCOM" || s === "REAL ESTATE" || s === "COMMUNICATION SERVICES" || s === "TELECOMMUNICATIONS") return "REALCOM";
  if (s === "INDUSTRIALS" || s === "INDUSTRIAL") return "INDUSTRIALS";
  if (s.includes("TECH")) return "TECHNOLOGY";
  if (s.includes("CONSUMER")) return "CONSUMER";
  if (s.includes("BANK") || s.includes("FINANC")) return "BANKING";
  if (s.includes("BIO") || s.includes("HEALTH")) return "BIO";
  if (s.includes("ENERGY") || s.includes("MATERIAL") || s.includes("UTILIT")) return "BM & UENE";
  if (s.includes("REAL") || s.includes("COMM")) return "REALCOM";
  if (s.includes("INDUSTR")) return "INDUSTRIALS";
  return null;
}

// ─── Sector total (capped at MAX_TICKERS) ────────────────────────────────────
export function computeSectorTotal(selectedIds) {
  if (selectedIds.includes("ALL") || selectedIds.length === 0) return MAX_TICKERS;
  const total = selectedIds.reduce((sum, id) => {
    const s = SECTORS.find(x => x.id === id);
    return sum + (s?.count || 0);
  }, 0);
  return Math.min(total, MAX_TICKERS);
}

// ─── Week date helper (Mon–Fri) ──────────────────────────────────────────────
export function getWeekDates(offsetWeeks = 0) {
  const today = new Date();
  const dow = today.getDay();
  const monday = new Date(today);
  monday.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1) + offsetWeeks * 7);
  return ["MON","TUE","WED","THU","FRI"].map((d, i) => {
    const dt = new Date(monday);
    dt.setDate(monday.getDate() + i);
    const iso = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
    return {
      day: d,
      date: dt.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      isoDate: iso,
      isToday: dt.toDateString() === today.toDateString(),
    };
  });
}
