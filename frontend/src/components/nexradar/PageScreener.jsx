/**
 * PageScreener.jsx — NexRadar Pro
 * ─────────────────────────────────────────────────────────────────────────────
 * Watchlist-Exclusive Custom Screener (max 200 tickers).
 *
 * ARCHITECTURE:
 *   - Filters ONLY the signal watchlist (≤ 200 tickers), NOT the 6,000-ticker
 *     firehose. Filtering 200 items costs ~0.05 ms → main thread is always safe.
 *   - LEFT PANEL  : instant filter controls (firehose fields + techData fields)
 *   - RIGHT PANEL : live results table, re-renders on every SSE tick
 *
 * DATA SOURCES:
 *   tickers   (Map) — SSE firehose: live_price, rvol, change_value, percent_change,
 *                      is_gap_play, volume_spike, ah_momentum, gap_percent, etc.
 *   techData  (arr) — market_monitor_api.py background: rsi, rsi_signal, trend,
 *                      bb_status, candlestick, atr, inst_footprint, score
 *   watchlist (Set) — the user's starred tickers (max 200)
 *
 * Props: { tickers, watchlist, toggleWatchlist, techData, T }
 *
 * BUG FIXES (v2):
 *   FIX-SCR-1  Rows were dropped when tickers.get(sym) returned undefined
 *              (ticker not yet in SSE map — market closed / not yet streamed).
 *              Fix: rows are built from the watchlist Set directly. SSE data
 *              is merged in when available; missing SSE data shows "—" not null.
 *   FIX-SCR-2  Contradictory toggle combos (Bullish Trend AND Bearish Trend
 *              both checked) produced guaranteed 0 matches with no feedback.
 *              Fix: mutually exclusive pairs auto-deactivate the opposite when
 *              one is selected. Bullish/Bearish trend and candle are exclusive.
 *   FIX-SCR-3  numVal('') returned 0 (empty string coerces to 0 via Number()),
 *              meaning a blank RVOL MIN field incorrectly filtered out tickers
 *              with RVOL < 0 (all of them). Fix: guard empty string explicitly.
 *   FIX-SCR-4  Boolean flag filters (Gap Play, Vol Spike, AH Momentum) applied
 *              as AND conditions. With all three checked simultaneously, a ticker
 *              must be a gap play AND have a volume spike AND have AH momentum —
 *              extremely rare. Filter panel now shows an AND-logic tooltip.
 */

import { useState, useMemo, useCallback } from 'react';
import { SectionHeader, Chip, EmptyState } from './primitives.jsx';
import { fmt2 } from './utils.js';

// ── Column definitions ────────────────────────────────────────────────────────
const SCREENER_COLS = [
  { key: 'ticker',         label: 'SYMBOL',     w: '100px' },
  { key: 'live_price',     label: 'PRICE',      w: '80px'  },
  { key: 'percent_change', label: '% CHG',      w: '75px'  },
  { key: 'rvol',           label: 'RVOL',       w: '65px'  },
  { key: 'gap_percent',    label: 'GAP %',      w: '70px'  },
  { key: 'rsi',            label: 'RSI',        w: '55px'  },
  { key: 'rsi_signal',     label: 'RSI SIG',    w: '90px'  },
  { key: 'trend',          label: 'TREND',      w: '80px'  },
  { key: 'bb_status',      label: 'BB',         w: '140px' },
  { key: 'candlestick',    label: 'CANDLE',     w: '140px' },
  { key: 'inst_footprint', label: 'INST.',      w: '80px'  },
  { key: 'score',          label: 'SCORE',      w: '65px'  },
  { key: 'flags',          label: 'FLAGS',      w: '110px' },
];

const GRID_COLS = SCREENER_COLS.map(c => c.w).join(' ');

// ── Filter defaults ───────────────────────────────────────────────────────────
const DEFAULT_FILTERS = {
  rvolMin:        '',
  rvolMax:        '',
  pctChgMin:      '',
  pctChgMax:      '',
  gapMin:         '',
  rsiMin:         '',
  rsiMax:         '',
  trendBullish:   false,
  trendBearish:   false,
  macdBullish:    false,
  requireGap:     false,
  requireVolSpike: false,
  requireAhMomt:  false,
  bbBounce:       false,
  bbOverextended: false,
  showBullCandle: false,
  showBearCandle: false,
  instAccum:      false,
};

