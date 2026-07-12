#!/usr/bin/env bash
# Phase 0 "30분 onboarding" 산출물 검사 — rebuild_plan/08-SPRINT-PLAN.md § Phase 0 acceptance,
# rebuild_plan/10-DEV-WORKFLOW.md 부록 B/C, rebuild_plan/build_prompt.md § Phase 0 산출물 매트릭스 단일 출처.
set -uo pipefail
FAIL=0
err() { printf '  \033[31m❌ %s\033[0m\n' "$*" >&2; FAIL=1; }
ok()  { printf '  \033[32m✓\033[0m %s\n' "$*"; }

echo "▶ Onboarding 스크립트/문서 검사"

# 1) scripts/setup-git.sh — 존재/실행권한/syntax (build_prompt.md 검증 명령: bash -n)
f="scripts/setup-git.sh"
if [ -f "$f" ]; then
  ok "$f 존재"
  [ -x "$f" ] && ok "$f 실행권한" || err "$f 실행권한 없음"
  bash -n "$f" && ok "$f syntax OK" || err "$f syntax error"
else
  err "$f 없음"
fi

# 2) scripts/tunnel.sh — 존재/실행권한/syntax (AWS 미프로비저닝: LOCAL_ONLY — 실행 아닌 syntax만 검증)
f="scripts/tunnel.sh"
if [ -f "$f" ]; then
  ok "$f 존재"
  [ -x "$f" ] && ok "$f 실행권한" || err "$f 실행권한 없음"
  bash -n "$f" && ok "$f syntax OK" || err "$f syntax error"
else
  err "$f 없음"
fi

# 3) package.json tunnel script 가 scripts/tunnel.sh 를 가리킴
jq -e '.scripts.tunnel | test("scripts/tunnel.sh")' package.json >/dev/null 2>&1 \
  && ok "package.json tunnel → scripts/tunnel.sh" \
  || err "package.json scripts.tunnel 이 scripts/tunnel.sh 를 호출하지 않음"

# 4) README.md 30분 onboarding 절차 — 08-SPRINT-PLAN.md § Phase 0 acceptance 핵심 단계 존재
for marker in \
  "scripts/setup-git.sh" \
  "pnpm install" \
  "docker compose" \
  "pnpm db:migrate" \
  "pnpm dev" \
  "/health" \
  "pnpm typecheck" \
  "30"
do
  grep -q -- "$marker" README.md 2>/dev/null \
    && ok "README.md 에 '$marker' 포함" \
    || err "README.md 에 '$marker' 없음"
done

exit $FAIL
