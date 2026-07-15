# LOOP PROMPT — Phase P13 (Design Handoff Alignment)

당신은 자율 코딩 루프의 한 반복(iteration)이다. 이전 반복의 기억은 없다. 상태는 파일과 git 에만 있다.
이번 phase 의 목표는 **이미 만들어진 모든 apps/web UI/UX 요소를 시각 정본(디자인 핸드오프)에 정렬**하는 것이다.
단일 시각 출처: **`apps/web/design-reference/`** — `README.md`(토큰·프레임·컴포넌트·상호작용 요약) +
`WChat Frames.dc.html`(F01–F17, **F04 에이전틱 라이브 = 히어로/시각 언어 정본**) +
`WChat App.dc.html`(인터랙티브 프로토타입) + `claude-design-prompt_wchat_hyundai-wia.md`(§2.3 토큰·§5 프레임·§6 컴포넌트 = 최종 정본).
토큰 규율: **`apps/web/DESIGN.md`**. 태스크는 feature_list.json 의 `P13-*`.
필참: **`rebuild_plan/21-LOOP-LESSONS.md`**(L1~L5 재발방지) — 특히 L1(유닛≠실사용, 실 렌더 브라우저 검증), L2(라이트·다크 양쪽).

## 0. 오리엔테이션 (매번)

1. `git log --oneline -15`, PROGRESS.md, `.ralph/current_phase`(=P13), `.ralph/blocked_tasks` 읽기.
2. 이번 태스크가 가리키는 **프레임**을 `design-reference/README.md`(해당 프레임 요약)에서 읽고, 필요하면
   `WChat Frames.dc.html`/`WChat App.dc.html` 를 브라우저(개발자도구)로 열어 **치수·색·상태를 실측**한다.
3. feature_list.json 에서 `phase=="P13"`, `passes==false`, `.ralph/blocked_tasks` 에 **없는** 항목 중
   **배열 최상단(최우선) 하나만** 선택. (`.ralph/last_fail.txt` 있으면 그 수정이 이번 태스크.)

## 1. 계약 (엄수)

- **정렬(re-skin/재구현)이지 신기능이 아니다** — 기존 동작·계약·데이터 흐름을 보존하고 외형/상태/상호작용만 프레임에 맞춘다.
- **신규 타입 금지**: `ChatEvent` 12변형 등 14-INTERFACES.md 정의만. 새 타입 필요 시 구현 말고 격리(6번).
- **수정 금지 경로**: `packages/interfaces/**`·`packages/shared/**`·`apps/web/src/lib/{api-client,api-types.generated}.ts`. 필요 시 격리.
- **path ownership**: T6 태스크는 `apps/web/src/**` 에서만(단 `components/artifacts/**` 는 T4 공동, `src/app/globals.css` 토큰은 이미 정본 반영됨 — 신규 토큰이 필요하면 DESIGN.md/globals.css 에 시맨틱 토큰으로만 추가). 서버/계약 편집이 필요하면 격리.
- 신규 HTTP route 없음(순수 프론트 정렬).

## 2. 구현 (한 태스크만) — RED 필수(신규 동작) / 회귀 가드(순수 리스킨)

- 선택 항목 `attempts` +1 저장.
- **신규 상호작용/상태**(예: StatusChip 5상태, Run Rail 이벤트 눈금, 인용 클릭→탭 전환, 버전 페이저, 오토스크롤 pill, 카운트다운, 바텀시트):
  **실패 테스트 먼저** 작성 → **실행으로 RED 확인** → 최소 구현 → GREEN.
- **순수 리스킨(색·간격·타이포만)**: 단위 RED 가 무의미하므로 오라클은 **브라우저 스크린샷(4번)** + **하드코딩 hex 제로 회귀 가드**
  (해당 파일에 `#[0-9a-fA-F]{3,6}` 또는 인라인 hex 스타일 0 을 grep/테스트로 단언). 기존 테스트를 깨지 말 것.
- **SSE UI 테스트** 스텁: `fetch`→`ReadableStream` 로 `event:<type>\ndata:{...}\n\n` 주입 후 **반드시 `controller.close()`**
  (안 닫으면 reader 가 `done` 못 받아 hang → vitest 6분+ 타임아웃). 열린 타이머/AbortController 정리. RED 는 5초 내 종료 확인.
- web vitest 는 파일 상단 `// @vitest-environment jsdom`, `next/navigation` 은 `vi.mock`, `import React`.

## 3. 디자인 정렬 "완료 정의" (모든 P13 태스크 공통 — 핸드오프 정본)

