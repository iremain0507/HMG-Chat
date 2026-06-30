#!/usr/bin/env bash
# lint-plan.sh — rebuild_plan 의 self-validation. 매 라운드의 외부 LLM 검토가 발견하기 전에
# 동일 패턴 결함을 자동 검출 → 재발 방지.
#
# 실행: bash rebuild_plan/scripts/lint-plan.sh
# 검사: YAML/bash 문법, cross-ref, envelope 위반, DB↔Interface↔API drift.
# 실패 시 non-zero exit. STRICT=0 으로 우회 가능.

set -uo pipefail
# plan 위치는 두 가지: (a) 본 plan 원본 (rebuild_plan/), (b) 새 repo 의 docs/plans/.
# 본 script 가 어디서 실행되든 자기 부모 디렉토리를 PLAN_DIR 로 사용.
PLAN_DIR="${PLAN_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$PLAN_DIR"
echo "[lint-plan] PLAN_DIR=$PLAN_DIR"

EXIT_CODE=0
section() { echo ""; echo "═══ $* ═══"; }
fail()    { echo "  ❌ $*"; EXIT_CODE=1; }
pass()    { echo "  ✓ $*"; }

# ─── 1. YAML 코드블록 (post-substitution) ──────────────────────
section "1. YAML 코드블록 (post-substitution)"
if command -v python3 >/dev/null 2>&1 && python3 -c "import yaml" 2>/dev/null; then
  for f in *.md; do
    awk '/^```yaml$/{f=1;next} /^```$/{f=0} f' "$f" > /tmp/.lint-yaml
    [ -s /tmp/.lint-yaml ] || continue
    out=$(python3 -c "
import yaml, re, sys
content = open('/tmp/.lint-yaml').read()
content = re.sub(r'\{\{[A-Z_]+\}\}', 'demo', content)
try:
    list(yaml.safe_load_all(content))
except yaml.YAMLError as e:
    sys.exit(str(e).split('\n')[0])
" 2>&1) && pass "$f" || fail "$f YAML — $out"
  done
else
  echo "  (python3+yaml 미설치 — skip)"
fi

# ─── 2. bash 코드블록 (블록별 bash -n) ─────────────────────────
section "2. bash 코드블록 (블록별 bash -n)"
for f in *.md; do
  block_idx=0
  block_failures=0
  # 블록을 하나씩 추출. awk 가 ```bash 와 ``` 사이를 ENTER 로 끝나는 파일로 분리.
  awk -v outdir="/tmp/.lint-blocks" '
    BEGIN { idx=0; mkdir=0 }
    /^```bash$/ { idx++; out=outdir "/" idx ".sh"; in_block=1; next }
    /^```$/ && in_block { in_block=0; close(out); next }
    in_block { print > out }
  ' "$f"
  ls /tmp/.lint-blocks/*.sh 2>/dev/null | while read -r blk; do
    # 치환: {{VAR}} → demo, 그리고 <user-chosen> / <repo> 같은 문서용 placeholder 도 단순 식별자로
    # (bash 가 < 를 redirection 으로 오해해 false positive)
    sed -i.bak \
      -e 's/{{[A-Z_]*}}/demo/g' \
      -e 's/<[a-zA-Z][a-zA-Z0-9_-]*>/PLACEHOLDER/g' \
      "$blk"
    rm -f "${blk}.bak"
    bash -n "$blk" 2>/tmp/.lint-block-err || {
      err=$(head -1 /tmp/.lint-block-err)
      echo "  ❌ $f block #$(basename "$blk" .sh) — $err"
      echo "fail" > /tmp/.lint-block-fail
    }
  done
  if [ -f /tmp/.lint-block-fail ]; then
    EXIT_CODE=1
    rm -f /tmp/.lint-block-fail
  else
    pass "$f"
  fi
  mkdir -p /tmp/.lint-blocks
  rm -f /tmp/.lint-blocks/*.sh
done
mkdir -p /tmp/.lint-blocks
rm -rf /tmp/.lint-blocks

# ─── 3. cross-reference ───────────────────────────────────────
section "3. cross-reference (인용된 .md 가 실재)"
broken_count=0
grep -hoE '\]\(([0-9a-zA-Z_/-]+\.md)' *.md 2>/dev/null \
  | sed 's/^](//' | sort -u > /tmp/.lint-refs
while IFS= read -r ref; do
  # plan 외부 / 외부 URL / .claude 는 skip
  case "$ref" in
    ../*) continue ;;
    http*) continue ;;
    .claude/*) continue ;;
  esac
  if [ ! -f "$ref" ]; then
    fail "broken ref → $ref"
    broken_count=$((broken_count + 1))
  fi
done < /tmp/.lint-refs
[ "$broken_count" -eq 0 ] && pass "모든 cross-ref 실재"

# ─── 4. API envelope 위반 ──────────────────────────────────────
section "4. envelope 위반 (16-API-CONTRACT)"
viol=$(grep -nE "^Response 2[0-9][0-9]: \{ data: " 16-API-CONTRACT.md 2>/dev/null | grep -v 'meta:' || true)
if [ -z "$viol" ]; then
  pass "모든 200/201/202 응답에 meta 포함"
else
  while IFS= read -r line; do
    [ -n "$line" ] && fail "envelope meta 누락 — $line"
  done <<< "$viol"
fi

# ─── 5. ProjectDocument 핵심 컬럼 drift ───────────────────────
section "5. ProjectDocument 핵심 컬럼 drift (DDL ↔ 14 ↔ 16)"
check_field() {
  local label="$1" db_pat="$2" if_pat="$3" api_pat="$4"
  # grep -E 결과 줄 수만 — wc -l 로 single integer 보장
  local in_db in_if in_api
  in_db=$(grep -E "$db_pat" 06-DATA-MODEL.md 2>/dev/null | wc -l | tr -d ' ')
  in_if=$(grep -E "$if_pat" 14-INTERFACES.md 2>/dev/null | wc -l | tr -d ' ')
  in_api=$(grep -E "$api_pat" 16-API-CONTRACT.md 2>/dev/null | wc -l | tr -d ' ')
  if [ "$in_db" -gt 0 ] && [ "$in_if" -gt 0 ] && [ "$in_api" -gt 0 ]; then
    pass "$label (DB=$in_db, 14=$in_if, 16=$in_api)"
  else
    fail "$label drift — DB=$in_db, 14=$in_if, 16=$in_api"
  fi
}
check_field "mime_type/mimeType"      "mime_type"        "mimeType"      "mimeType"
check_field "s3_key/s3Key"            "s3_key"           "s3Key"         "s3Key"
check_field "created_by/createdBy"    "created_by"       "createdBy"     "createdBy"
check_field "failure_reason/failureReason"  "failure_reason" "failureReason" "failureReason"
check_field "index_status/indexStatus"  "index_status"     "indexStatus"   "indexStatus"

# ─── 6. storage_kind / storageKind / StorageKind 모든 표기에서 'db' legacy 검출 ──────
section "6. storage_kind enum 통일 (DDL CHECK ↔ TS literal ↔ Zod enum)"
# 검사 대상 (확장): DDL CHECK, TS `"db"|"s3"` literal, Zod `z.enum(["db", ...])`.
db_kind_legacy=$(grep -nE "(storage_kind.*'db'|storage_kind IN .*'db'|storageKind.*\"db\"|StorageKind = z\.enum\(\[\"db\")" \
  06-DATA-MODEL.md 16-API-CONTRACT.md 14-INTERFACES.md 2>/dev/null \
  | grep -v 'legacy\|이전\|이전 표기' || true)
if [ -n "$db_kind_legacy" ]; then
  echo "$db_kind_legacy" | while read -r line; do fail "storage_kind 'db' (legacy) 잔존 — $line"; done
else
  pass "storage_kind = inline|s3 단일 출처 (DDL CHECK + TS literal + Zod enum)"
fi

# ─── 7. ChatEvent ↔ SSE event 의 type 멤버 일치 ──────────────
section "7. ChatEvent (14) ↔ SSE event (16) type 멤버"
# 16 의 'event: <name>' SSE 라인에서 type 추출
sse_types=$(grep -E "^\s+event: [a-z_]+$" 16-API-CONTRACT.md 2>/dev/null | sed 's/.*event: //' | sort -u)
# 14 의 ChatEvent union 의 'type: "X"' 추출
chat_types=$(grep -oE 'type: "[a-z_]+"' 14-INTERFACES.md 2>/dev/null | sed 's/type: "//;s/"$//' | sort -u)
missing=$(comm -23 <(echo "$sse_types") <(echo "$chat_types"))
if [ -z "$missing" ]; then
  pass "SSE event 모두 ChatEvent 에 정의됨"
else
  for m in $missing; do fail "SSE event '$m' 가 ChatEvent 에 없음"; done
fi

# ─── 8. DDL 중복 CREATE INDEX 검사 (fresh DB 안전성) ──────────
section "8. DDL 중복 CREATE INDEX (fresh run 안전)"
# 같은 인덱스명을 두 개 이상 마이그레이션에서 unconditional CREATE INDEX 하면 fresh DB 가 두 번째에서 fail.
dup_idx=$(grep -E "^CREATE INDEX [a-z_]+" 06-DATA-MODEL.md 2>/dev/null \
  | sed 's/^CREATE INDEX \(IF NOT EXISTS \)*\([a-z_]*\).*/\2/' \
  | sort | uniq -d)
if [ -z "$dup_idx" ]; then
  pass "중복 unconditional CREATE INDEX 없음"
else
  for d in $dup_idx; do
    # IF NOT EXISTS 가 있는 경우는 OK (idempotent).
    bad=$(grep -nE "^CREATE INDEX $d\s|^CREATE INDEX $d\(" 06-DATA-MODEL.md 2>/dev/null | grep -v "IF NOT EXISTS")
    if [ -n "$bad" ]; then fail "duplicate INDEX without IF NOT EXISTS: $d"; fi
  done
fi

# ─── 9. Repo membership ↔ DataAccess 일치 ──────────────────────
section "9. Repo 인터페이스 (14) ↔ DataAccess 멤버 (14)"
# 14 안에서 "export interface FooRepo" 가 있으면 DataAccess 본체에 멤버로 등록되어야.
declared_repos=$(grep -oE "export interface [A-Z][a-zA-Z]+Repo\b" 14-INTERFACES.md 2>/dev/null | awk '{print $3}' | sort -u)
data_access_block=$(awk '/^export interface DataAccess/{f=1} f; /^}/{if(f){exit}}' 14-INTERFACES.md 2>/dev/null)
missing_repo=""
for r in $declared_repos; do
  if ! echo "$data_access_block" | grep -qE ":\s*${r}\b"; then
    missing_repo="$missing_repo $r"
  fi
done
if [ -z "$missing_repo" ]; then
  pass "모든 Repo 가 DataAccess 멤버"
else
  for r in $missing_repo; do fail "$r 가 DataAccess 에 등록 안 됨"; done
fi

# ─── 10. Phase 0.5 (Contract Bootstrap PR) 가 4 doc 에 존재 ────
section "10. Phase 0.5 — 4 doc 에 일관 명시 (build_prompt + 07 + 08 + 10)"
miss=""
for f in build_prompt.md 07-AGENT-TEAMS.md 08-SPRINT-PLAN.md; do
  if ! grep -qE "Phase 0\.5|Contract Bootstrap" "$f" 2>/dev/null; then
    miss="$miss $f"
  fi
done
if [ -z "$miss" ]; then pass "Phase 0.5 모든 doc 에 명시"; else for m in $miss; do fail "Phase 0.5 누락: $m"; done; fi

# ─── 11. JSON 코드블록 parse — T1 canonical files 는 strict fail, 다른 spec 블록은 advisory ──
# T1 canonical: 05-REPO-STRUCTURE.md (package.json, tsconfig 등), 11-DEPLOYMENT.md (task definitions, IAM)
# → copy-paste 시 그대로 실 파일로 변환되므로 strict.
# 다른 *.md 의 json 블록은 spec / 예시 — placeholder 가 많아 advisory.
# 단, 명시적으로 `jsonc` fence (placeholder 허용) 또는 `json-fragment` fence 는 advisory.
section "11. JSON 코드블록 (T1 canonical files = strict, others = advisory)"
STRICT_FILES="05-REPO-STRUCTURE.md 11-DEPLOYMENT.md"
if command -v python3 >/dev/null 2>&1; then
  cat > /tmp/.lint-json-check.py <<'PYEOF'
import json, re, sys
content = open(sys.argv[1]).read()
content = re.sub(r"\{\{[A-Z_]+\}\}", "demo", content)
content = re.sub(r"__[A-Z_]+__", "demo", content)              # __ACCOUNT__, __SHA__ 같은 ECS placeholder
# 라인 시작 부분에서 // 로 시작하는 단독 comment 만 제거 (URL 안의 // 보존)
content = re.sub(r"^\s*//.*$", "", content, flags=re.MULTILINE)
# 라인 끝에 ` //` (공백 + //) comment 만 제거 — URL 의 :// 는 보존
content = re.sub(r"[ \t]+//[^\n]*$", "", content, flags=re.MULTILINE)
content = re.sub(r"\[\.\.\.\]", "null", content)
# <placeholder> → placeholder (no quotes; preserve surrounding string quotes)
content = re.sub(r"<[a-zA-Z_][a-zA-Z0-9_-]*>", "placeholder", content)
content = content.strip()
if not content:
    sys.exit(0)
first = content.lstrip()
if not (first.startswith("{") or first.startswith("[")):
    sys.exit(0)
try:
    json.loads(content)
except json.JSONDecodeError as e:
    sys.stderr.write(f"{e.lineno}: {e.msg}\n")
    sys.exit(1)
PYEOF

  for f in *.md; do
    mkdir -p /tmp/.lint-json-blocks
    rm -f /tmp/.lint-json-blocks/*.json
    # `json` fence 만 추출 (jsonc / json-fragment 는 별도 advisory)
    awk -v outdir="/tmp/.lint-json-blocks" '
      /^```json$/ { idx++; out=outdir "/" idx ".json"; in_block=1; next }
      /^```$/ && in_block { in_block=0; close(out); next }
      in_block { print > out }
    ' "$f"
    fail_count=0
    block_count=0
    is_strict=0
    for sf in $STRICT_FILES; do [ "$f" = "$sf" ] && is_strict=1; done
    for blk in /tmp/.lint-json-blocks/*.json; do
      [ -f "$blk" ] || continue
      block_count=$((block_count+1))
      err=$(python3 /tmp/.lint-json-check.py "$blk" 2>&1) || {
        if [ "$is_strict" = "1" ]; then
          fail "$f JSON block #$(basename "$blk" .json) — $err [strict: T1 canonical file]"
        else
          echo "  ⚠️  $f JSON block #$(basename "$blk" .json) — $err [advisory]"
        fi
        fail_count=$((fail_count+1))
      }
    done
    if [ "$fail_count" -eq 0 ]; then
      label="advisory"; [ "$is_strict" = "1" ] && label="strict"
      pass "$f JSON ($block_count blocks, $label)"
    fi
  done
else
  echo "  (python3 미설치 — skip)"
fi

# ─── 12. scripts/ 참조 — 본문 또는 실 파일 존재 검사 ──────────
section "12. scripts/ 참조 — 본문 코드 또는 실 파일 존재"
referenced=$(grep -hoE 'scripts/[a-zA-Z0-9_.-]+\.(sh|mjs|ts|js)' *.md 2>/dev/null | sort -u)
miss_scripts=""
for s in $referenced; do
  base=$(basename "$s")
  # 다음 중 하나라도 만족하면 OK:
  # (a) rebuild_plan/scripts/<base> 실 파일 존재
  # (b) 본문 코드블록 헤더 (`### `<X>``) 가 base 를 포함
  # (c) 다른 헤더 형태 (예: "scripts/X 본문", "scripts/X (신규)" 등) 도 base 매칭
  # (d) Phase 0 매트릭스에 명시 (build_prompt — Phase 0 가 만들 산출물)
  if [ -f "$s" ] || [ -f "rebuild_plan/$s" ] || [ -f "scripts/$base" ]; then
    continue
  fi
  if grep -qE "(### \`.*${base}\`|scripts/${base}.*\(신규\)|\`${base}\`)" *.md 2>/dev/null; then
    continue
  fi
  # Phase 매트릭스 또는 phase 작업 안의 deliverable 인지 — base 이름이 어떤 문서에든 헤더/문장으로 등장하면 OK.
  if grep -qE "scripts/${base}|${base}\`|--users.*${base}|\`${base}\`" *.md 2>/dev/null; then
    continue
  fi
  miss_scripts="$miss_scripts $s"
done
if [ -z "$miss_scripts" ]; then
  pass "모든 scripts/ 참조 본문/파일 존재 (또는 본문 헤더로 명세)"
else
  for m in $miss_scripts; do fail "missing script body/file: $m"; done
fi

# ─── 13. branch convention 통일 (team-prefixed) ────────────────
section "13. branch 명명 — <team>/<phase>/<topic> 단일 출처"
# 10-DEV-WORKFLOW 가 team-prefixed 패턴을 single source 로 명시하는지.
if grep -qE 't<N>-<team>/phase|t1-platform/phase|team.*phase.*topic' 10-DEV-WORKFLOW.md 2>/dev/null; then
  pass "10-DEV-WORKFLOW 에 team-prefixed branch 명시"
else
  fail "10-DEV-WORKFLOW 에 <team>/<phase>/<topic> 패턴 명시 누락"
fi

# ─── 14. deploy.sh fail-closed 정책 (env-account 검증 + placeholder secret 거부) ──
section "14. deploy.sh fail-closed (env=account 검증 + placeholder secret 거부)"
if grep -qE "EXPECTED_ACCOUNT|expected account" 11-DEPLOYMENT.md 2>/dev/null \
   && grep -qE "PLACEHOLDER_PLEASE_REPLACE|placeholder.*거부" 11-DEPLOYMENT.md 2>/dev/null; then
  pass "deploy.sh 가 env-account 검증 + placeholder secret 거부 명시"
else
  fail "deploy.sh 의 fail-closed 정책 (env=account + placeholder secret 거부) 일부 누락"
fi

# ─── 14b. rollback 의 known-good 정책 ────────────────────────
section "14b. rollback known-good revision (revision-1 추측 금지)"
if grep -qE "last-known-good|known-good revision" 15-CI-PIPELINE.md 11-DEPLOYMENT.md 2>/dev/null; then
  pass "rollback known-good 명시"
else
  fail "rollback 이 known-good 미사용 (revision-1 추측 위험)"
fi

# ─── 14u. rollback known-good key shape 일관 ──────────────────
section "14u. rollback known-good key shape (smoke put 와 rollback get 의 short svc name)"
# smoke put: `/${PROJECT}/${ENV}/last-known-good/${SHORT}` (server/web/converter-worker)
# rollback get: 같은 key shape 여야. full FAMILY 명 (project-env-svc) 사용 시 mismatch.
mismatch=$(grep -nE 'PARAM=.*last-known-good/\$\{SVC\}' 15-CI-PIPELINE.md 2>/dev/null \
  | grep -v "SHORT" || true)
if [ -z "$mismatch" ]; then
  pass "known-good key shape = short svc name (smoke put 와 rollback get 일관)"
else
  echo "$mismatch" | while read -r l; do fail "rollback key shape drift — $l"; done
fi

# ─── 14v. Contract Bootstrap 산출물 수 — "15 파일 (12 contract + 3 barrel)" 통일 ──
section "14v. Contract Bootstrap manifest — 12/15 표기 일관"
plain_12=$(grep -E "12 contract" build_prompt.md 07-AGENT-TEAMS.md 08-SPRINT-PLAN.md 2>/dev/null \
  | grep -v "15 파일\|12 contract + index" \
  | grep -v "12 개 인터페이스" \
  || true)
if [ -z "$plain_12" ]; then
  pass "Contract Bootstrap 산출물 = '15 파일 (12 contract + barrel)' 일관"
else
  echo "$plain_12" | while read -r l; do fail "12 contract 만 표기 (15 파일 명시 부족) — $l"; done
fi

# ─── 14r. active-run state DB enum 통일 (4-state — pending/running/cancelled/completed) ──
section "14r. active-run state DB enum 4-state 통일 (16 의 MessageRun 도 4-state 매핑)"
# 06/14 = 4 값, 16 도 그 매핑 명시되어 있어야.
db_4state=$(grep -E "pending.*running.*cancelled.*completed" 06-DATA-MODEL.md 14-INTERFACES.md 2>/dev/null | wc -l | tr -d ' ')
ms_16=$(grep -c "DB.*sessions_active_runs.status.*CHECK constraint = single source\|DB CHECK 가 4 값" 16-API-CONTRACT.md 2>/dev/null | head -1 | tr -d ' ')
if [ "$db_4state" -ge 2 ] && [ "$ms_16" -ge 1 ]; then
  pass "active-run = 4-state, 16 MessageRun 이 DB 4-state 와 매핑"
else
  fail "active-run state drift (DB=$db_4state, 16-mapping=$ms_16)"
fi

# ─── 14s. CI 의 docker-build ECR 가 env 별 분리 ────────────────
section "14s. docker-build 가 env 별 ECR registry 분리 (staging vs prod)"
if grep -qE "ECR_REGISTRY_STAGING|ECR_REGISTRY_PROD" 15-CI-PIPELINE.md 2>/dev/null; then
  pass "ECR_REGISTRY_{STAGING,PROD} 분리"
else
  fail "ECR registry 가 env 무관 단일 — staging/prod account 분리 안 됨"
fi

# ─── 14t. first-deploy 가 setup-infra 직후 자동 실행 안 함 ─────
section "14t. first-deploy 가 setup-infra 후 secret-fill gate 거쳐 manual trigger"
# staging / prod 모두 setup-infra-* + first-deploy-* 두 manual job 으로 분리되어야 함.
if grep -qE "^first-deploy-(staging|prod):" 15-CI-PIPELINE.md 2>/dev/null && \
   grep -qE "^setup-infra-(staging|prod):" 15-CI-PIPELINE.md 2>/dev/null; then
  pass "first-deploy 가 별도 manual job (staging + prod 모두 setup-infra + first-deploy 분리)"
else
  fail "first-deploy 가 setup-infra 직후 auto-run — placeholder secret 거부에서 막힘"
fi

# ─── 14p. RDS/ElastiCache wait 명시 ───────────────────────────
section "14p. setup-infra 의 RDS/Cache wait (endpoint 조회 전)"
if grep -qE "aws rds wait db-instance-available|aws elasticache wait cache-cluster-available" 11-DEPLOYMENT.md 2>/dev/null; then
  pass "setup-infra 가 RDS/ElastiCache wait 호출 후 endpoint 사용"
else
  fail "setup-infra 가 wait 없이 endpoint 조회 — 신규 생성 시 ''로 fallback 가능"
fi

# ─── 14q. ChatSsePayload 14 export ────────────────────────────
section "14q. ChatSsePayload<E> export (14)"
if grep -qE "export type ChatSsePayload" 14-INTERFACES.md 2>/dev/null; then
  pass "ChatSsePayload<E> export 명시"
else
  fail "ChatSsePayload<E> 가 14 에 export 안 됨 (16 § SSE wire 가 참조)"
fi

# ─── 14l. preflight bootstrap/deploy mode 분리 ────────────────
section "14l. preflight bootstrap/deploy mode 분리 (setup vs deploy 차이)"
if grep -qE "MODE=.*bootstrap|preflight\.sh.*bootstrap|aws-preflight.*bootstrap" 11-DEPLOYMENT.md 2>/dev/null; then
  pass "preflight mode 분리 명시 (setup-infra 가 secret 생성자, deploy 가 소비자)"
else
  fail "preflight mode 분리 부재 — setup-infra 가 placeholder secret 거부에서 막힘 가능"
fi

# ─── 14m. CODEOWNERS section 단위 approval ─────────────────────
section "14m. CODEOWNERS shared/interfaces 7-owner section 분리"
if grep -qE "\[Shared-Leads\]|\[Shared-Platform\]" 05-REPO-STRUCTURE.md 2>/dev/null; then
  pass "CODEOWNERS 가 7 section 으로 분리 (GitLab section-level approval)"
else
  fail "CODEOWNERS 의 shared/interfaces 가 한 줄 다중 owner — GitLab 에선 1 approval 만 강제"
fi

# ─── 14n. red-test-allowed 가 integration/main 차단 ────────────
section "14n. red-test-allowed → integration/phase-* / main 차단"
if grep -qE "CI_MERGE_REQUEST_TARGET_BRANCH_NAME.*integration" 15-CI-PIPELINE.md 2>/dev/null; then
  pass "red-test-allowed 가 integration/main target 에서 차단"
else
  fail "red-test-allowed 가 integration/main target 으로 오염 가능"
fi

# ─── 14o. CI diff base = MR diff base (not origin/main) ────────
section "14o. CI diff base = MR diff base (integration target 안전성)"
if grep -qE "CI_MERGE_REQUEST_DIFF_BASE_SHA" 15-CI-PIPELINE.md 2>/dev/null; then
  pass "CI diff base = MR diff base 사용"
else
  fail "CI 가 origin/main..HEAD 만 — integration target MR 에서 다른 commit 까지 포함"
fi

# ─── 14j. aws-preflight 가 모든 AWS mutation script 에서 호출됨 ─
section "14j. aws-preflight 모든 AWS mutation script 에서 호출"
if grep -qE "aws-preflight\.sh" 11-DEPLOYMENT.md 2>/dev/null; then
  pass "aws-preflight.sh 존재 + setup-infra 등에서 호출"
else
  fail "aws-preflight 부재 — first-deploy/setup-infra 가 fail-closed 가드 우회 가능"
fi

# ─── 14k. EMAIL_SENDER_KIND enum 5 값 일관 (env + 16) ─────────
section "14k. EMAIL_SENDER_KIND enum 5 값 (console/ses/smtp/test/noop)"
env_enum=$(grep -E "EMAIL_SENDER_KIND.*z\.enum" 05-REPO-STRUCTURE.md 2>/dev/null | head -1)
if echo "$env_enum" | grep -q "test" && echo "$env_enum" | grep -q "noop"; then
  pass "EMAIL_SENDER_KIND 5 값 (test/noop 포함)"
else
  fail "EMAIL_SENDER_KIND enum 이 16 의 test/noop 누락 — drift"
fi

# ─── 14g. Phase 0 acceptance 가 worker:8000 의존 안 함 (worker Phase 4) ──
section "14g. Phase 0 acceptance — worker:8000 의존 금지 (worker 는 Phase 4)"
worker_in_phase0=$(grep -nE "localhost:8000.*health" 08-SPRINT-PLAN.md 2>/dev/null \
  | grep -v "Phase 4\|Phase 0 = Node only" || true)
if [ -z "$worker_in_phase0" ]; then
  pass "Phase 0 onboarding 이 worker:8000 의존하지 않음"
else
  echo "$worker_in_phase0" | while read -r l; do fail "Phase 0 onboarding 이 worker:8000 요구 — $l"; done
fi

# ─── 14h. known-good 기록이 smoke job 안에 wiring 됨 ──────────
section "14h. known-good 기록 — smoke job 안에 실제 wiring"
if grep -qE "put-parameter.*last-known-good" 15-CI-PIPELINE.md 2>/dev/null; then
  pass "smoke job 안에 SSM put-parameter (known-good) wiring"
else
  fail "known-good 기록이 prose 만 — smoke job 안의 실 명령 부재"
fi

# ─── 14i. api-contract-check Phase 0.5 gating ────────────────
section "14i. api-contract-check rules — Phase 0.5 산출물 조건부"
if grep -qE "openapi\.ts$|api-types\.generated\.ts" 15-CI-PIPELINE.md 2>/dev/null \
   && grep -qE "exists:" 15-CI-PIPELINE.md 2>/dev/null; then
  pass "api-contract-check 가 Phase 0.5 산출물 exists 조건부"
else
  fail "api-contract-check 가 Phase 0 PR 에서 fail 가능 (openapi.ts 미존재 검사 부재)"
fi

# ─── 14d. Phase 0 T2~T6 의 shared/interfaces 본문 작성 금지 ────
section "14d. Phase 0 의 T2~T6 가 packages/shared|interfaces 본문 작성 안 해야"
if grep -qE "packages/shared.*첫 인터페이스|packages/interfaces.*첫 인터페이스|packages/shared.*placeholder.*Phase 0" 08-SPRINT-PLAN.md 2>/dev/null; then
  fail "08 의 Phase 0 가 T2~T6 에게 shared/interfaces 본문 작성을 요구 — Phase 0.5 단독 owner 와 충돌"
else
  pass "Phase 0 = domain skeleton only, Phase 0.5 = contract bootstrap (소유권 분리)"
fi

# ─── 14e. Phase 0.5 sprint key 존재 ────────────────────────────
section "14e. Phase 0.5 sprint key (v1.0-S00-contract) 등록"
if grep -qE "v1\.0-S00-contract|Phase 0\.5.*Sprint key" 08-SPRINT-PLAN.md 2>/dev/null; then
  pass "Phase 0.5 sprint key 등록"
else
  fail "Phase 0.5 sprint key (v1.0-S00-contract) 가 08 의 Sprint key 표에 없음"
fi

# ─── 14f. artifactKind 표기 통일 (14 + 16) ────────────────────
section "14f. artifact_created — artifactKind 통일 (artifactType drift 차단)"
drift=$(grep -nE "artifactType\b" 14-INTERFACES.md 16-API-CONTRACT.md 2>/dev/null \
  | grep -v 'drift\|이전 표기\|legacy' || true)
if [ -z "$drift" ]; then
  pass "artifact_created.artifactKind 단일 표기"
else
  echo "$drift" | while read -r l; do fail "artifactType (legacy) 잔존 — $l"; done
fi

# ─── 14c. citation marker drift ──────────────────────────────
section "14c. citation marker 통일 ([N] 형태)"
old_cite=$(grep -nE '\[\^cite-N\]|\[\^cite' 16-API-CONTRACT.md 17-PROMPT-ASSETS.md 18-FRONTEND-WIREFRAMES.md 14-INTERFACES.md 2>/dev/null \
  | grep -v "이전\|legacy\|drift" || true)
if [ -z "$old_cite" ]; then
  pass "citation marker = [N] 단일 출처"
else
  echo "$old_cite" | while read -r l; do fail "old citation marker — $l"; done
fi

# ─── 15. Phase 0 vs Phase 0.5 의 contract 소유권 단일 ────────
section "15. Phase 0 vs 0.5 contract 소유권 (interfaces 본문은 Phase 0.5 단독)"
# Phase 0 매트릭스가 `packages/interfaces/src/*.ts` 의 12 contract 본문 생성을 요구하면 drift.
# Phase 0 는 빈 barrel (index.ts) 또는 shell 만 OK.
phase0_full_contract=$(grep -E "\| 6 \|.*packages/interfaces/src/\*\.ts.*12개 contract" build_prompt.md 2>/dev/null | grep -v "빈 barrel\|shell 만\|시그니처만, 빈 본문" || true)
if [ -n "$phase0_full_contract" ]; then
  fail "Phase 0 매트릭스가 interfaces 12 contract 본문 생성 요구 (Phase 0.5 와 중복) — $phase0_full_contract"
else
  pass "Phase 0 = shell, Phase 0.5 = 12 contract 본문 (소유권 분리)"
fi

# ─── 16. ChatEvent ↔ SSE event 1:1 (HITL 포함) ────────────────
section "16. ChatEvent union 모든 type 이 16-API-CONTRACT 의 SSE event 라인에 존재"
# 14 의 ChatEvent union 에서 `type: "..."` 를 grep + sed 로 추출 → 16 의 'event:' 와 매칭.
# (gawk 의 3-arg match 는 macOS awk 미지원이므로 sed 로 대체.)
chat_types=$(sed -n '/^export type ChatEvent =/,/^[[:space:]]*| { type: "error"/p' 14-INTERFACES.md \
  | grep -oE 'type: "[a-z_]+"' | sed -E 's/type: "(.+)"/\1/' | sort -u)
missing_sse=""
for t in $chat_types; do
  grep -qE "^[[:space:]]*event:[[:space:]]*$t\b" 16-API-CONTRACT.md || missing_sse="$missing_sse $t"
done
chat_count=$(echo "$chat_types" | grep -c . || true)
if [ -z "$missing_sse" ] && [ "$chat_count" -ge 8 ]; then
  pass "ChatEvent ↔ SSE event 1:1 — $chat_count type 매칭"
elif [ "$chat_count" -lt 8 ]; then
  fail "ChatEvent type 추출 실패 — count=$chat_count (예상 ≥ 8)"
else
  fail "ChatEvent 의 type 이 SSE event 라인에 없음:$missing_sse"
fi

# ─── 17. share API 분리 (metadata + content 두 endpoint) ──────
section "17. share API metadata + content endpoint 분리"
share_meta=$(grep -cE "^### .GET /api/v1/share/:token. \(metadata" 16-API-CONTRACT.md || true)
share_content=$(grep -cE "^### .GET /api/v1/share/:token/content" 16-API-CONTRACT.md || true)
if [ "$share_meta" -ge 1 ] && [ "$share_content" -ge 1 ]; then
  pass "share API 가 metadata + content 두 endpoint 로 분리 (JSON envelope + binary)"
else
  fail "share API 분리 누락 — metadata=$share_meta content=$share_content (각각 1 이상 필요)"
fi

# ─── 18. apply-project-vars fail-closed (config 미존재 시 즉시 실패) ──────
section "18. apply-project-vars.sh — config 인자 있지만 파일 없으면 fail-closed"
if grep -qE "config 파일 없음.*오타 의심" scripts/apply-project-vars.sh && \
   grep -qE "config 파일 인자 또는 ENV_MODE=1" scripts/apply-project-vars.sh; then
  pass "apply-project-vars.sh 가 YAML 인자 fail-closed + ENV_MODE 명시 요구"
else
  fail "apply-project-vars.sh 가 missing config 를 silent env fallback 으로 처리 — 오타 위험"
fi

# ─── 19. LLM agent 권한 표 (build_prompt 단일 출처) ──────────
section "19. LLM agent 권한 표 — build_prompt + 10-DEV-WORKFLOW 단일 출처"
agent_perm=$(grep -cE "^### LLM agent 권한 표" build_prompt.md || true)
if [ "$agent_perm" -ge 1 ]; then
  pass "build_prompt 에 LLM agent 권한 표 존재 — Tier A/B PR merge, push, deploy, secret 변경 등 명시"
else
  fail "build_prompt 에 LLM agent 권한 표 없음 — 자율 권한 vs 인간 승인 경계 모호"
fi

# ─── 20. HitlBridge / HITL event 단일 출처 정합성 ────────────
section "20. HitlBridge HitlDecision kind ↔ ChatEvent hitl_resolved decision 일치"
# HitlDecision 의 kind: "approved"|"denied"|"timeout"  →  ChatEvent 는 hitl_resolved (approved|denied) + hitl_timeout 별 event
hitl_resolved_in_14=$(grep -cE 'type: "hitl_resolved"' 14-INTERFACES.md || true)
hitl_timeout_in_14=$(grep -cE 'type: "hitl_timeout"' 14-INTERFACES.md || true)
if [ "$hitl_resolved_in_14" -ge 1 ] && [ "$hitl_timeout_in_14" -ge 1 ]; then
  pass "14 § ChatEvent 가 hitl_resolved + hitl_timeout 분리 emit (HitlDecision.kind 3 값 모두 표현)"
else
  fail "14 § ChatEvent 의 hitl_resolved/hitl_timeout 누락 — resolved=$hitl_resolved_in_14 timeout=$hitl_timeout_in_14"
fi

# ─── 21. ephemeral_chunks ↔ EphemeralChunk 필드 정합성 ──────
section "21. ephemeral_chunks 의 page_number / metadata 컬럼 ↔ EphemeralChunk TS interface"
ec_page_db=$(grep -c "page_number INT" 06-DATA-MODEL.md || true)
ec_page_ts=$(grep -c "pageNumber: number" 14-INTERFACES.md || true)
ec_meta_db=$(grep -c "metadata JSONB.*ephemeral\|metadata JSONB NOT NULL DEFAULT" 06-DATA-MODEL.md || true)
ec_meta_ts=$(grep -cE "metadata: Record<string, unknown>" 14-INTERFACES.md || true)
if [ "$ec_page_db" -ge 1 ] && [ "$ec_page_ts" -ge 1 ] && [ "$ec_meta_db" -ge 1 ] && [ "$ec_meta_ts" -ge 1 ]; then
  pass "ephemeral_chunks page_number/metadata ↔ EphemeralChunk pageNumber/metadata 정합"
else
  fail "ephemeral_chunks ↔ EphemeralChunk drift — page_db=$ec_page_db page_ts=$ec_page_ts meta_db=$ec_meta_db meta_ts=$ec_meta_ts"
fi

# ─── 22. pnpm --filter 는 scoped name 사용 ──────────────────
section "22. pnpm --filter 는 scoped name (@PROJECT/SVC) 사용"
# 짧은 name (server/web/shared/interfaces) 단독 사용 적발. 단, '@{{PROJECT_SLUG}}/...' 접두는 제외.
short_filter=$(grep -nE "pnpm --filter (server|web|shared|interfaces)\b" *.md 2>/dev/null | grep -v "@.*/" || true)
if [ -z "$short_filter" ]; then
  pass "pnpm --filter 모든 사용처가 scoped name (@PROJECT/SVC)"
else
  echo "$short_filter" | while read -r l; do fail "pnpm --filter short name drift — $l"; done
fi

# ─── 23. Phase 0.5 author vs approval 구분 명시 ───────────────
section "23. Phase 0.5 PR author (단일) vs merge approval (Tier B 7-owner) 구분"
# 본 layer 가 모순으로 오해되는 경우가 빈번 → "author vs approval (반복 질문 차단)" 마커 존재 확인
author_marker_07=$(grep -cE "author vs approval|PR author = integration owner.*1 명" 07-AGENT-TEAMS.md || true)
author_marker_14=$(grep -cE "author vs approval|PR author = integration owner.*1 명" 14-INTERFACES.md || true)
if [ "$author_marker_07" -ge 1 ] && [ "$author_marker_14" -ge 1 ]; then
  pass "07/14 모두에 author vs approval 구분 명시 (반복 질문 차단)"
else
  fail "Phase 0.5 author vs approval 구분 누락 — 07=$author_marker_07 14=$author_marker_14 (각 ≥ 1)"
fi

# ─── 24. auth tables (magic_link_tokens / refresh_token_families) Repo 정합 ──
section "24. auth tables 가 DataAccess facade 에 등록"
auth_repos_dataaccess=$(grep -cE "magicLinkTokens: MagicLinkTokenRepo|refreshTokenFamilies: RefreshTokenFamilyRepo" 14-INTERFACES.md || true)
auth_repo_defs=$(grep -cE "export interface (MagicLinkTokenRepo|RefreshTokenFamilyRepo)" 14-INTERFACES.md || true)
if [ "$auth_repos_dataaccess" -ge 2 ] && [ "$auth_repo_defs" -ge 2 ]; then
  pass "magicLinkTokens + refreshTokenFamilies 가 DataAccess + Repo 정의 모두 존재"
else
  fail "auth Repo 등록 누락 — facade=$auth_repos_dataaccess defs=$auth_repo_defs (각각 ≥ 2)"
fi

# ─── 25. message_replace event (stop reason='tool_use' resume) 정합 ─────────
section "25. message_replace event ↔ stop reason='tool_use' resume semantics"
mr_in_14=$(grep -cE 'type: "message_replace"' 14-INTERFACES.md || true)
mr_in_16=$(grep -cE "^[[:space:]]*event:[[:space:]]*message_replace" 16-API-CONTRACT.md || true)
stop_semantics=$(grep -cE "stop. event reason 4값 의미|stop reason='tool_use' 흐름" 16-API-CONTRACT.md || true)
if [ "$mr_in_14" -ge 1 ] && [ "$mr_in_16" -ge 1 ] && [ "$stop_semantics" -ge 1 ]; then
  pass "message_replace 14+16 + stop reason 4값 의미표 정합"
else
  fail "message_replace/stop semantics drift — 14=$mr_in_14 16=$mr_in_16 semantics=$stop_semantics"
fi

# ─── 26. Record↔DTO mapper file naming convention 명시 ──────────
section "26. Record↔DTO mapper naming convention 명시 (apps/server/src/mappers/<entity>-mapper.ts)"
mapper_naming=$(grep -cE "apps/server/src/mappers/<entity>-mapper.ts|mappers/\*-mapper.ts|<entity>RecordToDto" 14-INTERFACES.md || true)
if [ "$mapper_naming" -ge 1 ]; then
  pass "Record↔DTO mapper naming convention 명시"
else
  fail "Record↔DTO mapper naming 누락 — 명시 필요"
fi

# ─── 27. FALLBACK_LLM_PROVIDERS — 변수 등록 + apply-project-vars wiring ──
section "27. FALLBACK_LLM_PROVIDERS 변수 등록 + apply-project-vars substitution wiring"
fb_var=$(grep -c "FALLBACK_LLM_PROVIDERS" 00a-PROJECT-VARIABLES.md || true)
fb_yaml_map=$(grep -cE "llm.fallback_providers\)[[:space:]]+echo FALLBACK_LLM_PROVIDERS" scripts/apply-project-vars.sh || true)
fb_default=$(grep -cE 'export FALLBACK_LLM_PROVIDERS=' scripts/apply-project-vars.sh || true)
fb_subst=$(grep -cE 'FALLBACK_LLM_PROVIDERS\\}\\}/\$ENV\{FALLBACK_LLM_PROVIDERS\}' scripts/apply-project-vars.sh || true)
if [ "$fb_var" -ge 1 ] && [ "$fb_yaml_map" -ge 1 ] && [ "$fb_default" -ge 1 ] && [ "$fb_subst" -ge 1 ]; then
  pass "FALLBACK_LLM_PROVIDERS 4-way wiring 모두 존재 (var/yaml_map/default/subst)"
else
  fail "FALLBACK_LLM_PROVIDERS wiring 누락 — var=$fb_var yaml=$fb_yaml_map default=$fb_default subst=$fb_subst"
fi

# ─── 28. Phase 0 dev-self-check gate (env.local + db:migrate + curl health) ─
section "28. Phase 0 acceptance 에 dev-self-check gate (env.local.example + db:migrate + curl health)"
env_local_example=$(grep -cE "\.env\.local\.example" build_prompt.md || true)
db_migrate_gate=$(grep -cE "pnpm --filter @\{\{PROJECT_SLUG\}\}/server db:migrate" build_prompt.md || true)
curl_health=$(grep -cE "curl -sf http://localhost:4000/health" build_prompt.md || true)
if [ "$env_local_example" -ge 2 ] && [ "$db_migrate_gate" -ge 1 ] && [ "$curl_health" -ge 1 ]; then
  pass "Phase 0 dev-self-check gate (env.local.example + db:migrate + health curl) 모두 존재"
else
  fail "Phase 0 dev-self-check gate 누락 — env_local=$env_local_example migrate=$db_migrate_gate curl=$curl_health"
fi

# ─── 29. .env.local.example 의 DATABASE_URL ↔ docker-compose user/pass/db 일치 ─
section "29. .env.local.example DATABASE_URL ↔ docker-compose.local.yml user/pass/db 일치"
env_local_url=$(grep -E "^DATABASE_URL=postgres://" 11-DEPLOYMENT.md 2>/dev/null | grep -E "localhost:5432|localhost:15432" | head -3)
compose_user=$(grep -E "POSTGRES_USER:" 11-DEPLOYMENT.md | head -1 | awk '{print $NF}')
compose_pass=$(grep -E "POSTGRES_PASSWORD:" 11-DEPLOYMENT.md | head -1 | awk '{print $NF}')
compose_db=$(grep -E "POSTGRES_DB:" 11-DEPLOYMENT.md | head -1 | awk '{print $NF}')
# .env.local.example block 안의 DATABASE_URL 추출 (시나리오 B 의 docker-compose 호환)
local_db_url=$(grep -A 30 "^### \`.env.local.example\`" 11-DEPLOYMENT.md | grep "^DATABASE_URL=postgres://" | head -1)
if echo "$local_db_url" | grep -q "${compose_user}:${compose_pass}@localhost:5432/${compose_db}"; then
  pass ".env.local.example DATABASE_URL ↔ compose (user=$compose_user pass=$compose_pass db=$compose_db) 일치"
else
  fail ".env.local.example vs compose drift — compose=${compose_user}:${compose_pass}@localhost:5432/${compose_db}, env.local.example=$local_db_url"
fi

# ─── 30. Phase 0.5 owned_paths ↔ 07 산출물 표 정합 ────────────
section "30. Phase 0.5 owned_paths (08) ↔ 07 § Phase 0.5 산출물 표 정합"
# 8 산출물: shared/, interfaces/, openapi.ts, generate-openapi.ts, errors.ts, envelope.ts, api-client.ts, CODEOWNERS
expected=(packages/shared packages/interfaces "openapi.ts" "generate-openapi.ts" "errors.ts" "envelope.ts" "api-client.ts" "CODEOWNERS")
missing=""
for path in "${expected[@]}"; do
  grep -q "$path" 08-SPRINT-PLAN.md 2>/dev/null || missing="$missing $path"
done
if [ -z "$missing" ]; then
  pass "Phase 0.5 owned_paths 8 항목 모두 등록 (08 SPRINT-PLAN)"
else
  fail "Phase 0.5 owned_paths 누락:$missing"
fi

# ─── 31. MagicLink / RefreshTokenFamily Record ↔ DDL 컬럼 정합 ─
section "31. MagicLinkTokenRecord/RefreshTokenFamilyRecord ↔ DDL 컬럼 정합 (06 § 0012/0013)"
# DDL token_hash PK → Record tokenHash 가 PK 역할 (id 필드 없음)
mlt_no_id_field=$(grep -cE "^  id: string;" 14-INTERFACES.md || true)   # 누락 검증은 어렵음 — Record 안에 'tokenHash' 가 PK 마커
mlt_tokenhash=$(grep -cE "tokenHash: string;\s*// PRIMARY KEY" 14-INTERFACES.md || true)
rtf_familyid=$(grep -cE "familyId: string;\s*// PRIMARY KEY" 14-INTERFACES.md || true)
rtf_generation=$(grep -cE "currentGeneration: number" 14-INTERFACES.md || true)
rtf_revoke_reason=$(grep -cE 'revokeReason: "theft_suspected"' 14-INTERFACES.md || true)
if [ "$mlt_tokenhash" -ge 1 ] && [ "$rtf_familyid" -ge 1 ] && [ "$rtf_generation" -ge 1 ] && [ "$rtf_revoke_reason" -ge 1 ]; then
  pass "auth Record 4 필드 (tokenHash PK / familyId PK / currentGeneration / revokeReason enum) DDL 1:1"
else
  fail "auth Record DDL drift — mlt_tokenhash=$mlt_tokenhash rtf_familyid=$rtf_familyid rtf_gen=$rtf_generation rtf_reason=$rtf_revoke_reason"
fi

# ─── 32. ProjectDocument DTO 가 server-only 필드 (s3Key) 노출 안 함 ──
section "32. ProjectDocument Zod DTO 가 server-only s3Key 노출 안 함"
# Zod block 안에 s3Key 가 들어있으면 fail. 단, 주석 'server-only' 가 있는 라인은 OK.
s3key_leak=$(awk '/^export const ProjectDocument = z.object\(\{/,/^\}\);/' 16-API-CONTRACT.md \
  | grep "s3Key:" | grep -v "^[[:space:]]*//" || true)
if [ -z "$s3key_leak" ]; then
  pass "ProjectDocument DTO 가 s3Key 노출 안 함"
else
  fail "ProjectDocument DTO 가 s3Key 노출 — $s3key_leak"
fi

# ─── 33. /auth/me 응답 ↔ frontend AppContext user+org 정합 ─────
section "33. /auth/me 응답이 user + org 동시 제공 (18 § AppContext bootstrap)"
authme_org=$(grep -cE "org: \{" 16-API-CONTRACT.md || true)   # /auth/me block 안에 org 객체 있어야 함
authme_dto_table=$(grep -cE "AuthMeResponse.*user: User.*org: Organization" 16-API-CONTRACT.md || true)
if [ "$authme_dto_table" -ge 1 ] && [ "$authme_org" -ge 1 ]; then
  pass "/auth/me 가 user + org 동시 응답 (18 § AppContext 정합)"
else
  fail "/auth/me 가 user 만 반환 — org 누락. authme_org=$authme_org table=$authme_dto_table"
fi

# ─── 34. replay endpoint 정의 존재 (stop reason='tool_use' resume) ───
section "34. /sessions/:id/messages/:messageId/stream replay endpoint 정의 존재"
replay_endpoint=$(grep -cE "^### \`GET /sessions/:id/messages/:messageId/stream\`" 16-API-CONTRACT.md || true)
if [ "$replay_endpoint" -ge 1 ]; then
  pass "replay endpoint 정의 존재 (stop reason='tool_use' resume 흐름)"
else
  fail "replay endpoint 누락 — stop reason='tool_use' 후 resume 흐름 미완성"
fi

# ─── 35. pre-deploy expand migration (deploy.sh 안에서 service update 전 호출) ───
section "35. deploy.sh 코드블록 안에서 service update **전** expand migrate 호출 (배포 후 schema drift 차단)"
# 부록 C 의 deploy.sh 코드블록 (v1.0 기준 본문) 만 검사. 다른 절 (Rollback 절차, first-deploy 등) 의 update-service 는 무시.
deploy_block=$(awk '/^### v1.0 기준 본문 \(수정됨\)/,/^### deploy.sh 끝의 known-good 기록/' 11-DEPLOYMENT.md)
migrate_pos=$(echo "$deploy_block" | grep -n "pnpm db:migrate:expand" | head -1 | cut -d: -f1)
update_pos=$(echo "$deploy_block" | grep -n "aws ecs update-service" | head -1 | cut -d: -f1)
if [ -n "$migrate_pos" ] && [ -n "$update_pos" ] && [ "$migrate_pos" -lt "$update_pos" ]; then
  pass "deploy.sh: db:migrate:expand 가 update-service 전에 호출 (one-off ECS task)"
else
  fail "deploy.sh: migrate 가 update-service 전에 호출되지 않음 — 새 코드가 옛 schema 위에서 서빙 위험 (migrate=$migrate_pos update=$update_pos)"
fi

# ─── 37. RAG source enum 단일 (citation event ↔ SearchHit 정합) ──────
section "37. RAG source enum — citation event ↔ SearchHit 단일 출처 (project|ephemeral)"
old_enum_citation=$(grep -nE '"upload" \| "project_document"|source: "upload"|source: "project_document"' 14-INTERFACES.md 16-API-CONTRACT.md 2>/dev/null | grep -v "단일 출처\|legacy\|drift" || true)
new_enum_count=$(grep -cE 'source: "project" \| "ephemeral"' 14-INTERFACES.md 16-API-CONTRACT.md 2>/dev/null | grep -v ":0$" | wc -l | awk '{print $1}')
if [ -z "$old_enum_citation" ]; then
  pass "RAG source enum = project|ephemeral 단일 (citation event + SearchHit)"
else
  echo "$old_enum_citation" | while read -r l; do fail "old RAG source enum (upload/project_document) — $l"; done
fi

# ─── 38. /auth/login 응답이 {user, org} (AuthMeResponse 와 동일 shape) ─────
section "38. /auth/login 응답이 AuthMeResponse 와 동일 (user + org)"
# /auth/login block 안에 'org:' field 가 있어야 함 (multi-line 응답)
login_block=$(awk '/^### \`POST \/auth\/login\`/{flag=1; next} /^### /{flag=0} flag' 16-API-CONTRACT.md)
if echo "$login_block" | grep -qE "user: \{" && echo "$login_block" | grep -qE "org:[[:space:]]+\{"; then
  pass "/auth/login 응답이 user + org 동시 (AuthMeResponse 와 동일 shape)"
else
  fail "/auth/login 이 user 만 반환 — /auth/me 와 응답 shape 불일치"
fi

# ─── 39. T1 owned_paths 가 Phase 0.5 protected files 와 겹치지 않음 ────
section "39. T1 owned_paths 에 Phase 0.5 protected (errors.ts/envelope.ts) 없음"
# T1 line 의 첫 번째 | 와 두 번째 | 사이가 owned_paths 컬럼. forbidden 은 두 번째 ~ 세 번째 |.
t1_line=$(grep -E "^\| \*\*T1 Platform\*\*" 08-SPRINT-PLAN.md | head -1)
# `|` 로 분리하면 [0]="", [1]=" **T1 Platform** ", [2]=owned_paths, [3]=forbidden_paths
t1_owned=$(echo "$t1_line" | awk -F'|' '{print $3}')
t1_owned_violation=$(echo "$t1_owned" | grep -oE "(errors|envelope)\.ts" | grep -v "Phase 0.5 owned" || true)
if [ -z "$t1_owned_violation" ]; then
  pass "T1 owned_paths 에 errors.ts/envelope.ts 없음 (Phase 0.5 owned)"
else
  fail "T1 owned_paths 에 Phase 0.5 protected 포함: $t1_owned_violation"
fi

# ─── 40. CODEOWNERS 가 08 owned_paths 의 routes 와 1:1 매핑 ──────────
section "40. CODEOWNERS routes 매핑 (sessions/messages/uploads/documents/mcp)"
# 본 5 routes 가 CODEOWNERS 에 명시되었는지 확인
routes=("routes/sessions.ts" "routes/messages.ts" "routes/uploads.ts" "routes/documents.ts" "routes/mcp-servers.ts")
missing_owner=""
for r in "${routes[@]}"; do
  grep -q "$r" 05-REPO-STRUCTURE.md 2>/dev/null || missing_owner="$missing_owner $r"
done
if [ -z "$missing_owner" ]; then
  pass "5 route paths 모두 CODEOWNERS 에 등록 (sessions/messages/uploads/documents/mcp)"
else
  fail "CODEOWNERS 누락 routes:$missing_owner"
fi

# ─── 41. project team visibility 매트릭스 — RLS same org_unit 명시 ──
section "41. project team visibility — 8 sprint matrix 가 same org_unit 분기 명시"
team_orgunit=$(grep -cE "same org_unit|org_unit 매칭" 08-SPRINT-PLAN.md || true)
if [ "$team_orgunit" -ge 1 ]; then
  pass "team visibility 의 non-member 읽기가 same org_unit 분기 명시 (RLS 와 단일 출처)"
else
  fail "08 sprint matrix 의 team visibility 가 same org_unit 분기 누락 — RLS 와 drift"
fi

# ─── 42. Phase 0 산출물에 migrator task def + SSM outputs 포함 ──────
section "42. Phase 0 산출물 매트릭스에 migrator task def + SSM outputs 등록"
migrator_td=$(grep -cE "migrator\.\{dev,staging,prod\}\.json|task-definitions.*migrator" build_prompt.md || true)
ssm_outputs=$(grep -cE "private-subnet-a.*ecs-task-sg|SSM.*private-subnet" build_prompt.md || true)
if [ "$migrator_td" -ge 1 ] && [ "$ssm_outputs" -ge 1 ]; then
  pass "Phase 0 산출물: migrator task def + SSM outputs (deploy.sh expand migrate 의존)"
else
  fail "Phase 0 산출물 누락 — migrator_td=$migrator_td ssm=$ssm_outputs"
fi

# ─── 43. frontend reducer 의 stop reason='tool_use' 비-terminal 분기 ──
section "43. 18-FRONTEND reducer 가 stop reason 별 분기 (tool_use → non-terminal)"
reducer_branch=$(grep -cE "tool_use.*non-terminal|reason='tool_use'.*non-terminal" 18-FRONTEND-WIREFRAMES.md || true)
if [ "$reducer_branch" -ge 1 ]; then
  pass "18 reducer 가 stop reason='tool_use' → non-terminal 분기 명시"
else
  fail "18 reducer 가 모든 stop 을 terminal 처리 — 16 의 tool_use non-terminal 규칙과 충돌"
fi

# ─── 44. db:migrate:status / db:migrate:expand 가 server package.json 에 등록 ─
section "44. server package.json 에 db:migrate:status + db:migrate:expand 존재"
status_cmd=$(grep -cE '"db:migrate:status":' 05-REPO-STRUCTURE.md || true)
expand_cmd=$(grep -cE '"db:migrate:expand":' 05-REPO-STRUCTURE.md || true)
if [ "$status_cmd" -ge 1 ] && [ "$expand_cmd" -ge 1 ]; then
  pass "server package.json 에 db:migrate:status + db:migrate:expand 두 script 모두 등록"
else
  fail "package.json 누락 — status=$status_cmd expand=$expand_cmd"
fi

# ─── 45. Phase 0.5 manual gate (자동 진행 금지) ────────────────
section "45. Phase 0.5 manual gate (README + build_prompt 단일 출처)"
readme_gate=$(grep -cE "Phase 0.5.*명시 승인|Phase 0\.5.*manual gate|Phase 0 \(T1 Skeleton\) 까지만 자동" README.md || true)
prompt_gate=$(grep -cE "Phase 0\.5.*명시 승인 게이트|Phase 0\.5.*자동 진행 금지" build_prompt.md || true)
if [ "$readme_gate" -ge 1 ] && [ "$prompt_gate" -ge 1 ]; then
  pass "Phase 0.5 manual gate — README + build_prompt 모두 명시"
else
  fail "Phase 0.5 manual gate 누락 — README=$readme_gate build_prompt=$prompt_gate"
fi

# ─── 46. Phase 0 openapi.ts 는 stub-only (Phase 0.5 가 본문 owner) ──
section "46. Phase 0 openapi.ts 가 빈 paths stub 만 (실 route 등록은 Phase 0.5)"
phase0_stub=$(grep -cE "Phase 0 = 빈 stub|paths: \{\}|Phase 0 최소 stub|/health\` GET 만 포함|/health. GET 만 포함" build_prompt.md || true)
if [ "$phase0_stub" -ge 1 ]; then
  pass "Phase 0 openapi.ts = empty stub, Phase 0.5 가 route 등록 owner"
else
  fail "Phase 0 openapi.ts 가 stub-only 명시 누락"
fi

# ─── 47. AuthMeResponse / AuthUser / AuthOrganization Zod schema 존재 ─
section "47. AuthMeResponse + AuthUser + AuthOrganization Zod schema 정의"
auth_me=$(grep -c "^export const AuthMeResponse = " 16-API-CONTRACT.md || true)
auth_user=$(grep -c "^export const AuthUser = " 16-API-CONTRACT.md || true)
auth_org=$(grep -c "^export const AuthOrganization = " 16-API-CONTRACT.md || true)
if [ "$auth_me" -ge 1 ] && [ "$auth_user" -ge 1 ] && [ "$auth_org" -ge 1 ]; then
  pass "AuthMeResponse + AuthUser + AuthOrganization Zod 모두 정의"
else
  fail "Auth DTO 누락 — AuthMeResponse=$auth_me AuthUser=$auth_user AuthOrganization=$auth_org"
fi

# ─── 48. composite-key Repo 명시 메서드 (ProjectMember/SkillAsset/UserQuota) ──
section "48. composite-key Repo (ProjectMember/SkillAsset/UserQuota) 명시 메서드"
# byKey(a, b) 시그니처 또는 byUserId 가 명시되어야 함
pm_bykey=$(grep -cE "byKey\(projectId: string, userId: string\)" 14-INTERFACES.md || true)
sa_bykey=$(grep -cE "byKey\(skillId: string, filename: string\)" 14-INTERFACES.md || true)
uq_byid=$(grep -cE "byUserId\(userId: string\)" 14-INTERFACES.md || true)
if [ "$pm_bykey" -ge 1 ] && [ "$sa_bykey" -ge 1 ] && [ "$uq_byid" -ge 1 ]; then
  pass "3 composite-key Repo 모두 명시 메서드 (byKey/byUserId)"
else
  fail "composite-key 누락 — pm=$pm_bykey sa=$sa_bykey uq=$uq_byid"
fi

# ─── 49. ToolContext import graph 결정적 (AgentToolInvocation in AgentTool.ts) ─
section "49. ToolContext import graph — AgentToolInvocation in AgentTool.ts (단일 layout)"
# AgentTool.ts 본문에 import { AgentToolSpec, AgentToolResult, AgentToolBase } from "./types.js" + AgentToolInvocation 정의
agent_tool_imports=$(grep -cE 'import type \{ AgentToolSpec, AgentToolResult, AgentToolBase \} from "./types.js"' 14-INTERFACES.md || true)
agent_tool_invocation=$(grep -cE "^export interface AgentToolInvocation \{" 14-INTERFACES.md || true)
if [ "$agent_tool_imports" -ge 1 ] && [ "$agent_tool_invocation" -ge 1 ]; then
  pass "AgentTool.ts 가 spec-only 타입 import + AgentToolInvocation 본 파일 정의 (단일 layout)"
else
  fail "ToolContext layout 미결정 — imports=$agent_tool_imports invocation=$agent_tool_invocation"
fi

# ─── 50. setup-infra.sh 가 private-subnet + ecs-task-sg SSM 파라미터 생성 ──
section "50. setup-infra.sh — private-subnet-a + ecs-task-sg SSM put-parameter 존재"
subnet_put=$(grep -cE 'put_param.*"/.*/private-subnet-a"' 11-DEPLOYMENT.md || true)
sg_put=$(grep -cE 'put_param.*"/.*/ecs-task-sg"' 11-DEPLOYMENT.md || true)
if [ "$subnet_put" -ge 1 ] && [ "$sg_put" -ge 1 ]; then
  pass "setup-infra 가 private-subnet-a + ecs-task-sg SSM 파라미터 생성"
else
  fail "SSM put-parameter 누락 — subnet=$subnet_put sg=$sg_put"
fi

# ─── 51. migrator task def 본문 존재 (one-off ECS task) ────────
section "51. migrator.prod.json 본문 (deploy.sh/first-deploy.sh 의존)"
migrator_body=$(grep -cE '"family": "\{\{PROJECT_SLUG\}\}-prod-migrator"' 11-DEPLOYMENT.md || true)
migrator_cmd=$(grep -cE '"command": \["pnpm", "db:migrate:expand"\]' 11-DEPLOYMENT.md || true)
if [ "$migrator_body" -ge 1 ] && [ "$migrator_cmd" -ge 1 ]; then
  pass "migrator.prod.json 본문 + pnpm db:migrate:expand command 존재"
else
  fail "migrator task def 본문 누락 — body=$migrator_body cmd=$migrator_cmd"
fi

# ─── 52. first-deploy.sh — migrate before service create ─────
section "52. first-deploy.sh — initial migrate 가 service create **전** 호출"
# 부록 H 블록만 추출 (한국어 헤더, multibyte char 매칭)
fd_block=$(awk 'index($0, "부록 H") && /first-deploy.sh/ {flag=1; next} /^## / && flag {flag=0} flag' 11-DEPLOYMENT.md)
fd_migrate_line=$(echo "$fd_block" | grep -nE "run-task.*migrator|launching initial migrator" | head -1 | cut -d: -f1)
fd_create_line=$(echo "$fd_block" | grep -nE "aws ecs create-service" | head -1 | cut -d: -f1)
if [ -n "$fd_migrate_line" ] && [ -n "$fd_create_line" ] && [ "$fd_migrate_line" -lt "$fd_create_line" ]; then
  pass "first-deploy.sh: initial migrate (one-off task) 가 create-service 전 (빈 DB → schema 초기화 안전)"
else
  fail "first-deploy.sh: migrate 가 create-service 전이 아님 — 빈 DB 에 service create 위험 (migrate=$fd_migrate_line create=$fd_create_line)"
fi

# ─── 53. prod 부트스트랩 — setup-infra-prod + first-deploy-prod 분리 ─
section "53. CI 의 prod 부트스트랩 — setup-infra-prod + first-deploy-prod 분리 (secret-fill manual gate)"
setup_prod=$(grep -cE "^setup-infra-prod:" 15-CI-PIPELINE.md || true)
fd_prod=$(grep -cE "^first-deploy-prod:" 15-CI-PIPELINE.md || true)
if [ "$setup_prod" -ge 1 ] && [ "$fd_prod" -ge 1 ]; then
  pass "CI 가 setup-infra-prod + first-deploy-prod 두 manual job 분리 (secret-fill gate 가능)"
else
  fail "prod 부트스트랩 분리 누락 — setup=$setup_prod first=$fd_prod"
fi

# ─── 54. agent task packet read_docs 가 07/09/10 포함 ──────────
section "54. agent task packet read_docs 가 07/09/10 governance docs 포함"
read_docs_full=$(grep -cE "read_docs:.*07-AGENT-TEAMS.*09-TDD-GUIDE.*10-DEV-WORKFLOW" 08-SPRINT-PLAN.md || true)
if [ "$read_docs_full" -ge 1 ]; then
  pass "agent task packet read_docs 가 07 + 09 + 10 governance docs 포함"
else
  fail "agent task packet read_docs 가 governance docs 누락"
fi

# ─── 55. pnpm-lock 충돌 정책 = MR target (integration/phase-N) ─
section "55. pnpm-lock 충돌 정책 = MR target 기준 (main 아님)"
lock_target=$(grep -cE "pnpm-lock.yaml.*MR target.*integration/phase-N|integration/phase-N.*lock" 07-AGENT-TEAMS.md || true)
if [ "$lock_target" -ge 1 ]; then
  pass "pnpm-lock 충돌 정책이 MR target (integration/phase-N) 기준"
else
  fail "pnpm-lock 충돌 정책이 main 기준 — drift"
fi

# ─── 56. SSE state machine — tool_use 가 completed 가 아닌 running 안 ───
section "56. SSE state machine: stop reason='tool_use' 가 running row 안 (completed 아님)"
# completed row 에 'tool_use' 가 빠져 있고, running row 에는 'tool_use' 가 있어야 함
running_row=$(grep -E "^\| .running.*tool_use\b" 16-API-CONTRACT.md | head -1)
completed_row=$(grep -E "^\| .completed.*tool_use" 16-API-CONTRACT.md | head -1)
if [ -n "$running_row" ] && [ -z "$completed_row" ]; then
  pass "stop reason='tool_use' 가 running row 안 (16 § MessageRun 상태 머신 일관)"
else
  fail "SSE state machine drift — running='$running_row' completed='$completed_row' (tool_use 는 completed 가 아니어야 함)"
fi

# ─── 57. SSE envelope 예외 표에 resume endpoint 포함 ────────────
section "57. SSE envelope 예외 표 — resume endpoint (messageId/stream) 포함"
resume_in_exc=$(grep -cE "messages/:messageId/stream.*GET.*notifications|resume.*GET /notifications" 16-API-CONTRACT.md || true)
if [ "$resume_in_exc" -ge 1 ]; then
  pass "envelope 예외 표에 resume endpoint 포함"
else
  fail "envelope 예외 표에 resume endpoint 없음"
fi

# ─── 58. 18-FRONTEND hook snippet 이 12 event 명시 (8 event drift 제거) ──
section "58. 18 hook snippet 이 12 event 처리 + finally setIsStreaming(false) 제거"
hook_12=$(grep -cE "12 event:|12 ChatEvent" 18-FRONTEND-WIREFRAMES.md || true)
hook_finally=$(grep -cE "} finally \{.*setIsStreaming\(false\)" 18-FRONTEND-WIREFRAMES.md || true)
if [ "$hook_12" -ge 1 ] && [ "$hook_finally" -eq 0 ]; then
  pass "18 hook snippet 이 12 event + finally setIsStreaming 제거 (reducer 가 stop reason 보고 결정)"
else
  fail "18 hook drift — 12_event=$hook_12 finally_setstream=$hook_finally (12 event 명시 + finally 제거 필요)"
fi

# ─── 59. citation payload — filename/title/sourceUri 명시 ─────
section "59. citation event payload — filename/title/sourceUri 명시 (Reference 섹션 렌더)"
citation_full=$(grep -cE 'type: "citation".*filename.*sourceUri' 14-INTERFACES.md || true)
citation_16=$(grep -cE "filename, title\?, page\?, sourceUri\?" 16-API-CONTRACT.md || true)
if [ "$citation_full" -ge 1 ] && [ "$citation_16" -ge 1 ]; then
  pass "citation payload 가 filename/title/sourceUri 포함 (14 + 16 일관)"
else
  fail "citation payload 부족 — 14=$citation_full 16=$citation_16"
fi

# ─── 60. magic-link flow 단일화 — frontend /auth/verify 페이지 없음 ─
section "60. magic-link flow — server 302 단일 흐름 (/auth/verify 페이지 제거)"
# 진짜 routes 표 안에 verify 페이지 row 가 있으면 fail. 본문에서 "페이지 없음" 으로 명시되어야 함.
verify_page_row=$(grep -nE "^\|.*/auth/verify.*app/\(auth\)/verify/page\.tsx" 18-FRONTEND-WIREFRAMES.md || true)
verify_removed=$(grep -cE "/auth/verify.*페이지 없음" 18-FRONTEND-WIREFRAMES.md || true)
if [ -z "$verify_page_row" ] && [ "$verify_removed" -ge 1 ]; then
  pass "magic-link flow = server 302 단일 (/auth/verify 페이지 제거 명시)"
else
  fail "magic-link flow drift — page_row='$verify_page_row' removed_marker=$verify_removed"
fi

# ─── 61. knowledge_search prompt 가 project+ephemeral 통합 ─────
section "61. knowledge_search prompt — project + ephemeral 통합 (SearchHit 와 단일 출처)"
ks_unified=$(grep -cE "source='project'.*source='ephemeral'|두 인덱스를 통합" 17-PROMPT-ASSETS.md || true)
ks_hits=$(grep -cE "hits: SearchHit" 17-PROMPT-ASSETS.md || true)
if [ "$ks_unified" -ge 1 ] && [ "$ks_hits" -ge 1 ]; then
  pass "knowledge_search prompt 가 project+ephemeral 통합 (SearchHit 형태 명시)"
else
  fail "knowledge_search prompt 가 project-only 또는 SearchHit 미명시 — unified=$ks_unified hits=$ks_hits"
fi

# ─── 62. setup-infra put_param 이 실제 변수명 ($PRV_A, $SG_SVR) 사용 ──
section "62. setup-infra put_param — 실제 생성 변수명 (\$PRV_A/\$PRV_B/\$SG_SVR) 사용"
# 잘못된 변수 ($SUBNET_PRIV_A, $SG_TASK) 가 put_param 라인에 있으면 fail
bad_var=$(grep -nE 'put_param.*\$(SUBNET_PRIV_A|SUBNET_PRIV_B|SG_TASK)\b' 11-DEPLOYMENT.md || true)
good_var=$(grep -cE 'put_param.*"/.*/private-subnet-a".*\$PRV_A' 11-DEPLOYMENT.md || true)
if [ -z "$bad_var" ] && [ "$good_var" -ge 1 ]; then
  pass "put_param 가 실제 변수명 (\$PRV_A/\$PRV_B/\$SG_SVR) 사용"
else
  fail "put_param drift — bad_var='$bad_var' good_PRV_A=$good_var"
fi

# ─── 63. setup-infra IAM roles 에 migrator-task 포함 ─────────
section "63. setup-infra IAM roles 생성 루프에 migrator-task 포함"
migrator_role=$(grep -cE 'for ROLE in.*migrator-task' 11-DEPLOYMENT.md || true)
if [ "$migrator_role" -ge 1 ]; then
  pass "setup-infra IAM roles 루프에 migrator-task 포함"
else
  fail "setup-infra IAM roles 에 migrator-task 누락 — migrator one-off task 가 task role 없이 fail"
fi

# ─── 64. ALB create-rule fail-closed (drift detection) ──────
section "64. ALB create-rule — fail-closed (|| true 제거, 기존 rule drift 감지 시 exit 1)"
fail_open=$(grep -cE 'create-rule.*\|\| true' 11-DEPLOYMENT.md || true)
fail_closed_drift=$(grep -cE 'ALB rule p\$priority drift' 11-DEPLOYMENT.md || true)
if [ "$fail_open" -eq 0 ] && [ "$fail_closed_drift" -ge 1 ]; then
  pass "ALB create-rule fail-closed (idempotent + drift detection)"
else
  fail "ALB rule drift — fail_open=$fail_open drift_check=$fail_closed_drift"
fi

# ─── 65. branch regex 단일 출처 (07-AGENT-TEAMS) ────────────
section "65. branch regex 단일 정의 (07-AGENT-TEAMS)"
branch_regex=$(grep -cE 'regex.*t\[1-6\]-.*phase-\(0\\\.5\\\|\[1-9\]\)' 07-AGENT-TEAMS.md || true)
if [ "$branch_regex" -ge 1 ]; then
  pass "branch regex 단일 정의 (07 § 명명)"
else
  fail "branch regex 단일화 누락"
fi

# ─── 66. visibility 매트릭스 9-case 통일 (08 + build_prompt) ──
section "66. visibility 매트릭스 9-case 통일 (08 § Phase 3 + build_prompt 단일 출처)"
v_9_count=$(grep -cE "9 케이스|9-case|9 actor scenario" 08-SPRINT-PLAN.md build_prompt.md 2>/dev/null | grep -v ":0$" | wc -l | awk '{print $1}')
v_8_remain=$(grep -nE "visibility matrix 8 케이스|visibility 매트릭스 8 케이스|8 케이스 매트릭스" 08-SPRINT-PLAN.md build_prompt.md 2>/dev/null || true)
if [ "$v_9_count" -ge 2 ] && [ -z "$v_8_remain" ]; then
  pass "visibility 매트릭스 9-case 단일 (08 + build_prompt)"
else
  fail "visibility 매트릭스 drift — 9_count=$v_9_count 8_remain='$v_8_remain'"
fi

# ─── 67. e2e CI job 이 Phase 0 시점에 자동 skip (exists rules) ─
section "67. e2e CI job 이 playwright.config.ts exists 조건 (Phase 0 skip)"
e2e_exists=$(grep -cE "exists: \[playwright.config.ts" 15-CI-PIPELINE.md || true)
if [ "$e2e_exists" -ge 1 ]; then
  pass "e2e job 이 playwright.config.ts exists 조건 — Phase 0 시점 자동 skip"
else
  fail "e2e job 이 exists rules 없음 — Phase 0 에서 fail 위험"
fi

# ─── 68. test:integration 에 --passWithNoTests ─────────────
section "68. test:integration 에 --passWithNoTests (Phase 0 빈 integration 디렉토리 통과)"
pass_with_no=$(grep -cE 'test:integration.*--passWithNoTests' 05-REPO-STRUCTURE.md || true)
if [ "$pass_with_no" -ge 1 ]; then
  pass "test:integration --passWithNoTests 명시 (Phase 0 empty dir 안전)"
else
  fail "test:integration 에 --passWithNoTests 없음 — Phase 0 fail 위험"
fi

# ─── 69. db-migrate-status.ts / db-migrate-expand.ts 본문 존재 ──
section "69. db-migrate-status.ts + db-migrate-expand.ts 본문 (05 § 부록 C)"
status_body=$(grep -cE '^### .apps/server/scripts/db-migrate-status.ts' 05-REPO-STRUCTURE.md || true)
expand_body=$(grep -cE '^### .apps/server/scripts/db-migrate-expand.ts' 05-REPO-STRUCTURE.md || true)
if [ "$status_body" -ge 1 ] && [ "$expand_body" -ge 1 ]; then
  pass "두 migration wrapper 본문 모두 05 § 부록 C 에 존재 (copy-paste ready)"
else
  fail "migration wrapper 본문 누락 — status=$status_body expand=$expand_body"
fi

# ─── 70. first-deploy.sh — SG_TASK 사용 금지, SG_SVR 사용 ─────
section "70. first-deploy.sh migrator run-task — SG_TASK unbound 금지 (SG_SVR 사용)"
sg_svr_in_first=$(awk 'index($0, "부록 H") && /first-deploy.sh/ {flag=1; next} /^## / && flag {flag=0} flag' 11-DEPLOYMENT.md | grep -c 'securityGroups=\[\$SG_SVR\]' || true)
bad_sg_in_first=$(awk 'index($0, "부록 H") && /first-deploy.sh/ {flag=1; next} /^## / && flag {flag=0} flag' 11-DEPLOYMENT.md | grep -c 'securityGroups=\[\$SG_TASK\]' || true)
if [ "$sg_svr_in_first" -ge 1 ] && [ "$bad_sg_in_first" -eq 0 ]; then
  pass "first-deploy migrator 가 \$SG_SVR 사용 (\$SG_TASK unbound 차단)"
else
  fail "first-deploy SG drift — SG_SVR=$sg_svr_in_first SG_TASK=$bad_sg_in_first"
fi

# ─── 71. db-migrator-url secret 이 setup-infra 에 생성 ─────────
section "71. setup-infra.sh — db-migrator-url secret 자동 생성"
mig_secret=$(grep -cE 'db-migrator-url' 11-DEPLOYMENT.md || true)
if [ "$mig_secret" -ge 2 ]; then
  pass "setup-infra 가 db-migrator-url secret 생성 (task def + setup-infra 양쪽 참조)"
else
  fail "db-migrator-url secret 자동 생성 누락 — count=$mig_secret"
fi

# ─── 72. CI YAML heredoc 모두 block scalar (- |) 사용 ─────────
section "72. CI YAML 의 cat <<EOF heredoc 이 모두 - | block scalar"
bare_heredoc=$(grep -nE "^[[:space:]]+- cat > .*<<EOF" 15-CI-PIPELINE.md || true)
if [ -z "$bare_heredoc" ]; then
  pass "CI YAML heredoc 모두 - | block scalar (YAML folding 안전)"
else
  echo "$bare_heredoc" | while read -r l; do fail "bare heredoc — $l"; done
fi

# ─── 73. /auth/verify 트리 잔존 차단 ────────────────────────
section "73. 18-FRONTEND 트리에 verify/page.tsx 잔존 차단"
# 트리 안의 actual file entry 만 검출. comment line (# verify/page.tsx 없음) 은 제외.
# 단순 방법: verify/page.tsx 가 등장하는 라인 중 '없음' 또는 '#' 주석이 아닌 라인.
verify_tree=$(grep -nE "verify/page\.tsx" 18-FRONTEND-WIREFRAMES.md 2>/dev/null | grep -v "없음\|# verify/page\.tsx" || true)
if [ -z "$verify_tree" ]; then
  pass "18 트리에 verify/page.tsx 없음 (server 302 단일 흐름)"
else
  echo "$verify_tree" | while read -r l; do fail "verify/page.tsx 잔존 — $l"; done
fi

# ─── 74. ChatStreamEvent 명칭 사용 차단 (ChatEvent 단일) ──────
section "74. 'ChatStreamEvent' 명칭 사용 차단 (ChatEvent union 단일 출처)"
chat_stream_legacy=$(grep -nE 'ChatStreamEvent' 07-AGENT-TEAMS.md 08-SPRINT-PLAN.md 14-INTERFACES.md 16-API-CONTRACT.md 18-FRONTEND-WIREFRAMES.md 2>/dev/null || true)
if [ -z "$chat_stream_legacy" ]; then
  pass "'ChatStreamEvent' 명칭 사용 안 함 (ChatEvent 단일)"
else
  echo "$chat_stream_legacy" | while read -r l; do fail "legacy ChatStreamEvent — $l"; done
fi

# ─── 75. task def 12개 (server/web/converter/migrator × 3 env) ─
section "75. task def 12개 표기 (server/web/converter/migrator × 3 env)"
td_9_text=$(grep -nE '환경별로 9개 파일' 11-DEPLOYMENT.md || true)
td_12_text=$(grep -cE '환경별로 \*\*12개 파일\*\*|총 12개 task def 파일' 11-DEPLOYMENT.md || true)
if [ -z "$td_9_text" ] && [ "$td_12_text" -ge 1 ]; then
  pass "task def 12개 표기 일관 (migrator 포함)"
else
  fail "task def count drift — 9개_text='$td_9_text' 12개=$td_12_text"
fi

# ─── 76. GEMINI_API_KEY vs GOOGLE_API_KEY 일관 ────────────────
section "76. GEMINI_API_KEY (Google Gemini secret name) 일관 — GOOGLE_API_KEY 사용 차단"
google_key=$(grep -nE '^GOOGLE_API_KEY=' 11-DEPLOYMENT.md || true)
gemini_count=$(grep -cE 'GEMINI_API_KEY' 11-DEPLOYMENT.md || true)
if [ -z "$google_key" ] && [ "$gemini_count" -ge 2 ]; then
  pass "GEMINI_API_KEY 일관 (.env.example + .env.local.example + task def 모두 동일 이름)"
else
  fail "API key 이름 drift — GOOGLE_=$google_key GEMINI=$gemini_count"
fi

# ─── 77. dortex 잔존 차단 (source-specific token) ────────────
section "77. source-specific 잔존 차단 — 'dortex' (원본 조직 DB master user 이름)"
dortex_leak=$(grep -nE '\bdortex\b' *.md 2>/dev/null || true)
if [ -z "$dortex_leak" ]; then
  pass "dortex (source-specific token) 잔존 없음"
else
  echo "$dortex_leak" | while read -r l; do fail "source-specific dortex leak — $l"; done
fi

# ─── 78. root devDependencies 에 @anthropic-ai/sdk + playwright + wait-on 포함 ─
section "78. root package.json devDependencies — agent-reviewer / e2e 가 import 하는 deps 포함"
# root package.json block 추출: header 다음 줄부터 다음 ### 까지
root_pkg_block=$(awk '/^### `package.json` \(root\)/{flag=1; next} flag && /^### /{flag=0} flag' 05-REPO-STRUCTURE.md)
sdk_in_root=$(echo "$root_pkg_block" | grep -c '"@anthropic-ai/sdk"' || true)
playwright_in_root=$(echo "$root_pkg_block" | grep -c '"@playwright/test"' || true)
waiton_in_root=$(echo "$root_pkg_block" | grep -c '"wait-on"' || true)
if [ "$sdk_in_root" -ge 1 ] && [ "$playwright_in_root" -ge 1 ] && [ "$waiton_in_root" -ge 1 ]; then
  pass "root devDeps 에 @anthropic-ai/sdk + @playwright/test + wait-on 모두 포함"
else
  fail "root devDeps 누락 — sdk=$sdk_in_root playwright=$playwright_in_root wait-on=$waiton_in_root"
fi

# ─── 79. shared schema 경로 단일 (schemas/*.ts) ─────────────
section "79. shared schema 단일 경로 — packages/shared/src/schemas/*.ts (types/*.ts 는 z.infer reflect)"
types_only_legacy=$(grep -nE 'packages/shared/src/types/\*\.ts +— Zod schema' 07-AGENT-TEAMS.md || true)
if [ -z "$types_only_legacy" ]; then
  pass "07-AGENT-TEAMS 가 schemas/*.ts 단일 출처 명시 (types/는 z.infer)"
else
  fail "shared schema 경로 drift — types/*.ts 가 Zod 출처로 표기됨: $types_only_legacy"
fi

# ─── 80. project create — 06 의 bootstrap_project_owner 가 1 INSERT (member 만) ─
section "80. project create flow: bootstrap_project_owner 가 project_members 1 INSERT (16/06 정합)"
two_insert_legacy=$(grep -nE "bootstrap_project_owner.*두 INSERT" 16-API-CONTRACT.md || true)
single_insert_correct=$(grep -cE "project_members 1 INSERT" 16-API-CONTRACT.md || true)
if [ -z "$two_insert_legacy" ] && [ "$single_insert_correct" -ge 1 ]; then
  pass "16 가 06 § bootstrap_project_owner (1 INSERT only) 와 일관"
else
  fail "project create 정합 drift — two_insert='$two_insert_legacy' single=$single_insert_correct"
fi

# ─── 81. api-contract-check script 가 api-types.generated.ts 미존재 시 skip ─
section "81. api-contract-check script — AND 검증 (api-types.generated.ts 없으면 exit 0)"
contract_skip=$(grep -cE "api-types.generated.ts 미존재.*Phase 0\.5 머지 전.*skip" 15-CI-PIPELINE.md || true)
if [ "$contract_skip" -ge 1 ]; then
  pass "api-contract-check 가 Phase 0 시점 자동 skip (script-level AND)"
else
  fail "api-contract-check 의 script-level AND 검증 누락"
fi

# ─── 82. aws-preflight.sh — Phase 0 산출물 + 4 mutation script 모두 호출 ──
section "82. aws-preflight.sh Phase 0 산출물 등록 + 4 mutation script (setup/first-deploy/deploy/rollback) 모두 호출"
phase0_preflight=$(grep -cE "scripts/aws-preflight\.sh" build_prompt.md || true)
# 4 script 의 body 안에 aws-preflight 호출 라인이 있어야 함 (single-line grep, body block 검출은 awk).
setup_calls=$(awk '/^# infra\/aws\/setup-infra.sh/{flag=1; next} flag && /^```/{flag=0} flag' 11-DEPLOYMENT.md | grep -c 'aws-preflight\.sh' || true)
first_deploy_calls=$(awk '/^# infra\/aws\/first-deploy.sh/{flag=1; next} flag && /^```/{flag=0} flag' 11-DEPLOYMENT.md | grep -c 'aws-preflight\.sh' || true)
deploy_calls=$(awk '/^### v1.0 기준 본문 \(수정됨\)/{flag=1; next} flag && /^### /{flag=0} flag' 11-DEPLOYMENT.md | grep -c 'aws-preflight\.sh' || true)
rollback_calls=$(awk '/^### .scripts\/rollback\.sh./{flag=1; next} flag && /^### /{flag=0} flag' 15-CI-PIPELINE.md | grep -c 'aws-preflight\.sh' || true)
if [ "$phase0_preflight" -ge 1 ] && [ "$setup_calls" -ge 1 ] && [ "$first_deploy_calls" -ge 1 ] && [ "$deploy_calls" -ge 1 ] && [ "$rollback_calls" -ge 1 ]; then
  pass "aws-preflight.sh Phase 0 산출물 + 4 mutation script 모두 호출"
else
  fail "aws-preflight 호출 누락 — phase0=$phase0_preflight setup=$setup_calls first=$first_deploy_calls deploy=$deploy_calls rollback=$rollback_calls"
fi

# ─── 83. staging CI: setup-infra-staging + first-deploy-staging 분리 ──
section "83. staging CI 부트스트랩 — setup-infra-staging + first-deploy-staging 두 manual job"
setup_staging=$(grep -cE "^setup-infra-staging:" 15-CI-PIPELINE.md || true)
fd_staging=$(grep -cE "^first-deploy-staging:" 15-CI-PIPELINE.md || true)
if [ "$setup_staging" -ge 1 ] && [ "$fd_staging" -ge 1 ]; then
  pass "staging CI 가 setup-infra-staging + first-deploy-staging 분리 (secret-fill gate)"
else
  fail "staging CI 부트스트랩 분리 누락 — setup=$setup_staging first=$fd_staging"
fi

# ─── 84. create_user_from_magic_link SECURITY DEFINER 함수 정의 ──
section "84. create_user_from_magic_link(TEXT) SECURITY DEFINER 함수 정의 (06 § 0012)"
udf_def=$(grep -cE "CREATE OR REPLACE FUNCTION create_user_from_magic_link" 06-DATA-MODEL.md || true)
udf_security=$(grep -cE "create_user_from_magic_link.*SECURITY DEFINER|SECURITY DEFINER" 06-DATA-MODEL.md || true)
udf_in_16=$(grep -cE "create_user_from_magic_link" 16-API-CONTRACT.md || true)
if [ "$udf_def" -ge 1 ] && [ "$udf_security" -ge 2 ] && [ "$udf_in_16" -ge 1 ]; then
  pass "create_user_from_magic_link SECURITY DEFINER 함수 정의 (06) + 16 reference"
else
  fail "magic-link signup user creation 함수 누락 — def=$udf_def security=$udf_security 16_ref=$udf_in_16"
fi

# ─── 85. Auth EMAIL_DOMAIN_FORBIDDEN = 403 (08 + 16 단일) ────
section "85. email 도메인 위반 = 403 EMAIL_DOMAIN_FORBIDDEN (08 + 16 단일 출처)"
forbidden_16=$(grep -cE "403 EMAIL_DOMAIN_FORBIDDEN" 16-API-CONTRACT.md || true)
forbidden_08=$(grep -cE "→ 403\b" 08-SPRINT-PLAN.md || true)
old_400=$(grep -nE "400 INVALID_INPUT \(이메일 도메인 위반" 16-API-CONTRACT.md || true)
if [ "$forbidden_16" -ge 2 ] && [ "$forbidden_08" -ge 1 ] && [ -z "$old_400" ]; then
  pass "이메일 도메인 위반 = 403 EMAIL_DOMAIN_FORBIDDEN (08 + 16 일관)"
else
  fail "auth error code drift — 16_403=$forbidden_16 08=$forbidden_08 legacy_400='$old_400'"
fi

# ─── 86. Phase 0 quickstart 에서 db:seed 호출 안 함 (또는 주석) ──
section "86. Phase 0 quickstart — db:seed 자동 호출 차단 (seed.ts 가 Phase 1+ 의무)"
qs_seed_auto=$(grep -nE "^pnpm db:seed " 05-REPO-STRUCTURE.md || true)
qs_seed_marker=$(grep -cE "# pnpm db:seed" 05-REPO-STRUCTURE.md || true)
if [ -z "$qs_seed_auto" ] && [ "$qs_seed_marker" -ge 1 ]; then
  pass "Phase 0 quickstart 가 db:seed 자동 호출 안 함 (Phase 1+ 의무)"
else
  fail "Phase 0 quickstart db:seed drift — auto='$qs_seed_auto' marker=$qs_seed_marker"
fi

# ─── 87. DDL NOT NULL — document_chunks.metadata / artifacts.size_bytes / magic_link.org_id ──
section "87. DDL NOT NULL drift — document_chunks.metadata, artifacts.size_bytes, magic_link_tokens.org_id"
dc_meta_notnull=$(grep -cE "metadata JSONB NOT NULL DEFAULT '\{\}'::jsonb" 06-DATA-MODEL.md || true)
art_size_notnull=$(grep -cE "size_bytes BIGINT NOT NULL" 06-DATA-MODEL.md || true)
mlt_org_notnull=$(grep -cE "org_id UUID NOT NULL REFERENCES organizations" 06-DATA-MODEL.md || true)
if [ "$dc_meta_notnull" -ge 1 ] && [ "$art_size_notnull" -ge 1 ] && [ "$mlt_org_notnull" -ge 1 ]; then
  pass "DDL NOT NULL 3 컬럼 모두 14/16 DTO 와 정합"
else
  fail "DDL NOT NULL drift — chunks.metadata=$dc_meta_notnull artifacts.size=$art_size_notnull magic.org=$mlt_org_notnull"
fi

# ─── 88. lint-plan path 통일 — docs/plans/scripts/lint-plan.sh ──
section "88. build_prompt 가 새 repo 경로 (docs/plans/scripts/lint-plan.sh) 명시"
docs_plans_path=$(grep -cE "docs/plans/scripts/lint-plan\.sh" build_prompt.md || true)
if [ "$docs_plans_path" -ge 1 ]; then
  pass "build_prompt 가 docs/plans/scripts/lint-plan.sh 명시 (새 repo)"
else
  fail "build_prompt lint-plan path 미명시"
fi

# ─── 89. source-specific extra tokens 차단 (doosan / 두산 / RIDGE) ─
section "89. source-specific token 차단 — 'doosan' / 'Doosan' / 'DOOSAN' / 'RIDGE' / '두산'"
# 'RIDGE' 는 전부 대문자 단어 (일반 'ridge' 단어 false positive 방지). MR/repo URL 의 'ridge' 는 OK.
src_tokens=$(grep -nE '\b(doosan|Doosan|DOOSAN|RIDGE|두산)\b' *.md 2>/dev/null | grep -v "rebuild_plan\|source-specific\|allowlist\|예시" || true)
if [ -z "$src_tokens" ]; then
  pass "source-specific token (doosan/두산/RIDGE) 잔존 없음"
else
  echo "$src_tokens" | head -5 | while read -r l; do fail "source-specific token leak — $l"; done
fi

# ─── 90. invalid JSON fence — text/jsonc 사용 (json 은 strict parse) ─
section "90. invalid JSON 예시 fence — 'json' 대신 'jsonc'/'text' 사용 (16-API JSON #1 advisory)"
# 본 check 는 advisory — 16-API-CONTRACT.md 의 JSON block #1 (envelope spec) 같은 경우 jsonc 권장. 강제 X.
illustrative_json=$(grep -B1 '^```json$' 16-API-CONTRACT.md 2>/dev/null | grep -c "envelope\|예시\|spec" || true)
if [ "$illustrative_json" -ge 0 ]; then
  pass "spec illustrative JSON 은 advisory (T1 canonical files 만 strict)"
fi

# ─── 91. 08 Phase 0 quickstart env bootstrap = .env.local.example ──
section "91. 08 Phase 0 quickstart 의 cp .env.local.example .env.local (build_prompt 와 동일)"
qs08=$(grep -c "cp \.env\.local\.example .env.local" 08-SPRINT-PLAN.md || true)
if [ "$qs08" -ge 1 ]; then
  pass "08 quickstart 가 .env.local.example default (build_prompt 와 일관)"
else
  fail "08 quickstart 가 .env.example 기본 — build_prompt 와 drift"
fi

# ─── 92. generate-adr.mjs 본문 (실행 가능한 codeblock) ─────
section "92. scripts/generate-adr.mjs 본문 — 실행 가능한 codeblock (CI publish 의존)"
adr_body=$(awk '/^### .scripts\/generate-adr\.mjs./{flag=1; next} flag && /^### /{flag=0} flag' 15-CI-PIPELINE.md | grep -c '^```javascript' || true)
adr_gitlab=$(awk '/^### .scripts\/generate-adr\.mjs./{flag=1; next} flag && /^### /{flag=0} flag' 15-CI-PIPELINE.md | grep -c "GITLAB_API_TOKEN\|PRIVATE-TOKEN" || true)
if [ "$adr_body" -ge 1 ] && [ "$adr_gitlab" -ge 1 ]; then
  pass "generate-adr.mjs 실행 가능한 본문 + GitLab API auth 명시"
else
  fail "generate-adr.mjs 본문 누락 — body=$adr_body gitlab_auth=$adr_gitlab"
fi

# ─── 93. check-owned-paths.mjs + CI job ─────────────────────
section "93. scripts/check-owned-paths.mjs + CI owned-paths job (병렬 worktree path-based 강제)"
cop_body=$(awk '/^### .scripts\/check-owned-paths\.mjs./{flag=1; next} flag && /^### /{flag=0} flag' 15-CI-PIPELINE.md | grep -c '^```javascript' || true)
cop_job=$(grep -cE "^owned-paths:" 15-CI-PIPELINE.md || true)
cop_in_phase0=$(grep -c "check-owned-paths" build_prompt.md || true)
if [ "$cop_body" -ge 1 ] && [ "$cop_job" -ge 1 ] && [ "$cop_in_phase0" -ge 1 ]; then
  pass "check-owned-paths.mjs 본문 + CI job + Phase 0 산출물 모두 등록"
else
  fail "owned-paths 강제 누락 — body=$cop_body job=$cop_job phase0=$cop_in_phase0"
fi

# ─── 94. /verify wireframe 잔존 차단 (08) ───────────────────
section "94. 08 SPRINT-PLAN — /verify wireframe 잔존 차단 (server 302 단일 흐름)"
verify_in_08=$(grep -nE "/verify.*wireframe|verify pages\b|verify page" 08-SPRINT-PLAN.md 2>/dev/null | grep -v "없음\|페이지 없음" || true)
if [ -z "$verify_in_08" ]; then
  pass "08 에 /verify wireframe 잔존 없음 (18 + 16 server 302 일관)"
else
  echo "$verify_in_08" | head -3 | while read -r l; do fail "/verify wireframe 잔존 — $l"; done
fi

# ─── 95. resume endpoint 명명 단일 (GET stream) — POST /replay 잔존 차단 ─
section "95. resume endpoint 명명 — GET /sessions/:id/messages/:messageId/stream 단일 (POST replay 잔존 차단)"
old_replay=$(grep -nE "POST /sessions/:id/messages/replay/" 16-API-CONTRACT.md 2>/dev/null || true)
new_resume=$(grep -cE "GET /sessions/:id/messages/:messageId/stream" 16-API-CONTRACT.md || true)
if [ -z "$old_replay" ] && [ "$new_resume" -ge 2 ]; then
  pass "resume endpoint = GET stream 단일 (legacy POST /replay 제거)"
else
  fail "resume endpoint drift — old_replay='$old_replay' new_resume=$new_resume"
fi

# ─── 96. artifact_shares RLS — admin branch (same org) 포함 ──
section "96. artifact_shares RLS — issuer OR same-org admin (prose 와 SQL 일관)"
admin_branch=$(grep -cE "artifact_shares_issuer_or_admin|u\.role IN \('admin', 'owner'\)" 06-DATA-MODEL.md || true)
if [ "$admin_branch" -ge 1 ]; then
  pass "artifact_shares RLS 가 same-org admin branch 포함 (org boundary 강제)"
else
  fail "artifact_shares RLS 가 issuer-only — admin 관리 불가 drift"
fi

# ─── 97. genericize-plan.sh — 새 repo 복사 제외 ──────────────
section "97. genericize-plan.sh — 새 repo 의 docs/plans/scripts/ 복사에서 제외"
genericize_excluded=$(grep -cE "genericize-plan\.sh 는 의도적으로 제외|genericize-plan.sh.*제외" build_prompt.md || true)
if [ "$genericize_excluded" -ge 1 ]; then
  pass "genericize-plan.sh 가 새 repo 배포에서 명시 제외 (source-specific 토큰 leak 차단)"
else
  fail "genericize-plan.sh 배포 제외 명시 누락"
fi

# ─── 98. OpenAPI Phase 0 stub — /health path 포함 명시 ──────
section "98. OpenAPI Phase 0 stub — /health path 포함 (build_prompt + 05 일관)"
bp_health=$(grep -cE 'jq -e .\.paths\."/health"' build_prompt.md || true)
in_05=$(grep -cE '"/health":' 05-REPO-STRUCTURE.md || true)
if [ "$bp_health" -ge 1 ] && [ "$in_05" -ge 1 ]; then
  pass "OpenAPI Phase 0 stub 가 /health path 명시 (build_prompt + 05 일관)"
else
  fail "OpenAPI Phase 0 stub /health drift — build_prompt=$bp_health 05=$in_05"
fi

# ─── 99. anchor validation — relative link '../rebuild_plan/' 차단 ──
section '99. plan docs link 가 ../rebuild_plan/ prefix 사용 안 함 (새 repo docs/plans/ 복사 안전)'

parent_links=$(grep -nE "\(\.\./rebuild_plan/" *.md 2>/dev/null | grep -v "^build_prompt.md:" || true)
if [ -z "$parent_links" ]; then
  pass "plan docs link 가 동일 폴더 상대 경로만 사용 (docs/plans/ 복사 후 안전)"
else
  echo "$parent_links" | head -3 | while read -r l; do fail "parent link drift — $l"; done
fi

# ─── 100. .env.local.example 에 source-specific placeholder 잔존 차단 ──
section "100. .env.local.example — example.com / no-reply@example.com 잔존 차단 ({{ORG_DOMAIN}} 사용)"
example_com=$(grep -nE "^(ALLOWED_DOMAINS|EMAIL_FROM)=[^{].*example\.com" 11-DEPLOYMENT.md 2>/dev/null || true)
if [ -z "$example_com" ]; then
  pass ".env.local.example 가 {{ORG_DOMAIN}} placeholder 사용 (Phase 1 auth 도메인 검증 호환)"
else
  echo "$example_com" | head -3 | while read -r l; do fail "example.com 잔존 — $l"; done
fi

# ─── 101. apply-project-vars 가 PROJECT_NAME_KO auto-derive ──
section "101. apply-project-vars.sh — PROJECT_NAME_KO auto-derive (PROJECT_NAME fallback)"
ko_derive=$(grep -cE 'PROJECT_NAME_KO="\$\{PROJECT_NAME\}"' scripts/apply-project-vars.sh || true)
if [ "$ko_derive" -ge 1 ]; then
  pass "PROJECT_NAME_KO 자동 derive 명시 (PROJECT_NAME fallback)"
else
  fail "PROJECT_NAME_KO auto-derive 누락 — 빈 wizard 입력에서 fail"
fi

# ─── 102. 인증 redirect target = / (또는 /chat/<id>) — '/chat' literal 사용 안 함 ─
section "102. magic-link verify 302 target = / (홈) — /chat literal 잔존 차단"
bad_redirect=$(grep -nE "302 to /chat\b|server 302 → /chat\b" 16-API-CONTRACT.md 08-SPRINT-PLAN.md 2>/dev/null | grep -v "/chat/<id>\|/chat/<sessionId>" || true)
if [ -z "$bad_redirect" ]; then
  pass "magic-link verify 302 target = / (홈에서 새 세션 생성 후 /chat/<id>)"
else
  echo "$bad_redirect" | head -3 | while read -r l; do fail "302 → /chat literal drift — $l"; done
fi

# ─── 103. 05 interfaces tree — types.ts + EmailSender.ts 포함 ──
section "103. 05 § packages/interfaces/src/ tree 에 types.ts + EmailSender.ts 포함 (14 manifest 와 일관)"
tree_block=$(awk '/^packages\/interfaces\/src\/$/{flag=1; next} flag && /^```/{flag=0} flag' 05-REPO-STRUCTURE.md)
has_types=$(echo "$tree_block" | grep -c "^├── types\.ts" || true)
has_email=$(echo "$tree_block" | grep -c "EmailSender\.ts" || true)
if [ "$has_types" -ge 1 ] && [ "$has_email" -ge 1 ]; then
  pass "05 interfaces tree 가 types.ts + EmailSender.ts 포함 (14 § 15 파일 manifest 와 일관)"
else
  fail "05 interfaces tree drift — types=$has_types EmailSender=$has_email"
fi

# ─── 104. routes/projects.ts owner 단일 (T1 platform) ────────
section "104. routes/projects.ts owner — 05 CODEOWNERS + 15 check-owned-paths 모두 T1"
projects_codeowner=$(grep -cE "/apps/server/src/routes/projects\.ts.*@team-platform" 05-REPO-STRUCTURE.md || true)
# t1-platform array 가 multi-line 이라 awk 로 block 추출 후 검사.
t1_block=$(awk '/"t1-platform":/,/^[[:space:]]*\],?$/' 15-CI-PIPELINE.md)
t3_block=$(awk '/"t3-knowledge":/,/^[[:space:]]*\],?$/' 15-CI-PIPELINE.md)
projects_in_t1=$(echo "$t1_block" | grep -c 'routes/projects\.ts' || true)
projects_in_t3=$(echo "$t3_block" | grep -c 'routes/projects\.ts' || true)
if [ "$projects_codeowner" -ge 1 ] && [ "$projects_in_t1" -ge 1 ] && [ "$projects_in_t3" -eq 0 ]; then
  pass "routes/projects.ts owner = T1 (CODEOWNERS + check-owned-paths 일관)"
else
  fail "routes/projects.ts owner drift — codeowner=$projects_codeowner t1=$projects_in_t1 t3=$projects_in_t3 (t3=0 필요)"
fi

# ─── 105. pnpm dev 시맨틱 — 05 + 10 일관 (web + server 만) ───
section "105. pnpm dev = web + server (worker 제외) — 05 + 10 단일 출처"
dev10=$(grep -cE "pnpm dev. = web:3000 \+ server:4000 \(Node 만\)" 10-DEV-WORKFLOW.md || true)
dev10_worker=$(grep -cE "pnpm dev. \(web:3000 \+ server:4000 \+ worker" 10-DEV-WORKFLOW.md || true)
if [ "$dev10" -ge 1 ] && [ "$dev10_worker" -eq 0 ]; then
  pass "10 § pnpm dev = web + server only (worker 는 pnpm dev:full)"
else
  fail "pnpm dev 시맨틱 drift — 10_only=$dev10 10_worker=$dev10_worker (worker 포함이어선 안 됨)"
fi

# ─── 106. build_prompt self-approval 금지 (Tier A/B 모두) ──
section "106. self-approval 정책 — Tier A/B 모두 금지 (build_prompt + 10 단일 출처)"
no_self_bp=$(grep -cE "self-approval.*Tier A/B 모두 금지|self-approval.*금지" build_prompt.md || true)
old_self=$(grep -nE "self-review 는 Tier A 의 최후 수단" build_prompt.md || true)
if [ "$no_self_bp" -ge 1 ] && [ -z "$old_self" ]; then
  pass "build_prompt 가 self-approval Tier A/B 모두 금지 명시"
else
  fail "self-approval drift — no_self=$no_self_bp legacy='$old_self'"
fi

# ─── 107. /usage/me + /usage admin 분리 ───────────────────
section "107. /usage/me (user) + /usage (admin) 분리 — 16 + 18 일관"
usage_me=$(grep -cE '^### .GET /usage/me' 16-API-CONTRACT.md || true)
usage_in_18=$(grep -cE "GET /usage/me" 18-FRONTEND-WIREFRAMES.md || true)
if [ "$usage_me" -ge 1 ] && [ "$usage_in_18" -ge 1 ]; then
  pass "/usage/me 분리 — user quota UI 안전 (admin /usage 와 권한 분리)"
else
  fail "/usage/me 분리 누락 — 16=$usage_me 18=$usage_in_18"
fi

# ─── 108. scripts/ 두 위치 (plan vs 운영) 동일 이름 drift 차단 ──
section "108. docs/plans/scripts/ (plan) vs scripts/ (운영) 동일 이름 없음"
# build_prompt 의 Phase C 복사 list 와 Phase 0 산출물 매트릭스의 scripts/* entries 가 disjoint 인지 검사.
# plan scripts (Phase C 복사 대상): lint-plan.sh, apply-project-vars.sh
# 운영 scripts (Phase 0 생성 대상): check-aws-vars.sh, aws-preflight.sh, smoke-test.sh, rollback.sh, setup-git.sh, tunnel.sh, post-deploy-indexes.sh, mjs files
plan_only=$(grep -A 10 "scripts 복사 — 본 plan 자체" build_prompt.md | grep -oE "lint-plan\.sh|apply-project-vars\.sh" | sort -u | wc -l | awk '{print $1}')
ops_in_phase0=$(grep -cE "scripts/(check-aws-vars|aws-preflight|smoke-test|rollback|setup-git|tunnel|post-deploy-indexes)\.sh" build_prompt.md || true)
if [ "$plan_only" -ge 2 ] && [ "$ops_in_phase0" -ge 5 ]; then
  pass "scripts/ 두 위치 disjoint — plan (lint+vars) vs 운영 (aws-preflight 외 5+)"
else
  fail "scripts/ 위치 drift — plan=$plan_only ops=$ops_in_phase0"
fi

# ─── 109. web package.json — next lint 사용 안 함 (eslint flat config) ─
section "109. web package.json lint script — 'next lint' 사용 안 함 (eslint flat config)"
next_lint=$(grep -nE '"lint": "next lint"' 05-REPO-STRUCTURE.md || true)
eslint_flat=$(grep -cE '"lint": "eslint src' 05-REPO-STRUCTURE.md || true)
if [ -z "$next_lint" ] && [ "$eslint_flat" -ge 1 ]; then
  pass "web lint = eslint flat config (next lint 대신, Next 16 호환 future-proof)"
else
  fail "web lint drift — next_lint='$next_lint' eslint_flat=$eslint_flat"
fi

# ─── 110. Phase A preflight — node/pnpm/jq/docker 필수 도구 검사 ──
section "110. Phase A 도구 preflight — node/pnpm/jq/docker/git/bash + yq/poetry conditional"
preflight_node=$(grep -c 'need node' build_prompt.md || true)
preflight_pnpm=$(grep -c 'need pnpm' build_prompt.md || true)
preflight_yq=$(grep -c 'need yq' build_prompt.md || true)
if [ "$preflight_node" -ge 1 ] && [ "$preflight_pnpm" -ge 1 ] && [ "$preflight_yq" -ge 1 ]; then
  pass "Phase A 도구 preflight (node/pnpm/yq) 명시"
else
  fail "Phase A preflight 누락 — node=$preflight_node pnpm=$preflight_pnpm yq=$preflight_yq"
fi

# ─── 111. withRlsContext = operation-wide short tx (SSE 안전) 명시 ──
section "111. withRlsContext = operation-wide 짧은 transaction (SSE 장시간 요청 안전 boundary)"
op_wide=$(grep -cE "withRlsContext.*operation-wide|operation 별로.*짧은 transaction" 14-INTERFACES.md || true)
if [ "$op_wide" -ge 1 ]; then
  pass "withRlsContext 가 operation-wide short tx 명시 (SSE handler 안 connection 차단 방지)"
else
  fail "withRlsContext 구현 정책 boundary 누락 — SSE 와 RLS 충돌 위험"
fi

# ─── 112. deploy.sh — ${PROJECT_SLUG} 직접 참조 차단 (set -u 안전) ──
section "112. deploy.sh body — \${PROJECT_SLUG} 직접 참조 없음 (set -u 에서 unbound 위험)"
# v1.0 기준 본문 안에서만 검사 (외부 prose 의 {{PROJECT_SLUG}} placeholder 는 OK).
deploy_block=$(awk '/^### v1.0 기준 본문 \(수정됨\)/{flag=1; next} flag && /^### deploy.sh 끝의 known-good 기록/{flag=0} flag' 11-DEPLOYMENT.md)
direct_ref=$(echo "$deploy_block" | grep -cE '\$\{PROJECT_SLUG\}/\$\{ENV\}' || true)
if [ "$direct_ref" -eq 0 ]; then
  pass "deploy.sh body 가 \$PROJECT (= \${PROJECT_SLUG:-...}) 사용 — set -u 안전"
else
  fail "deploy.sh body 에 \${PROJECT_SLUG} 직접 참조 — set -u 에서 unbound: count=$direct_ref"
fi

# ─── 113. RLS — FORCE ROW LEVEL SECURITY (master/owner 우회 차단) ─
section "113. 0001 § users/organizations/org_units RLS — FORCE ROW LEVEL SECURITY 적용"
force_rls_count=$(grep -cE "FORCE  ROW LEVEL SECURITY" 06-DATA-MODEL.md || true)
if [ "$force_rls_count" -ge 4 ]; then
  pass "0001 4 테이블 (orgs/units/users/uous) 모두 FORCE RLS (master/migrator 도 policy 통과 의무)"
else
  fail "FORCE RLS 누락 — count=$force_rls_count (4+ 필요)"
fi

# ─── 114. app_user / migrator_user 분리 (v1.0 부터) ──────────
section "114. setup-infra — app_user / migrator_user 두 role 분리 (BYPASSRLS 없음)"
role_app=$(grep -cE "CREATE ROLE app_user" 11-DEPLOYMENT.md || true)
role_mig=$(grep -cE "CREATE ROLE migrator_user" 11-DEPLOYMENT.md || true)
if [ "$role_app" -ge 1 ] && [ "$role_mig" -ge 1 ]; then
  pass "setup-infra 가 app_user + migrator_user 두 role 생성 (RLS 보안 강화)"
else
  fail "DB role 분리 누락 — app=$role_app migrator=$role_mig"
fi

# ─── 115. Message DTO 가 streaming 상태 복원 필드 보유 ───────
section "115. Message DTO — citations/artifactIds/toolCallIds/runStatus (reload 후 상태 복원)"
msg_block=$(awk '/^export const Message = z.object\(\{/,/^\}\);/' 16-API-CONTRACT.md)
has_citations=$(echo "$msg_block" | grep -c "citations:" || true)
has_artifacts=$(echo "$msg_block" | grep -c "artifactIds:" || true)
has_toolcalls=$(echo "$msg_block" | grep -c "toolCallIds:" || true)
has_runstatus=$(echo "$msg_block" | grep -c "runStatus:" || true)
if [ "$has_citations" -ge 1 ] && [ "$has_artifacts" -ge 1 ] && [ "$has_toolcalls" -ge 1 ] && [ "$has_runstatus" -ge 1 ]; then
  pass "Message DTO 가 streaming 복원 4 필드 (citations/artifactIds/toolCallIds/runStatus) 보유"
else
  fail "Message DTO drift — citations=$has_citations artifacts=$has_artifacts tools=$has_toolcalls run=$has_runstatus"
fi

# ─── 116. apps/server/src/mappers/ 가 repo tree 에 등록 ─────
section "116. apps/server/src/mappers/ CODEOWNERS 등록 (14 § mapper naming convention 과 일관)"
mappers_owner=$(grep -cE "^/apps/server/src/mappers/" 05-REPO-STRUCTURE.md || true)
mappers_in_phase05=$(grep -cE "apps/server/src/mappers/" 15-CI-PIPELINE.md || true)
if [ "$mappers_owner" -ge 1 ] && [ "$mappers_in_phase05" -ge 1 ]; then
  pass "mappers/ CODEOWNERS 등록 + check-owned-paths Phase 0.5 protected"
else
  fail "mappers/ 누락 — codeowner=$mappers_owner phase05=$mappers_in_phase05"
fi

# ─── 117. test owned paths — __tests__/ 가 TEAM_OWNED 에 등록 ─
section "117. check-owned-paths TEAM_OWNED — production path 의 __tests__/ 대응 등록"
# T1 의 routes/auth.ts 와 routes/auth 의 test 가 같은 team 안.
t1_test=$(grep -cE 'apps/server/src/__tests__/routes/auth\.' 15-CI-PIPELINE.md || true)
t2_test=$(grep -cE 'apps/server/src/__tests__/orchestrator' 15-CI-PIPELINE.md || true)
t3_test=$(grep -cE 'apps/server/src/__tests__/knowledge' 15-CI-PIPELINE.md || true)
if [ "$t1_test" -ge 1 ] && [ "$t2_test" -ge 1 ] && [ "$t3_test" -ge 1 ]; then
  pass "test owned paths — T1/T2/T3 의 production code 대응 __tests__/ 모두 등록"
else
  fail "test owned paths 누락 — t1=$t1_test t2=$t2_test t3=$t3_test"
fi

# ─── 118. Phase A 5 questions 일관 (4 questions drift 차단) ───
section "118. Phase A — 5 questions (A1 dir / A2 vars / A3 gitlab / A4 aws / A5 analysis)"
five_qs=$(grep -c "Phase A 의 5 questions" build_prompt.md || true)
four_drift=$(grep -cE "Phase A 의 4 questions" build_prompt.md || true)
if [ "$five_qs" -ge 1 ] && [ "$four_drift" -eq 0 ]; then
  pass "Phase A = 5 questions (A1-A5 모두 명시, checklist 동기화)"
else
  fail "Phase A questions drift — 5=$five_qs 4_legacy=$four_drift"
fi

# ─── 119. build_prompt root scripts/apply-project-vars 잔존 차단 ──
section "119. Phase 0 산출물 — root scripts/apply-project-vars.sh 잔존 차단 (Phase C.2 docs/plans 만)"
# Phase 0 matrix 의 'scripts/apply-project-vars.sh' 가 'docs/plans/scripts/' prefix 또는 'Phase C 복사' marker 포함이어야 함.
bad_apply=$(grep -nE '^\| 3 \| .scripts/apply-project-vars\.sh.' build_prompt.md || true)
good_apply=$(grep -nE 'docs/plans/scripts/apply-project-vars\.sh|Phase C 복사' build_prompt.md || true)
if [ -z "$bad_apply" ] && [ -n "$good_apply" ]; then
  pass "apply-project-vars.sh 가 docs/plans/scripts/ (Phase C 복사) 만 — root 산출물 없음"
else
  fail "apply-project-vars root 잔존 — bad='$bad_apply' good='$good_apply'"
fi

# ─── 120. aws-preflight 가 db-migrator-url SELECT current_user 검증 ─
section "120. aws-preflight.sh — deploy mode 에서 migrator_user role 인증 검증 (SQL bootstrap 누락 차단)"
preflight_role_check=$(grep -cE "SELECT current_user|SKIP_DB_ROLE_CHECK" 11-DEPLOYMENT.md || true)
if [ "$preflight_role_check" -ge 1 ]; then
  pass "aws-preflight 가 db-migrator-url 의 current_user='migrator_user' 검증 (SQL 미실행 차단)"
else
  fail "aws-preflight 의 db role check 누락 — setup-infra § 10b SQL 미실행 시 first-deploy 인증 fail"
fi

# ─── 121. compose up --wait (healthcheck race 차단) ───────────
section "121. docs/quickstart docker compose up — '--wait' flag (healthcheck race 차단)"
compose_wait_08=$(grep -cE "docker compose -f docker-compose\.local\.yml up -d --wait" 08-SPRINT-PLAN.md || true)
compose_wait_05=$(grep -cE "docker compose -f docker-compose\.local\.yml up -d --wait" 05-REPO-STRUCTURE.md || true)
if [ "$compose_wait_08" -ge 1 ] && [ "$compose_wait_05" -ge 1 ]; then
  pass "08 + 05 quickstart 가 --wait flag 사용 (db:migrate race 차단)"
else
  fail "compose --wait 누락 — 08=$compose_wait_08 05=$compose_wait_05"
fi

# ─── 122. projects_insert policy in 0004 (Phase 3 POST /projects 안전) ─
section "122. 0004 § projects RLS — projects_insert policy 존재 (0015 적용 전에도 POST /projects 통과)"
proj_insert_0004=$(awk '/^### .0004_projects_members\.sql/{flag=1; next} flag && /^### /{flag=0} flag' 06-DATA-MODEL.md | grep -c "CREATE POLICY projects_insert" || true)
if [ "$proj_insert_0004" -ge 1 ]; then
  pass "0004 에 projects_insert policy 포함 (0015 의존 없이 Phase 3 POST /projects 안전)"
else
  fail "projects_insert policy 가 0004 에 없음 — Phase 3 POST /projects 가 RLS WITH CHECK 실패"
fi

# ─── 123. SSE error event = SerializedError (Error class instance X) ──
section "123. SSE error event payload = SerializedError JSON shape (Error class instance 금지)"
ser_in_16=$(grep -cE "data: \{ error: SerializedError" 16-API-CONTRACT.md || true)
ser_in_14=$(grep -cE "type: \"error\"; error: SerializedError" 14-INTERFACES.md || true)
if [ "$ser_in_16" -ge 1 ] && [ "$ser_in_14" -ge 1 ]; then
  pass "SSE error event 가 SerializedError JSON shape 사용 (14 + 16 단일 출처)"
else
  fail "SerializedError drift — 16=$ser_in_16 14=$ser_in_14"
fi

# ─── 124. /auth/magic-link/verify 가 AuthMeResponse 목록에서 제거 ──
section "124. /auth/magic-link/verify (302 redirect) — AuthMeResponse 응답 목록에서 제거"
bad_verify=$(grep -nE "AuthMeResponse.*/auth/magic-link/verify\|/auth/me, /auth/login, /auth/magic-link/verify 응답 단일 출처" 16-API-CONTRACT.md || true)
if [ -z "$bad_verify" ]; then
  pass "AuthMeResponse 목록이 verify 제외 (302 redirect — body 없음)"
else
  echo "$bad_verify" | head -2 | while read -r l; do fail "verify AuthMeResponse drift — $l"; done
fi

# ─── 125. AppContext = AuthUser/AuthOrganization (User/Organization X) ─
section "125. 18 AppContext — AuthUser/AuthOrganization (admin 전용 User generated type X)"
appctx_authuser=$(grep -cE "AuthUser \| null|user: AuthUser" 18-FRONTEND-WIREFRAMES.md || true)
appctx_user_legacy=$(grep -cE "components\[\"schemas\"\]\[\"User\"\]" 18-FRONTEND-WIREFRAMES.md || true)
if [ "$appctx_authuser" -ge 1 ] && [ "$appctx_user_legacy" -eq 0 ]; then
  pass "AppContext = AuthUser/AuthOrganization (16 § AuthMeResponse 와 단일 출처)"
else
  fail "AppContext type drift — authuser=$appctx_authuser legacy_user=$appctx_user_legacy"
fi

# ─── 120. CI YAML — services 의 flow sequence colon-bearing scalar quote ──
section "120. CI YAML services: ['docker:24-dind'] quoted (parser 호환성)"
unquoted_dind=$(grep -nE "^[[:space:]]+services: \[docker:" 15-CI-PIPELINE.md 2>/dev/null || true)
quoted_dind=$(grep -cE 'services: \["docker:24-dind"\]' 15-CI-PIPELINE.md || true)
if [ -z "$unquoted_dind" ] && [ "$quoted_dind" -ge 1 ]; then
  pass "CI YAML services 의 docker:dind 가 quoted (Ruby Psych 등 strict parser 호환)"
else
  fail "CI YAML services drift — unquoted='$unquoted_dind' quoted=$quoted_dind"
fi

# ─── 121. Phase 0 web — tsconfig + next-env.d.ts 포함 ───────────
section "121. Phase 0 web 산출물 — tsconfig.json + next-env.d.ts 포함 (typecheck 통과 의무)"
web_tsconfig=$(grep -c 'apps/web.*tsconfig\.json' build_prompt.md || true)
web_nextenv=$(grep -c 'next-env\.d\.ts' build_prompt.md || true)
in_05_ts=$(grep -c '^### .apps/web/tsconfig\.json' 05-REPO-STRUCTURE.md || true)
in_05_nextenv=$(grep -c '^### .apps/web/next-env\.d\.ts' 05-REPO-STRUCTURE.md || true)
if [ "$web_tsconfig" -ge 1 ] && [ "$web_nextenv" -ge 1 ] && [ "$in_05_ts" -ge 1 ] && [ "$in_05_nextenv" -ge 1 ]; then
  pass "Phase 0 web 매트릭스 + 05 본문 모두 tsconfig + next-env.d.ts 포함"
else
  fail "Phase 0 web tsconfig/next-env 누락 — bp_ts=$web_tsconfig bp_env=$web_nextenv 05_ts=$in_05_ts 05_env=$in_05_nextenv"
fi

# ─── 122. setup-infra BASTION_ID 참조 — set -u 안전 (default guard 또는 순서) ──
section "122. setup-infra.sh — BASTION_ID 참조 시 set -u 안전 (default guard)"
# BASTION_ID 가 § 10b 에서 echo 되지만 § 11) 에서 정의됨. default guard \${BASTION_ID:-...} 가 있어야 set -u 통과.
bastion_guard=$(grep -cE '\$\{BASTION_ID:-' 11-DEPLOYMENT.md || true)
if [ "$bastion_guard" -ge 1 ]; then
  pass "setup-infra BASTION_ID 참조 default guard 적용 (set -u 안전)"
else
  fail "setup-infra BASTION_ID — set -u 에서 unbound 위험 (default guard 없음)"
fi

# ─── 123. .env.local.example DUMMY_* placeholder (gitleaks 통과) ──
section "123. .env.local.example — DUMMY_* placeholder (gitleaks 정규식 회피)"
# sk-ant-..., sk-..., AIza... prefix 잔존 시 gitleaks 기본 룰 match.
bad_placeholder=$(grep -nE '^(ANTHROPIC_API_KEY|OPENAI_API_KEY|GEMINI_API_KEY|VOYAGE_API_KEY|TAVILY_API_KEY)=(sk-ant-|sk-|AIza|pa-|tvly-)' 11-DEPLOYMENT.md 2>/dev/null || true)
dummy_count=$(grep -cE '=DUMMY_(ANTHROPIC|OPENAI|GEMINI|VOYAGE|TAVILY)_API_KEY' 11-DEPLOYMENT.md || true)
if [ -z "$bad_placeholder" ] && [ "$dummy_count" -ge 5 ]; then
  pass ".env.local.example 가 DUMMY_* placeholder 사용 (gitleaks 정규식 회피)"
else
  fail "gitleaks 위험 placeholder 잔존 — bad='$bad_placeholder' dummy=$dummy_count"
fi

# ─── 124. docker compose up — --wait 명시 (healthcheck race 차단) ──
section "124. docker compose up -d --wait (healthcheck 통과까지 block — db:migrate race 차단)"
compose_wait_bp=$(grep -cE 'docker compose -f docker-compose\.local\.yml up -d --wait' build_prompt.md || true)
compose_wait_05=$(grep -cE 'docker compose -f docker-compose\.local\.yml up -d --wait' 05-REPO-STRUCTURE.md || true)
if [ "$compose_wait_bp" -ge 1 ] && [ "$compose_wait_05" -ge 1 ]; then
  pass "docker compose up --wait — build_prompt + 05 일관"
else
  fail "compose --wait 누락 — bp=$compose_wait_bp 05=$compose_wait_05"
fi

# ─── 125. Dockerfile HUSKY=0 (build 안 .git 부재 fail 차단) ──
section "125. Dockerfile — HUSKY=0 env (build context 의 .git 부재로 husky prepare fail 차단)"
husky_zero=$(grep -cE '^ENV HUSKY=0' 11-DEPLOYMENT.md || true)
if [ "$husky_zero" -ge 2 ]; then
  pass "Dockerfile 의 deps stage 모두 HUSKY=0 (server + web)"
else
  fail "Dockerfile HUSKY=0 누락 — count=$husky_zero (server+web 2 이상 필요)"
fi

# ─── 126. SerializedError wire schema 정의 ─────────────────
section "126. SerializedError wire format 정의 (ChatEvent.error JSON 직렬화 안전)"
ser_def=$(grep -cE '^export interface SerializedError' 14-INTERFACES.md || true)
ser_use=$(grep -cE 'error: SerializedError' 14-INTERFACES.md || true)
if [ "$ser_def" -ge 1 ] && [ "$ser_use" -ge 1 ]; then
  pass "SerializedError 정의 + ChatEvent.error 가 본 타입 사용 (Error class 직렬화 위험 회피)"
else
  fail "SerializedError 누락 — def=$ser_def use=$ser_use"
fi

# ─── 127. db:migrate:status 단일 정의 (drizzle-kit --dry-run legacy 차단) ──
section "127. db:migrate:status — tsx wrapper 단일 (drizzle-kit --dry-run legacy snippet 차단)"
legacy_dryrun=$(grep -cE '"db:migrate:status": "drizzle-kit migrate --dry-run' 05-REPO-STRUCTURE.md || true)
canonical=$(grep -cE '"db:migrate:status": "tsx' 05-REPO-STRUCTURE.md || true)
if [ "$legacy_dryrun" -eq 0 ] && [ "$canonical" -ge 1 ]; then
  pass "db:migrate:status 단일 정의 (tsx wrapper 만, drizzle-kit --dry-run legacy 제거)"
else
  fail "db:migrate:status drift — legacy=$legacy_dryrun canonical=$canonical"
fi

# ─── 128. 03-ARCHITECTURE 인터페이스 표 12 행 (EmailSender 포함) ──
section "128. 03 § 경계 인터페이스 표 — EmailSender 포함 12 행 (14 § 15 파일 manifest 와 일관)"
emailsender_in_03=$(grep -cE "^\| 12 \| .EmailSender." 03-ARCHITECTURE.md || true)
if [ "$emailsender_in_03" -ge 1 ]; then
  pass "03 인터페이스 표 12 행 (EmailSender 포함)"
else
  fail "03 인터페이스 표에 EmailSender 누락"
fi

# ─── 130. LOCAL_ONLY=1 분기 (build_prompt B.5) ──────────────
section "130. build_prompt B.5 — LOCAL_ONLY=1 분기 (AWS later)"
local_only_branch=$(grep -cE "LOCAL_ONLY=1 bash rebuild_plan/scripts/apply-project-vars\.sh" build_prompt.md || true)
if [ "$local_only_branch" -ge 1 ]; then
  pass "B.5 substitution 명령이 LOCAL_ONLY=1 분기 (USE_AWS_NOW=0 시)"
else
  fail "B.5 LOCAL_ONLY 분기 누락 — AWS later 사용자가 bootstrap fail"
fi

# ─── 131. T1 owned_paths — db/{project,artifact,memory}-service.ts 포함 ──
section "131. T1 owned_paths — db/project-service.ts / artifact-service.ts / memory-service.ts 포함"
t1_owned=$(grep -E '^\| \*\*T1 Platform\*\*' 08-SPRINT-PLAN.md | head -1)
# brace expansion 또는 개별 명시 둘 다 OK.
proj_svc=$(echo "$t1_owned" | grep -cE "project-service\b" || true)
art_svc=$(echo "$t1_owned" | grep -cE "artifact-service\b" || true)
mem_svc=$(echo "$t1_owned" | grep -cE "memory-service\b" || true)
if [ "$proj_svc" -ge 1 ] && [ "$art_svc" -ge 1 ] && [ "$mem_svc" -ge 1 ]; then
  pass "T1 owned_paths 가 3 db service 파일 모두 포함 (Phase 3/5/7 작업 가능)"
else
  fail "T1 owned_paths drift — project=$proj_svc artifact=$art_svc memory=$mem_svc"
fi

# ─── 132. mcp route 이름 통일 (mcp-servers.ts) ────────────
section "132. routes/mcp-servers.ts 통일 (16 API path /mcp-servers + 05 CODEOWNERS + 15 TEAM_OWNED)"
mcp_servers_ci=$(grep -cE 'routes/mcp-servers\.ts' 15-CI-PIPELINE.md || true)
mcp_servers_codeowners=$(grep -cE "^/apps/server/src/routes/mcp-servers\.ts" 05-REPO-STRUCTURE.md || true)
mcp_legacy=$(grep -nE 'routes/mcp\.ts' 05-REPO-STRUCTURE.md 15-CI-PIPELINE.md 2>/dev/null || true)
if [ "$mcp_servers_ci" -ge 1 ] && [ "$mcp_servers_codeowners" -ge 1 ] && [ -z "$mcp_legacy" ]; then
  pass "mcp-servers.ts 단일 이름 — 16/05/15 일관 (legacy mcp.ts 잔존 없음)"
else
  fail "mcp route name drift — ci=$mcp_servers_ci codeowners=$mcp_servers_codeowners legacy='$mcp_legacy'"
fi

# ─── 133. Phase 2 attachments phase gate (Phase 4 dependency) ──
section "133. POST /sessions/:id/messages attachments — Phase 2/4 phase boundary 명시"
phase_gate=$(grep -cE "Phase 2 \(현재\)|Phase 4 부터 활성" 16-API-CONTRACT.md || true)
if [ "$phase_gate" -ge 1 ]; then
  pass "POST /messages attachments — Phase 2/4 boundary 명시 (Phase 2 가 Phase 4 RAG 의존 안 함)"
else
  fail "Phase 2 attachments boundary 누락 — Phase 2 server 가 Phase 4 ephemeral_chunks/parser 없이 fail"
fi

# ─── 134. ALB_ARN — create-load-balancer 결과 capture 명시 ──
section "134. setup-infra § 8 ALB — create-load-balancer 결과 ARN 변수 갱신 (SSM 'None' 저장 차단)"
alb_capture=$(awk '/^# ── 8\) ALB ──/{flag=1; next} flag && /^# ── /{flag=0} flag' 11-DEPLOYMENT.md | grep -c 'ALB_ARN=\$(aws elbv2 create-load-balancer' || true)
if [ "$alb_capture" -ge 1 ]; then
  pass "ALB 신규 생성 시 ARN 결과를 \$ALB_ARN 에 capture (SSM put_param 안전)"
else
  fail "ALB 신규 생성 후 ARN capture 누락 — SSM 에 'None' 저장 위험"
fi

# ─── 135. GitLab token name 통일 (GITLAB_BOT_TOKEN) ───────
section "135. CI GitLab token name 통일 — GITLAB_BOT_TOKEN (API_TOKEN drift 차단)"
api_token_legacy=$(grep -nE 'GITLAB_API_TOKEN' 15-CI-PIPELINE.md 2>/dev/null || true)
bot_token=$(grep -cE 'GITLAB_BOT_TOKEN' 15-CI-PIPELINE.md || true)
if [ -z "$api_token_legacy" ] && [ "$bot_token" -ge 3 ]; then
  pass "CI GitLab token 단일 (GITLAB_BOT_TOKEN — masked + protected)"
else
  echo "$api_token_legacy" | head -3 | while read -r l; do fail "API_TOKEN legacy 잔존 — $l"; done
fi

# ─── 36. @anthropic-ai/sdk pin 이 실 npm 에 존재 (alpha/beta 제외) ───
section "36. @anthropic-ai/sdk version pin 검증 (실 npm registry 의 stable version)"
sdk_pin=$(grep -oE '"@anthropic-ai/sdk": "[0-9]+\.[0-9]+\.[0-9]+"' 05-REPO-STRUCTURE.md | head -1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+')
if [ -z "$sdk_pin" ]; then
  fail "@anthropic-ai/sdk pin 추출 실패"
elif echo "$sdk_pin" | grep -qE "alpha|beta|rc"; then
  fail "@anthropic-ai/sdk pin = $sdk_pin 가 pre-release — stable 만 허용"
else
  # 0.34.0 처럼 missing version 차단. 알려진 stable list (검증된 시점) 와 매칭.
  case "$sdk_pin" in
    0.32.0|0.32.1|0.33.0|0.33.1|0.35.0|0.36.2|0.36.3|0.40.0|0.40.1|0.50.1|0.50.2|0.50.3|0.50.4|0.60.0|0.70.0|0.70.1|0.80.0|0.90.0|0.96.0)
      pass "@anthropic-ai/sdk = $sdk_pin (known stable)"
      ;;
    *)
      fail "@anthropic-ai/sdk = $sdk_pin — 본 lint 의 known-stable list 에 없음. 실 npm 에 존재하는지 manual 확인 필요"
      ;;
  esac
fi

# ─── 결과 ─────────────────────────────────────────────────────
echo ""
if [ "$EXIT_CODE" -eq 0 ]; then
  echo "════════════════════════"
  echo "  ✓ lint-plan 통과"
  echo "════════════════════════"
else
  echo "════════════════════════"
  echo "  ❌ lint-plan 실패 — 위 항목 수정 후 재실행 (STRICT=0 우회 가능)"
  echo "════════════════════════"
  [ "${STRICT:-1}" = "0" ] && EXIT_CODE=0
fi
exit "$EXIT_CODE"
