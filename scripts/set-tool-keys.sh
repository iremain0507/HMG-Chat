#!/usr/bin/env bash
# set-tool-keys.sh — 로컬 dev 용 내장 도구 API 키(TAVILY_API_KEY / E2B_API_KEY)를 .env.local 에 설정.
#   키는 "실행 시 숨김 입력"으로만 받는다 — 인자/로그/명령이력/커밋에 남지 않는다(secret 안전).
#   각 프롬프트에 키를 붙여넣고 Enter. 빈칸이면 그 키는 건너뛴다(기존 값 보존).
#   실행:  bash scripts/set-tool-keys.sh
#   대상 파일 변경:  ENV_FILE=apps/server/.env.local bash scripts/set-tool-keys.sh
#   .env.local 은 .gitignore 라 커밋되지 않는다. (ANTHROPIC 은 scripts/set-anthropic-key.sh)
set -uo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENVF="${ENV_FILE:-.env.local}"
touch "$ENVF"

# KEY=VALUE 를 upsert — 기존 줄이 있으면 교체, 없으면 추가. 값은 재출력하지 않는다.
upsert() {
  local key="$1" val="$2"
  grep -v "^${key}=" "$ENVF" > "$ENVF.tmp" 2>/dev/null || true
  mv "$ENVF.tmp" "$ENVF"
  printf '%s=%s\n' "$key" "$val" >> "$ENVF"
}

# prompt <ENV_KEY> <설명> <기대 접두사>
prompt_key() {
  local key="$1" desc="$2" prefix="$3" val=""
  printf '%s (%s)\n' "$key" "$desc"
  printf '  붙여넣고 Enter (빈칸=건너뜀, 화면에 표시 안 됨): '
  read -rs val; echo
  if [ -z "$val" ]; then
    echo "  · 건너뜀 (기존 값 유지)"
    return 1
  fi
  case "$val" in
    "$prefix"*) ;;
    *) echo "  경고: '${prefix}' 로 시작하지 않는 키입니다 — 계속 진행합니다." ;;
  esac
  upsert "$key" "$val"
  echo "  ✓ 설정됨 (길이 ${#val}자, 값은 표시하지 않음)"
  return 0
}

echo "▶ 내장 도구 API 키 설정 → $ENVF"
echo

count=0
prompt_key TAVILY_API_KEY "web_search / deep_research 실 웹검색 — https://tavily.com (무료 티어)" "tvly-" \
  && count=$((count + 1))
echo
if prompt_key E2B_API_KEY "code_interpreter 실 샌드박스(선택) — https://e2b.dev" "e2b_"; then
  count=$((count + 1))
  echo "    참고: e2b SDK 미설치 상태 — 코드실행 실사용 전 'pnpm install' 필요."
fi

echo
if [ "$count" -gt 0 ]; then
  chmod 600 "$ENVF" 2>/dev/null || true
  echo "완료: ${count}개 키를 ${ENVF} 에 저장."
  echo "  다음: dev 서버 재시작(tsx watch 는 .env 변경으로 자동 재시작하지 않음) 후"
  echo "        '디크팩토리 조사해줘' 재시도 → 실제 검색 결과로 응답."
else
  echo "설정된 키 없음(모두 건너뜀) — 변경 없음."
fi
