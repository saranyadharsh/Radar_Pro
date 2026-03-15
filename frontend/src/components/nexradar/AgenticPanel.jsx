// ═══════════════════════════════════════════════════════════════
// shared/AgenticPanel.jsx — Shared AI Right Panel
// Used by: NexRadarWatchlist, NexRadarEarnings, NexRadarSignals
// Shows: DataEngine data (always) + AI agents (when toggle ON)
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// AgenticPanel.jsx — Shared AI Right Panel
// Production path: src/components/nexradar/AgenticPanel.jsx
//
// T is received as a prop from the parent page.
// Engine paths are relative to src/components/engines/
// ═══════════════════════════════════════════════════════════════
import { useState, useEffect, useCallback, useRef } from "react";
import { fmt2, fmtB, fmtVol } from "./utils.js";
import DataEngine from "../engines/DataEngine.js";
import AIEngine   from "../engines/AIEngine.js";

// Local fmtPct — not in production utils.js
const fmtPct = (n) => n == null ? "—" : (n >= 0 ? "+" : "") + Number(n).toFixed(2) + "%";

// ─── Small UI atoms ───────────────────────────────────────────
export function Shimmer({ w="100%", h=11, r=4, T: _T }) {
  const _bg3 = _T?.bg3 || "#0f1c2e", _bg4 = _T?.bg4 || "#142038";
  return <div style={{ width:w, height:h, borderRadius:r,
    background:`linear-gradient(90deg,${_bg3} 0%,${_bg4} 50%,${_bg3} 100%)`,
    backgroundSize:"200% 100%", animation:"shimmer 1.4s infinite" }}/>;
}

export function ShimmerBlock({ lines=4 }) {
  const ws=[85,68,92,55,78];
  return <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
    {Array(lines).fill(0).map((_,i)=><Shimmer key={i} w={ws[i%ws.length]+"%"} h={10}/>)}
  </div>;
}

export function AgentDot({ done, loading }) {
  return <div style={{ width:6, height:6, borderRadius:"50%", flexShrink:0,
    background: done?T.green:loading?T.gold:T.bg4,
    boxShadow: loading?`0 0 6px ${T.gold}`:done?`0 0 4px ${T.green}`:"none",
    animation: loading?"pulse 1s infinite":"none" }}/>;
}

export function ScoreBar({ label, score, max=10 }) {
  const pct   = Math.min(100, Math.max(0,(score/max)*100));
  const color = pct>65?T.green:pct>40?T.gold:T.red;
  return <div style={{ marginBottom:10 }}>
    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
      <span style={{ color:T.text1, fontFamily:T.font, fontSize:10 }}>{label}</span>
      <span style={{ color, fontFamily:T.font, fontSize:11, fontWeight:700 }}>
        {fmt2(score,1)}/{max}
      </span>
    </div>
    <div style={{ height:4, background:T.bg4, borderRadius:3, overflow:"hidden" }}>
      <div style={{ height:"100%", width:pct+"%", background:color, borderRadius:3,
        transition:"width 1s ease", boxShadow:`0 0 6px ${color}60` }}/>
    </div>
  </div>;
}

export function VerdictBadge({ verdict }) {
  const v   = (verdict||"").toUpperCase();
  const cfg = {
    "STRONG BUY":  { color:T.green,  bg:T.greenDim,  border:T.green+"50",  icon:"⚡" },
    "BUY":         { color:T.green,  bg:T.greenDim,  border:T.green+"50",  icon:"▲" },
    "HOLD":        { color:T.gold,   bg:T.goldDim,   border:T.gold+"50",   icon:"◆" },
    "AVOID":       { color:T.red,    bg:T.redDim,    border:T.red+"50",    icon:"▼" },
    "STRONG AVOID":{ color:T.red,    bg:T.redDim,    border:T.red+"50",    icon:"⚠" },
    "WATCH":       { color:T.orange, bg:T.orangeDim, border:T.orange+"50", icon:"◎" },
  };
  const c = cfg[v]||cfg["HOLD"];
  return <div style={{ background:c.bg, border:`1px solid ${c.border}`,
    borderRadius:8, padding:"10px 14px", display:"flex", alignItems:"center", gap:10 }}>
    <span style={{ fontSize:22 }}>{c.icon}</span>
    <div>
      <div style={{ color:c.color, fontFamily:T.font, fontSize:14,
        fontWeight:900, letterSpacing:1 }}>{v}</div>
      <div style={{ color:T.text2, fontFamily:T.font, fontSize:8,
        marginTop:2, letterSpacing:1 }}>AI VERDICT</div>
    </div>
  </div>;
}

// ─── EDGAR Alert Banner ───────────────────────────────────────
function EdgarBanner({ result, symbol, onDismiss }) {
  if(!result) return null;
  const pos = ["VERY_POSITIVE","POSITIVE"].includes(result.impact);
  const color = pos?T.green:T.red;
  return <div style={{ background:color+"15", border:`1px solid ${color}40`,
    borderRadius:8, padding:"10px 13px", marginBottom:10,
    animation:"fadeIn 0.2s ease" }}>
    <div style={{ display:"flex", justifyContent:"space-between",
      alignItems:"center", marginBottom:5 }}>
      <div style={{ display:"flex", alignItems:"center", gap:7 }}>
        <span style={{ fontSize:15 }}>{pos?"🟢":"🔴"}</span>
        <span style={{ color, fontFamily:T.font, fontSize:9,
          fontWeight:900, letterSpacing:1 }}>
          EDGAR — {result.eventType} DETECTED
        </span>
        <span style={{ background:T.orangeDim, border:`1px solid ${T.orange}50`,
          color:T.orange, borderRadius:4, padding:"1px 6px",
          fontFamily:T.font, fontSize:7.5, fontWeight:700 }}>
          {result.urgency}
        </span>
      </div>
      <button onClick={onDismiss} style={{ background:"none", border:"none",
        color:T.text2, cursor:"pointer", fontSize:14, lineHeight:1 }}>×</button>
    </div>
    <p style={{ color:T.text0, fontFamily:T.font, fontSize:11,
      fontWeight:700, marginBottom:4 }}>{result.eventTitle}</p>
    <p style={{ color:T.text1, fontFamily:T.font, fontSize:10.5,
      lineHeight:1.7 }}>{result.summary}</p>
    <div style={{ display:"flex", gap:10, marginTop:7, flexWrap:"wrap" }}>
      <span style={{ color:T.text2, fontFamily:T.font, fontSize:9 }}>
        Price impact:
      </span>
      <span style={{ color, fontFamily:T.font, fontSize:9,
        fontWeight:700 }}>{result.priceImpact}</span>
      <span style={{ color:T.text2, fontFamily:T.font,
        fontSize:9, marginLeft:8 }}>Action:</span>
      <span style={{ color, fontFamily:T.font, fontSize:9,
        fontWeight:700 }}>{result.action}</span>
    </div>
  </div>;
}

