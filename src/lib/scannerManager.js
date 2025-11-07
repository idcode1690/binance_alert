// Simple singleton scanner manager to run scans independent of React component lifecycle.
const scannerManager = (() => {
  let running = false;
  let currentSymbol = null;
  let progress = { done: 0, total: 0 };
  // load persisted results from localStorage when available so navigation doesn't lose matches
  let results = [];
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = window.localStorage.getItem('scannerResults');
      if (raw) results = JSON.parse(raw) || [];
    }
  } catch (e) {
    results = [];
  }
  let cancel = false;
  // timestamp when the current scan started (ms since epoch) - persists so UI can show elapsed across pages
  let scanStartTime = null;
  // track multiple abort controllers when running requests in parallel
  let currentAbortControllers = new Set();
  let listeners = new Set();
  let getSymbolsFn = null;

  function notify() {
    const state = { running, currentSymbol, progress: { ...progress }, results: results.slice(), scanStartTime };
    for (const cb of listeners) {
      try { cb(state); } catch (e) {}
    }
    // persist results after notifying
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem('scannerResults', JSON.stringify(results.slice(0, 200)));
      }
    } catch (e) {}
  }

  function onUpdate(cb) { listeners.add(cb); return () => listeners.delete(cb); }

  function setGetSymbols(fn) { getSymbolsFn = fn; }

  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

  // same EMA helper as used in ScannerPage
  function calculateEma(values, period) {
    if (!Array.isArray(values) || values.length === 0) return [];
    const k = 2 / (period + 1);
    const out = [];
    let ema = null;
    for (let i = 0; i < values.length; i++) {
      const v = Number(values[i]);
      if (isNaN(v)) { out.push(null); continue; }
      if (ema === null) {
        if (i + 1 >= period) {
          const slice = values.slice(i + 1 - period, i + 1).map(Number);
          const s = slice.reduce((a, b) => a + b, 0) / period;
          ema = s;
          out.push(ema);
        } else { out.push(null); }
      } else {
        ema = v * k + ema * (1 - k);
        out.push(ema);
      }
    }
    return out;
  }

  async function start(type, opts = {}) {
    if (running) return;
    if (typeof getSymbolsFn !== 'function') throw new Error('scannerManager: getSymbolsFn not set');
    // initialize run state
    running = true;
    cancel = false;
    results = [];
    progress = { done: 0, total: 0 };
    currentSymbol = null;
    scanStartTime = Date.now();
    notify();
    const list = (await Promise.resolve(getSymbolsFn())) || [];
    // accept options: interval (e.g., '5m' or number of minutes), emaShort, emaLong
    let interval = (opts && typeof opts.interval !== 'undefined') ? opts.interval : '5m';
    if (typeof interval === 'number' || (typeof interval === 'string' && /^\d+$/.test(interval))) interval = `${interval}m`;
    const emaShort = (opts && typeof opts.emaShort !== 'undefined') ? parseInt(opts.emaShort, 10) : 26;
    const emaLong = (opts && typeof opts.emaLong !== 'undefined') ? parseInt(opts.emaLong, 10) : 200;
    const filtered = (Array.isArray(list) ? list.filter(s => typeof s === 'string' && /USDT$/i.test(s)) : []);
    progress.total = filtered.length; notify();
    const endpointBase = 'https://fapi.binance.com/fapi/v1/klines';

  // concurrency controls: default to a faster parallelism for quicker scans
  // These defaults can be overridden via opts when calling start()
  // Adjusted defaults to slow the scanner a bit so a full pass is ~30s on typical symbol counts.
  // Make defaults conservative to avoid triggering API rate-limit warnings
  // Slightly faster defaults: increase parallelism and reduce inter-batch delay for quicker scans
  // Keep conservative limits to avoid hitting API rate limits.
  const concurrencyDefault = (opts && typeof opts.concurrency === 'number') ? Math.max(1, opts.concurrency) : 3;
  const batchDelayBase = (opts && typeof opts.batchDelay === 'number') ? Math.max(0, opts.batchDelay) : 400; // ms between batches
  // mutable runtime controls (auto-tuner will adjust these)
  let concurrencyCurrent = concurrencyDefault;
  let batchDelayCurrent = batchDelayBase;
  // cap maxConcurrency to the starting concurrency by default to prevent aggressive ramp-up
  const maxConcurrency = (opts && typeof opts.maxConcurrency === 'number') ? Math.max(1, opts.maxConcurrency) : concurrencyDefault;
  // backoff/ramp state
  let backoffCount = 0;
  let consecutiveSuccesses = 0;
  const successThreshold = (opts && typeof opts.rampSuccessThreshold === 'number') ? Math.max(1, opts.rampSuccessThreshold) : 3;
  const minBatchDelay = (opts && typeof opts.minBatchDelay === 'number') ? Math.max(150, opts.minBatchDelay) : 200;

  // helper to process one symbol; catches errors and always resolves
    const processSymbol = async (sym) => {
      if (cancel) return;
      currentSymbol = sym; notify();
      const url = `${endpointBase}?symbol=${encodeURIComponent(sym)}&interval=${encodeURIComponent(interval)}&limit=1000`;
      let localAbort = null;
      try {
        try { localAbort = new AbortController(); } catch (e) { localAbort = null; }
        if (localAbort) currentAbortControllers.add(localAbort);
        const r = await fetch(url, localAbort ? { signal: localAbort.signal } : undefined);
        if (!r.ok) {
          if (r.status === 429) {
            // increase backoff pressure and reduce concurrency
            backoffCount += 1;
            consecutiveSuccesses = 0;
            concurrencyCurrent = Math.max(1, Math.floor(concurrencyCurrent * 0.6));
            batchDelayCurrent = Math.min(30000, Math.floor(batchDelayCurrent * 1.6));
            const base = 1000;
            const backoffMs = Math.min(30000, Math.floor(base * Math.pow(2, Math.min(backoffCount, 6))) + Math.floor(Math.random() * 1000));
            try { await sleep(backoffMs); } catch (e) {}
          }
          return;
        }
        const data = await r.json();
        // success: reduce backoff pressure and allow gentle ramp-up
        backoffCount = Math.max(0, backoffCount - 1);
        consecutiveSuccesses += 1;
        if (consecutiveSuccesses >= successThreshold) {
          consecutiveSuccesses = 0;
          if (concurrencyCurrent < maxConcurrency) {
            concurrencyCurrent = concurrencyCurrent + 1;
          }
          batchDelayCurrent = Math.max(minBatchDelay, Math.floor(batchDelayCurrent * 0.85));
        }
        const closes = (Array.isArray(data) ? data.map(d => parseFloat(d[4])) : []);
        const needed = Math.max(emaShort, emaLong) + 10;
        if (!Array.isArray(closes) || closes.length < needed) { return; }
        const emaShortArr = calculateEma(closes, emaShort);
        const emaLongArr = calculateEma(closes, emaLong);
        const lastIdx = closes.length - 1;
        const prevIdx = lastIdx - 1;
        const prevShort = emaShortArr[prevIdx];
        const prevLong = emaLongArr[prevIdx];
        const lastShort = emaShortArr[lastIdx];
        const lastLong = emaLongArr[lastIdx];
        let matched = false;
        if (typeof prevShort === 'number' && typeof prevLong === 'number' && typeof lastShort === 'number' && typeof lastLong === 'number') {
          if (type === 'golden') { if (prevShort <= prevLong && lastShort > lastLong) matched = true; }
          else if (type === 'dead') { if (prevShort >= prevLong && lastShort < lastLong) matched = true; }
        }
        if (matched) {
          const ev = { id: `${sym}-${Date.now()}-${Math.random().toString(36).slice(2,8)}`, symbol: sym, lastShort, lastLong, time: new Date().toLocaleString(), interval, emaShort, emaLong };
          results.unshift(ev);
          // cap stored results to reasonable size (avoid unbounded growth)
          if (results.length > 500) results = results.slice(0, 500);
          notify();
        }
      } catch (e) {
        if (e && e.name === 'AbortError') {
          // expected when stopping
        } else {
          // ignore other fetch errors
        }
      } finally {
        // cleanup local abort controller
        if (localAbort) currentAbortControllers.delete(localAbort);
        progress.done += 1; notify();
      }
    };
    // run in batches with a mutable concurrency controlled by the auto-tuner
    let i = 0;
    try {
      while (i < filtered.length) {
        if (cancel) break;
        const currentConcurrency = Math.max(1, Math.floor(concurrencyCurrent));
        const batch = filtered.slice(i, i + currentConcurrency);
        if (!batch || batch.length === 0) break;
        await Promise.all(batch.map(sym => processSymbol(sym)));
        if (cancel) break;
        i += batch.length;
        if (i < filtered.length) {
          const jitter = Math.floor(Math.random() * Math.min(300, Math.max(20, Math.floor(batchDelayCurrent * 0.5))));
          const delay = Math.max(0, batchDelayCurrent + jitter);
          await sleep(delay);
        }
      }
    } catch (err) {
      // log unexpected errors but don't leave scanner in running state
      try { console.error('scannerManager.start error', err && err.message ? err.message : err); } catch (e) {}
    } finally {
      // cleanup any remaining abort controllers
      try { for (const c of currentAbortControllers) { try { c.abort(); } catch (e) {} } } catch (e) {}
      currentAbortControllers.clear();
      running = false; currentSymbol = null; cancel = false; scanStartTime = null; notify();
    }
  }

  function stop() {
    // signal cancellation and abort any in-flight fetch
    cancel = true;
    try {
      // abort any tracked controllers
      for (const c of currentAbortControllers) {
        try { if (c && typeof c.abort === 'function') c.abort(); } catch (e) {}
      }
      currentAbortControllers.clear();
    } catch (e) {}
    running = false; currentSymbol = null; scanStartTime = null; notify();
  }

  function getState() { return { running, currentSymbol, progress: { ...progress }, results: results.slice(), scanStartTime }; }

  function removeResult(id) {
    if (!id) return;
    results = results.filter(r => r.id !== id);
    notify();
  }

  function clearResults() {
    results = [];
    notify();
  }

  return { onUpdate, setGetSymbols, start, stop, getState, removeResult, clearResults };
})();

export default scannerManager;
