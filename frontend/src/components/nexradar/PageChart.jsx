/**
 * PageChart.jsx — NexRadar Pro
 * Symbol search + TF selector + TradingView embed + Key Stats + News Feed sidebar.
 * Hooks: useKeyStats(sym), useNewsFeed(sym)
 * Props: { T, tickers, initialSymbol }
 */
import { useState, useEffect, useMemo } from 'react';
import { Shimmer, EmptyChart, TVChart, SectionHeader, Chip } from './primitives.jsx';
import { API_BASE } from '../../config.js';

// ── Local formatters (chart-only; not worth importing from utils.js) ──────────
function _fmtBig(n) {
  if (!n) return '—';
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9)  return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6)  return `$${(n / 1e6).toFixed(2)}M`;
  return `$${n.toLocaleString()}`;
}
function _fmtVol(n) {
  if (!n) return '—';
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}
function _timeAgo(d) {
  if (!d) return '';
  const m = Math.floor((Date.now() - new Date(d)) / 60000);
  if (m < 60)   return `${m}m ago`;
  if (m < 1440) return `${Math.floor(m / 60)}h ago`;
  return `${Math.floor(m / 1440)}d ago`;
}

// ── Hooks ─────────────────────────────────────────────────────────────────────
function useKeyStats(sym) {
  const [stats,   setStats]   = useState(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!sym) { setStats(null); return; }
    setLoading(true); setStats(null);
    fetch(`${API_BASE}/api/quote/${sym}`)
      .then(r => { if (!r.ok) throw new Error('backend'); return r.json(); })
      .then(data => setStats(data))
      .catch(() =>
        fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(`https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=1d`)}`)
          .then(r => r.json()).then(w => {
            const meta = JSON.parse(w.contents)?.chart?.result?.[0]?.meta ?? {};
            setStats({
              open: meta.regularMarketOpen, high: meta.regularMarketDayHigh,
              low: meta.regularMarketDayLow, prevClose: meta.chartPreviousClose,
              volume: meta.regularMarketVolume, avgVol: meta.averageDailyVolume10Day,
              marketCap: meta.marketCap, wkHi52: meta.fiftyTwoWeekHigh,
              wkLo52: meta.fiftyTwoWeekLow, exchange: meta.exchangeName,
            });
          }).catch(() => setStats(null))
      ).finally(() => setLoading(false));
  }, [sym]);
  return { stats, loading };
}

function useNewsFeed(sym) {
  const [news,    setNews]    = useState([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!sym) { setNews([]); return; }
    setLoading(true); setNews([]);
    fetch(`${API_BASE}/api/news/${sym}`)
      .then(r => { if (!r.ok) throw new Error('backend'); return r.json(); })
      .then(data => setNews(data.items ?? []))
      .catch(() =>
        fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(`https://feeds.finance.yahoo.com/rss/2.0/headline?s=${sym}&region=US&lang=en-US`)}`)
          .then(r => r.json()).then(w => {
            const xml = new DOMParser().parseFromString(w.contents, 'text/xml');
            setNews(Array.from(xml.querySelectorAll('item')).slice(0, 8).map(it => ({
              title:   it.querySelector('title')?.textContent   ?? '',
              link:    it.querySelector('link')?.textContent    ?? '#',
              pubDate: it.querySelector('pubDate')?.textContent ?? '',
              source:  it.querySelector('source')?.textContent ?? 'Yahoo Finance',
            })));
          }).catch(() => setNews([]))
      ).finally(() => setLoading(false));
  }, [sym]);
  return { news, loading };
}

// ── TF map ────────────────────────────────────────────────────────────────────
const TF_MAP = { '1m': '1', '5m': '5', '15m': '15', '1H': '60', '4H': '240', '1D': 'D', '1W': 'W' };

