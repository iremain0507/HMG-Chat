#!/usr/bin/env bash
# scripts/apply-project-vars.sh
# plan 본문의 {{PLACEHOLDER}} 를 사용자 입력값으로 일괄 치환.
#
# 사용법:
#   bash scripts/apply-project-vars.sh                       # 환경변수 사용
#   bash scripts/apply-project-vars.sh project.config.yaml   # yaml 입력
#
# 정의: 00a-PROJECT-VARIABLES.md 참조.
# 본 plan 은 이미 generic ({{...}} placeholder) 상태이므로, 본 스크립트가 사용자 값으로 치환.

set -eo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PLAN_DIR="$ROOT"

# ─── 입력: yaml config (인자) ───
# 인자 없으면 env mode (CI 등) 로 fallback 가능 — `ENV_MODE=1` 명시할 때만 허용.
# 인자 있는데 파일이 없으면 fail-closed (오타로 인한 silent env fallback 방지).
YAML="${1:-}"
if [ -n "$YAML" ]; then
  if [ ! -f "$YAML" ]; then
    echo "❌ config 파일 없음: $YAML (오타 의심 — env 변수로 fallback 안 함)"
    exit 1
  fi
  command -v yq > /dev/null \
    || { echo "❌ yq 필요. brew install yq 또는 pip install yq"; exit 1; }
elif [ -z "${ENV_MODE:-}" ]; then
  echo "❌ config 파일 인자 또는 ENV_MODE=1 둘 중 하나 명시 필요"
  echo "   사용법: bash scripts/apply-project-vars.sh project.config.yaml"
  echo "         또는: ENV_MODE=1 bash scripts/apply-project-vars.sh   (env 변수 export 후)"
  exit 1
fi
if [ -n "$YAML" ] && [ -f "$YAML" ]; then
  command -v yq > /dev/null \
    || { echo "❌ yq 필요. brew install yq 또는 pip install yq"; exit 1; }

  # yaml dot-notation key → env 변수 이름 명시 alias 매핑
  yaml_to_env() {
    case "$1" in
      project.name)               echo PROJECT_NAME ;;
      project.slug)               echo PROJECT_SLUG ;;
      project.name_pascal)        echo PROJECT_NAME_PASCAL ;;
      project.name_ko)            echo PROJECT_NAME_KO ;;
      project.tagline_ko)         echo PROJECT_TAGLINE_KO ;;
      project.version_target)     echo PROJECT_VERSION_TARGET ;;
      org.name)                   echo ORG_NAME ;;
      org.name_lower)             echo ORG_NAME_LOWER ;;
      org.name_ko)                echo ORG_NAME_KO ;;
      org.full_name_ko)           echo ORG_FULL_NAME_KO ;;
      org.domain)                 echo ORG_DOMAIN ;;
      org.user_persona_ko)        echo ORG_USER_PERSONA_KO ;;
      org.philosophy_short)       echo ORG_PHILOSOPHY_SHORT ;;
      gitlab.host)                echo GITLAB_HOST ;;
      gitlab.group)               echo GITLAB_GROUP ;;
      aws.region)                 echo AWS_REGION ;;
      aws.account_dev)            echo AWS_ACCOUNT_DEV ;;
      aws.account_staging)        echo AWS_ACCOUNT_STAGING ;;
      aws.account_prod)           echo AWS_ACCOUNT_PROD ;;
      aws.db_master_username)     echo DB_MASTER_USERNAME ;;
      aws.internal_cidr_default)  echo INTERNAL_CIDR_DEFAULT ;;
      domain.app_prod)            echo APP_DOMAIN_PROD ;;
      domain.app_staging)         echo APP_DOMAIN_STAGING ;;
      domain.app_dev)             echo APP_DOMAIN_DEV ;;
      alerts.slack_channel)       echo ALERT_SLACK_CHANNEL ;;
      alerts.release_channel)     echo RELEASE_SLACK_CHANNEL ;;
      brand.pptx_skill_name)      echo BRAND_PPTX_SKILL_NAME ;;
      brand.sandbox_template_id)  echo SANDBOX_TEMPLATE_ID ;;
      llm.primary_provider)       echo PRIMARY_LLM_PROVIDER ;;
      llm.primary_model_opus)     echo PRIMARY_LLM_MODEL_OPUS ;;
      llm.primary_model_sonnet)   echo PRIMARY_LLM_MODEL_SONNET ;;
      llm.primary_model_haiku)    echo PRIMARY_LLM_MODEL_HAIKU ;;
      llm.embedding_provider)     echo EMBEDDING_PROVIDER ;;
      llm.embedding_model)        echo EMBEDDING_MODEL ;;
      llm.embedding_dim)          echo EMBEDDING_DIM ;;
      llm.web_search_provider)    echo WEB_SEARCH_PROVIDER ;;
      llm.image_caption_provider) echo IMAGE_CAPTION_PROVIDER ;;
      llm.sandbox_provider)       echo SANDBOX_PROVIDER ;;
      llm.fallback_providers)     echo FALLBACK_LLM_PROVIDERS ;;
      policy.message_retention_days)    echo MESSAGE_RETENTION_DAYS ;;
      policy.artifact_retention_days)   echo ARTIFACT_RETENTION_DAYS ;;
      policy.upload_retention_days)     echo UPLOAD_RETENTION_DAYS ;;
      policy.share_default_ttl_days)    echo SHARE_DEFAULT_TTL_DAYS ;;
      policy.share_max_ttl_days)        echo SHARE_MAX_TTL_DAYS ;;
      policy.default_user_budget_tokens) echo DEFAULT_USER_BUDGET_TOKENS ;;
      policy.jwt_access_ttl_seconds)    echo JWT_ACCESS_TTL_SECONDS ;;
      policy.jwt_refresh_ttl_seconds)   echo JWT_REFRESH_TTL_SECONDS ;;
      policy.rate_limit_global_max)     echo RATE_LIMIT_GLOBAL_MAX ;;
      *) return 1 ;;
    esac
  }

  while IFS='=' read -r raw_k raw_v; do
    k=$(echo "$raw_k" | tr -d ' ')
    v=$(echo "$raw_v" | sed -E 's/^ *"?//; s/"? *$//')
    [ -z "$k" ] && continue
    [ -z "$v" ] && continue
    if env_name=$(yaml_to_env "$k"); then
      export "$env_name=$v"
    fi
  done < <(yq -o=props "$YAML" 2>/dev/null || yq e -o=p "$YAML" 2>/dev/null)
