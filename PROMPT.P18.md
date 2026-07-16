# LOOP PROMPT — Phase P18 (아티팩트 노출/복원/모바일 — "답변 문서 안 보임" 해결)

당신은 자율 코딩 루프의 한 반복(iteration)이다. 이전 반복의 기억은 없다. 상태는 파일과 git 에만 있다.
이번 phase 의 목표는 **에이전트가 답변을 아티팩트 문서로 작성했을 때, 그 문서를 사용자가 항상 발견·열람**할 수 있게 하는 것이다.
**증상**: 에이전트가 "…문서를 작성했습니다" 라고 하지만 문서가 안 보임(특히 모바일·재방문). 원인 = ① 채팅 메시지에 인라인 아티팩트 카드 없음(우패널에만 존재) ② 세션 재방문 시 아티팩트 복원 안 됨 ③ 모바일에서 우패널 접근 불가.
(선행 fix: 아티팩트 미리보기 markdown/html 렌더 + 한글 파일명 콘텐츠 500 은 이미 해결됨.)
**필참**: `rebuild_plan/21-LOOP-LESSONS.md`(L1) — 실제 사용자 여정(문서가 실제로 보이는지)은 유닛 불가 → human UAT. `apps/web/DESIGN.md`(WIA CI). 태스크는 feature_list.json 의 `P18-*`.

## 0. 오리엔테이션 (매번)

1. `git log --oneline -15`, PROGRESS.md, `.ralph/current_phase`(=P18), `.ralph/blocked_tasks` 읽기.
2. 근거 파일 실측: `apps/web/src/components/chat/ChatView.tsx`(artifacts 상태·artifact_created 자동오픈 :160-174), `apps/web/src/hooks/useSessionStream.ts`(artifact_created 처리 :457), `apps/web/src/components/artifacts/ArtifactCanvas.tsx`·`ArtifactPanel.tsx`, `apps/web/src/components/layout/AppShell.tsx`(rightPanel, 모바일 토글 md:flex), 서버 `GET /:id/artifacts`(sessions.ts:235).
3. feature_list.json 에서 `phase=="P18"`, `passes==false`, blocked 아닌 항목 중 **최상단 하나만** 선택.

## 1. 계약 (엄수)

- **비파괴 + RED 필수**: 새 동작은 실패 테스트 먼저→RED→최소 구현→GREEN. 기존 데스크톱 라이브 흐름(우패널 자동오픈) 보존.
- **수정 금지(FROZEN)**: `packages/interfaces/**`·`packages/shared/**`·`apps/web/src/lib/{api-client,api-types.generated}.ts`. 새 필드 필요 시 격리.
- **시맨틱 토큰만**(하드코딩 hex 0)·라이트/다크·포커스 링·a11y. path ownership: T6=`apps/web/src/**`, T1=`apps/server/src/{db,routes,lib,scripts}/`. 표 밖 필요 시 격리.

## 2. 태스크 지침 (한 태스크만)

- **P18-T6-01 (T6) — 메시지 인라인 아티팩트 카드**
  - artifact_created 로 생성된 아티팩트를 **해당 어시스턴트 메시지 하단에 클릭 가능한 카드**("📄 {filename} · 열기", kind 아이콘)로 렌더. 클릭 시 기존 열람 흐름(setActiveArtifactIndex + 우패널 아티팩트 탭 오픈, ChatView.tsx:160-174 재사용)으로 문서 오픈. 우패널만 있던 것을 메시지 흐름에서도 발견 가능하게.
  - 메시지↔아티팩트 연결: 라이브는 artifact_created 가 해당 메시지 직후이므로 그 메시지에 귀속. artifacts 에 messageId 가 없으면 세션 단위 카드(마지막 관련 메시지 또는 대화 하단)로 폴백 — frozen 필드 필요 시 격리. files: components/chat/ChatView.tsx, (신규) components/artifacts/ArtifactCard.tsx.
  - **RED**: artifact_created 후 메시지 영역에 카드 렌더 + 클릭 시 activeArtifact/panel 오픈 단언. human UAT.
