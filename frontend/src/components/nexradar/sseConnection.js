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
//
// SHARED-WORKER-HIJACK-FIX: Previously used sse.port.onmessage = handler which
// is a single-slot assignment. Multiple React callers chaining on the same port
// would save/restore the previous handler on cleanup. If caller A unmounted
// before B, A's cleanup restored .onmessage to null, wiping B's handler.
//
// Fix: use port.addEventListener('message', ...) — a multi-subscriber list where
// each caller independently adds/removes its own handler with no chaining risk.
// port.start() is already called in connectWorker so messages flow immediately.
// The EventSource path was already safe (always used addEventListener).
export function attachSSEListener(sse, onPayload) {
  if (!sse || typeof onPayload !== 'function') return () => {};

  if (isSharedWorker(sse)) {
    // addEventListener is multi-subscriber safe — no .onmessage slot mutation.
    const handler = (e) => { onPayload(e.data); };
    sse.port.addEventListener('message', handler);
    return () => { if (sse.port) sse.port.removeEventListener('message', handler); };
  }

  if (sse instanceof EventSource) {
    const handler = (e) => { try { onPayload(JSON.parse(e.data)); } catch {} };
    sse.addEventListener('message', handler);
    return () => sse.removeEventListener('message', handler);
  }

  return () => {};
}
