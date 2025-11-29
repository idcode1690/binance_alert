/*
 Simple Telegram relay test
 Usage (PowerShell):
   # Option A: use default WORKER_URL in code
   npm run test:telegram

   # Option B: override URL via env
   setx WORKER_URL "https://your-worker.subdomain.workers.dev"
   npm run test:telegram

 Optionally set SYMBOL and MESSAGE env vars.
*/

const axios = require('axios');

async function main() {
  const url = (process.env.WORKER_URL || 'https://binance-alert.idcode1690.workers.dev').replace(/\/$/, '');
  const symbol = process.env.SYMBOL || 'TESTUSDT';
  const message = process.env.MESSAGE || 'Telegram relay test from scripts/test_telegram.js';
  const emaShort = Number(process.env.EMA_SHORT || 26);
  const emaLong = Number(process.env.EMA_LONG || 200);
  const price = Number(process.env.PRICE || 0);

  const endpoint = `${url}/send-alert`;
  const payload = { symbol, message, emaShort, emaLong };
  if (!Number.isNaN(price) && price > 0) payload.price = price;

  console.log('[test] POST', endpoint, 'payload:', payload);
  try {
    const res = await axios.post(endpoint, payload, { timeout: 15000, headers: { 'Content-Type': 'application/json' } });
    console.log('[test] status:', res.status);
    console.log('[test] body:', JSON.stringify(res.data));
  } catch (err) {
    if (err.response) {
      console.error('[test] HTTP error:', err.response.status);
      console.error('[test] body:', JSON.stringify(err.response.data));
    } else {
      console.error('[test] error:', err.message);
    }
    process.exitCode = 1;
  }
}

main();
