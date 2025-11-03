require('dotenv').config();
const axios = require('axios');
const WebSocket = require('ws');
const express = require('express');
const { calculateInitialEMA, updateEMA } = require('./utils/ema');

const SYMBOL = process.env.SYMBOL || 'BTCUSDT';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';
const PORT = process.env.PORT || 3001;

let ema9 = null;
let ema26 = null;
let lastPrice = null;
let prevCross = null;
let ws = null;

async function fetchAndInit() {
  console.log('Fetching historical klines...');
  // Use Binance Futures (USDT-M) REST endpoint for klines (1m)
  const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${SYMBOL}&interval=1m&limit=500`;
  const res = await axios.get(url, { timeout: 10000 });
  const data = res.data;
  const closes = data.map((k) => parseFloat(k[4]));
  if (closes.length < 26) throw new Error('Not enough historical candles to init EMA26');

  ema9 = calculateInitialEMA(closes.slice(-100), 9);
  ema26 = calculateInitialEMA(closes.slice(-300), 26);
  lastPrice = closes[closes.length - 1];
  prevCross = ema9 > ema26 ? 'bull' : 'bear';
  console.log(`Initial EMA9=${ema9.toFixed(4)} EMA26=${ema26.toFixed(4)} cross=${prevCross}`);
}

function sendTelegram(message) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log('Telegram not configured, skipping message:', message);
    return;
  }
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  axios.post(url, {
    chat_id: TELEGRAM_CHAT_ID,
    text: message,
  }).catch((err) => console.error('Telegram send error', err.message || err));
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

      // update EMAs live
      if (ema9 == null || ema26 == null) return;
      const newEma9 = updateEMA(ema9, close, 9);
      const newEma26 = updateEMA(ema26, close, 26);
      ema9 = newEma9;
      ema26 = newEma26;

      const newCross = ema9 > ema26 ? 'bull' : 'bear';

      // only notify on closed candle and when cross changes
      if (k.x && prevCross !== newCross) {
        prevCross = newCross;
        const when = new Date().toISOString();
        const type = newCross === 'bull' ? 'Bullish EMA9 > EMA26' : 'Bearish EMA9 < EMA26';
        const msgText = `${SYMBOL} ${type} @ ${lastPrice} (${when})`;
        console.log('ALERT:', msgText);
        sendTelegram(msgText);
      }
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
  try {
    await fetchAndInit();
    connectWebSocket();
  } catch (err) {
    console.error('Startup error', err.message || err);
    setTimeout(start, 10000);
  }
}

// Express health endpoint
const app = express();
app.get('/health', (req, res) => {
  res.json({ ok: true, symbol: SYMBOL, lastPrice, ema9, ema26, prevCross });
});

// test endpoint to trigger a Telegram test message (no auth) - useful in local dev
// GET /send-test?message=hello
app.get('/send-test', (req, res) => {
  const msg = req.query.message || `${SYMBOL} - test alert from server`;
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    return res.status(400).json({ ok: false, error: 'Telegram not configured' });
  }
  sendTelegram(msg);
  return res.json({ ok: true, sent: msg });
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  start();
});
