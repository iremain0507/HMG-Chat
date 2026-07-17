# LOOP PROMPT — Phase P20 (Open WebUI 대비 미개발/미흡 기능 완성 + 브라우저 실검증)

당신은 자율 코딩 루프의 한 반복(iteration)이다. 이전 반복의 기억은 없다. 상태는 파일과 git 에만 있다.
이번 phase 의 목표는 **`docs/OWUI-vs-WCHAT-AUDIT.md`(Open WebUI 대비 전수 비교)에서 드러난 ⚠️부분·dev-stub·격리 / ❌미개발 기능 중
큐레이션된 것들을 "실사용 무동작" 없이 완벽히 완성**하는 것이다. 태스크는 `feature_list.json` 의 `P20-*` (34개, T1=17·T2=4·T3=2·T6=11).
**최우선 = RAG 인덱싱 생산측 실배선 체인**(P20-T3-01→T1-01→T3-02→T1-02): 현재 검색·인용 소비측은 배선됐으나 인덱싱 생산측이 없어
첨부/지식 근거 답변이 **실사용 무동작**이다 — 이 체인이 이번 phase 의 flagship.

**필참**: `rebuild_plan/21-LOOP-LESSONS.md`(L1~L5) — 특히 **L1(유닛 green ≠ 실사용: 기능이 실 진입점·실 화면까지 도달하는지
createApp/브라우저로 단언)**, L2(열화·빈 인덱스·외부 미설정 조건), L3(FK/참조 무결성), L5(조용한 실패·타임아웃). CLAUDE.md 하드룰 준수.

## 0. 오리엔테이션 (매번)

1. `git log --oneline -15`, PROGRESS.md, `.ralph/current_phase`(=P20), `.ralph/blocked_tasks` 읽기.
2. 근거: `docs/OWUI-vs-WCHAT-AUDIT.md`(해당 기능의 갭·근거), `rebuild_plan/16-API-CONTRACT.md`(엔벨로프·에러), `rebuild_plan/14-INTERFACES.md`(frozen 타입),
   `apps/server/src/__tests__/routes-mounted.test.ts`(마운트 가드), T1 이면 최신 마이그레이션(현재 0027), T6 이면 `apps/web/DESIGN.md`.
3. `feature_list.json` 에서 `phase=="P20"`, `passes==false`, `.ralph/blocked_tasks` 에 **없는** 항목 중 **배열 최상단(최우선) 하나만** 선택.
   (`.ralph/last_fail.txt` 있으면 그 수정이 이번 태스크.) 배열은 의존성 순서 정렬(RAG 체인·grants 라우트→enforcement→UI 순).

## 1. 계약 (엄수)

- **신규 기능이다 — RED 필수**: 새 동작은 실패 테스트 먼저 → 실행으로 RED 확인(올바른 이유) → 최소 구현 → GREEN. 처음부터 통과하면 태스크 정의 재검토.
- **수정 금지(FROZEN)**: `packages/interfaces/**`(ChatEvent 12변형·ChatInput·RunTurnInput·Organization·User), `packages/shared/**`, `apps/web/src/lib/{api-client,api-types.generated}.ts`.
  → **신규 SSE 이벤트 금지**. `desc` 에 `★frozenRisk` 표시된 태스크(reasoningEffort provider 전달·Reasoning 스트림 등)가 frozen 수정을 요구하면 **구현하지 말고 즉시 격리**(§6, human gate). REST 로 우회 가능하면 우회.
  → 새 타입은 **LOCAL Zod + hand-rolled + hand-written fetch**(org-settings 방식).
- **신규 route → 반드시 `app.ts` 마운트 + `routes-mounted.test.ts` EXPECTED_ROUTES 추가**. 엔벨로프 + `isAdmin` 403(admin) + `orgId`=auth only(cross-org 불가) + hand-rolled 검증.
- **마이그레이션(0028~)**: nullable-first, 신규 테이블 `org_id`+RLS ENABLE/FORCE, cross-org 격리 테스트, rollback(dev=DROP, prod forward-only), 번호충돌 없음.
- **저장 재사용**: `allowedModels`·`allowedTools`·`defaultTokenBudgetMicros`=organizations 컬럼, org_settings=JSONB. `ephemeral_chunks`(0014)·`usage_logs`(0010)·`resource_grants`(0027)·`groups`(0026) 재사용.
- **Per-task 파일 소유권**: `feature_list.json` `files:` 힌트 안에서만. 공유 assembly(`app.ts`·`messages.ts`·`sessions.ts`·`org-settings-schema.ts`·`assemble-builtin-tools.ts`·`routes-mounted.test.ts`)는 한 반복 한 태스크로 순차 편집.

## 2. 브라우저 실검증 (이 phase 의 핵심 — 사용자 요구)

`desc` 에 **`★needsBrowser`** 표시된 태스크(프론트 상호작용 또는 admin 설정이 실제 화면·동작에 반영되어야 하는 기능)는 **"구현했지만 실사용 무동작"을 반드시 잡아야 한다**(RAG 갭이 그 예). 검증은 2겹:

