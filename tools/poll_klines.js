// Simple poller to fetch recent 1m klines for a symbol and print latest close and closeTime
// Usage: node tools/poll_klines.js [SYMBOL] [INTERVAL_SEC] [ITERATIONS]
const symbol = (process.argv[2] || 'BTCUSDT').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
const intervalSec = parseInt(process.argv[3] || '5', 10); // poll interval seconds
const iterations = parseInt(process.argv[4] || '6', 10); // how many polls

let fetchFn = null;
if (typeof fetch === 'function') {
  fetchFn = fetch;
} else {
  try {
    // commonjs require fallback
    // eslint-disable-next-line global-require
    const nf = require('node-fetch');
    fetchFn = nf.default || nf;
  } catch (e) {
    console.error('No fetch available. Please run with Node 18+ or install node-fetch');
    process.exit(1);
  }
}

(async function main(){
  console.log(`Polling Binance klines for ${symbol} every ${intervalSec}s, ${iterations} iterations`);
  for (let i=0;i<iterations;i++){
    try{
      const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=1m&limit=5`;
  const res = await fetchFn(url, { timeout: 10000 });
      if (!res.ok) {
        console.error('fetch error', res.status);
      } else {
        const data = await res.json();
        if (!Array.isArray(data) || data.length===0){
          console.log('no klines returned');
        } else {
          // last kline
          const last = data[data.length-1];
          // const openTime = new Date(last[0]).toISOString(); // unused
          const open = last[1];
          const high = last[2];
          const low = last[3];
          const close = last[4];
          const closeTime = new Date(last[6]).toISOString();
          console.log(new Date().toISOString(), `iter ${i+1}/${iterations}`, `open:${open} high:${high} low:${low} close:${close} closeTime:${closeTime}`);
        }
      }
    } catch (e){
      console.error('poll error', e && e.message ? e.message : e);
    }
    if (i < iterations-1) await new Promise(r=>setTimeout(r, intervalSec*1000));
  }
  console.log('polling done');
})();
