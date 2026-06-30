#!/usr/bin/env bash
# scripts/genericize-plan.sh
# 본 plan 의 RIDGE / doosan / 두산 등 원본 사례 토큰을 모두 `{{PLACEHOLDER}}` 로 치환.
# 실행 후 plan 은 어느 조직에도 적용 가능한 generic template.
# 새 조직 적용은 scripts/apply-project-vars.sh 가 placeholder → 사용자 값으로 변환.
#
# 일회성 스크립트 — plan 작성자가 1회 실행 후 결과를 commit.
# 새 조직 사용자는 이 스크립트를 다시 실행할 필요 없음.

set -eo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PLAN_DIR="$ROOT"
TARGETS=("$PLAN_DIR"/*.md)

echo "[1/3] 백업 (.bak)..."
for f in "${TARGETS[@]}"; do
  cp "$f" "$f.bak"
done

echo "[2/3] genericize 치환..."

# Perl 치환 — 긴 토큰 먼저 (보존성)
# placeholder 형식: {{NAME}} — markdown bold (`__text__`) 충돌 회피
perl -i -pE '
  # ── 한국어 (긴 것 먼저) ──
  s/\Q두산그룹\E/{{ORG_FULL_NAME_KO}}/g;
  s/\Q두산인의 동료\E/{{ORG_USER_PERSONA_KO}}의 동료/g;
  s/\Q두산인\E/{{ORG_USER_PERSONA_KO}}/g;
  s/\Q두산\E/{{ORG_NAME_KO}}/g;

  # ── 도메인/URL (긴 것 먼저) ──
  s/\Qgitlab.doosan.com\E/{{GITLAB_HOST}}/g;
  s|\Qdoosan/0001\E|{{GITLAB_GROUP}}|g;
  s/\Qridge-staging.doosan.com\E/{{APP_DOMAIN_STAGING}}/g;
  s/\Qridge-dev.doosan.com\E/{{APP_DOMAIN_DEV}}/g;
  s/\Qridge.doosan.com\E/{{APP_DOMAIN_PROD}}/g;
  s/\Qdoosan.com\E/{{ORG_DOMAIN}}/g;

  # ── Slack 채널 ──
  s/\Q#ridge-alerts\E/{{ALERT_SLACK_CHANNEL}}/g;
  s/\Q#ridge-release\E/{{RELEASE_SLACK_CHANNEL}}/g;

  # ── 브랜드 이름 (긴 것 먼저) ──
  s/\Qdoosan-pptx\E/{{BRAND_PPTX_SKILL_NAME}}/g;
  s/\Qridge-default-v1\E/{{SANDBOX_TEMPLATE_ID}}/g;

  # ── 영문 word boundary (긴 것 먼저) ──
  s/\bRIDGE v2\b/{{PROJECT_NAME}} v2/g;
  s/\bRIDGE\b/{{PROJECT_NAME}}/g;

  # underscored 변종 (DB / JWT 쿠키)
  s/\bridge_(dev|test|prod|staging|at|rt)\b/{{PROJECT_SLUG}}_$1/g;
  s/\bridge_prod_owner\b/{{PROJECT_SLUG}}_prod_owner/g;

  # PascalCase 변종 (Error 클래스, namespace)
  s/\bRidgeError\b/{{PROJECT_NAME_PASCAL}}Error/g;
  s/`Ridge`/`{{PROJECT_NAME_PASCAL}}`/g;
  s/"Ridge"/"{{PROJECT_NAME_PASCAL}}"/g;

  # ridge 단독 단어 (bridge, HitlBridge 의 일부는 보호)
  s/\bridge_v2\b/{{PROJECT_SLUG}}_v2/g;
  s/\bridge\b/{{PROJECT_SLUG}}/g;

  s/\bDoosan\b/{{ORG_NAME}}/g;
  s/\bdoosan\b/{{ORG_NAME_LOWER}}/g;

  # 인프라
  s/\bdortex\b/{{DB_MASTER_USERNAME}}/g;
  s/\Qap-northeast-2\E/{{AWS_REGION}}/g;
  s|\Q10.0.0.0/16\E|{{INTERNAL_CIDR_DEFAULT}}|g;
' "${TARGETS[@]}"

echo "[3/3] 결과 요약:"
CHANGED=0
for f in "${TARGETS[@]}"; do
  if ! diff -q "$f.bak" "$f" > /dev/null 2>&1; then
    LINES=$(diff "$f.bak" "$f" | grep -c '^>' || true)
    printf "  · %-32s %4s lines\n" "$(basename "$f")" "$LINES"
    CHANGED=$((CHANGED+1))
  fi
done

echo ""
echo "총 ${CHANGED}/${#TARGETS[@]} 파일 변경됨."

echo ""
echo "잔존 검사 (의도된 잔존 + 코드 식별자):"
grep -niE 'doosan|두산|dortex' "${TARGETS[@]}" 2>/dev/null \
  | grep -v '\.bak:' | head -10 || echo "  ✓ 잔존 없음"
echo ""
echo "ridge 잔존 (코드 식별자 — mcp-bridge, HitlBridge 등 제외):"
grep -niE '\bridge\b|\bRIDGE\b|\bRidge\b' "${TARGETS[@]}" 2>/dev/null \
  | grep -v '\.bak:' \
  | grep -vE 'mcp-bridge|HitlBridge|partridge|cartridge' \
  | head -10 || echo "  ✓ 잔존 없음"

echo ""
echo "—— 다음 단계 ——"
echo "  확인: diff $PLAN_DIR/00-CONTEXT.md.bak $PLAN_DIR/00-CONTEXT.md | head"
echo "  원복: for f in $PLAN_DIR/*.md.bak; do mv \"\$f\" \"\${f%.bak}\"; done"
echo "  확정: rm $PLAN_DIR/*.md.bak"