fi

# ─── 자동 유도 변수 (사용자가 비워두면 derive) ──────
# 정책: example yaml 의 "비우면 자동 유도" 안내와 일치해야 함.
# 1) PROJECT_SLUG ← lowercase(PROJECT_NAME) (공백 제거, 영문 외 제거)
if [ -z "${PROJECT_SLUG:-}" ] && [ -n "${PROJECT_NAME:-}" ]; then
  PROJECT_SLUG=$(echo "$PROJECT_NAME" \
    | tr '[:upper:]' '[:lower:]' \
    | tr -cd 'a-z0-9-')
fi
export PROJECT_SLUG

# 2) PROJECT_NAME_PASCAL ← 첫글자 대문자
if [ -z "${PROJECT_NAME_PASCAL:-}" ] && [ -n "${PROJECT_NAME:-}" ]; then
  PROJECT_NAME_PASCAL=$(echo "$PROJECT_NAME" \
    | awk '{print toupper(substr($0,1,1)) tolower(substr($0,2))}')
fi
export PROJECT_NAME_PASCAL

# 3) ORG_NAME_LOWER ← lowercase(ORG_NAME)
if [ -z "${ORG_NAME_LOWER:-}" ] && [ -n "${ORG_NAME:-}" ]; then
  ORG_NAME_LOWER=$(echo "$ORG_NAME" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9-')
fi
export ORG_NAME_LOWER

# 4) BRAND_PPTX_SKILL_NAME ← "${ORG_NAME_LOWER}-pptx"
if [ -z "${BRAND_PPTX_SKILL_NAME:-}" ] && [ -n "${ORG_NAME_LOWER:-}" ]; then
  BRAND_PPTX_SKILL_NAME="${ORG_NAME_LOWER}-pptx"
fi
export BRAND_PPTX_SKILL_NAME

# ─── 추가 자동 유도 (예시값 → derive) ───
# 다음 변수들은 wizard 가 명시 입력 받지 않아도 derive 가능 → 사용자가 비워두면 자동.
# 사용자가 명시 입력하면 override.
if [ -z "${ORG_FULL_NAME_KO:-}" ] && [ -n "${ORG_NAME_KO:-}" ]; then
  ORG_FULL_NAME_KO="${ORG_NAME_KO}"
fi
export ORG_FULL_NAME_KO

if [ -z "${ORG_USER_PERSONA_KO:-}" ] && [ -n "${ORG_NAME_KO:-}" ]; then
  ORG_USER_PERSONA_KO="${ORG_NAME_KO}인"
fi
export ORG_USER_PERSONA_KO

if [ -z "${APP_DOMAIN_PROD:-}" ] && [ -n "${PROJECT_SLUG:-}" ] && [ -n "${ORG_DOMAIN:-}" ]; then
  APP_DOMAIN_PROD="${PROJECT_SLUG}.${ORG_DOMAIN}"
fi
if [ -z "${APP_DOMAIN_STAGING:-}" ] && [ -n "${PROJECT_SLUG:-}" ] && [ -n "${ORG_DOMAIN:-}" ]; then
  APP_DOMAIN_STAGING="${PROJECT_SLUG}-staging.${ORG_DOMAIN}"
fi
if [ -z "${APP_DOMAIN_DEV:-}" ] && [ -n "${PROJECT_SLUG:-}" ] && [ -n "${ORG_DOMAIN:-}" ]; then
  APP_DOMAIN_DEV="${PROJECT_SLUG}-dev.${ORG_DOMAIN}"
fi
export APP_DOMAIN_PROD APP_DOMAIN_STAGING APP_DOMAIN_DEV

if [ -z "${ALERT_SLACK_CHANNEL:-}" ] && [ -n "${PROJECT_SLUG:-}" ]; then
  ALERT_SLACK_CHANNEL="#${PROJECT_SLUG}-alerts"
fi
if [ -z "${RELEASE_SLACK_CHANNEL:-}" ] && [ -n "${PROJECT_SLUG:-}" ]; then
  RELEASE_SLACK_CHANNEL="#${PROJECT_SLUG}-releases"
fi
export ALERT_SLACK_CHANNEL RELEASE_SLACK_CHANNEL

if [ -z "${PROJECT_NAME_KO:-}" ] && [ -n "${PROJECT_NAME:-}" ]; then
  # 사용자가 한국어 이름을 안 적으면 영문 PROJECT_NAME 을 그대로 사용 (예: "Ridge").
  PROJECT_NAME_KO="${PROJECT_NAME}"
fi
export PROJECT_NAME_KO

if [ -z "${PROJECT_TAGLINE_KO:-}" ]; then
  PROJECT_TAGLINE_KO="${PROJECT_NAME_KO:-${PROJECT_NAME:-}} AI 어시스턴트 플랫폼"
fi
export PROJECT_TAGLINE_KO

if [ -z "${SANDBOX_TEMPLATE_ID:-}" ] && [ -n "${PROJECT_SLUG:-}" ]; then
  SANDBOX_TEMPLATE_ID="${PROJECT_SLUG}-default-v1"
fi
export SANDBOX_TEMPLATE_ID

# ─── 필수 변수 검증 (자동 유도 이후) ───
# 두 그룹으로 분리: CORE 는 항상 필요. AWS_DEPLOY 는 LOCAL_ONLY=1 일 때 건너뜀.
REQUIRED_CORE=(
  PROJECT_NAME PROJECT_SLUG PROJECT_NAME_KO PROJECT_TAGLINE_KO PROJECT_NAME_PASCAL
  ORG_NAME ORG_NAME_LOWER ORG_NAME_KO ORG_FULL_NAME_KO ORG_DOMAIN ORG_USER_PERSONA_KO
  GITLAB_HOST GITLAB_GROUP
  DB_MASTER_USERNAME
  APP_DOMAIN_PROD APP_DOMAIN_STAGING APP_DOMAIN_DEV
  ALERT_SLACK_CHANNEL RELEASE_SLACK_CHANNEL
  BRAND_PPTX_SKILL_NAME SANDBOX_TEMPLATE_ID
)
REQUIRED_AWS_DEPLOY=(
  AWS_REGION AWS_ACCOUNT_DEV AWS_ACCOUNT_STAGING AWS_ACCOUNT_PROD
)

# LOCAL_ONLY=1 → AWS 변수 없이 통과. 11-DEPLOYMENT 진입 직전 별도 gate 가 다시 검증.
if [ "${LOCAL_ONLY:-0}" = "1" ]; then
  REQUIRED=( "${REQUIRED_CORE[@]}" )
  # AWS 값이 비어있으면 명시적 placeholder 로 치환 (잔존 검사가 잡지 않도록 의도적 marker).
  export AWS_REGION="${AWS_REGION:-LOCAL_ONLY_AWS_REGION_PENDING}"
  export AWS_ACCOUNT_DEV="${AWS_ACCOUNT_DEV:-LOCAL_ONLY_ACCOUNT_PENDING}"
  export AWS_ACCOUNT_STAGING="${AWS_ACCOUNT_STAGING:-LOCAL_ONLY_ACCOUNT_PENDING}"
  export AWS_ACCOUNT_PROD="${AWS_ACCOUNT_PROD:-LOCAL_ONLY_ACCOUNT_PENDING}"
  echo "ℹ️  LOCAL_ONLY=1 — AWS 변수는 PENDING 마커로 치환됨. 배포 전 재실행 필수."
else
  REQUIRED=( "${REQUIRED_CORE[@]}" "${REQUIRED_AWS_DEPLOY[@]}" )
fi

MISSING=()
for v in "${REQUIRED[@]}"; do
  [ -z "${!v:-}" ] && MISSING+=("$v")
done
if [ "${#MISSING[@]}" -gt 0 ]; then
  echo "❌ 필수 변수 누락 (${#MISSING[@]}건):"
  for m in "${MISSING[@]}"; do echo "   - $m"; done
  echo ""
  echo "  ※ 다음은 자동 유도되므로 입력 안 해도 됨:"
  echo "     - PROJECT_SLUG ← lowercase(PROJECT_NAME)"
  echo "     - PROJECT_NAME_PASCAL ← capitalize(PROJECT_NAME)"
  echo "     - ORG_NAME_LOWER ← lowercase(ORG_NAME)"
  echo "     - BRAND_PPTX_SKILL_NAME ← \${ORG_NAME_LOWER}-pptx"
  echo "     - ORG_FULL_NAME_KO ← ORG_NAME_KO"
  echo "     - ORG_USER_PERSONA_KO ← ORG_NAME_KO + '인'"
  echo "     - APP_DOMAIN_* ← \${PROJECT_SLUG}[-env].\${ORG_DOMAIN}"
  echo "     - ALERT/RELEASE_SLACK_CHANNEL ← '#\${PROJECT_SLUG}-{alerts,releases}'"
  echo "     - PROJECT_TAGLINE_KO ← '\${PROJECT_NAME_KO} AI 어시스턴트 플랫폼'"
  echo "     - SANDBOX_TEMPLATE_ID ← '\${PROJECT_SLUG}-default-v1'"
  echo ""
  echo "  ※ AWS 입력을 미루려면: LOCAL_ONLY=1 bash apply-project-vars.sh ..."
  echo ""
  echo "방법 1: project.config.yaml 작성 (project.config.example.yaml 복사)"
  echo "방법 2: 환경변수 export"
  exit 1
fi

# 정책 default (사용자 미입력 시 합리적 default)
export INTERNAL_CIDR_DEFAULT="${INTERNAL_CIDR_DEFAULT:-10.0.0.0/16}"
export MCP_ALLOWED_INTERNAL_CIDRS="${MCP_ALLOWED_INTERNAL_CIDRS:-${INTERNAL_CIDR_DEFAULT}}"
export ORG_PHILOSOPHY_SHORT="${ORG_PHILOSOPHY_SHORT:-}"
export PRIMARY_LLM_PROVIDER="${PRIMARY_LLM_PROVIDER:-anthropic}"
export PRIMARY_LLM_MODEL_OPUS="${PRIMARY_LLM_MODEL_OPUS:-claude-opus-4-7}"
export PRIMARY_LLM_MODEL_SONNET="${PRIMARY_LLM_MODEL_SONNET:-claude-sonnet-4-6}"
export PRIMARY_LLM_MODEL_HAIKU="${PRIMARY_LLM_MODEL_HAIKU:-claude-haiku-4-5}"
export EMBEDDING_PROVIDER="${EMBEDDING_PROVIDER:-voyage}"
export EMBEDDING_MODEL="${EMBEDDING_MODEL:-voyage-multilingual-2}"
export EMBEDDING_DIM="${EMBEDDING_DIM:-1024}"
export WEB_SEARCH_PROVIDER="${WEB_SEARCH_PROVIDER:-tavily}"
export IMAGE_CAPTION_PROVIDER="${IMAGE_CAPTION_PROVIDER:-gemini}"
export SANDBOX_PROVIDER="${SANDBOX_PROVIDER:-e2b}"
export FALLBACK_LLM_PROVIDERS="${FALLBACK_LLM_PROVIDERS:-openai,gemini}"
# AWS_ACCOUNT_* 는 required 검증을 위에서 통과한 경우만 set — placeholder default 제거.
export MESSAGE_RETENTION_DAYS="${MESSAGE_RETENTION_DAYS:-90}"
export ARTIFACT_RETENTION_DAYS="${ARTIFACT_RETENTION_DAYS:-90}"
export UPLOAD_RETENTION_DAYS="${UPLOAD_RETENTION_DAYS:-30}"
export SHARE_DEFAULT_TTL_DAYS="${SHARE_DEFAULT_TTL_DAYS:-30}"
export SHARE_MAX_TTL_DAYS="${SHARE_MAX_TTL_DAYS:-90}"
export DEFAULT_USER_BUDGET_TOKENS="${DEFAULT_USER_BUDGET_TOKENS:-100000}"
export JWT_ACCESS_TTL_SECONDS="${JWT_ACCESS_TTL_SECONDS:-900}"
export JWT_REFRESH_TTL_SECONDS="${JWT_REFRESH_TTL_SECONDS:-2592000}"
export RATE_LIMIT_GLOBAL_MAX="${RATE_LIMIT_GLOBAL_MAX:-120}"

# ─── 적용 대상 파일 ───
shopt -s nullglob 2>/dev/null || true
TARGETS=()
for f in "$PLAN_DIR"/*.md; do
  TARGETS+=("$f")
done

# ─── 백업 ───
echo "[1/3] 백업 (.bak) 생성..."
for f in "${TARGETS[@]}"; do
  cp "$f" "$f.bak"
done

# ─── 치환 ({{VAR}} → env 변수 값) ───
echo "[2/3] perl -i -pE 치환..."

PERL_PROG='
  # 모든 {{VAR}} placeholder 를 ENV 값으로 치환
  s/\{\{PROJECT_NAME\}\}/$ENV{PROJECT_NAME}/g;
  s/\{\{PROJECT_SLUG\}\}/$ENV{PROJECT_SLUG}/g;
  s/\{\{PROJECT_NAME_PASCAL\}\}/$ENV{PROJECT_NAME_PASCAL}/g;
  s/\{\{PROJECT_NAME_KO\}\}/$ENV{PROJECT_NAME_KO}/g;
  s/\{\{PROJECT_TAGLINE_KO\}\}/$ENV{PROJECT_TAGLINE_KO}/g;
  s/\{\{PROJECT_VERSION_TARGET\}\}/$ENV{PROJECT_VERSION_TARGET}/g;

  s/\{\{ORG_NAME\}\}/$ENV{ORG_NAME}/g;
  s/\{\{ORG_NAME_LOWER\}\}/$ENV{ORG_NAME_LOWER}/g;
  s/\{\{ORG_NAME_KO\}\}/$ENV{ORG_NAME_KO}/g;
  s/\{\{ORG_FULL_NAME_KO\}\}/$ENV{ORG_FULL_NAME_KO}/g;
  s/\{\{ORG_DOMAIN\}\}/$ENV{ORG_DOMAIN}/g;
  s/\{\{ORG_USER_PERSONA_KO\}\}/$ENV{ORG_USER_PERSONA_KO}/g;
  s/\{\{ORG_PHILOSOPHY_SHORT\}\}/$ENV{ORG_PHILOSOPHY_SHORT}/g;

  s/\{\{GITLAB_HOST\}\}/$ENV{GITLAB_HOST}/g;
  s/\{\{GITLAB_GROUP\}\}/$ENV{GITLAB_GROUP}/g;

  s/\{\{AWS_REGION\}\}/$ENV{AWS_REGION}/g;
  s/\{\{AWS_ACCOUNT_DEV\}\}/$ENV{AWS_ACCOUNT_DEV}/g;
  s/\{\{AWS_ACCOUNT_STAGING\}\}/$ENV{AWS_ACCOUNT_STAGING}/g;
  s/\{\{AWS_ACCOUNT_PROD\}\}/$ENV{AWS_ACCOUNT_PROD}/g;
  s/\{\{DB_MASTER_USERNAME\}\}/$ENV{DB_MASTER_USERNAME}/g;
  s/\{\{INTERNAL_CIDR_DEFAULT\}\}/$ENV{INTERNAL_CIDR_DEFAULT}/g;
  s/\{\{MCP_ALLOWED_INTERNAL_CIDRS\}\}/$ENV{MCP_ALLOWED_INTERNAL_CIDRS}/g;

  s/\{\{APP_DOMAIN_PROD\}\}/$ENV{APP_DOMAIN_PROD}/g;
  s/\{\{APP_DOMAIN_STAGING\}\}/$ENV{APP_DOMAIN_STAGING}/g;
  s/\{\{APP_DOMAIN_DEV\}\}/$ENV{APP_DOMAIN_DEV}/g;

  s/\{\{ALERT_SLACK_CHANNEL\}\}/$ENV{ALERT_SLACK_CHANNEL}/g;
  s/\{\{RELEASE_SLACK_CHANNEL\}\}/$ENV{RELEASE_SLACK_CHANNEL}/g;

  s/\{\{BRAND_PPTX_SKILL_NAME\}\}/$ENV{BRAND_PPTX_SKILL_NAME}/g;
  s/\{\{SANDBOX_TEMPLATE_ID\}\}/$ENV{SANDBOX_TEMPLATE_ID}/g;

  s/\{\{PRIMARY_LLM_PROVIDER\}\}/$ENV{PRIMARY_LLM_PROVIDER}/g;
  s/\{\{PRIMARY_LLM_MODEL_OPUS\}\}/$ENV{PRIMARY_LLM_MODEL_OPUS}/g;
  s/\{\{PRIMARY_LLM_MODEL_SONNET\}\}/$ENV{PRIMARY_LLM_MODEL_SONNET}/g;
  s/\{\{PRIMARY_LLM_MODEL_HAIKU\}\}/$ENV{PRIMARY_LLM_MODEL_HAIKU}/g;
  s/\{\{EMBEDDING_PROVIDER\}\}/$ENV{EMBEDDING_PROVIDER}/g;
  s/\{\{EMBEDDING_MODEL\}\}/$ENV{EMBEDDING_MODEL}/g;
  s/\{\{EMBEDDING_DIM\}\}/$ENV{EMBEDDING_DIM}/g;
  s/\{\{WEB_SEARCH_PROVIDER\}\}/$ENV{WEB_SEARCH_PROVIDER}/g;
  s/\{\{IMAGE_CAPTION_PROVIDER\}\}/$ENV{IMAGE_CAPTION_PROVIDER}/g;
  s/\{\{SANDBOX_PROVIDER\}\}/$ENV{SANDBOX_PROVIDER}/g;
  s/\{\{FALLBACK_LLM_PROVIDERS\}\}/$ENV{FALLBACK_LLM_PROVIDERS}/g;

  s/\{\{MESSAGE_RETENTION_DAYS\}\}/$ENV{MESSAGE_RETENTION_DAYS}/g;
  s/\{\{ARTIFACT_RETENTION_DAYS\}\}/$ENV{ARTIFACT_RETENTION_DAYS}/g;
  s/\{\{UPLOAD_RETENTION_DAYS\}\}/$ENV{UPLOAD_RETENTION_DAYS}/g;
  s/\{\{SHARE_DEFAULT_TTL_DAYS\}\}/$ENV{SHARE_DEFAULT_TTL_DAYS}/g;
  s/\{\{SHARE_MAX_TTL_DAYS\}\}/$ENV{SHARE_MAX_TTL_DAYS}/g;
  s/\{\{DEFAULT_USER_BUDGET_TOKENS\}\}/$ENV{DEFAULT_USER_BUDGET_TOKENS}/g;
  s/\{\{JWT_ACCESS_TTL_SECONDS\}\}/$ENV{JWT_ACCESS_TTL_SECONDS}/g;
  s/\{\{JWT_REFRESH_TTL_SECONDS\}\}/$ENV{JWT_REFRESH_TTL_SECONDS}/g;
  s/\{\{RATE_LIMIT_GLOBAL_MAX\}\}/$ENV{RATE_LIMIT_GLOBAL_MAX}/g;
'

perl -i -pE "$PERL_PROG" "${TARGETS[@]}"

# ─── 결과 ───
echo "[3/3] 변경 요약:"
CHANGED=0
for f in "${TARGETS[@]}"; do
  if ! diff -q "$f.bak" "$f" > /dev/null 2>&1; then
    LINES=$(diff "$f.bak" "$f" | grep -c '^>' || true)
    printf "  · %-32s %4s lines\n" "$(basename "$f")" "$LINES"
    CHANGED=$((CHANGED+1))
  fi
done
echo ""
echo "총 ${CHANGED}/${#TARGETS[@]} 파일 변경."

# 잔존 placeholder 검사 — fenced code block 외부 만 검사 (정상 bash/JS 변수 false positive 회피)
echo ""
echo "잔존 placeholder 검사 (있다면 변수 누락):"

# Plan placeholder 표기 단일 출처: {{VAR}} 형태. ${VAR} 는 항상 코드 블록 내부의 정상 변수로 간주.
# fenced code block 추적 awk 로 prose 영역만 검사.
detect_residue() {
  local pattern="$1"; shift
  awk -v pat="$pattern" '
    /^```/         { in_code = !in_code; next }
    in_code        { next }
    $0 ~ pat       { print FILENAME ":" FNR ": " $0 }
  ' "$@" 2>/dev/null
}

# 1) {{VAR}} 잔존 (정식) — code block 안이든 밖이든 plan placeholder 는 모두 치환 대상이어야 함.
REMAINING1=$(grep -nE '\{\{[A-Z_]+\}\}' "${TARGETS[@]}" 2>/dev/null \
  | grep -v '\.bak:' \
  | grep -vE '00a-PROJECT-VARIABLES|README|/scripts/' \
  | head -10 || true)

# 2) prose 안의 ${PLAN_VAR} (code block 제외) — 매우 드문 케이스. 대부분 0건이어야 정상.
PLAN_VAR_REGEX='\$\{(PROJECT|ORG|BRAND|APP_DOMAIN|ALERT_|RELEASE_|GITLAB|INTERNAL_CIDR|MCP_ALLOWED|SANDBOX_TEMPLATE|EMBEDDING|PRIMARY_LLM|WEB_SEARCH|AWS_ACCOUNT|DB_MASTER)[A-Z_]+\}'
PROSE_TARGETS=()
for t in "${TARGETS[@]}"; do
  case "$t" in
    *.md) PROSE_TARGETS+=("$t") ;;
  esac
done
REMAINING2=""
if [ "${#PROSE_TARGETS[@]}" -gt 0 ]; then
  REMAINING2=$(detect_residue "$PLAN_VAR_REGEX" "${PROSE_TARGETS[@]}" \
    | grep -v '\.bak:' \
    | grep -vE '00a-PROJECT-VARIABLES|README' \
    | head -10 || true)
fi
if [ -z "$REMAINING1$REMAINING2" ]; then
  echo "  ✓ 모든 placeholder 치환됨"
  EXIT_CODE=0
else
  [ -n "$REMAINING1" ] && { echo "  [{{}} 잔존]"; echo "$REMAINING1"; }
  [ -n "$REMAINING2" ] && { echo "  [\${} 잔존 — placeholder 로 의심]"; echo "$REMAINING2"; }
  echo ""
  echo "  → 위 라인의 변수는 'export VAR=...' 또는 project.config.yaml 에 누락."
  echo "  → 만약 정상 bash 변수(스크립트 본문)라면 patterns whitelist 추가 필요."
  # STRICT=0 환경변수로 임시 우회 가능 (수동 검사 시). 기본 STRICT=1 → 잔존 발견 시 exit 2.
  if [ "${STRICT:-1}" = "1" ]; then
    echo ""
    echo "❌ 잔존 placeholder 발견 → exit 2. (우회: STRICT=0)"
    EXIT_CODE=2
  else
    echo "⚠️  STRICT=0 — 잔존 무시하고 계속."
    EXIT_CODE=0
  fi
fi

echo ""
echo "—— 다음 단계 ——"
echo "  확인: diff $PLAN_DIR/00-CONTEXT.md.bak $PLAN_DIR/00-CONTEXT.md | head"
echo "  원복: for f in $PLAN_DIR/*.md.bak; do mv \"\$f\" \"\${f%.bak}\"; done"
echo "  확정: rm $PLAN_DIR/*.md.bak"
exit "$EXIT_CODE"