// ── Helpers ───────────────────────────────────────────────────────────────────
// FIX-SCR-3: empty string must return null (not 0) so blank inputs don't filter
const numVal  = v  => { if (v === '' || v === null || v === undefined) return null; const n = Number(v); return isNaN(n) ? null : n; };
const pctClr  = (v, T) => v > 0 ? T.green : v < 0 ? T.red : T.text2;
const rsiClr  = (r, s, T) => s === 'Overbought' ? T.red : s === 'Oversold' ? T.green : r > 60 ? T.orange : r < 40 ? T.cyan : T.text1;
const trendClr = (t, T) => t === 'Bullish' ? T.green : t === 'Bearish' ? T.red : T.text2;
const scoreClr = (s, T) => s >= 3 ? T.green : s >= 1 ? T.cyan : s <= -3 ? T.red : s <= -1 ? T.orange : T.text1;
const candleClr = (p, T) => p?.includes('Bullish') ? T.green : p?.includes('Bearish') ? T.red : p?.includes('Doji') ? T.gold : T.text2;
const instClr = (s, T) => s?.includes('Accumulation') ? T.green : s?.includes('Distribution') ? T.red : T.text2;

// ── Sub-components ────────────────────────────────────────────────────────────

function FilterInput({ label, value, onChange, placeholder = '', T }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ color: T.text2, fontSize: 9, fontFamily: T.font, letterSpacing: 1.2 }}>
        {label}
      </label>
      <input
        type="number"
        value={value}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        style={{
          background: T.bg0, border: `1px solid ${T.border}`,
          color: T.text0, fontFamily: T.font, fontSize: 12,
          padding: '7px 10px', borderRadius: 5, outline: 'none', width: '100%',
          transition: 'border-color 0.15s',
        }}
        onFocus={e  => e.target.style.borderColor = T.cyanMid}
        onBlur={e   => e.target.style.borderColor = T.border}
      />
    </div>
  );
}

function FilterToggle({ label, checked, onChange, color, T }) {
  return (
    <label
      style={{
        display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer',
        color: checked ? (color || T.cyan) : T.text2,
        fontFamily: T.font, fontSize: 11,
        padding: '6px 10px', borderRadius: 5,
        background: checked ? (color || T.cyan) + '12' : 'transparent',
        border: `1px solid ${checked ? (color || T.cyan) + '40' : T.border}`,
        transition: 'all 0.15s',
      }}
    >
      <input
        type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}
        style={{ accentColor: color || T.cyan, width: 13, height: 13, cursor: 'pointer' }}
      />
      {label}
    </label>
  );
}

