#!/usr/bin/env node
// Node script to fetch paginated Binance futures klines and compute EMA values
// Usage: node tools/compare_ema.js SYMBOL [desiredCount]

const https = require('https');

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout: 15000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function sma(values) { return values.reduce((s, v) => s + v, 0) / values.length; }
function calculateInitialEMA(values, period) {
  if (!Array.isArray(values) || values.length < period) throw new Error('not enough data');
  let ema = sma(values.slice(0, period));
  const mult = 2 / (period + 1);
  for (let i = period; i < values.length; i++) {
    const price = values[i];
    ema = (price - ema) * mult + ema;
  }
  return ema;
}

async function fetchKlinesPaginated(symbol, interval='1m', desiredCount=3000) {
  const all = [];
  let endTime = undefined;
  while (all.length < desiredCount) {
    const params = new URLSearchParams();
    params.set('symbol', symbol);
    params.set('interval', interval);
    params.set('limit', '1000');
    if (endTime) params.set('endTime', String(endTime));
    const url = `https://fapi.binance.com/fapi/v1/klines?${params.toString()}`;
    const data = await fetchJson(url);
    if (!Array.isArray(data) || data.length === 0) break;
    all.push(...data);
    if (data.length < 1000) break;
    const firstOpen = data[0] && data[0][0];
    if (!firstOpen) break;
    endTime = firstOpen - 1;
    if (all.length > desiredCount * 5) break;
  }
  all.sort((a,b)=>a[0]-b[0]);
  return all;
}

async function main(){
  const argv = process.argv.slice(2);
  const symbol = (argv[0] || 'BTCUSDT').replace(/[^A-Za-z0-9]/g,'').toUpperCase();
  const desired = parseInt(argv[1]||process.env.DESIRED||'3000',10);
  console.log('Fetching', symbol, 'desired candles', desired);
  const klines = await fetchKlinesPaginated(symbol,'1m',desired);
  if (!klines || klines.length === 0) { console.error('no klines'); process.exit(1); }
  const closes = klines.map(k=>parseFloat(k[4]));
  const ema9 = calculateInitialEMA(closes,9);
  const ema26 = calculateInitialEMA(closes,26);
  const lastCloseTime = klines[klines.length-1][6];
  console.log('candles fetched:', closes.length, 'lastCloseTime:', new Date(lastCloseTime).toISOString());
  console.log('EMA9 =', ema9);
  console.log('EMA26 =', ema26);
  // also compute EMA progression and output last 5 EMA values for each period
  const emaProgress = (period)=>{
    const arr = [];
    let ema = sma(closes.slice(0,period));
    const mult = 2/(period+1);
    for (let i=period;i<closes.length;i++){ ema = (closes[i]-ema)*mult + ema; if (i>closes.length-6) arr.push(ema); }
    return arr;
  };
  console.log('Last 5 EMA9:', emaProgress(9).map(v=>v.toFixed(6)).join(', '));
  console.log('Last 5 EMA26:', emaProgress(26).map(v=>v.toFixed(6)).join(', '));
}

main().catch(e=>{ console.error(e); process.exit(1); });
