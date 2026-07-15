#!/usr/bin/env bash
# verify-browser.sh — P10 브라우저 검증(Layer 1). /preview 대상 Playwright headless 스모크.
#   usage: bash scripts/verify-browser.sh [<playwright test args, 예: -g "markdown">]
#   · dev :3000 과 충돌 없는 3100 전용 인스턴스를 Playwright webServer 가 자동 기동/재사용.
#   · chromium 미설치 시 1회 설치(오프라인이면 경고 후 기존 바이너리로 진행).
#   · jsdom/RTL 이 못 잡는 실 브라우저 렌더(Tailwind 컴파일·CSS·rehype·테마)를 검증.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/apps/web"

if ! pnpm exec playwright --version >/dev/null 2>&1; then
  echo "❌ @playwright/test 미설치(apps/web devDependency)."
  echo "   'pnpm --filter @wchat/web add -D @playwright/test' 후 재시도."
  exit 1
fi

# chromium 바이너리 확인/설치(로컬 1회)
pnpm exec playwright install chromium >/dev/null 2>&1 \
  || echo "⚠️ chromium 설치 실패(네트워크?) — 기존 바이너리로 진행"

mkdir -p "$ROOT/.ralph/screenshots"

echo "▶ Playwright 브라우저 검증 시작 (/preview @ :3100)"
if [ $# -gt 0 ]; then
  pnpm exec playwright test "$@"
else
  pnpm exec playwright test
fi
RC=$?
[ $RC -eq 0 ] && echo "✅ 브라우저 검증 통과 — 스크린샷: .ralph/screenshots/" \
             || echo "❌ 브라우저 검증 실패(RC=$RC)"
exit $RC
