// ═══════════════════════════════════════════════════════════════
// AIEngine.js — Layer 2: COST · MANUAL · TOGGLE CONTROLLED
// Source: Claude API via NexRadar backend proxy
//
// SECURITY: API calls go through /api/ai/chat on the FastAPI
// backend — the Anthropic key is NEVER exposed in the browser.
// Raw fetch("https://api.anthropic.com") is blocked.
//
// PRODUCTION INTEGRATION:
//   - Place at: src/components/engines/AIEngine.js
//   - Backend:  requires ANTHROPIC_API_KEY env var on Render
//   - Enable:   Dashboard Settings → AI toggle
//   - Cost:     ~$0.026 per full analysis (3 agents)
// ═══════════════════════════════════════════════════════════════

import { API_BASE } from "../../config.js";

const CLAUDE_MODEL = "claude-sonnet-4-20250514";

// ─── State — controlled by Dashboard toggle ───────────────────
const state = {
  enabled:        false,
  briefEnabled:   true,
  techEnabled:    true,
  verdictEnabled: true,
  chatEnabled:    true,
};

export function setAIEnabled(val)        { state.enabled        = val; }
export function setBriefEnabled(val)     { state.briefEnabled   = val; }
export function setTechEnabled(val)      { state.techEnabled    = val; }
export function setVerdictEnabled(val)   { state.verdictEnabled = val; }
export function setChatEnabled(val)      { state.chatEnabled    = val; }
export function getAIState()             { return { ...state }; }
export function isAIEnabled()            { return state.enabled; }

// ─── Claude API call via backend proxy ────────────────────────
// Routes through FastAPI /api/ai/chat — Anthropic key stays on server
async function callClaude({ system, user, maxTokens = 1200 }) {
  const res = await fetch(`${API_BASE}/api/ai/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model:      CLAUDE_MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new Error(`AI proxy ${res.status}`);
  const data = await res.json();
  const text = (data.content || [])
    .filter(b => b.type === "text")
    .map(b => b.text)
    .join("\n");
  const match = text.match(/[\[{][\s\S]*[\]}]/);
  if (match) {
    try { return { text, parsed: JSON.parse(match[0]) }; } catch {}
  }
  return { text, parsed: null };
}

// ═══════════════════════════════════════════════════════════════
// AGENT 1 — ☀ MORNING BRIEF
// ═══════════════════════════════════════════════════════════════
export async function runMorningBrief(symbol, stockData, context = "watchlist") {
  if (!state.enabled || !state.briefEnabled) return null;
  const contextNote = {
    earnings: `EARNINGS PLAY. Focus on: beat/miss probability, EPS vs estimate $${stockData.earningsHistory?.[0]?.epsEst}, implied move ±${stockData.impliedMovePct}%, historical gap patterns.`,
    watchlist: `WATCHLIST POSITION. Focus on: today's setup quality, key price levels, catalyst if any, risk/reward for day trading.`,
    signals:  `SIGNAL FIRED. Focus on: why this signal is valid, confirmation factors, entry timing, signal quality HIGH/MEDIUM/LOW.`,
  }[context] || "";

  const { parsed } = await callClaude({
    maxTokens: 900,
    system: `You are NexRadar's Morning Brief AI — a sharp pre-market analyst for professional day traders. ${contextNote}
Data from Polygon.io (real-time) and EDGAR (SEC filings).
Return ONLY valid JSON, no markdown:
{"headline":string,"sentiment":"BULLISH"|"BEARISH"|"NEUTRAL"|"MIXED","sentimentScore":number,"todayOutlook":string,"preMarketNote":string,"keyLevel":number,"keyLevelType":"SUPPORT"|"RESISTANCE","keyLevelBreakTarget":number,"keyLevelRejectTarget":number,"catalysts":[string],"riskWarning":string,"volumeExpectation":"ELEVATED"|"NORMAL"|"LOW","edgarNote":string|null}`,
    user: `Morning brief for ${symbol} — ${new Date().toDateString()}.
Context: ${context}.
Polygon data: ${JSON.stringify({ price:stockData.price, change:stockData.change, changePct:stockData.changePct, volume:stockData.volume, avgVolume:stockData.avgVolume, rsi14:stockData.rsi14, macd:stockData.macd, macdSignal:stockData.macdSignal, sma20:stockData.sma20, sma50:stockData.sma50, sma200:stockData.sma200, support:stockData.support, resistance:stockData.resistance, atr:stockData.atr, impliedMovePct:stockData.impliedMovePct, news:stockData.news?.slice(0,3), earningsHistory:stockData.earningsHistory?.slice(0,4) })}
EDGAR: ${JSON.stringify(stockData.edgarFiling || "No new filings today")}`,
  });

  return parsed || {
    headline:`${symbol} — monitor today`, sentiment:"NEUTRAL", sentimentScore:5,
    todayOutlook:"AI brief temporarily unavailable.", preMarketNote:"",
    keyLevel:stockData.price||0, keyLevelType:"SUPPORT",
    keyLevelBreakTarget:(stockData.price||0)*1.04, keyLevelRejectTarget:(stockData.price||0)*0.97,
    catalysts:["Monitor price action","Watch volume"],
    riskWarning:"Verify with your own analysis.",
    volumeExpectation:"NORMAL", edgarNote:null,
  };
}

