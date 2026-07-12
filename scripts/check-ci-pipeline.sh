#!/usr/bin/env bash
# CI 가 PR / main / release 3-tier 로 분기하는지 검사.
#   참고: rebuild_plan/08-SPRINT-PLAN.md Phase 0, rebuild_plan/15-CI-PIPELINE.md workflow rules
set -uo pipefail
FAIL=0
FILE=".github/workflows/ci.yml"
err() { printf '  \033[31m❌ %s\033[0m\n' "$*" >&2; FAIL=1; }
ok()  { printf '  \033[32m✓\033[0m %s\n' "$*"; }

echo "▶ CI pipeline 3-tier(PR/main/release) 분기 검사"

[ -f "$FILE" ] || { err "$FILE 없음"; exit 1; }

grep -qE '^\s*pull_request:' "$FILE" && ok "PR tier 존재" || err "PR tier(on.pull_request) 없음"
grep -qE '^\s*-?\s*main\b' "$FILE" && ok "main tier 존재" || err "main tier(on.push.branches: main) 없음"
grep -qE "v\*\.\*\.\*|v\[0-9\]" "$FILE" && ok "release tier(tag) 존재" || err "release tier(on.push.tags v*.*.*) 없음"

exit $FAIL
