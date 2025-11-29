Param(
  [string]$ProjectName = "binance-alert",
  [string]$BuildDir = "build",
  [switch]$NoInstall
)

Write-Host "[deploy-cloudflare] 시작 - 프로젝트: $ProjectName"

if (-not $env:CF_API_TOKEN) { Write-Error "CF_API_TOKEN 환경변수가 필요합니다."; exit 1 }
if (-not $env:CF_ACCOUNT_ID) { Write-Error "CF_ACCOUNT_ID 환경변수가 필요합니다."; exit 1 }

if (-not (Test-Path $BuildDir)) {
  if (-not $NoInstall) {
    Write-Host "npm install 실행..."
    npm install | Out-Null
  }
  Write-Host "프로덕션 빌드 생성..."
  npm run build | Out-Null
}

Write-Host "wrangler 최신 설치/확인..."
npm exec wrangler -- -v | Out-Null

Write-Host "Cloudflare Pages deploy 명령 실행..."
# wrangler 4.x: pages deploy <dir> --project-name <name>
npm exec wrangler -- pages deploy $BuildDir --project-name $ProjectName

if ($LASTEXITCODE -ne 0) { Write-Error "배포 실패"; exit $LASTEXITCODE }
Write-Host "배포 완료. 도메인은 Cloudflare 대시보드에서 확인하세요."