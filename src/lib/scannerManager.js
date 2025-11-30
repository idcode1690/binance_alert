// Optimized singleton scanner manager to run scans independent of React component lifecycle.
const scannerManager = (() => {
  let running = false;
  let currentSymbol = null;
  let scanType = null;
  let progress = { done: 0, total: 0 };
  let results = [];
  // activeMatches: map of symbol -> active match info for real-time monitoring
  let activeMatches = {};
  try { if (typeof window !== 'undefined' && window.localStorage) { const raw = window.localStorage.getItem('scannerResults'); if (raw) results = JSON.parse(raw) || []; } } catch (e) { results = []; }
  let cancel = false;
  let scanStartTime = null;
  let currentAbortControllers = new Set();
  let listeners = new Set();
  let getSymbolsFn = null;
  let workerInstance = null;
  // throttle notifications to reduce render overhead
  let lastNotifyTs = 0; let pendingNotify = false;

  function stateSnapshot() { return { running, currentSymbol, scanType, progress: { ...progress }, results: results.slice(), active: Object.values(activeMatches), scanStartTime }; }
  function notifyNow() {
    const s = stateSnapshot();
    for (const cb of listeners) { try { cb(s); } catch (e) {} }
    try { if (typeof window !== 'undefined' && window.localStorage) { window.localStorage.setItem('scannerResults', JSON.stringify(results.slice(0, 200))); } } catch (e) {}
  }
  function notifyThrottled(force = false) {
    try {
      const now = Date.now();
      // If the page is hidden (background tab), don't rely on setTimeout-based throttling
      // which browsers may clamp heavily; instead deliver notifications synchronously so
      // the React state held by listeners stays up-to-date when the tab becomes visible.
      const isHidden = (typeof document !== 'undefined' && document.hidden);
      if (isHidden) {
        lastNotifyTs = now; pendingNotify = false; notifyNow(); return;
      }
      if (force || now - lastNotifyTs >= 100) { lastNotifyTs = now; pendingNotify = false; notifyNow(); return; }
      if (!pendingNotify) { pendingNotify = true; const wait = Math.max(0, 100 - (now - lastNotifyTs)); setTimeout(() => { lastNotifyTs = Date.now(); pendingNotify = false; notifyNow(); }, wait); }
    } catch (e) { try { notifyNow(); } catch (e2) {} }
  }

  function onUpdate(cb) { listeners.add(cb); return () => listeners.delete(cb); }
  function setGetSymbols(fn) { getSymbolsFn = fn; }
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  function calculateEma(values, period) {
    if (!Array.isArray(values) || values.length === 0) return [];
    const k = 2 / (period + 1); const out = []; let ema = null;
    for (let i = 0; i < values.length; i++) {
      const v = Number(values[i]); if (isNaN(v)) { out.push(null); continue; }
      if (ema === null) { if (i + 1 >= period) { const slice = values.slice(i + 1 - period, i + 1).map(Number); ema = slice.reduce((a,b)=>a+b,0)/period; out.push(ema); } else { out.push(null); } }
      else { ema = v * k + ema * (1 - k); out.push(ema); }
    }
    return out;
  }

  async function start(type, opts = {}) {
    if (running) return;
    try { console.log('[scannerManager] start called', { type, opts }); } catch (e) {}
    if (typeof getSymbolsFn !== 'function') throw new Error('scannerManager: getSymbolsFn not set');
    running = true; cancel = false; results = []; progress = { done: 0, total: 0 }; currentSymbol = null; scanType = type || null; scanStartTime = Date.now();
    notifyThrottled(true);
    const list = (await Promise.resolve(getSymbolsFn())) || [];
    let interval = (opts && typeof opts.interval !== 'undefined') ? opts.interval : '5m';
    if (typeof interval === 'number' || (typeof interval === 'string' && /^\d+$/.test(String(interval)))) interval = `${interval}m`;
    const emaShort = (opts && typeof opts.emaShort !== 'undefined') ? parseInt(opts.emaShort, 10) : 26;
    const emaLong = (opts && typeof opts.emaLong !== 'undefined') ? parseInt(opts.emaLong, 10) : 200;
    // Normalize / sanitize incoming symbol list to reduce typos like 'BTCSTUSDT'
    const sanitizeSymbol = (raw) => {
      if (!raw) return '';
      try {
        let s = String(raw).toUpperCase();
        // strip any non-alphanumeric chars
        s = s.replace(/[^A-Z0-9]/g, '');
        // collapse repeated USDT occurrences (e.g. 'BTCUSDTUSDT' -> 'BTCUSDT')
        s = s.replace(/(USDT)+$/g, 'USDT');
        s = s.replace(/USDTUSDT/g, 'USDT');
        // If the result doesn't end with USDT it's not a futures symbol we care about
        if (!/USDT$/.test(s)) return '';
        // Basic sanity: symbol length should be reasonable
        if (s.length < 6 || s.length > 12) return '';
        return s;
      } catch (e) { return ''; }
    };

    // Build a unique, normalized filtered list to use for API calls.
    const normalized = [];
    if (Array.isArray(list)) {
      const seen = new Set();
      for (const it of list) {
        const n = sanitizeSymbol(it);
        if (!n) continue;
        if (seen.has(n)) continue;
        seen.add(n);
        normalized.push(n);
      }
    }
    const filtered = normalized;
    // Validate symbols against Binance exchangeInfo to avoid scanning invalid/typo symbols
    progress.total = filtered.length; notifyThrottled(true);
    try {
      const infoUrl = 'https://fapi.binance.com/fapi/v1/exchangeInfo';
      const infoResp = await fetch(infoUrl, { cf: { cacheTtl: 600 } });
      if (infoResp && infoResp.ok) {
        const info = await infoResp.json().catch(() => null);
        if (info && Array.isArray(info.symbols)) {
          const validSet = new Set(info.symbols.map(s => String(s.symbol).toUpperCase()));
          const before = filtered.length;
          const cleaned = filtered.map(s => String(s).toUpperCase()).filter(s => validSet.has(s));
          if (cleaned.length !== before) {
            try { console.log('[scannerManager] removed invalid symbols', { before, after: cleaned.length }); } catch (e) {}
          }
          // use cleaned list (preserve case as original list may vary)
          const cleanedMap = new Map(); filtered.forEach(s => cleanedMap.set(String(s).toUpperCase(), s));
          const finalList = cleaned.map(su => cleanedMap.get(su) || su);
          // replace filtered variable
          // eslint-disable-next-line no-param-reassign
          filtered.length = 0; Array.prototype.push.apply(filtered, finalList);
          progress.total = filtered.length; notifyThrottled(true);
        }
      }
    } catch (e) { try { console.warn('[scannerManager] exchangeInfo fetch failed', e && e.message ? e.message : e); } catch (e2) {} }
    const endpointBase = 'https://fapi.binance.com/fapi/v1/klines';

    // Try to delegate scanning to dedicated worker (served at /worker-scanner.js)
    const symbolsArray = Array.isArray(list) ? list : [];
    // Only delegate to the dedicated worker for single-run scans.
    // For continuous monitoring (`opts.monitor`), run inline loop to allow repeated passes.
    try { console.log('[scannerManager] monitorMode?', !!(opts && opts.monitor)); } catch (e) {}
    if (!opts.monitor && typeof Worker !== 'undefined' && typeof window !== 'undefined') {
      try {
        workerInstance = new Worker('/worker-scanner.js');
        let workerReady = false;
        const onMsg = (ev) => {
          const m = ev.data || {};
          if (m.type === 'started') {
            workerReady = true; progress.total = m.total || progress.total; notifyThrottled(true);
          } else if (m.type === 'progress') {
            workerReady = true; progress.done = m.done || progress.done; currentSymbol = m.currentSymbol || currentSymbol; notifyThrottled();
          } else if (m.type === 'match' && m.ev) {
            workerReady = true; results.unshift(m.ev); if (results.length > 500) results = results.slice(0, 500); notifyThrottled();
          } else if (m.type === 'done') {
            // worker finished its task
            try { workerInstance.terminate(); } catch (e) {}
            workerInstance = null; running = false; currentSymbol = null; cancel = false; scanStartTime = null; notifyThrottled(true);
          } else if (m.type === 'stopped') {
            try { workerInstance.terminate(); } catch (e) {}
            workerInstance = null; running = false; currentSymbol = null; cancel = false; scanStartTime = null; notifyThrottled(true);
          }
        };
        workerInstance.addEventListener('message', onMsg);
        workerInstance.addEventListener('error', (err) => {
          try { console.warn('scanner worker error', err); } catch (e) {}
        });
        // send start command with symbols and options
        try { workerInstance.postMessage({ cmd: 'start', symbols: symbolsArray, opts, scanType: type }); } catch (e) { /* ignore */ }

        // Wait briefly for the worker to acknowledge (avoid stuck 'Scanning: ...' if worker asset missing or blocked)
        const waitMs = 2000;
        await new Promise((resolve) => {
          const to = setTimeout(() => {
            if (!workerReady) {
              try { workerInstance.removeEventListener('message', onMsg); } catch (e) {}
              try { workerInstance.terminate(); } catch (e) {}
              workerInstance = null;
            }
            resolve();
          }, waitMs);
          // if worker signals readiness before timeout, resolve early
          const early = () => { clearTimeout(to); resolve(); };
          const checkInterval = setInterval(() => { if (workerReady) { clearInterval(checkInterval); early(); } }, 50);
        });

        // If worker started and is handling the scan, return early
        if (workerInstance) {
          // worker is active and will manage scanning
          return;
        }
        // else fallthrough to inline scanner
      } catch (e) {
        try { if (workerInstance) { workerInstance.terminate(); workerInstance = null; } } catch (e2) {}
        // fallthrough to inline scanner
      }
    }

    // Lower default concurrency and increase base batch delay to reduce risk of
    // hitting Binance rate limits under high-load scans. These can be overridden
    // via opts if the caller wants different tuning.
    // Reduce default concurrency to 2 for conservative operation and increase
    // base batch delay to reduce request bursts that trigger rate limits.
    const concurrencyDefault = (opts && typeof opts.concurrency === 'number') ? Math.max(1, opts.concurrency) : 2;
    const batchDelayBase = (opts && typeof opts.batchDelay === 'number') ? Math.max(0, opts.batchDelay) : 1000;
    let concurrencyCurrent = concurrencyDefault; let batchDelayCurrent = batchDelayBase;
    const maxConcurrency = (opts && typeof opts.maxConcurrency === 'number') ? Math.max(1, opts.maxConcurrency) : 12;
    let backoffCount = 0; let consecutiveSuccesses = 0;
    const successThreshold = (opts && typeof opts.rampSuccessThreshold === 'number') ? Math.max(1, opts.rampSuccessThreshold) : 3;
    const minBatchDelay = (opts && typeof opts.minBatchDelay === 'number') ? Math.max(50, opts.minBatchDelay) : 60;
    const neededCandles = Math.max(emaShort, emaLong) + 10;
    // Allow caller to request a specific kline limit (e.g., 200). If not provided,
    // fall back to previous heuristic which ensured at least ~120 candles.
    const klineLimitOpt = (opts && typeof opts.klineLimit === 'number') ? Math.max(0, parseInt(opts.klineLimit, 10)) : null;
    const candleLimit = (Number.isFinite(klineLimitOpt) && klineLimitOpt > 0)
      ? Math.min(1000, Math.max(klineLimitOpt, neededCandles + 1))
      : Math.min(1000, Math.max(neededCandles + 10, 120));

    // Simple token-bucket rate limiter for REST requests to avoid hitting Binance rate limits.
    // Defaults to a conservative 6 requests/second (can be overridden via opts.rateLimitPerSec).
    const rateLimitPerSec = (opts && typeof opts.rateLimitPerSec === 'number') ? Math.max(1, opts.rateLimitPerSec) : 6;
    const bucketCapacity = Math.max(1, Math.floor(rateLimitPerSec));
    let tokens = bucketCapacity;
    let lastRefill = Date.now();
    const refillTokens = () => {
      const now = Date.now();
      const elapsed = now - lastRefill;
      if (elapsed <= 0) return;
      const add = (elapsed / 1000) * rateLimitPerSec;
      if (add < 1) return;
      tokens = Math.min(bucketCapacity, tokens + Math.floor(add));
      lastRefill = now;
    };
    const acquireToken = async () => {
      // try to acquire a token, waiting up to a short timeout loop
      for (let i = 0; i < 200; i += 1) {
        refillTokens();
        if (tokens > 0) { tokens -= 1; return; }
        // sleep a short bit before retrying
        // use smaller delay when concurrency is low
        await sleep(50);
      }
      // fallback wait a bit longer if tokens couldn't be acquired
      await sleep(500);
      refillTokens();
      if (tokens > 0) { tokens -= 1; }
    };

    // When we detect sustained 429s, pause the whole scanner briefly to allow rate limits to recover
    let globalPauseUntil = 0;

    const processSymbol = async (sym) => {
      if (cancel) return;
      currentSymbol = sym; notifyThrottled();
      const url = `${endpointBase}?symbol=${encodeURIComponent(sym)}&interval=${encodeURIComponent(interval)}&limit=${candleLimit}`;
      let localAbort = null; try { localAbort = new AbortController(); currentAbortControllers.add(localAbort); } catch (e) {}
      try {
        // implement a small retry loop for 429s with exponential backoff + jitter
        const maxRetries = (opts && typeof opts.maxRetries === 'number') ? Math.max(1, opts.maxRetries) : 5;
        let attempt = 0;
        let r = null;
        for (; attempt <= maxRetries; attempt += 1) {
          try {
            // Respect a global pause if we've been rate-limited heavily
            if (globalPauseUntil && Date.now() < globalPauseUntil) {
              const wait = globalPauseUntil - Date.now();
              await sleep(wait);
            }
            // Acquire a rate-limiter token before issuing the REST request
            try { await acquireToken(); } catch (e) {}
            r = await fetch(url, localAbort ? { signal: localAbort.signal } : undefined);
          } catch (fetchErr) {
            // network/type errors -> break and treat as failure (will be caught below)
            r = null;
          }
          if (r && r.ok) break; // success
          if (r && r.status === 429) {
            // rate-limited -> increase backoff pressure and retry after delay
            backoffCount += 1;
            consecutiveSuccesses = 0;
            concurrencyCurrent = Math.max(1, Math.floor(concurrencyCurrent * 0.6));
            batchDelayCurrent = Math.min(30000, Math.floor(batchDelayCurrent * 1.8));
            // respect server-suggested Retry-After header when present
            let backoffMs = Math.min(60000, 1000 * Math.pow(2, Math.min(backoffCount, 8)) + Math.floor(Math.random() * 2000));
            try {
              const ra = r.headers && (r.headers.get ? r.headers.get('Retry-After') : (r.headers['retry-after'] || r.headers['Retry-After']));
              if (ra) {
                const parsed = parseInt(ra, 10);
                if (Number.isFinite(parsed) && parsed > 0) backoffMs = Math.max(backoffMs, parsed * 1000);
              }
            } catch (e) {}
            // if we've exhausted retries, give up this symbol for now
            if (attempt === maxRetries) {
              // on final exhaustion, apply a longer global pause to avoid repeated 429s
              globalPauseUntil = Date.now() + Math.min(5 * 60 * 1000, backoffMs * 2);
              await sleep(backoffMs);
              return;
            }
            await sleep(backoffMs);
            continue; // retry
          }
          // non-429 non-ok responses -> handle below (e.g., 400 invalid symbol)
          break;
        }
        if (!r || !r.ok) {
          // final handling for non-ok responses
          if (r && r.status === 400) {
            try { console.warn('[scannerManager] removing invalid symbol due to 400', sym); } catch (e) {}
            try {
              const idx = filtered.indexOf(sym);
              if (idx !== -1) {
                filtered.splice(idx, 1);
                progress.total = filtered.length;
                notifyThrottled(true);
              }
            } catch (e) {}
            return;
          }
          // give up this symbol on persistent errors
          return;
        }
        const data = await r.json();
        backoffCount = Math.max(0, backoffCount - 1); consecutiveSuccesses += 1;
        if (consecutiveSuccesses >= successThreshold) { consecutiveSuccesses = 0; if (concurrencyCurrent < maxConcurrency) concurrencyCurrent += 1; batchDelayCurrent = Math.max(minBatchDelay, Math.floor(batchDelayCurrent * 0.85)); }
        const closes = Array.isArray(data) ? data.map(d => parseFloat(d[4])) : [];
          // require one extra candle so we can use the last closed candle (avoid counting the live/open candle)
          if (!Array.isArray(closes) || closes.length < neededCandles + 1) return;
        const emaShortArr = calculateEma(closes, emaShort); const emaLongArr = calculateEma(closes, emaLong);
          const lastClosedIdx = closes.length - 2; const prevIdx = lastClosedIdx - 1;
          const prevShort = emaShortArr[prevIdx]; const prevLong = emaLongArr[prevIdx];
          const lastShort = emaShortArr[lastClosedIdx]; const lastLong = emaLongArr[lastClosedIdx];
        let matched = false;
        if (typeof prevShort === 'number' && typeof prevLong === 'number' && typeof lastShort === 'number' && typeof lastLong === 'number') {
          if (scanType === 'golden') matched = (prevShort <= prevLong && lastShort > lastLong);
          else if (scanType === 'dead') matched = (prevShort >= prevLong && lastShort < lastLong);
        }
        const lastVolume = (Array.isArray(data) && data[lastClosedIdx] && data[lastClosedIdx][5] != null) ? parseFloat(data[lastClosedIdx][5]) : 0;
        // Real-time monitoring behavior: maintain activeMatches map. When a symbol becomes matched, add it; when it stops matching, remove it.
        if (matched) {
          try { console.log('[scannerManager] match detected', sym, { scanType, emaShort, emaLong }); } catch (e) {}
          if (!activeMatches[sym]) {
            const ev = { id: `${sym}-${Date.now()}-${Math.random().toString(36).slice(2,8)}`, symbol: sym, prevShort, prevLong, lastShort, lastLong, time: new Date().toLocaleString(), interval, emaShort, emaLong, type: scanType, volume: lastVolume };
            activeMatches[sym] = ev;
            // also keep history results for reference
            results.unshift(ev); if (results.length > 500) results = results.slice(0, 500);
            notifyThrottled();
            try { console.log('[scannerManager] active add', sym); } catch (e) {}
          } else {
            // update existing active entry with latest values
            activeMatches[sym] = { ...activeMatches[sym], prevShort, prevLong, lastShort, lastLong, time: new Date().toLocaleString(), volume: lastVolume };
            try { console.log('[scannerManager] active update', sym); } catch (e) {}
          }
        } else {
          if (activeMatches[sym]) {
            try { console.log('[scannerManager] match cleared', sym); } catch (e) {}
            delete activeMatches[sym];
            notifyThrottled();
          }
        }
      } catch (e) { /* ignore */ }
      finally { if (localAbort) currentAbortControllers.delete(localAbort); progress.done += 1; notifyThrottled(); }
    };

    // support continuous monitoring mode: if opts.monitor=true, repeat full passes until stopped
    const monitorMode = !!(opts && opts.monitor);
    const pollIntervalMs = (opts && typeof opts.pollIntervalMs === 'number') ? Math.max(1000, opts.pollIntervalMs) : null;
    async function runFullPass() {
      let i = 0;
      try { console.log('[scannerManager] runFullPass start', { scanType, interval, total: filtered.length, time: new Date().toISOString() }); } catch (e) {}
      while (i < filtered.length) {
        if (cancel) break;
        const currentConcurrency = Math.max(1, Math.floor(concurrencyCurrent));
        const batch = filtered.slice(i, i + currentConcurrency); if (!batch.length) break;
        await Promise.all(batch.map(sym => processSymbol(sym)));
        if (cancel) break; i += batch.length;
        if (i < filtered.length) {
          // When the page is hidden, browser timers may be clamped and make the scanner
          // appear to 'stop'. In that case, keep scans going but be conservative: reduce
          // concurrency to 1 and use a very small yield to avoid relying on long setTimeouts.
          try {
            const isHidden = (typeof document !== 'undefined' && document.hidden);
            if (isHidden) {
              // small yield so we don't spin the event loop too hard, but avoid long sleeps
              await sleep(20);
            } else {
              const jitter = Math.floor(Math.random() * Math.min(120, Math.max(10, Math.floor(batchDelayCurrent * 0.5))));
              const delay = Math.max(0, batchDelayCurrent + jitter);
              await sleep(delay);
            }
          } catch (e) { /* ignore */ }
        }
      }
      try { console.log('[scannerManager] runFullPass done', { processed: i, time: new Date().toISOString() }); } catch (e) {}
    }
    try {
      let passCount = 0;
      do {
        passCount += 1;
        try { console.log('[scannerManager] monitoring pass start', { passCount, monitorMode, time: new Date().toISOString() }); } catch (e) {}
        // reset progress for this pass
        progress.done = 0; progress.total = filtered.length; notifyThrottled(true);
        await runFullPass();
        if (cancel) break;
        // if not monitoring, break after one pass
        if (!monitorMode) break;
        // wait for poll interval (default to interval minutes + 5 seconds if not provided)
        let waitMs = pollIntervalMs;
        if (!waitMs) {
          // try to derive from interval string like '5m'
          const m = String(interval || '').match(/^(\d+)m$/);
          if (m) { waitMs = parseInt(m[1], 10) * 60 * 1000 + 5000; } else { waitMs = 30000; }
        }
        const step = 1000;
        let slept = 0;
        try { console.log('[scannerManager] waiting between passes', { waitMs }); } catch (e) {}
        while (slept < waitMs && !cancel) { const to = Math.min(step, waitMs - slept); await sleep(to); slept += to; }
        try { console.log('[scannerManager] waiting complete', { passCount, time: new Date().toISOString() }); } catch (e) {}
      } while (!cancel);
    } catch (err) { try { console.error('scannerManager.start error', err && err.message ? err.message : err); } catch (e) {} }
    finally { try { for (const c of currentAbortControllers) { try { c.abort(); } catch (e) {} } } catch (e) {} currentAbortControllers.clear(); running = false; currentSymbol = null; cancel = false; scanStartTime = null; scanType = null; notifyThrottled(true); }
  }

  function stop() {
    cancel = true;
    try { for (const c of currentAbortControllers) { try { c.abort(); } catch (e) {} } currentAbortControllers.clear(); } catch (e) {}
    // If a worker is running, tell it to stop and terminate it
    try {
      if (workerInstance) {
        try { workerInstance.postMessage({ cmd: 'stop' }); } catch (e) {}
        try { workerInstance.terminate(); } catch (e) {}
        workerInstance = null;
      }
    } catch (e) {}
    running = false; currentSymbol = null; scanStartTime = null; scanType = null; notifyThrottled(true);
  }
  function getState() { return stateSnapshot(); }
  function removeResult(id) { if (!id) return; results = results.filter(r => r.id !== id); notifyThrottled(); }
  function clearResults() { results = []; notifyThrottled(true); }
  function removeActive(symbol) { if (!symbol) return; if (activeMatches[symbol]) { delete activeMatches[symbol]; notifyThrottled(true); } }

  return { onUpdate, setGetSymbols, start, stop, getState, removeResult, clearResults, removeActive };
})();

export default scannerManager;
