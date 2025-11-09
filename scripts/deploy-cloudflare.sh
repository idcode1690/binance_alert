#!/usr/bin/env bash
set -euo pipefail

PROJECT_NAME=${1:-binance-alert}
BUILD_DIR=${2:-build}

if [[ -z "${CF_API_TOKEN:-}" ]]; then echo "CF_API_TOKEN env required"; exit 1; fi
if [[ -z "${CF_ACCOUNT_ID:-}" ]]; then echo "CF_ACCOUNT_ID env required"; exit 1; fi

if [[ ! -d "$BUILD_DIR" ]]; then
  npm install
  npm run build
fi

npx wrangler -v >/dev/null
npx wrangler pages deploy "$BUILD_DIR" --project-name "$PROJECT_NAME"

echo "Deployed. Check Pages domain in Cloudflare Dashboard."