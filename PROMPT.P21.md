# LOOP PROMPT — Phase P21 (UI/UX 인터랙션 정확성 — 오버레이·포커스·비동기 상태 위생)

당신은 자율 코딩 루프의 한 반복(iteration)이다. 이전 반복의 기억은 없다. 상태는 파일과 git 에만 있다.
이번 phase 의 목표는 **`docs/UIUX-INTERACTION-AUDIT.md`(표준 72기준 + WChat 실결함 감사)에서 정의된
"기본 UI/UX 인터랙션 정확성" 결함을 표준대로 완전히 고치는 것**이다. 대표(시드) 버그: **세션 우클릭 컨텍스트 메뉴가
바깥 클릭·Escape 로 안 닫히고, 다른 세션 우클릭 시 메뉴가 동시에 여러 개 열린다**(라이트-디스미스 + 단일 활성 오버레이 +
포커스 복귀 계약 위반). 태스크는 `feature_list.json` 의 `P21-*` (19개, 전부 T6=apps/web).

**핵심 원칙**: 개별 컴포넌트에 dismiss 로직을 산발적으로 심지 말 것. **먼저 재사용 primitive 2종을 만들고**
(`useDismiss`=바깥 pointerdown+Escape, `useExclusiveOverlay`=단일 오픈), 메뉴/드롭다운/팝오버는 그 primitive 로,
모달/다이얼로그는 **기존 `apps/web/src/hooks/useFocusTrap.ts`** 로 통일한다(레퍼런스: ShareDialog·ConversationShareDialog·HitlPrompt).

**필참**: `rebuild_plan/21-LOOP-LESSONS.md`(L1~L5) — 특히 **L1(유닛 green ≠ 실사용: 실제 화면·실제 DOM 이벤트로
동작을 단언)**. "테스트가 통과한다"가 아니라 "실제로 메뉴가 바깥클릭에 닫힌다"를 브라우저로 확인. CLAUDE.md 하드룰 준수.

## 0. 오리엔테이션 (매번)

1. `git log --oneline -15`, PROGRESS.md, `.ralph/current_phase`(=P21), `.ralph/blocked_tasks` 읽기.
2. 근거: **`docs/UIUX-INTERACTION-AUDIT.md`**(결함대장 §2 + 시나리오 §3 + 표준 §4 — 이 태스크의 GIVEN/WHEN/THEN 과 file:line 근원),
   `apps/web/DESIGN.md`(시맨틱 토큰), 기존 primitive `hooks/useFocusTrap.ts`(모달 레퍼런스), Playwright `playwright.config.ts`(/preview → :3100).
3. `feature_list.json` 에서 `phase=="P21"`, `passes==false`, `.ralph/blocked_tasks` 에 **없는** 항목 중 **배열 최상단(최우선) 하나만** 선택.
   (`.ralph/last_fail.txt` 있으면 그 수정이 이번 태스크.) 배열은 의존성 순서: **T6-01/02(primitive) → T6-03(시드메뉴)·T6-04(치명 레이스) → 나머지**.
   메뉴/드롭다운/팝오버 태스크(T6-03,05,06,07)는 T6-01·T6-02 primitive 에 의존 — primitive 가 아직 없으면 먼저 primitive 태스크가 선택되어야 한다.

## 1. 계약 (엄수)

- **버그 수정이지만 새 동작이다 — RED 필수**: 결함마다 "고쳐진 동작"의 테스트를 먼저 작성 → 실행으로 **RED 확인(올바른 이유: 현재 미구현이라 실패)** → 최소 구현 → GREEN.
  회귀 방지 RED 예: `카드A 우클릭 후 카드B 우클릭 → A 메뉴가 unmount 되는지` 단언(현재 둘 다 열려 실패). **처음부터 통과하면 시나리오/기대를 재검토**(잘못된 단언).
