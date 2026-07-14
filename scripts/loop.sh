#!/usr/bin/env bash
# Ralph-style fresh-context loop for Claude Code — autonomous phase progression.
# usage: MAX_ITERS=100 BUDGET_USD=3 bash scripts/loop.sh
#        HARD_GATES="P0.5 P9"  → 해당 phase 완료 시 무조건 정지
#        NOTIFY_CMD='curl -s -X POST -d "loop stopped" https://hooks.slack.com/...'  → 정지 시 알림
#        MAX_ITERS=1 → 태스크 하나만 수행하는 단발(next) 모드
set -uo pipefail
MAX_ITERS="${MAX_ITERS:-50}"
BUDGET_USD="${BUDGET_USD:-3}"
MODEL="${MODEL:-sonnet}"
HARD_GATES="${HARD_GATES:-P0.5}"
NOTIFY_CMD="${NOTIFY_CMD:-}"
SENTINEL_ALL="<ALL_TASKS_COMPLETE>"
FP_LIMIT=3
PLAN_DIR="rebuild_plan"
PHASE_ORDER=(P0 P0.5 P1 P2 P3 P4 P5 P6 P7 P8 P9 P10)
mkdir -p .ralph/logs .ralph/reports
touch PROGRESS.md .ralph/blocked_tasks
rm -f .ralph/BLOCKED .ralph/PHASE_DONE .ralph/fingerprints

notify() { [ -n "$NOTIFY_CMD" ] && sh -c "$NOTIFY_CMD" >/dev/null 2>&1 || true; }
next_phase() { local c="$1" i; for i in "${!PHASE_ORDER[@]}"; do
  [ "${PHASE_ORDER[$i]}" = "$c" ] && { echo "${PHASE_ORDER[$((i+1))]:-}"; return; }; done; echo ""; }

# 실행 잠금
if [ -f .ralph/loop.lock ] && kill -0 "$(cat .ralph/loop.lock 2>/dev/null)" 2>/dev/null; then
  echo "다른 루프가 실행 중 (PID $(cat .ralph/loop.lock)). 종료."; exit 1
fi
echo $$ > .ralph/loop.lock
trap 'rm -f .ralph/loop.lock' EXIT

# 명세 drift 감지
SPEC_MD5=$(find "$PLAN_DIR" -name '*.md' -type f 2>/dev/null | sort | xargs cat 2>/dev/null | md5sum | cut -d' ' -f1)
if [ -f .ralph/spec.md5 ] && [ "$SPEC_MD5" != "$(cat .ralph/spec.md5)" ]; then
  echo "⚠️  계획 문서 변경(spec drift). feature_list.json 재검토 후 'rm .ralph/spec.md5' 하고 재실행."
  notify; exit 1
fi
echo "$SPEC_MD5" > .ralph/spec.md5

for ((i=1; i<=MAX_ITERS; i++)); do
  echo "═══ Iteration $i @ $(date -u +%FT%TZ) [phase $(cat .ralph/current_phase 2>/dev/null || echo '?')] ═══" | tee -a .ralph/logs/run.log

  # phase 전용 프롬프트가 있으면 사용(예: PROMPT.P10.md), 없으면 기본 PROMPT.md
  PROMPT_FILE="PROMPT.$(cat .ralph/current_phase 2>/dev/null).md"
  [ -f "$PROMPT_FILE" ] || PROMPT_FILE="PROMPT.md"
  OUT=$(claude -p "$(cat "$PROMPT_FILE")" \
    --max-turns "${MAX_TURNS:-40}" --max-budget-usd "$BUDGET_USD" --model "$MODEL" \
    --output-format json 2>>.ralph/logs/run.log) || true
  echo "$OUT" | jq -r '.result // "(no result)"' > ".ralph/logs/iter-$i.md"
  echo "iter=$i cost=\$$(echo "$OUT" | jq -r '.total_cost_usd // 0')" >> .ralph/logs/run.log

  # 외부 oracle: 게이트 + 실패 지문 thrashing 탐지
  if bash scripts/verify-gates.sh > .ralph/gates.out 2>&1; then
    rm -f .ralph/last_fail.txt .ralph/fingerprints
  else
    tail -n 40 .ralph/gates.out > .ralph/last_fail.txt
    FP=$(grep '❌' .ralph/gates.out | md5sum | cut -d' ' -f1)
    echo "$FP" >> .ralph/fingerprints
    if [ "$(tail -n $FP_LIMIT .ralph/fingerprints | wc -l)" -ge "$FP_LIMIT" ] && \
       [ "$(tail -n $FP_LIMIT .ralph/fingerprints | sort -u | wc -l)" -eq 1 ]; then
      printf "동일 실패 %d회 연속 (thrashing).\n%s\n" "$FP_LIMIT" "$(cat .ralph/last_fail.txt)" > .ralph/BLOCKED
    fi
  fi

  # 종료·전이 신호 처리
  if grep -q "$SENTINEL_ALL" ".ralph/logs/iter-$i.md"; then
    echo "✅ ALL TASKS COMPLETE (iter $i)"; notify; break
  fi
  if grep -q "<PHASE_BLOCKED:" ".ralph/logs/iter-$i.md"; then
    echo "⛔ phase의 남은 태스크가 전부 격리됨 — .ralph/blocked_tasks 리뷰 필요"; notify; break
  fi
  if grep -q "<PHASE_COMPLETE:" ".ralph/logs/iter-$i.md"; then
    CUR=$(cat .ralph/current_phase)
    echo "── phase $CUR 완료 신호"
    if [ "${PHASE_VERIFY:-0}" != "1" ]; then
      echo "🚧 정지: phase $CUR 완료 — 사람이 직접 검증 후 .ralph/current_phase 수동 승급 (자동검증 원하면 PHASE_VERIFY=1)"
      notify; break
    fi
    echo "── 독립 검증(claude -p) 실행"
    PV=$(claude -p "$(cat PROMPT.phase.md)" \
      --max-turns 25 --max-budget-usd "$BUDGET_USD" --model "$MODEL" \
      --output-format json 2>>.ralph/logs/run.log) || true
    echo "$PV" | jq -r '.result // "(no result)"' > ".ralph/reports/PHASE_REPORT-$CUR.md"
    NEXT=$(next_phase "$CUR")
    if grep -q "PHASE_VERDICT: PASS" ".ralph/reports/PHASE_REPORT-$CUR.md" \
       && ! printf ' %s ' $HARD_GATES | grep -q " $CUR " \
       && [ -n "$NEXT" ]; then
      echo "$NEXT" > .ralph/current_phase
      rm -f .ralph/PHASE_DONE
      git add -A && git commit -m "loop: phase $CUR verified PASS → advance to $NEXT" >/dev/null 2>&1 || true
      echo "▶ phase $CUR PASS → $NEXT 자동 진행"
      continue
    fi
    [ -z "$NEXT" ] && echo "✅ 마지막 phase 완료" || \
      echo "🚧 정지: $( printf ' %s ' $HARD_GATES | grep -q " $CUR " && echo 'hard gate' || echo '검증 FAIL' ) — .ralph/reports/PHASE_REPORT-$CUR.md 리뷰 후 .ralph/current_phase 수동 승급"
    notify; break
  fi
  if [ -f .ralph/BLOCKED ]; then
    echo "⛔ BLOCKED — see .ralph/BLOCKED"; notify; break
  fi
done
[ "$i" -gt "$MAX_ITERS" ] 2>/dev/null && notify || true
