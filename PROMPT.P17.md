# LOOP PROMPT — Phase P17 (UAT 실측 결함 수정 — 세션영속·프로필·RAG·상호작용·a11y)

당신은 자율 코딩 루프의 한 반복(iteration)이다. 이전 반복의 기억은 없다. 상태는 파일과 git 에만 있다.
이번 phase 의 목표는 **`docs/UAT-TEST-PLAN.md` 26 시나리오를 실측(병렬 UAT + 브라우저)해 확인된 실제 결함**을 수정하는 것이다.
헤드라인: **세션/메시지 영속이 통째로 미구현**(메시지 DB 저장 X, `GET /sessions` 목록·`GET /:id/messages`·rename/delete API 부재) — 사용자가 지적한 "대화 히스토리 저장 안 됨"의 실체.
**필참**: `rebuild_plan/21-LOOP-LESSONS.md`(L1~L5) — 특히 **L1(실제 영속/API/렌더까지 도달하는지 createApp·실경로로 단언; 유닛 green ≠ 실사용)**. `rebuild_plan/16-API-CONTRACT.md`(엔벨로프·경로), `14-INTERFACES.md`(frozen 타입), `apps/web/DESIGN.md`(WIA CI). 태스크는 feature_list.json 의 `P17-*`.

## 0. 오리엔테이션 (매번)

1. `git log --oneline -15`, PROGRESS.md, `.ralph/current_phase`(=P17), `.ralph/blocked_tasks` 읽기.
2. 이번 태스크의 근거 시나리오(TS-xx)를 `docs/UAT-TEST-PLAN.md` 에서 읽고 file:line 실측.
3. feature_list.json 에서 `phase=="P17"`, `passes==false`, blocked 아닌 항목 중 **최상단 하나만** 선택.

## 1. 계약 (엄수)

- **RED 필수**: 새 동작(영속·API·상호작용)은 실패 테스트 먼저→실행 RED→최소 구현→GREEN. **비파괴**(기존 동작·계약 보존).
- **수정 금지(FROZEN)**: `packages/interfaces/**`·`packages/shared/**`·`apps/web/src/lib/{api-client,api-types.generated}.ts`. 새 필드가 frozen 타입에 필요하면(예: Session.pinned) 그 서브파트만 **격리**하고 나머지는 진행.
- **신규 route 는 반드시 `app.ts` 마운트 + `routes-mounted.test.ts` EXPECTED_ROUTES 추가**. 엔벨로프 `{data,meta:{requestId}}` + auth·role 게이트 준수. orgId/userId 는 auth 에서만(cross-org 불가).
- **시맨틱 토큰만**(하드코딩 hex 0)·라이트/다크·포커스 링(T6). **path ownership**: T1=`apps/server/src/{routes,db,knowledge,lib}/`+app.ts(마운트/배선), T6=`apps/web/src/**`. 표 밖 필요 시 격리.

## 2. 태스크 지침 (한 태스크만) — TS→결함→수정

### 백엔드 (T1)

