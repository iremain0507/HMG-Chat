#!/usr/bin/env bash
# 보안 audit(semgrep SAST + trivy CVE scan) 잡이 CI 에 구성되어 있는지 검사.
#   참고: rebuild_plan/08-SPRINT-PLAN.md Phase 9 Week 11, rebuild_plan/15-CI-PIPELINE.md security stage
set -uo pipefail
FAIL=0
FILE=".github/workflows/ci.yml"
err() { printf '  \033[31m❌ %s\033[0m\n' "$*" >&2; FAIL=1; }
ok()  { printf '  \033[32m✓\033[0m %s\n' "$*"; }

echo "▶ 보안 audit(semgrep + trivy) CI 구성 검사"

[ -f "$FILE" ] || { err "$FILE 없음"; exit 1; }

grep -qE '^\s*sast:' "$FILE" && ok "sast job 존재" || err "sast job 없음"
grep -q "semgrep" "$FILE" && ok "semgrep 사용" || err "semgrep 미사용"
grep -q "p/owasp-top-ten" "$FILE" && ok "owasp-top-ten ruleset 사용" || err "owasp-top-ten ruleset 없음"
grep -q "p/typescript" "$FILE" && ok "typescript ruleset 사용" || err "typescript ruleset 없음"

grep -qE '^\s*container-scan:' "$FILE" && ok "container-scan job 존재" || err "container-scan job 없음"
grep -q "trivy" "$FILE" && ok "trivy 사용" || err "trivy 미사용"
grep -q "HIGH,CRITICAL" "$FILE" && ok "HIGH,CRITICAL severity 게이트" || err "HIGH,CRITICAL severity 게이트 없음"

exit $FAIL
