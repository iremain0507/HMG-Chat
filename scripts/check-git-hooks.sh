#!/usr/bin/env bash
# Git hook 설치 검사 — 이 프로젝트는 Husky 를 쓰지 않고
# core.hooksPath=.githooks 로 버전 관리되는 훅을 사용한다(단일 출처).
#   참고: rebuild_plan/10-DEV-WORKFLOW.md 부록 A, .githooks/pre-commit, scripts/setup-hooks.sh
#   결정 근거: Husky 는 core.hooksPath 를 덮어써 dev/deploy 규칙 훅을 무력화하므로 배제.
set -uo pipefail
FAIL=0
err() { printf '  \033[31m❌ %s\033[0m\n' "$*" >&2; FAIL=1; }
ok()  { printf '  \033[32m✓\033[0m %s\n' "$*"; }

echo "▶ Git hooks(.githooks) 설치 검사"

# 1) core.hooksPath 가 .githooks 로 지정되어 있고, 활성화 스크립트가 존재
HP="$(git config core.hooksPath || true)"
[ "$HP" = ".githooks" ] && ok "core.hooksPath = .githooks" || err "core.hooksPath 가 .githooks 아님(현재: '${HP:-미설정}') — 'bash scripts/setup-hooks.sh' 실행 필요"
[ -x scripts/setup-hooks.sh ] && ok "scripts/setup-hooks.sh 존재/실행권한" || err "scripts/setup-hooks.sh 없음/실행권한 없음"

# 2) prepare 스크립트가 setup-hooks.sh 를 호출(클론 직후 자동 활성화) — husky 아님
jq -e '.scripts.prepare | test("setup-hooks.sh")' package.json >/dev/null 2>&1 \
  && ok "package.json prepare → scripts/setup-hooks.sh" \
  || err "package.json prepare 가 setup-hooks.sh 를 호출하지 않음"
jq -e '.devDependencies.husky // .dependencies.husky' package.json >/dev/null 2>&1 \
  && err "husky 의존성이 남아있음 — core.hooksPath 를 덮어쓸 위험(제거 필요)" \
  || ok "husky 의존성 없음(hooksPath 보호)"

# 3) pre-commit 훅 — dev/deploy 규칙 + lint-staged 흡수
f=".githooks/pre-commit"
if [ -f "$f" ]; then
  ok "$f 존재"
  [ -x "$f" ] && ok "$f 실행권한" || err "$f 실행권한 없음"
  grep -q "check-dev-deploy-rules.sh" "$f" && ok "pre-commit → check-dev-deploy-rules.sh 흡수" || err "pre-commit 이 check-dev-deploy-rules.sh 호출하지 않음"
  grep -q "lint-staged" "$f" && ok "pre-commit → lint-staged 호출" || err "pre-commit 이 lint-staged 호출하지 않음"
else
  err "$f 없음"
fi

exit $FAIL
