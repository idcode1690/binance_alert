// Dedicated scanner worker
// Runs scans independent of page visibility/throttling and posts progress/results back.
// This file is served statically from `/worker-scanner.js` and launched with `new Worker('/worker-scanner.js')`.

let cancel = false;
let currentAbortControllers = new Set();

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function calculateEma(values, period) {
  if (!Array.isArray(values) || values.length === 0) return [];
  const k = 2 / (period + 1); const out = []; let ema = null;
  for (let i = 0; i < values.length; i++) {
    const v = Number(values[i]); if (isNaN(v)) { out.push(null); continue; }
    if (ema === null) {
      if (i + 1 >= period) { const slice = values.slice(i + 1 - period, i + 1).map(Number); ema = slice.reduce((a,b)=>a+b,0)/period; out.push(ema); }
      else { out.push(null); }
    } else { ema = v * k + ema * (1 - k); out.push(ema); }
  }
  return out;
}

async function processBatch(batch, endpointBase, interval, candleLimit, emaShort, emaLong) {
  const responses = await Promise.all(batch.map(async (sym) => {
    if (cancel) return null;
    const url = `${endpointBase}?symbol=${encodeURIComponent(sym)}&interval=${encodeURIComponent(interval)}&limit=${candleLimit}`;
    let ac = null; try { ac = new AbortController(); currentAbortControllers.add(ac); } catch (e) { }
    try {
      const r = await fetch(url, ac ? { signal: ac.signal } : undefined);
      if (!r.ok) return { sym, ok: false, status: r.status };
      const data = await r.json();
      return { sym, ok: true, data };
    } catch (e) { return { sym, ok: false, err: e && e.message ? e.message : String(e) }; }
    finally { if (ac) currentAbortControllers.delete(ac); }
  }));
  const matches = [];
  for (const r of responses) {
    if (!r || !r.ok || !Array.isArray(r.data)) continue;
    const closes = r.data.map(d => parseFloat(d[4]));
    const neededCandles = Math.max(emaShort, emaLong) + 10;
    if (!Array.isArray(closes) || closes.length < neededCandles) continue;
    const emaShortArr = calculateEma(closes, emaShort); const emaLongArr = calculateEma(closes, emaLong);
    const lastIdx = closes.length - 1; const prevIdx = lastIdx - 1;
    const prevShort = emaShortArr[prevIdx]; const prevLong = emaLongArr[prevIdx];
    const lastShort = emaShortArr[lastIdx]; const lastLong = emaLongArr[lastIdx];
    if (typeof prevShort === 'number' && typeof prevLong === 'number' && typeof lastShort === 'number' && typeof lastLong === 'number') {
      // Determine crossover direction was delegated from main thread via message
      matches.push({ sym: r.sym, prevShort, prevLong, lastShort, lastLong, lastCandle: r.data[lastIdx] });
    }
  }
  return matches;
}

self.onmessage = async (ev) => {
  const m = ev.data || {};
  if (m && m.cmd === 'stop') {
    cancel = true;
    try { for (const c of currentAbortControllers) { try { c.abort(); } catch (e) {} } } catch (e) {}
    currentAbortControllers.clear();
    try { self.postMessage({ type: 'stopped' }); } catch (e) {}
    return;
  }
  if (!m || m.cmd !== 'start') return;
  cancel = false;
  currentAbortControllers.clear();

  const symbols = Array.isArray(m.symbols) ? m.symbols : [];
  const opts = m.opts || {};
  const scanType = m.scanType || null;
  let interval = (opts && typeof opts.interval !== 'undefined') ? opts.interval : '5m';
  if (typeof interval === 'number' || (typeof interval === 'string' && /^\d+$/.test(String(interval)))) interval = `${interval}m`;
  const emaShort = (opts && typeof opts.emaShort !== 'undefined') ? parseInt(opts.emaShort, 10) : 26;
  const emaLong = (opts && typeof opts.emaLong !== 'undefined') ? parseInt(opts.emaLong, 10) : 200;
  const filtered = symbols.filter(s => typeof s === 'string' && /USDT$/i.test(s));
  const endpointBase = 'https://fapi.binance.com/fapi/v1/klines';
  const neededCandles = Math.max(emaShort, emaLong) + 10;
  const candleLimit = Math.min(1000, Math.max(neededCandles + 10, 120));

  const concurrency = Math.max(1, (opts && typeof opts.concurrency === 'number') ? opts.concurrency : 8);
  let i = 0; const total = filtered.length; self.postMessage({ type: 'started', total });
  while (i < filtered.length && !cancel) {
    const batch = filtered.slice(i, i + concurrency);
    self.postMessage({ type: 'progress', done: i, total, currentSymbol: batch[0] || null });
    try {
      const matches = await processBatch(batch, endpointBase, interval, candleLimit, emaShort, emaLong);
      for (const match of matches) {
        const lastIdx = match.lastCandle ? match.lastCandle : null;
        const lastVolume = (Array.isArray(match.lastCandle) && match.lastCandle[5] != null) ? parseFloat(match.lastCandle[5]) : 0;
        let matched = false;
        if (scanType === 'golden') matched = (match.prevShort <= match.prevLong && match.lastShort > match.lastLong);
        else if (scanType === 'dead') matched = (match.prevShort >= match.prevLong && match.lastShort < match.lastLong);
        if (matched) {
          const ev = { id: `${match.sym}-${Date.now()}-${Math.random().toString(36).slice(2,8)}`, symbol: match.sym, lastShort: match.lastShort, lastLong: match.lastLong, time: new Date().toLocaleString(), interval, emaShort, emaLong, type: scanType, volume: lastVolume };
          try { self.postMessage({ type: 'match', ev }); } catch (e) {}
        }
      }
    } catch (e) { /* ignore per-symbol errors */ }
    i += batch.length;
    // yield a tiny bit to avoid hogging worker thread
    if (!cancel) await sleep(10);
  }
  try { self.postMessage({ type: 'done', total, done: Math.min(i, total) }); } catch (e) {}
};
