# LOOP PROMPT — Phase P14 (Admin Settings — 하드코딩 설정의 org-scoped Admin화)

당신은 자율 코딩 루프의 한 반복(iteration)이다. 이전 반복의 기억은 없다. 상태는 파일과 git 에만 있다.
이번 phase 의 목표는 **현재 코드에 하드코딩된 LLM/시스템 설정을 org 단위로 admin 이 설정할 수 있게** 만드는 것이다.
**트리거 버그**: `apps/server/src/routes/messages.ts:272` 이 `maxTokens: deps.maxTokens ?? 1024` 이고 `app.ts` 가
`createMessageRoutes` 에 `maxTokens` 를 넘기지 않아 **모든 채팅 답변이 1024 토큰에서 잘린다**. 이 phase 가 그 근본해결이자 일반화다.
**참조 정본**: GitHub `open-webui/open-webui` 의 admin 설정을 **큐레이션**한 결과(아래 §설정목록). Open WebUI 를 그대로 복제하지 말고,
사내 Hyundai WIA 엔터프라이즈 에이전틱 챗에 맞는 부분집합만 채택한다. 태스크는 feature_list.json 의 `P14-*`.
**필참**: `rebuild_plan/21-LOOP-LESSONS.md`(L1~L5) — 특히 **L1(유닛 green ≠ 실사용: 설정이 runTurn 까지 실제 도달하는지 end-to-end 로 단언)**,
L2(열화 조건: 행 없음/캐시 콜드/JSON 손상/DB 오류 → 안전기본값, 절대 1024/500 아님), L5(조용한 실패 금지). CLAUDE.md 의 하드룰·migration/RLS/cross-org 체크리스트 준수.

## 0. 오리엔테이션 (매번)

1. `git log --oneline -15`, PROGRESS.md, `.ralph/current_phase`(=P14), `.ralph/blocked_tasks` 읽기.
2. 이번 태스크의 근거 파일을 읽는다: `rebuild_plan/16-API-CONTRACT.md`(엔벨로프·에러코드), `rebuild_plan/14-INTERFACES.md`(frozen 타입),
   `apps/server/src/__tests__/routes-mounted.test.ts`(마운트 가드), 그리고 T1 이면 `.claude/skills/migration-check`(마이그레이션 규칙),
   T6 이면 `apps/web/DESIGN.md`(WIA CI 토큰) + `apps/web/src/app/admin/tool-metrics`(형제 화면 패턴).
3. feature_list.json 에서 `phase=="P14"`, `passes==false`, `.ralph/blocked_tasks` 에 **없는** 항목 중 **배열 최상단(최우선) 하나만** 선택.
   (`.ralph/last_fail.txt` 있으면 그 수정이 이번 태스크.) 항목은 의존성 순서로 정렬돼 있으니 최상단이 곧 다음 작업이다.

## 1. 계약 (엄수)

- **신규 기능이다 — RED 필수**: 새 동작(마이그레이션 제외 모든 코드 태스크)은 **실패 테스트 먼저 → 실행으로 RED 확인(올바른 이유로) → 최소 구현 → GREEN**.
  처음부터 통과하면 GREEN 으로 보지 말고 태스크 정의를 재검토한다.
- **저장 모델(설계 정본)**: 새 테이블 `org_settings`(1:1 organizations, `settings JSONB DEFAULT '{}'`, `updated_by`, `updated_at`).
  설정 부분패치를 JSONB 로 저장하고 없는 키는 코드 기본값. 검증·기본값·타입은 **`apps/server/src/lib/org-settings-schema.ts`(LOCAL Zod)** 단일 출처.
  `allowedModels`·`allowedTools`·`defaultTokenBudgetMicros` 는 **기존 `organizations` 컬럼 재사용**(새 저장 안 만듦).
- **수정 금지(FROZEN) — 필요하면 구현 말고 격리(§6)**: `packages/interfaces/**`(특히 `types.ts` 의 `Organization`, `LLMProvider.ts` 의 `ChatInput`),
  `packages/shared/**`, `apps/web/src/lib/{api-client,api-types.generated}.ts`. 이 phase 는 이들을 **건드리지 않도록 설계**됐다(로컬 Zod + hand-rolled 검증 + hand-written fetch).
- **신규 route**: `GET`·`PUT /api/v1/admin/settings` — **반드시 `app.ts` 의 이미 마운트된 adminApp 에 route 추가 + `routes-mounted.test.ts` 의 `EXPECTED_ROUTES` 에 두 항목 추가**.
  계약(16) 의 `{data,meta:{requestId}}` 엔벨로프 + `isAdmin` 403 게이트 + hand-rolled 검증 컨벤션(기존 `routes/admin.ts`)을 따른다.
