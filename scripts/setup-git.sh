#!/usr/bin/env bash
# 신규 개발자 git identity 셋업 — rebuild_plan/10-DEV-WORKFLOW.md 부록 B 단일 출처.
set -euo pipefail

ORG_DOMAIN="wchat.dev"

# 기존 값 보존 가능
CUR_EMAIL=$(git config user.email 2>/dev/null || echo "")
CUR_NAME=$(git config user.name 2>/dev/null || echo "")

read -rp "사내 이메일 입력 (e.g. firstname.lastname@${ORG_DOMAIN})${CUR_EMAIL:+ [$CUR_EMAIL]}: " EMAIL
EMAIL=${EMAIL:-$CUR_EMAIL}
case "$EMAIL" in
  *@"${ORG_DOMAIN}") ;;
  *) echo "❌ 사내 이메일 (@${ORG_DOMAIN}) 만 허용"; exit 1 ;;
esac

read -rp "표시명 (e.g. 본명)${CUR_NAME:+ [$CUR_NAME]}: " NAME
NAME=${NAME:-$CUR_NAME}

git config user.email "$EMAIL"
git config user.name "$NAME"

# 자동 fast-forward only
git config pull.ff only
git config rebase.autoStash true

echo "✓ git user.email=$EMAIL  user.name=$NAME"
echo "  git hooks 활성화: pnpm install (core.hooksPath=.githooks, prepare → scripts/setup-hooks.sh)"
