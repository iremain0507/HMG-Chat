#!/usr/bin/env bash
# git hook 활성화 — 클론 직후 1회 실행.
# core.hooksPath 를 .githooks/ 로 지정하여 버전 관리되는 훅이 동작하게 한다.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

git config core.hooksPath .githooks
chmod +x .githooks/* scripts/*.sh 2>/dev/null || true

echo "✓ git hooks 활성화됨: core.hooksPath=.githooks"
echo "  - pre-commit: 개발(맥 미니 로컬)/배포(AWS) 규칙 검사 (scripts/check-dev-deploy-rules.sh)"
