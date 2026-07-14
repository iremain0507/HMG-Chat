# LOOP PROMPT — Phase P10 (Commercial-Grade Agentic Chat UX)

당신은 자율 코딩 루프의 한 반복(iteration)이다. 이전 반복의 기억은 없다. 상태는 파일과 git 에만 있다.
이번 phase 의 목표는 WChat 채팅 UI/UX 를 **상용 엔터프라이즈 에이전틱 챗봇(ChatGPT/Claude 급)** 수준으로 올리는 것이다.
단일 출처: **rebuild_plan/19-UIUX-UPGRADE.md** (읽어라). 태스크는 feature_list.json 의 `P10-*`.

## 0. 오리엔테이션 (매번)

1. `git log --oneline -15`, PROGRESS.md, `.ralph/current_phase`(=P10), `.ralph/blocked_tasks` 읽기.
2. **rebuild_plan/19-UIUX-UPGRADE.md** 를 읽어 원칙(§19.4)·태스크 정의(§19.5)·게이트(§19.6)를 파악.
3. feature_list.json 에서 `phase=="P10"`, `passes==false`, `.ralph/blocked_tasks` 에 **없는** 항목 중
   **배열 최상단(최우선) 하나만** 선택.
4. `.ralph/last_fail.txt` 가 있으면 그 실패 수정이 이번 태스크다.

## 1. 계약 (엄수)

- acceptance = feature_list.json 항목 + 19-UIUX-UPGRADE.md § 19.5. 타입 = 14-INTERFACES.md, API = 16-API-CONTRACT.md,
  테스트 = 09-TDD-GUIDE.md, 수정 가능 경로 = CLAUDE.md path ownership.
- **신규 타입 금지**: `ChatEvent` 12변형(message_start·message_replace·text_delta·tool_use·tool_result·hitl_request·
  hitl_resolved·hitl_timeout·citation·artifact_created·stop·error) 등 14-INTERFACES.md 정의만 사용.
  새 타입이 필요하면 **구현하지 말고 격리**(5번).
- **수정 금지 경로**: `packages/interfaces/**`·`packages/shared/**`·Phase-0.5 소유 파일·
  `apps/web/src/lib/{api-client,api-types.generated}.ts`. 여기 수정이 필요하면 격리.
