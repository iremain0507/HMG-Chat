# LOOP PROMPT — Phase P16 (사용자 여정 갭 수정 — 전역 내비·admin 진입·툴팁·설정)

당신은 자율 코딩 루프의 한 반복(iteration)이다. 이전 반복의 기억은 없다. 상태는 파일과 git 에만 있다.
이번 phase 의 목표는 **실제 사용자 여정에서 발견된 내비게이션/발견성 갭을 수정**하는 것이다(유닛/프리뷰는 통과했으나 실제 앱 라우트에서 깨진 것들 — L1).
**정본**: `docs/UAT-TEST-PLAN.md`(26 시나리오 + 10 갭, file:line 근거). 태스크는 feature_list.json 의 `P16-*`.
**근본원인**: 전역 shell(AppShell+NavRail+SessionList)이 `(chat)` 라우트 그룹에만 마운트돼(`app/(chat)/layout.tsx:11`), 루트 레이아웃은 빈 `<body>`(`app/layout.tsx:11`). 그래서 홈·프로젝트·설정·admin 에 전역 내비·히스토리·레일 툴팁이 전부 없다. 이게 사용자가 지적한 "admin 진입로 없음·히스토리 안 보임·툴팁 없음"의 공통 원인.
**필참**: `rebuild_plan/21-LOOP-LESSONS.md`(L1~L5) — 특히 **L1**. `apps/web/DESIGN.md`·`apps/web/design-reference/`(WIA CI 정본).

## 0. 오리엔테이션 (매번)

1. `git log --oneline -15`, PROGRESS.md, `.ralph/current_phase`(=P16), `.ralph/blocked_tasks` 읽기.
2. `docs/UAT-TEST-PLAN.md` 에서 이번 태스크가 닫는 갭/시나리오(TS-xx)를 읽고, 근거 file:line 을 실측.
3. feature_list.json 에서 `phase=="P16"`, `passes==false`, blocked 아닌 항목 중 **최상단 하나만** 선택.

## 1. 계약 (엄수)

- **기존 동작·계약·데이터 보존**. 새 기능 아님 — 이미 있는 화면/라우트를 발견 가능하게 연결하고 누락 요소를 채운다. 신규 상호작용은 RED→GREEN.
- **수정 금지(FROZEN)**: `packages/interfaces/**`·`packages/shared/**`·`apps/web/src/lib/{api-client,api-types.generated}.ts`. 필요 시 격리.
- **시맨틱 토큰만**(하드코딩 hex 0), 라이트/다크, 포커스 링, a11y — P13 완료정의 준수.
- **path ownership**: T6=`apps/web/src/**`, T1=`apps/server/src/{db,knowledge,lib}/`(아래 T1-01 한정). 서버 계약 편집 필요 시 격리.

## 2. 태스크별 지침 (한 태스크만) — 갭→수정→파일

- **P16-T6-01 (T6·P1) — 전역 인증 shell (갭2·3의 근본수정)**
  - 인증 라우트 그룹 레이아웃 도입(또는 AppShell 을 공용 레이아웃으로 이동)해 **홈·projects·settings·admin 을 NavRail(64px)+SessionList 히스토리 사이드바(280px)+헤더로 감싼다**. `(chat)/layout.tsx` 의 shell 을 공용화하되 `/login`·`/signup`·`/share/*` 는 shell 없음(TS-01) 유지.
  - 결과: 모든 인증 화면에 전역 내비·히스토리·레일 툴팁 등장(갭2), 홈 밖에서도 히스토리 사이드바 보임(갭3).
  - 파일: `app/layout.tsx` 또는 새 `app/(app)/layout.tsx` + 라우트 재배치, `components/layout/AppShell.tsx`. **실제 라우트 구조 변경이라 유닛/프리뷰로 안 잡힘 → 사람 브라우저 UAT(TS-03/17/23) 필수**(§3).
- **P16-T6-02 (T6·P1) — admin 하위 내비 (갭1)**
  - `/admin` 대시보드 + 하위(users/settings/tool-metrics)에 **서브내비(탭 또는 사이드섹션)**를 next/link 로 추가. 현재 inert 모노스페이스 경로 캡션(AdminDashboard.tsx:82-84 등)을 실제 링크로. 하위 페이지 상호 교차링크.
  - 파일: `components/admin/*`(AdminDashboard·AdminUsersManager·ToolMetricsTable·AdminSettingsScreen), 필요 시 `app/admin/layout.tsx`.
