const https = require('https');

const endpoints = [
  { name: 'Spot (api.binance.com)', url: 'https://api.binance.com/api/v3/exchangeInfo?symbol=' },
  { name: 'Futures USDT-M (fapi.binance.com)', url: 'https://fapi.binance.com/fapi/v1/exchangeInfo?symbol=' },
  { name: 'Futures COIN-M (dapi.binance.com)', url: 'https://dapi.binance.com/dapi/v1/exchangeInfo?symbol=' },
];

const symbol = (process.argv[2] || 'CLOUSDT').replace(/[^A-Za-z0-9]/g, '').toUpperCase();

function get(url, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout }, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
    });
    req.on('error', (err) => reject(err));
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

(async () => {
  console.log('Checking symbol:', symbol);
  for (const e of endpoints) {
    const url = e.url + symbol;
    try {
      const r = await get(url);
      if (r.statusCode !== 200) {
        console.log(`${e.name}: HTTP ${r.statusCode}`);
        continue;
      }
      let parsed = null;
      try { parsed = JSON.parse(r.body); } catch (err) { console.log(`${e.name}: parse error`); continue; }
      let found = false;
      if (Array.isArray(parsed.symbols)) {
        found = parsed.symbols.some(s => ((s.symbol || '').replace(/[^A-Za-z0-9]/g,'').toUpperCase()) === symbol);
      } else if (parsed.symbol) {
        found = ((parsed.symbol || '').replace(/[^A-Za-z0-9]/g,'').toUpperCase()) === symbol;
      }
      console.log(`${e.name}: ${found ? 'FOUND' : 'not found'} (HTTP 200)`);
    } catch (err) {
      console.log(`${e.name}: error (${err.message || err})`);
    }
  }
})();
