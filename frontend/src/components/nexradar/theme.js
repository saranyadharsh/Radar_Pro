// theme.js — NexRadar Pro
// Theme-aware design tokens + injected CSS

export const getThemeTokens = (darkMode = true) => ({
  bg0: darkMode ? "#02060d" : "#f8fafc",
  bg1: darkMode ? "#060d18" : "#ffffff",
  bg2: darkMode ? "#0a1421" : "#f1f5f9",
  bg3: darkMode ? "#0f1c2e" : "#e2e8f0",
  bg4: darkMode ? "#142038" : "#cbd5e1",

  border:   darkMode ? "#172438" : "#d1d5db",
  borderHi: darkMode ? "#1f3655" : "#9ca3af",

  cyan:    darkMode ? "#00d4ff" : "#0891b2",
  cyanDim: darkMode ? "#00d4ff12" : "#0891b218",
  cyanMid: darkMode ? "#00d4ff35" : "#0891b240",

  green:    darkMode ? "#00e676" : "#059669",
  greenDim: darkMode ? "#00e67614" : "#05966918",

  red:    darkMode ? "#ff3d5a" : "#dc2626",
  redDim: darkMode ? "#ff3d5a14" : "#dc262618",

  gold:    darkMode ? "#ffc400" : "#d97706",
  goldDim: darkMode ? "#ffc40014" : "#d9770618",

  purple:    darkMode ? "#b388ff" : "#7c3aed",
  purpleDim: darkMode ? "#b388ff14" : "#7c3aed18",

  orange:    darkMode ? "#ff6d00" : "#ea580c",
  orangeDim: darkMode ? "#ff6d0014" : "#ea580c18",

  text0: darkMode ? "#e2f1f8" : "#0f172a",
  text1: darkMode ? "#8ba3b8" : "#1e293b",
  text2: darkMode ? "#4a6278" : "#475569",
  text3: darkMode ? "#2e4a62" : "#64748b",

  font:        "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  fontMono:    "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
  fontDisplay: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
  fontSans:    "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
});

export const getCSS = (T) => `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: ${T.bg0}; font-family: ${T.font}; -webkit-font-smoothing: antialiased; }
  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: ${T.border}; border-radius: 3px; }
  ::-webkit-scrollbar-thumb:hover { background: ${T.borderHi}; }
  @keyframes fadeUp   { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
  @keyframes shimmer  { 0%{background-position:-400px 0} 100%{background-position:400px 0} }
  @keyframes dotblink { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.25;transform:scale(0.5)} }
  @keyframes slideInRight { from{opacity:0;transform:translateX(24px)} to{opacity:1;transform:translateX(0)} }
  .page-enter { animation: fadeUp 0.3s ease forwards; }
  .shimmer-box {
    background: linear-gradient(90deg, ${T.bg2} 25%, ${T.bg3} 50%, ${T.bg2} 75%);
    background-size: 400px 100%; animation: shimmer 1.6s infinite; border-radius: 4px;
  }
  .nav-btn {
    background: none; border: 1px solid transparent; cursor: pointer;
    display: flex; align-items: center; gap: 10px;
    padding: 11px 16px; width: 100%; border-radius: 8px;
    transition: all 0.2s ease; font-family: ${T.font};
    font-size: 13px; font-weight: 500; letter-spacing: 0.3px;
    text-transform: uppercase; color: ${T.text2};
  }
  .nav-btn:hover  { background: ${T.bg2}; color: ${T.text0}; }
  .nav-btn.active { background: ${T.cyanDim}; color: ${T.cyan}; border-color: ${T.cyanMid}; font-weight: 600; }
  .nav-btn .icon  { font-size: 16px; min-width: 18px; text-align: center; }
  .card { background: ${T.bg1}; border: 1px solid ${T.border}; border-radius: 12px; overflow: hidden; position: relative; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
  .card-glow { border-color: ${T.borderHi}; box-shadow: 0 0 0 1px ${T.cyanDim} inset, 0 2px 8px rgba(0,0,0,0.15); }
  .btn-ghost {
    background: none; border: 1px solid ${T.border}; color: ${T.text1};
    border-radius: 6px; padding: 7px 14px; cursor: pointer;
    font-family: ${T.font}; font-size: 12px; font-weight: 500;
    letter-spacing: 0.3px; transition: all 0.2s ease;
  }
  .btn-ghost:hover:not(:disabled) { border-color: ${T.cyanMid}; color: ${T.cyan}; background: ${T.cyanDim}; }
  .btn-ghost.active { background: ${T.cyanDim}; border-color: ${T.cyanMid}; color: ${T.cyan}; font-weight: 600; }
  .btn-ghost:disabled { opacity: 0.4; cursor: not-allowed; }
  .btn-primary {
    background: ${T.cyanDim}; border: 1px solid ${T.cyanMid}; color: ${T.cyan};
    border-radius: 6px; padding: 8px 16px; cursor: pointer;
    font-family: ${T.font}; font-size: 12px; font-weight: 600;
    letter-spacing: 0.3px; transition: all 0.2s ease;
  }
  .btn-primary:hover { background: ${T.cyanMid}; }
  .tr-hover { transition: background 0.15s ease; cursor: pointer; }
  .tr-hover:hover td { background: ${T.bg2} !important; }
  .live-dot { width: 8px; height: 8px; border-radius: 50%; background: ${T.green}; animation: dotblink 1.4s ease-in-out infinite; display: inline-block; flex-shrink: 0; }
  input, select, textarea { font-family: ${T.font}; font-size: 14px; }
  input:focus, select:focus, textarea:focus { outline: none !important; border-color: ${T.cyanMid} !important; box-shadow: 0 0 0 3px ${T.cyanDim}; }
`;
