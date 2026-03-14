/**
 * PageScanner.jsx — NexRadar Pro
 * ─────────────────────────────────────────────────────────────────────────────
 * Feature #2: AI Trade Opportunity Scanner  +  Feature #3: Relative Strength
 *
 * Two sub-tabs in one page:
 *   OPPORTUNITIES — ranked list of best trade setups from watchlist,
 *                   composite score = scalp score + RS bonus, tiered A-D
 *   REL. STRENGTH — same data sorted by RS vs SPY, shows market leaders/laggards
 *
 * DATA SOURCE: GET /api/opportunity-scanner
 *   - Reads scalp snapshot (in-memory, 1-min bars, no yfinance)
 *   - RS = ticker_pct_change - spy_pct_change (live Polygon cache)
 *   - Refreshes every 30s (matches scalp-analysis cadence)
 *
 * Props: { T }
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { API_BASE } from '../../config.js';

const REFRESH_MS = 30_000;

// ── Helpers ───────────────────────────────────────────────────────────────────

function pctColor(v, T) {
  if (v == null) return T.text2;
  return v > 0 ? T.green : v < 0 ? T.red : T.text2;
}

function scoreColor(v, T) {
  if (v == null) return T.text2;
  if (v >=  0.55) return T.green;
  if (v >=  0.20) return '#7fff7f';
  if (v <= -0.55) return T.red;
  if (v <= -0.20) return '#ff9999';
  return T.text2;
}

function tierStyle(tier, T) {
  const map = {
    A: { bg: T.greenDim,  border: T.green,  color: T.green  },
    B: { bg: T.cyanDim,   border: T.cyan,   color: T.cyan   },
    C: { bg: T.goldDim,   border: T.gold,   color: T.gold   },
    D: { bg: T.bg3,       border: T.border, color: T.text2  },
  };
  return map[tier] || map.D;
}

function rsLabelColor(label, T) {
  if (!label || label === '—') return T.text2;
  if (label.includes('VERY STRONG')) return T.green;
  if (label.includes('STRONG'))      return '#7fff7f';
  if (label.includes('MODERATE'))    return T.cyan;
  if (label.includes('NEUTRAL'))     return T.text2;
  if (label.includes('WEAK') && !label.includes('VERY')) return '#ff9999';
  return T.red;
}

function signalBadge(signal, strength, T) {
  const colors = {
    BUY:  { bg: T.greenDim, border: T.green, color: T.green },
    SELL: { bg: T.redDim,   border: T.red,   color: T.red   },
    HOLD: { bg: T.bg3,      border: T.border, color: T.text2 },
  };
  const c = colors[signal] || colors.HOLD;
  return (
    <span style={{
      background: c.bg, border: `1px solid ${c.border}`, color: c.color,
      borderRadius: 4, padding: '2px 7px', fontSize: 9, fontWeight: 700,
      letterSpacing: 1, fontFamily: 'monospace',
    }}>
      {signal}{strength && strength !== 'WEAK' ? ` ·${strength[0]}` : ''}
    </span>
  );
}

function fmt2(v) {
  if (v == null || v === '') return '—';
  const n = parseFloat(v);
  return isNaN(n) ? '—' : n.toFixed(2);
}

function fmtPct(v) {
  if (v == null) return '—';
  const n = parseFloat(v);
  if (isNaN(n)) return '—';
  return (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
}

// ── Benchmark Bar (SPY / QQQ context strip) ───────────────────────────────────
function BenchmarkBar({ spyPct, qqqPct, tickerCount, lastUpdate, loading, T }) {
  const age = lastUpdate ? Math.floor((Date.now() / 1000 - lastUpdate)) : null;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 16,
      background: T.bg2, border: `1px solid ${T.border}`,
      borderRadius: 10, padding: '10px 18px', flexWrap: 'wrap',
    }}>
      {/* SPY */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ color: T.text2, fontSize: 9, letterSpacing: 1, fontWeight: 700 }}>SPY</span>
        <span style={{
          color: pctColor(spyPct, T), fontSize: 13, fontWeight: 700,
          fontFamily: 'monospace',
        }}>
          {spyPct != null ? fmtPct(spyPct) : '—'}
        </span>
      </div>

      <div style={{ width: 1, height: 18, background: T.border }} />

      {/* QQQ */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ color: T.text2, fontSize: 9, letterSpacing: 1, fontWeight: 700 }}>QQQ</span>
        <span style={{
          color: pctColor(qqqPct, T), fontSize: 13, fontWeight: 700,
          fontFamily: 'monospace',
        }}>
          {qqqPct != null ? fmtPct(qqqPct) : '—'}
        </span>
      </div>

      <div style={{ width: 1, height: 18, background: T.border }} />

      {/* RS baseline note */}
      <span style={{ color: T.text2, fontSize: 10 }}>
        RS = ticker% − SPY%
      </span>

      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ color: T.text2, fontSize: 10 }}>
          {tickerCount} tickers
        </span>
        {age != null && (
          <span style={{ color: age > 60 ? T.gold : T.text2, fontSize: 10 }}>
            {age < 60 ? `${age}s ago` : `${Math.floor(age / 60)}m ago`}
          </span>
        )}
        {loading && (
          <span style={{ color: T.cyan, fontSize: 10 }}>refreshing…</span>
        )}
      </div>
    </div>
  );
}