- **path ownership**: T6 태스크(`P10-T6-*`)는 `apps/web/src/**`(단 `components/artifacts/**` 는 T4 공동)에서만.
  T2 태스크(`P10-T2-*`)는 `apps/server/src/{orchestrator/**, tools/handlers/**, routes/{sessions,messages}.ts}` 에서만.
  다른 팀 소유 파일 편집이 필요하면(예: 기존 knowledge/** 나 artifacts route 편집) 격리.
- 새 HTTP route **prefix** 추가 시에만 `app.ts` 마운트 + `apps/server/src/__tests__/routes-mounted.test.ts`
  EXPECTED_ROUTES 갱신. (P10 은 원칙적으로 신규 prefix 없음 — 기존 `/api/v1/sessions` 하위 경로만.)

## 2. TDD 구현 (한 태스크만) — RED 필수

- 선택 항목 `attempts` +1 저장.
- **실패 테스트 먼저** 작성하고 **실제 실행으로 RED 확인**(처음부터 통과하면 task 재검토). → 최소 구현 → GREEN. 스코프 확장 금지.
- **SSE UI 태스크**(스트림/툴콜/HITL/citation/artifact 렌더러): 서버 emit 전이라도
  `apps/web/src/components/chat/__tests__/ChatView.test.tsx` 의 스텁 패턴으로 테스트 —
  `fetch`→`ReadableStream` 로 `event: <type>\ndata: {...}\n\n` 프레임 주입, 동결 이벤트 shape 로 렌더 검증.
  - ⚠️ **필수**: 스텁 `ReadableStream` 은 프레임을 모두 emit 한 뒤 반드시 `controller.close()` 로 닫아라
    (보통 마지막에 `stop`/`error` 프레임 → `close()`). **안 닫으면 reader 가 `done` 을 못 받아 `send()` 가
    영원히 대기 → vitest 가 hang(6분+ 뒤 watchdog 이 killing → 테스트 실패)**. 열린 타이머/AbortController 도
    테스트 종료 시 정리. RED 확인 시 테스트가 5초 내 끝나는지 확인(안 끝나면 스트림 close 누락 의심).
- **테스트 환경**: web vitest 는 파일 상단 `// @vitest-environment jsdom` 프래그마 사용(전역 config 없음).
  `next/navigation` 은 `vi.mock`. React 컴포넌트는 `import React` 필요.

## 3. 상용 UI/UX 엔지니어링 원칙 (모든 P10 태스크에 적용 — 19 § 19.4)

- **토큰만**: 색·타이포는 시맨틱 토큰(`bg-primary`·`text-accent`·`border-border`·`bg-surface`·`text-fg[-muted]`)으로.
  하드코딩 hex 금지, 외부 CDN/폰트 링크 금지(로컬 self-host). 근거: apps/web/DESIGN.md (Hyundai WIA CI).
- **메시지=트리**: 편집/분기·아티팩트 버전을 위해 스토어를 처음부터 트리(부모 포인터+활성경로)로.
- **단일 AbortController**: 컴포저 Stop → 스트리밍 → 툴/에이전트 체인 전체를 하나의 signal 로 취소.
- **순서있는 parts**: text/reasoning/tool 을 스트림 순서대로 인터리브 렌더. `stop.reason==="tool_use"` 는 **비종결** —
  입력 재활성화 금지, resume 스트림 재연결.
- **a11y·지연체감 내장**: 스트리밍 컨테이너 `aria-live="polite"`+`aria-atomic="false"`+`role="log"`+announce 디바운스;
  강제 오토스크롤 금지(하단 추종+벗어나면 "최신으로↓" pill); 첫 토큰 전 shimmer.
- **패턴 참조**: AI Elements/shadcn 계열 컴포넌트 taxonomy 를 참조하되 스타일은 WIA 토큰으로 재작성(코드 복붙·외부 의존 금지).

## 4. 검증 (커밋 전 필수)

- `bash scripts/verify-gates.sh` exit 0 (typecheck·lint·test·validate-state·lint-plan). web ≥ 60% 커버리지 유지.
- **FE 태스크(P10-T6-\*) 브라우저 검증 필수 (G8, 19 § 19.4.1)** — RTL(jsdom)만으로는 불충분:
  1. 컴포넌트를 `apps/web/src/app/preview/page.tsx` 갤러리에 `data-testid="preview-<name>"` 섹션으로 추가(인증·서버 불필요, 목/stub props).
  2. `apps/web/e2e/<name>.pw.ts` Playwright 스펙으로 실제 렌더 + 핵심 인터랙션 검증 + 스크린샷 `.ralph/screenshots/` 저장. 파일명은 반드시 **`*.pw.ts`**(vitest 의 .test/.spec 와 미매칭 — 안 그러면 test 게이트가 Playwright 스펙을 vitest 로 돌려 깨진다).
  3. `bash scripts/verify-browser.sh` 통과 확인(전용 3100 포트 자동기동).
  - 브라우저 검증이 환경상 불가(설치/포트/네트워크 거부)하면 그 태스크를 **격리**하고 사유 기록 — 통과했다고 서술 금지.
- **실행하지 않은 검증을 통과했다고 서술하지 말 것.**

## 5. 기록 & 커밋

- 해당 항목 `passes` 만 true 로(그 외 필드·항목 수정 금지).
- PROGRESS.md 1줄 → `git add -A && git commit -m "feat({team}/P10): <task>"` (반복당 1개). 원격 push/merge 금지.

## 6. Blocker 격리 (루프를 멈추지 않는다)

- 막히면(attempts>=3, 사람 결정 필요, 공유 계약·packages 수정 필요, 타 팀 소유 파일 편집 필요, secret, 미지정 의존성):
  `.ralph/blocked_tasks` 에 `<task-id> | <한 줄 사유>` append 후 **같은 phase 의 다음 태스크로 진행**.
- `.ralph/BLOCKED` 는 쓰지 않는다(wrapper 전용).

## 7. 신호 (엄격 — 오탐 방지)

- 신호를 낼 때만, **출력의 마지막 줄에 신호 문자열만 단독**으로(앞뒤 다른 텍스트·백틱·따옴표 없이) 쓴다. 래퍼가 "라인 시작 = 신호" 로 감지하므로 산문 중간/인용에 이 토큰을 쓰면 오탐 break 가 난다.
- **신호를 내지 않을 때는 `<PHASE_COMPLETE:...>`·`<PHASE_BLOCKED:...>`·`<ALL_TASKS_COMPLETE>` 문자열을 출력 어디에도 쓰지 말 것**(설명/부정문에도 금지). "다음 태스크가 남아있다" 처럼 토큰 없이 서술.
- P10 에서 격리 안된 항목 전부 passes=true → `.ralph/PHASE_DONE` 에 `P10` 기록 후, 마지막 줄에 `<PHASE_COMPLETE:P10>` 단독 출력하고 종료.
- P10 의 남은 미완 항목이 전부 격리 → 마지막 줄에 `<PHASE_BLOCKED:P10>` 단독 출력하고 종료.
- 그 외(태스크 1개 완료, 다음 태스크 남음) → 신호 없이 간단 요약만 출력.
