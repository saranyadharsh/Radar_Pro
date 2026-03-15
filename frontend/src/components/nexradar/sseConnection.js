// sseConnection.js — NexRadar Pro
// Safe SharedWorker helpers for mobile compatibility.
//
// SharedWorker is NOT supported on:
//   - iOS Safari (all versions)
//   - Chrome on iOS
//   - Some Android WebViews
//   - Firefox Private Browsing
//
// Using `x instanceof SharedWorker` on these browsers throws:
//   ReferenceError: SharedWorker is not defined
// which crashes any component that runs the check, even inside try/catch
// at the call site (the ReferenceError happens at parse/eval time on old engines).
//
// USAGE: replace every `x instanceof SharedWorker` with `isSharedWorker(x)`

// ── Feature detection — safe even if SharedWorker is not defined ──────────────
export const supportsSharedWorker = (() => {
  try { return typeof SharedWorker !== 'undefined' && !!SharedWorker; }
  catch { return false; }
})();

// ── Safe instanceof replacement ───────────────────────────────────────────────
// Use this everywhere instead of `x instanceof SharedWorker`.
// Returns false (not a crash) on mobile where SharedWorker is undefined.
export const isSharedWorker = (x) =>
  supportsSharedWorker && x != null && x.constructor?.name === 'SharedWorker';

// ── Attach a message listener to either a SharedWorker or EventSource ─────────
// Returns a cleanup function.
//
//   const cleanup = attachSSEListener(sseRef.current, payload => { ... });
//   return cleanup; // in useEffect
export function attachSSEListener(sse, onPayload) {
  if (!sse || typeof onPayload !== 'function') return () => {};

  if (isSharedWorker(sse)) {
    const prev = sse.port.onmessage;
    sse.port.onmessage = (e) => { if (prev) prev(e); onPayload(e.data); };
    return () => { if (sse.port) sse.port.onmessage = prev; };
  }

  if (sse instanceof EventSource) {
    const handler = (e) => { try { onPayload(JSON.parse(e.data)); } catch {} };
    sse.addEventListener('message', handler);
    return () => sse.removeEventListener('message', handler);
  }

  return () => {};
}