// ── Opportunity Row ────────────────────────────────────────────────────────────
function OpportunityRow({ row, rank, onClickTicker, T }) {
  const ts = tierStyle(row.tier, T);
  return (
    <div
      className="tr-hover"
      onClick={() => onClickTicker && onClickTicker(row.ticker)}
      style={{
        display: 'grid',
        gridTemplateColumns: '28px 90px 70px 70px 65px 70px 70px 80px 80px 80px 100px 1fr',
        borderBottom: `1px solid ${T.border}`,
        padding: '0 4px',
      }}
    >
      {/* Rank */}
      <div style={{ padding: '9px 4px', color: T.text2, fontSize: 10, fontFamily: 'monospace', textAlign: 'center' }}>
        {rank}
      </div>

      {/* Tier + Ticker */}
      <div style={{ padding: '9px 8px', display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{
          background: ts.bg, border: `1px solid ${ts.border}`, color: ts.color,
          borderRadius: 3, padding: '1px 5px', fontSize: 8, fontWeight: 800,
          letterSpacing: 0.5,
        }}>
          {row.tier}
        </span>
        <span style={{ color: T.text0, fontWeight: 700, fontSize: 12, fontFamily: 'monospace' }}>
          {row.ticker}
        </span>
      </div>

      {/* Signal */}
      <div style={{ padding: '9px 6px', display: 'flex', alignItems: 'center' }}>
        {signalBadge(row.signal, row.strength, T)}
      </div>

      {/* Price */}
      <div style={{ padding: '9px 8px', color: T.text0, fontSize: 12, fontFamily: 'monospace' }}>
        ${fmt2(row.price)}
      </div>

      {/* % Change */}
      <div style={{ padding: '9px 8px', color: pctColor(row.pct_change, T), fontSize: 12, fontFamily: 'monospace', fontWeight: 600 }}>
        {fmtPct(row.pct_change)}
      </div>

      {/* RS vs SPY */}
      <div style={{ padding: '9px 8px', color: pctColor(row.rs_spy, T), fontSize: 12, fontFamily: 'monospace', fontWeight: 600 }}>
        {row.rs_spy != null ? (row.rs_spy >= 0 ? '+' : '') + row.rs_spy.toFixed(2) : '—'}
      </div>

      {/* RS Label */}
      <div style={{ padding: '9px 6px', color: rsLabelColor(row.rs_label, T), fontSize: 9, fontWeight: 700, letterSpacing: 0.3 }}>
        {row.rs_label || '—'}
      </div>

      {/* Score */}
      <div style={{ padding: '9px 8px', color: scoreColor(row.score, T), fontSize: 12, fontFamily: 'monospace', fontWeight: 700 }}>
        {row.score != null ? (row.score >= 0 ? '+' : '') + row.score.toFixed(3) : '—'}
      </div>

      {/* Composite */}
      <div style={{ padding: '9px 8px', color: scoreColor(row.composite_score, T), fontSize: 12, fontFamily: 'monospace', fontWeight: 700 }}>
        {row.composite_score != null ? (row.composite_score >= 0 ? '+' : '') + row.composite_score.toFixed(3) : '—'}
      </div>

      {/* RVOL */}
      <div style={{ padding: '9px 8px', color: (row.rvol >= 2) ? T.gold : T.text1, fontSize: 11, fontFamily: 'monospace' }}>
        {row.rvol != null ? row.rvol.toFixed(1) + 'x' : '—'}
      </div>

      {/* Trend */}
      <div style={{ padding: '9px 8px', color: row.trend === 'Bullish' ? T.green : row.trend === 'Bearish' ? T.red : T.text2, fontSize: 10, fontWeight: 600 }}>
        {row.trend || '—'}
      </div>

      {/* Sector */}
      <div style={{ padding: '9px 8px', color: T.text2, fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {row.sector || '—'}
      </div>
    </div>
  );
}

// ── RS Row (Relative Strength sub-tab) ───────────────────────────────────────
function RSRow({ row, rank, onClickTicker, T }) {
  const rs = row.rs_spy;
  const bar_w = rs != null ? Math.min(Math.abs(rs) / 5 * 100, 100) : 0;
  const bar_color = rs > 0 ? T.green : T.red;

  return (
    <div
      className="tr-hover"
      onClick={() => onClickTicker && onClickTicker(row.ticker)}
      style={{
        display: 'grid',
        gridTemplateColumns: '28px 100px 75px 75px 80px 1fr 100px 80px',
        borderBottom: `1px solid ${T.border}`,
        padding: '0 4px',
      }}
    >
      {/* Rank */}
      <div style={{ padding: '9px 4px', color: T.text2, fontSize: 10, fontFamily: 'monospace', textAlign: 'center' }}>
        {rank}
      </div>

      {/* Ticker */}
      <div style={{ padding: '9px 8px', display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ color: T.text0, fontWeight: 700, fontSize: 12, fontFamily: 'monospace' }}>
          {row.ticker}
        </span>
      </div>

      {/* % Change */}
      <div style={{ padding: '9px 8px', color: pctColor(row.pct_change, T), fontSize: 12, fontFamily: 'monospace', fontWeight: 600 }}>
        {fmtPct(row.pct_change)}
      </div>

      {/* RS vs SPY */}
      <div style={{ padding: '9px 8px', color: pctColor(rs, T), fontSize: 13, fontFamily: 'monospace', fontWeight: 700 }}>
        {rs != null ? (rs >= 0 ? '+' : '') + rs.toFixed(2) : '—'}
      </div>

      {/* RS Label */}
      <div style={{ padding: '9px 6px', color: rsLabelColor(row.rs_label, T), fontSize: 9, fontWeight: 700, letterSpacing: 0.3 }}>
        {row.rs_label || '—'}
      </div>

      {/* RS bar */}
      <div style={{ padding: '9px 10px', display: 'flex', alignItems: 'center' }}>
        <div style={{ flex: 1, height: 6, background: T.bg3, borderRadius: 3, overflow: 'hidden', position: 'relative' }}>
          <div style={{
            position: 'absolute',
            left: rs >= 0 ? '50%' : `${50 - bar_w / 2}%`,
            width: `${bar_w / 2}%`,
            height: '100%',
            background: bar_color,
            borderRadius: 3,
            opacity: 0.8,
          }} />
          {/* center line */}
          <div style={{ position: 'absolute', left: '50%', top: 0, width: 1, height: '100%', background: T.border }} />
        </div>
      </div>

      {/* Sector */}
      <div style={{ padding: '9px 8px', color: T.text2, fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {row.sector || '—'}
      </div>

      {/* Signal */}
      <div style={{ padding: '9px 6px', display: 'flex', alignItems: 'center' }}>
        {signalBadge(row.signal, row.strength, T)}
      </div>
    </div>
  );
}

// ── Column Headers ─────────────────────────────────────────────────────────────
function OppHeader({ sortKey, sortDir, onSort, T }) {
  const cols = [
    { key: '#',              label: '#',          w: '28px'  },
    { key: 'ticker',         label: 'TICKER',     w: '90px'  },
    { key: 'signal',         label: 'SIGNAL',     w: '70px'  },
    { key: 'price',          label: 'PRICE',      w: '70px'  },
    { key: 'pct_change',     label: '% CHG',      w: '65px'  },
    { key: 'rs_spy',         label: 'RS SPY',     w: '70px'  },
    { key: 'rs_label',       label: 'RS LABEL',   w: '80px'  },
    { key: 'score',          label: 'SCORE',      w: '80px'  },
    { key: 'composite_score',label: 'COMPOSITE',  w: '80px'  },
    { key: 'rvol',           label: 'RVOL',       w: '80px'  },
    { key: 'trend',          label: 'TREND',      w: '100px' },
    { key: 'sector',         label: 'SECTOR',     w: '1fr'   },
  ];
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: cols.map(c => c.w).join(' '),
      background: T.bg0, borderBottom: `2px solid ${T.border}`,
      padding: '0 4px',
    }}>
      {cols.map(c => (
        <div
          key={c.key}
          onClick={() => c.key !== '#' && c.key !== 'sector' && onSort(c.key)}
          style={{
            padding: '9px 8px', color: sortKey === c.key ? T.cyan : T.text1,
            fontSize: 9, letterSpacing: 1, fontFamily: T.font, fontWeight: 800,
            cursor: c.key !== '#' && c.key !== 'sector' ? 'pointer' : 'default',
            userSelect: 'none',
            display: 'flex', alignItems: 'center', gap: 3,
          }}
        >
          {c.label}
          {sortKey === c.key && <span style={{ fontSize: 8 }}>{sortDir === 'asc' ? '↑' : '↓'}</span>}
        </div>
      ))}
    </div>
  );
}

function RSHeader({ sortKey, sortDir, onSort, T }) {
  const cols = [
    { key: '#',         label: '#',        w: '28px'  },
    { key: 'ticker',    label: 'TICKER',   w: '100px' },
    { key: 'pct_change',label: '% CHG',    w: '75px'  },
    { key: 'rs_spy',    label: 'RS SPY',   w: '75px'  },
    { key: 'rs_label',  label: 'STRENGTH', w: '80px'  },
    { key: 'bar',       label: 'RS BAR',   w: '1fr'   },
    { key: 'sector',    label: 'SECTOR',   w: '100px' },
    { key: 'signal',    label: 'SIGNAL',   w: '80px'  },
  ];
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: cols.map(c => c.w).join(' '),
      background: T.bg0, borderBottom: `2px solid ${T.border}`,
      padding: '0 4px',
    }}>
      {cols.map(c => (
        <div
          key={c.key}
          onClick={() => !['#', 'bar', 'sector', 'rs_label'].includes(c.key) && onSort(c.key)}
          style={{
            padding: '9px 8px', color: sortKey === c.key ? T.cyan : T.text1,
            fontSize: 9, letterSpacing: 1, fontFamily: T.font, fontWeight: 800,
            cursor: !['#', 'bar', 'sector', 'rs_label'].includes(c.key) ? 'pointer' : 'default',
            userSelect: 'none',
            display: 'flex', alignItems: 'center', gap: 3,
          }}
        >
          {c.label}
          {sortKey === c.key && <span style={{ fontSize: 8 }}>{sortDir === 'asc' ? '↑' : '↓'}</span>}
        </div>
      ))}
    </div>
  );
}

