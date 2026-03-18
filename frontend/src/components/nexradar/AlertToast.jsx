/**
 * AlertToast.jsx — Feature #1 Smart Alerts Engine
 * Real-time toast notifications for VWAP reclaims, EMA crosses,
 * RVOL spikes, HOD/LOD breaks, and strong buy/sell signals.
 *
 * Usage: already wired into NexRadarDashboard.jsx
 *   <AlertToast alerts={liveAlerts} setAlerts={setLiveAlerts} T={T} />
 *
 * Real-time alerts arrive via SSE → window event 'nexradar_alert'
 * → liveAlerts state in NexRadarDashboard → toast stack here.
 * Also feeds into existing 🔔 bell panel via useTickerData _pushNotif.
 */

import { useState, useEffect } from 'react';
import { API_BASE } from '../../config.js';

const COLOR_MAP = {
  green: { bg: '#00e67614', border: '#00e676', text: '#00e676' },
  red:   { bg: '#ff3d5a14', border: '#ff3d5a', text: '#ff3d5a' },
  gold:  { bg: '#ffc40014', border: '#ffc400', text: '#ffc400' },
  cyan:  { bg: '#00d4ff14', border: '#00d4ff', text: '#00d4ff' },
};

// ── Single toast card ─────────────────────────────────────────────────────────
function Toast({ alert, onDismiss, T }) {
  const [show, setShow]    = useState(false);
  const [exit, setExit]    = useState(false);
  const c = COLOR_MAP[alert.color] || COLOR_MAP.cyan;
  const alertTs = alert.ts ?? Date.now();

  useEffect(() => {
    requestAnimationFrame(() => setShow(true));
    const t = setTimeout(dismiss, 8000);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function dismiss() {
    if (exit) return;   // guard: click + auto-timeout racing each other
    setExit(true);
    // TOAST-KEY-FIX: dismiss by _key (always unique Math.random string).
    // Old code used ts-based composite key — two alerts for the same ticker
    // arriving in the same millisecond produce identical ts values → filter
    // matched nothing → toast stayed visible forever after clicking.
    setTimeout(() => onDismiss(alert._key), 300);
  }

  return (
    <div onClick={dismiss} style={{
      background:   c.bg,
      border:       `1px solid ${c.border}`,
      borderRadius: 10,
      padding:      '10px 14px',
      cursor:       'pointer',
      userSelect:   'none',
      maxWidth:     310,
      minWidth:     240,
      boxShadow:    '0 4px 24px rgba(0,0,0,0.35)',
      transform:    show && !exit ? 'translateX(0)'    : 'translateX(115%)',
      opacity:      show && !exit ? 1                  : 0,
      transition:   'transform 0.28s ease, opacity 0.28s ease',
    }}>
      <div style={{ display:'flex', alignItems:'flex-start', gap:10 }}>
        <span style={{ fontSize:18, lineHeight:1.2, flexShrink:0 }}>{alert.emoji}</span>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:'flex', justifyContent:'space-between', gap:6 }}>
            <span style={{ color:c.text, fontSize:11.5, fontWeight:700 }}>{alert.title}</span>
            <span style={{ color:T.text2, fontSize:9, flexShrink:0, marginTop:1 }}>
              {new Date(alertTs).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}
            </span>
          </div>
          <div style={{ color:T.text1, fontSize:11, marginTop:3, lineHeight:1.4 }}>{alert.message}</div>
          {/* ALERT-TS-FIX: only render score/signal row when values are present */}
          {(alert.score != null || alert.signal) && (
            <div style={{ display:'flex', gap:10, marginTop:4 }}>
              {alert.score != null && (
                <span style={{ color:T.text2, fontSize:9 }}>
                  Score&nbsp;<span style={{ color:c.text }}>{alert.score >= 0 ? '+' : ''}{alert.score?.toFixed(3)}</span>
                </span>
              )}
              {alert.signal && (
                <span style={{ color:T.text2, fontSize:9 }}>
                  Signal&nbsp;<span style={{ color:c.text }}>{alert.signal}</span>
                </span>
              )}
            </div>
          )}
        </div>
      </div>
      {/* auto-dismiss progress bar */}
      <div style={{ marginTop:8, height:2, background:T.bg3, borderRadius:1, overflow:'hidden' }}>
        <div style={{ height:'100%', background:c.border, borderRadius:1,
          animation:'alert_progress 8s linear forwards' }}/>
      </div>
    </div>
  );
}

// ── Alert history panel — exported for optional use in bell dropdown ───────────
// ALERT-HISTORY-FIX: The old panel only fetched /api/alerts (SmartAlertsEngine
// in-memory list). news_alert / edgar_alert / earnings_alert / fda_alert events
// bypass SmartAlertsEngine entirely — they go directly through broadcaster.publish().
// So the bell dropdown showed only technical alerts (VWAP/EMA/RVOL) and silently
// dropped all watchlist news/earnings/edgar/fda alerts even when toasts fired.
//
// Fix:
//   1. Fetch /api/alerts for historical technical alerts (SmartAlertsEngine).
//   2. Also listen to 'nexradar_alert' window event (which covers ALL alert types
//      including news/edgar/earnings/fda dispatched by useTickerData.js).
//   3. Normalise color field so COLOR_MAP lookup works for both alert paths.
//      SmartAlertsEngine uses string color keys ('green','red','gold','cyan').
//      useTickerData.js maps them to hex before dispatching — normalise back.
const COLOR_KEY_MAP = {
  '#00e676': 'green', '#ff3d5a': 'red', '#ffc400': 'gold',
  '#00d4ff': 'cyan',  '#b388ff': 'purple',
};
function _normalizeColor(c) {
  return COLOR_KEY_MAP[c] ?? c ?? 'cyan';
}

