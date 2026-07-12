# CLAUDE.md — Loop Engineering 대상 프로젝트

## Stack & commands

- Package manager: pnpm ONLY.
- Install: `pnpm install` / Test: `pnpm test` / Typecheck: `pnpm run typecheck` / Lint: `pnpm run lint`
- 게이트 일괄: `bash scripts/verify-gates.sh` (커밋 전 exit 0 필수)

## Source of truth (읽기 순서)

1. rebuild_plan/08-SPRINT-PLAN.md — phase/sprint 태스크 목록
2. rebuild_plan/14-INTERFACES.md — 타입/인터페이스 단일 출처. 여기 정의만 사용.
3. rebuild_plan/16-API-CONTRACT.md — REST API contract
4. rebuild_plan/09-TDD-GUIDE.md — 테스트 우선 규칙
5. rebuild_plan/07-AGENT-TEAMS.md — 팀별 경로 소유권 (path ownership)

## Path ownership (하드 규칙)

- 각 태스크는 담당 팀 디렉토리 안에서만 수정: T1=infra/,apps/server/src/{tools/sandbox,mcp,lib}/ ·
  T2=apps/server/src/orchestrator/ · T3=apps/server/src/knowledge/ · T4=artifacts ·
  T5=skills/ · T6=apps/web/src/
- `packages/shared`·`packages/interfaces` 수정이 필요한 태스크는 구현하지 말고 격리(blocked_tasks) 처리.

## Hard rules

- 테스트를 삭제·약화·우회하는 것은 어떤 이유로도 용납되지 않는다 (unacceptable).
- RED 증거 필수: 새 behavior의 테스트는 구현 전 반드시 올바른 이유로 실패해야 한다.
  테스트가 처음부터 통과하면 GREEN으로 간주하지 말고 task 정의를 재검토한다.
- 한 반복에 태스크 하나만. 현재 phase(.ralph/current_phase) 밖 태스크 선택 금지.
- 새 타입은 rebuild_plan/14-INTERFACES.md에 정의된 것만 사용, 없으면 해당 태스크 격리 처리.
- 새 dependency 추가는 계획 문서가 명시한 경우만. 미지정 의존성이 필요하면 격리 처리 (근거·대안 기록).
- 커밋 전 `bash scripts/verify-gates.sh` exit 0 필수.
- feature_list.json은 "passes"(false→true)와 "attempts"(+1)만 변경 허용. 항목 삭제·문구 수정 금지.
- git push/merge/rebase, 배포, secret, 외부 MCP, .env/lockfile 임의 수정 금지.
- 실행하지 않은 검증을 통과했다고 서술하지 말 것.

## 변경 유형별 추가 확인 (커밋 전 자가 점검)

- shared/interface 변경 → 즉시 격리 (human gate)
- migration/DDL/RLS → 롤백 경로 존재, nullable-first 확인
- auth/permission → cross-org 격리 테스트 포함 여부
- orchestrator/SSE → AbortSignal 전파·취소 테스트 포함 여부
- knowledge/RAG → citation 근거 테스트 포함 여부
- skills → semver·manifest 일관성 / MCP → scope·SSRF 방어

## Blocker 격리 프로토콜 (루프를 멈추지 않는다)

- 태스크가 막히면(attempts>=3, 사람 결정 필요, 공유 계약, secret, 미지정 의존성)
  `.ralph/blocked_tasks`에 `<task-id> | <사유>` 한 줄을 append하고 **같은 phase의 다음 태스크로 진행**한다.
- `.ralph/BLOCKED`(루프 전체 정지)는 쓰지 않는다 — 그것은 wrapper가 thrashing 등에서만 사용한다.

## Progress & phase protocol

- 시작 시 `git log --oneline -15`, PROGRESS.md, `.ralph/current_phase`, `.ralph/blocked_tasks` 읽기.
- 태스크 완료 시 PROGRESS.md 1줄 + git commit 1개.
- 현재 phase에서 격리되지 않은 항목이 전부 passes=true →
  `.ralph/PHASE_DONE`에 phase id 기록, 정확히 `<PHASE_COMPLETE:{phase}>` 출력 후 종료
  (wrapper가 독립 검증 후 자동 진행 또는 정지를 결정한다).
- 현재 phase의 남은 항목이 전부 격리 상태 → 정확히 `<PHASE_BLOCKED:{phase}>` 출력 후 종료.
- 전체 완료 시 정확히 `<ALL_TASKS_COMPLETE>` 출력.
