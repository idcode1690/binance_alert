#!/usr/bin/env node
// Simple inspector: fetch klines from Binance and compute EMA values
// Usage: node tools/inspect_ema.js SYMBOL INTERVAL EMA_SHORT EMA_LONG [LIMIT]
const [,, symbol='BTCUSDT', interval='5m', emaShort='26', emaLong='200', limitArg='200'] = process.argv;
const limit = Math.min(1000, Math.max(50, parseInt(limitArg,10)||200));
const endpoint = `https://fapi.binance.com/fapi/v1/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${limit}`;
async function fetchKlines() {
  try {
    const res = await fetch(endpoint, { cache: 'no-store' });
    if (!res.ok) throw new Error(`binance fetch failed ${res.status}`);
    const data = await res.json();
    return data.map(d => ({
      openTime: +d[0], open: parseFloat(d[1]), high: parseFloat(d[2]), low: parseFloat(d[3]), close: parseFloat(d[4]), volume: parseFloat(d[5])
    }));
  } catch (e) { console.error('fetch error', e); process.exit(2); }
}

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
        ema = slice.reduce((a,b) => a + b, 0) / period;
        out.push(ema);
      } else {
        out.push(null);
      }
    } else {
      ema = v * k + ema * (1 - k);
      out.push(ema);
    }
  }
  return out;
}

async function main() {
  const klines = await fetchKlines();
  const closes = klines.map(k => k.close);
  const s = parseInt(emaShort, 10); const l = parseInt(emaLong, 10);
  const emaS = calculateEma(closes, s);
  const emaL = calculateEma(closes, l);
  const start = Math.max(0, closes.length - 50);
  console.log(`# Symbol: ${symbol} Interval: ${interval} EMA${s}/${l} (showing last ${closes.length - start} rows)`);
  console.log('time,close,emaShort,emaLong');
  for (let i = start; i < closes.length; i++) {
    const t = new Date(klines[i].openTime).toISOString();
    const c = closes[i].toFixed(8);
    const es = typeof emaS[i] === 'number' ? emaS[i].toFixed(8) : '';
    const el = typeof emaL[i] === 'number' ? emaL[i].toFixed(8) : '';
    console.log(`${t},${c},${es},${el}`);
  }
}

main().catch(e=>{ console.error(e); process.exit(1); });
