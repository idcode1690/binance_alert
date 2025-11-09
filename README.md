# Binance Alert (Simplified)

This project is a simplified EMA cross alert and symbol scanner running purely on the client plus optional Cloudflare Pages Functions for Telegram relay and lightweight price/health endpoints. The previous Node/Express server and Render deployment have been removed.

## Architecture

Frontend:
- React (Create React App) SPA
- Direct Binance Futures REST/WebSocket usage from browser
- Local storage persistence for alerts and settings

Backend (optional):
- Cloudflare Pages Functions in `functions/` provide:
	- `GET /health` – basic ping + Telegram configuration flag
	- `GET /price?symbol=BTCUSDT` – cached last close price
	- `POST /send-alert` – Telegram relay (requires BOT token + chat id secrets)

No SSE or persistent Node process is required. All real-time EMA logic runs client-side.

## Scripts

```bash
npm install        # install dependencies
npm start          # local dev (client-only)
npm test           # run tests once
npm run build      # production build (static assets in ./build)
```

## Deploy: Cloudflare Pages

1. Push repository to GitHub.
2. In Cloudflare Dashboard → Pages → Create Project → Connect GitHub repo.
3. Build command: `npm run build`  Output directory: `build`.
4. Add Secrets (Settings → Environment Variables):
	 - `TELEGRAM_BOT_TOKEN`
	 - `TELEGRAM_CHAT_ID`
5. Pages Functions auto-detected (directory `functions/`).
6. After deploy, test: `https://<your-pages-domain>/health` → `{ ok: true, telegramConfigured: true }`.
7. (Optional) Separate Cloudflare Worker deployment for cron/KV scanning: `wrangler deploy -c wrangler.worker.toml` (ensure KV IDs & secrets set via dashboard or `wrangler secret put`).

### CI (GitHub Actions) Cloudflare Pages 자동 배포
GitHub 저장소에 Cloudflare Pages 배포를 자동화하려면 아래 워크플로우 예시를 참고하여 `.github/workflows/cloudflare-pages.yml` 파일을 추가하세요:

```yaml
name: Deploy Cloudflare Pages
on:
	push:
		branches: [ master ]
	workflow_dispatch:

jobs:
	deploy:
		runs-on: ubuntu-latest
		steps:
			- uses: actions/checkout@v4
			- uses: actions/setup-node@v4
				with:
					node-version: '18'
					cache: 'npm'
			- name: Install deps
				run: npm ci
			- name: Build
				run: npm run build
				env:
					REACT_APP_SERVER_URL: https://<your-pages-domain>
			- name: Publish to Cloudflare Pages
				uses: cloudflare/pages-action@v1
				with:
					apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
					accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
					projectName: binance-alert
					directory: build
					gitHubToken: ${{ secrets.GITHUB_TOKEN }}
				env:
					TELEGRAM_BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}
					TELEGRAM_CHAT_ID: ${{ secrets.TELEGRAM_CHAT_ID }}
```

필수 GitHub Secrets:
- `CLOUDFLARE_API_TOKEN`: Pages 프로젝트에 대한 write 권한이 있는 토큰
- `CLOUDFLARE_ACCOUNT_ID`: Cloudflare 계정 ID
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`: Functions에서 사용될 텔레그램 시크릿

> Pages 대시보드에 환경변수(Secrets)를 설정한 경우, action에서 env로 넘기지 않아도 됩니다. 한곳(대시보드 또는 workflow)에서만 관리하는 것을 권장합니다.

### Worker vs Pages
| Use Case | Pages Functions | Standalone Worker |
|----------|-----------------|-------------------|
| Static front-end hosting | ✅ | ❌ (must embed assets) |
| Simple REST endpoints (/health,/send-alert) | ✅ | ✅ |
| KV Cron Scanner (scheduled EMA cross) | ❌ (Pages has no cron) | ✅ (via `triggers.crons`) |
| Lowest complexity | ✅ | — |
| Needs background scanning without client open | ✅ (if moved to Worker) | ✅ |

If you need scheduled scans, deploy the Worker (separate from Pages). Frontend can still call Worker domain for /send-alert.

### Cloudflare 설정 (한국어 안내)
1) GitHub 연결: Cloudflare 대시보드 → Pages → Create project → GitHub 저장소 선택
2) 빌드 설정:
	- Build command: `npm run build`
	- Output directory: `build`
3) Functions 활성화: 리포지토리 루트의 `functions/` 디렉터리를 자동으로 감지합니다.
4) Secrets 등록 (Pages → Settings → Environment Variables):
	- `TELEGRAM_BOT_TOKEN`: 봇 토큰
	- `TELEGRAM_CHAT_ID`: 채팅 ID
5) 배포 확인: `https://<프로젝트도메인>/health` 응답이 `{ ok: true, telegramConfigured: true }` 인지 확인
6) (선택) 워커 배포: `wrangler deploy -c wrangler.worker.toml` (CI에서는 `npm run worker:deploy`).

로컬 개발(선택):
```powershell
# 최초 1회 빌드
npm run build

# 로컬 Pages Functions 실행 (경고 제거를 위해 wrangler.toml 포함)
npx wrangler pages dev ./build --port 8790

# 확인
Invoke-WebRequest -Uri http://127.0.0.1:8790/health -UseBasicParsing | Select-Object -ExpandProperty Content
```

### Telegram Relay
`POST /send-alert` body example:
```json
{
	"symbol": "BTCUSDT",
	"price": 10234.5,
	"emaShort": 26,
	"emaLong": 200,
	"message": "Bullish cross"
}
```