// ── Component ─────────────────────────────────────────────────────────────────
export default function PageChart({ T, tickers = new Map(), initialSymbol = '' }) {
  const [inputVal,   setInputVal]   = useState(initialSymbol);
  const [sym,        setSym]        = useState(initialSymbol);
  const [tf,         setTf]         = useState('1D');
  const [chartStyle, setChartStyle] = useState('1');

  // When a new initialSymbol is pushed from the global search, load it immediately
  useEffect(() => {
    if (initialSymbol) {
      setInputVal(initialSymbol);
      setSym(initialSymbol);
    }
  }, [initialSymbol]);

  const { stats, loading: sLoad } = useKeyStats(sym);
  const { news,  loading: nLoad } = useNewsFeed(sym);

  const handleLoad = () => {
    const s = inputVal.trim().toUpperCase();
    if (s) setSym(s);
  };

  const statRows = stats ? [
    ['Open',        stats.open      ? `$${(+stats.open).toFixed(2)}`      : '—'],
    ['Day High',    stats.high      ? `$${(+stats.high).toFixed(2)}`      : '—'],
    ['Day Low',     stats.low       ? `$${(+stats.low).toFixed(2)}`       : '—'],
    ['Prev Close',  stats.prevClose ? `$${(+stats.prevClose).toFixed(2)}` : '—'],
    ['Volume',      _fmtVol(stats.volume)],
    ['Avg Vol 10d', _fmtVol(stats.avgVol)],
    ['Market Cap',  _fmtBig(stats.marketCap)],
    ['52W High',    stats.wkHi52    ? `$${(+stats.wkHi52).toFixed(2)}`   : '—'],
    ['52W Low',     stats.wkLo52    ? `$${(+stats.wkLo52).toFixed(2)}`   : '—'],
    ['Exchange',    stats.exchange  ?? '—'],
  ] : [];

  return (
    <div className="page-enter" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Controls row */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          placeholder="Enter symbol…"
          value={inputVal}
          onChange={e => setInputVal(e.target.value.toUpperCase())}
          onKeyDown={e => e.key === 'Enter' && handleLoad()}
          style={{ background: T.bg2, border: `1px solid ${T.border}`, borderRadius: 7,
            padding: '7px 13px', color: T.text0, fontFamily: T.font, fontSize: 13,
            outline: 'none', width: 170 }}
        />
        <button onClick={handleLoad}
          style={{ background: T.cyanDim, border: `1px solid ${T.cyanMid}`, color: T.cyan,
            borderRadius: 6, padding: '6px 14px', cursor: 'pointer',
            fontFamily: T.font, fontSize: 10, fontWeight: 700, letterSpacing: 1 }}>
          LOAD
        </button>

        {/* TF buttons */}
        {['1m', '5m', '15m', '1H', '4H', '1D', '1W'].map(t => (
          <button key={t} onClick={() => setTf(t)}
            style={{ background: tf === t ? T.cyanDim : T.bg2,
              border: `1px solid ${tf === t ? T.cyanMid : T.border}`,
              color: tf === t ? T.cyan : T.text2, borderRadius: 5,
              padding: '5px 11px', cursor: 'pointer',
              fontFamily: T.font, fontSize: 10, letterSpacing: 1 }}>
            {t}
          </button>
        ))}

        {/* Chart style buttons */}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {[['CANDLE', '1'], ['LINE', '2'], ['BAR', '3']].map(([lbl, s]) => (
            <button key={lbl} onClick={() => setChartStyle(s)}
              className={`btn-ghost${chartStyle === s ? ' active' : ''}`}
              style={{ fontSize: 9 }}>
              {lbl}
            </button>
          ))}
        </div>
      </div>

      {/* Chart + Sidebar */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {/* Chart panel */}
        <div className="card" style={{ flex: 3, minWidth: 300, overflow: 'hidden' }}>
          <SectionHeader title={sym || '— SELECT SYMBOL'}>
            <Chip color={T.cyan}>{tf}</Chip>
          </SectionHeader>
          {sym
            ? <TVChart symbol={sym} height={460} T={T} interval={TF_MAP[tf]}
                chartStyle={chartStyle}
                livePrice={tickers.get(sym)?.live_price ?? null} />
            : <EmptyChart height={460} label="Enter a symbol above and press LOAD or Enter" />
          }
        </div>

        {/* Right sidebar: Key Stats + News */}
        <div style={{ flex: 1, minWidth: 230, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Key Stats */}
          <div className="card">
            <SectionHeader title="Key Stats">
              {sym && <span style={{ color: T.text2, fontSize: 9, fontFamily: T.font }}>{sym}</span>}
            </SectionHeader>
            <div style={{ padding: '10px 13px' }}>
              {!sym && (
                <p style={{ color: T.text2, fontSize: 9.5, fontFamily: T.font, margin: 0 }}>
                  Load a symbol to see stats.
                </p>
              )}
              {sym && sLoad && Array(8).fill(0).map((_, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 7 }}>
                  <Shimmer w={80} h={10} /><Shimmer w={55} h={10} />
                </div>
              ))}
              {sym && !sLoad && !stats && (
                <p style={{ color: T.red, fontSize: 9.5, fontFamily: T.font, margin: 0 }}>
                  ⚠ Could not load stats — check symbol or network
                </p>
              )}
              {statRows.map(([label, val]) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between',
                  alignItems: 'center', padding: '5px 0', borderBottom: `1px solid ${T.border}` }}>
                  <span style={{ color: T.text2, fontSize: 9.5, fontFamily: T.font }}>{label}</span>
                  <span style={{ color: T.text0, fontSize: 10, fontFamily: T.font, fontWeight: 600 }}>{val}</span>
                </div>
              ))}
            </div>
          </div>

          {/* News Feed */}
          <div className="card">
            <SectionHeader title="News Feed">
              {sym && <span style={{ color: T.text2, fontSize: 9, fontFamily: T.font }}>{sym}</span>}
            </SectionHeader>
            <div style={{ padding: '10px 13px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {!sym && (
                <p style={{ color: T.text2, fontSize: 9.5, fontFamily: T.font, margin: 0 }}>
                  Load a symbol to see news.
                </p>
              )}
              {sym && nLoad && Array(4).fill(0).map((_, i) => (
                <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <Shimmer w="100%" h={10} /><Shimmer w="60%" h={8} />
                </div>
              ))}
              {sym && !nLoad && news.length === 0 && (
                <p style={{ color: T.text2, fontSize: 9.5, fontFamily: T.font, margin: 0 }}>
                  No recent news for {sym}.
                </p>
              )}
              {news.map((item, i) => (
                <a key={i} href={item.link} target="_blank" rel="noreferrer"
                  style={{ textDecoration: 'none', display: 'block', padding: '8px 10px',
                    borderRadius: 6, background: T.bg2, border: `1px solid ${T.border}`,
                    transition: 'border-color 0.15s' }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = T.cyanMid}
                  onMouseLeave={e => e.currentTarget.style.borderColor = T.border}>
                  <p style={{ color: T.text0, fontSize: 10, fontFamily: T.font,
                    lineHeight: 1.45, margin: '0 0 4px 0' }}>
                    {item.title}
                  </p>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: T.cyan,  fontSize: 8.5, fontFamily: T.font }}>{item.source}</span>
                    <span style={{ color: T.text2, fontSize: 8.5, fontFamily: T.font }}>{_timeAgo(item.pubDate)}</span>
                  </div>
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
