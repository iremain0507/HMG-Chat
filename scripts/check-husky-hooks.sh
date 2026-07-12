#!/usr/bin/env bash
# .husky/{pre-commit,commit-msg,pre-push} 설치 검사.
#   참고: rebuild_plan/08-SPRINT-PLAN.md T1 산출물, rebuild_plan/10-DEV-WORKFLOW.md 부록 A
set -uo pipefail
FAIL=0
err() { printf '  \033[31m❌ %s\033[0m\n' "$*" >&2; FAIL=1; }
ok()  { printf '  \033[32m✓\033[0m %s\n' "$*"; }

echo "▶ Husky hooks 설치 검사"

# 1) husky devDependency + prepare 스크립트
jq -e '.devDependencies.husky' package.json >/dev/null 2>&1 && ok "package.json devDependencies.husky 존재" || err "package.json devDependencies.husky 없음"
jq -e '.scripts.prepare == "husky"' package.json >/dev/null 2>&1 && ok "package.json prepare = husky" || err "package.json prepare 스크립트가 husky 아님"

# 2) 훅 파일 존재 + 실행권한
for h in pre-commit commit-msg pre-push; do
  f=".husky/$h"
  if [ -f "$f" ]; then
    ok "$f 존재"
    [ -x "$f" ] && ok "$f 실행권한" || err "$f 실행권한 없음"
  else
    err "$f 없음"
  fi
done

# 3) pre-commit — dev/deploy 규칙 + lint-staged 흡수
if [ -f .husky/pre-commit ]; then
  grep -q "check-dev-deploy-rules.sh" .husky/pre-commit && ok "pre-commit → check-dev-deploy-rules.sh 흡수" || err "pre-commit 이 check-dev-deploy-rules.sh 호출하지 않음"
  grep -q "lint-staged" .husky/pre-commit && ok "pre-commit → lint-staged 호출" || err "pre-commit 이 lint-staged 호출하지 않음"
fi

# 4) commit-msg — sprint key 정규식 (L01)
if [ -f .husky/commit-msg ]; then
  grep -q 'S\[0-9\]{2}' .husky/commit-msg && ok "commit-msg → sprint key 정규식 포함" || err "commit-msg 에 sprint key 정규식 없음"
fi

# 5) pre-push — typecheck
if [ -f .husky/pre-push ]; then
  grep -q "typecheck" .husky/pre-push && ok "pre-push → typecheck 호출" || err "pre-push 가 typecheck 호출하지 않음"
fi

exit $FAIL