Returns `{ ok: true, sent: "..." }` on success.

## GitHub Pages Alternative
You can deploy the static build to GitHub Pages (workflow already exists) but Telegram relay will not work unless you keep Cloudflare Pages Functions or a Worker. Avoid exposing bot tokens directly in client code.

### GitHub Pages Only Mode (선택: Cloudflare Functions 미사용)
`https://idcode1690.github.io/binance_alert/` 와 같이 GitHub Pages 도메인만 사용할 경우:

- 동작: 실시간 EMA 계산, 알림(브라우저 Notification + 소리), 심볼 스캐너 등은 100% 클라이언트에서만 수행됩니다.
- 미지원: Telegram 전송(`/send-alert`), 서버 제공 가격 캐시(`/price`), 헬스체크(`/health`). 이 엔드포인트들은 Cloudflare Pages Functions 가 있어야 합니다.
- 보안 이유: Telegram BOT 토큰을 클라이언트 코드에 직접 넣지 마세요. 공개 저장소/브라우저 번들에 노출됩니다.
- 장점: 가장 단순한 구성 (정적 배포만), 유지비/추가 설정 최소화.
- 단점: 서버 사이드 알림 릴레이 없음, 봇 토큰 보안 처리 불가, 향후 서버 확장(예: 사용자별 alert 저장) 어려움.

GitHub Pages Only 모드에서 Telegram 기능을 쓰고 싶다면 다음 중 하나를 선택하세요:
1. Cloudflare Pages Functions 프로젝트(커스텀 도메인 불필요, 기본 `*.pages.dev` 사용)를 추가로 유지하고 프론트엔드에서 해당 도메인을 호출.
2. 별도 서버(예: VPS, 렌더 등) 재도입 — 프로젝트 목표가 단순화인 경우 권장하지 않음.

#### 프론트엔드가 Cloudflare Pages Functions 호출하도록 설정 (혼합 모드)
Cloudflare Pages 를 Functions 용으로만 쓰고, 정적 사이트는 GitHub Pages 에서 제공하려면:
1. Cloudflare Pages 프로젝트 생성 (빌드 명령/디렉터리 동일: `npm run build`, `build`).
2. Secrets 설정: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.
3. 첫 배포 후 Functions 도메인 확인: 예) `https://<project>.pages.dev`.
4. GitHub Pages 쪽 `.env` (또는 Actions 환경변수) 에 `REACT_APP_SERVER_URL=https://<project>.pages.dev` 추가 후 다시 빌드/배포. 또는 브라우저 콘솔에서 `localStorage.setItem('serverUrl','https://<project>.pages.dev')` 후 새로고침.
5. 브라우저 콘솔에서 `POST https://<project>.pages.dev/send-alert` 호출/응답 OK 확인.

설정을 하지 않으면 앱 내부에서 `serverUrl` 이 null 로 판단되어 Telegram 관련 호출을 자동으로 건너뛰고 토스트에 "Telegram disabled" 가 표시됩니다.

> 요약: GitHub Pages 만 사용 → 클라이언트 순수 모드. Telegram 필요 → Cloudflare Pages Functions 도메인 추가 후 환경변수로 연결.

## 제거된 구성 요소 (Legacy Removed)
프로젝트 단순화를 위해 다음 항목을 완전히 삭제했습니다:
- 기존 Node/Express 서버 디렉터리 `server/` (Dockerfile, index.js, utils 등)
- 개별 Cloudflare Worker 디렉터리 `worker/`
- Render 배포 청사진 `render.yaml`
- SSE 기반 실시간 이벤트 스트림 (프론트엔드 `App.js` 내 구독 로직 제거됨)

이제 백엔드는 오직 Cloudflare Pages Functions(`functions/`) 만 사용합니다.

## Local Development Notes
- Functions are not invoked during `npm start`. Use `wrangler pages dev ./build` after a build for closer simulation if needed.
- Alerts persist in `localStorage` (max 7 days, latest 500).

## 트러블슈팅 (Troubleshooting)
| 문제 | 해결 |
|------|------|
| Telegram 전송 실패 | Secrets 설정 여부, `serverUrl` 지정(localStorage 또는 REACT_APP_SERVER_URL), /send-alert 응답 코드/JSON detail 확인 |
| price 값이 null | Binance API 응답 지연/레이트리밋 가능. 잠시 후 재시도. 브라우저 네트워크/CORS 차단 여부 확인. |
| 빌드 산출물이 비어있음 | Pages 설정 Output directory가 `build` 로 되어있는지 확인. `npm run build` 성공 로그 확인. |
| functions 404 | `functions/` 디렉터리 구조, 파일명 확인(`health.js`, `price.js`, `send-alert.js`). Pages 배포 로그에서 Functions 활성화 여부. |
| 로컬 `/health` 호출 실패 | `npm run build` 후 `npx wrangler pages dev ./build` 로 실행했는지 확인. 포트 충돌 시 다른 포트 지정. |
| Telegram 메시지 포맷 이상 | `POST /send-alert` JSON body 필드 확인(`symbol`, `message`, `price`, `emaShort`, `emaLong`). Worker 로직에서 조합되는 `EMA<short>/<long>` 태그 정상 여부. |

## 라이선스 (License)
MIT (별도 명시 없을 시). 필요하면 Attribution 추가 조정 가능.

## Cloudflare Pages 설치 문서
상세 단계별 안내: `docs/CLOUDFLARE_PAGES_SETUP.md` 파일 참조 (프로젝트 생성, Secrets 등록, 로컬 dev, 문제 해결, 보안 모범 사례 포함).

