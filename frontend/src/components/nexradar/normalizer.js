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
 *   open, prev_close, today_close, volume, rvol, volume_ratio,
 *   is_gap_play, gap_percent, ah_momentum, volume_spike, volume_spike_level,
 *   is_earnings_gap_play, went_positive, hwm, day_high, day_low,
 *   update_count, session, pullback_state, gap_direction, gap_magnitude,
 *   last_update
 */
export function normalizeTicker(raw) {
  if (!raw) return raw;
  return {
    ...raw,
    // Company name (alias: company vs company_name)
    company_name:  raw.company_name  || raw.company  || raw.name || "",
    // Open price (alias: open vs open_price)
    open:          raw.open          ?? raw.open_price ?? 0,
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
