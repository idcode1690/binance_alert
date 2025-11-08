#!/usr/bin/env node
// Simple script to fetch klines from Binance Futures and compute EMAs to check cross
// Usage: node scripts/check_cross.js SYMBOL INTERVAL EMA_SHORT EMA_LONG [LIMIT]
// Example: node scripts/check_cross.js BTCUSDT 5m 26 200 1000

const [,, symbol='BTCUSDT', interval='5m', sShort='26', sLong='200', sLimit='1000'] = process.argv;
const emaShort = parseInt(sShort,10) || 26;
const emaLong = parseInt(sLong,10) || 200;
const limit = Math.min(5000, Math.max(100, parseInt(sLimit,10) || 1000));

function calculateEmaArray(values, period) {
  if (!Array.isArray(values) || values.length === 0) return [];
  const n = Number(period) || 0;
  if (!Number.isInteger(n) || n <= 0) return new Array(values.length).fill(null);
  const out = new Array(values.length).fill(null);
  for (let i = 0; i < values.length; i++) {
    const v = Number(values[i]);
    if (!Number.isFinite(v)) { out[i] = null; continue; }
    if (i + 1 < n) { out[i] = null; continue; }
    if (i + 1 === n) {
      const slice = values.slice(0, n).map(Number);
      if (slice.some(x => !Number.isFinite(x))) { out[i] = null; continue; }
      out[i] = slice.reduce((a,b) => a+b,0)/n;
    } else {
      const prev = out[i-1];
      if (!Number.isFinite(prev)) { out[i] = null; continue; }
      const k = 2 / (n + 1);
      out[i] = v * k + prev * (1 - k);
    }
  }
  return out;
}

async function main(){
  try{
    const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${limit}`;
    console.log('Fetching', url);
    const res = await fetch(url);
    if (!res.ok) throw new Error('fetch failed '+res.status);
    const data = await res.json();
    const closes = data.map(d => parseFloat(d[4]));
    console.log('Got', closes.length, 'closes');
    if (closes.length < Math.max(emaShort, emaLong)) {
      console.error('Not enough closes for EMAs');
      process.exit(2);
    }
    const emaShortArr = calculateEmaArray(closes, emaShort);
    const emaLongArr = calculateEmaArray(closes, emaLong);
    const lastIdx = closes.length -1;
    const prevIdx = lastIdx -1;
    const prevShort = emaShortArr[prevIdx];
    const prevLong = emaLongArr[prevIdx];
    const lastShort = emaShortArr[lastIdx];
    const lastLong = emaLongArr[lastIdx];
    console.log(`Prev EMA${emaShort}=${prevShort}, EMA${emaLong}=${prevLong}`);
    console.log(`Last EMA${emaShort}=${lastShort}, EMA${emaLong}=${lastLong}`);
    const prevCross = (prevShort!=null && prevLong!=null) ? (prevShort>prevLong?'bull':'bear') : 'unknown';
    const lastCross = (lastShort!=null && lastLong!=null) ? (lastShort>lastLong?'bull':'bear') : 'unknown';
    console.log('Prev cross:', prevCross, 'Last cross:', lastCross);
    if (prevCross !== 'unknown' && lastCross !== 'unknown' && prevCross !== lastCross){
      console.log('CROSS detected between prev and last candles:', prevCross, '->', lastCross);
    } else {
      console.log('No cross between prev and last candles');
    }
    // print last few closes and EMAs for inspection
    const around = Math.max(10, Math.min(40, Math.floor(closes.length/10)));
    console.log('Index,Close,EMA'+emaShort+',EMA'+emaLong);
    for (let i = Math.max(0, lastIdx- around); i<= lastIdx; i++){
      console.log(i, closes[i], emaShortArr[i], emaLongArr[i]);
    }
  }catch(e){
    console.error('ERR', e && e.message?e.message:e);
    process.exit(1);
  }
}

main();
