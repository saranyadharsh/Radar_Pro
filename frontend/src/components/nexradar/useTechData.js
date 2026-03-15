// useTechData.js — NexRadar Pro
// Hook for /api/market-monitor (tech analysis data).
// Fetched here — shared between PageDashboard Scalp Signals card and
// the TECH tab inside PageSignals.

import { useState, useRef, useCallback, useEffect } from "react";
import { API_BASE } from "../../config.js";

const STALE_MS       = 5  * 60 * 1000;
const FORCE_STALE_MS = 10 * 60 * 1000;

export function useTechData() {
  const [techData,      setTechData]      = useState([]);
  const [techLoading,   setTechLoading]   = useState(false);
  const [techError,     setTechError]     = useState(null);
  const [techLastFetch, setTechLastFetch] = useState(null);
  const [techCached,    setTechCached]    = useState(false);
  const [techDataAge,   setTechDataAge]   = useState(0);

  const techLoadingRef   = useRef(false);
  const techLastFetchRef = useRef(null);

  const fetchTechData = useCallback((forceRefresh = false) => {
    if (techLoadingRef.current) return;
    techLoadingRef.current = true;
    setTechLoading(true);
    setTechError(null);
    fetch(`${API_BASE}/api/market-monitor${forceRefresh ? "?refresh=1" : ""}`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(json => {
        if (json.error) { setTechError(json.error); return; }
        const now = new Date();
        setTechData(json.data || []);
        setTechCached(json.cached || false);
        setTechDataAge(json.data_age_sec || 0);
        setTechLastFetch(now);
        techLastFetchRef.current = now;
      })
      .catch(err => setTechError(err.message))
      .finally(() => { techLoadingRef.current = false; setTechLoading(false); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const lf = techLastFetchRef.current;
    const isStale      = !lf || (Date.now() - lf.getTime()) > STALE_MS;
    const isForceStale = !lf || (Date.now() - lf.getTime()) > FORCE_STALE_MS;
    if (isStale) fetchTechData(isForceStale);
    const id = setInterval(() => {
      const l = techLastFetchRef.current;
      fetchTechData(!l || (Date.now() - l.getTime()) > FORCE_STALE_MS);
    }, STALE_MS);
    // Refresh on window focus — ensures prices update after tab switch or browser wake
    const onFocus = () => {
      const l = techLastFetchRef.current;
      if (!l || (Date.now() - l.getTime()) > STALE_MS) fetchTechData(false);
    };
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(id); window.removeEventListener('focus', onFocus); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { techData, techLoading, techError, techLastFetch, techCached, techDataAge, fetchTechData };
}