- **수정 금지(FROZEN)**: `packages/interfaces/**`·`packages/shared/**`·`apps/web/src/lib/{api-client,api-types.generated}.ts`. **신규 SSE 이벤트/신규 API 계약 금지** — P21 은 순수 프론트 인터랙션이라 서버/계약 변경이 필요 없다. 만약 어떤 태스크가 서버·인터페이스 변경을 요구하면 **구현하지 말고 즉시 격리**(§6).
- **Path ownership = T6(apps/web) 전용**: 수정 허용 = `apps/web/src/**` + `apps/web/e2e/**`(Playwright). 서버(`apps/server/**`)·패키지 미접촉. `feature_list.json` `files:` 힌트 안에서만.
- **재사용 primitive 우선**: dismiss 로직을 컴포넌트마다 복붙 금지. `useDismiss`/`useExclusiveOverlay`(T6-01/02) 완성 후 소비. 모달은 `useFocusTrap` 재사용(신규 트랩 구현 금지).
- **디자인/접근성 하드룰**: 하드코딩 hex 0(시맨틱 토큰만), 라이트/다크 양측, 아이콘 버튼 접근명, `:focus-visible` 가시 포커스. 낙관적 업데이트+롤백 유지(회귀 금지).
- **회귀 금지**: 이미 양호한 동작(옵티미스틱 pin/folder/tag/deleteMessage, maxTokens 다운그레이드 확인 게이트, ShareDialog focus-trap)을 깨지 말 것 — 해당 기존 테스트 green 유지.

## 2. 브라우저 실검증 (이 phase 의 핵심 — 인터랙션은 실 DOM 이벤트로만 증명된다)

`desc` 에 **`★needsBrowser`** 표시된 태스크(오버레이 해제·단일인스턴스·포커스 트랩·세션전환 등 실제 포인터/키보드 상호작용)는 유닛만으로 "고쳐졌다" 주장 금지. 2겹 검증:

- **(A) 루프 자동 검증(당신)**:
  1. **유닛(RTL)** — `fireEvent`/`userEvent` 로 pointerdown 바깥클릭·`keyboard Escape`·Tab 순환·`document.activeElement` 복귀·`aria-expanded` 를 단언.
  2. **Playwright `/preview` E2E** — `apps/web/e2e/<name>.pw.ts`. 패턴(기존 `session-bulk-actions.pw.ts` 참고): `/preview` 의 대상 컴포넌트를 열고 `page.route()` 로 백엔드 목킹 → 실제 chromium 에서 상호작용 → `expect(menu).toBeHidden()`/`toHaveCount(1)` 단언. 필요한 컴포넌트가 `/preview`(apps/web/src/app/preview/page.tsx)에 없으면 **먼저 갤러리에 등록**(T6 소유).
     로컬 스택이 이 환경에서 미기동이면 E2E 는 작성만 하고 "미실행"을 정직히 기록 + RTL 로 실 DOM 이벤트 단언을 대체.
- **(B) watchdog 브라우저 UAT(운영자)**: `★needsBrowser` 태스크는 **PROGRESS.md 에 UAT 절차 1줄**(어느 화면에서 무엇을 우클릭/클릭→무엇이 닫혀야/보여야 함)을 남긴다.
- **완료 기준**: `★needsBrowser` 는 (A) 유닛 green **+** Playwright 스펙 작성(가능하면 통과) 없이는 passes=true 금지. "메뉴가 닫힌다"를 실 이벤트로 단언했는지 확인(L1).

## 3. 병렬 개발 (독립 하위작업일 때)

`desc` 에 **`병렬:...`** 힌트가 있으면(예: T6-09 세 모달 독립, T6-15 다섯 컴포넌트 독립) 한 반복 안에서 **서브에이전트(Agent 툴)로 병렬 구현** 후 통합·게이트·커밋.

- 병렬은 **독립 파일일 때만**(공유 파일 동시수정 금지). 예: T6-09 는 PromptsManager/ApiKeysManager/McpServersManager 를 세 서브에이전트에 분할 위임 → 각자 `useFocusTrap` 이식 → 통합 시 타입/테스트로 정합.
- **커밋·feature_list 갱신·게이트 통과 판단은 메인(당신)이 단독** 수행. 서브에이전트에 위임 금지.

## 4. 구현 지침 (패턴)