// ─── AI Disabled Prompt ───────────────────────────────────────
function AIDisabledPrompt({ onEnable }) {
  return <div style={{ background:T.bg2, border:`1px solid ${T.border}`,
    borderRadius:8, padding:"14px 13px", marginTop:8 }}>
    <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8 }}>
      <span style={{ fontSize:18, opacity:0.4 }}>⚡</span>
      <span style={{ color:T.text2, fontFamily:T.font, fontSize:10,
        fontWeight:700, letterSpacing:0.5 }}>AI ENGINE IS OFF</span>
    </div>
    <p style={{ color:T.text2, fontFamily:T.font, fontSize:10,
      lineHeight:1.7, marginBottom:10 }}>
      Enable AI in Dashboard Settings to get:
    </p>
    {["☀ Morning Brief","◈ Technical Analysis","⚡ Investment Verdict","💬 AI Chat"]
      .map(label => (
        <div key={label} style={{ display:"flex", alignItems:"center", gap:8,
          padding:"5px 8px", marginBottom:4, background:T.bg3,
          border:`1px solid ${T.border}`, borderRadius:5 }}>
          <span style={{ color:T.text2, fontFamily:T.font, fontSize:10 }}>{label}</span>
        </div>
    ))}
    <div style={{ marginTop:10, padding:"5px 8px", background:T.bg3,
      border:`1px solid ${T.border}`, borderRadius:5, display:"flex",
      justifyContent:"space-between" }}>
      <span style={{ color:T.text2, fontFamily:T.font, fontSize:9 }}>Cost per click</span>
      <span style={{ color:T.gold, fontFamily:T.font, fontSize:9,
        fontWeight:700 }}>~$0.026</span>
    </div>
    {onEnable && (
      <button onClick={onEnable}
        style={{ marginTop:10, width:"100%", background:T.cyanDim,
          border:`1px solid ${T.cyanMid}`, color:T.cyan, borderRadius:6,
          padding:"8px", cursor:"pointer", fontFamily:T.font,
          fontSize:10, fontWeight:700 }}>
        ENABLE AI ENGINE →
      </button>
    )}
  </div>;
}

