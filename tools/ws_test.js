// Simple WebSocket client using 'ws' to connect to Binance combined stream and print incoming messages
// Usage: node tools/ws_test.js [SYMBOL] [DURATION_SEC]
const symbol = (process.argv[2] || 'BTCUSDT').replace(/[^A-Za-z0-9]/g, '').toLowerCase();
const duration = parseInt(process.argv[3] || '20', 10);

const WebSocket = require('ws');
const streams = `${symbol}@aggTrade/${symbol}@kline_1m`;
const url = `wss://fstream.binance.com/stream?streams=${streams}`;
console.log('Connecting to', url);
const ws = new WebSocket(url);
ws.on('open', () => {
  console.log('ws open');
});
ws.on('message', (data) => {
  try {
    const parsed = JSON.parse(data.toString());
    console.log('MSG', new Date().toISOString(), parsed.stream || parsed.e || 'combined', JSON.stringify(parsed.data || parsed).slice(0,400));
  } catch (e) {
    console.log('raw', data.toString().slice(0,400));
  }
});
ws.on('error', (err) => console.error('ws err', err && err.message));
ws.on('close', () => console.log('ws closed'));
setTimeout(() => {
  console.log('closing after', duration, 's');
  ws.close();
}, duration*1000);
