# Binance Alert — Server

This server subscribes to Binance 1m kline websocket for a chosen symbol, computes EMA9/EMA26, and sends Telegram alerts when an EMA cross occurs on a closed candle.

How it works
 - On start it fetches historical klines (limit=500) to seed EMA9 and EMA26.
- It connects to Binance websocket `<symbol_lower>@kline_1m` and updates EMA on every kline update.
 - When a closed candle (`k.x === true`) causes EMA9/EMA26 cross, the server sends a Telegram message.

Environment variables
- `SYMBOL` — trading pair, default `BTCUSDT`
- `TELEGRAM_BOT_TOKEN` — (optional) Telegram bot token for sending messages
- `TELEGRAM_CHAT_ID` — (optional) chat id to send messages to
- `PORT` — HTTP port for health endpoint (default `3001`)

Run locally

```bash
cd server
npm install
TELEGRAM_BOT_TOKEN=123:ABC TELEGRAM_CHAT_ID=999 node index.js
```

Deploy to Render
1. Push your repo to GitHub.
2. Go to Render dashboard → New → Web Service.
3. Connect your GitHub repo and select `server/` as the root (set 'Root Directory' to `server`).
4. Build command: `npm install`
5. Start command: `npm start`
6. Set environment variables in Render: `SYMBOL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.

Notes
- This server is intentionally minimal. For production you may want to add logging, retries/backoff, metrics, and secure storage for secrets.
