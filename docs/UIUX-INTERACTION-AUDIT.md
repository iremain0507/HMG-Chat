# UI/UX 인터랙션 정확성 감사 & 테스트 시나리오 (P21 근거 문서)

> **목적**: "기본적인 UI/UX 디테일" 결함(오버레이 미해제·다중 오픈·포커스 유실·조용한 실패·레이스 등)을
> 표준 기반으로 전수 정의하고, 각 항목을 **개별 클릭까지 검증**할 수 있는 테스트 시나리오로 만든다.
> 이 문서는 **`PROMPT.P21.md` 루프의 단일 근거(source of truth)** 이며 `feature_list.json` 의 `P21-*` 태스크와 1:1 매핑된다.
>
> **작성 방법론**: (1) 외부 표준 딥리서치 — W3C WAI-ARIA Authoring Practices Guide(APG), MDN Popover API,
> WCAG 2.1/2.2, Nielsen Norman Group heuristics. (2) `apps/web/src` 전수 코드 감사 3종(오버레이/포커스, 비동기/상태).
> 표준 체크리스트(72기준)는 부록 A, WChat 실결함은 §2 결함대장, 검증 시나리오는 §3.

---

## 0. 시드 버그 (사용자 보고 — 재현 확인됨)

> 대화 히스토리 세션에 **우클릭하면 메뉴가 뜨는데, 메뉴 밖을 눌러도 안 닫히고, 다른 세션을 우클릭하면
> 또 메뉴가 떠서 두 개가 동시에 보인다.**

- **코드 근원**: `apps/web/src/components/sessions/SessionCard.tsx:108-111` — `onContextMenu` 가
  `setContextMenuOpen(prev => !prev)` 로 **카드별 로컬 state 토글**만 한다. 메뉴는 **항목 클릭 시에만** 닫힌다
  (`:283-329`). 바깥 클릭·Escape·스크롤·다른 카드 오픈에 대한 해제 로직이 **전무**하고, 상태가 카드마다
  독립이라 **여러 메뉴가 동시에 열린다**.
- **라이브 재현**: 세션 2개 연속 우클릭 → 메뉴 2개 겹쳐 표시. 빈 영역 클릭 → 두 메뉴 모두 잔존. (확인 완료)
- **분류**: 이 버그는 단발이 아니라 **"라이트-디스미스 + 단일 활성 오버레이 + 포커스 복귀" 계약을
  앱 전반의 메뉴/드롭다운/팝오버가 공통으로 위반**하는 문제의 대표 사례다(§2-A).

---

## 1. 검증 인프라 (이미 존재 — 재사용)

| 계층        | 도구                                                                                           | 대상                                                | 용도                                                                              |
| ----------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------- |
| L1 유닛     | vitest + React Testing Library (98개 테스트)                                                   | 컴포넌트/훅                                         | RED→GREEN, DOM/`document.activeElement`/`aria-*` 단언                             |
| L1 브라우저 | **Playwright `/preview` 하네스** (`apps/web/e2e/*.pw.ts` 37개, `playwright.config.ts` → :3100) | `/preview` 격리 갤러리 + `page.route()` 백엔드 목킹 | 실제 chromium 에서 우클릭·바깥클릭·`keyboard.press('Escape')`·`toBeHidden()` 단언 |
| L2 UAT      | 대화형 브라우저(운영자)                                                                        | 실앱 :3000                                          | `★needsBrowser` 항목 사람 클릭 확인                                               |

**수정 도구(fix vehicle) — 감사 결과:**

- **`apps/web/src/hooks/useFocusTrap.ts` 존재** — Escape→onClose, Tab/Shift-Tab 순환 트랩, 오픈 시 포커스 이동,
  닫힐 때 트리거 포커스 복귀. **모달 전용**(포커스를 가둠). 레퍼런스 구현: `ShareDialog`, `ConversationShareDialog`, `HitlPrompt`.
