# LOOP PROMPT — Phase P22 (Open WebUI 파리티 + in-plan 완성 — 미개발·미완료 기능 전수 구현)

당신은 자율 코딩 루프의 한 반복(iteration)이다. 이전 반복의 기억은 없다. 상태는 파일과 git 에만 있다.
이번 phase 의 목표는 **`docs/P22-GAP-CATALOG.md`(딥리서치로 확정된 갭 대장)에 정의된 "미개발(undeveloped)·미완료(incomplete)" 기능을 표준대로 완전히 구현**하는 것이다.
근거는 Workflow `wchat-gap-research` 가 (1) Open WebUI 8도메인 census + (2) rebuild_plan 의도범위 + (3) 코드베이스 감사 를 교차하고 **갭마다 코드베이스로 adversarial 검증**(이미 구현됐는지 반증)해 확정한 47 + 미검증 4 이다.
태스크는 `feature_list.json` 의 `P22-*` (49개: Tier1 in-plan 15 · Tier2 OWUI 파리티 13 · Tier0 계약배치 1 · Tier3 계약의존 20).

**스코프 규칙(사용자 확정)**:

- **Open WebUI 에 실제 개발된 기능이면 v2 로드맵 라벨이어도 개발 범위에 포함**(멀티모델·음성·i18n·채널·노트·시각화 등).
- **구현방식·사용자 상호작용·UI/UX 는 Open WebUI 를 레퍼런스**로 삼는다(플로우·인터랙션 패턴·정보구조). **단** 시각 디자인은 `apps/web/DESIGN.md` 시맨틱 토큰 + 현대위아 CI 유지(하드코딩 hex 0, 공식 로고 재현 금지).
- **제외(배포/human-gate·비-OWUI)**: `aws-provisioning`·`ga-release-gate`·`a11y-playwright-gate` 는 P22 태스크가 아니라 기존 blocked(배포시 human gate). 신규로 만들지 말 것.

**필참**: `rebuild_plan/21-LOOP-LESSONS.md`(L1~L5) — 특히 **L1(유닛 green ≠ 실사용: 실제 화면·실제 이벤트로 동작을 단언)**. "테스트가 통과한다"가 아니라 "실제로 그 기능이 화면에서 동작한다"를 브라우저로 확인. CLAUDE.md 하드룰 준수.

## 0. 오리엔테이션 (매번)

1. `git log --oneline -15`, PROGRESS.md, `.ralph/current_phase`(=P22), `.ralph/blocked_tasks`, `.ralph/CONTRACT_PENDING`·`.ralph/CONTRACT_APPROVED`(있으면) 읽기.
2. 근거 문서: **`docs/P22-GAP-CATALOG.md`**(§`P22-*` 마다 file:line 근거·구현지침·acceptance·browser/계약 플래그 — 이 태스크의 단일 출처), `rebuild_plan/14-INTERFACES.md`(타입 단일출처), `rebuild_plan/16-API-CONTRACT.md`(REST 계약), `rebuild_plan/07-AGENT-TEAMS.md`(팀별 path ownership), `apps/web/DESIGN.md`(디자인 토큰), `playwright.config.ts`(/preview → :3100).
3. `feature_list.json` 에서 `phase=="P22"`, `passes==false`, `.ralph/blocked_tasks` 에 **없는** 항목 중 **배열 최상단(최우선) 하나만** 선택.
   - **배열 순서 = 우선순위**: Tier1(즉시 빌드) → Tier2(즉시 빌드) → **P22-C-01(계약배치, 휴먼게이트)** → Tier3(계약의존). 이 순서를 지켜라(자율 가능 작업을 먼저 소진한 뒤 사람 게이트에 도달).
   - **`△UNVERIFIED` 태스크**(desc 에 표시: P22-T6-04/T6-11/T6-20/T1-17): 구현 전 **먼저 코드베이스로 실재를 재확인**. 이미 구현돼 있으면(가짜 갭) `passes=true` 로 두지 말고 acceptance 를 "이미 구현됨"으로 격리 처리(blocked_tasks 에 사유 기록)하고 다음으로.
   - **`★계약의존` 태스크**(Tier3): `.ralph/CONTRACT_APPROVED` 가 없으면 **구현 금지 → 격리**(§2). 있으면 승인 화이트리스트 범위 내에서만 진행.

## 1. 계약 (엄수)