- **(A) 루프 자동 검증(당신)**: 유닛(RTL) + **createApp 실HTTP 통합테스트**(server, 실 Postgres — 배선·영속·cross-org 를 확실히 잡음) + 가능하면 **실앱 Playwright E2E**(`apps/web/e2e/app/*.pw.ts`: dev-login(`GET /api/v1/auth/dev-login`)→실제 상호작용→단언). 실앱 E2E 하네스가 없으면 **먼저 최소 하네스(dev-login 픽스처 + 실행 스택 접속)를 만들고**, 로컬 스택(웹3000/서버4000)이 이 환경에서 미기동이면 E2E 는 작성만 하고 "미실행" 을 정직히 기록(과장 금지) + createApp 통합으로 배선을 대체 단언.
- **(B) watchdog 브라우저 UAT(운영자/사람)**: 헤드리스 루프는 대화형 브라우저 MCP 를 못 쓰므로, `★needsBrowser` 태스크는 운영자가 실 브라우저로 눌러보고 "미흡" 을 확인·보완하는 것을 전제한다. 당신은 그 UAT 가 가능하도록 **명확한 UAT 절차(어떤 화면에서 무엇을 클릭→무엇이 보여야 함)를 PROGRESS.md 에 1줄 남긴다**.
- **완료 기준**: `★needsBrowser` 태스크는 (A) 통합/유닛 green **+** 실앱 배선 근거(진입점 도달) 없이는 passes=true 금지. 실사용 반영을 유닛만으로 주장하지 말 것(L1).

## 3. 병렬 개발 (사용자 요구)

`desc` 에 **`병렬:...`** 힌트가 있거나 독립적 하위작업(예: server route + web UI, provider adapter 다종, indexer + INSERT)이 있으면, 한 반복 안에서 **서브에이전트(Agent 툴) 또는 agent-teams 로 병렬 개발**한 뒤 통합·게이트·커밋한다.

- 예: "server 라우트 구현" 과 "그 라우트를 소비하는 web UI" 를 두 서브에이전트에 동시 위임 → 계약(경로·응답 shape)을 먼저 고정하고 병렬 진행 → 통합 시 타입/테스트로 정합 확인.
- 병렬은 **독립적일 때만**(공유 파일 동시수정 금지 — 충돌). 통합 후 반드시 `verify-gates` 로 전체 정합 확인. 예산 내에서 사용.
- 단, **커밋·feature_list 갱신·게이트 통과 판단은 메인(당신)이 단독 수행**한다(서브에이전트에 위임 금지).

## 4. 팀별 구현 지침

- **T3(knowledge/RAG)**: 순수 함수 우선(indexer=parse→chunk→embed(dev-stub)→행 배열, DB 접근 없음). retrieval 포트는 기존 `search-service.hybridSearch`(vector+bm25+RRF, org topK/rrfK/threshold) 재사용. 임베딩은 `createDevStubEmbeddingProvider`(실 Voyage 미사용).
- **T1(server db/route)**: 마이그레이션 규칙(§1). 인덱싱 배선은 **업로드 트랜잭션과 분리 fail-soft**(인덱싱 실패해도 업로드 성공, L5 로깅). enforcement 는 조회 라우트에 `canAccessResource`(additive union) 적용 + 비허용 리소스 미노출 통합테스트. webhook·외부 알림은 dev-stub(실 URL 미발송).
- **T2(orchestrator)**: L1 last-mile — 클라 전송값→서버 파싱→provider/tool set 까지 end-to-end 도달 단언. `search_chats`/`view_chat`·`selectRelevantTools` 는 도구 조립 + createApp 턴에서 실 tool_use 방출 단언. frozenRisk(reasoningEffort/Reasoning 스트림)는 인터페이스 수정 필요 시 격리.
- **T6(apps/web)**: `lib/fetch-with-refresh`, 시맨틱 토큰만(하드코딩 hex 0), 라이트/다크, a11y, 낙관적+롤백. 상호작용 vitest RED→GREEN(SSE 스텁 `controller.close()`). `★needsBrowser` 는 §2 준수.

## 5. 검증 (커밋 전 필수)

- `bash scripts/verify-gates.sh` exit 0(typecheck·lint·test·state). 새 route 는 routes-mounted 가드 green. 마이그레이션 RLS+cross-org.
- **RAG/도구/enforcement**: createApp 실HTTP + 실 Postgres 통합테스트로 "실 배선·실 방출·실 격리" 단언(L1). 빈 인덱스/미설정 열화조건 포함(L2).
- **`★needsBrowser`**: §2 (A) + UAT 절차 기록. 실앱 E2E 미실행 시 정직히 명시.
- **실행하지 않은 검증을 통과했다고 서술하지 말 것.** 특히 "설정/기능이 실제 화면·runTurn·인덱스에 도달" 을 createApp/E2E 로 단언했는지 확인.

## 6. Blocker 격리 (루프를 멈추지 않는다)

- 막히면(attempts>=3, FROZEN(interfaces·shared·generated·ChatEvent·ChatInput) 수정 필요, 신규 SSE 이벤트 필요, 신규 dependency 필요, 표 밖 파일 필요, 외부 실 provider 필요, 실앱 E2E 불가):
  `.ralph/blocked_tasks` 에 `<task-id> | <한 줄 사유>` append 후 **같은 phase 의 다음 태스크로 진행**.
- `.ralph/BLOCKED`(루프 전체 정지)는 쓰지 않는다 — wrapper 전용.

## 7. 신호 (엄격 — 오탐 방지)

- 신호를 낼 때만 **출력 마지막 줄에 신호 문자열만 단독**으로. 안 낼 땐 어디에도 쓰지 말 것.
- P20 격리 안된 항목 전부 passes=true → `.ralph/PHASE_DONE` 에 `P20` 기록 후 마지막 줄 `<PHASE_COMPLETE:P20>` 단독 출력 종료.
- 남은 미완이 전부 격리 → 마지막 줄 `<PHASE_BLOCKED:P20>` 단독 출력 종료.
- 그 외(1개 완료, 다음 남음) → 신호 없이 간단 요약.
