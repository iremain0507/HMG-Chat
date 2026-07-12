# Loop Setup Report — Claude Code

- **판정: READY**
- 일시: 2026-07-12 / Claude Code 버전: 2.1.207
- 탐지: `PM=pnpm`, `PLAN_DIR=rebuild_plan`, 저장소 루트 `/Users/iremain/Documents/claudecode/W-Chat`
- 계획 문서 매핑:
  - SPRINT_DOC = rebuild_plan/08-SPRINT-PLAN.md
  - INTERFACES_DOC = rebuild_plan/14-INTERFACES.md
  - API_DOC = rebuild_plan/16-API-CONTRACT.md
  - TDD_DOC = rebuild_plan/09-TDD-GUIDE.md
  - TEAMS_DOC = rebuild_plan/07-AGENT-TEAMS.md

## 검증 결과 표

| command                                             | exit | 결과                                                                                                                            |
| --------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------- |
| `claude --version` (>= 2.1.207)                     | 0    | PASS (2.1.207)                                                                                                                  |
| `bash rebuild_plan/scripts/lint-plan.sh` (STEP 0)   | 0    | PASS (lint-plan 통과)                                                                                                           |
| scripts 실행권한 (loop/verify-gates/validate-state) | 0    | PASS                                                                                                                            |
| `bash -n scripts/loop.sh`                           | 0    | PASS (문법)                                                                                                                     |
| `bash -n scripts/verify-gates.sh`                   | 0    | PASS (문법)                                                                                                                     |
| `bash -n scripts/validate-state.sh`                 | 0    | PASS (문법)                                                                                                                     |
| `jq . .claude/settings.json`                        | 0    | PASS (JSON 유효)                                                                                                                |
| PROMPT.md / PROMPT.init.md / PROMPT.phase.md 존재   | 0    | PASS                                                                                                                            |
| CLAUDE.md 존재                                      | 0    | PASS                                                                                                                            |
| `bash scripts/verify-gates.sh` → gate: typecheck    | 0    | PASS                                                                                                                            |
| `bash scripts/verify-gates.sh` → gate: lint         | 0    | PASS                                                                                                                            |
| `bash scripts/verify-gates.sh` → gate: test         | 0    | PASS                                                                                                                            |
| gate: state (validate-state)                        | —    | SKIPPED (feature_list.json 아직 없음 — init 이후 활성)                                                                          |
| gate: spec-lint (verify-gates 내부)                 | —    | SKIPPED (rebuild_plan/scripts/lint-plan.sh 실행권한 미설정. 읽기전용 계획 dir이라 chmod 안 함. 수동 `bash` 실행 시 PASS 확인됨) |

전체 `verify-gates.sh` 종합: **exit 0 (PASS)**.

## 생성 파일 (12)

- .claude/settings.json
- CLAUDE.md
- PROMPT.md, PROMPT.init.md, PROMPT.phase.md
- scripts/verify-gates.sh, scripts/validate-state.sh, scripts/loop.sh
- .claude/agents/planner.md, .claude/agents/verifier.md
- .claude/skills/implement-sprint-task-tdd/SKILL.md
- .claude/skills/migration-check/SKILL.md

추가 생성(상태/디렉토리): PROGRESS.md, .ralph/blocked_tasks(빈 파일),
.ralph/{logs,proposals,reports} 디렉토리.

## 병합 파일 (1)

- .gitignore — `.ralph/` 런타임 산출물 라인만 멱등 추가(중복 없음). 기존 규칙 삭제 없음.
  `.ralph/reports/`·`.ralph/blocked_tasks`는 리뷰 대상이라 ignore하지 않음.

## 제안 파일(.ralph/proposals)

- 없음 (기존 파일과 충돌 없어 직접 생성/병합).

## 비활성화한 기능과 이유

- **spec-lint 게이트**: `rebuild_plan/scripts/lint-plan.sh`에 실행권한(+x)이 없어 verify-gates 내
  `[ -x ... ]` 조건이 false → 게이트에서 건너뜀. 계획 디렉토리는 읽기전용 계약이라 chmod하지 않음.
  린터 자체는 정상(수동 `bash rebuild_plan/scripts/lint-plan.sh` → exit 0). 활성화하려면 사용자가
  `chmod +x rebuild_plan/scripts/lint-plan.sh` 실행.
- **settings.local.json / launch.json**: 기존 파일 그대로 유지, 읽거나 수정하지 않음.

## Blockers

- 없음 (하드 blocker 없음).

## 고정 컨텍스트(STEP 0-A)와의 차이

- 스택 일치: TypeScript/pnpm/Turborepo, apps/server(Hono)·apps/web(Next.js)·apps/converter-worker,
  packages/shared·packages/interfaces 모두 존재. 탐지 결과와 STEP 0-A 불일치 없음.
- P0.5 Contract Bootstrap는 hard human gate로 유지(HARD_GATES 기본값 P0.5).
- packages/shared·packages/interfaces Edit deny 규칙 유지(두 디렉토리 존재 확인).

## 이후 실행 순서 (사용자용)

1. (최초 1회) `claude -p "$(cat PROMPT.init.md)" --model opus`
   — feature_list.json 생성 + .ralph/current_phase=P0 초기화.
2. (파일럿) `MAX_ITERS=3 bash scripts/loop.sh` — 3회만 지켜보며 튜닝.
3. (본 실행, 오버나이트) `MAX_ITERS=100 NOTIFY_CMD='<슬랙 webhook curl>' bash scripts/loop.sh`
   — phase는 검증 PASS 시 자동 진행. 정지는 P0.5(hard gate)·검증 FAIL·전부 격리·thrashing에서만.
4. 아침 리뷰 루틴(비동기): `git log --oneline` → `.ralph/reports/PHASE_REPORT-*.md` →
   `.ralph/blocked_tasks`(격리 태스크 해소: 사유 처리 후 해당 줄 삭제) → 재실행.
5. P0.5는 사람이 직접 수행(integration owner 단일 PR). 완료 후 `.ralph/current_phase`를 P1로 승급.

- 격리 환경(devcontainer/worktree) 권장. `--dangerously-skip-permissions`는 devcontainer/VM 안에서만.
- `claude -p`는 별도 사용 크레딧 차감 — `/usage` 확인. HARD_GATES에 phase 추가로 정지점 확대 가능.