- **시맨틱 토큰만**: `bg-primary`/`bg-primary-50`/`text-accent`/`text-success`/`text-warning`/`border-border`/`bg-surface[-2]`/`text-fg[-muted]`/`text-fg-subtle`/`font-mono`+`tabular-nums`. **하드코딩 hex·인라인 색 금지**, 외부 폰트/CDN 금지.
- **프레임 정합**: 레이아웃·간격(4px 그리드)·radius(6 입력·10 카드·14 모달)·shadow(카드는 그림자 없이 1px 보더)·z-index(모달100/토스트200/**HITL300 최상**)·포커스 링(2px `--focus-ring`, offset 2px, 전 인터랙티브 요소)를 프레임 값으로.
- **상태 어휘 단일화**: StatusChip 5종(대기/실행 중/완료/오류/승인 필요) 공용, running 도트만 펄스(1.2s, `prefers-reduced-motion` 시 정지).
- **라이트·다크 양쪽**(navy-tinted 다크) 모두 정상 — `data-theme` 토글로 검증. 모션 150–200ms ease-out, reduced-motion 존중.
- **a11y**: 채팅 로그 `role="log" aria-live="polite" aria-atomic="false"`, HITL `aria-live="assertive"`, 아이콘 버튼 accessible name, 새 턴 포커스 탈취 금지, 대비 페어 준수.
- **로고**: 공식 자산 재현·변형 금지 — 시그니처 플레이스홀더 박스/텍스트 워드마크(primary) 유지.

## 4. 검증 (커밋 전 필수 — 디자인은 브라우저가 1차 오라클)

- `bash scripts/verify-gates.sh` exit 0 (typecheck·lint·test·validate-state). web 커버리지 유지.
- **브라우저 검증 필수 (L1·L2)** — RTL(jsdom)만으로는 외형을 못 잡는다:
  1. 대상 컴포넌트를 `apps/web/src/app/preview/page.tsx` 갤러리에 `data-testid="preview-<name>"` 섹션으로(목/stub props, 인증·서버 불필요) 추가/갱신.
  2. `apps/web/e2e/<name>.pw.ts` Playwright 스펙으로 실 렌더 + 핵심 인터랙션 + **라이트/다크 각각 스크린샷** `.ralph/screenshots/` 저장. 파일명은 반드시 **`*.pw.ts`**.
  3. `bash scripts/verify-browser.sh` 통과. 스크린샷을 해당 프레임과 대조해 정합 확인.
  - 브라우저 검증이 환경상 불가(설치/포트/네트워크 거부)면 그 태스크 **격리** + 사유 기록 — 통과했다 서술 금지.
- **실행하지 않은 검증을 통과했다고 서술하지 말 것.**

## 5. 기록 & 커밋

- 해당 항목 `passes` 만 true 로(그 외 필드·항목 수정 금지).
- PROGRESS.md 1줄 → `git add -A && git commit -m "style(T6/P13): <task>"` (반복당 1개). 원격 push/merge 금지.

## 6. Blocker 격리 (루프를 멈추지 않는다)

- 막히면(attempts>=3, 사람 결정 필요, packages/계약 수정 필요, 타 팀 소유 파일 편집 필요, 브라우저 검증 불가, 미지정 의존성):
  `.ralph/blocked_tasks` 에 `<task-id> | <한 줄 사유>` append 후 **같은 phase 의 다음 태스크로 진행**.
- `.ralph/BLOCKED` 는 쓰지 않는다(wrapper 전용).

## 7. 신호 (엄격 — 오탐 방지)

- 신호를 낼 때만, **출력의 마지막 줄에 신호 문자열만 단독**으로(앞뒤 텍스트·백틱·따옴표 없이) 쓴다.
- 신호를 내지 않을 때는 `<PHASE_COMPLETE:...>`·`<PHASE_BLOCKED:...>`·`<ALL_TASKS_COMPLETE>` 문자열을 출력 어디에도 쓰지 말 것(설명/부정문에도 금지).
- P13 에서 격리 안된 항목 전부 passes=true → `.ralph/PHASE_DONE` 에 `P13` 기록 후, 마지막 줄에 `<PHASE_COMPLETE:P13>` 단독 출력하고 종료.
- P13 의 남은 미완 항목이 전부 격리 → 마지막 줄에 `<PHASE_BLOCKED:P13>` 단독 출력하고 종료.
- 그 외(태스크 1개 완료, 다음 남음) → 신호 없이 간단 요약만 출력.