- **`useOnClickOutside`/`useDismiss` 훅 없음** — 앱 전체에 `mousedown`/`pointerdown` 문서 리스너 0개.
  **단일-오픈 오버레이 조정자도 없음.** → 메뉴/드롭다운/팝오버용 **신규 primitive 2종을 먼저 만든다**(P21-T6-01/02).
- **`createPortal` 없음** — 메뉴는 `absolute z-10`, 모달은 `fixed z-[var(--z-modal)]`(토큰 `--z-modal:100`,`--z-toast:200`,`--z-hitl:300`).

**핵심 원칙**: 메뉴/드롭다운/팝오버는 `useDismiss`(바깥클릭+Escape) + `useExclusiveOverlay`(단일 오픈)로,
모달/다이얼로그는 **기존 `useFocusTrap`** 로 통일한다. 개별 컴포넌트에 dismiss 로직을 산발적으로 심지 않는다.

---

## 2. WChat 실결함 대장 (감사 결과 → P21 매핑)

### 2-A. 오버레이/메뉴/포커스 (표준 §1·§2·§3 위반)

| #   | 결함                                                                                             | file:line                                                | 증상                                           | 위반기준           | → P21     |
| --- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------- | ---------------------------------------------- | ------------------ | --------- |
| A1  | **SessionCard 컨텍스트 메뉴** — 해제·단일인스턴스 없음 (시드버그)                                | `SessionCard.tsx:60,108-111,283-329`                     | 두 카드 우클릭 시 메뉴 2개; 바깥/Escape 무반응 | C1,C2,C3,C10,C12   | **T6-03** |
| A2  | SessionCard **폴더 메뉴** — 바깥클릭·Escape 없음                                                 | `SessionCard.tsx:57,162,247-282`                         | 선택 전까지 잔존, 타 메뉴와 공존               | C1,C2,C3           | T6-03     |
| A3  | SessionCard **태그 메뉴** — 바깥클릭 없음, Escape 는 input 포커스 시만                           | `SessionCard.tsx:58,175,228-246`                         | 바깥 클릭해도 잔존                             | C1,C3              | T6-03     |
| A4  | **ShareExportMenu** 드롭다운+confirm — 바깥클릭·Escape 없음; confirm 은 `alertdialog`인데 비모달 | `chat/ShareExportMenu.tsx:40,93-168`                     | 메뉴/confirm 잔존, 트랩 없음                   | C1,C3,C14 / D16-24 | T6-05     |
| A5  | **ProjectPicker** 드롭다운 — 바깥클릭·Escape 없음, trigger 미announce                            | `chat/ProjectPicker.tsx:20,34,40-85`                     | 헤더 [프로젝트▾] 열고 딴 곳 클릭 시 잔존       | C1,C3,C14          | T6-06     |
| A6  | **ComposerPopover**(슬래시/@/#) — 데스크톱 바깥클릭 없음(backdrop `md:hidden`)                   | `chat/ChatInput.tsx:489-513`,`ComposerPopover.tsx:57-65` | ≥md 에서 딴 곳 클릭해도 팝오버 잔존            | C1                 | T6-07     |
| A7  | **MessageActions 정보 팝오버** — button blur 에만 의존, Escape·바깥클릭·role 없음                | `chat/MessageActions.tsx:39,144-181`                     | 포커스가 트리거를 안 떠나면 잔존               | C1,C3              | T6-08     |
| A8  | **ChatView 유저메시지 인라인 편집** — Escape 취소·autofocus 없음                                 | `chat/ChatView.tsx:768,819-853`                          | 취소하려면 버튼만; Escape 무반응               | C3(inline)         | T6-11     |
| A9  | **Markdown 인용 툴팁** — 호버 전용(키보드 접근 불가)                                             | `chat/Markdown.tsx:43-59`                                | 키보드 사용자 툴팁 못 봄                       | H55,H56,H57        | T6-19     |
| A10 | **Mcp 툴 툴팁** — 단순 호버 팝오버가 `z-modal(100)` 남용, role 없음                              | `settings/McpServersManager.tsx:176`                     | 무관 크롬 위에 페인트                          | S62                | T6-19     |

### 2-B. 모달/다이얼로그 포커스 (표준 §2 위반 — `useFocusTrap` 미채택)

| #   | 결함                                                                                        | file:line                                                                                         | 증상                                           | → P21     |
| --- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------- | --------- |
| B1  | **PromptsManager/ApiKeysManager/McpServersManager 모달** — Escape·포커스트랩·이동/복귀 없음 | `settings/PromptsManager.tsx:134-215`, `ApiKeysManager.tsx:140-179`, `McpServersManager.tsx:230+` | Tab 이 배경으로 샘; 닫을 때 포커스 유실        | **T6-09** |
| B2  | **CommandPalette / ShortcutSheet** — Escape·backdrop 은 있으나 포커스 트랩·복귀 없음        | `sessions/CommandPalette.tsx:81-157`, `layout/ShortcutSheet.tsx:35-77`                            | Tab 배경 침투; ⌘K/⌘ 트리거로 포커스 복귀 안 함 | T6-10     |

### 2-C. 비동기/상태/레이스 (표준 §4·§5·§6·§7·§9 위반)

| #   | 결함                                                                                                                                                           | file:line                                                                                                                                        | 증상                                                         | 심각도             | → P21     |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ | ------------------ | --------- |
| C1  | **세션 전환 stale-tree 레이스** — `page.tsx` 에 `key={sessionId}` 없음 + `treeRef/historyLoadedRef/artifactsLoadedRef` 리셋 안 됨 + `loadHistory` early-return | `app/(app)/chat/[sessionId]/page.tsx:12`, `useSessionStream.ts:257,290-291,351-352`                                                              | /chat/A→B 이동 시 **A 대화가 그대로 남고 B 히스토리 미로드** | **치명(기능버그)** | **T6-04** |
| C2  | **언마운트/전환 시 스트림 abort 없음** + send/edit/regenerate/continue 진입 `isStreamingRef` 가드 없음                                                         | `useSessionStream.ts:454-465,928-1057`                                                                                                           | 언마운트 후 setState; 겹친 호출이 트리 이중기록              | 높음               | T6-12     |
| C3  | **useSessions 뮤테이션 실패 전부 무음** — rename/delete/archive/pin/folder/tag 실패 시 토스트·롤백 없음; bulk 부분실패 무피드백                                | `useSessions.ts:172-370` (헬퍼 `pinnedSessions.ts:11` 등 `!ok`→null)                                                                             | 실패해도 UI 무변화·무경고                                    | 높음               | T6-13     |
| C4  | **세션목록 로드 실패 = 빈 목록과 구분 불가** + 검색 무결과 문구 미구분                                                                                         | `SessionList.tsx:474-481,725-728`, `useSessions.ts:84`(error 미소비)                                                                             | 네트워크 실패도 "세션이 없습니다."                           | 중                 | T6-14     |
| C5  | **이중제출 가드 결여** — MemoryManager, ApiKey revoke, SessionCard del/archive, Mcp remove, AdminUsers role/suspend                                            | `MemoryManager.tsx:130-223`, `ApiKeysManager.tsx:56-59`, `SessionCard.tsx:188,201`, `McpServersManager.tsx:219`, `AdminUsersManager.tsx:129,158` | 더블클릭 시 중복 요청                                        | 중                 | T6-15     |
| C6  | **토스트 무한 큐 + 중복 미병합 + 빈 상태 live-region unmount**                                                                                                 | `lib/toast.ts:23-35`, `layout/ToastContainer.tsx:19`                                                                                             | 재연결 루프 토스트 무한 누적; 첫 토스트 미announce           | 중                 | T6-16     |
| C7  | **폼 검증 갭** — 숫자 blank→0 무음, prompt command 선행 `/` 미검증, rename/tag maxlen·중복 힌트 없음                                                           | `ModelsGenerationTab.tsx:98,118,138,170`, `PromptsManager.tsx:149-156`, `SessionCard.tsx:86-95,234-243`                                          | 빈칸이 0으로, 잘못된 command 수용                            | 중                 | T6-17     |
| C8  | **채팅 자동스크롤이 토큰마다 실행 + 재진입 위치 소실 + loadMore 실패 무음**                                                                                    | `ChatView.tsx:320-323`, `useSessions.ts:107-130`                                                                                                 | 유저 스크롤과 충돌; 긴 세션 재진입 시 항상 바닥              | 중                 | T6-18     |

> **양호(회귀 방지 대상)**: 옵티미스틱+롤백은 `togglePin/assignFolder/addTag/removeTag/moveFolder/deleteMessage/usePrompts.remove`
> 에 이미 구현됨(`useSessions.ts:250-370`, `useSessionStream.ts:1104-1194`). maxTokens 다운그레이드-확인 모달은
> 실제로 저장을 게이트함(`AdminSettingsScreen.tsx:145-184,300-329`). 이들 동작을 **깨지 않도록** 회귀 테스트 유지.

---

## 3. 테스트 시나리오 카탈로그 (개별 클릭까지 검증)

> 각 시나리오는 **GIVEN/WHEN/THEN** + 대상 컴포넌트 + 검증계층 + P21 태스크. 루프는 이 시나리오를 RED 테스트로
> 먼저 실패시키고(올바른 이유) 구현 후 GREEN + 브라우저(Playwright `/preview`)로 실동작을 단언한다.

### 3-1. 오버레이 라이트-디스미스 & 단일 활성 (★P1 — 시드버그 계약)

- **UX-01 바깥클릭 해제**: GIVEN 메뉴/드롭다운/팝오버가 열림, WHEN 메뉴와 트리거 밖을 pointerdown, THEN 한 프레임 내 닫히고 내부 액션 미발생. _(A1-A7 / T6-03,05,06,07,08)_
- **UX-02 단일 활성**: GIVEN 메뉴 A 열림, WHEN 메뉴 B 오픈, THEN A 자동 닫힘 — 비중첩 메뉴는 동시 1개만. _(A1-A5 / T6-03,05)_ — **시드버그 핵심**
- **UX-03 Escape 해제 + 포커스 복귀**: GIVEN 메뉴 열림, WHEN Escape, THEN 닫히고 포커스가 트리거로 복귀. _(A1-A7 / T6-03,05,06,07)_
- **UX-04 라우트/스트림/언마운트 시 오르판 없음**: GIVEN 메뉴 열림, WHEN 라우트 변경·새 메시지 스트림·언마운트, THEN 메뉴 DOM 제거(잔존 백드롭·리스너 누수 없음). _(A1 / T6-03)_
- **UX-05 우클릭 네이티브 메뉴 억제**: GIVEN 커스텀 컨텍스트 메뉴, WHEN 우클릭, THEN 브라우저 기본 메뉴 미표시, 커스텀만 1개. _(A1 / T6-03)_
- **UX-06 키보드 오픈·이동**: GIVEN 트리거 포커스, WHEN Enter/Space/↓, THEN 메뉴 열리고 첫 항목 포커스; ↓/↑ 이동, Home/End 처음/끝, Tab 은 닫고 다음 요소로. _(A1,A5 / T6-03,06)_
- **UX-07 trigger 상태 노출**: GIVEN 메뉴 트리거, THEN `aria-haspopup` + 열림/닫힘에 따라 `aria-expanded=true/false`. _(A4,A5 / T6-05,06)_

### 3-2. 모달/다이얼로그 포커스

- **UX-08 오픈 시 포커스 진입**: GIVEN 모달 오픈, THEN 포커스가 다이얼로그 내부로 이동(트리거/body 잔류 금지). _(B1,B2 / T6-09,10)_
- **UX-09 포커스 트랩**: GIVEN 모달 열림, WHEN 마지막에서 Tab / 첫에서 Shift+Tab, THEN 다이얼로그 내부로 순환(배경 침투 금지). _(B1,B2 / T6-09,10)_
- **UX-10 Escape 닫기 + 포커스 복귀**: GIVEN 모달 열림, WHEN Escape 또는 닫기, THEN 닫히고 포커스가 오프너로 복귀(body 금지). _(B1,B2 / T6-09,10)_
- **UX-11 배경 inert**: GIVEN 모달 열림, THEN 배경 콘텐츠는 포커스/포인터 불가·시각적 흐림. _(B1 / T6-09)_
- **UX-12 이중 오픈 없음**: GIVEN 모달 열림, WHEN 트리거 재활성(더블클릭), THEN 두 번째 인스턴스 미생성. _(B1 / T6-09)_

### 3-3. 파괴적 액션 & 확인

- **UX-13 파괴 전 확인/undo**: GIVEN 삭제/보관, WHEN 트리거, THEN 확인(alertdialog) 또는 undo 제공. _(기존 인라인 확인 회귀 유지)_
- **UX-14 안전 기본 포커스**: GIVEN 파괴 확인 다이얼로그, THEN 포커스가 취소(안전) 쪽. _(T6-09)_
- **UX-15 파괴 버튼도 in-flight 가드**: GIVEN 확인 후 삭제 진행 중, THEN 버튼 disable(이중삭제 방지). _(C5 / T6-15)_

### 3-4. 비동기 피드백 & 상태

- **UX-16 세션 전환 정확성(치명)**: GIVEN 세션 A 열람 중, WHEN 세션 B 선택(또는 "＋ 새 채팅"), THEN **B 메시지만 표시(A 잔존 없음)** 하고 B 히스토리를 실제 로드. _(C1 / T6-04)_
- **UX-17 이중제출 방지**: GIVEN 전송/저장/삭제/발급/폐기 버튼, WHEN in-flight 중 재클릭(또는 Enter), THEN 중복 요청 미발생(disable). _(C5 / T6-15)_
- **UX-18 실패 가시화**: GIVEN 뮤테이션 실패, THEN 평문 에러 토스트 + 롤백/재시도(무음 금지). _(C3 / T6-13)_
- **UX-19 로드 실패 vs 빈 상태 구분**: GIVEN 세션 목록 GET 실패, THEN 에러+재시도 표시(‘세션이 없습니다’ 오표기 금지). GIVEN 검색 무결과, THEN “검색 결과 없음”. _(C4 / T6-14)_
- **UX-20 스트림 언마운트 정리**: GIVEN 스트리밍 중, WHEN 언마운트/세션 전환, THEN fetch/reader abort(언마운트 후 setState 없음). _(C2 / T6-12)_
- **UX-21 겹친 스트림 가드**: GIVEN 스트리밍 진행 중, WHEN send/regenerate/continue 재진입, THEN 이전 leg 중단 또는 진입 차단(트리 이중기록 없음). _(C2 / T6-12)_

### 3-5. 토스트/폼/스크롤/호버

- **UX-22 토스트 상한·병합·상시 live-region**: GIVEN 토스트 다발/중복, THEN 최대 노출 상한(FIFO evict) + 동일 메시지 병합 + `aria-live` 컨테이너 상시 마운트. _(C6 / T6-16)_
- **UX-23 숫자 입력 검증**: GIVEN 숫자 필드 비움, THEN 0 무음 강제 금지 — 필드 에러 표시. _(C7 / T6-17)_
- **UX-24 prompt command 형식**: GIVEN command 입력, THEN 선행 `/` 강제(슬래시 매칭 보장). _(C7 / T6-17)_
- **UX-25 채팅 스크롤 존중**: GIVEN 스트리밍, WHEN 바닥이면 추종·위로 읽는 중이면 낚아채지 않음(‘최신으로↓’ 제공); 토큰마다가 아니라 메시지 카운트 변화에만 스크롤. _(C8 / T6-18)_
- **UX-26 재진입 위치 보존**: GIVEN 긴 세션 재진입, THEN 이전 읽던 위치/미읽음 상단 복원(무조건 바닥 금지). _(C8 / T6-18)_
- **UX-27 호버 어포던스 키보드 패리티**: GIVEN 호버로 나타나는 컨트롤/툴팁, WHEN 키보드 포커스, THEN 동일하게 도달·표시(Escape dismiss, hoverable 유지). _(A9,A10 / T6-19)_

---

## 4. 부록 A — 표준 체크리스트 근거 (72기준 요약)

> 전문 근거. 시나리오 §3 은 이 기준들의 WChat 적용본이다. 표기: **C**=Overlays/Menus, **D**=Modals,
> **F**=Keyboard/Focus, **A**=Async/Feedback, **X**=Destructive, **T**=Toasts, **V**=Forms, **H**=Hover/Pointer, **S**=Scroll/Layout, **R**=ARIA/SR.

**C. 오버레이 & 메뉴** (APG Menu Button/Menu; MDN Popover 라이트-디스미스)
C1 바깥 pointer 해제 · C2 단일 활성(비중첩 1개) · C3 Escape 해제+포커스 복귀 · C4 중첩 예외는 의도적 · C5 활성 시 첫 항목 포커스 · C6 ↓/↑ 오픈 위치 · C7 항목 간 ↑/↓ · C8 Home/End · C9 타입어헤드 · C10 Tab 이 메뉴 닫음 · C11 활성 시 액션+닫힘 · C12 라우트/언마운트 시 오르판 없음 · C13 포커스아웃 해제(비모달) · C14 trigger `aria-expanded` · C15 우클릭 네이티브 억제.

**D. 모달 & 다이얼로그** (APG Dialog/Alert Dialog)
D16 오픈 시 포커스 진입 · D17 Tab 트랩 · D18 Shift+Tab 트랩 · D19 Escape 닫기 · D20 닫을 때 포커스 복귀 · D21 배경 inert · D22 가시적 닫기 · D23 backdrop-클릭 정책 명시·일관 · D24 role/aria-modal/라벨 · D25 이중 오픈 없음.

**F. 키보드 & 포커스** (WCAG 2.1.2/2.4.3/2.4.7/1.4.11; `:focus-visible`)
F26 body 로 포커스 유실 없음 · F27 가시적 포커스(≥3:1) · F28 `:focus-visible` 모달리티 · F29 모달 외 키보드 트랩 없음 · F30 논리적 탭 순서 · F31 닫힌 오버레이 비탭 · F32 복합위젯 roving tabindex.

**A. 비동기 & 피드백** (NN/g 시스템 상태 가시성; 응답시간 0.1s/1s/10s)
A33 1s 내 진행 표시 · A34 10s+ 진행률+취소 · A35 pending 중 disable(이중제출 방지) · A36 스트리밍 표시+Stop(실 abort) · A37 빈 상태 · A38 복구 가능한 에러 · A39 옵티미스틱 롤백 · A40 완료 시 멱등(레이스).

**X. 파괴적 액션** (NN/g 오류예방/사용자통제; APG Alert Dialog)
X41 되돌릴 수 없는 손실 전 확인 · X42 안전 기본 포커스 · X43 Escape/취소 안전 중단 · X44 undo · X45 파괴 버튼 in-flight 가드.

**T. 토스트/알림** (WCAG 4.1.3; APG live-region)
T46 포커스 훔침 없이 announce · T47 적정 노출/일시정지 · T48 스택 오버플로 없음 · T49 수동 dismiss.

**V. 폼 & 검증** (WCAG 3.3.1/3.3.3/3.3.4)
V50 Enter vs 개행 명확 + IME 조합 Enter 미전송 · V51 빈/공백 제출 차단 · V52 인라인 평문 검증(aria-describedby/invalid) · V53 첫 에러로 포커스 · V54 실패 시 입력 보존.

**H. 호버/포인터 vs 키보드** (WCAG 1.4.13/2.1.1; APG Tooltip)
H55 호버 어포던스 키보드 도달 · H56 포커스로도 툴팁 · H57 Escape dismiss · H58 hoverable 유지 · H59 지속(타이머 소멸 금지) · H60 필수정보 툴팁 전용 금지.

**S. 스크롤 & 레이아웃** (body scroll lock; WCAG 1.4.10)
S61 모달 뒤 body scroll lock + 위치 복원 · S62 스태킹 컨텍스트 클리핑 없음 · S63 뷰포트 내 재배치 · S64 async 로드 레이아웃 시프트 없음 · S65 채팅 오토스크롤 사용자 존중 · S66 320px/400% 재플로우 무가로스크롤.

**R. ARIA & 스크린리더** (APG; WCAG 4.1.2)
R67 disclosure `aria-expanded` · R68 tabs 선택/roving · R69 combobox `aria-activedescendant` · R70 listbox 네비/선택 · R71 아이콘 버튼 접근명 · R72 동적 콘텐츠 announce.

**근거 링크**: W3C APG(Menu Button / Dialog / Combobox / Listbox / Disclosure / Tooltip / Tabs),
MDN(Popover API, `:focus-visible`), WCAG 2.1/2.2(1.4.13, 2.1.2, 2.4.7, 4.1.3), NN/g(10 Heuristics, Response Times, Visibility of System Status).

---

## 5. P21 태스크 매핑 (요약)

| 태스크 | 내용                                                      | 결함     | needsBrowser |
| ------ | --------------------------------------------------------- | -------- | ------------ |
| T6-01  | `useDismiss` 훅(바깥 pointerdown + Escape) 생성           | 인프라   | —            |
| T6-02  | `useExclusiveOverlay`/overlay-registry(단일 오픈) 생성    | 인프라   | —            |
| T6-03  | **SessionCard 3메뉴 dismiss+단일+ARIA+키보드 (시드버그)** | A1,A2,A3 | ★            |
| T6-04  | **세션 전환 stale-tree 레이스 (치명)**                    | C1       | ★            |
| T6-05  | ShareExportMenu 드롭다운+confirm                          | A4       | ★            |
| T6-06  | ProjectPicker 드롭다운                                    | A5       | ★            |
| T6-07  | ComposerPopover 데스크톱 바깥클릭                         | A6       | ★            |
| T6-08  | MessageActions 정보 팝오버                                | A7       | —            |
| T6-09  | CRUD 모달 3종 focus-trap 이식 (병렬 가능)                 | B1       | ★            |
| T6-10  | CommandPalette + ShortcutSheet focus-trap                 | B2       | ★            |
| T6-11  | ChatView 인라인 편집 Escape+autofocus                     | A8       | —            |
| T6-12  | 스트림 언마운트 abort + 겹침 가드                         | C2       | —            |
| T6-13  | useSessions 무음 실패 토스트+롤백                         | C3       | —            |
| T6-14  | 목록 로드-에러 상태 + 검색-무결과 구분                    | C4       | —            |
| T6-15  | 이중제출 가드 5종 (병렬 가능)                             | C5       | —            |
| T6-16  | 토스트 상한+병합+상시 live-region                         | C6       | —            |
| T6-17  | 폼 검증(숫자/command/maxlen·dupe)                         | C7       | —            |
| T6-18  | 채팅 스크롤 존중+위치 보존+loadMore 에러                  | C8       | —            |
| T6-19  | 툴팁/호버 키보드 패리티 & a11y                            | A9,A10   | —            |

전 태스크 **T6(apps/web)** 전용 — `packages/interfaces`·`packages/shared`·`api-types.generated`·서버 미접촉(frozen 안전).
