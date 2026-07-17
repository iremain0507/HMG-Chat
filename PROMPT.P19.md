# LOOP PROMPT — Phase P19 (Open WebUI 참고 gap — 채팅/관리자 미구현 기능 구현)

당신은 자율 코딩 루프의 한 반복(iteration)이다. 이전 반복의 기억은 없다. 상태는 파일과 git 에만 있다.
이번 phase 의 목표는 **Open WebUI(github.com/open-webui/open-webui) 대비 WChat 에 없거나 반쯤만 만들어진 기능**을 사내 Hyundai WIA
엔터프라이즈 에이전틱 챗에 맞게 구현하는 것이다. Open WebUI 를 그대로 복제하지 말고 **큐레이션한 부분집합(아래 §3)만** 채택한다.
태스크는 `feature_list.json` 의 `P19-*` (38개, T1=14·T2=6·T6=18).

**필참**: `rebuild_plan/21-LOOP-LESSONS.md`(L1~L5) — 특히
**L1(유닛 green ≠ 실사용: 새 도구/설정/토글이 runTurn·실 진입점까지 실제 도달하는지 createApp 경로로 단언)**,
L2(열화 조건: 행 없음/JSON 손상/DB오류/외부 미설정 → 안전 기본값·dev-stub, throw·조용한 폴백 금지),
L3(참조 무결성: 클라 ID write 는 ensure/upsert + FK 통합테스트), L5(조용한 실패 금지: 모든 async/스트림 경로 명시적 에러·타임아웃).
CLAUDE.md 의 하드룰·migration/RLS/cross-org·auth 체크리스트 준수.

## 0. 오리엔테이션 (매번)

1. `git log --oneline -15`, PROGRESS.md, `.ralph/current_phase`(=P19), `.ralph/blocked_tasks` 읽기.
2. 근거 파일: `rebuild_plan/16-API-CONTRACT.md`(엔벨로프 `{data,meta:{requestId}}`·에러코드), `rebuild_plan/14-INTERFACES.md`(frozen 타입),
   `apps/server/src/__tests__/routes-mounted.test.ts`(마운트 가드), `apps/server/src/lib/org-settings-schema.ts`(설정 단일 출처),
   T1 이면 최신 마이그레이션(현재 0017)·`.claude/skills/migration-check`, T6 이면 `apps/web/DESIGN.md`(WIA CI 토큰)+형제 화면 패턴.
3. `feature_list.json` 에서 `phase=="P19"`, `passes==false`, `.ralph/blocked_tasks` 에 **없는** 항목 중 **배열 최상단(최우선) 하나만** 선택.
   (`.ralph/last_fail.txt` 있으면 그 수정이 이번 태스크.) 항목은 의존성 순서로 정렬돼 있다(각 sub-area 는 migration/route → UI 순).

## 1. 계약 (엄수)

- **신규 기능이다 — RED 필수**: 새 동작(마이그레이션 제외)은 **실패 테스트 먼저 → 실행으로 RED 확인(올바른 이유로) → 최소 구현 → GREEN**.
  처음부터 통과하면 GREEN 으로 보지 말고 태스크 정의를 재검토한다.
- **수정 금지(FROZEN) — 필요하면 구현 말고 격리(§6)**: `packages/interfaces/**`(특히 `ChatEvent` 13-variant union, `ChatInput`, `Organization`, `User`),
  `packages/shared/**`, `apps/web/src/lib/{api-client,api-types.generated}.ts`.
  → **신규 SSE 이벤트 금지**(ChatEvent 확장 필요): `continue` 는 기존 `text_delta`/`stop` 재사용, `followups`·`feedback` 등은 **REST 엔드포인트**로(SSE 아님).
  → 새 타입은 **LOCAL Zod + hand-rolled 타입 + hand-written fetch**(org-settings 방식). generated 클라이언트 미사용.
- **신규 route 는 반드시 `app.ts` 에 마운트 + `routes-mounted.test.ts` 의 `EXPECTED_ROUTES` 에 prefix 추가**(안 하면 route 파일만 만들고 미배선 = P2/P3 gap).
  계약(16) 엔벨로프 + `isAdmin` 403 게이트(admin route) + `orgId` 는 **auth 에서만**(body/query 금지 → cross-org 불가) + hand-rolled 검증(기존 `routes/admin.ts` 컨벤션).
