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
6. After deploy, use: `https://<your-pages-domain>/health` to verify.

### Cloudflare 설정 (한국어 안내)
1) GitHub 연결: Cloudflare 대시보드 → Pages → Create project → GitHub 저장소 선택
2) 빌드 설정:
	- Build command: `npm run build`
	- Output directory: `build`
3) Functions 활성화: 리포지토리 루트의 `functions/` 디렉터리를 자동으로 감지합니다.
4) Secrets 등록 (Pages → Settings → Environment Variables):
	- `TELEGRAM_BOT_TOKEN`: 봇 토큰
	- `TELEGRAM_CHAT_ID`: 채팅 ID
5) 배포 확인: `https://<프로젝트도메인>/health` 응답이 `{ ok: true, ... }` 인지 확인

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
| Telegram 전송 실패 | Cloudflare Pages 환경변수(Secrets) `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` 설정 여부 확인. HTTPS로 `/send-alert` 호출. |
| price 값이 null | Binance API 응답 지연/레이트리밋 가능. 잠시 후 재시도. 브라우저 네트워크/CORS 차단 여부 확인. |
| 빌드 산출물이 비어있음 | Pages 설정 Output directory가 `build` 로 되어있는지 확인. `npm run build` 성공 로그 확인. |
| functions 동작 안 함 (404) | 루트에 `functions/` 디렉터리 존재 여부 확인. 파일명은 `health.js`, `price.js`, `send-alert.js` 형태. |
| 로컬 `/health` 호출 실패 | `npm run build` 후 `npx wrangler pages dev ./build` 로 실행했는지 확인. 포트 충돌 시 다른 포트 지정. |
| Telegram 메시지 포맷 이상 | `POST /send-alert` JSON body 필드(`symbol`, `message`, `price`, `emaShort`, `emaLong`) 확인. 누락되면 기본 문자열로 조합됨. |

## 라이선스 (License)
MIT (별도 명시 없을 시). 필요하면 Attribution 추가 조정 가능.

## Cloudflare Pages 설치 문서
상세 단계별 안내: `docs/CLOUDFLARE_PAGES_SETUP.md` 파일 참조 (프로젝트 생성, Secrets 등록, 로컬 dev, 문제 해결, 보안 모범 사례 포함).