- **RED 필수(새 behavior)**: 갭마다 "구현된 동작"의 테스트를 먼저 작성 → 실행으로 **RED 확인(올바른 이유: 현재 미구현/스텁이라 실패)** → 최소 구현 → GREEN. **처음부터 통과하면** 갭이 이미 채워졌다는 뜻이니 시나리오/기대를 재검토(false-positive 방지, 카탈로그의 `org-dynamic-toolmaxtokens` 사례처럼).
- **Path ownership = 태스크 `team` 디렉토리 안에서만**(rebuild_plan/07):
  - T1 = `apps/server/src/{routes,tools/sandbox,mcp,lib}/`, `infra/`, `scripts/` · T2 = `apps/server/src/orchestrator/` · T3 = `apps/server/src/knowledge/` · T4 = `apps/server/src/{routes/artifacts,routes/artifact-shares,routes/public-share}.ts` + `apps/web/src/components/artifacts/` · T5 = `skills/`, `apps/server/src/tools/skills-engine.ts` · T6 = `apps/web/src/`.
  - `feature_list` `team` 과 카탈로그 `대상 파일(힌트)` 밖 파일이 필요하면 격리(§6).
- **FROZEN(직접 수정 금지)**: `packages/interfaces/**`·`packages/shared/**`·`apps/web/src/lib/{api-client,api-types.generated}.ts`·DB migration. 이들이 필요한 태스크는 **`★계약의존`** 으로 표시돼 있고, **`P22-C-01` 계약배치 승인(§2) 전에는 구현 금지**. 승인 후 화이트리스트 범위만 편집.
- **신규 dependency**: 계획 문서가 명시한 것만. 미지정(예: bcrypt/argon2, ldapjs, i18next 등)이 필요하면 **P22-C-01 계약배치 RFC 에 근거·대안과 함께 올려 human gate**. 임의 추가 금지.
- **새 HTTP 라우트**: `app.ts`(createApp) 마운트 + `apps/server/src/__tests__/routes-mounted.test.ts` EXPECTED_ROUTES 추가(미마운트 = 반복 gap). 계약(16)의 cross-org/404 흐름은 createApp 기반 실HTTP 통합테스트로 검증.
- **회귀 금지**: 기존 318개 feature 의 동작·테스트(server + web 전체)를 깨지 말 것. 옵티미스틱/모달/토스트/포커스트랩/스트리밍 abort 등 P10~P21 성과 유지.
- **Open WebUI 레퍼런스 규칙**: 각 기능의 **동작 방식·사용자 플로우·인터랙션·정보구조**는 Open WebUI(docs.openwebui.com / github open-webui) 를 참조해 자연스럽게 맞춘다. 단 **시각 스타일은 우리 토큰/현대위아 CI**. 라이트/다크 양측, `:focus-visible`, 아이콘버튼 접근명 필수.

## 2. 계약 배치 프로토콜 — `P22-C-01` (휴먼게이트, FROZEN 변경의 유일한 경로)

Tier3(20개)는 `packages/interfaces`·`packages/shared`·migration 변경을 요구한다. CLAUDE.md 는 이를 태스크 내 임의수정 금지로 규정하므로, **단일 계약배치**로 모아 사람 승인을 받는다.

- **P22-C-01 선택 시(초안 작성)**:
  1. Tier3 각 항목이 요구하는 interface/shared/migration/dependency 변경을 **하나의 RFC `docs/rfc/P22-contract-batch.md`** 에 **제안 diff** 와 함께 작성(예: `User` 에 `passwordHash`(0012 migration 이미 존재), 신규 `Agent`/`Connection`/`Note`/`Channel` 타입, `ArtifactStore.cleanupExpired` 실동작, share `reason`, LDAP/SCIM/OAuth account 타입, i18n 리소스 계약 등 — 카탈로그의 각 §impl 참조).
  2. 원칙: **nullable-first · 롤백 경로 명시 · 기존 타입 비파괴(additive) · 각 항목별 영향 파일 목록**.
  3. `.ralph/CONTRACT_PENDING` 에 요약 기록. **`P22-C-01` 을 `passes=true` 로 만들지 말 것**(승인 전). `packages/*` 를 직접 편집하지 말 것(제안 diff 만).
  4. 마지막 줄에 `<CONTRACT_REVIEW_REQUESTED:P22>` 단독 출력 후 종료(사람 검토 요청).
