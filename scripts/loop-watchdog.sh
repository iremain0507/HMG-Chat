#!/usr/bin/env bash
# loop-watchdog.sh — Ralph 루프 실행 중 "hung 테스트 프로세스"(vitest/playwright)를 감시·강제종료.
#   배경: SSE 스텁 ReadableStream 을 close() 안 하면 reader 가 done 을 못 받아 vitest 가 6분+ hang →
#   loop.sh 의 verify-gates(타임아웃 없음)가 멈춰 루프 전체가 정지. Playwright 도 브라우저/포트로 hang 가능.
#   ⚠️ 핵심 안전장치: 순수 `pgrep -f vitest` 는 claude 워커(PROMPT 텍스트에 "vitest" 포함)까지 매칭한다.
#   command 에 claude/loop.sh/loop-watchdog/PROMPT/verify 가 있는 프로세스는 **절대 죽이지 않는다**.
#   .ralph/loop.lock 이 사라지면(루프 종료) 자동 종료.
# 실행: bash scripts/loop-watchdog.sh &   (loop.sh 와 함께)
set -uo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG=.ralph/logs/watchdog.log
VITEST_TH="${VITEST_TH:-300}" # vitest 5분+ = hung (정상 <30s)
PW_TH="${PW_TH:-600}"         # playwright 10분+ = hung (정상 수 분)
INTERVAL="${INTERVAL:-30}"
mkdir -p .ralph/logs
echo "$(date +%FT%TZ) watchdog start (vitest>${VITEST_TH}s, playwright>${PW_TH}s, every ${INTERVAL}s)" >>"$LOG"

# etime([[dd-]hh:]mm:ss) → 초
etime_secs() {
  awk -F'[-:]' '{n=NF; s=$n; if(n>=2)s+=$(n-1)*60; if(n>=3)s+=$(n-2)*3600; if(n>=4)s+=$(n-3)*86400; print s}'
}

sweep() {
  ps -eo pid=,etime=,command= 2>/dev/null | while IFS= read -r pid etime cmd; do
    # 워커/래퍼/자기 자신 제외 — 실 테스트 프로세스만 대상
    case "$cmd" in
      *claude* | *loop.sh* | *loop-watchdog* | *"cat PROMPT"* | *scripts/verify* | *" grep "*) continue ;;
    esac
    th=0
    case "$cmd" in
      *vitest*) th=$VITEST_TH ;;
      *playwright*) th=$PW_TH ;;
      *) continue ;;
    esac
    secs=$(printf '%s' "$etime" | etime_secs)
    [ -z "${secs:-}" ] && continue
    if [ "$secs" -gt "$th" ] 2>/dev/null; then
      echo "$(date +%T) KILL hung pid=$pid etime=$etime (>${th}s): ${cmd:0:100}" >>"$LOG"
      kill -9 "$pid" 2>/dev/null || true
    fi
  done
}

# loop.lock 활성(=루프 실행 중) 동안만 감시. 미실행 시 60회(≈interval*60) 대기 후 종료.
idle=0
while :; do
  if [ -f .ralph/loop.lock ] && kill -0 "$(cat .ralph/loop.lock 2>/dev/null)" 2>/dev/null; then
    idle=0
    sweep
  else
    idle=$((idle + 1))
    [ "$idle" -ge 60 ] && break
  fi
  sleep "$INTERVAL"
done
echo "$(date +%FT%TZ) watchdog stop (loop ended)" >>"$LOG"
