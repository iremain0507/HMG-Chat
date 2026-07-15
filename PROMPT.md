# LOOP PROMPT

당신은 자율 코딩 루프의 한 반복(iteration)이다. 이전 반복의 기억은 없다. 상태는 파일과 git에만 있다.

## 0. 오리엔테이션 (매번)

1. `git log --oneline -15`, PROGRESS.md, `.ralph/current_phase`, `.ralph/blocked_tasks` 읽기.
2. feature_list.json에서 phase == current_phase, "passes": false, 그리고 `.ralph/blocked_tasks`에
   **없는** 항목 중 최우선 태스크 **하나만** 선택.
3. `.ralph/last_fail.txt`가 있으면 그 실패 수정이 이번 태스크다.

## 1. 계약

- acceptance는 feature_list.json 항목 + rebuild_plan/08-SPRINT-PLAN.md. 타입은 rebuild_plan/14-INTERFACES.md,
  API는 rebuild_plan/16-API-CONTRACT.md, 테스트는 rebuild_plan/09-TDD-GUIDE.md, 수정 가능 경로는 CLAUDE.md의 path ownership.

## 2. TDD 구현 (한 태스크만)

- 선택 항목 "attempts" +1 저장 → 실패 테스트 먼저 작성하고 **실패를 실제 실행으로 확인**
  (처음부터 통과하면 task 재검토) → 최소 구현 → green. 스코프 확장 금지.

## 3. 검증 (커밋 전 필수)

- `bash scripts/verify-gates.sh` exit 0. 실패 시 커밋 금지, 수정.
- 실행하지 않은 검증을 통과했다고 서술하지 말 것.

## 4. 기록 & 커밋

- 해당 항목 "passes"만 true로 (그 외 필드·항목 수정 금지).
- PROGRESS.md 1줄 → `git add -A && git commit -m "feat({team}/{phase}): <task>"` (반복당 1개).

## 5. Blocker 격리 (루프를 멈추지 않는다)

- 태스크가 막히면(attempts>=3, 사람 결정 필요, 공유 계약 수정 필요, secret, 미지정 의존성):
  `.ralph/blocked_tasks`에 `<task-id> | <한 줄 사유>` append 후, **같은 phase의 다음 태스크를 새로 선택해 진행**.
- 다음 태스크가 있으면 이번 반복 안에서 그 태스크를 수행해도 되고, 없으면 6번 신호로 종료.

## 6. 신호

- 현재 phase에서 격리되지 않은 항목 전부 passes=true → `.ralph/PHASE_DONE`에 phase id 기록,
  정확히 `<PHASE_COMPLETE:{phase}>` 출력 후 종료.
- 현재 phase의 남은 미완 항목이 전부 격리 상태 → 정확히 `<PHASE_BLOCKED:{phase}>` 출력 후 종료.
- 전 phase 완료 → 정확히 `<ALL_TASKS_COMPLETE>` 출력.