- **재진입 시**: `.ralph/CONTRACT_PENDING` 있고 `.ralph/CONTRACT_APPROVED` 없으면 **재작성하지 말고**(thrash 금지) 다시 `<CONTRACT_REVIEW_REQUESTED:P22>` 만 출력·종료(사람 대기).
- **승인 후**(사람이 `.ralph/CONTRACT_APPROVED` 생성 — 승인된 변경 화이트리스트 포함, 필요한 `packages/*`/migration 변경은 사람이 적용하거나 승인표시): 다음 반복부터 `P22-C-01` 을 `passes=true` 로 커밋하고, **Tier3 태스크가 화이트리스트 범위 내에서 빌드 가능**해진다. 여전히 화이트리스트 밖 변경이 필요하면 그 태스크는 격리.

## 3. 브라우저 실검증 (이 phase 의 핵심 — 상호작용·admin 기능은 실제 앱으로 증명한다)

`desc` 에 **`★needsBrowser`** 표시된 태스크(23개: 채팅 UI·admin 설정·멀티모델·음성·이미지생성·연결관리·에이전트/스킬 관리 등 실제 프론트 상호작용 또는 admin 설정 필요)는 유닛만으로 "구현됐다" 주장 금지. **3겹 검증**:

- **(A) 유닛(RTL)** — `fireEvent`/`userEvent` 로 실제 DOM 이벤트·상태·`aria-*` 를 단언. 서버측은 createApp 기반 실HTTP 통합테스트.
- **(B) Playwright `/preview` E2E** — `apps/web/e2e/<name>.pw.ts`(기존 패턴: `session-bulk-actions.pw.ts`, `message-info.pw.ts`). `/preview`(apps/web/src/app/preview/page.tsx)에 대상 컴포넌트를 등록하고 `page.route()` 로 백엔드 목킹 → 실 chromium 상호작용 → 단언. `bash scripts/verify-browser.sh -g "<name>"` 로 실행.
- **(C) 실앱 UAT (Claude-in-Chrome)** — **admin 설정/실제 데이터 흐름이 필요한 기능은 실 스택에서 확인**:
  1. `run-local` 스킬 또는 `docker-compose.local.yml` + `pnpm dev` 로 web+server+DB+redis 기동(포트: integration 4000/3000).
  2. dev-login 하네스로 로그인 → 대상 화면으로 이동 → **Claude-in-Chrome(mcp__claude-in-chrome\__*)** 로 실제 클릭/입력/토글 → 기대 동작 단언 → 스크린샷을 `.ralph/screenshots/P22-<id>-*.png` 로 저장.
  3. admin 기능(그룹 grant·connectors·연결·에이전트·스킬·헬스필터 등)은 **admin 계정으로 실제 설정을 바꾸고 반영되는지**까지 확인.
  - **환경 제약 시 정직 원칙(L1)**: 루프 환경에서 스택 기동/브라우저 구동이 불가하면 (C)는 **PROGRESS.md 에 UAT 절차 1줄**(어느 화면에서 무엇을→무엇이 보여야/동작해야)로 남기고 "미실행"을 명시하되, (A)+(B)로 실 이벤트 단언을 반드시 대체한다. **실행하지 않은 검증을 통과했다고 서술 금지.**
- **완료 기준**: `★needsBrowser` 는 (A) 유닛 green **+** (B) Playwright 스펙 작성(가능하면 통과) 없이는 `passes=true` 금지. (C)는 가능하면 실행, 불가 시 절차 기록 + 미실행 명시.

## 4. 병렬 개발 (독립 하위작업·독립 팀 경로일 때)

- **한 반복 내 병렬(서브에이전트)**: 한 태스크가 **독립 파일 다수**를 건드리면(예: 여러 admin 패널, 여러 provider, 여러 모달) `Agent` 툴로 **병렬 서브에이전트** 분할 위임 후 메인이 통합·게이트·커밋. **공유 파일 동시수정 금지**(같은 파일은 순차).
- **팀 병렬(agent-teams / 다중 루프)**: T1(server)·T3(knowledge)·T4(artifact)·T6(web) 는 path ownership 이 서로 분리 → **동시에 별도 루프/워크트리로 진행 가능**(rebuild_plan/07 § 워크트리·포트 분리). 운영자가 팀별 루프를 병렬 기동하면 P22 처리량이 배가된다. 단 **Tier3 는 모두 P22-C-01 승인 이후**에만 병렬화(계약이 동기화 포인트).
- **커밋·`feature_list` 갱신(passes/attempts)·게이트 통과 판단은 메인(당신)이 단독**. 서브에이전트에 위임 금지.