// ═══════════════════════════════════════════════════════════════
// AGENT 2 — ◈ TECHNICAL ANALYSIS
// ═══════════════════════════════════════════════════════════════
export async function runTechAnalysis(symbol, stockData) {
  if (!state.enabled || !state.techEnabled) return null;
  const { parsed } = await callClaude({
    maxTokens: 1000,
    system: `You are NexRadar's Technical Analysis AI — a systematic quant analyst for day traders.
Data from Polygon.io Professional.
Return ONLY valid JSON, no markdown:
{"trend":"UPTREND"|"DOWNTREND"|"SIDEWAYS"|"BREAKOUT"|"BREAKDOWN","trendStrength":number,"rsiSignal":"OVERBOUGHT"|"OVERSOLD"|"NEUTRAL","rsiNote":string,"macdSignal":"BULLISH_CROSS"|"BEARISH_CROSS"|"BULLISH"|"BEARISH"|"NEUTRAL","macdNote":string,"maStatus":"ABOVE_ALL"|"BELOW_ALL"|"MIXED"|"GOLDEN_CROSS"|"DEATH_CROSS","maNote":string,"volumeSignal":"HIGH"|"LOW"|"NORMAL","volumeNote":string,"supportLevel":number,"resistanceLevel":number,"stopLoss":number,"target1":number,"target2":number,"riskRewardRatio":number,"overallScore":number,"setupQuality":"EXCELLENT"|"GOOD"|"FAIR"|"POOR","summary":string}`,
    user: `Technical analysis for ${symbol}.
Price:$${stockData.price} RSI:${stockData.rsi14} MACD:${stockData.macd}|Signal:${stockData.macdSignal}|Hist:${stockData.macdHist}
SMA20:${stockData.sma20} SMA50:${stockData.sma50} SMA200:${stockData.sma200} EMA9:${stockData.ema9}
Support:${stockData.support} Resistance:${stockData.resistance} ATR:${stockData.atr}
Volume:${stockData.volume} Avg:${stockData.avgVolume} VWAP:${stockData.vwap} ImpliedMove:±${stockData.impliedMovePct}%`,
  });
  return parsed || {
    trend:"SIDEWAYS", trendStrength:5, rsiSignal:"NEUTRAL", rsiNote:"RSI neutral.",
    macdSignal:"NEUTRAL", macdNote:"MACD near signal.", maStatus:"MIXED", maNote:"Near MAs.",
    volumeSignal:"NORMAL", volumeNote:"Average volume.",
    supportLevel:stockData.support||0, resistanceLevel:stockData.resistance||0,
    stopLoss:(stockData.price||0)*0.97, target1:(stockData.price||0)*1.04,
    target2:(stockData.price||0)*1.08, riskRewardRatio:1.5,
    overallScore:5, setupQuality:"FAIR",
    summary:"Mixed picture. Wait for clearer direction.",
  };
}

// ═══════════════════════════════════════════════════════════════
// AGENT 3 — ⚡ INVESTMENT VERDICT
// ═══════════════════════════════════════════════════════════════
export async function runVerdict(symbol, stockData, brief, tech, context = "watchlist") {
  if (!state.enabled || !state.verdictEnabled) return null;
  const contextNote = {
    earnings: "EARNINGS PLAY — assess beat/miss probability, gap potential, pre/post trade plan.",
    watchlist:"WATCHLIST POSITION — assess right time to enter/hold/exit today.",
    signals:  "SIGNAL PLAY — assess signal quality, false signal risk, optimal execution.",
  }[context] || "";
  const { parsed } = await callClaude({
    maxTokens: 1000,
    system: `You are NexRadar's Investment Verdict AI — a senior day trading analyst. ${contextNote}
Return ONLY valid JSON, no markdown:
{"verdict":"STRONG BUY"|"BUY"|"HOLD"|"AVOID"|"STRONG AVOID"|"WATCH","confidence":number,"timeHorizon":"TODAY"|"1 WEEK"|"1 MONTH","fundamentalScore":number,"technicalScore":number,"sentimentScore":number,"momentumScore":number,"riskLevel":"LOW"|"MEDIUM"|"HIGH"|"VERY HIGH","rightTimeToInvest":boolean,"rightTimeReason":string,"bullCase":string,"bearCase":string,"actionPlan":string,"entryZone":string,"stopLoss":string,"target":string,"riskRewardRatio":string,"earningsEdge":"BEAT_LIKELY"|"MISS_LIKELY"|"IN_LINE"|"UNCERTAIN"|"NA","dealCatalyst":string|null}`,
    user: `Verdict for ${symbol}. Context:${context}.
price=$${stockData.price} RSI=${stockData.rsi14} MACD=${stockData.macd}
support=$${stockData.support} resistance=$${stockData.resistance}
volume=${stockData.volume} avg=${stockData.avgVolume} impliedMove=±${stockData.impliedMovePct}%
earningsHistory=${JSON.stringify(stockData.earningsHistory?.slice(0,3))}
EDGAR:${JSON.stringify(stockData.edgarFiling||"No new filings")}.
Brief: sentiment=${brief?.sentiment} score=${brief?.sentimentScore} keyLevel=$${brief?.keyLevel}(${brief?.keyLevelType}).
Tech: trend=${tech?.trend} score=${tech?.overallScore} setup=${tech?.setupQuality} stop=$${tech?.stopLoss} t1=$${tech?.target1} RR=${tech?.riskRewardRatio}.`,
  });
  return parsed || {
    verdict:"HOLD", confidence:50, timeHorizon:"TODAY",
    fundamentalScore:5, technicalScore:5, sentimentScore:5, momentumScore:5,
    riskLevel:"MEDIUM", rightTimeToInvest:false,
    rightTimeReason:"Insufficient data. Wait for confirmation.",
    bullCase:"Upside if catalysts materialise.",
    bearCase:"Downside if conditions worsen.",
    actionPlan:"Monitor key levels. Wait for confirmation.",
    entryZone:"TBD", stopLoss:"—", target:"—", riskRewardRatio:"—",
    earningsEdge:"NA", dealCatalyst:null,
  };
}

