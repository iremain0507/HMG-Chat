#!/usr/bin/env bash
# set-anthropic-key.sh — 로컬 dev 용 ANTHROPIC_API_KEY 를 .env.local 에 설정.
#   키는 "실행 시 숨김 입력"으로만 받는다 — 인자/로그/명령이력/커밋에 남지 않는다.
#   실행:  bash scripts/set-anthropic-key.sh   (프롬프트에 키 붙여넣고 Enter)
#   .env.local 은 .gitignore 라 커밋되지 않는다.
set -uo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENVF=".env.local"

printf "ANTHROPIC_API_KEY 를 붙여넣고 Enter (입력은 화면에 표시되지 않습니다): "
read -rs KEY
echo
[ -n "$KEY" ] || { echo "입력이 비어 있음 — 취소"; exit 1; }
case "$KEY" in
  sk-ant-*) ;;
  *) echo "경고: 'sk-ant-' 로 시작하지 않는 키입니다. 그래도 계속 진행합니다." ;;
esac

touch "$ENVF"
# 기존 ANTHROPIC_API_KEY 줄이 있으면 제거 후 새로 추가(중복 방지)
grep -v '^ANTHROPIC_API_KEY=' "$ENVF" > "$ENVF.tmp" 2>/dev/null || true
mv "$ENVF.tmp" "$ENVF"
printf 'ANTHROPIC_API_KEY=%s\n' "$KEY" >> "$ENVF"

echo "✓ .env.local 에 ANTHROPIC_API_KEY 설정 완료 (키 길이 ${#KEY}자, 값은 표시하지 않음)"
echo "  다음: dev 서버 재시작 후 실제 모델(Sonnet 5) 응답 확인"