function FilterSection({ title, children, T }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{
        color: T.text2, fontSize: 8.5, fontFamily: T.font, letterSpacing: 2,
        fontWeight: 700, paddingBottom: 4, borderBottom: `1px solid ${T.border}`,
      }}>
        {title}
      </div>
      {children}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function PageScreener({ tickers, watchlist, toggleWatchlist, techData = [], scalpData = {}, T }) {
  const [filters,  setFilters]  = useState(DEFAULT_FILTERS);
  const [sortKey,  setSortKey]  = useState('rvol');
  const [sortAsc,  setSortAsc]  = useState(false);
  const [hovered,  setHovered]  = useState(null);

  const setFilter = useCallback((k, v) => setFilters(prev => {
    const next = { ...prev, [k]: v };
    // FIX-SCR-2: mutually exclusive pairs — selecting one auto-clears the other
    // so the user can't accidentally create a contradictory filter (0 results always)
    if (k === 'trendBullish'   && v) next.trendBearish   = false;
    if (k === 'trendBearish'   && v) next.trendBullish   = false;
    if (k === 'showBullCandle' && v) next.showBearCandle = false;
    if (k === 'showBearCandle' && v) next.showBullCandle = false;
    if (k === 'bbBounce'       && v) next.bbOverextended = false;
    if (k === 'bbOverextended' && v) next.bbBounce       = false;
    return next;
  }), []);
  const resetFilters = useCallback(() => setFilters(DEFAULT_FILTERS), []);

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (filters.rvolMin !== '')          n++;
    if (filters.rvolMax !== '')          n++;
    if (filters.pctChgMin !== '')        n++;
    if (filters.pctChgMax !== '')        n++;
    if (filters.gapMin !== '')           n++;
    if (filters.rsiMin !== '')           n++;
    if (filters.rsiMax !== '')           n++;
    if (filters.trendBullish)            n++;
    if (filters.trendBearish)            n++;
    if (filters.macdBullish)             n++;
    if (filters.requireGap)             n++;
    if (filters.requireVolSpike)        n++;
    if (filters.requireAhMomt)          n++;
    if (filters.bbBounce)               n++;
    if (filters.bbOverextended)         n++;
    if (filters.showBullCandle)         n++;
    if (filters.showBearCandle)         n++;
    if (filters.instAccum)              n++;
    return n;
  }, [filters]);

  // ── Core merge + filter ───────────────────────────────────────────────────
  const screenedResults = useMemo(() => {
    // 1. Only operate on the watchlist (≤ 200 tickers)
    const watchlistArr = Array.from(watchlist);
    if (!watchlistArr.length) return [];

    // FIX-SCR-1: Build merged rows from the watchlist Set directly.
    // Previously: `if (!live) return null` dropped tickers not yet in SSE map
    // (e.g. market closed, or symbol not yet streamed). Now every watchlist
    // ticker gets a row — SSE data merged in when available, shown as "—" when not.
    // scalpData (from /api/scalp-analysis) provides macd_hist, trend, rsi etc.
    // techData  (from /api/market-monitor) provides bb_status, inst_footprint etc.
    // Priority: scalpData fields override techData where both exist (more real-time).
    const merged = watchlistArr.map(sym => {
      const live  = tickers.get(sym)               ?? {};
      const tech  = techData?.find(td => td.ticker === sym) ?? {};
      const scalp = scalpData[sym]                 ?? {};
      return { ...live, ...tech, ...scalp, ticker: sym };
    });

    // FIX-SCR-2 & FIX-SCR-3: Apply filters with corrected numVal and exclusive logic
    const rvolMinN    = numVal(filters.rvolMin);
    const rvolMaxN    = numVal(filters.rvolMax);
    const pctChgMinN  = numVal(filters.pctChgMin);
    const pctChgMaxN  = numVal(filters.pctChgMax);
    const gapMinN     = numVal(filters.gapMin);
    const rsiMinN     = numVal(filters.rsiMin);
    const rsiMaxN     = numVal(filters.rsiMax);

    const matched = merged.filter(r => {
      const rvol       = r.rvol        ?? r.volume_ratio ?? null;
      const pct        = r.percent_change ?? null;
      const gap        = r.gap_percent  ?? null;
      const rsi        = r.rsi          ?? null;
      // FIX-SCR-5: treat 'N/A', 'Error', 'Neutral' as no-data so they skip tech
      // filters rather than failing them. Previously "N/A".includes('Accumulation')
      // = false caused ALL tickers without yfinance data to be dropped silently.
      const NO_DATA = new Set(['n/a', 'error', '', 'neutral', 'not enough data', 'no volume data', 'insufficient data']);
      const techStr = s => (s && !NO_DATA.has(String(s).toLowerCase().trim())) ? String(s) : null;
      const trend      = techStr(r.trend);
      const bb         = techStr(r.bb_status);
      const candle     = techStr(r.candlestick ?? r.candle);
      const inst       = techStr(r.inst_footprint);
      // FIX-SCR-6 (resolved): macd_hist now comes from scalpData (/api/scalp-analysis).
      // Real float: positive = bullish histogram, negative = bearish.
      // null = ticker still warming up in signal engine → skip filter, don't drop.
      const macdHist   = r.macd_hist ?? null;

      // FIX-SCR-1: Numeric filters skip the check when the field has no live data
      // (null means "not yet received" — don't drop the row, just skip that filter).
      // This ensures market-closed tickers still appear in the unfiltered list.
      if (rvolMinN   !== null && rvol  !== null && rvol  <  rvolMinN)   return false;
      if (rvolMaxN   !== null && rvol  !== null && rvol  >  rvolMaxN)   return false;
      if (pctChgMinN !== null && pct   !== null && pct   <  pctChgMinN) return false;
      if (pctChgMaxN !== null && pct   !== null && pct   >  pctChgMaxN) return false;
      if (gapMinN    !== null && gap   !== null && gap   <  gapMinN)    return false;
      if (rsiMinN    !== null && rsi   !== null && rsi   <  rsiMinN)    return false;
      if (rsiMaxN    !== null && rsi   !== null && rsi   >  rsiMaxN)    return false;

      // Boolean flag filters (AND logic — all checked flags must be true)
      if (filters.requireGap      && !r.is_gap_play)     return false;
      if (filters.requireVolSpike && !r.volume_spike)    return false;
      if (filters.requireAhMomt   && !r.ah_momentum)     return false;

      // Tech filters — null (from techStr) means "no data yet" → skip check, don't drop.
      // Only drop a row when data IS present and it fails the condition.
      if (filters.trendBullish   && trend  && trend !== 'Bullish')                  return false;
      if (filters.trendBearish   && trend  && trend !== 'Bearish')                  return false;
      if (filters.macdBullish    && macdHist !== null && macdHist <= 0)             return false;
      if (filters.bbBounce       && bb     && !bb.includes('Bounce'))               return false;
      if (filters.bbOverextended && bb     && !bb.includes('Overextended'))         return false;
      if (filters.showBullCandle && candle && !candle.includes('Bullish'))          return false;
      if (filters.showBearCandle && candle && !candle.includes('Bearish'))          return false;
      if (filters.instAccum      && inst   && !inst.includes('Accumulation'))       return false;

      return true;
    });

    // 4. Sort
    matched.sort((a, b) => {
      let va = a[sortKey] ?? (sortAsc ? Infinity : -Infinity);
      let vb = b[sortKey] ?? (sortAsc ? Infinity : -Infinity);
      if (typeof va === 'string') return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
      return sortAsc ? va - vb : vb - va;
    });

    return matched;
  }, [tickers, watchlist, techData, scalpData, filters, sortKey, sortAsc]);

  const handleSort = key => {
    if (sortKey === key) setSortAsc(a => !a);
    else { setSortKey(key); setSortAsc(false); }
  };

  const hasTechData = techData && techData.length > 0;
  const [filtersVisible, setFiltersVisible] = useState(true);

  // ── RENDER ────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', gap: 16, height: 'calc(100vh - 108px)', overflow: 'hidden' }}>

      {/* ── LEFT: Filter Panel (collapsible) ── */}
      <div style={{
        width: filtersVisible ? 230 : 38, minWidth: filtersVisible ? 230 : 38,
        background: T.bg1, border: `1px solid ${T.border}`, borderRadius: 10,
        display: 'flex', flexDirection: 'column', overflow: 'hidden', flexShrink: 0,
        transition: 'width 0.2s ease, min-width 0.2s ease',
      }}>
        {/* Panel header */}
        <div style={{
          padding: '13px 10px', borderBottom: `1px solid ${T.border}`,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0,
          gap: 6,
        }}>
          {/* Collapse/expand toggle */}
          <button
            onClick={() => setFiltersVisible(v => !v)}
            title={filtersVisible ? 'Hide filters' : 'Show filters'}
            style={{
              background: 'none', border: `1px solid ${T.border}`, borderRadius: 5,
              color: T.text2, cursor: 'pointer', padding: '3px 6px',
              fontSize: 11, lineHeight: 1, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            {filtersVisible ? '◀' : '▶'}
          </button>

          {filtersVisible && (
            <>
              <span style={{ color: T.text0, fontSize: 11, fontFamily: T.font, fontWeight: 700, letterSpacing: 0.5, flex: 1 }}>
                ⌖ FILTERS
              </span>
              {activeFilterCount > 0 && (
                <button
                  onClick={resetFilters}
                  style={{
                    background: T.red + '14', border: `1px solid ${T.red}30`,
                    color: T.red, borderRadius: 4, padding: '3px 8px',
                    cursor: 'pointer', fontFamily: T.font, fontSize: 9, fontWeight: 700, flexShrink: 0,
                  }}
                >
                  RESET ({activeFilterCount})
                </button>
              )}
            </>
          )}
        </div>

        {/* Collapsed tab — show filter count vertically */}
        {!filtersVisible && activeFilterCount > 0 && (
          <div style={{
            flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'flex-start', paddingTop: 14, gap: 6,
          }}>
            <div style={{
              background: T.gold + '22', border: `1px solid ${T.gold}44`,
              borderRadius: 10, padding: '3px 7px',
              color: T.gold, fontSize: 9, fontFamily: T.font, fontWeight: 700,
            }}>
              {activeFilterCount}
            </div>
            <div style={{ color: T.text2, fontSize: 8, fontFamily: T.font, writingMode: 'vertical-rl', letterSpacing: 1, marginTop: 4 }}>
              FILTERS ON
            </div>
          </div>
        )}

        {/* Scrollable filters — hidden when panel is collapsed */}
        {filtersVisible && (
        <div style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 18 }}>

          {/* Watchlist status */}
          <div style={{
            background: T.cyan + '08', border: `1px solid ${T.cyan}20`,
            borderRadius: 6, padding: '8px 10px',
          }}>
            <div style={{ color: T.text2, fontSize: 9, fontFamily: T.font, lineHeight: 1.6 }}>
              <span style={{ color: T.cyan, fontWeight: 700 }}>{watchlist.size}</span> watchlist tickers
              {' · '}<span style={{ color: T.green, fontWeight: 700 }}>{Array.from(watchlist).filter(s => tickers.has(s)).length}</span> live SSE
              {hasTechData ? <>{' · '}<span style={{ color: T.gold, fontWeight: 700 }}>{techData.length}</span> tech</> : ' · no tech'}
              {Object.keys(scalpData).length > 0 && <>{' · '}<span style={{ color: T.cyan, fontWeight: 700 }}>{Object.keys(scalpData).length}</span> scalp</>}
            </div>
            {!hasTechData && (
              <div style={{ color: T.text2, fontSize: 8.5, fontFamily: T.font, marginTop: 3, opacity: 0.7 }}>
                Signals → Tech Analysis → Refresh
              </div>
            )}
          </div>

          {/* MOMENTUM */}
          <FilterSection title="MOMENTUM" T={T}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <FilterInput label="RVOL MIN"  value={filters.rvolMin}   onChange={v => setFilter('rvolMin', v)}   placeholder="e.g. 1.5" T={T} />
              <FilterInput label="RVOL MAX"  value={filters.rvolMax}   onChange={v => setFilter('rvolMax', v)}   placeholder="e.g. 5"   T={T} />
              <FilterInput label="% CHG MIN" value={filters.pctChgMin} onChange={v => setFilter('pctChgMin', v)} placeholder="e.g. 2"   T={T} />
              <FilterInput label="% CHG MAX" value={filters.pctChgMax} onChange={v => setFilter('pctChgMax', v)} placeholder="e.g. 15"  T={T} />
              <FilterInput label="GAP % MIN" value={filters.gapMin}    onChange={v => setFilter('gapMin', v)}    placeholder="e.g. 3"   T={T} />
            </div>
          </FilterSection>

          {/* LIVE FLAGS */}
          <FilterSection title="LIVE FLAGS" T={T}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <FilterToggle label="📊 Gap Play"       checked={filters.requireGap}      onChange={v => setFilter('requireGap', v)}      color={T.gold}   T={T} />
              <FilterToggle label="📡 Volume Spike"   checked={filters.requireVolSpike} onChange={v => setFilter('requireVolSpike', v)} color={T.cyan}   T={T} />
              <FilterToggle label="🌙 AH Momentum"    checked={filters.requireAhMomt}   onChange={v => setFilter('requireAhMomt', v)}   color={T.purple} T={T} />
            </div>
          </FilterSection>

          {/* TECHNICAL (requires tech data) */}
          <FilterSection title={`TECHNICAL ${!hasTechData ? '(load tech data first)' : ''}`} T={T}>
            {!hasTechData && (
              <div style={{ color: T.text2, fontSize: 9.5, fontFamily: T.font, opacity: 0.7 }}>
                Go to Signals → Tech Analysis → Refresh to load tech data for these filters.
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <FilterInput label="RSI MIN" value={filters.rsiMin} onChange={v => setFilter('rsiMin', v)} placeholder="e.g. 30" T={T} />
              <FilterInput label="RSI MAX" value={filters.rsiMax} onChange={v => setFilter('rsiMax', v)} placeholder="e.g. 70" T={T} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <FilterToggle label="▲ Bullish Trend"     checked={filters.trendBullish}   onChange={v => setFilter('trendBullish', v)}   color={T.green}  T={T} />
              <FilterToggle label="▼ Bearish Trend"     checked={filters.trendBearish}   onChange={v => setFilter('trendBearish', v)}   color={T.red}    T={T} />
              <FilterToggle label="↑ Bullish MACD"      checked={filters.macdBullish}    onChange={v => setFilter('macdBullish', v)}    color={T.green}  T={T} />
              <FilterToggle label="💡 BB Bounce (Low)"  checked={filters.bbBounce}       onChange={v => setFilter('bbBounce', v)}       color={T.cyan}   T={T} />
              <FilterToggle label="⚠️ BB Overextended"  checked={filters.bbOverextended} onChange={v => setFilter('bbOverextended', v)} color={T.red}    T={T} />
              <FilterToggle label="🟢 Bullish Candle"   checked={filters.showBullCandle} onChange={v => setFilter('showBullCandle', v)} color={T.green}  T={T} />
              <FilterToggle label="🔴 Bearish Candle"   checked={filters.showBearCandle} onChange={v => setFilter('showBearCandle', v)} color={T.red}    T={T} />
              <FilterToggle label="🐋 Inst. Accumul."   checked={filters.instAccum}      onChange={v => setFilter('instAccum', v)}      color={T.cyan}   T={T} />
            </div>
          </FilterSection>

        </div>

        )} {/* end filtersVisible */}

        {/* Results count footer — always visible even when collapsed */}
        <div style={{
          padding: '10px 10px', borderTop: `1px solid ${T.border}`, flexShrink: 0,
          background: T.bg0, display: 'flex', justifyContent: filtersVisible ? 'flex-start' : 'center',
        }}>
          {filtersVisible ? (
            <span style={{ color: T.text2, fontFamily: T.font, fontSize: 10 }}>
              <span style={{ color: screenedResults.length > 0 ? T.cyan : T.text2, fontWeight: 700, fontSize: 13 }}>
                {screenedResults.length}
              </span>
              {' '}/ {watchlist.size} matched
            </span>
          ) : (
            <span style={{ color: screenedResults.length > 0 ? T.cyan : T.text2, fontFamily: T.font, fontSize: 10, fontWeight: 700 }}>
              {screenedResults.length}
            </span>
          )}
        </div>
      </div>

      {/* ── RIGHT: Results Table ── */}
      <div style={{
        flex: 1, background: T.bg1, border: `1px solid ${T.border}`,
        borderRadius: 10, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0,
      }}>
        {/* Table header */}
        <div style={{
          display: 'grid', gridTemplateColumns: GRID_COLS,
          background: T.bg0, borderBottom: `2px solid ${T.border}`,
          position: 'sticky', top: 0, zIndex: 5, flexShrink: 0,
        }}>
          {SCREENER_COLS.map(col => (
            <div
              key={col.key}
              onClick={() => handleSort(col.key)}
              style={{
                padding: '10px 8px', color: sortKey === col.key ? T.cyan : T.text1,
                fontSize: 9, letterSpacing: 1, fontFamily: T.font, fontWeight: 800,
                textTransform: 'uppercase', cursor: 'pointer', whiteSpace: 'nowrap',
                background: sortKey === col.key ? T.cyan + '08' : 'transparent',
                userSelect: 'none',
              }}
            >
              {col.label}{sortKey === col.key ? (sortAsc ? ' ↑' : ' ↓') : ''}
            </div>
          ))}
        </div>

        {/* Empty states */}
        {watchlist.size === 0 && (
          <EmptyState
            icon="⌖" label="NO WATCHLIST TICKERS"
            sub="Star (★) tickers in the Live Table to add them to your screener watchlist."
            h={300} T={T}
          />
        )}
        {watchlist.size > 0 && screenedResults.length === 0 && (
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:260, gap:10 }}>
            <div style={{ fontSize:32 }}>◌</div>
            <div style={{ color:T.text0, fontFamily:T.font, fontSize:14, fontWeight:700 }}>NO MATCHES</div>
            <div style={{ color:T.text2, fontFamily:T.font, fontSize:12, textAlign:'center', maxWidth:380, lineHeight:1.6 }}>
              All active filters use <span style={{ color:T.gold, fontWeight:700 }}>AND logic</span> — every checked condition must be true simultaneously.
              Try unchecking some filters, especially contradictory ones like both Gap Play + AH Momentum.
            </div>
            <button onClick={resetFilters} style={{ marginTop:6, background:T.cyanDim, border:`1px solid ${T.cyanMid}`, color:T.cyan, borderRadius:6, padding:'7px 18px', cursor:'pointer', fontFamily:T.font, fontSize:11, fontWeight:700 }}>
              RESET ALL FILTERS
            </button>
          </div>
        )}

        {/* Result rows */}
        {screenedResults.length > 0 && (
          <div style={{ flex: 1, overflowY: 'auto', overflowX: 'auto' }}>
            {screenedResults.map(row => {
              const rvol        = row.rvol        ?? row.volume_ratio ?? 1;
              const pct         = row.percent_change ?? 0;
              const gap         = row.gap_percent  ?? 0;
              const rsi         = row.rsi          ?? null;
              const rsiSig      = row.rsi_signal   ?? '—';
              const trend       = row.trend        ?? '—';
              const bb          = row.bb_status    ?? '—';
              const candle      = row.candlestick  ?? row.candle ?? '—';
              const inst        = row.inst_footprint ?? '—';
              const score       = row.score        ?? null;
              const isWatched   = watchlist.has(row.ticker);
              const isHovered   = hovered === row.ticker;

              return (
                <div
                  key={row.ticker}
                  onMouseEnter={() => setHovered(row.ticker)}
                  onMouseLeave={() => setHovered(null)}
                  style={{
                    display: 'grid', gridTemplateColumns: GRID_COLS,
                    borderBottom: `1px solid ${T.border}`,
                    background: isHovered ? T.bg2 : 'transparent',
                    transition: 'background 0.1s',
                  }}
                >
                  {/* SYMBOL */}
                  <div style={{ padding: '10px 8px', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <button
                      onClick={() => toggleWatchlist(row.ticker)}
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        fontSize: 12, padding: 0, color: isWatched ? T.gold : T.text2,
                        flexShrink: 0,
                      }}
                    >
                      {isWatched ? '★' : '☆'}
                    </button>
                    <span style={{ color: T.cyan, fontSize: 12, fontWeight: 700, fontFamily: T.font }}>
                      {row.ticker}
                    </span>
                    {/* FIX-SCR-1: dot shows SSE live vs offline (market closed) */}
                    <span
                      title={tickers.has(row.ticker) ? 'Live SSE data' : 'No SSE data (market closed or not streaming)'}
                      style={{ width: 5, height: 5, borderRadius: '50%', flexShrink: 0,
                        background: tickers.has(row.ticker) ? T.green : T.text2, opacity: 0.7 }}
                    />
                  </div>

                  {/* PRICE */}
                  <div style={{ padding: '10px 8px', color: T.text0, fontSize: 12, fontFamily: T.font, fontWeight: 600, display: 'flex', alignItems: 'center' }}>
                    ${fmt2(row.live_price ?? row.close ?? 0)}
                  </div>

                  {/* % CHG */}
                  <div style={{ padding: '10px 8px', display: 'flex', alignItems: 'center' }}>
                    <span style={{ color: pctClr(pct, T), fontSize: 12, fontFamily: T.font, fontWeight: 700 }}>
                      {pct >= 0 ? '+' : ''}{pct?.toFixed(2)}%
                    </span>
                  </div>

                  {/* RVOL */}
                  <div style={{ padding: '10px 8px', display: 'flex', alignItems: 'center' }}>
                    <span style={{
                      color: rvol >= 2 ? T.orange : rvol >= 1.5 ? T.gold : T.text1,
                      fontSize: 12, fontFamily: T.font, fontWeight: rvol >= 1.5 ? 700 : 400,
                    }}>
                      {rvol?.toFixed(1)}x
                    </span>
                  </div>

                  {/* GAP % */}
                  <div style={{ padding: '10px 8px', display: 'flex', alignItems: 'center' }}>
                    <span style={{ color: gap !== 0 ? pctClr(gap, T) : T.text2, fontSize: 11, fontFamily: T.font }}>
                      {gap !== 0 ? `${gap >= 0 ? '+' : ''}${gap?.toFixed(1)}%` : '—'}
                    </span>
                  </div>

                  {/* RSI */}
                  <div style={{ padding: '10px 8px', display: 'flex', alignItems: 'center' }}>
                    <span style={{ color: rsi != null ? rsiClr(rsi, rsiSig, T) : T.text2, fontSize: 12, fontFamily: T.font, fontWeight: rsi != null ? 700 : 400 }}>
                      {rsi != null ? rsi.toFixed(1) : '—'}
                    </span>
                  </div>

                  {/* RSI SIG */}
                  <div style={{ padding: '10px 8px', display: 'flex', alignItems: 'center' }}>
                    {rsiSig !== '—' ? (
                      <span style={{
                        color: rsiClr(rsi, rsiSig, T), fontSize: 9, fontWeight: 700,
                        fontFamily: T.font, padding: '2px 6px', borderRadius: 4,
                        background: rsiClr(rsi, rsiSig, T) + '15',
                      }}>
                        {rsiSig}
                      </span>
                    ) : (
                      <span style={{ color: T.text2, fontSize: 10 }}>—</span>
                    )}
                  </div>

                  {/* TREND */}
                  <div style={{ padding: '10px 8px', display: 'flex', alignItems: 'center' }}>
                    {trend !== '—' ? (
                      <span style={{
                        color: trendClr(trend, T), fontSize: 9, fontWeight: 700,
                        fontFamily: T.font, padding: '2px 6px', borderRadius: 4,
                        background: trendClr(trend, T) + '12',
                      }}>
                        {trend === 'Bullish' ? '▲ ' : trend === 'Bearish' ? '▼ ' : ''}{trend}
                      </span>
                    ) : (
                      <span style={{ color: T.text2, fontSize: 10 }}>—</span>
                    )}
                  </div>

                  {/* BB STATUS */}
                  <div style={{ padding: '10px 8px', color: bb?.includes('Overextended') ? T.red : bb?.includes('Bounce') ? T.green : T.text2, fontSize: 9.5, fontFamily: T.font, fontWeight: 600, display: 'flex', alignItems: 'center' }}>
                    {bb?.includes('Overextended') ? '⚠️ ' : bb?.includes('Bounce') ? '💡 ' : ''}{bb}
                  </div>

                  {/* CANDLE */}
                  <div style={{ padding: '10px 8px', color: candleClr(candle, T), fontSize: 9.5, fontFamily: T.font, fontWeight: 600, display: 'flex', alignItems: 'center' }}>
                    {candle}
                  </div>

                  {/* INST */}
                  <div style={{ padding: '10px 8px', display: 'flex', alignItems: 'center' }}>
                    <span style={{ color: instClr(inst, T), fontSize: 10, fontFamily: T.font }}>
                      {inst?.includes('Accumulation') ? '🐋' : inst?.includes('Distribution') ? '🔻' : '—'}
                    </span>
                  </div>

                  {/* SCORE */}
                  <div style={{ padding: '10px 8px', display: 'flex', alignItems: 'center' }}>
                    <span style={{ color: score != null ? scoreClr(score, T) : T.text2, fontSize: 13, fontFamily: T.font, fontWeight: 800 }}>
                      {score != null ? `${score >= 0 ? '+' : ''}${score.toFixed(1)}` : '—'}
                    </span>
                  </div>

                  {/* FLAGS */}
                  <div style={{ padding: '8px', display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                    {row.is_gap_play    && <span title="Gap Play"       style={{ fontSize: 12 }}>📊</span>}
                    {row.volume_spike   && <span title="Volume Spike"   style={{ fontSize: 12 }}>📡</span>}
                    {row.ah_momentum    && <span title="AH Momentum"    style={{ fontSize: 12 }}>🌙</span>}
                    {row.is_earnings_gap_play && <span title="Earnings Gap" style={{ fontSize: 12 }}>📋</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Footer */}
        <div style={{
          padding: '10px 16px', borderTop: `2px solid ${T.border}`, flexShrink: 0,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          background: T.bg0,
        }}>
          <span style={{ color: T.text1, fontSize: 12, fontFamily: T.font, fontWeight: 600 }}>
            {screenedResults.length} setup{screenedResults.length !== 1 ? 's' : ''} matched
            {activeFilterCount > 0 ? ` · ${activeFilterCount} filter${activeFilterCount !== 1 ? 's' : ''} active` : ''}
          </span>
          <span style={{ color: T.text2, fontSize: 10, fontFamily: T.font }}>
            ★ Watchlist · Live SSE + Tech Analysis · Sorted by {sortKey} {sortAsc ? '↑' : '↓'}
          </span>
        </div>
      </div>
    </div>
  );
}
