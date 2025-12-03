# Cloudflare Pages Functions: Telegram Alerts

This project can send Telegram messages securely using Cloudflare Pages Functions, without running your own server.

## Prerequisites
- Cloudflare account
- A Telegram Bot token from @BotFather
- This repo connected to a Cloudflare Pages project

## Setup Steps
1. Create a Pages project and connect this GitHub repo.
2. In Pages project settings → Environment variables, add:
   - `TELEGRAM_BOT_TOKEN`: your bot token
3. Ensure `functions/send-alert.js` exists (it does in this repo) and posts to `https://api.telegram.org/bot${token}/sendMessage` using the secret.
4. Deploy the site. Pages will expose an endpoint at `/api/send-alert`.

## Frontend Usage
The UI calls `/api/send-alert` via `src/utils/telegram.js`.

```
import { sendTelegramMessage } from '../utils/telegram';
await sendTelegramMessage({ chatId: '<your_chat_id>', text: 'hello' });
```

## Notes
- Do not put your bot token in client-side code.
- If you need rate limiting or retries, implement them in `functions/send-alert.js`.
