#!/usr/bin/env bash
# Loop의 oracle. 커밋/종료 전 반드시 green이어야 하는 결정론적 게이트.
set -uo pipefail
FAIL=0
run_gate() { local n="$1"; shift; echo "── gate: $n"; if "$@"; then echo "   ✅ $n"; else echo "   ❌ $n"; FAIL=1; fi; }

# STEP 0에서 존재 확인된 스크립트만 유지 (없는 것은 주석 처리하고 보고에 SKIPPED 기록)
run_gate typecheck pnpm run typecheck
run_gate lint      pnpm run lint
run_gate test      pnpm run test
[ -f feature_list.json ] && run_gate state bash scripts/validate-state.sh
[ -x rebuild_plan/scripts/lint-plan.sh ] && run_gate spec-lint bash rebuild_plan/scripts/lint-plan.sh

exit $FAIL