- **Per-task 파일 소유권 (이 phase 명시 — assembly-root 파일은 태스크별로 배정)**. 아래 표의 파일 밖을 수정해야 하면 격리:

  | task            | 편집 허용 파일                                                                                                                                              |
  | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | P14-T1-01       | `apps/server/src/db/migrations/0017_org_settings.sql` (+ `meta/_journal.json`)                                                                              |
  | P14-T1-02       | `apps/server/src/db/org-settings-data-access.ts`, `apps/server/src/db/auth-data-access.ts`(organizations.update 확장)                                       |
  | P14-T1-03       | `apps/server/src/lib/org-settings-schema.ts`                                                                                                                |
  | P14-T1-04       | `apps/server/src/lib/settings-service.ts`                                                                                                                   |
  | P14-T1-05       | `apps/server/src/routes/admin-settings.ts`, `apps/server/src/app.ts`(마운트만), `apps/server/src/__tests__/routes-mounted.test.ts`                          |
  | P14-T2-01       | `apps/server/src/routes/messages.ts`, `apps/server/src/app.ts`(createMessageRoutes deps)                                                                    |
  | P14-T2-02       | `apps/server/src/app.ts`(assembleBuiltinTools 인자), `apps/server/src/orchestrator/memory-extractor.ts`                                                     |
  | P14-T3-01       | `apps/server/src/tools/handlers/knowledge-search-handler.ts`, `apps/server/src/knowledge/search-service.ts`                                                 |
  | P14-T3-02       | `apps/server/src/knowledge/chunker.ts`                                                                                                                      |
  | P14-T6-01/02/03 | `apps/web/src/app/admin/settings/**`, `apps/web/src/components/admin/settings/**`, `apps/web/src/app/preview/page.tsx`, `apps/web/e2e/admin-settings.pw.ts` |

  `app.ts` 는 T1-05·T2-01·T2-02 가 공유하니 **한 반복에 한 태스크** 규칙으로 순차 편집(각자 직전 위에 rebase)한다.

- **ISOLATE(런타임만 격리, 저장+UI 는 in-scope)**: `topP` 런타임(→ frozen `ChatInput` 필요), `defaultUserRole`·`enableSignup` 런타임(→ env `ALLOWED_DOMAINS`/auth 결합, L4).
  이 세 개는 org_settings 저장과 화면 노출까지만 하고, **런타임 반영 태스크는 `.ralph/blocked_tasks` 에 사유와 함께 격리**한다(UI 에는 "아직 미적용/env 관리" 힌트 표기).

## 2. 팀별 구현 지침 (한 태스크만)

- **T1(플랫폼/공통 — migration·db·lib·route)**
  - 마이그레이션(0017): nullable-first(기존 테이블 변경 없음, `settings` 는 `DEFAULT '{}'`), 번호충돌 없음(최신 0016), rollback=dev/staging 는 `DROP TABLE org_settings`(prod forward-only).
    RLS `ENABLE`+`FORCE`, select 정책=같은 org(`NULLIF(current_setting('app.org_id',true),'')::uuid`), modify 정책=같은 org **AND `current_user_is_admin()`**. `touch_updated_at` 트리거. **cross-org 격리 테스트**(org A admin 은 자기 행만, org B 불가) 필수.
  - schema/service: 손상/부재/DB오류 시 `logger.warn` + `DEFAULT_ORG_SETTINGS` 반환(**절대 throw 금지, 절대 1024 폴백 금지** — L2/L5). `maxTokens` 기본값은 **4096**.
  - route: `orgId` 는 **auth 에서만**(body/query 금지 → cross-org 불가), PUT 은 `OrgSettingsSchema.partial()` 검증(실패 시 400 + issue details) → upsert → `settingsService.invalidate(org)`. createApp 기반 실HTTP 통합테스트로 403(비admin)/400(잘못된 body)/cross-org 차단/엔벨로프 검증.
- **T2(orchestrator 배선 — 버그 근본해결)**
  - `MessageRouteDeps` 에 settings resolver 주입, `messages.ts:272` 의 `?? 1024` 를 **resolved.maxTokens(안전기본 4096)** 로 교체, `temperature`·`systemPrompt`(system-tier PromptBlock 를 systemBlocks 앞에)·`defaultModel`(단 org.allowedModels 검증 유지) 반영. `app.ts` 가 `settingsService.resolve` 를 넘긴다.
  - **L1 last-mile 단언 필수**: createApp 기반 채팅 턴에서 org 설정 maxTokens=8192 → `runTurn`/`ChatInput` 이 **8192 를 실제 수신**(1024 아님)함을 단언. 설정 부재 시 **≥4096**(1024 아님). SSE 가 정상 종료(stop)까지 회귀 확인.
  - toolMaxTokens: `app.ts:187`(4096)·`memory-extractor.ts:68`(1024) 를 설정값으로.
- **T3(knowledge/RAG 배선)**
  - 내장 도구는 `app.ts` 에서 **정적 조립**되므로, per-org RAG 값은 **invoke 시점에 `ctx.orgId` 로 resolve**(정적 기본값을 조용히 쓰지 않도록 — L1). `knowledge-search-handler.ts:69-70` 의 `?? 10`/`?? 60` 및 threshold 를 설정 기반으로. chunker 기본(800)도 index 시 설정에서.
  - RED: org ragTopK=12 → hybridSearch 가 topK=12 로 호출(10 아님) 단언.