- **P18-T6-02 (T6) — 세션 열 때 아티팩트 복원**
  - 세션 진입(히스토리 로드) 시 `GET /api/v1/sessions/:id/artifacts`(apiFetch)로 세션 아티팩트를 불러와 artifacts 상태·인라인 카드·우패널을 재구성. 현재는 스트림 이벤트로만 채워져 재방문/리로드 시 사라짐.
  - files: hooks/useSessionStream.ts(또는 useSessions), components/chat/ChatView.tsx.
  - **RED**: 목 GET /:id/artifacts 응답 → 마운트 시 artifacts 복원·카드 렌더 단언. human UAT(재방문 시 문서 유지).
- **P18-T6-03 (T6) — 모바일 아티팩트 뷰**
  - 모바일(좁은 뷰포트)에서 우패널(400px)이 접근 불가. 인라인 카드 탭 또는 패널 열기 시 **바텀시트/전체화면 오버레이**로 아티팩트를 열도록(F17). 데스크톱 md+ 는 기존 우패널 유지, 모바일은 오버레이. AppShell 의 rightPanel 모바일 처리 + z-index(모달100).
  - files: components/layout/AppShell.tsx, components/artifacts/ArtifactCanvas.tsx, components/chat/ChatView.tsx.
  - **RED**: 좁은 뷰포트에서 아티팩트 열기 → 오버레이 표시 단언(가능한 범위). **human UAT(모바일 폭에서 문서 실제 표시) 필수** — 커밋/PROGRESS 에 명시, 과장 금지.
- **P18-T1-01 (T1) — 기존 "(제목 없음)" 세션 제목 백필**
  - 제목이 null 인 기존 세션에 대해 첫 사용자 메시지에서 제목을 파생(lib/session-title.ts `deriveSessionTitle` 재사용)해 채운다. 일회성 스크립트(scripts/) 또는 idempotent migration. 첫 메시지 없으면 스킵.
  - files: apps/server/src/scripts/_(신규) 또는 db/migrations/_, lib/session-title.ts(재사용).
  - **RED/검증**: null 제목 + 메시지 있는 세션 → 백필 후 title 파생값; 메시지 없는 세션 → null 유지.

## 3. 검증 (커밋 전)

- `bash scripts/verify-gates.sh` exit 0. 새 route/스크립트는 통합/유닛 테스트.
- **렌더/실제 노출은 유닛으로 증명 못 함(L1)**: 최강 테스트 + 커밋/PROGRESS 에 "human UAT 필요(문서 실제 표시·모바일)" 명시, 과장 금지.
- T6 은 가능한 `verify-browser.sh` preview + Playwright. 실경로/모바일 UAT 는 운영자(사람).

## 4. 기록 & 커밋

- 해당 항목 `passes` 만 true. PROGRESS.md 1줄 → `git commit -m "fix(<team>/P18): <task>"`. push/merge 금지.

## 5. Blocker 격리

- 막히면(attempts>=3, FROZEN 필요[예: 아티팩트 messageId], 표 밖 파일, 사람 결정): `.ralph/blocked_tasks` 에 `<task-id> | <사유>` append 후 다음 태스크로. `.ralph/BLOCKED` 안 씀.

## 6. 신호 (엄격)

- 신호 낼 때만 **출력 마지막 줄에 신호 문자열만 단독**으로. 안 낼 땐 어디에도 쓰지 말 것.
- P18 격리 안된 항목 전부 passes=true → `.ralph/PHASE_DONE` 에 `P18` 기록 후 `<PHASE_COMPLETE:P18>` 단독 출력·종료.
- 남은 미완이 전부 격리 → `<PHASE_BLOCKED:P18>` 단독 출력·종료. 그 외 → 신호 없이 요약만.
