## Phase P2 검증 보고서

### 1. `.ralph/current_phase` / `PHASE_DONE`

- `current_phase` = `P2`, `.ralph/PHASE_DONE` = `P2` (이미 완료로 기록됨)
- `.ralph/blocked_tasks`에는 P0-T1-01(AWS) 항목만 있음 — P2 관련 격리 항목 없음

### 2. feature_list.json — P2 항목 7개 전부 `passes: true`

P2-T1-01, P2-T1-02, P2-T2-01~05, P2-T6-01

### 3. 자동화 게이트 (직접 실행 결과)

- `pnpm typecheck` — PASS (6/6 캐시 hit, 전부 성공)
- `pnpm lint` — PASS (4/4 성공)
- `pnpm test` (server 단위 16 files/59 tests 포함) — PASS
- `pnpm exec vitest run --dir src/__tests__/integration --no-file-parallelism` — PASS (12/12, 문서화된 파일-병렬 race flake 재확인, `pnpm run test` 게이트 자체는 integration을 애초에 제외하므로 게이트에 영향 없음)
- `bash scripts/verify-gates.sh` / `validate-state.sh` / `lint-plan.sh` — 세션 권한상 직접 실행 불가(승인 거부), PROGRESS.md에 기록된 것과 동일한 제약. UNVERIFIED (Stop hook 위임 부분, P1 때도 동일했던 기존 제약이라 이 자체로 FAIL 처리하지 않음)

### 4. Acceptance별 판정

| 항목                                                 | acceptance (feature_list)                                       | 판정                       | 근거                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------- | --------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P2-T1-01                                             | 0002 마이그레이션, sessions/messages RLS                        | PASS                       | `pnpm db:migrate` exit 0, 정적 6 tests + RLS 통합 4 tests 통과                                                                                                                                                                                                           |
| P2-T1-02                                             | active_runs enum 전이                                           | PASS                       | 정적 4 tests + 통합 4 tests 통과                                                                                                                                                                                                                                         |
| P2-T2-01                                             | orchestrator skeleton 흐름                                      | PASS                       | orchestrator.test.ts 3 tests 통과                                                                                                                                                                                                                                        |
| P2-T2-02                                             | 4계층 prompt 우선순위                                           | PASS                       | prompt-builder.test.ts 4 tests 통과                                                                                                                                                                                                                                      |
| P2-T2-03                                             | LLMProvider Anthropic 계약                                      | PASS                       | llm-provider-anthropic.test.ts 5 tests 통과                                                                                                                                                                                                                              |
| P2-T2-04 (task 단위)                                 | messages.test.ts 통과                                           | PASS                       | 격리된 Hono 앱 기준 3 tests 통과                                                                                                                                                                                                                                         |
| P2-T2-04/05 (**Phase Gate**, 08-SPRINT-PLAN §Phase2) | "사용자가 채팅에 메시지 보내면 SSE 로 응답 받음"                | **FAIL**                   | `apps/server/src/app.ts`가 `/health`, `/api/v1/_ping`만 등록하고 `routes/{auth,messages,sessions}.ts`를 전혀 mount하지 않음(직접 소스 확인). `index.ts`도 `createApp()`만 호출. 실제 서버 기동 시 `/api/v1/sessions/:id/messages`는 404 — 이 흐름은 물리적으로 발생 불가 |
| P2-T2-05 (**Phase Gate**)                            | "Stop 클릭 시 서버 잡 즉시 중단 + active_runs.status=cancelled" | **FAIL**                   | 동일 이유로 `DELETE /api/v1/sessions/:id/active-run`도 실제로 라우팅되지 않음. abort.test.ts는 격리된 Hono 인스턴스에서만 검증                                                                                                                                           |
| P2-T6-01                                             | dev에서 SSE 흐름 표시 + Stop 즉시 중단                          | **UNVERIFIED→사실상 FAIL** | ChatView RTL 테스트는 `fetch` mock 기반이라 통과하지만, `apps/web/next.config.ts`의 proxy(`/api/:path*` → `localhost:4000/api/:path*`)가 겨냥하는 실제 서버 엔드포인트가 존재하지 않아 실브라우저 E2E는 불가능. PROGRESS.md도 "curl/E2E 검증 못 함"을 반복적으로 자인    |

### 5. 근본 원인

`app.ts`(라우트 등록)는 05/03 문서상 "라우트 등록, 미들웨어 체이닝" 담당 파일이지만, 07-AGENT-TEAMS.md의 T1~T6 path ownership 표 어디에도 명시적으로 귀속되어 있지 않다. 그 결과 P1-T1-05(auth.ts), P2-T2-04(messages.ts), P2-T2-05(sessions.ts) 세 태스크 모두 PROGRESS.md에서 "app.ts 마운트는 이 태스크 범위 밖"이라 개별적으로 스코프 아웃했고, 이를 책임질 태스크가 끝내 존재하지 않았다. 이 gap이 `.ralph/blocked_tasks`에도 기록되지 않은 채 P2 전체가 `passes=true`/`PHASE_DONE`으로 넘어갔다.

### 6. 격리 항목 요약

P2 관련 격리 항목 없음(문제 자체가 미기록 상태) — 이것이 이번 검증의 핵심 결함.

### 7. 다음 phase 리스크

P3(Projects & Members)부터는 세션/메시지 위에 project 권한이 얹히는데, 현재 기반이 되는 채팅 SSE 흐름 자체가 실제로 동작하지 않는 상태다. 이 gap을 메우지 않고 진행하면 이후 phase의 "Gate"들도 계속 단위 테스트 차원에서만 그린으로 처리되고, 실제 사용자 흐름 검증은 계속 스킵될 위험이 크다.

### 권고

`app.ts`에 `routes/{auth,sessions,messages}.ts`를 mount하는 태스크를 (인터페이스/공유 계약 변경이 아니므로 T2 혹은 integration owner 담당으로) 신설하고, 그 전까지 P2의 두 Phase Gate 항목을 `.ralph/blocked_tasks`에 등록한 뒤 P2를 미완료로 되돌리는 것을 권장.

PHASE_VERDICT: FAIL