- **T6-01 `useDismiss(ref, onDismiss, opts?)`**: `document` `pointerdown` 이 ref(+옵션 trigger ref) 밖이면 onDismiss; `keydown` Escape 시 onDismiss; 열려 있을 때만 리스너 부착(cleanup 필수). 순수 훅 → renderHook + fireEvent RTL RED.
- **T6-02 `useExclusiveOverlay(id)`**: 모듈 레지스트리(단일 오픈). `open()` 시 이전 열린 오버레이의 close 를 호출. `{isOpen, open, close}` 반환. 두 인스턴스 A.open→B.open→A.isOpen===false RED.
- **T6-03 (시드)**: SessionCard 3메뉴를 `useDismiss`+`useExclusiveOverlay` 로 재작성. 추가: `role="menu"`/`menuitem`, trigger `aria-haspopup="menu"`+`aria-expanded`, 오픈 시 첫 항목 포커스+↑/↓/Home/End roving+Tab 닫힘. 시나리오 UX-01~07.
- **T6-04 (치명)**: `<ChatView key={sessionId}>`(page.tsx) **또는** useSessionStream 에서 sessionId 변경 effect 로 `treeRef`/`historyLoadedRef`/`artifactsLoadedRef` 리셋 + 새 히스토리 로드. in-flight 스트림 abort 동반. UX-16. **비파괴 우선**(key 방식이 가장 안전).
- **모달(T6-09,10)**: `useFocusTrap` 이식만 — 신규 트랩 로직 금지. Escape→닫기, 오픈 포커스 이동, 닫힘 시 트리거 복귀.
- **비동기(T6-12~18)**: 옵티미스틱+롤백 패턴은 기존 `useSessions.ts:250-370` 을 그대로 따라 확장. 토스트는 `lib/toast.ts` 재사용. `showToast('error', 평문메시지)`.
- 시맨틱 토큰만, 라이트/다크, `:focus-visible`. SSE 스텁 테스트는 `controller.close()`.

## 5. 검증 (커밋 전 필수)

- `bash scripts/verify-gates.sh` exit 0(typecheck·lint·test·state).
- **`★needsBrowser`**: §2 (A) 유닛 실 DOM 이벤트 단언 + Playwright 스펙. 미실행 시 정직히 명시.
- **회귀**: 기존 web 테스트(98개) 전부 green 유지 — 특히 옵티미스틱/모달/토스트 기존 동작.
- **실행하지 않은 검증을 통과했다고 서술하지 말 것.** "메뉴가 실제로 닫힌다/세션 전환이 실제로 초기화된다"를 실 이벤트(RTL/Playwright)로 단언했는지 확인.

## 6. Blocker 격리 (루프를 멈추지 않는다)

- 막히면(attempts>=3, FROZEN(interfaces·shared·generated) 수정 필요, 서버/계약 변경 필요, 표 밖 파일 필요, 신규 dependency 필요):
  `.ralph/blocked_tasks` 에 `<task-id> | <한 줄 사유>` append 후 **같은 phase 의 다음 태스크로 진행**.
- primitive(T6-01/02)가 격리되면 그에 의존하는 메뉴 태스크(T6-03,05,06,07)도 함께 막힐 수 있음 — 그 경우 독립 태스크(T6-04 레이스, 모달 T6-09/10, 비동기 T6-12~18)로 진행.
- `.ralph/BLOCKED`(루프 전체 정지)는 쓰지 않는다 — wrapper 전용.

## 7. 신호 (엄격 — 오탐 방지)

- 신호를 낼 때만 **출력 마지막 줄에 신호 문자열만 단독**으로. 안 낼 땐 어디에도 쓰지 말 것.
- P21 격리 안된 항목 전부 passes=true → `.ralph/PHASE_DONE` 에 `P21` 기록 후 마지막 줄 `<PHASE_COMPLETE:P21>` 단독 출력 종료.
- 남은 미완이 전부 격리 → 마지막 줄 `<PHASE_BLOCKED:P21>` 단독 출력 종료.
- 그 외(1개 완료, 다음 남음) → 신호 없이 간단 요약.
