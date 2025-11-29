Cloudflare Pages + Worker deployment

This repository includes a Cloudflare Worker (`worker/index.js`) and a GitHub Actions workflow (`.github/workflows/deploy.yml`)
that build and deploy the React app to Cloudflare Pages and publish the Worker which can relay Telegram messages.

Required GitHub Secrets (set in repository Settings -> Secrets):
- CF_API_TOKEN: Cloudflare API token with Pages and Workers permissions
- CF_ACCOUNT_ID: Cloudflare account id
- CF_PAGES_PROJECT_NAME: Cloudflare Pages project name (already created in dashboard)
- REACT_APP_SERVER_URL: (optional) set to your Worker URL e.g. https://binance-alert-worker.your-subdomain.workers.dev

Worker-specific secrets (set via Cloudflare or via wrangler secrets):
- TELEGRAM_BOT_TOKEN
- TELEGRAM_CHAT_ID

Notes:
- The workflow expects that the Worker directory contains wrangler.toml configured with your account_id. You can update that file or use wrangler CLI to publish locally.
- On first deploy, you may need to set REACT_APP_SERVER_URL manually to the worker's URL so the frontend uses the worker for /send-alert.

Steps to deploy manually (if you prefer):
1. Install wrangler: npm i -g wrangler
2. Configure wrangler with your account: wrangler login
3. Change into worker directory and publish: wrangler publish (or from project root: npm run deploy:worker)
4. Set REACT_APP_SERVER_URL to the worker URL and run npm run build then upload to Pages (or push to GitHub to trigger workflow).

Security:
- Do NOT commit Telegram tokens or other secrets into the repository. Use Cloudflare secrets or GitHub Secrets.

If you want, I can also:
- Commit these files to the repository (already added) and help you set up the GitHub secrets list with exact names and instructions.
- Add a small example of how to test the worker via curl.

Always-on server (Render) deployment
-----------------------------------
This repo includes a Render blueprint (`render.yaml`) to run the Node/Express server (under `server/`) 24/7 and serve the React build from `/build`.

What the blueprint does now:
- Installs dependencies at the project root and builds the React app: `npm install && npm run build`
- Starts the server: `node server/index.js`
- Health check: `/health`

Deploy steps:
1. Push this repo to GitHub (done)
2. Render Dashboard → New → Blueprint → select this repo
3. Confirm the defaults from `render.yaml` and click Create Resources
4. Add environment variables in Render (Dashboard → Service → Environment):
   - TELEGRAM_BOT_TOKEN (optional if Telegram relay is needed)
   - TELEGRAM_CHAT_ID (optional if Telegram relay is needed)
   - NODE_ENV=production (already set by blueprint)
   - SYMBOL=BTCUSDT (optional; defaults to BTCUSDT)
5. First deploy will start automatically. Render sets `PORT` and the server uses `process.env.PORT`.
6. After deploy, note your public URL, e.g. `https://binance-alert-server.onrender.com`.

Usage options:
- Single service (recommended simple path): open the Render URL above and use the app. The frontend now defaults to `window.location.origin` when `REACT_APP_SERVER_URL` is not set, so same-origin `/events` and `/send-alert` work automatically.
- Split frontend (Cloudflare Pages) + backend (Render): set `REACT_APP_SERVER_URL` to the Render URL and rebuild the frontend (push to master to trigger Pages workflow). CORS headers are already allowed in the server.


Render redeploy steps (clear cache + verify)
-------------------------------------------
When build/start commands or dependencies change, redeploy like this:

1) In Render Dashboard → your Web Service → Settings → Build & Deploy → click "Clear build cache".
2) Click "Manual Deploy" → "Deploy latest commit" (or push to master to auto-deploy).
3) Confirm the service type is "Web Service" (not "Static Site").
4) In "Environment" ensure:
	 - Build Command: `npm install --no-audit --no-fund && npm run build`
	 - Start Command: `node server/index.js`
	 - Health Check Path: `/health`
5) After deploy:
	 - Open https://<your-service>.onrender.com/health — expect JSON `{ ok: true, symbol, lastPrice }`.
	 - Open https://<your-service>.onrender.com/ — React app should load. The app will call same-origin `/events` and `/send-alert`.

Windows PowerShell quick checks (optional):

```
# Health check
Invoke-WebRequest -Uri "https://<your-service>.onrender.com/health" -UseBasicParsing | Select-Object -ExpandProperty Content

# Send alert (requires TELEGRAM_* envs set in Render)
Invoke-RestMethod -Method Post -Uri "https://<your-service>.onrender.com/send-alert" -Headers @{"Content-Type"="application/json"} -Body (
	'{"symbol":"BTCUSDT","message":"Bull cross","price":100000,"emaShort":9,"emaLong":26}'
)
```

Troubleshooting
---------------
- 404 with header `x-render-routing: no-server`:
	- The server did not start. Check Start Command and service logs. Ensure type is Web Service.
- Build fails with `npm ci` lockfile EUSAGE:
	- Use `npm install` (already set in `render.yaml`). Clear cache and redeploy.
- SPA 404 on routes like `/alerts`:
	- `server/index.js` serves the React build with a catch-all to `index.html`. Ensure the build step completed and `build/` exists.
- CORS or cross-origin issues:
	- Single service mode needs no `REACT_APP_SERVER_URL`. If frontend is hosted elsewhere, set `REACT_APP_SERVER_URL` to the Render URL and rebuild frontend.
- Health check failing intermittently:
	- Binance connectivity can be transient. The health JSON still returns `ok: true` even while initializing; `lastPrice` appears after initial fetch or first ws message.


Test endpoints (replace your workers.dev subdomain):

```
# Health check
curl -s https://binance-alert-worker.your-subdomain.workers.dev/health | jq

# Send alert (POST JSON)
curl -s -X POST \
	-H "Content-Type: application/json" \
	-d '{
		"symbol": "BTCUSDT",
		"message": "Bull cross",
		"price": 100000,
		"emaShort": 9,
		"emaLong": 26
	}' \
	https://binance-alert-worker.your-subdomain.workers.dev/send-alert | jq

# Price helper (cached for a few seconds)
curl -s "https://binance-alert-worker.your-subdomain.workers.dev/price?symbol=BTCUSDT" | jq
```