// ═══════════════════════════════════════════════════════════════
// AGENT 4 — 💬 AI CHAT
// ═══════════════════════════════════════════════════════════════
export async function runChat(symbol, message, history, stockData, agents) {
  if (!state.enabled || !state.chatEnabled) return null;
  const { text } = await callClaude({
    maxTokens: 500,
    system: `You are NexRadar AI for ${symbol} — a direct, precise day trading assistant.
Max 4 sentences. End with one clear actionable takeaway.
Context: ${JSON.stringify({ price:stockData?.price, rsi:stockData?.rsi14, macd:stockData?.macd, support:stockData?.support, resistance:stockData?.resistance, sentiment:agents?.brief?.sentiment, verdict:agents?.verdict?.verdict, rightTime:agents?.verdict?.rightTimeToInvest, entry:agents?.verdict?.entryZone, stop:agents?.verdict?.stopLoss, target:agents?.verdict?.target, edgarFiling:stockData?.edgarFiling })}`,
    user: [...history.slice(-4).map(m=>`${m.role}: ${m.text}`), `user: ${message}`].join("\n"),
  });
  return text;
}

// ═══════════════════════════════════════════════════════════════
// EDGAR EVENT CLASSIFIER
// ═══════════════════════════════════════════════════════════════
export async function classifyEdgarFiling(symbol, filing, stockData) {
  if (!state.enabled) return null;
  const { parsed } = await callClaude({
    maxTokens: 600,
    system: `You are NexRadar's EDGAR Event Classifier. A new SEC 8-K was detected.
Return ONLY valid JSON:
{"eventType":"EARNINGS"|"MERGER"|"ACQUISITION"|"CEO_CHANGE"|"BUYBACK"|"FDA"|"TRIAL_RESULT"|"DIVIDEND"|"LEGAL"|"OFFERING"|"GUIDANCE"|"OTHER","eventTitle":string,"impact":"VERY_POSITIVE"|"POSITIVE"|"NEUTRAL"|"NEGATIVE"|"VERY_NEGATIVE","impactScore":number,"summary":string,"priceImpact":string,"action":"BUY"|"HOLD"|"SELL"|"WATCH"|"WAIT","urgency":"HIGH"|"MEDIUM"|"LOW","alertMessage":string}`,
    user: `New 8-K for ${symbol}. Price:$${stockData?.price}. Filing:${JSON.stringify(filing)}`,
  });
  return parsed || {
    eventType:"OTHER", eventTitle:"New SEC Filing",
    impact:"NEUTRAL", impactScore:5,
    summary:"New 8-K detected. Review for details.",
    priceImpact:"Unknown", action:"WATCH", urgency:"MEDIUM",
    alertMessage:`New 8-K filing for ${symbol}.`,
  };
}

// ─── Run all 3 agents in parallel ────────────────────────────
export async function runAllAgents(symbol, stockData, context = "watchlist") {
  if (!state.enabled) return { brief:null, tech:null, verdict:null };
  const [brief, tech] = await Promise.all([
    state.briefEnabled   ? runMorningBrief(symbol, stockData, context) : Promise.resolve(null),
    state.techEnabled    ? runTechAnalysis(symbol, stockData)          : Promise.resolve(null),
  ]);
  const verdict = state.verdictEnabled
    ? await runVerdict(symbol, stockData, brief, tech, context)
    : null;
  return { brief, tech, verdict };
}

const AIEngine = {
  setAIEnabled, setBriefEnabled, setTechEnabled, setVerdictEnabled, setChatEnabled,
  getAIState, isAIEnabled,
  runMorningBrief, runTechAnalysis, runVerdict, runAllAgents, runChat, classifyEdgarFiling,
};
export default AIEngine;