// ── Filter Bar ────────────────────────────────────────────────────────────────
function FilterBar({ filters, setFilters, T }) {
  const tiers   = ['ALL', 'A', 'B', 'C', 'D'];
  const signals = ['ALL', 'BUY', 'SELL', 'HOLD'];
  const rs      = ['ALL', 'OUTPERFORM', 'UNDERPERFORM'];

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      {/* Tier filter */}
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <span style={{ color: T.text2, fontSize: 9, letterSpacing: 1, fontWeight: 700 }}>TIER</span>
        {tiers.map(t => (
          <button key={t} className="btn-ghost" onClick={() => setFilters(f => ({ ...f, tier: t }))}
            style={{ padding: '3px 9px', fontSize: 9, background: filters.tier === t ? T.cyanDim : undefined, color: filters.tier === t ? T.cyan : undefined, borderColor: filters.tier === t ? T.cyanMid : undefined }}>
            {t}
          </button>
        ))}
      </div>

      <div style={{ width: 1, height: 18, background: T.border }} />

      {/* Signal filter */}
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <span style={{ color: T.text2, fontSize: 9, letterSpacing: 1, fontWeight: 700 }}>SIGNAL</span>
        {signals.map(s => (
          <button key={s} className="btn-ghost" onClick={() => setFilters(f => ({ ...f, signal: s }))}
            style={{ padding: '3px 9px', fontSize: 9, background: filters.signal === s ? T.cyanDim : undefined, color: filters.signal === s ? T.cyan : undefined, borderColor: filters.signal === s ? T.cyanMid : undefined }}>
            {s}
          </button>
        ))}
      </div>

      <div style={{ width: 1, height: 18, background: T.border }} />

      {/* RS filter */}
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <span style={{ color: T.text2, fontSize: 9, letterSpacing: 1, fontWeight: 700 }}>RS</span>
        {rs.map(r => (
          <button key={r} className="btn-ghost" onClick={() => setFilters(f => ({ ...f, rs: r }))}
            style={{ padding: '3px 9px', fontSize: 9, background: filters.rs === r ? T.cyanDim : undefined, color: filters.rs === r ? T.cyan : undefined, borderColor: filters.rs === r ? T.cyanMid : undefined }}>
            {r}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── MTF Components ───────────────────────────────────────────────────────────

function trendIcon(trend) {
  return trend === 'Bullish' ? '▲' : trend === 'Bearish' ? '▼' : '◆';
}
function trendColor(trend, T) {
  return trend === 'Bullish' ? T.green : trend === 'Bearish' ? T.red : T.text2;
}
function confBar(score, T) {
  const pct   = Math.abs(score) * 100;
  const color = score > 0.05 ? T.green : score < -0.05 ? T.red : T.text2;
  return (
    <div style={{ width:80, height:6, background:T.bg3, borderRadius:3, position:'relative', overflow:'hidden' }}>
      <div style={{ position:'absolute', top:0, left:'50%', width:1, height:'100%', background:T.border }}/>
      <div style={{ position:'absolute', top:0, height:'100%', borderRadius:3, background:color,
        left: score >= 0 ? '50%' : `${50 - pct/2}%`, width: `${pct/2}%` }}/>
    </div>
  );
}
function MTFHeader({ sortKey, sortDir, onSort, T }) {
  const col = (key, label, w, align='left') => (
    <th key={key} onClick={() => onSort(key)}
      style={{ padding:'8px 10px', color:sortKey===key?T.cyan:T.text2, fontSize:9, fontWeight:600,
        letterSpacing:0.8, cursor:'pointer', userSelect:'none', textAlign:align, width:w, whiteSpace:'nowrap' }}>
      {label}{sortKey===key?(sortDir==='asc'?' ↑':' ↓'):''}
    </th>
  );
  return (
    <div style={{ flexShrink:0 }}>
      <table style={{ width:'100%', borderCollapse:'collapse', tableLayout:'fixed' }}>
        <thead>
          <tr style={{ borderBottom:`1px solid ${T.border}`, background:T.bg2 }}>
            {col('ticker','TICKER',70)} {col('signal_1m','SIG 1M',58)}
            {col('trend_1m','TREND 1M',82)} {col('trend_5m','TREND 5M',82)} {col('trend_15m','TREND 15M',82)}
            {col('rsi_1m','RSI 1M',50,'right')} {col('rsi_5m','RSI 5M',50,'right')}
            {col('confluence','CONFLUENCE','auto','center')} {col('tier','TIER',40,'center')}
            {col('aligned','⚡',44,'center')}
          </tr>
        </thead>
      </table>
    </div>
  );
}
function MTFRow({ row, onClickTicker, T }) {
  const ts = tierStyle(row.tier, T);
  const dirColor = row.direction === 'BULL' ? T.green : row.direction === 'BEAR' ? T.red : T.text2;
  return (
    <table style={{ width:'100%', borderCollapse:'collapse', tableLayout:'fixed' }}>
      <tbody>
        <tr className="tr-hover" onClick={() => onClickTicker && onClickTicker(row.ticker)}
          style={{ borderBottom:`1px solid ${T.border}30` }}>
          <td style={{ padding:'7px 10px', width:70 }}>
            <span style={{ color:T.cyan, fontSize:12, fontWeight:700, fontFamily:'monospace' }}>{row.ticker}</span>
          </td>
          <td style={{ padding:'7px 10px', width:58 }}>
            <span style={{ color:row.signal_1m==='BUY'?T.green:row.signal_1m==='SELL'?T.red:T.text2, fontSize:10, fontWeight:700 }}>{row.signal_1m}</span>
          </td>
          <td style={{ padding:'7px 10px', width:82 }}>
            <span style={{ color:trendColor(row.trend_1m,T), fontSize:11 }}>{trendIcon(row.trend_1m)} {row.trend_1m}</span>
          </td>
          <td style={{ padding:'7px 10px', width:82 }}>
            <span style={{ color:trendColor(row.trend_5m,T), fontSize:11 }}>{row.trend_5m!=='—'?trendIcon(row.trend_5m):''} {row.trend_5m||'—'}</span>
          </td>
          <td style={{ padding:'7px 10px', width:82 }}>
            <span style={{ color:trendColor(row.trend_15m,T), fontSize:11 }}>{row.trend_15m!=='—'?trendIcon(row.trend_15m):''} {row.trend_15m||'—'}</span>
          </td>
          <td style={{ padding:'7px 10px', width:50, textAlign:'right' }}>
            <span style={{ color:row.rsi_1m>70?T.red:row.rsi_1m<30?T.green:T.text1, fontSize:11, fontFamily:'monospace' }}>
              {row.rsi_1m?.toFixed(0)??'—'}
            </span>
          </td>
          <td style={{ padding:'7px 10px', width:50, textAlign:'right' }}>
            <span style={{ color:row.rsi_5m>70?T.red:row.rsi_5m<30?T.green:T.text1, fontSize:11, fontFamily:'monospace' }}>
              {row.rsi_5m?.toFixed(0)??'—'}
            </span>
          </td>
          <td style={{ padding:'7px 10px', textAlign:'center' }}>
            <div style={{ display:'flex', alignItems:'center', gap:6, justifyContent:'center' }}>
              {confBar(row.confluence, T)}
              <span style={{ color:dirColor, fontSize:9, fontWeight:700, minWidth:32 }}>
                {row.confluence>=0?'+':''}{row.confluence?.toFixed(2)}
              </span>
            </div>
          </td>
          <td style={{ padding:'7px 10px', width:40, textAlign:'center' }}>
            <span style={{ background:ts.bg, border:`1px solid ${ts.border}`, color:ts.color,
              borderRadius:4, padding:'2px 5px', fontSize:9, fontWeight:700 }}>{row.tier}</span>
          </td>
          <td style={{ padding:'7px 10px', width:44, textAlign:'center' }}>
            {row.aligned ? <span style={{ color:T.green }}>⚡</span> : <span style={{ color:T.border }}>—</span>}
          </td>
        </tr>
      </tbody>
    </table>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function PageScanner({ T, onNavigateToChart }) {
  const [tab,       setTab]       = useState('opportunities'); // 'opportunities' | 'rs'
  const [data,      setData]      = useState([]);
  const [spyPct,    setSpyPct]    = useState(null);
  const [qqqPct,    setQqqPct]    = useState(null);
  const [genAt,     setGenAt]     = useState(null);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState(null);
  const [filters,   setFilters]   = useState({ tier: 'ALL', signal: 'ALL', rs: 'ALL' });
  const [sortKey,   setSortKey]   = useState('composite_score');
  const [sortDir,   setSortDir]   = useState('desc');
  const [rsSortKey, setRsSortKey] = useState('rs_spy');
  const [rsSortDir, setRsSortDir] = useState('desc');
  const [mtfData,    setMtfData]    = useState([]);
  const [mtfLoading, setMtfLoading] = useState(false);
  const [mtfError,   setMtfError]   = useState(null);
  const [mtfSortKey, setMtfSortKey] = useState('confluence');
  const [mtfSortDir, setMtfSortDir] = useState('desc');
  const [mtfFilter,  setMtfFilter]  = useState('ALL');
  const timerRef = useRef(null);
  const mtfTimerRef = useRef(null);

  const fetchData = useCallback(async (showLoad = false) => {
    if (showLoad) setLoading(true);
    try {
      const r = await fetch(`${API_BASE}/api/opportunity-scanner`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      setData(j.data || []);
      setSpyPct(j.spy_pct ?? null);
      setQqqPct(j.qqq_pct ?? null);
      setGenAt(j.generated_at ?? null);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchMtf = useCallback(async () => {
    setMtfLoading(true);
    try {
      const r = await fetch(`${API_BASE}/api/mtf-scanner`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      setMtfData(j.data || []);
      setMtfError(null);
    } catch (e) { setMtfError(e.message); }
    finally { setMtfLoading(false); }
  }, []);

  useEffect(() => {
    fetchData(true);
    timerRef.current = setInterval(() => fetchData(false), REFRESH_MS);
    return () => clearInterval(timerRef.current);
  }, [fetchData]);

  useEffect(() => {
    if (tab !== 'mtf') { clearInterval(mtfTimerRef.current); return; }
    fetchMtf();
    mtfTimerRef.current = setInterval(fetchMtf, REFRESH_MS);
    return () => clearInterval(mtfTimerRef.current);
  }, [tab, fetchMtf]);

  // ── Sorting ────────────────────────────────────────────────────────────────
  const handleOppSort = (key) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  };
  const handleRsSort = (key) => {
    if (rsSortKey === key) setRsSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setRsSortKey(key); setRsSortDir('desc'); }
  };

  // ── Filtering ──────────────────────────────────────────────────────────────
  const filtered = data.filter(r => {
    if (filters.tier   !== 'ALL' && r.tier   !== filters.tier)   return false;
    if (filters.signal !== 'ALL' && r.signal !== filters.signal) return false;
    if (filters.rs === 'OUTPERFORM'   && !(r.rs_spy > 0))        return false;
    if (filters.rs === 'UNDERPERFORM' && !(r.rs_spy < 0))        return false;
    return true;
  });

  // ── Sorting: Opportunities ─────────────────────────────────────────────────
  const oppRows = [...filtered].sort((a, b) => {
    let av = a[sortKey], bv = b[sortKey];
    if (av == null) av = sortDir === 'asc' ? Infinity : -Infinity;
    if (bv == null) bv = sortDir === 'asc' ? Infinity : -Infinity;
    if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    return sortDir === 'asc' ? av - bv : bv - av;
  });

  const handleMtfSort = (key) => {
    if (mtfSortKey === key) setMtfSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setMtfSortKey(key); setMtfSortDir('desc'); }
  };

  const mtfFiltered = mtfData.filter(r => {
    if (mtfFilter === 'BULL')    return r.direction === 'BULL';
    if (mtfFilter === 'BEAR')    return r.direction === 'BEAR';
    if (mtfFilter === 'ALIGNED') return r.aligned === true;
    return true;
  });
  const mtfRows = [...mtfFiltered].sort((a, b) => {
    let av = a[mtfSortKey], bv = b[mtfSortKey];
    if (av == null) av = mtfSortDir === 'asc' ? Infinity : -Infinity;
    if (bv == null) bv = mtfSortDir === 'asc' ? Infinity : -Infinity;
    if (typeof av === 'string') return mtfSortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    return mtfSortDir === 'asc' ? av - bv : bv - av;
  });

  // ── Sorting: RS tab — sort by rs_spy descending by default ─────────────────
  const rsRows = [...filtered].sort((a, b) => {
    let av = a[rsSortKey], bv = b[rsSortKey];
    if (av == null) av = rsSortDir === 'asc' ? Infinity : -Infinity;
    if (bv == null) bv = rsSortDir === 'asc' ? Infinity : -Infinity;
    return rsSortDir === 'asc' ? av - bv : bv - av;
  });

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="page-enter" style={{ display: 'flex', flexDirection: 'column', gap: 12, height: '100%' }}>

      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div style={{ color: T.text0, fontSize: 16, fontWeight: 700, letterSpacing: 0.3 }}>
            ◈ Opportunity Scanner
          </div>
          <div style={{ color: T.text2, fontSize: 10, marginTop: 2 }}>
            AI-ranked setups + relative strength vs SPY — watchlist only
          </div>
        </div>
        <button className="btn-ghost" onClick={() => fetchData(true)} disabled={loading}
          style={{ fontSize: 10, padding: '5px 12px' }}>
          {loading ? 'Refreshing…' : '↻ Refresh'}
        </button>
      </div>

      {/* Benchmark bar */}
      <BenchmarkBar
        spyPct={spyPct} qqqPct={qqqPct}
        tickerCount={filtered.length}
        lastUpdate={genAt} loading={loading} T={T}
      />

      {/* Sub-tab bar */}
      <div style={{ display: 'flex', gap: 4 }}>
        {[
          { id: 'opportunities', label: '◈ OPPORTUNITIES', hint: 'Ranked by composite score'      },
          { id: 'rs',            label: '⇅ REL. STRENGTH', hint: 'Ranked by RS vs SPY'            },
          { id: 'mtf',           label: '⧖ MULTI-TF',      hint: '1m + 5m + 15m confluence scan'  },
        ].map(t => (
          <button key={t.id} className="btn-ghost"
            onClick={() => setTab(t.id)}
            title={t.hint}
            style={{
              fontSize: 10, padding: '6px 16px', fontWeight: 700, letterSpacing: 0.5,
              background: tab === t.id ? T.cyanDim : undefined,
              color:      tab === t.id ? T.cyan    : undefined,
              borderColor:tab === t.id ? T.cyanMid : undefined,
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Filter bar */}
      <FilterBar filters={filters} setFilters={setFilters} T={T} />

      {/* Error */}
      {error && (
        <div style={{ background: T.redDim, border: `1px solid ${T.red}`, borderRadius: 8, padding: '10px 16px', color: T.red, fontSize: 12 }}>
          ⚠ {error}
        </div>
      )}

      {/* Table */}
      <div className="card" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

        {/* Warming-up note if signal engine is still seeding */}
        {!loading && data.length === 0 && !error && (
          <div style={{ padding: 32, textAlign: 'center', color: T.text2, fontSize: 12 }}>
            Signal engine warming up — data appears within ~30s of market open.
          </div>
        )}

        {tab === 'opportunities' && oppRows.length > 0 && (
          <>
            <OppHeader sortKey={sortKey} sortDir={sortDir} onSort={handleOppSort} T={T} />
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {oppRows.map((row, i) => (
                <OpportunityRow key={row.ticker} row={row} rank={i + 1}
                  onClickTicker={onNavigateToChart} T={T} />
              ))}
            </div>
          </>
        )}

        {tab === 'rs' && rsRows.length > 0 && (
          <>
            <RSHeader sortKey={rsSortKey} sortDir={rsSortDir} onSort={handleRsSort} T={T} />
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {rsRows.map((row, i) => (
                <RSRow key={row.ticker} row={row} rank={i + 1}
                  onClickTicker={onNavigateToChart} T={T} />
              ))}
            </div>
          </>
        )}

        {tab === 'mtf' && (
          <>
            {mtfLoading && mtfData.length === 0 && (
              <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:12, padding:48 }}>
                <div style={{ color:T.cyan, fontSize:22 }}>⧖</div>
                <div style={{ color:T.text1, fontSize:13, fontWeight:600 }}>Loading MTF scanner…</div>
                <div style={{ color:T.text2, fontSize:11 }}>Aggregating 1m → 5m → 15m bars</div>
              </div>
            )}
            {mtfError && (
              <div style={{ background:T.redDim, border:`1px solid ${T.red}`, borderRadius:8, padding:'10px 16px', color:T.red, fontSize:12, margin:12 }}>⚠ {mtfError}</div>
            )}
            {!mtfLoading && mtfData.length === 0 && !mtfError && (
              <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:14, padding:48 }}>
                <div style={{ fontSize:32 }}>⧖</div>
                <div style={{ color:T.text1, fontSize:14, fontWeight:700 }}>No MTF data yet</div>
                <div style={{ color:T.text2, fontSize:11, textAlign:'center', maxWidth:360, lineHeight:1.7 }}>
                  Needs <strong style={{ color:T.cyan }}>≥ 75 bars</strong> per symbol (~75 min after market open)
                </div>
              </div>
            )}
            {mtfRows.length > 0 && (
              <>
                <div style={{ display:'flex', gap:6, padding:'8px 12px', borderBottom:`1px solid ${T.border}`, flexShrink:0 }}>
                  {['ALL','BULL','BEAR','ALIGNED'].map(f => (
                    <button key={f} className="btn-ghost" onClick={() => setMtfFilter(f)}
                      style={{ fontSize:9, padding:'4px 10px', fontWeight:700, letterSpacing:0.5,
                        background:mtfFilter===f?T.cyanDim:undefined, color:mtfFilter===f?T.cyan:undefined,
                        borderColor:mtfFilter===f?T.cyanMid:undefined }}>
                      {f === 'ALIGNED' ? '⚡ ALIGNED' : f}
                    </button>
                  ))}
                  <div style={{ flex:1 }}/>
                  <span style={{ color:T.text2, fontSize:9, alignSelf:'center' }}>{mtfRows.length} tickers</span>
                </div>
                <MTFHeader sortKey={mtfSortKey} sortDir={mtfSortDir} onSort={handleMtfSort} T={T} />
                <div style={{ flex:1, overflowY:'auto' }}>
                  {mtfRows.map(row => <MTFRow key={row.ticker} row={row} onClickTicker={onNavigateToChart} T={T} />)}
                </div>
              </>
            )}
          </>
        )}

        {!loading && filtered.length === 0 && data.length > 0 && (
          <div style={{ padding: 32, textAlign: 'center', color: T.text2, fontSize: 12 }}>
            No tickers match the current filters.
          </div>
        )}

      </div>

      {/* Footer legend */}
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', padding: '4px 2px' }}>
        {[
          { label: 'TIER A', desc: 'Score ≥ 0.75 — highest conviction',  color: T.green  },
          { label: 'TIER B', desc: 'Score ≥ 0.55 — moderate conviction', color: T.cyan   },
          { label: 'TIER C', desc: 'Score ≥ 0.40 — watch closely',       color: T.gold   },
          { label: 'RS SPY', desc: 'Positive = outperforming market',     color: T.text2  },
        ].map(({ label, desc, color }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ color, fontSize: 9, fontWeight: 700, letterSpacing: 0.5 }}>{label}</span>
            <span style={{ color: T.text2, fontSize: 9 }}>{desc}</span>
          </div>
        ))}
      </div>

    </div>
  );
}