## 5. 구현 지침 (패턴)

- **서버 라우트 완성(Tier1 T1/T2/T3/T4)**: 카탈로그 §impl 의 file:line 을 그대로 따른다. 계약(16) 응답 shape·에러코드(예: `INVALID_CONFIRMATION`, `GONE` + `reason`)를 정확히. 신규 라우트는 §1 마운트+EXPECTED_ROUTES 규칙.
- **RAG 배선(T3)**: `settingsService.resolve(orgId)` 결과를 `chunkText(opts)`·ephemeral 인덱싱·`knowledge_search` 통합 스코프에 실제 전달(카탈로그의 P22-T3-* 참조). citation 근거 테스트 유지.
- **orchestrator(T2)**: provider 파라미터 forward(gemini temperature/topP), notifications SSE 는 AbortSignal 전파·취소 테스트 포함, Redis 런타임 상태는 deploy-selectable(dev 는 in-memory 유지).
- **프론트(T6)**: 인터랙션은 Open WebUI 플로우 참조, 오버레이/포커스는 **기존 primitive 재사용**(`useDismiss`/`useExclusiveOverlay`/`useFocusTrap`). 낙관적 업데이트+롤백은 `useSessions.ts` 패턴. 토스트는 `lib/toast.ts`. 시맨틱 토큰만, 라이트/다크, `:focus-visible`.
- **artifact(T4)**: 대용량은 S3 `ArtifactStore`(dev 는 LocalObjectStore/InMemory 주입), share `reason`(expired vs revoked)은 계약 승인 후 wire.
- **미검증(△) 태스크**: 먼저 grep/read 로 실재 확인 → 진짜 갭이면 구현, 아니면 격리.

## 6. 검증 (커밋 전 필수)

- `bash scripts/verify-gates.sh` exit 0(typecheck·lint·test·state). state 는 항목수 유지/증가만 허용(P22 항목 삭제 금지).
- **`★needsBrowser`**: §3 (A)+(B) 필수, (C) 가능 시 실행·불가 시 절차기록+미실행 명시.
- **회귀**: 기존 server/web 테스트 전부 green 유지.
- **`feature_list.json` 은 `passes`(false→true)·`attempts`(+1) 만 변경.** desc/acceptance/id/team 문구 수정·항목 삭제 금지.
- **실행하지 않은 검증을 통과했다고 서술하지 말 것.**

## 7. Blocker 격리 (루프를 멈추지 않는다)

- 막히면(attempts>=3, FROZEN 변경 필요한데 `CONTRACT_APPROVED` 없음, 표 밖 파일 필요, 미지정 dependency, 미검증인데 이미 구현/부재 애매, 스택 기동 불가로 검증 불가):
  `.ralph/blocked_tasks` 에 `<task-id> | <한 줄 사유>` append 후 **같은 phase 의 다음 태스크로 진행**.
- **Tier3 전체가 `CONTRACT_APPROVED` 대기로 막히고 Tier1/2 가 전부 완료/격리**면 → §2 재진입 규칙(`<CONTRACT_REVIEW_REQUESTED:P22>`)으로 사람 대기.
- `.ralph/BLOCKED`(루프 전체 정지)는 쓰지 않는다 — wrapper 전용.

## 8. 신호 (엄격 — 오탐 방지)

- 신호를 낼 때만 **출력 마지막 줄에 신호 문자열만 단독**으로. 안 낼 땐 어디에도 쓰지 말 것.
- 계약 검토 필요(P22-C-01 pending) → 마지막 줄 `<CONTRACT_REVIEW_REQUESTED:P22>` 단독.
- P22 격리 안된 항목 전부 `passes=true` → `.ralph/PHASE_DONE` 에 `P22` 기록 후 마지막 줄 `<PHASE_COMPLETE:P22>` 단독 출력 종료.
- 남은 미완이 전부 격리(또는 계약대기) → 마지막 줄 `<PHASE_BLOCKED:P22>` 단독 출력 종료.
- 그 외(1개 완료, 다음 남음) → 신호 없이 간단 요약.