- **마이그레이션(0018~0027)**: 번호충돌 없음(최신 0017), **nullable-first**(기존 테이블 컬럼 추가는 nullable/DEFAULT), 신규 테이블 `org_id` + RLS `ENABLE`+`FORCE`,
  select 정책=같은 org(`NULLIF(current_setting('app.org_id',true),'')::uuid`), modify 정책=같은 org (admin 테이블은 추가로 `current_user_is_admin()`), `touch_updated_at` 트리거.
  rollback: dev/staging=`DROP TABLE`/`DROP COLUMN`(prod forward-only). **cross-org 격리 테스트 필수**(org A 는 자기 행만).
- **저장 재사용(새 저장 안 만듦)**: `allowedModels`·`allowedTools`·`defaultTokenBudgetMicros` 는 **기존 `organizations` 컬럼**. 배너·웹검색 provider 는 `org_settings`(JSONB, 마이그레이션 불필요, LOCAL Zod 확장).
- **Per-task 파일 소유권**: 각 태스크의 `feature_list.json` `files:` 힌트 안에서만 수정. 표 밖 파일 필요하면 격리(§6).
  **공유 assembly 파일**(`app.ts`, `routes/messages.ts`, `routes/sessions.ts`, `lib/org-settings-schema.ts`, `__tests__/routes-mounted.test.ts`)은 여러 태스크가 건드리니 **한 반복 한 태스크**로 직전 위에 순차 편집.
- **ISOLATE(격리 후보 — 무리하게 구현 말 것)**: (a) RBAC enforcement(P19-T1-14)가 frozen `User`/`Organization` 변경을 요구하는 부분,
  (b) 실 외부 provider 호출(웹검색·LLM 제목생성 등)은 **LOCAL_ONLY dev-stub 로 배선만**(실 provider 는 배포 교체 — 기존 Voyage/S3/Tavily 패턴), (c) 신규 의존성 필요 기능(PDF 는 `window.print`로 무의존 구현할 것; 불가피한 새 dep 는 격리).

## 2. 팀별 구현 지침 (한 태스크만)

- **T1(플랫폼 — migration·db·lib·route)**
  - 마이그레이션은 위 §1 규칙(nullable-first·RLS·FORCE·cross-org·rollback). 신규 route 는 `app.ts` 마운트 + `routes-mounted.test.ts` EXPECTED_ROUTES + createApp 실HTTP 통합테스트(403/400/cross-org/엔벨로프).
  - 손상/부재/DB오류 시 `logger.warn` + 안전 기본값 반환(**throw 금지**, L2/L5). 클라 제공 ID write 는 ensure/upsert(L3).
  - API 키(T1-11): 저장은 **해시만**(평문은 발급 응답 1회), auth 미들웨어가 `Authorization: Bearer <key>` 를 JWT 와 동등하게 수용(폐기 후 401). 비밀 하드코딩 금지.
- **T2(orchestrator 배선 — 반쯤 만든 토글 실동작이 핵심)**
  - **L1 last-mile 필수**: createApp 채팅 턴에서 `webSearch`/`mode`/`temporary` 등이 실제 `runTurn`/tool set/persist 경로에 도달함을 단언(유닛 아님).
    예) `webSearch=false`+admin off → tools 에 web_search **미포함**; `mode='chat'` → tools **비어있음**; `temporary=true` → `messages.insert` **미호출**.
  - `continue`(T2-03)는 직전 assistant 텍스트를 prefix 로 이어 기존 SSE 파이프 재사용(신규 이벤트 금지), stop 종단 회귀 확인(L5). `followups`(T2-04)·LLM 제목(T2-06)은 provider 부재 시 **dev-stub 결정적** 반환(조용한 실패 금지).
- **T6(apps/web — UI, P13/P14 방식 그대로)**
  - `lib/fetch-with-refresh`(apiFetch) 로 hand-written fetch, **시맨틱 토큰만(하드코딩 hex 0)**, 라이트·다크, 포커스 링, a11y(aria-label·포커스). 낙관적 업데이트+실패 롤백+toast.
  - 검증: 상호작용 vitest RED→GREEN(SSE 스텁 쓰면 `controller.close()` 필수, jsdom 헤더). 화면형은 preview 갤러리 등록 + `bash scripts/verify-browser.sh`(라이트/다크). 브라우저 검증 불가 환경이면 그 태스크 격리(통과 서술 금지).

## 3. 참조: 큐레이션한 gap → 태스크 그룹 (Open WebUI → WChat)

