Cloudflare Pages + Worker deployment

This repository includes a Cloudflare Worker (worker/index.js) and a GitHub Actions workflow (.github/workflows/deploy.yml)
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
3. Change into worker directory and publish: wrangler publish
4. Set REACT_APP_SERVER_URL to the worker URL and run npm run build then upload to Pages (or push to GitHub to trigger workflow).

Security:
- Do NOT commit Telegram tokens or other secrets into the repository. Use Cloudflare secrets or GitHub Secrets.

If you want, I can also:
- Commit these files to the repository (already added) and help you set up the GitHub secrets list with exact names and instructions.
- Add a small example of how to test the worker via curl.