- **P17-T1-01 — 메시지 영속 (TS-08)**: `messages.ts` 가 턴마다 user + assistant 메시지를 `messages` 테이블에 저장(da.messages 또는 pgPool INSERT). RED: createApp 턴 후 messages 테이블에 해당 세션 행 존재. files: routes/messages.ts, db/*(messages data-access).
- **P17-T1-02 — 세션 목록·히스토리 API (TS-08/10)**: `sessions.ts` 에 `GET /`(내 세션 목록, 최신순·pagination) + `GET /:id/messages`(세션 메시지 히스토리, tree 순서). app.ts 마운트 + EXPECTED_ROUTES 추가. RED: GET /api/v1/sessions 가 내 세션 배열 반환(더 이상 404 아님), cross-org 격리. files: routes/sessions.ts, app.ts, **tests**/routes-mounted.test.ts.
- **P17-T1-03 — 세션 rename/delete API (TS-09)**: `PATCH /:id`(title 변경) + `DELETE /:id`(cascade messages/artifacts, 204). pin 영속이 frozen Session 타입 변경을 요구하면 pin 서브파트만 격리. 마운트+EXPECTED. RED: PATCH 후 title 반영, DELETE 후 목록에서 제거+cascade. files: routes/sessions.ts, db/*, app.ts, routes-mounted.test.ts.
- **P17-T1-04 — 프로필 저장 API (TS-20)**: `auth.ts` 에 `PATCH /api/v1/auth/me`(name + customInstructions). 마운트+EXPECTED. RED: PATCH 후 GET /me 반영. files: routes/auth.ts, app.ts, routes-mounted.test.ts.
- **P17-T1-05 — 채팅 문서첨부 RAG 배선 (TS-14)**: app.ts 가 `attachments` dep 를 createMessageRoutes 에 전달(현재 0 매칭) → messages.ts 가 세션 업로드 청크를 RAG 검색에 사용. RED: 첨부 있는 createApp 턴이 ephemeral 청크 검색·인용. files: app.ts, routes/messages.ts.
- **P17-T1-06 — 문서 재시도 route (TS-15)**: `POST /api/v1/documents/:id/retry`(실패 문서 재인덱싱). 마운트+EXPECTED. RED: 미등록 404 → 200 재인덱싱. files: routes/documents.ts, app.ts, routes-mounted.test.ts.

### 프론트엔드 (T6)

- **P17-T6-01 — 세션 히스토리 UI 배선 (TS-08/09/10)**: SessionList 가 `GET /sessions` 로 목록 로드(useSessions), 세션 열면 `GET /:id/messages` 로 과거 대화 복원, rename/delete 가 새 API 호출(영속). 오늘/어제/이전7일 그룹. **L1: 실제로 채팅→나갔다 복귀→히스토리 복원되는지 human UAT(TS-08) 명시.** files: hooks/useSessions.ts, hooks/useSessionStream.ts(히스토리 로드), components/sessions/*.
- **P17-T6-02 — 프로덕션 도구 피커 + Run Rail 클릭 (TS-11)**: 프로덕션 ChatView 의 @mention 피커에 실제 도구/에이전트/커넥터 채움(현재 dev preview 만); Run Rail 눈금 클릭 → 우패널 활동 탭(onStepClick unwired at ChatView.tsx:571). files: components/chat/ChatView.tsx, ChatInput/피커.
- **P17-T6-03 — 재생성=같은턴 형제 (TS-06)**: 재생성이 중복 user+assistant 턴 추가 대신 같은 user 턴의 assistant 형제 생성(편집/분기와 동일 tree 의미). files: components/chat/ChatView.tsx, hooks/useSessionStream.ts.
- **P17-T6-04 — 딥리서치 활동 탭 자동 열림 (TS-12)**: deep_research 실행 시 우패널 활동 탭 자동 오픈(현재 artifact/citation 만). files: components/chat/ChatView.tsx.
- **P17-T6-05 — 프로젝트 가시성 필터 (TS-16)**: 프로젝트 목록에 visibility 필터 컨트롤(org/team/private) + useProjects 가 ?visibility 전달. files: app/(app)/projects/page.tsx, hooks/useProjects.ts, components/projects/*.
- **P17-T6-06 — 단축키 ⌘B·⌘/ (TS-22)**: ⌘B 사이드바 접기/펼치기, ⌘/ 단축키 치트시트 오버레이(기존 ⌘K/⌘N/⌘\ 유지). files: components/layout/AppShell.tsx, 새 ShortcutSheet.
- **P17-T6-07 — revoked 공유 페이지 (TS-21)**: 만료(410)와 취소(revoked)를 구분해 각각 다른 안내(현재 둘 다 동일 410). 필요 시 서버 410 reason 추가는 T1 격리. files: app/(app 또는 share)/share/[token]/_, components/share/_.
- **P17-T6-08 — 에러 UX (TS-24)**: 429 시 백오프 카운트다운(mono) + SSE 끊김 시 자동 재연결. files: components/chat/ChatView.tsx, hooks/useSessionStream.ts, error 배너.
- **P17-T6-09 — 모달 a11y (TS-26)**: ShareDialog·HitlPrompt 에 focus-trap + Esc 닫기 + 닫을 때 트리거로 포커스 복귀. files: components/share/ShareDialog.tsx, components/chat/HitlPrompt.tsx, (공용 useFocusTrap).

## 3. 검증 (커밋 전)

- `bash scripts/verify-gates.sh` exit 0. 새 route 는 routes-mounted 가드 green + createApp 통합테스트(cross-org/403/404 흐름).
- **기능/렌더 결함은 유닛만으로 증명 못 함(L1)**: 최강 테스트를 붙이되, 실제 사용자 여정(히스토리 복원·도구피커·프로필저장 등)은 커밋/PROGRESS 에 "human UAT 필요(TS-xx)" 명시. **과장 금지.**
- T6 은 가능한 `verify-browser.sh` preview + Playwright. 실경로 UAT 는 운영자(사람)가 `docs/UAT-TEST-PLAN.md` 로 수행.

## 4. 기록 & 커밋

- 해당 항목 `passes` 만 true. PROGRESS.md 1줄 → `git commit -m "fix(<team>/P17): <task>"`. push/merge 금지.

## 5. Blocker 격리

- 막히면(attempts>=3, FROZEN 필요[예: Session.pinned], 표 밖 파일, 사람 결정): `.ralph/blocked_tasks` 에 `<task-id> | <사유>` append 후 다음 태스크로. `.ralph/BLOCKED` 안 씀.

## 6. 신호 (엄격)

- 신호 낼 때만 **출력 마지막 줄에 신호 문자열만 단독**으로. 안 낼 땐 어디에도 쓰지 말 것.
- P17 격리 안된 항목 전부 passes=true → `.ralph/PHASE_DONE` 에 `P17` 기록 후 `<PHASE_COMPLETE:P17>` 단독 출력·종료.
- 남은 미완이 전부 격리 → `<PHASE_BLOCKED:P17>` 단독 출력·종료. 그 외 → 신호 없이 요약만.