- **Ⓐ 배선 마무리(반쯤 만든 토글 실동작)**: 웹검색 토글(T2-01)·모드 agent/chat(T2-02) 서버 소비, 분기 새로고침 복원(T1-01/T6-01: `parentMessageId` 반환+트리 복원), 세션 핀 서버 영속(T1-02/T6-02: localStorage→`sessions.pinned_at`).
- **Ⓑ 세션 정리**: 폴더(T1-03/T6-03), 태그+필터(T1-04/T6-04), 아카이브(T1-05/T6-05: `archived_at`), 메시지 내용 검색(T1-06/T6-06).
- **Ⓒ 상호작용**: 메시지 평가 👍/👎(T1-07/T6-07), 응답 이어쓰기(T2-03/T6-08), 후속질문 제안(T2-04/T6-09), PDF 내보내기(T6-10: window.print), 임시 채팅(T2-05/T6-11), 완료 알림(T6-12: Notification API, `document.hidden`).
- **Ⓓ 프롬프트 라이브러리**: 프롬프트 CRUD + `/명령` + 변수 치환(T1-08/T6-13).
- **Admin 모델 편집**: `allowedModels` 편집(T1-09/T6-14, organizations 컬럼 재사용).
- **Admin 배너 + LLM 제목/태그**: banner typed 스키마(T1-10)·실표시(T6-15), LLM 제목/태그 생성(T2-06, 파생 폴백 유지).
- **Admin API 키**: 발급/폐기 + Bearer 인증(T1-11/T6-16).
- **Admin 웹검색 provider**: org 설정 provider(T1-12/T6-17, dev-stub 배선).
- **Admin RBAC(최중량 — 격리 주의)**: 그룹/멤버(T1-13), 리소스 접근제어(T1-14, frozen 요구 시 격리), 관리 UI(T6-18).
- **제외(범위 밖·이 phase 아님)**: 음성/TTS·STT, 이미지 생성, 실 코드 인터프리터, 다중 LLM provider 연결, Notes/Channels, Functions/Pipelines, Evaluations/Arena, OAuth/LDAP/SCIM SSO(env-coupled), 멀티모델 동시질의, 추론(thinking) 표시(ChatEvent frozen → 별도 phase).

## 4. 검증 (커밋 전 필수)

- `bash scripts/verify-gates.sh` exit 0 (typecheck·lint·test·validate-state). 새 route 는 routes-mounted 가드 green.
- **서버**: 계약 흐름(403/400/cross-org)·마이그레이션 RLS 는 **createApp 실HTTP 통합테스트**. FK-의존 경로는 세션 ensure 포함(L3).
- **L1 확인**: "토글/설정이 실제로 runTurn·tool set·persist 에 도달"을 유닛이 아니라 createApp 경로로 단언했는지.
- **T6**: 화면형은 `bash scripts/verify-browser.sh` 통과(스크린샷 `.ralph/screenshots/`). 불가 환경이면 격리.
- **실행하지 않은 검증을 통과했다고 서술하지 말 것.** 외부 provider 실호출은 이 환경에서 미검증임을 명시(dev-stub 배선까지만 주장).

## 5. 기록 & 커밋

- 해당 항목 `passes` 만 true 로(그 외 필드·항목 수·문구 수정 금지).
- PROGRESS.md 1줄 → `git add -A && git commit -m "feat(<team>/P19): <task>"` (반복당 커밋 1개). 원격 push/merge/rebase 금지.

## 6. Blocker 격리 (루프를 멈추지 않는다)

- 막히면(attempts>=3, 사람 결정 필요, FROZEN(interfaces·shared·generated·ChatEvent·ChatInput·Organization·User) 수정 필요, 신규 SSE 이벤트 필요, 신규 의존성 필요, 표 밖 파일 편집 필요, env-coupled(SSO 등), 외부 실 provider 필요, 브라우저 검증 불가):
  `.ralph/blocked_tasks` 에 `<task-id> | <한 줄 사유>` append 후 **같은 phase 의 다음 태스크로 진행**.
- `.ralph/BLOCKED`(루프 전체 정지)는 쓰지 않는다 — wrapper 전용.

## 7. 신호 (엄격 — 오탐 방지)

- 신호를 낼 때만, **출력의 마지막 줄에 신호 문자열만 단독**으로(앞뒤 텍스트·백틱·따옴표 없이) 쓴다. 안 낼 땐 신호 문자열을 출력 어디에도(설명·부정문 포함) 쓰지 말 것.
- P19 에서 격리 안된 항목 전부 passes=true → `.ralph/PHASE_DONE` 에 `P19` 기록 후 마지막 줄에 `<PHASE_COMPLETE:P19>` 단독 출력하고 종료.
- P19 의 남은 미완 항목이 전부 격리 → 마지막 줄에 `<PHASE_BLOCKED:P19>` 단독 출력하고 종료.
- 그 외(태스크 1개 완료, 다음 남음) → 신호 없이 간단 요약만 출력.
