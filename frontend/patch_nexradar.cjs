#!/usr/bin/env node
/**
 * patch_nexradar.js
 * Run: node patch_nexradar.js <path/to/NexRadarDashboard.jsx>
 * Applies 4 patches:
 *   1. PageSignals signalView state → adds "EARNINGS" as valid value
 *   2. Replaces tab-bar block with SIGNALS primary + TECH ANALYSIS / EARNINGS sub-tabs
 *   3. Adds EARNINGS sub-tab view block after TECH ANALYSIS view block
 *   4. Adds AppearanceModal component + wires it into Profile dropdown
 */

const fs   = require("fs");
const path = require("path");

const filePath = process.argv[2];
if (!filePath) {
  console.error("Usage: node patch_nexradar.js <path/to/NexRadarDashboard.jsx>");
  process.exit(1);
}

let src = fs.readFileSync(filePath, "utf8");
let patchCount = 0;

function patch(label, oldStr, newStr) {
  if (!src.includes(oldStr)) {
    console.warn(`⚠  SKIP  [${label}] — marker not found (already applied?)`);
    return;
  }
  src = src.replace(oldStr, newStr);
  patchCount++;
  console.log(`✅ PATCH [${label}]`);
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH 1 — PageSignals: extend signalView state comment so "EARNINGS" is clear
// ─────────────────────────────────────────────────────────────────────────────
patch(
  "1 – signalView state comment",
  `const [signalView, setSignalView] = useState("SIGNALS"); // "SIGNALS" | "TECH"`,
  `const [signalView, setSignalView] = useState("SIGNALS"); // "SIGNALS" | "TECH" | "EARNINGS"`
);

// ─────────────────────────────────────────────────────────────────────────────
// PATCH 2 — Replace TAB BAR block
// ─────────────────────────────────────────────────────────────────────────────
patch(
  "2 – tab bar",
  `      {/* ── TAB BAR + STATS + FILTERS — single unified row ── */}
      <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>

        {/* Tab toggle */}
        <div style={{ display:"flex", background:T.bg0, border:\`1px solid \${T.border}\`, borderRadius:8, overflow:"hidden", boxShadow:\`0 1px 4px \${T.bg0}\` }}>
          <button onClick={() => setSignalView("SIGNALS")}
            style={{
              background: signalView==="SIGNALS" ? T.cyan : "transparent",
              color: signalView==="SIGNALS" ? "#000" : T.text2,
              border:"none", borderRight:\`1px solid \${T.border}\`,
              padding:"8px 20px", cursor:"pointer",
              fontFamily:T.font, fontSize:10.5, letterSpacing:0.7, fontWeight:700,
              transition:"all 0.15s",
            }}>
            ◉ SIGNALS
          </button>
          <button onClick={() => setSignalView("TECH")}
            style={{
              background: signalView==="TECH" ? T.cyan+"22" : "transparent",
              color: signalView==="TECH" ? T.cyan : T.text2,
              border:"none",
              padding:"8px 20px", cursor:"pointer",
              fontFamily:T.font, fontSize:10.5, letterSpacing:0.7, fontWeight:600,
              transition:"all 0.15s",
            }}>
            ◈ TECH ANALYSIS
          </button>
        </div>

        {/* Divider */}
        <div style={{ width:1, height:22, background:T.border, flexShrink:0 }}/>

        {/* ── Inline stat badges (always visible, context-sensitive) ── */}
        {signalView === "SIGNALS" && (
          <>
            {[
              { lbl:"BUY",   val:proStats.buy,    clr:T.green  },
              { lbl:"SELL",  val:proStats.sell,   clr:T.red    },
              { lbl:"STRNG", val:proStats.strong, clr:T.purple },
              { lbl:"WATCH", val:proData.length,  clr:T.cyan   },
            ].map(s => (
              <div key={s.lbl} style={{ display:"flex", alignItems:"center", gap:5,
                background:T.bg2, border:\`1px solid \${T.border}\`, borderRadius:5, padding:"4px 10px" }}>
                <span style={{ color:T.text2, fontSize:8.5, fontFamily:T.font, letterSpacing:0.8 }}>{s.lbl}</span>
                <span style={{ color:s.clr, fontSize:14, fontFamily:T.font, fontWeight:800, lineHeight:1 }}>{s.val}</span>
              </div>
            ))}

            {/* Divider */}
            <div style={{ width:1, height:22, background:T.border, flexShrink:0 }}/>

            {/* Filter pills */}
            {[
              ["ALL",    \`ALL (\${proStats.total})\`      ],
              ["BUY",    \`▲ BUY (\${proStats.buy})\`      ],
              ["SELL",   \`▼ SELL (\${proStats.sell})\`    ],
              ["STRONG", \`⚡ STRONG (\${proStats.strong})\`],
            ].map(([key, lbl]) => (
              <button key={key} onClick={() => setProFilter(key)}
                style={{
                  background: proFilter===key ? T.cyan+"14" : "transparent",
                  border: \`1px solid \${proFilter===key ? T.cyan+"45" : T.border}\`,
                  color: proFilter===key ? T.cyan : T.text2,
                  borderRadius:5, padding:"5px 11px", cursor:"pointer",
                  fontFamily:T.font, fontSize:9.5, fontWeight:600,
                }}>
                {lbl}
              </button>
            ))}

            {/* Warming up + refresh */}
            <div style={{ marginLeft:"auto", display:"flex", gap:6, alignItems:"center" }}>
              {proWarmingUp.length > 0 && (
                <span style={{ color:T.text2, fontSize:9.5, fontFamily:T.font }}>
                  ⏳ {proWarmingUp.length} warming
                </span>
              )}
              <button onClick={fetchProData} disabled={proLoading}
                style={{ background:T.bg2, border:\`1px solid \${T.border}\`, color:T.text1,
                  borderRadius:5, padding:"5px 12px", cursor:proLoading?"wait":"pointer",
                  fontFamily:T.font, fontSize:10, fontWeight:600, opacity:proLoading?0.5:1 }}>
                {proLoading ? "⏳" : "🔄"} {proLoading ? "Loading…" : "Refresh"}
              </button>
            </div>
          </>
        )}

        {/* ── TECH tab filters ── */}
        {signalView === "TECH" && (
          <>
            {techStats && (
              <>
                {[
                  { lbl:"BULL",  val:techStats.bullish,    clr:T.green },
                  { lbl:"BEAR",  val:techStats.bearish,    clr:T.red   },
                  { lbl:"ALERT", val:techStats.alerts,     clr:T.gold  },
                ].map(s => (
                  <div key={s.lbl} style={{ display:"flex", alignItems:"center", gap:5,
                    background:T.bg2, border:\`1px solid \${T.border}\`, borderRadius:5, padding:"4px 10px" }}>
                    <span style={{ color:T.text2, fontSize:8.5, fontFamily:T.font, letterSpacing:0.8 }}>{s.lbl}</span>
                    <span style={{ color:s.clr, fontSize:14, fontFamily:T.font, fontWeight:800, lineHeight:1 }}>{s.val}</span>
                  </div>
                ))}
                <div style={{ width:1, height:22, background:T.border, flexShrink:0 }}/>
              </>
            )}

            {["ALL","BULLISH","BEARISH","ALERTS"].map(f => (
              <button key={f} onClick={() => setTechFilter(f)}
                style={{
                  background: techFilter===f ? T.cyan+"14" : "transparent",
                  border: \`1px solid \${techFilter===f ? T.cyan+"45" : T.border}\`,
                  color: techFilter===f ? T.cyan : T.text2,
                  borderRadius:5, padding:"5px 11px", cursor:"pointer",
                  fontFamily:T.font, fontSize:9.5, fontWeight:600, letterSpacing:0.3,
                }}>
                {f==="BULLISH"?"▲ ":f==="BEARISH"?"▼ ":f==="ALERTS"?"🚨 ":""}
                {f}
                {techStats && f==="ALL"     ? \` (\${techData.length})\`    : ""}
                {techStats && f==="BULLISH" ? \` (\${techStats.bullish})\`  : ""}
                {techStats && f==="BEARISH" ? \` (\${techStats.bearish})\`  : ""}
                {techStats && f==="ALERTS"  ? \` (\${techStats.alerts})\`   : ""}
              </button>
            ))}

            <div style={{ marginLeft:"auto", display:"flex", gap:6, alignItems:"center" }}>
              {techLastFetch && (
                <span style={{ color:T.text2, fontSize:9.5, fontFamily:T.font }}>
                  {techCached ? "📦" : "✅"} {techLastFetch.toLocaleTimeString()}
                </span>
              )}
              <button onClick={() => fetchTechData(false)} disabled={techLoading}
                style={{ background:T.bg2, border:\`1px solid \${T.border}\`, color:T.text1,
                  borderRadius:5, padding:"5px 12px", cursor:techLoading?"wait":"pointer",
                  fontFamily:T.font, fontSize:10, fontWeight:600, opacity:techLoading?0.5:1 }}>
                {techLoading ? "⏳ Loading…" : "🔄 Refresh"}
              </button>
              <button onClick={() => fetchTechData(true)} disabled={techLoading}
                style={{ background:T.cyanDim, border:\`1px solid \${T.cyanMid}\`, color:T.cyan,
                  borderRadius:5, padding:"5px 12px", cursor:techLoading?"wait":"pointer",
                  fontFamily:T.font, fontSize:10, fontWeight:700, opacity:techLoading?0.5:1 }}>
                ⚡ Force
              </button>
            </div>
          </>
        )}
      </div>`,

  // ── NEW TAB BAR ──
  `      {/* ── TAB BAR: SIGNALS primary, TECH ANALYSIS + EARNINGS as sub-tabs ── */}
      <div style={{ display:"flex", flexDirection:"column", gap:6 }}>

        {/* Row 1 — Primary SIGNALS tab + its inline stats/filters */}
        <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
          <div style={{ display:"flex", background:T.bg0, border:\`1px solid \${T.border}\`, borderRadius:8, overflow:"hidden", boxShadow:\`0 1px 4px \${T.bg0}\` }}>
            <button onClick={() => setSignalView("SIGNALS")}
              style={{
                background: signalView==="SIGNALS" ? T.cyan : "transparent",
                color: signalView==="SIGNALS" ? "#000" : T.text2,
                border:"none", padding:"8px 20px", cursor:"pointer",
                fontFamily:T.font, fontSize:10.5, letterSpacing:0.7, fontWeight:700,
                transition:"all 0.15s",
              }}>
              ◉ SIGNALS
            </button>
          </div>

          {signalView === "SIGNALS" && (
            <>
              <div style={{ width:1, height:22, background:T.border, flexShrink:0 }}/>
              {[
                { lbl:"BUY",   val:proStats.buy,    clr:T.green  },
                { lbl:"SELL",  val:proStats.sell,   clr:T.red    },
                { lbl:"STRNG", val:proStats.strong, clr:T.purple },
                { lbl:"WATCH", val:proData.length,  clr:T.cyan   },
              ].map(s => (
                <div key={s.lbl} style={{ display:"flex", alignItems:"center", gap:5,
                  background:T.bg2, border:\`1px solid \${T.border}\`, borderRadius:5, padding:"4px 10px" }}>
                  <span style={{ color:T.text2, fontSize:8.5, fontFamily:T.font, letterSpacing:0.8 }}>{s.lbl}</span>
                  <span style={{ color:s.clr, fontSize:14, fontFamily:T.font, fontWeight:800, lineHeight:1 }}>{s.val}</span>
                </div>
              ))}
              <div style={{ width:1, height:22, background:T.border, flexShrink:0 }}/>
              {[
                ["ALL",    \`ALL (\${proStats.total})\`       ],
                ["BUY",    \`▲ BUY (\${proStats.buy})\`       ],
                ["SELL",   \`▼ SELL (\${proStats.sell})\`     ],
                ["STRONG", \`⚡ STRONG (\${proStats.strong})\`],
              ].map(([key, lbl]) => (
                <button key={key} onClick={() => setProFilter(key)}
                  style={{
                    background: proFilter===key ? T.cyan+"14" : "transparent",
                    border: \`1px solid \${proFilter===key ? T.cyan+"45" : T.border}\`,
                    color: proFilter===key ? T.cyan : T.text2,
                    borderRadius:5, padding:"5px 11px", cursor:"pointer",
                    fontFamily:T.font, fontSize:9.5, fontWeight:600,
                  }}>
                  {lbl}
                </button>
              ))}
              <div style={{ marginLeft:"auto", display:"flex", gap:6, alignItems:"center" }}>
                {proWarmingUp.length > 0 && (
                  <span style={{ color:T.text2, fontSize:9.5, fontFamily:T.font }}>⏳ {proWarmingUp.length} warming</span>
                )}
                <button onClick={fetchProData} disabled={proLoading}
                  style={{ background:T.bg2, border:\`1px solid \${T.border}\`, color:T.text1,
                    borderRadius:5, padding:"5px 12px", cursor:proLoading?"wait":"pointer",
                    fontFamily:T.font, fontSize:10, fontWeight:600, opacity:proLoading?0.5:1 }}>
                  {proLoading ? "⏳" : "🔄"} {proLoading ? "Loading…" : "Refresh"}
                </button>
              </div>
            </>
          )}
        </div>

        {/* Row 2 — Sub-tabs: TECH ANALYSIS | EARNINGS */}
        <div style={{ display:"flex", alignItems:"center", gap:4, flexWrap:"wrap",
          paddingLeft:12, borderLeft:\`2px solid \${T.border}\`, marginLeft:6 }}>
          <span style={{ color:T.text2, fontSize:10, marginRight:2 }}>└</span>

          {/* TECH ANALYSIS sub-tab */}
          <button onClick={() => setSignalView("TECH")}
            style={{
              background: signalView==="TECH" ? T.cyan+"14" : "transparent",
              border: \`1px solid \${signalView==="TECH" ? T.cyan+"45" : T.border}\`,
              color: signalView==="TECH" ? T.cyan : T.text2,
              borderRadius:5, padding:"5px 14px", cursor:"pointer",
              fontFamily:T.font, fontSize:10, letterSpacing:0.4,
              fontWeight: signalView==="TECH" ? 700 : 500,
              transition:"all 0.15s",
            }}>
            ◈ TECH ANALYSIS{techData.length > 0 ? \` (\${techData.length})\` : ""}
          </button>

          {/* EARNINGS sub-tab */}
          <button onClick={() => setSignalView("EARNINGS")}
            style={{
              background: signalView==="EARNINGS" ? T.gold+"14" : "transparent",
              border: \`1px solid \${signalView==="EARNINGS" ? T.gold+"45" : T.border}\`,
              color: signalView==="EARNINGS" ? T.gold : T.text2,
              borderRadius:5, padding:"5px 14px", cursor:"pointer",
              fontFamily:T.font, fontSize:10, letterSpacing:0.4,
              fontWeight: signalView==="EARNINGS" ? 700 : 500,
              transition:"all 0.15s",
            }}>
            ◎ EARNINGS
          </button>

          {/* Inline filters when TECH sub-tab is active */}
          {signalView === "TECH" && (
            <>
              <div style={{ width:1, height:18, background:T.border, flexShrink:0, marginLeft:4 }}/>
              {techStats && [
                { lbl:"BULL", val:techStats.bullish, clr:T.green },
                { lbl:"BEAR", val:techStats.bearish, clr:T.red   },
                { lbl:"ALRT", val:techStats.alerts,  clr:T.gold  },
              ].map(s => (
                <div key={s.lbl} style={{ display:"flex", alignItems:"center", gap:4,
                  background:T.bg2, border:\`1px solid \${T.border}\`, borderRadius:5, padding:"3px 8px" }}>
                  <span style={{ color:T.text2, fontSize:8, fontFamily:T.font }}>{s.lbl}</span>
                  <span style={{ color:s.clr, fontSize:12, fontFamily:T.font, fontWeight:800 }}>{s.val}</span>
                </div>
              ))}
              {["ALL","BULLISH","BEARISH","ALERTS"].map(f => (
                <button key={f} onClick={() => setTechFilter(f)}
                  style={{
                    background: techFilter===f ? T.cyan+"14" : "transparent",
                    border: \`1px solid \${techFilter===f ? T.cyan+"45" : T.border}\`,
                    color: techFilter===f ? T.cyan : T.text2,
                    borderRadius:5, padding:"4px 9px", cursor:"pointer",
                    fontFamily:T.font, fontSize:9, fontWeight:600,
                  }}>
                  {f==="BULLISH"?"▲ ":f==="BEARISH"?"▼ ":f==="ALERTS"?"🚨 ":""}
                  {f}
                  {techStats && f==="ALL"     ? \` (\${techData.length})\`   : ""}
                  {techStats && f==="BULLISH" ? \` (\${techStats.bullish})\` : ""}
                  {techStats && f==="BEARISH" ? \` (\${techStats.bearish})\` : ""}
                  {techStats && f==="ALERTS"  ? \` (\${techStats.alerts})\`  : ""}
                </button>
              ))}
              <div style={{ marginLeft:"auto", display:"flex", gap:6, alignItems:"center" }}>
                {techLastFetch && (
                  <span style={{ color:T.text2, fontSize:9, fontFamily:T.font }}>
                    {techCached?"📦":"✅"} {techLastFetch.toLocaleTimeString()}
                  </span>
                )}
                <button onClick={() => fetchTechData(false)} disabled={techLoading}
                  style={{ background:T.bg2, border:\`1px solid \${T.border}\`, color:T.text1,
                    borderRadius:5, padding:"4px 10px", cursor:techLoading?"wait":"pointer",
                    fontFamily:T.font, fontSize:9, fontWeight:600, opacity:techLoading?0.5:1 }}>
                  {techLoading?"⏳":"🔄"} Refresh
                </button>
                <button onClick={() => fetchTechData(true)} disabled={techLoading}
                  style={{ background:T.cyanDim, border:\`1px solid \${T.cyanMid}\`, color:T.cyan,
                    borderRadius:5, padding:"4px 10px", cursor:techLoading?"wait":"pointer",
                    fontFamily:T.font, fontSize:9, fontWeight:700, opacity:techLoading?0.5:1 }}>
                  ⚡ Force
                </button>
              </div>
            </>
          )}
        </div>
      </div>`
);

// ─────────────────────────────────────────────────────────────────────────────
// PATCH 3 — Add EARNINGS sub-tab view after TECH ANALYSIS view closing block
// ─────────────────────────────────────────────────────────────────────────────
patch(
  "3 – EARNINGS sub-tab view",
  `      {/* ═══ TECH ANALYSIS VIEW ═══ */}`,
  `      {/* ═══ EARNINGS SUB-TAB VIEW ═══ */}
      {signalView === "EARNINGS" && (
        <EarningsSubPanel T={T} />
      )}

      {/* ═══ TECH ANALYSIS VIEW ═══ */}`
);

// ─────────────────────────────────────────────────────────────────────────────
// PATCH 4 — Insert AppearanceModal component + EarningsSubPanel just before
//           the PageDashboard function definition
// ─────────────────────────────────────────────────────────────────────────────
patch(
  "4 – AppearanceModal + EarningsSubPanel components",
  `// ─── PAGE: Dashboard ──────────────────────────────────────────────────────────`,
  `// ─── AppearanceModal ─────────────────────────────────────────────────────────
function AppearanceModal({ onClose, currentTheme, onThemeChange, T }) {
  const [selected, setSelected] = useState(currentTheme || "dark");

  const options = [
    {
      id: "light",
      label: "Light mode",
      preview: (
        <div style={{ width:"100%", height:90, background:"#ffffff", borderRadius:8,
          display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:6, padding:10 }}>
          <div style={{ width:"60%", height:10, background:"#d1d5db", borderRadius:4 }}/>
          <div style={{ width:"80%", height:36, background:"#9ca3af", borderRadius:6 }}/>
          <div style={{ width:"70%", height:8, background:"#d1d5db", borderRadius:4 }}/>
          <div style={{ width:"70%", height:8, background:"#d1d5db", borderRadius:4 }}/>
        </div>
      ),
    },
    {
      id: "dark",
      label: "Dark mode",
      preview: (
        <div style={{ width:"100%", height:90, background:"#111827", borderRadius:8,
          display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:6, padding:10 }}>
          <div style={{ width:"60%", height:10, background:"#374151", borderRadius:4 }}/>
          <div style={{ width:"80%", height:36, background:"#4b5563", borderRadius:6 }}/>
          <div style={{ width:"70%", height:8, background:"#374151", borderRadius:4 }}/>
          <div style={{ width:"70%", height:8, background:"#374151", borderRadius:4 }}/>
        </div>
      ),
    },
    {
      id: "auto",
      label: "Device default",
      preview: (
        <div style={{ width:"100%", height:90, borderRadius:8, overflow:"hidden",
          display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:6, padding:10,
          background:"linear-gradient(135deg, #f9fafb 50%, #111827 50%)" }}>
          <div style={{ width:"60%", height:10, background:"rgba(100,100,100,0.4)", borderRadius:4 }}/>
          <div style={{ width:"80%", height:36, background:"rgba(100,100,100,0.5)", borderRadius:6 }}/>
          <div style={{ width:"70%", height:8, background:"rgba(100,100,100,0.4)", borderRadius:4 }}/>
          <div style={{ width:"70%", height:8, background:"rgba(100,100,100,0.4)", borderRadius:4 }}/>
        </div>
      ),
    },
  ];

  const handleOK = () => {
    onThemeChange(selected);
    onClose();
  };

  return (
    <div style={{ position:"fixed", inset:0, zIndex:99999, display:"flex", alignItems:"center",
      justifyContent:"center", background:"rgba(0,0,0,0.55)", backdropFilter:"blur(4px)" }}
      onClick={onClose}>
      <div style={{ background:T.bg1, border:\`1px solid \${T.border}\`, borderRadius:16,
        padding:"32px 36px", width:520, maxWidth:"95vw", boxShadow:"0 20px 60px rgba(0,0,0,0.5)" }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:28 }}>
          <span style={{ color:T.text0, fontFamily:T.font, fontWeight:700, fontSize:20 }}>Appearance</span>
          <button onClick={onClose} style={{ background:"none", border:"none", color:T.text2,
            cursor:"pointer", fontSize:18, lineHeight:1, padding:4 }}>✕</button>
        </div>

        {/* Theme options */}
        <div style={{ display:"flex", gap:16, marginBottom:32 }}>
          {options.map(opt => (
            <div key={opt.id} onClick={() => setSelected(opt.id)}
              style={{ flex:1, cursor:"pointer", display:"flex", flexDirection:"column", gap:10 }}>
              <div style={{
                border: \`2px solid \${selected===opt.id ? "#0d9488" : T.border}\`,
                borderRadius:10, overflow:"hidden", padding:6,
                background: selected===opt.id ? "#0d948812" : T.bg2,
                transition:"all 0.15s",
              }}>
                {opt.preview}
              </div>
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                <div style={{
                  width:18, height:18, borderRadius:"50%", flexShrink:0,
                  border: \`2px solid \${selected===opt.id ? "#0d9488" : T.border}\`,
                  background: selected===opt.id ? "#0d948820" : "transparent",
                  display:"flex", alignItems:"center", justifyContent:"center",
                }}>
                  {selected===opt.id && (
                    <div style={{ width:8, height:8, borderRadius:"50%", background:"#0d9488" }}/>
                  )}
                </div>
                <span style={{ color:T.text0, fontFamily:T.font, fontSize:13, fontWeight:500 }}>{opt.label}</span>
              </div>
            </div>
          ))}
        </div>

        {/* OK button */}
        <button onClick={handleOK}
          style={{ width:"100%", padding:"13px 0", borderRadius:30, background:"#0d9488",
            border:"none", color:"#ffffff", fontFamily:T.font, fontSize:15, fontWeight:700,
            cursor:"pointer", transition:"opacity 0.15s" }}
          onMouseEnter={e => e.currentTarget.style.opacity="0.9"}
          onMouseLeave={e => e.currentTarget.style.opacity="1"}>
          OK
        </button>
      </div>
    </div>
  );
}

// ─── EarningsSubPanel (used inside PageSignals) ───────────────────────────────
function EarningsSubPanel({ T }) {
  const [weekOffset,   setWeekOffset]   = useState(0);
  const [selectedDay,  setSelectedDay]  = useState(null);
  const [earningsData, setEarningsData] = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState(null);

  const weekDates = useMemo(() => getWeekDates(weekOffset), [weekOffset]);

  useEffect(() => {
    setLoading(true); setError(null);
    const start = weekDates[0]?.isoDate;
    const end   = weekDates[weekDates.length - 1]?.isoDate;
    fetch(\`\${API_BASE}/api/earnings?start=\${start}&end=\${end}\`)
      .then(r => { if (!r.ok) throw new Error(\`HTTP \${r.status}\`); return r.json(); })
      .then(d => { setEarningsData(d || []); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [weekOffset, weekDates]);

  useEffect(() => {
    const today = weekDates.find(d => d.isToday);
    if (today) setSelectedDay(today.isoDate);
    else if (weekOffset === 0) setSelectedDay(null);
  }, [weekOffset, weekDates]);

  const activeDay = selectedDay || weekDates.find(d => d.isToday)?.isoDate || weekDates[0]?.isoDate;

  const dayEarnings = useMemo(() =>
    earningsData.filter(e => e.date === activeDay || e.earnings_date === activeDay),
  [earningsData, activeDay]);

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
      {/* Week nav + day pills */}
      <div style={{ display:"flex", gap:6, alignItems:"center", flexWrap:"wrap" }}>
        <button className="btn-ghost" style={{ fontSize:9 }} onClick={() => setWeekOffset(o => o - 1)}>← PREV</button>
        {weekDates.map(d => (
          <button key={d.isoDate} onClick={() => setSelectedDay(d.isoDate)}
            style={{ background: activeDay===d.isoDate ? T.cyanDim : T.bg2,
              border: \`1px solid \${activeDay===d.isoDate ? T.cyanMid : d.isToday ? T.borderHi : T.border}\`,
              color: activeDay===d.isoDate ? T.cyan : d.isToday ? T.text0 : T.text2,
              borderRadius:5, padding:"5px 12px", cursor:"pointer",
              fontFamily:T.font, fontSize:9,
              display:"flex", flexDirection:"column", alignItems:"center", gap:1 }}>
            <span>{d.day}</span>
            <span style={{ fontSize:8, opacity:0.7 }}>{d.date}</span>
            {d.isToday && <span style={{ fontSize:7, color:T.cyan }}>TODAY</span>}
          </button>
        ))}
        <button className="btn-ghost" style={{ fontSize:9 }} onClick={() => setWeekOffset(o => o + 1)}>NEXT →</button>
        {weekOffset !== 0 && (
          <button className="btn-ghost" style={{ fontSize:9 }} onClick={() => setWeekOffset(0)}>THIS WEEK</button>
        )}
        <span style={{ marginLeft:"auto", color:T.text2, fontSize:10, fontFamily:T.font }}>
          {loading ? "Loading…" : \`\${dayEarnings.length} earnings\`}
        </span>
      </div>

      {/* Table */}
      <div className="card" style={{ overflow:"hidden" }}>
        <div style={{ display:"grid", gridTemplateColumns:"90px 1fr 80px 70px 80px 80px 100px",
          background:T.bg0, borderBottom:\`2px solid \${T.border}\` }}>
          {["SYMBOL","COMPANY","DATE","TIME","EPS EST","REV EST","SECTOR"].map(h => (
            <div key={h} style={{ padding:"9px 10px", color:T.text1, fontSize:9,
              letterSpacing:1, fontFamily:T.font, fontWeight:800 }}>{h}</div>
          ))}
        </div>
        <div style={{ maxHeight:"calc(100vh - 480px)", overflowY:"auto" }}>
          {error ? (
            <EmptyState icon="⚠" label="ERROR" sub={error} h={120} T={T}/>
          ) : loading ? (
            Array(8).fill(0).map((_, i) => (
              <div key={i} style={{ display:"grid",
                gridTemplateColumns:"90px 1fr 80px 70px 80px 80px 100px",
                borderBottom:\`1px solid \${T.border}\`, padding:"10px 0" }}>
                {Array(7).fill(0).map((_, j) => (
                  <div key={j} className="shimmer-box" style={{ height:11, margin:"0 10px" }}/>
                ))}
              </div>
            ))
          ) : dayEarnings.length === 0 ? (
            <EmptyState icon="◎" label="NO EARNINGS" sub="No earnings scheduled for this day" h={140} T={T}/>
          ) : (
            dayEarnings.map((e, i) => (
              <div key={i} className="tr-hover"
                style={{ display:"grid", gridTemplateColumns:"90px 1fr 80px 70px 80px 80px 100px",
                  borderBottom:\`1px solid \${T.border}\` }}>
                <div style={{ padding:"10px", color:T.cyan, fontSize:12, fontFamily:T.font, fontWeight:700 }}>
                  {e.ticker || e.symbol}
                </div>
                <div style={{ padding:"10px", color:T.text1, fontSize:11, fontFamily:T.font,
                  whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
                  {e.company_name || "—"}
                </div>
                <div style={{ padding:"10px", color:T.text2, fontSize:11, fontFamily:T.font }}>
                  {e.date || e.earnings_date || "—"}
                </div>
                <div style={{ padding:"10px", fontSize:10, fontFamily:T.font, fontWeight:600,
                  color: e.earnings_time==="BMO" ? T.gold : e.earnings_time==="AMC" ? T.purple : T.text2 }}>
                  {e.earnings_time || e.time || "—"}
                </div>
                <div style={{ padding:"10px", color:T.text1, fontSize:11, fontFamily:T.font }}>
                  {e.eps_estimate || e.eps_est || "—"}
                </div>
                <div style={{ padding:"10px", color:T.text1, fontSize:11, fontFamily:T.font }}>
                  {e.revenue_estimate || e.rev_est || "—"}
                </div>
                <div style={{ padding:"10px", color:T.text2, fontSize:10, fontFamily:T.font }}>
                  {e.sector || "—"}
                </div>
              </div>
            ))
          )}
        </div>
        <div style={{ padding:"10px 16px", borderTop:\`2px solid \${T.border}\`,
          display:"flex", justifyContent:"space-between", background:T.bg0 }}>
          <span style={{ color:T.text1, fontSize:11, fontFamily:T.font, fontWeight:600 }}>
            {dayEarnings.length} earnings · {weekDates.find(d => d.isoDate === activeDay)?.date || ""}
          </span>
          <span style={{ color:T.text2, fontSize:10, fontFamily:T.font }}>BMO = Before Open · AMC = After Close</span>
        </div>
      </div>
    </div>
  );
}

// ─── PAGE: Dashboard ──────────────────────────────────────────────────────────`
);

// ─────────────────────────────────────────────────────────────────────────────
// PATCH 5 — Wire AppearanceModal into the App Shell:
//           a) add showAppearance state near the top of the App Shell
//           b) add Appearance menu item in the user dropdown
//           c) render the modal
// ─────────────────────────────────────────────────────────────────────────────
patch(
  "5a – showAppearance state",
  `  const [quickFilter, setQuickFilter] = useState(null);`,
  `  const [quickFilter, setQuickFilter] = useState(null);
  const [showAppearance, setShowAppearance] = useState(false);`
);

patch(
  "5b – Appearance menu item in user dropdown",
  `                {/* Sign out */}
                <div style={{ padding:6 }}>
                  <button
                    onClick={() => { setHeaderPanel(null); if (onSignOut) onSignOut(); }}`,
  `                {/* Appearance */}
                <div style={{ padding:"6px 6px 0" }}>
                  <button
                    onClick={() => { setHeaderPanel(null); setShowAppearance(true); }}
                    style={{ width:"100%", display:"flex", alignItems:"center", gap:10,
                      padding:"10px 12px", background:"transparent", border:"none",
                      borderRadius:6, cursor:"pointer", color:T.text1, fontFamily:T.font,
                      fontSize:13, fontWeight:500, transition:"background 0.15s", textAlign:"left" }}
                    onMouseEnter={e => e.currentTarget.style.background = T.bg2}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                  >
                    <span style={{ fontSize:15 }}>🎨</span> Appearance
                  </button>
                </div>
                {/* Sign out */}
                <div style={{ padding:6 }}>
                  <button
                    onClick={() => { setHeaderPanel(null); if (onSignOut) onSignOut(); }}`
);

patch(
  "5c – render AppearanceModal",
  `      {/* Page content */}
        <div key={page} style={{ flex:1, overflowY:"auto", padding:18 }}>`,
  `      {/* Appearance Modal */}
        {showAppearance && (
          <AppearanceModal
            T={T}
            currentTheme={currentTheme}
            onThemeChange={t => { if (onThemeChange) onThemeChange(t); }}
            onClose={() => setShowAppearance(false)}
          />
        )}

      {/* Page content */}
        <div key={page} style={{ flex:1, overflowY:"auto", padding:18 }}>`
);

// ─────────────────────────────────────────────────────────────────────────────
// Write output
// ─────────────────────────────────────────────────────────────────────────────
const outPath = filePath.replace(/\.jsx$/, ".patched.jsx");
fs.writeFileSync(outPath, src, "utf8");

console.log(`\n📄 Output: ${outPath}`);
console.log(`✅ ${patchCount} patch(es) applied successfully.\n`);
console.log("To use: rename the .patched.jsx → NexRadarDashboard.jsx");
console.log("  mv", outPath, filePath);