// ═══════════════════════════════════════════════════════════════
// AGENTIC PANEL — Main Component
// ═══════════════════════════════════════════════════════════════
export default function AgenticPanel({ ticker, rowHint={}, context="watchlist", onNavigateToSettings, T }) {
  const [tab,          setTab]          = useState("data");
  const [stockData,    setStockData]    = useState(null);
  const [edgarResult,  setEdgarResult]  = useState(null);
  const [brief,        setBrief]        = useState(null);
  const [tech,         setTech]         = useState(null);
  const [verdict,      setVerdict]      = useState(null);
  const [chat,         setChat]         = useState([]);
  const [chatInput,    setChatInput]    = useState("");
  const [chatLoading,  setChatLoading]  = useState(false);
  const [aiEnabled,    setAiEnabled]    = useState(false);
  const [ld, setLd] = useState({ data:false, edgar:false, brief:false, tech:false, verdict:false });
  const bottomRef    = useRef(null);
  const edgarPollRef = useRef(null);
  const setL = (k, v) => setLd(p => ({ ...p, [k]:v }));

  // Check AI state on mount and after toggle
  const refreshAIState = useCallback(() => {
    setAiEnabled(AIEngine.isAIEnabled());
  }, []);
  useEffect(() => {
    refreshAIState();
    const interval = setInterval(refreshAIState, 1000);
    return () => clearInterval(interval);
  }, []);

  // Main flow — fires on ticker change
  useEffect(() => {
    if (!ticker) return;
    setStockData(null); setBrief(null); setTech(null);
    setVerdict(null); setEdgarResult(null);
    setChat([]); setTab("data");
    clearInterval(edgarPollRef.current);

    const run = async () => {
      // ── PHASE 1: DataEngine (FREE · AUTO) ──────────────────
      setL("data", true);
      setL("edgar", true);

      const [fullData, edgarCheck] = await Promise.all([
        DataEngine.getFullStockData(ticker),
        DataEngine.checkEdgarFilings(ticker),
      ]);
      setL("edgar", false);

      // Merge EDGAR result into stockData
      const enriched = {
        ...fullData,
        edgarFiling: edgarCheck.newFiling ? edgarCheck : null,
      };
      setStockData(enriched);
      setL("data", false);

      // If EDGAR found a new 8-K AND AI is on → classify it
      if (edgarCheck.newFiling && AIEngine.isAIEnabled()) {
        const classified = await AIEngine.classifyEdgarFiling(
          ticker, edgarCheck, enriched
        );
        setEdgarResult(classified);
      } else if (edgarCheck.newFiling) {
        // AI off — show raw filing info
        setEdgarResult({
          eventType:  edgarCheck.formType || "8-K",
          eventTitle: `New ${edgarCheck.formType || "8-K"} filed`,
          impact:     "NEUTRAL",
          impactScore: 5,
          summary:    `Filing date: ${edgarCheck.filedAt}. AI classification disabled.`,
          priceImpact: "Unknown — enable AI for analysis",
          action:     "WATCH",
          urgency:    "MEDIUM",
          alertMessage: `New filing for ${ticker}`,
        });
      }

      // ── PHASE 2: AIEngine (COST · MANUAL) ──────────────────
      if (!AIEngine.isAIEnabled()) return;

      setL("brief", true); setL("tech", true);
      const [b, tc] = await Promise.all([
        AIEngine.runMorningBrief(ticker, enriched, context)
          .finally(() => setL("brief", false)),
        AIEngine.runTechAnalysis(ticker, enriched)
          .finally(() => setL("tech", false)),
      ]);
      setBrief(b); setTech(tc);

      // Agent 3 gets Agent 1+2 as context
      setL("verdict", true);
      const v = await AIEngine.runVerdict(ticker, enriched, b, tc, context)
        .finally(() => setL("verdict", false));
      setVerdict(v);
    };

    run();

    // EDGAR polling — 30s during 4-8 PM, 60s otherwise
    const isEarningsWindow = new Date().getHours() >= 16 && new Date().getHours() <= 20;
    edgarPollRef.current = setInterval(async () => {
      const check = await DataEngine.checkEdgarFilings(ticker);
      if (check.newFiling) {
        const sd = stockData || {};
        if (AIEngine.isAIEnabled()) {
          const classified = await AIEngine.classifyEdgarFiling(ticker, check, sd);
          setEdgarResult(classified);
          // Re-run all agents with new EDGAR context
          const enriched2 = { ...sd, edgarFiling: check };
          const [b2, tc2] = await Promise.all([
            AIEngine.runMorningBrief(ticker, enriched2, context),
            AIEngine.runTechAnalysis(ticker, enriched2),
          ]);
          setBrief(b2); setTech(tc2);
          const v2 = await AIEngine.runVerdict(ticker, enriched2, b2, tc2, context);
          setVerdict(v2);
        } else {
          setEdgarResult({ eventType:"8-K", eventTitle:"New filing detected",
            impact:"NEUTRAL", impactScore:5,
            summary:`New ${check.formType} filed. Enable AI for analysis.`,
            priceImpact:"Unknown", action:"WATCH", urgency:"MEDIUM" });
        }
      }
    }, isEarningsWindow ? 30000 : 60000);

    return () => clearInterval(edgarPollRef.current);
  }, [ticker, context]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior:"smooth" }); }, [chat]);

  const sendChat = useCallback(async (msg) => {
    if (!msg.trim() || chatLoading || !AIEngine.isAIEnabled()) return;
    const q = msg.trim(); setChatInput(""); setChatLoading(true);
    setChat(prev => [...prev, { role:"user", text:q }]);
    try {
      const reply = await AIEngine.runChat(
        ticker, q, chat, stockData, { brief, tech, verdict }
      );
      setChat(prev => [...prev, { role:"ai", text: reply || "No response." }]);
    } catch (e) {
      setChat(prev => [...prev, { role:"ai", text:"⚠ "+e.message }]);
    } finally { setChatLoading(false); }
  }, [ticker, chat, stockData, brief, tech, verdict, chatLoading]);

  // ── Empty state ─────────────────────────────────────────────
  if (!ticker) return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%",
      alignItems:"center", justifyContent:"center", padding:20, gap:14 }}>
      <div style={{ fontSize:40, opacity:0.08 }}>◎</div>
      <p style={{ color:T.text2, fontFamily:T.font, fontSize:11,
        fontWeight:700, letterSpacing:0.5, textAlign:"center" }}>
        SELECT A TICKER
      </p>
      <p style={{ color:T.text2, fontFamily:T.font, fontSize:10,
        lineHeight:1.8, opacity:0.7, textAlign:"center" }}>
        Click any row to load<br/>Polygon data + EDGAR check
        {aiEnabled && <><br/>+ 3 AI agents</>}
      </p>
      <div style={{ width:"100%", borderTop:`1px solid ${T.border}`,
        paddingTop:14, display:"flex", flexDirection:"column", gap:6 }}>
        {[
          { icon:"⚡", label:"EDGAR Watcher",     desc:"Live 8-K detection · FREE",     free:true },
          { icon:"📊", label:"Polygon Data",       desc:"Price · RSI · MACD · ATR · FREE", free:true },
          { icon:"☀", label:"Morning Brief",      desc:"AI outlook · ~$0.008",           free:false },
          { icon:"◈", label:"Technical Analysis", desc:"AI signals · ~$0.009",           free:false },
          { icon:"⚡", label:"Investment Verdict", desc:"AI verdict · ~$0.009",           free:false },
          { icon:"💬", label:"AI Chat",            desc:"AI chat · ~$0.006/msg",          free:false },
        ].map(a => (
          <div key={a.label} style={{ display:"flex", alignItems:"center", gap:9,
            padding:"6px 10px", background:T.bg3,
            border:`1px solid ${a.free||aiEnabled?T.border:T.border}`,
            borderRadius:5, opacity: (!a.free && !aiEnabled) ? 0.5 : 1 }}>
            <span style={{ fontSize:12, width:16, textAlign:"center", flexShrink:0 }}>{a.icon}</span>
            <div style={{ flex:1 }}>
              <div style={{ color:T.text1, fontFamily:T.font, fontSize:9.5,
                fontWeight:600 }}>{a.label}</div>
              <div style={{ color:T.text2, fontFamily:T.font, fontSize:8.5 }}>{a.desc}</div>
            </div>
            <span style={{ color:a.free?T.green:aiEnabled?T.gold:T.text2,
              fontFamily:T.font, fontSize:8, fontWeight:700 }}>
              {a.free?"FREE":aiEnabled?"ON":"OFF"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );

  const d = stockData;
  const tabs = [
    { id:"data",    label:"📊 DATA",    always:true },
    { id:"brief",   label:"☀ BRIEF",   aiOnly:true,  done:!!brief,   loading:ld.brief },
    { id:"tech",    label:"◈ TECH",    aiOnly:true,  done:!!tech,    loading:ld.tech },
    { id:"verdict", label:"⚡ VERDICT", aiOnly:true,  done:!!verdict, loading:ld.verdict },
    { id:"chat",    label:"💬 CHAT",   aiOnly:true,  done:true,      loading:false },
  ].filter(t => t.always || aiEnabled);

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%", overflow:"hidden" }}>

      {/* ── HEADER ─────────────────────────────────────────── */}
      <div style={{ padding:"10px 13px", borderBottom:`1px solid ${T.border}`,
        background:T.bg0, flexShrink:0 }}>
        {/* Symbol + company */}
        <div style={{ display:"flex", alignItems:"center",
          justifyContent:"space-between", marginBottom:6 }}>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            {ld.data ? <Shimmer w={70} h={15} r={4}/> :
              <span style={{ color:T.cyan, fontSize:15, fontFamily:T.font,
                fontWeight:900 }}>{ticker}</span>}
            {d?.companyName && !ld.data && (
              <span style={{ color:T.text2, fontSize:9, fontFamily:T.font,
                maxWidth:120, overflow:"hidden", textOverflow:"ellipsis",
                whiteSpace:"nowrap" }}>{d.companyName}</span>
            )}
          </div>
          {/* EDGAR indicator */}
          <div style={{ display:"flex", alignItems:"center", gap:5 }}>
            <div style={{ width:5, height:5, borderRadius:"50%",
              background:ld.edgar?T.gold:edgarResult?T.orange:T.green,
              boxShadow:`0 0 5px ${ld.edgar?T.gold:edgarResult?T.orange:T.green}`,
              animation:"pulse 2s infinite" }}/>
            <span style={{ color:T.text2, fontFamily:T.font, fontSize:7.5 }}>
              {ld.edgar?"EDGAR CHECK":edgarResult?"EDGAR ALERT":"EDGAR LIVE"}
            </span>
          </div>
        </div>

        {/* Price */}
        {ld.data ? <Shimmer w="65%" h={15}/> : d && (
          <div style={{ display:"flex", alignItems:"baseline",
            gap:8, flexWrap:"wrap", marginBottom:8 }}>
            <span style={{ color:T.text0, fontFamily:T.font,
              fontSize:18, fontWeight:900 }}>${fmt2(d.price)}</span>
            {d.change != null && (
              <span style={{ color:d.change>=0?T.green:T.red,
                fontFamily:T.font, fontSize:11, fontWeight:600 }}>
                {d.change>=0?"▲":"▼"} {fmt2(Math.abs(d.change))}
                ({fmt2(Math.abs(d.changePct))}%)
              </span>
            )}
            {d.impliedMovePct && (
              <span style={{ color:T.purple, fontFamily:T.font, fontSize:9 }}>
                ±{fmt2(d.impliedMovePct)}% IV
              </span>
            )}
          </div>
        )}

        {/* Key data row */}
        {d && !ld.data && (
          <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)",
            gap:5, marginBottom:8 }}>
            {[
              { l:"RSI",   v:d.rsi14!=null?fmt2(d.rsi14,1):"—",
                c:d.rsi14>70?T.red:d.rsi14<30?T.green:T.text1 },
              { l:"VOL",   v:d.volume?`${(d.volume/1e6).toFixed(1)}M`:"—", c:T.text1 },
              { l:"ATR",   v:d.atr?`$${fmt2(d.atr)}`:"—", c:T.text1 },
              { l:"VWAP",  v:d.vwap?`$${fmt2(d.vwap)}`:"—",
                c:d.price>=d.vwap?T.green:T.red },
            ].map(s => (
              <div key={s.l} style={{ background:T.bg3,
                border:`1px solid ${T.border}`, borderRadius:4, padding:"4px 7px" }}>
                <div style={{ color:T.text2, fontFamily:T.font,
                  fontSize:7, letterSpacing:0.8 }}>{s.l}</div>
                <div style={{ color:s.c, fontFamily:T.font,
                  fontSize:11, fontWeight:700 }}>{s.v}</div>
              </div>
            ))}
          </div>
        )}

        {/* Agent status dots */}
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          {[
            { label:"EDGAR",   done:!ld.edgar, loading:ld.edgar },
            { label:"POLYGON", done:!!d&&!ld.data, loading:ld.data },
            ...(aiEnabled ? [
              { label:"BRIEF",   done:!!brief,   loading:ld.brief },
              { label:"TECH",    done:!!tech,    loading:ld.tech },
              { label:"VERDICT", done:!!verdict, loading:ld.verdict },
            ] : [
              { label:"AI OFF",  done:false, loading:false },
            ]),
          ].map(a => (
            <div key={a.label} style={{ display:"flex", alignItems:"center", gap:3 }}>
              <AgentDot done={a.done} loading={a.loading}/>
              <span style={{ color:a.done?T.text1:a.loading?T.gold:T.text2,
                fontFamily:T.font, fontSize:7.5, letterSpacing:0.3 }}>
                {a.label}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* ── TAB BAR ────────────────────────────────────────── */}
      <div style={{ display:"flex", borderBottom:`1px solid ${T.border}`,
        background:T.bg1, flexShrink:0 }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ flex:1, background:tab===t.id?T.cyanDim:"transparent",
              border:"none",
              borderBottom:`2px solid ${tab===t.id?T.cyan:"transparent"}`,
              color:tab===t.id?T.cyan:t.loading?T.gold:T.text2,
              padding:"8px 2px", cursor:"pointer", fontFamily:T.font,
              fontSize:8, fontWeight:700, letterSpacing:0.3,
              transition:"all 0.15s",
              animation:t.loading?"pulse 1s infinite":"none" }}>
            {t.loading?"⏳":""}{t.label}
          </button>
        ))}
      </div>

      {/* ── CONTENT ────────────────────────────────────────── */}
      <div style={{ flex:1, overflowY:"auto", padding:12,
        animation:"fadeIn 0.2s ease" }}>

        {/* EDGAR banner — always on top regardless of tab */}
        {edgarResult && (
          <EdgarBanner result={edgarResult} symbol={ticker}
            onDismiss={() => setEdgarResult(null)}/>
        )}

        {/* ── DATA TAB (FREE · AUTO) ─────────────────────── */}
        {tab==="data" && (
          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
            {ld.data ? <ShimmerBlock lines={8}/> : d && <>
              {/* Price levels */}
              <div style={{ background:T.bg2, border:`1px solid ${T.border}`,
                borderRadius:8, padding:"10px 12px" }}>
                <p style={{ color:T.text2, fontFamily:T.font, fontSize:8,
                  letterSpacing:1, marginBottom:8 }}>PRICE LEVELS · POLYGON</p>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6 }}>
                  {[
                    { l:"SUPPORT",    v:`$${fmt2(d.support)}`,    c:T.green },
                    { l:"RESISTANCE", v:`$${fmt2(d.resistance)}`, c:T.red },
                    { l:"SMA 20",     v:`$${fmt2(d.sma20)}`,      c:d.price>=d.sma20?T.green:T.red },
                    { l:"SMA 50",     v:`$${fmt2(d.sma50)}`,      c:d.price>=d.sma50?T.green:T.red },
                    { l:"SMA 200",    v:`$${fmt2(d.sma200)}`,     c:d.price>=d.sma200?T.green:T.red },
                    { l:"VWAP",       v:`$${fmt2(d.vwap)}`,       c:d.price>=d.vwap?T.green:T.red },
                  ].map(lv => (
                    <div key={lv.l} style={{ background:T.bg3,
                      border:`1px solid ${T.border}`, borderRadius:5, padding:"7px 9px" }}>
                      <div style={{ color:T.text2, fontFamily:T.font,
                        fontSize:7.5, letterSpacing:0.8, marginBottom:2 }}>{lv.l}</div>
                      <div style={{ color:lv.c, fontFamily:T.font,
                        fontSize:12, fontWeight:700 }}>{lv.v}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Technicals */}
              <div style={{ background:T.bg2, border:`1px solid ${T.border}`,
                borderRadius:8, padding:"10px 12px" }}>
                <p style={{ color:T.text2, fontFamily:T.font, fontSize:8,
                  letterSpacing:1, marginBottom:8 }}>TECHNICALS · POLYGON</p>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6 }}>
                  {[
                    { l:"RSI 14",     v:fmt2(d.rsi14,1),
                      c:d.rsi14>70?T.red:d.rsi14<30?T.green:T.gold },
                    { l:"MACD",       v:fmt2(d.macd),
                      c:d.macd>d.macdSignal?T.green:T.red },
                    { l:"MACD SIGNAL",v:fmt2(d.macdSignal), c:T.text1 },
                    { l:"MACD HIST",  v:fmt2(d.macdHist),
                      c:d.macdHist>0?T.green:T.red },
                    { l:"ATR",        v:`$${fmt2(d.atr)}`, c:T.text1 },
                    { l:"IV MOVE",    v:d.impliedMovePct?`±${fmt2(d.impliedMovePct)}%`:"—", c:T.purple },
                  ].map(lv => (
                    <div key={lv.l} style={{ background:T.bg3,
                      border:`1px solid ${T.border}`, borderRadius:5, padding:"7px 9px" }}>
                      <div style={{ color:T.text2, fontFamily:T.font,
                        fontSize:7.5, letterSpacing:0.8, marginBottom:2 }}>{lv.l}</div>
                      <div style={{ color:lv.c, fontFamily:T.font,
                        fontSize:11, fontWeight:700 }}>{lv.v}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* News */}
              {d.news?.length > 0 && (
                <div style={{ background:T.bg2, border:`1px solid ${T.border}`,
                  borderRadius:8, padding:"10px 12px" }}>
                  <p style={{ color:T.text2, fontFamily:T.font, fontSize:8,
                    letterSpacing:1, marginBottom:8 }}>LATEST NEWS · POLYGON</p>
                  {d.news.slice(0, 4).map((n, i) => (
                    <div key={i} style={{ display:"flex", gap:8, marginBottom:8,
                      paddingBottom:8, borderBottom:i<3?`1px solid ${T.border}`:"none" }}>
                      <div style={{ width:6, height:6, borderRadius:"50%", flexShrink:0,
                        marginTop:4,
                        background:n.sentiment==="positive"?T.green:
                          n.sentiment==="negative"?T.red:T.gold }}/>
                      <div>
                        <p style={{ color:T.text1, fontFamily:T.font,
                          fontSize:10, lineHeight:1.6 }}>{n.headline}</p>
                        <span style={{ color:T.text2, fontFamily:T.font,
                          fontSize:8 }}>{n.source}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Earnings history */}
              {d.earningsHistory?.length > 0 && (
                <div style={{ background:T.bg2, border:`1px solid ${T.border}`,
                  borderRadius:8, padding:"10px 12px" }}>
                  <p style={{ color:T.text2, fontFamily:T.font, fontSize:8,
                    letterSpacing:1, marginBottom:8 }}>EARNINGS HISTORY · POLYGON</p>
                  {d.earningsHistory.slice(0, 4).map((e, i) => (
                    <div key={i} style={{ display:"flex", justifyContent:"space-between",
                      padding:"5px 0", borderBottom:`1px solid ${T.border}` }}>
                      <span style={{ color:T.text2, fontFamily:T.font, fontSize:9 }}>
                        {e.period} {e.year}
                      </span>
                      <div style={{ display:"flex", gap:10 }}>
                        <span style={{ color:T.text1, fontFamily:T.font, fontSize:9 }}>
                          EPS ${fmt2(e.epsActual)}
                        </span>
                        <span style={{ color:e.epsSurprise>=0?T.green:T.red,
                          fontFamily:T.font, fontSize:9, fontWeight:700 }}>
                          {e.epsSurprise>=0?"+":""}{fmt2(e.surprisePct)}%
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* AI disabled notice */}
              {!aiEnabled && (
                <AIDisabledPrompt onEnable={onNavigateToSettings}/>
              )}
            </>}
          </div>
        )}

        {/* ── BRIEF TAB ──────────────────────────────────── */}
        {tab==="brief" && (
          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
            {ld.brief && !brief ? <ShimmerBlock lines={6}/> : brief && <>
              {/* Sentiment card */}
              {(() => {
                const sc = brief.sentiment==="BULLISH"?T.green:
                  brief.sentiment==="BEARISH"?T.red:T.gold;
                const sb = brief.sentiment==="BULLISH"?T.greenDim:
                  brief.sentiment==="BEARISH"?T.redDim:T.goldDim;
                return <div style={{ background:sb,
                  border:`1px solid ${sc}40`, borderRadius:8, padding:"10px 13px" }}>
                  <div style={{ display:"flex", justifyContent:"space-between",
                    marginBottom:5 }}>
                    <span style={{ color:sc, fontFamily:T.font, fontSize:9,
                      fontWeight:700, letterSpacing:1 }}>
                      {brief.sentiment==="BULLISH"?"▲ BULLISH":
                       brief.sentiment==="BEARISH"?"▼ BEARISH":"◆ "+brief.sentiment}
                    </span>
                    <span style={{ color:T.text2, fontFamily:T.font,
                      fontSize:8.5 }}>{brief.sentimentScore}/10</span>
                  </div>
                  <p style={{ color:T.text0, fontFamily:T.font, fontSize:12,
                    fontWeight:700, lineHeight:1.5 }}>"{brief.headline}"</p>
                </div>;
              })()}

              {/* Outlook */}
              <div style={{ background:T.bg2, border:`1px solid ${T.border}`,
                borderRadius:7, padding:"10px 12px" }}>
                <p style={{ color:T.text2, fontFamily:T.font, fontSize:8,
                  letterSpacing:1, marginBottom:6 }}>☀ TODAY'S OUTLOOK</p>
                <p style={{ color:T.text1, fontFamily:T.font, fontSize:10.5,
                  lineHeight:1.8 }}>{brief.todayOutlook}</p>
              </div>

              {/* Key level */}
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                <div style={{ background:T.bg3, border:`1px solid ${T.border}`,
                  borderRadius:6, padding:"9px 10px" }}>
                  <div style={{ color:T.text2, fontFamily:T.font, fontSize:7.5,
                    letterSpacing:0.8, marginBottom:3 }}>
                    KEY {brief.keyLevelType}
                  </div>
                  <div style={{ color:brief.keyLevelType==="SUPPORT"?T.green:T.red,
                    fontFamily:T.font, fontSize:15, fontWeight:800 }}>
                    ${fmt2(brief.keyLevel)}
                  </div>
                  <div style={{ color:T.text2, fontFamily:T.font, fontSize:8,
                    marginTop:3 }}>Break → ${fmt2(brief.keyLevelBreakTarget)}</div>
                  <div style={{ color:T.text2, fontFamily:T.font, fontSize:8 }}>
                    Reject → ${fmt2(brief.keyLevelRejectTarget)}</div>
                </div>
                <div style={{ background:T.bg3, border:`1px solid ${T.border}`,
                  borderRadius:6, padding:"9px 10px" }}>
                  <div style={{ color:T.text2, fontFamily:T.font, fontSize:7.5,
                    letterSpacing:0.8, marginBottom:3 }}>VOLUME EXP.</div>
                  <div style={{ color:brief.volumeExpectation==="ELEVATED"?T.gold:T.text1,
                    fontFamily:T.font, fontSize:12, fontWeight:800 }}>
                    {brief.volumeExpectation}
                  </div>
                </div>
              </div>

              {/* Catalysts */}
              {brief.catalysts?.length > 0 && (
                <div style={{ background:T.bg2, border:`1px solid ${T.border}`,
                  borderRadius:7, padding:"10px 12px" }}>
                  <p style={{ color:T.text2, fontFamily:T.font, fontSize:8,
                    letterSpacing:1, marginBottom:8 }}>⚡ KEY CATALYSTS</p>
                  {brief.catalysts.map((c,i) => (
                    <div key={i} style={{ display:"flex", gap:7, marginBottom:5 }}>
                      <span style={{ color:T.cyan, fontFamily:T.font,
                        fontSize:11, flexShrink:0 }}>›</span>
                      <span style={{ color:T.text1, fontFamily:T.font,
                        fontSize:10.5, lineHeight:1.6 }}>{c}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Risk */}
              {brief.riskWarning && (
                <div style={{ background:T.redDim, border:`1px solid ${T.red}30`,
                  borderRadius:6, padding:"8px 10px", display:"flex", gap:7 }}>
                  <span style={{ color:T.red, flexShrink:0 }}>⚠</span>
                  <p style={{ color:T.text1, fontFamily:T.font,
                    fontSize:10.5, lineHeight:1.6 }}>{brief.riskWarning}</p>
                </div>
              )}
            </>}
          </div>
        )}

        {/* ── TECH TAB ───────────────────────────────────── */}
        {tab==="tech" && (
          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
            {ld.tech && !tech ? <ShimmerBlock lines={7}/> : tech && <>
              {/* Trend header */}
              <div style={{ background:T.bg2, border:`1px solid ${T.border}`,
                borderRadius:8, padding:"11px 13px" }}>
                <div style={{ display:"flex", justifyContent:"space-between",
                  alignItems:"center", marginBottom:10 }}>
                  <div>
                    <div style={{ color:T.text2, fontFamily:T.font,
                      fontSize:7.5, letterSpacing:0.8 }}>TREND</div>
                    <div style={{ color:["UPTREND","BREAKOUT"].includes(tech.trend)?T.green:
                      ["DOWNTREND","BREAKDOWN"].includes(tech.trend)?T.red:T.gold,
                      fontFamily:T.font, fontSize:14, fontWeight:900,
                      marginTop:2 }}>{tech.trend}</div>
                  </div>
                  <div style={{ textAlign:"right" }}>
                    <div style={{ color:T.text2, fontFamily:T.font,
                      fontSize:7.5, letterSpacing:0.8 }}>SETUP</div>
                    <div style={{ color:tech.setupQuality==="EXCELLENT"?T.green:
                      tech.setupQuality==="GOOD"?T.cyan:
                      tech.setupQuality==="FAIR"?T.gold:T.red,
                      fontFamily:T.font, fontSize:12, fontWeight:700,
                      marginTop:2 }}>{tech.setupQuality}</div>
                  </div>
                </div>
                <ScoreBar label="Overall Score"  score={tech.overallScore}/>
                <ScoreBar label="Trend Strength" score={tech.trendStrength}/>
                <p style={{ color:T.text1, fontFamily:T.font, fontSize:10.5,
                  lineHeight:1.7, marginTop:6 }}>{tech.summary}</p>
              </div>

              {/* Signal cards */}
              {[
                { l:"RSI",  sig:tech.rsiSignal,   note:tech.rsiNote,
                  c:tech.rsiSignal==="OVERSOLD"?T.green:
                    tech.rsiSignal==="OVERBOUGHT"?T.red:T.gold },
                { l:"MACD", sig:tech.macdSignal,  note:tech.macdNote,
                  c:tech.macdSignal?.includes("BULL")?T.green:
                    tech.macdSignal?.includes("BEAR")?T.red:T.gold },
                { l:"MA",   sig:tech.maStatus,    note:tech.maNote,
                  c:["ABOVE_ALL","GOLDEN_CROSS"].includes(tech.maStatus)?T.green:
                    ["BELOW_ALL","DEATH_CROSS"].includes(tech.maStatus)?T.red:T.gold },
                { l:"VOL",  sig:tech.volumeSignal,note:tech.volumeNote,
                  c:tech.volumeSignal==="HIGH"?T.cyan:T.text1 },
              ].map(s => (
                <div key={s.l} style={{ background:T.bg3,
                  border:`1px solid ${T.border}`, borderRadius:6, padding:"9px 11px" }}>
                  <div style={{ display:"flex", justifyContent:"space-between",
                    marginBottom:4 }}>
                    <span style={{ color:T.text2, fontFamily:T.font,
                      fontSize:8, letterSpacing:0.8 }}>{s.l}</span>
                    <span style={{ color:s.c, fontFamily:T.font,
                      fontSize:9.5, fontWeight:700 }}>{s.sig}</span>
                  </div>
                  <p style={{ color:T.text1, fontFamily:T.font,
                    fontSize:10, lineHeight:1.6 }}>{s.note}</p>
                </div>
              ))}

              {/* Price levels */}
              <div style={{ background:T.bg2, border:`1px solid ${T.border}`,
                borderRadius:8, padding:"10px 12px" }}>
                <p style={{ color:T.text2, fontFamily:T.font, fontSize:8,
                  letterSpacing:1, marginBottom:8 }}>TRADE LEVELS</p>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6 }}>
                  {[
                    { l:"SUPPORT",    v:`$${fmt2(tech.supportLevel)}`,    c:T.green },
                    { l:"RESISTANCE", v:`$${fmt2(tech.resistanceLevel)}`, c:T.red },
                    { l:"STOP LOSS",  v:`$${fmt2(tech.stopLoss)}`,        c:T.red },
                    { l:"TARGET 1",   v:`$${fmt2(tech.target1)}`,         c:T.cyan },
                    { l:"TARGET 2",   v:`$${fmt2(tech.target2)}`,         c:T.cyan },
                    { l:"RISK/REWARD",v:`1:${fmt2(tech.riskRewardRatio,1)}`, c:T.gold },
                  ].map(lv => (
                    <div key={lv.l} style={{ background:T.bg3,
                      border:`1px solid ${T.border}`, borderRadius:5, padding:"7px 9px" }}>
                      <div style={{ color:T.text2, fontFamily:T.font,
                        fontSize:7.5, letterSpacing:0.8, marginBottom:2 }}>{lv.l}</div>
                      <div style={{ color:lv.c, fontFamily:T.font,
                        fontSize:12, fontWeight:700 }}>{lv.v}</div>
                    </div>
                  ))}
                </div>
              </div>
            </>}
          </div>
        )}

        {/* ── VERDICT TAB ────────────────────────────────── */}
        {tab==="verdict" && (
          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
            {ld.verdict && !verdict ? <ShimmerBlock lines={8}/> : verdict && <>
              <VerdictBadge verdict={verdict.verdict}/>

              {/* Meta grid */}
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:6 }}>
                {[
                  { l:"CONFIDENCE", v:verdict.confidence+"%",
                    c:verdict.confidence>70?T.green:verdict.confidence>50?T.gold:T.red },
                  { l:"HORIZON",    v:verdict.timeHorizon,  c:T.cyan },
                  { l:"RISK",       v:verdict.riskLevel,
                    c:verdict.riskLevel==="LOW"?T.green:
                      verdict.riskLevel==="MEDIUM"?T.gold:T.red },
                  { l:"EARNINGS",   v:verdict.earningsEdge,
                    c:verdict.earningsEdge==="BEAT_LIKELY"?T.green:
                      verdict.earningsEdge==="MISS_LIKELY"?T.red:T.gold },
                  { l:"R/R RATIO",  v:`1:${verdict.riskRewardRatio}`, c:T.gold },
                ].map(m => (
                  <div key={m.l} style={{ background:T.bg3,
                    border:`1px solid ${T.border}`, borderRadius:5, padding:"7px 8px" }}>
                    <div style={{ color:T.text2, fontFamily:T.font,
                      fontSize:7, letterSpacing:0.8, marginBottom:2 }}>{m.l}</div>
                    <div style={{ color:m.c, fontFamily:T.font,
                      fontSize:9.5, fontWeight:700, lineHeight:1.3 }}>{m.v}</div>
                  </div>
                ))}
              </div>

              {/* Scores */}
              <div style={{ background:T.bg2, border:`1px solid ${T.border}`,
                borderRadius:8, padding:"10px 12px" }}>
                <p style={{ color:T.text2, fontFamily:T.font, fontSize:8,
                  letterSpacing:1, marginBottom:10 }}>SCORE BREAKDOWN</p>
                <ScoreBar label="Fundamental" score={verdict.fundamentalScore}/>
                <ScoreBar label="Technical"   score={verdict.technicalScore}/>
                <ScoreBar label="Sentiment"   score={verdict.sentimentScore}/>
                <ScoreBar label="Momentum"    score={verdict.momentumScore}/>
              </div>

              {/* Right time */}
              <div style={{ background:verdict.rightTimeToInvest?T.greenDim:T.redDim,
                border:`1px solid ${verdict.rightTimeToInvest?T.green+"40":T.red+"40"}`,
                borderRadius:8, padding:"11px 13px" }}>
                <div style={{ display:"flex", alignItems:"center",
                  gap:8, marginBottom:7 }}>
                  <span style={{ fontSize:16 }}>
                    {verdict.rightTimeToInvest?"✅":"⛔"}
                  </span>
                  <span style={{ color:verdict.rightTimeToInvest?T.green:T.red,
                    fontFamily:T.font, fontSize:11, fontWeight:900,
                    letterSpacing:0.5 }}>
                    {verdict.rightTimeToInvest
                      ?"RIGHT TIME TO INVEST"
                      :"NOT THE RIGHT TIME"}
                  </span>
                </div>
                <p style={{ color:T.text1, fontFamily:T.font,
                  fontSize:11, lineHeight:1.8 }}>{verdict.rightTimeReason}</p>
              </div>

              {/* Bull/Bear */}
              <div style={{ background:T.greenDim, border:`1px solid ${T.green}30`,
                borderRadius:6, padding:"9px 11px" }}>
                <p style={{ color:T.green, fontFamily:T.font, fontSize:8,
                  fontWeight:700, letterSpacing:1, marginBottom:5 }}>▲ BULL CASE</p>
                <p style={{ color:T.text1, fontFamily:T.font,
                  fontSize:10.5, lineHeight:1.7 }}>{verdict.bullCase}</p>
              </div>
              <div style={{ background:T.redDim, border:`1px solid ${T.red}30`,
                borderRadius:6, padding:"9px 11px" }}>
                <p style={{ color:T.red, fontFamily:T.font, fontSize:8,
                  fontWeight:700, letterSpacing:1, marginBottom:5 }}>▼ BEAR CASE</p>
                <p style={{ color:T.text1, fontFamily:T.font,
                  fontSize:10.5, lineHeight:1.7 }}>{verdict.bearCase}</p>
              </div>

              {/* Action plan */}
              <div style={{ background:T.bg2, border:`1px solid ${T.borderHi}`,
                borderRadius:8, padding:"10px 12px" }}>
                <p style={{ color:T.cyan, fontFamily:T.font, fontSize:8,
                  fontWeight:700, letterSpacing:1, marginBottom:7 }}>⚡ ACTION PLAN</p>
                <p style={{ color:T.text1, fontFamily:T.font, fontSize:10.5,
                  lineHeight:1.8, marginBottom:9 }}>{verdict.actionPlan}</p>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:6 }}>
                  {[
                    { l:"ENTRY ZONE", v:verdict.entryZone, c:T.cyan },
                    { l:"STOP LOSS",  v:verdict.stopLoss,  c:T.red },
                    { l:"TARGET",     v:verdict.target,    c:T.green },
                  ].map(lv => (
                    <div key={lv.l} style={{ background:T.bg3,
                      border:`1px solid ${T.border}`, borderRadius:5,
                      padding:"7px 8px", textAlign:"center" }}>
                      <div style={{ color:T.text2, fontFamily:T.font,
                        fontSize:7, letterSpacing:0.8, marginBottom:2 }}>{lv.l}</div>
                      <div style={{ color:lv.c, fontFamily:T.font,
                        fontSize:10, fontWeight:700 }}>{lv.v}</div>
                    </div>
                  ))}
                </div>
              </div>
            </>}
          </div>
        )}

        {/* ── CHAT TAB ───────────────────────────────────── */}
        {tab==="chat" && (
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {chat.length === 0 && (
              <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
                <p style={{ color:T.text2, fontFamily:T.font,
                  fontSize:8.5, letterSpacing:1, marginBottom:4 }}>
                  QUICK QUESTIONS
                </p>
                {[
                  `Is ${ticker} a good buy right now?`,
                  "What's the best entry and stop loss?",
                  "Any EDGAR filings I should know about?",
                  "What happens if it breaks resistance?",
                  "Is the volume confirming this move?",
                ].map(q => (
                  <button key={q} onClick={() => sendChat(q)}
                    style={{ background:T.bg2, border:`1px solid ${T.border}`,
                      color:T.text1, borderRadius:6, padding:"8px 11px",
                      cursor:"pointer", fontFamily:T.font, fontSize:10,
                      textAlign:"left", lineHeight:1.5, transition:"all 0.12s" }}
                    onMouseEnter={e => {
                      e.currentTarget.style.background=T.cyanDim;
                      e.currentTarget.style.borderColor=T.cyanMid;
                      e.currentTarget.style.color=T.cyan;
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.background=T.bg2;
                      e.currentTarget.style.borderColor=T.border;
                      e.currentTarget.style.color=T.text1;
                    }}>
                    {q}
                  </button>
                ))}
              </div>
            )}
            {chat.map((m,i) => (
              <div key={i} style={{ padding:"9px 11px", borderRadius:8,
                fontSize:10.5, fontFamily:T.font, lineHeight:1.8,
                whiteSpace:"pre-wrap",
                background: m.role==="user"?T.cyanDim:T.bg2,
                border:`1px solid ${m.role==="user"?T.cyanMid:T.border}`,
                color: m.role==="user"?T.cyan:T.text1,
                maxWidth:"96%",
                alignSelf: m.role==="user"?"flex-end":"flex-start",
                animation:"fadeIn 0.15s ease" }}>{m.text}</div>
            ))}
            {chatLoading && (
              <div style={{ display:"flex", gap:5, padding:"10px 12px",
                background:T.bg2, border:`1px solid ${T.border}`,
                borderRadius:8, width:58 }}>
                {[0,.2,.4].map((d,i) =>
                  <div key={i} style={{ width:5, height:5, borderRadius:"50%",
                    background:T.cyan, animation:`pulse 1s ${d}s infinite` }}/>)}
              </div>
            )}
            <div ref={bottomRef}/>
          </div>
        )}
      </div>

      {/* ── CHAT INPUT ─────────────────────────────────── */}
      {tab==="chat" && aiEnabled && (
        <div style={{ padding:"9px 12px", borderTop:`1px solid ${T.border}`,
          display:"flex", gap:7, background:T.bg0, flexShrink:0 }}>
          <input value={chatInput} onChange={e => setChatInput(e.target.value)}
            onKeyDown={e => e.key==="Enter" && sendChat(chatInput)}
            placeholder={`Ask about ${ticker}…`}
            style={{ flex:1, background:T.bg2, border:`1px solid ${T.border}`,
              borderRadius:6, padding:"8px 11px", color:T.text0,
              fontFamily:T.font, fontSize:11, outline:"none", caretColor:T.cyan }}/>
          <button onClick={() => sendChat(chatInput)}
            disabled={!chatInput.trim() || chatLoading}
            style={{ background:chatInput.trim()&&!chatLoading?T.cyan:T.bg3,
              color:chatInput.trim()&&!chatLoading?"#000":T.text2,
              border:"none", borderRadius:6, padding:"0 13px", cursor:"pointer",
              fontFamily:T.font, fontSize:12, fontWeight:800,
              transition:"all 0.15s" }}>▶</button>
        </div>
      )}
    </div>
  );
}