export function AlertHistoryPanel({ T }) {
  const [history, setHistory] = useState([]);

  useEffect(() => {
    // Seed with existing SmartAlertsEngine technical alerts
    fetch(`${API_BASE}/api/alerts?limit=60`)
      .then(r => r.json())
      .then(j => {
        const items = (j.data || []).map(a => ({
          ...a,
          color: _normalizeColor(a.color),
          ts: a.ts ?? Date.now(),
        }));
        setHistory(items);
      })
      .catch(() => {});

    // ALERT-HISTORY-FIX: also capture live news/edgar/earnings/fda events
    // dispatched via window 'nexradar_alert' — these never reach /api/alerts.
    const handler = (e) => {
      const a = e.detail;
      if (!a) return;
      setHistory(p => [{
        ...a,
        color:   _normalizeColor(a.color),
        message: a.message || a.sub || '',
        ts:      a.ts ?? Date.now(),
      }, ...p].slice(0, 100));
    };
    window.addEventListener('nexradar_alert', handler);
    return () => window.removeEventListener('nexradar_alert', handler);
  }, []);

  if (!history.length) return (
    <div style={{ padding:'28px 16px', textAlign:'center' }}>
      <div style={{ fontSize:26, marginBottom:8 }}>⚡</div>
      <div style={{ color:T.text2, fontFamily:T.font, fontSize:12 }}>No smart alerts yet</div>
      <div style={{ color:T.text2, fontFamily:T.font, fontSize:10, marginTop:4, opacity:0.6 }}>
        VWAP reclaims, EMA crosses, RVOL spikes<br/>and HOD/LOD breaks appear here live
      </div>
    </div>
  );

  return (
    <>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'10px 14px', borderBottom:`1px solid ${T.border}` }}>
        <span style={{ color:T.text1, fontFamily:T.font, fontSize:11, fontWeight:600 }}>Smart Alerts</span>
        <button onClick={() => setHistory([])}
          style={{ background:'none', border:'none', color:T.text2, fontSize:10, cursor:'pointer', fontFamily:T.font }}>
          Clear
        </button>
      </div>
      {history.map((a, i) => {
        const c = COLOR_MAP[a.color] || COLOR_MAP.cyan;
        const elapsed = Math.floor((Date.now() - (a.ts ?? Date.now())) / 1000);
        const timeStr = elapsed < 60 ? `${elapsed}s ago` : elapsed < 3600 ? `${Math.floor(elapsed/60)}m ago` : `${Math.floor(elapsed/3600)}h ago`;
        // ALERT-HISTORY-FIX: news/edgar/fda alerts use 'sub' not 'message'
        const bodyText = a.message || a.sub || '';
        const WrapEl = a.url ? 'a' : 'div';
        const wrapProps = a.url
          ? { href: a.url, target: '_blank', rel: 'noreferrer', style: { textDecoration: 'none' } }
          : {};
        return (
          <WrapEl key={i} {...wrapProps}
            style={{ padding:'9px 14px', borderBottom:`1px solid ${T.border}`, display:'flex', gap:10, alignItems:'flex-start', transition:'background 0.12s', cursor: a.url ? 'pointer' : 'default' }}
            onMouseEnter={e=>e.currentTarget.style.background=T.bg2}
            onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
            <span style={{ fontSize:14 }}>{a.emoji || '⚡'}</span>
            <div style={{ flex:1 }}>
              <div style={{ color:c.text, fontFamily:T.font, fontSize:11, fontWeight:600 }}>{a.title}</div>
              {bodyText && <div style={{ color:T.text2, fontFamily:T.font, fontSize:10, marginTop:2 }}>{bodyText}</div>}
            </div>
            <span style={{ color:T.text2, fontSize:9, flexShrink:0 }}>{timeStr}</span>
          </WrapEl>
        );
      })}
    </>
  );
}

// ── Main export — toast stack fixed bottom-right ──────────────────────────────
export default function AlertToast({ alerts, setAlerts, T }) {
  return (
    <>
      <style>{`@keyframes alert_progress { from { width: 100%; } to { width: 0%; } }`}</style>
      <div style={{
        position:'fixed', bottom:24, right:24, zIndex:9999,
        display:'flex', flexDirection:'column-reverse', gap:8,
        pointerEvents:'none',
      }}>
        {alerts.slice(0, 5).map((a) => (
          // TOAST-KEY-FIX: _key is the sole stable unique ID for each alert.
          // Using ts caused duplicate key warnings when two alerts for the same
          // ticker arrived in the same millisecond. _key is set in the dashboard
          // handler as `${Date.now()}_${Math.random()}` — always unique.
          // onDismiss also filters by _key — single source of truth for identity.
          <div key={a._key} style={{ pointerEvents:'all' }}>
            <Toast alert={a}
              onDismiss={(key) => setAlerts(prev => prev.filter(x => x._key !== key))}
              T={T} />
          </div>
        ))}
      </div>
    </>
  );
}