- **P16-T6-03 (T6·P2) — 아이콘 버튼 툴팁 (갭4)**
  - aria-label 만 있고 `title=` 없는 아이콘 전용 버튼에 툴팁 추가(또는 공용 Tooltip): AppShell 헤더(⌘K·패널토글·햄버거·리사이즈, :99-148/:179-185), ThemeToggle(:65-74), SessionCard 액션(고정/이름변경/삭제, :71-101).
  - 파일: `components/layout/{AppShell,ThemeToggle}.tsx`, `components/sessions/SessionCard.tsx`, (공용 Tooltip 쓰면) `components/ui/*`.
- **P16-T6-04 (T6·P2) — 설정 인덱스·내비 (갭6·9)**
  - `/settings` 인덱스 페이지(또는 settings 레이아웃 서브내비)로 memories/skills/mcp/quota/profile 전부 나열. NavRail '설정'(NavRail.tsx:35 `/settings/memories` 하드코딩)을 인덱스로 repoint. quota 를 어딘가에서 링크(고아 해소).
  - 파일: `app/settings/page.tsx`(신규) 또는 `app/settings/layout.tsx`, `components/layout/NavRail.tsx`.
- **P16-T6-05 (T6·P2) — profile 페이지 + agents 링크 (갭7·5)**
  - `app/settings/profile/page.tsx`(신규): name + customInstructions 폼을 프로필 엔드포인트에 배선(계약 준수). NavRail 'AGENTS'(NavRail.tsx:30 `/agents`, 라우트 없음→404)를 **기존 표면으로 repoint**(예: `/settings/skills`) 하거나 최소 `/agents` 안내 페이지 생성. 홈의 비링크 '에이전트' 텍스트도 동일 처리.
  - 파일: `app/settings/profile/page.tsx`(신규), `components/layout/NavRail.tsx`, `components/home/HomeContent.tsx`.
- **P16-T1-01 (T1·P2) — chunker index-time 설정 반영 (P15-T3-01 재수정)**
  - P15 에서 파일범위 누락으로 격리된 것. 실제 호출부 **`apps/server/src/db/document-service.ts:159`** 의 `chunkText(parsed.markdown)` 에 org settingsService.resolve(orgId) 로 `ChunkOptions.chunkSizeTokens/overlap` 전달(index 시점 org 컨텍스트).
  - 파일: `apps/server/src/db/document-service.ts`, 필요 시 `knowledge/*`. **RED**: org ragChunkSizeTokens=1200 → 인덱싱이 1200 로 분할.

## 3. 검증 (커밋 전 — 이 phase 의 핵심 규율)

- `bash scripts/verify-gates.sh` exit 0 (typecheck·lint·test·state).
- **프리뷰/유닛으로 안 잡히는 라우트-레이아웃 변경(T6-01/02/04/05)**: 가능한 최강 테스트를 붙이되(레이아웃 컴포넌트가 NavRail/SessionList 를 포함하는지 렌더 단언, 라우트가 인증 그룹 하위에 위치하는지 구조 단언), **실제 라우트 동작(예: /admin 에 NavRail 이 뜨는지)은 유닛으로 증명 불가함을 인지**하고 커밋 메시지/PROGRESS 에 "human UAT 필요(TS-xx)" 를 명시. **통과했다고 과장 금지**(L1·정직).
- T1-01·상호작용은 RED→GREEN. 브라우저 프리뷰 검증 가능한 부분은 `verify-browser.sh`.
- **실제 사용자 여정 검증은 사람(운영자)이 `docs/UAT-TEST-PLAN.md` 시나리오로 브라우저에서 수행**한다 — 루프는 코드+게이트까지.

## 4. 기록 & 커밋

- 해당 항목 `passes` 만 true 로. PROGRESS.md 1줄 → `git add -A && git commit -m "fix(<team>/P16): <task>"`. push/merge 금지.

## 5. Blocker 격리

- 막히면(attempts>=3, FROZEN 필요, 표 밖 파일 필요, 사람 결정 필요): `.ralph/blocked_tasks` 에 `<task-id> | <사유>` append 후 다음 태스크로. `.ralph/BLOCKED` 는 쓰지 않는다.

## 6. 신호 (엄격)

- 신호 낼 때만 **출력 마지막 줄에 신호 문자열만 단독**으로. 안 낼 땐 어디에도 쓰지 말 것.
- P16 격리 안된 항목 전부 passes=true → `.ralph/PHASE_DONE` 에 `P16` 기록 후 마지막 줄 `<PHASE_COMPLETE:P16>` 단독 출력·종료.
- 남은 미완이 전부 격리 → `<PHASE_BLOCKED:P16>` 단독 출력·종료.
- 그 외 → 신호 없이 요약만.

## 범위 밖(후속 기록) — P16 에서 하지 않음

- 갭8(세션 고정 서버영속: DB 컬럼+PATCH+클라, P3), 토큰만료 시 로그인 리다이렉트 UX(부차), 갭10(admin 미적용 힌트=P15-T6-01 소관). 필요 시 별도 phase.
