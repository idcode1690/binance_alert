# Cloudflare Pages 설정 가이드 (Functions 포함)

이 문서는 현재 리포지토리를 Cloudflare Pages + Pages Functions 로 배포하고 텔레그램 알림을 활성화하는 전체 절차를 한국어로 정리한 것입니다.

---
## 1. 사전 준비
- Cloudflare 계정
- GitHub 저장소 (현재: `idcode1690/binance_alert`)
- Telegram Bot (BotFather로 생성) 및 대상 채팅 ID

Telegram Chat ID 얻기:
1. 봇을 채팅 혹은 그룹에 추가
2. `https://api.telegram.org/bot<봇토큰>/getUpdates` 호출
3. JSON 응답의 `message.chat.id` 값 사용

---
## 2. Pages 프로젝트 생성
1. Cloudflare 대시보드 로그인
2. 왼쪽 메뉴 → Pages → "Create a project"
3. "Connect to GitHub" 선택 후 저장소 `binance_alert` 선택
4. Build 설정:
   - Framework preset: None (자동 감지 가능) → 직접 지정해도 무방
   - Build command: `npm run build`
   - Output directory: `build`
5. Advanced build settings는 기본값 유지 (Node 버전 기본 or 필요 시 18 설정)
6. "Save and Deploy" 클릭 → 최초 빌드/배포 진행

배포 후 프로젝트 도메인 예시: `https://binance-alert.pages.dev` 또는 커스텀 도메인 연결 가능.

---
## 3. Pages Functions 자동 인식 확인
리포 루트에 `functions/` 디렉터리가 있으므로 별도 설정 없이 다음 라우트들이 활성화됩니다:
- `GET /health`
- `GET /price?symbol=BTCUSDT`
- `POST /send-alert`

배포 완료 후 브라우저나 curl로 확인:
```bash
curl -s https://<your-pages-domain>/health | jq
curl -s "https://<your-pages-domain>/price?symbol=BTCUSDT" | jq
```

---
## 4. 환경변수(Secrets) 설정 (Telegram)
1. Pages → 프로젝트 선택 → Settings → Environment Variables
2. Add 항목:
   - `TELEGRAM_BOT_TOKEN` : BotFather에서 받은 토큰
   - `TELEGRAM_CHAT_ID` : 대상 채팅 ID
3. 저장 후 **재배포(redeploy)** 필요 (변경이 Functions 런타임에 반영되도록)

검증 방법:
```bash
curl -s -X POST \
  -H "Content-Type: application/json" \
  -d '{"symbol":"BTCUSDT","price":12345,"emaShort":26,"emaLong":200,"message":"Test alert"}' \
  https://<your-pages-domain>/send-alert | jq
```
성공 시 `{ ok: true, sent: "..." }` 형태 응답

---
## 5. GitHub Actions 연동 (자동 배포)
리포지토리에 `.github/workflows/cloudflare-pages.yml` 가 포함되어 있습니다:
- master 브랜치에 push → Cloudflare Pages로 자동 배포 (또는 수동 실행 가능)
- 필요한 GitHub Secrets (리포지토리 Settings → Secrets → Actions):
  - `CLOUDFLARE_API_TOKEN` : Pages 프로젝트 배포 권한 포함 토큰
  - `CLOUDFLARE_ACCOUNT_ID` : Cloudflare 계정 ID
  - `CF_PAGES_PROJECT_NAME` : Pages 프로젝트 이름
  - (선택) `REACT_APP_SERVER_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`

토큰 생성:
1. Cloudflare Dashboard → My Profile → API Tokens → Create Token
2. 템플릿에서 Pages 권한 선택 (또는 "Edit Cloudflare Pages" 커스텀 권한)
3. 발급 토큰을 GitHub Secret `CLOUDFLARE_API_TOKEN` 으로 추가

---
## 6. 로컬 개발 (Functions 포함)
```powershell
npm install
npm run build
npx wrangler pages dev ./build --port 8792
```
다른 터미널에서:
```powershell
Invoke-WebRequest -Uri http://127.0.0.1:8792/health -UseBasicParsing | Select-Object -ExpandProperty Content
```

### .env 로컬 시크릿 테스트 (선택)
루트에 `.env` 파일 생성:
```
TELEGRAM_BOT_TOKEN=xxx
TELEGRAM_CHAT_ID=123456
```
wrangler dev 실행 시 자동 주입 (실제 배포와는 분리)

---
## 7. 자주 발생하는 문제 & 해결
| 증상 | 원인 | 해결 |
|------|------|------|
| `/health` 404 | Functions 디렉터리 미인식 | 리포 루트에 `functions/` 존재 여부 확인 후 재배포 |
| `/send-alert` 400 `telegram_not_configured` | 텔레그램 시크릿 미설정 | Pages Settings → Environment Variables 등록 후 재배포 |
| 가격 null | Binance 응답 레이트리밋/지연 | 수 초 후 재시도, 네트워크 차단 여부 확인 |
| GitHub Actions 배포 실패 | Secrets 누락 | `CF_API_TOKEN`, `CF_ACCOUNT_ID`, `CF_PAGES_PROJECT_NAME` 재확인 |
| 로컬 dev 종료됨 | 한 터미널에서 wrangler 실행 후 같은 터미널로 요청 | wrangler는 실행 터미널 유지, 별도 터미널로 요청 수행 |

---
## 8. 보안 모범 사례
- 토큰은 절대 클라이언트 번들(`src/`)에서 직접 접근하지 말 것.
- 응답 JSON에 토큰 포함 금지.
- 필요 시 토큰 주기적 회전(BotFather 재발급 후 환경변수 갱신).
- 실패 로그에 민감 정보(토큰, 챗ID) 기록하지 않기.

---
## 9. 선택적 확장 아이디어
- `/send-alert` 요청에 간단한 HMAC 서명 추가 (Replay 공격 방지)
- Rate limiting (IP별 분당 N회 제한)
- Slack/Discord 등 다중 채널 알림 확장
- `/stats` 함수 추가: 최근 전송 횟수/성공률 집계

---
## 10. HMAC 예시 (선택)
클라이언트가 `X-Signature` 헤더로 `HMAC_SHA256(body, SECRET_KEY)`를 전송하게 하고 Functions에서 재검증:
```js
// functions/send-alert.js 내부 개념 예시
const provided = request.headers.get('X-Signature');
const calc = await hmacHex(env.SECRET_KEY, rawBodyString);
if (provided !== calc) return new Response('bad signature', { status: 401 });
```
※ `SECRET_KEY` 추가 시 Pages 환경변수에 등록.

---
## 11. 배포 최종 체크리스트
- [ ] Pages 프로젝트 생성
- [ ] Build command / Output 디렉터리 설정
- [ ] Functions 정상 인식 (`/health` 200)
- [ ] Telegram Secrets 설정 (`/send-alert` OK)
- [ ] GitHub Actions Secrets 설정 및 자동 배포 확인
- [ ] 필요 시 커스텀 도메인 연결 (DNS CNAME 설정)

---
## 12. 도움이 필요할 때
문제 증상 + 배포 로그(에러 부분) 또는 curl 결과를 전달하면 원인 추정과 수정 포인트를 빠르게 안내해 드릴 수 있습니다.

---
즐거운 사용 되세요! 추가 요구사항(예: HMAC 실제 구현, Rate limit 코드) 있으면 요청해 주세요.
