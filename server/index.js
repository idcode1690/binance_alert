require('dotenv').config();
const axios = require('axios');
const WebSocket = require('ws');
const fs = require('fs');
const express = require('express');

// SSE clients set for broadcasting server events (telegram_sent, etc.)
const sseClients = new Set();

function broadcastEvent(obj) {
  const payload = `data: ${JSON.stringify(obj)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(payload);
    } catch (e) {
      try { res.end(); } catch (er) {}
      sseClients.delete(res);
    }
  }
}

const SYMBOL = process.env.SYMBOL || 'BTCUSDT';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';
const PORT = process.env.PORT || 3001;

let lastPrice = null;
let ws = null;

async function fetchAndInit() {
  console.log('Fetching historical klines...');
  // Use Binance Futures REST endpoint for klines (1m)
  // Fetch fewer candles and use a shorter timeout so startup isn't blocked too long.
  const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${SYMBOL}&interval=1m&limit=100`;
  console.time('fetchAndInit');
  try {
    const res = await axios.get(url, { timeout: 5000 });
    const data = res.data;
    const closes = data.map((k) => parseFloat(k[4]));
    if (closes && closes.length) {
      // Do NOT compute EMA on the server; only record last closed price for health/status.
      lastPrice = closes[closes.length - 1];
      console.log(`Initial lastPrice=${lastPrice}`);
    } else {
      console.warn('fetchAndInit: no closes returned');
    }
  } catch (err) {
    console.warn('fetchAndInit error, continuing without initial lastPrice:', err && err.message);
  } finally {
    console.timeEnd('fetchAndInit');
  }
}

function sendTelegram(message) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log('Telegram not configured, skipping message:', message);
    // broadcast that telegram is not configured
    try { broadcastEvent({ type: 'telegram_sent', ok: false, error: 'not_configured', message, ts: Date.now() }); } catch (e) {}
    return Promise.resolve({ ok: false, error: 'not_configured' });
  }
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  return axios.post(url, {
    chat_id: TELEGRAM_CHAT_ID,
    text: message,
  }).then((resp) => {
    try { broadcastEvent({ type: 'telegram_sent', ok: true, message, ts: Date.now() }); } catch (e) {}
    return { ok: true, resp: resp.data };
  }).catch((err) => {
    console.error('Telegram send error', err.message || err);
    try { broadcastEvent({ type: 'telegram_sent', ok: false, error: err.message || String(err), message, ts: Date.now() }); } catch (e) {}
    return { ok: false, error: err.message || String(err) };
  });
}



function connectWebSocket() {
  // Use Binance Futures (USDT-M) websocket (fstream)
  const stream = `${SYMBOL.toLowerCase()}@kline_1m`;
  const url = `wss://fstream.binance.com/ws/${stream}`;
  ws = new WebSocket(url);

  ws.on('open', () => {
    console.log('WebSocket connected');
  });

  ws.on('message', (msg) => {
    try {
      const data = JSON.parse(msg);
      const k = data.k;
      if (!k) return;
      const close = parseFloat(k.c);
      lastPrice = close;

      // Update lastPrice only. Server will not perform EMA cross detection; frontend is authoritative.
      // Keep lastPrice up-to-date so health/status endpoints remain useful.
      // (No EMA updates or alerts from server.)
    } catch (err) {
      console.error('ws message error', err.message || err);
    }
  });

  ws.on('close', () => {
    console.log('WebSocket closed, reconnecting in 5s');
    setTimeout(connectWebSocket, 5000);
  });

  ws.on('error', (err) => {
    console.error('WebSocket error', err && err.message);
  });
}

async function start() {
  // Start websocket immediately. Fetch historical klines in background so
  // server.listen is not perceived as slow by awaiting a remote HTTP call.
  try {
    // run fetchAndInit in background and do not await here to avoid blocking
    // Allow skipping or fast-start via environment variables to speed up dev restarts
    // SKIP_INIT=1 will skip fetching historical klines entirely
    // FAST_START=1 will still fetch but with a shorter timeout/limit if implemented
    const skipInit = (process.env.SKIP_INIT === '1' || process.env.SKIP_INIT === 'true');
    if (!skipInit) {
      fetchAndInit().catch((err) => console.warn('fetchAndInit background error', err && err.message));
    } else {
      console.info('SKIP_INIT set - skipping fetchAndInit for faster startup');
    }
    connectWebSocket();
  } catch (err) {
    console.error('Startup error', err && err.message);
    // If websockets fail, try reconnect later
    setTimeout(() => {
      try { connectWebSocket(); } catch (e) { console.error('reconnect error', e && e.message); }
    }, 5000);
  }
}

// Express health endpoint
const app = express();
// permissive CORS for dev so the React app can call /health and /send-alert
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
});
// allow JSON bodies for POST /send-alert
app.use(express.json());
app.get('/health', (req, res) => {
  res.json({ ok: true, symbol: SYMBOL, lastPrice });
});

// test endpoint to trigger a Telegram test message (no auth) - useful in local dev
// GET /send-test?message=hello
app.get('/send-test', (req, res) => {
  const msg = req.query.message || `${SYMBOL} - test alert from server`;
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    return res.status(400).json({ ok: false, error: 'Telegram not configured' });
  }
  sendTelegram(msg).then((result) => {
    if (result && result.ok) return res.json({ ok: true, sent: msg });
    return res.status(500).json({ ok: false, error: result && result.error });
  }).catch((err) => {
    return res.status(500).json({ ok: false, error: err && err.message });
  });
});

// Server-Sent Events endpoint for frontend realtime subscriptions
app.get('/events', (req, res) => {
  // Required headers for SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  // allow CORS from any origin (dev)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders && res.flushHeaders();

  // write a comment to keep connection alive
  res.write(':connected\n\n');
  sseClients.add(res);

  req.on('close', () => {
    try { sseClients.delete(res); } catch (e) {}
  });
});

// Accept a client-triggered alert and forward to Telegram after server-side
// verification against Binance REST klines (use last *closed* candle).
app.post('/send-alert', express.json(), async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const body = req.body || {};
  const symbol = (body.symbol || SYMBOL).toString().replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const price = typeof body.price !== 'undefined' ? Number(body.price) : lastPrice;
  const emaShort = typeof body.emaShort !== 'undefined' ? Number(body.emaShort) : 9;
  const emaLong = typeof body.emaLong !== 'undefined' ? Number(body.emaLong) : 26;
  const interval = (body.interval || '1m').toString();
  let message = body.message || (price ? `Alert EMA${emaShort}/${emaLong} @ ${price}` : `Alert EMA${emaShort}/${emaLong}`);
  try { const tag = `EMA${emaShort}/${emaLong}`; if (message && !message.includes(tag)) message = `${message} (${tag})`; } catch (e) {}

  // log receipt
  try { fs.appendFileSync(`${__dirname}/alerts.log`, JSON.stringify({ ts: Date.now(), receipt: true, symbol, price, emaShort, emaLong, interval, message }) + '\n'); } catch (e) {}

  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return res.status(400).json({ ok: false, error: 'Telegram not configured' });

  // Server will NOT re-calculate or verify EMA crosses. The frontend is authoritative
  // for confirmed crosses. Accept the client's alert and forward to Telegram.
  try {
    const result = await sendTelegram(`${symbol} ${message}`);
    if (result && result.ok) return res.json({ ok: true, sent: `${symbol} ${message}` });
    return res.status(500).json({ ok: false, error: result && result.error });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e && e.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  start();
});
