// normalizer.js — NexRadar Pro
// Single fix point for field alias bugs in ticker data.
// All SSE tick / snapshot rows pass through normalizeTicker() before entering
// tickerCacheRef so the rest of the app can rely on canonical field names.

/**
 * Normalizes a raw ticker row from the backend into canonical NexRadar fields.
 * This is the ONLY place that resolves field name aliases.
 *
 * Canonical fields guaranteed after normalization:
 *   ticker, company_name, sector, live_price, change_value, percent_change,
 *   open, open_price, prev_close, today_close, volume, rvol, volume_ratio,
 *   is_gap_play, gap_percent, ah_momentum, volume_spike, volume_spike_level,
 *   is_earnings_gap_play, went_positive, hwm, day_high, day_low,
 *   update_count, session, pullback_state, gap_direction, gap_magnitude,
 *   last_update
 *
 * BUG-1 FIX: open / open_price alias resolution added.
 *   ws_engine now includes both "open" and "open_price" in _DELTA_FIELDS, but
 *   older Supabase-cached rows or REST fallback rows may only have one or the
 *   other. The normalizer ensures both are always present after this call.
 *   PageLiveTable renders ticker.open for the MH OPEN column — if this field
 *   is absent (e.g. after a cache clear + REST snapshot before the first
 *   snapshot_delta arrives), the column shows $0.00.
 *   Defensive chain: open → open_price → 0; open_price → open → 0.
 */
export function normalizeTicker(raw) {
  if (!raw) return raw;
  // BUG-1 FIX: resolve open / open_price bidirectionally before spreading.
  // Priority: explicit "open" field first (set by _handle_tick and snapshot routes),
  // then "open_price" alias, then 0. Same logic for open_price in reverse.
  const resolvedOpen      = raw.open      ?? raw.open_price ?? 0;
  const resolvedOpenPrice = raw.open_price ?? raw.open      ?? 0;
  return {
    ...raw,
    // BUG-1 FIX: both aliases always present after normalization
    open:          resolvedOpen,
    open_price:    resolvedOpenPrice,
    // Company name (alias: company vs company_name)
    company_name:  raw.company_name  || raw.company  || raw.name || "",
    // Volume ratio (alias: rvol vs volume_ratio)
    rvol:          raw.rvol          ?? raw.volume_ratio ?? 1,
    volume_ratio:  raw.volume_ratio  ?? raw.rvol ?? 1,
    // High watermark / day high
    hwm:           raw.hwm           ?? raw.day_high ?? 0,
    day_high:      raw.day_high      ?? raw.hwm ?? 0,
  };
}

/**
 * Normalizes a raw earnings row into canonical shape.
 */
export function normalizeEarning(e) {
  return {
    ...e,
    ticker:       e.ticker        || e.symbol       || "",
    company_name: e.company_name  || e.name         || "",
    date:         e.earnings_date || e.date         || e.report_date || "",
    time:         e.earnings_time || e.time         || e.when        || "TNS",
    eps_est:      e.eps_estimate  || e.eps_est      || e.epsEstimate || null,
    rev_est:      e.rev_estimate  || e.rev_est      || e.revenueEstimate || null,
  };
}

/**
 * Normalizes an array of earnings rows.
 * Also handles multiple response shapes: bare array, {data:[]}, {earnings:[]}, {results:[]}.
 */
export function normalizeEarningsResponse(data) {
  const arr = Array.isArray(data)            ? data :
              Array.isArray(data?.data)      ? data.data :
              Array.isArray(data?.earnings)  ? data.earnings :
              Array.isArray(data?.results)   ? data.results : [];
  return arr.map(normalizeEarning);
}