- **T6(apps/web — 설정 화면, P13 방식 그대로)**
  - `app/admin/settings/page.tsx`(`<AdminGuard>` 안, admin|owner), `components/admin/settings/AdminSettingsScreen`(7탭 셸 + GET 로드 via `lib/fetch-with-refresh` + dirty 추적 + sticky Save). 저장=PUT(낙관적 + 실패 롤백 + toast, 위험한 하향은 confirm).
  - **시맨틱 토큰만(하드코딩 hex 0)**, 라이트·다크 양쪽, 포커스 링, a11y. 검증은 preview 갤러리 등록 + `e2e/admin-settings.pw.ts` Playwright 라이트/다크 스크린샷 + 신규 상호작용 vitest RED→GREEN(SSE 스텁 쓰면 `controller.close()` 필수, jsdom 헤더).

## 3. 참조: 큐레이션한 설정(7탭, Open WebUI → WChat 매핑, 기본값)

- **Models & Generation**: `maxTokens`(4096, ←messages.ts:272 버그), `temperature`(0.7), `topP`(0.9, 런타임 ISOLATE), `defaultModel`(←app.ts:166), `systemPrompt`(""), `allowedModels`(organizations 컬럼), `toolMaxTokens`(4096).
- **Knowledge/RAG**: `ragTopK`(10, ←handler:69), `ragRrfK`(60, ←handler:70), `ragChunkSizeTokens`(800), `ragChunkOverlapTokens`(100), `ragHybridEnabled`(true), `ragRelevanceThreshold`(0.0).
- **Web Search**: `webSearchEnabled`(false), `webSearchResultCount`(3).
- **Connectors/MCP**: `enableDirectConnections`(false), `allowedTools`(organizations 컬럼).
- **General/Branding**: `instanceName`("WChat"), `banner`(""), `responseWatermark`("").
- **Users & Permissions**: `defaultUserRole`(member, 런타임 ISOLATE), `enableSignup`(false, 런타임 ISOLATE).
- **Quota/Limits**: `defaultTokenBudgetMicros`(null, organizations 컬럼), `maxUploadSizeMb`(25), `maxUploadCount`(10).

## 4. 검증 (커밋 전 필수)

- `bash scripts/verify-gates.sh` exit 0 (typecheck·lint·test·validate-state). 새 route 는 routes-mounted 가드 green.
- **서버**: 계약 흐름(403/400/cross-org)은 createApp 실HTTP 통합테스트. 마이그레이션은 RLS + cross-org 격리 테스트.
- **T6**: `bash scripts/verify-browser.sh` 통과(라이트/다크 스크린샷 `.ralph/screenshots/`). 브라우저 검증 불가 환경이면 그 태스크 격리(통과 서술 금지).
- **실행하지 않은 검증을 통과했다고 서술하지 말 것.** 특히 L1: "설정이 실제로 runTurn 에 도달"을 유닛이 아니라 createApp 경로로 단언했는지 확인.

## 5. 기록 & 커밋

- 해당 항목 `passes` 만 true 로(그 외 필드·항목 수·문구 수정 금지).
- PROGRESS.md 1줄 → `git add -A && git commit -m "feat(<team>/P14): <task>"` (반복당 커밋 1개). 원격 push/merge/rebase 금지.

## 6. Blocker 격리 (루프를 멈추지 않는다)

- 막히면(attempts>=3, 사람 결정 필요, FROZEN(packages/interfaces·shared·generated) 수정 필요, 표 밖 타 파일 편집 필요, env-coupled 런타임[topP·defaultUserRole·enableSignup], 브라우저 검증 불가, 미지정 의존성):
  `.ralph/blocked_tasks` 에 `<task-id> | <한 줄 사유>` append 후 **같은 phase 의 다음 태스크로 진행**.
- `.ralph/BLOCKED`(루프 전체 정지)는 쓰지 않는다 — wrapper 전용.

## 7. 신호 (엄격 — 오탐 방지)

- 신호를 낼 때만, **출력의 마지막 줄에 신호 문자열만 단독**으로(앞뒤 텍스트·백틱·따옴표 없이) 쓴다. 안 낼 땐 신호 문자열을 출력 어디에도(설명·부정문 포함) 쓰지 말 것.
- P14 에서 격리 안된 항목 전부 passes=true → `.ralph/PHASE_DONE` 에 `P14` 기록 후 마지막 줄에 `<PHASE_COMPLETE:P14>` 단독 출력하고 종료.
- P14 의 남은 미완 항목이 전부 격리 → 마지막 줄에 `<PHASE_BLOCKED:P14>` 단독 출력하고 종료.
- 그 외(태스크 1개 완료, 다음 남음) → 신호 없이 간단 요약만 출력.
