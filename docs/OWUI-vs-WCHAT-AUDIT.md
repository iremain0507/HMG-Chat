# Open WebUI 대비 WChat 기능 전수 비교 (post-P19)

> 조사 방식: 15개 병렬 에이전트(WChat 현행 코드 인벤토리 6영역 + Open WebUI 공식 문서/README 카탈로그 3도메인 → 도메인 6개 전수 대조). 모든 WChat 상태는 실제 repo 코드(grep/read) 근거. 생성일 기준 post-P19(38/38) 상태.

## 종합 대시보드

총 **~298개** Open WebUI 기능을 대조:

| 도메인                                     | ✅ 개발됨 | ⚠️ 부분/스텁 | ❌ 미개발 |
| ------------------------------------------ | --------: | -----------: | --------: |
| 채팅 코어 & 메시지 액션                    |        11 |            2 |        12 |
| 세션 조직화 & 데이터                       |        12 |            5 |        13 |
| 지식/RAG/도구/프롬프트/메모리              |         6 |           18 |        17 |
| 고급 채팅(코드/이미지/음성/렌더/노트/채널) |         3 |            2 |        30 |
| 관리자: 사용자/RBAC/인증/API키/일반        |        17 |           16 |        39 |
| 관리자: 모델/설정/확장/플랫폼              |        22 |           21 |        52 |
| **합계**                                   |    **71** |       **64** |   **163** |

- **✅ 개발됨 71 (24%)** · **⚠️ 부분·dev-stub·격리 64 (21%)** · **❌ 미개발 163 (55%)**
- WChat은 Open WebUI(범용 올인원)와 달리 **사내 Hyundai WIA 엔터프라이즈 에이전틱 챗**에 집중한 부분집합이라, 미개발 55%의 상당수는 **의도적 범위 밖**(음성/이미지/오디오, Functions/Pipelines 임의 파이썬, 커뮤니티 마켓, 멀티모델 동시질의, Arena/Elo, 노트/채널 등)입니다.

## 핵심 인사이트

### 🔴 가장 큰 실질 갭 (엔터프라이즈에 의미있는 미완성)

1. **지식/RAG가 실사용 무동작** — 검색·하이브리드·인용 배선은 있으나 **인덱싱 생산측이 미배선**(임베딩 dev-stub 전용, `ephemeral_chunks` 미충전, `knowledge_search` 도구 app.ts 미조립). → 문서 근거 답변이 실제로 안 됨. **1순위 후속 후보.**
2. **RBAC 실 enforcement 미배선** — 그룹·권한·resource_grants·`canAccessResource`(additive union)·RLS 인프라는 완성이나, **각 조회 라우트에 실제 접근제어를 거는 배선**은 P19-T1-14가 범위 축소로 후속 처리.
3. **추론(thinking) 표시·reasoningEffort** — Claude 확장사고 스트림/사고강도 전달이 없음(ChatEvent 동결로 신규 SSE 이벤트 금지 → 격리). `reasoningEffort`는 클라가 보내나 서버 no-op.
4. **엔터프라이즈 인증(OAuth/OIDC/LDAP/SCIM/SSO)** — 없음(현재 magic-link+도메인 게이트). 사내 IdP 연동 시 필요.
5. **웹검색 실 provider** — Tavily 1종 + dev-stub만(OWUI는 20+ 공급자). org provider 설정 UI는 있으나 실 adapter 1종.
6. **소소한 UX 갭** — 개별 메시지 삭제 없음, 세션 목록 페이지네이션 limit-only(무한스크롤 미동작), 검색 접두어 문법(`tag:`/`folder:`) 없음, 이미지/음성/read-aloud 없음.

### 🟢 WChat 고유 강점 (Open WebUI에 없거나 다르게 구현)

- **HITL 승인 게이트** — 정책 도구 실행 전 인라인 사용자 승인(`hitl_request`→승인→`hitl_resolved`).
- **deep_research 멀티에이전트** — plan→병렬 researcher→synthesis→gap 반성→인용 dedup/환각drop.
- **org-scoped 멀티테넌트 RLS** — 전 데이터(세션/폴더/태그/그룹/grant)가 org_id + RLS 격리(OWUI는 단일 인스턴스/per-user).
- **SSE 복원력** — keep-alive 하트비트 + resume(재연결 캐치업) + iOS 백그라운드 stale 워치독 + 최종답변 복구.
- **결정적 dev-stub 폴백** — 제목/태그/후속질문/웹검색/임베딩이 외부 provider 실패 시 결정적 파생으로 항상 응답(LOCAL_ONLY 개발 무중단).
- **아티팩트 중심 산출물 공유** — 대화 텍스트가 아닌 최종 산출물(아티팩트)을 만료/revoke 가능한 공개 토큰 링크로 공유.

### ⚪ 의도적 범위 밖 (구현 안 하는 게 합리적)

음성/영상 통화·STT·TTS, 이미지 생성/편집, 코드 인터프리터 실행 환경(터미널), Functions/Pipelines/Filters(임의 파이썬=보안), 커뮤니티 마켓플레이스, 멀티모델 동시질의·MOA 합성, Arena/Elo 평가, 노트·채널, 다중 LLM provider 연결, Direct Connections.

---

## 도메인별 전수 비교표

아래는 6개 도메인 전수 대조표입니다. 상태 표기: **✅ 개발됨** / **⚠️ 부분·dev-stub·격리**(무엇이 빠졌는지 명시) / **❌ 미개발**(필요조건 명시). 각 도메인 끝에 **WChat 고유 기능** 소절 포함.

## 채팅 코어 & 메시지 액션

| 기능                            | 설명                                                                         | WChat 상태                    | 근거/비고                                                                                                                                                                                                                                                                     |
| ------------------------------- | ---------------------------------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SSE 스트리밍                    | 응답을 토큰 단위로 실시간 스트리밍 표시                                      | ✅ 개발됨                     | `routes/messages.ts` `POST /:id/messages`→`streamSSE`+`runTurn`, 클라 `useSessionStream.ts` `streamTurn`/`parseSseFrame`. keep-alive 하트비트(10s ping)+14s stale 워치독, resume(재연결 캐치업) `GET /:id/messages/:mid/stream`, 멀티-leg(tool_use 후 이어짐)까지 실구현      |
| 취소(Stop)/Abort 전파           | 생성 중 응답을 중단하고 서버 실행을 취소                                     | ✅ 개발됨                     | 클라 `stop()`→`DELETE /:id/active-run`(`abortRun`)+`AbortController`, 서버 `registerRun`/`handle.controller.signal`→`runTurn` 취소 전파                                                                                                                                       |
| Model Switching / Selector      | 채팅 중 모델 셀렉터로 모델 교체, 턴별 다른 모델 사용                         | ✅ 개발됨                     | 컴포저 `ModelModePicker.tsx`(models 목록/model 선택), 서버 `messages.ts:373` `org.allowedModels` 화이트리스트 검증 후 `model=requestedModel`(미허용 400 `MODEL_NOT_ALLOWED`), org `defaultModel` 폴백. 턴별로 모델 지정 가능                                                  |
| Multi-Model Chat (동시 질의)    | 한 채팅에서 여러 모델을 붙여 같은 프롬프트를 병렬 질의                       | ❌ 미개발                     | grep 결과 `multiModel`/병렬 응답 로직 0건. 서버·클라 모두 턴당 단일 모델만 소비(`messages.ts` `model` 단일 필드). 다중 모델 동시 fan-out·상태 트리 없음                                                                                                                       |
| Parallel Response Display       | 여러 모델 응답을 나란히/스택 비교 표시                                       | ❌ 미개발                     | Multi-Model Chat 부재의 UI 측면. side-by-side/형제 다중응답 뷰 없음(분기는 동일 모델 재생성만)                                                                                                                                                                                |
| Merge / MOA Synthesizer         | 여러 모델 출력을 Synthesizer 모델로 합성                                     | ❌ 미개발                     | grep `synthesizer`/`moa`/`mixture` 0건. deep_research 멀티에이전트는 존재하나(범위 밖) 다중모델 응답 합성기와 무관                                                                                                                                                            |
| Cross-Model Fact Validation     | 모델 간 응답 불일치 교차 검증                                                | ❌ 미개발                     | grep `crossModel` 0건. 다중모델 인프라 자체가 없어 전제 미충족                                                                                                                                                                                                                |
| 편집(Edit)                      | 사용자 메시지 편집 후 재전송(형제 생성)                                      | ✅ 개발됨                     | `useSessionStream.ts:891` 동일 부모 아래 새 user 형제 생성, UI `MessageActions.tsx` 편집 버튼(user 역할). 어시스턴트 응답 직접 편집은 없음(재생성/이어쓰기로 대체)                                                                                                            |
| 재생성(Regenerate)              | 동일 프롬프트로 응답 재생성(형제 메시지)                                     | ✅ 개발됨                     | `useSessionStream.ts:914` user 노드까지 부모체인 역행 후 새 assistant 형제, UI `ChatView.tsx`+`MessageActions.tsx` 재생성 버튼(assistant 전용)                                                                                                                                |
| 이어쓰기(Continue Response)     | 잘린 응답을 이어서 계속 생성                                                 | ✅ 개발됨                     | 서버 `POST /:id/messages/:mid/continue`(직전 assistant를 prefix로 재스트리밍, 완료 시 원본 행 update), 클라 `continueMessage`, `truncated`(max_tokens stop) 시 "이어쓰기" 버튼 노출                                                                                           |
| 복사(Copy)                      | 메시지 내용을 클립보드로 복사                                                | ✅ 개발됨                     | `MessageActions.tsx` `copy()`→`lib/clipboard.ts` `copyText`(마크다운 원문 복사), "복사됨" 토스트                                                                                                                                                                              |
| 삭제(Delete) — 채팅             | 대화(세션) 전체 삭제                                                         | ✅ 개발됨                     | `DELETE /:id`(`sessions.ts:422`, ownership in-query, messages CASCADE)                                                                                                                                                                                                        |
| 삭제(Delete) — 개별 메시지      | 채팅 내 단일 메시지 삭제                                                     | ❌ 미개발                     | `deleteMessage`/per-message delete 라우트 없음(세션 단위 삭제만). 편집은 형제 생성이지 삭제 아님. 개별 메시지 삭제 엔드포인트·UI 부재                                                                                                                                         |
| 평가/피드백(Rating)             | 응답에 👍/👎 피드백                                                          | ✅ 개발됨(👍/👎 한정)         | 서버 `POST\|GET /:id/messages/:mid/feedback`(upsert/토글취소, ownership, migration 0023 `message_feedback`), UI `MessageActions.tsx` `toggleFeedback`+`lib/messageFeedback.ts`(낙관적+롤백). ⚠️ 세밀한 1~10 평점·형제 자동 다운보트·Elo 리더보드 연동은 없음(👍/👎 boolean만) |
| Message Branching (트리 구조)   | parent-child 메시지 트리로 대안 경로 분기·전환                               | ✅ 개발됨                     | 트리 모델(`parentOf/childrenOf/activeChildOf`)+`switchBranch`(`useSessionStream.ts:1008`), 새로고침 복원은 `loadHistory`가 서버 `parentMessageId` 소비. 서버 응답/영속에 `parentMessageId` 포함                                                                               |
| Reasoning / Thinking 표시       | `<think>` 등 사고 태그를 접이식 블록으로 렌더, 히스토리 보존                 | ⚠️ 부분(UI 껍데기만)          | `Reasoning.tsx` 접이식 표시 컴포넌트는 존재하나, **서버가 reasoning delta를 스트리밍하지 않음** — ChatEvent 12변형 frozen(신규 SSE 이벤트 금지)이라 사고 스트림 미구현. reasoning_tags 자동 감지·히스토리 보존·재전송 없음                                                    |
| Reasoning Effort (low/med/high) | 사고 강도 파라미터를 provider에 전달                                         | ⚠️ 부분(클라 전용·서버 no-op) | 클라 `ChatInput.tsx:339`가 body에 `reasoningEffort` 전송하나 서버 `messages.ts` body 파싱 타입에 필드 없음(`apps/server/src` 전역 grep 0건). UI 피커(`ModelModePicker` effort select)만 존재, provider thinking budget 매핑 부재                                              |
| Read Aloud (TTS)                | 응답을 음성으로 낭독                                                         | ❌ 미개발                     | grep `read.?aloud`/`speechSynthesis`/`utterance`/`tts` 0건. 채팅 코어에 TTS 낭독 버튼·엔진 배선 없음(오디오 도메인 전반 부재)                                                                                                                                                 |
| Info (생성 메타)                | 토큰 수·응답 시간 등 생성 메타 표시                                          | ❌ 미개발                     | 메시지 레벨 토큰/시간 info UI 없음. `usage.inputTokens`는 테스트 fixture에만 존재(표시 안 함), `elapsedMs`는 tool-call 진행 시간(`ToolCallRenderer.tsx`)이지 응답 메타가 아님                                                                                                 |
| Generate Image (메시지 액션)    | 응답에서 이미지 생성 버튼                                                    | ❌ 미개발                     | 채팅 메시지 툴바에 이미지 생성 액션 없음(grep 0건). code_interpreter가 산출물을 아티팩트로 저장할 뿐 별개                                                                                                                                                                     |
| Structured Response Editing     | 툴콜·reasoning·코드 출력 접이식 필드/JSON 편집                               | ❌ 미개발                     | ToolCallRenderer는 상태 표시(읽기 전용)만, 구조화 응답 편집 UI 없음. reasoning 스트림 자체 부재                                                                                                                                                                               |
| Action Buttons (Custom)         | Action Function으로 메시지 툴바에 커스텀 버튼 추가                           | ❌ 미개발                     | Open WebUI Functions(Action) 확장 모델 자체가 WChat에 없음. 메시지 액션바는 복사/편집/재생성/피드백 고정                                                                                                                                                                      |
| Message Queue                   | 생성 중 메시지를 큐에 쌓아 완료 시 합쳐 전송                                 | ❌ 미개발                     | 큐잉/Send Now/세션 저장 로직 없음. WChat은 생성 중 새 전송 불가(단일 active-run) 모델                                                                                                                                                                                         |
| Follow-Up Prompts               | 응답 후 문맥 기반 후속 질문 자동 제안                                        | ✅ 개발됨                     | 서버 `POST /:id/followups`(REST)→`orchestrator/followups.ts` `generateFollowups`(실 `provider.chat` 호출+파싱실패/dev-stub 시 `deriveFollowups` 결정적 폴백, ownership 검증), UI 칩 `ChatView.tsx`+클릭 전송. ⚠️ LOCAL_ONLY dev-stub provider에선 폴백 파생                   |
| Direct Connections              | 사용자가 개인 OpenAI-호환 엔드포인트를 브라우저에 추가·백엔드 우회 직접 추론 | ❌ 미개발                     | 사용자 개인 브라우저-저장 커넥션 없음. org admin이 서버측 provider를 설정할 뿐(주로 연결/admin 도메인). 채팅 코어 관점에선 부재                                                                                                                                               |

### 도메인 상태 요약

- **✅ 개발됨**: SSE 스트리밍(+하트비트/resume/멀티-leg), 취소/Abort, 모델 전환, 편집, 재생성, 이어쓰기, 복사, 세션 삭제, 👍/👎 피드백, 분기(branching), 후속질문.
- **⚠️ 부분/no-op**: Reasoning/Thinking 표시(UI만, 서버 스트림 없음 — ChatEvent frozen), reasoningEffort(클라 전송하나 서버 미파싱), 평가(👍/👎만·세밀 평점/Elo 없음), 후속질문(dev-stub 폴백).
- **❌ 미개발**: 멀티모델 동시질의·병렬 표시·MOA 합성·교차검증, 개별 메시지 삭제, Read Aloud(TTS), Info 메타, 메시지 액션 이미지 생성, Structured Editing, 커스텀 Action 버튼, Message Queue, Direct Connections.

## WChat 고유 기능 (Open WebUI에 없거나 다르게 구현)

- **첨부 힌트 블록 + ephemeral citation 스트리밍** — 턴 중 첨부 파일에 대해 citation SSE 이벤트를 방출하고 인용 환각 마커(`[N]`)를 자동 drop(`orchestrator.ts` `dropUnmatchedCitationMarkers`). Open WebUI의 RAG 인용과 달리 채팅 코어 스트림에 통합된 근거 검증 패스. (단, WChat은 임베딩 인덱싱 생산측이 미배선이라 실사용 무동작 갭 있음.)
- **HITL(Human-in-the-loop) 승인 게이트** — 특정 정책(`defaultPolicy:"hitl"`) 도구 실행 전 `hitl_request` SSE 방출→사용자 승인 대기→`hitl_resolved`/`hitl_timeout` 방출(`POST /:id/messages/hitl`, `GET /:id/hitl/pending`). Open WebUI에는 없는 채팅 인라인 도구 승인 흐름.
- **agent/chat 모드 서버 강제 소비** — `body.mode==="chat"`이면 서버가 `tools=[]`로 순수 대화 강제(`messages.ts:419`). Open WebUI는 툴 활성이 per-chat/per-model 토글이지만 WChat은 단일 모드 스위치로 서버가 도구셋을 강제 결정.
- **결정적 dev-stub 폴백 파이프라인** — 제목/태그 생성·후속질문·web_search·임베딩이 LOCAL_ONLY에서 provider 실패 시 결정적 파생 폴백(`deriveSessionTitle`/`deriveFollowups`)으로 항상 응답. Open WebUI는 외부 provider 의존.
- **tool_progress 스윔레인 + RunRail 눈금 UI** — 멀티-leg/멀티에이전트 도구 실행을 `ToolCallRenderer`(multi-agent badge)+`RunRail.tsx` 눈금으로 시각화. Open WebUI의 task 체크리스트와 다른, 실행 타임라인 중심 표현.
- **취소를 명시적 REST 리소스로 모델링** — Stop이 `DELETE /:id/active-run`이라는 별도 리소스 삭제 시맨틱(단일 active-run 불변식). Open WebUI는 스트림 abort 중심이며 active-run을 1급 리소스로 다루지 않음.

## 세션 조직화 & 데이터

Open WebUI 이 이 도메인에서 제공하는 모든 기능을 나열하고 WChat 상태를 대조한다. WChat 상태는 [WCHAT 인벤토리 chat-org/chat-core/artifacts-misc]와 현재 repo 확인(grep)에 근거한다.

### 조직화 (폴더 / 태그 / 핀 / 아카이브 / 임시)

| 기능                             | 설명                                                   | WChat 상태 | 근거/비고                                                                                                                                                                                                                                               |
| -------------------------------- | ------------------------------------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Folders / Project Workspaces     | 채팅을 폴더로 묶어 프로젝트 워크스페이스화             | ⚠️ 부분    | 폴더 자체는 개발됨(migration `0019_session_folders.sql`, `routes/folders.ts` CRUD, `sessions.ts:386` `PATCH /:id {folderId}` 소유검증 할당, `SessionList` 폴더 그룹 UI). 단 "프로젝트 워크스페이스"의 핵심인 폴더별 컨텍스트 상속은 없음(아래 2건 참조) |
| Nested Folders                   | 하위 폴더 계층·확장/축소                               | ❌ 미개발  | `0019` 스키마에 `parent_folder`/부모 FK 없음, grep 0건 — 폴더는 단일 레벨(flat)                                                                                                                                                                         |
| Folder System Prompt & Knowledge | 폴더 내 채팅에 자동 적용되는 시스템 프롬프트·지식 첨부 | ❌ 미개발  | `session_folders`는 순수 조직화 컬럼(org_id+created_by+name)만 보유. 폴더-스코프 시스템 프롬프트/KB 연결 스키마·코드 부재                                                                                                                               |
| Active Workspace Selection       | 폴더 활성화 시 새 채팅이 그 안에 생성·설정 상속        | ❌ 미개발  | 활성 폴더가 신규 세션 생성 컨텍스트를 결정하는 로직 없음(위 상속 기능 부재의 연장)                                                                                                                                                                      |
| Drag & Drop / Right-click 이동   | 사이드바에서 폴더 간 드래그·우클릭 이동                | ⚠️ 부분    | 이동 자체는 `SessionCard` 폴더 지정/해제 **메뉴**로 가능. 드래그앤드롭·우클릭 컨텍스트 메뉴는 없음(`onDrop`/`draggable` grep 0건)                                                                                                                       |
| Folder Sharing                   | 폴더를 사용자/그룹에 read/write 공유, 하위 상속        | ❌ 미개발  | 폴더는 개인 소유(`created_by`)이며 공유 grant 경로 없음. chat-org 인벤토리상 "폴더는 공개 불가"                                                                                                                                                         |
| Folder Background Customization  | 폴더별 배경 이미지                                     | ❌ 미개발  | 관련 컬럼·UI 없음                                                                                                                                                                                                                                       |
| Tags                             | 채팅 태그 라벨링·필터                                  | ✅ 개발됨  | `0020_session_tags.sql`(UNIQUE(session_id,tag)), `POST/DELETE /:id/tags`(`sessions.ts:182,207`), `SessionCard` 태그 칩 + `SessionList` 태그 필터 바. 서버 `?tag=` 필터 존재하나 목록 UI는 클라이언트 측 필터(`SessionList.tsx:291`)                     |
| Pin                              | 자주 쓰는 채팅 상단 고정                               | ✅ 개발됨  | `0018_session_pin.sql`(pinned_at), `PATCH /:id/pin` 원자적 토글(`sessions.ts:224`), "고정" 그룹 최상단, `lib/pinnedSessions.ts`(localStorage→서버 승격)                                                                                                 |
| Archive                          | 채팅을 보관함으로 이동(복원 가능)                      | ✅ 개발됨  | `0021_session_archive.sql`, `PATCH /:id/archive`(`sessions.ts:240`), `GET /?archived=true` 보관함, `SessionList` 보관함 뷰 토글                                                                                                                         |
| Bulk Archive                     | 전체 일괄 아카이브                                     | ❌ 미개발  | 다중 선택/일괄 액션 UI 없음(`bulk`/`selectedSessions` grep 0건) — 단건 토글만                                                                                                                                                                           |
| Temporary Chat                   | 히스토리 미저장 일회성 세션                            | ✅ 개발됨  | `messages.ts:271` `isTemporary` → `ensureSession`·insert 스킵(미영속), `ModelModePicker` 임시 토글 + `ChatInput.tsx:490` 비저장 배너                                                                                                                    |
| Unread Indicators                | 백그라운드 새 활동 미확인 표시                         | ❌ 미개발  | `unread` grep 0건 — 미확인 상태 추적 스키마·UI 없음                                                                                                                                                                                                     |
| Custom / Auto Title              | 자동 생성 제목 수정 + task 모델 자동 생성              | ✅ 개발됨  | 수정: `PATCH /:id {title}`(`sessions.ts:360`) + `SessionCard` 인라인 편집. 자동: `orchestrator/session-title-tags.ts` LLM 생성(폴백 `deriveSessionTitle`), `messages.ts:592` 소비                                                                       |

### 히스토리 / 검색 / 필터

| 기능                                                              | 설명                                          | WChat 상태 | 근거/비고                                                                                                                                                                                                        |
| ----------------------------------------------------------------- | --------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Persistent History                                                | DB 영속·시간대별 자동 그룹(Today/Yesterday/…) | ✅ 개발됨  | `GET /:id/messages`(`sessions.ts:255`) → `loadHistory`, `parentMessageId` 트리 복원, 날짜 그룹(`groupSessionsByDate`: 고정→오늘→어제→이전7일→이전). 세션 목록은 커서 페이지네이션 미동작(limit-only 단일 페이지) |
| Global Search (Cmd/Ctrl+K)                                        | 제목·본문·태그 퍼지 검색 바                   | ⚠️ 부분    | 제목+메시지 내용 검색은 개발됨(`GET /search?q=`, `session-data-access.ts` ILIKE, `0022` GIN pg_trgm, 200ms 디바운스+AbortController). 단 Cmd/K 전역 커맨드 팔레트 형태 아님(사이드바 인라인), 태그 스코프 미포함 |
| Prefix Filters (`tag:` `folder:` `pinned:` `archived:` `shared:`) | 접두어로 검색 범위 좁히기·조합                | ❌ 미개발  | 접두어 파싱 없음(grep 0건). 필터는 각각 별도 UI 컨트롤(태그 바·보관함 토글·폴더 그룹)로만 제공, 검색어 문법 조합 불가                                                                                            |
| Result Snippets                                                   | 검색 결과 매칭 메시지 발췌 표시               | ✅ 개발됨  | `SessionList.tsx:421` "메시지 내용 검색결과" 스니펫 섹션                                                                                                                                                         |
| Agentic Chat Search (`search_chats`·`view_chat`)                  | 모델이 과거 대화를 네이티브 툴로 자율 검색    | ❌ 미개발  | 해당 내장 도구 없음(`search_chats`/`view_chat` grep 0건). 검색은 UI 전용, 모델 노출 안 됨                                                                                                                        |

### 공유 / 내보내기 / 가져오기 / 브랜칭

| 기능                               | 설명                                           | WChat 상태 | 근거/비고                                                                                                                                                                                     |
| ---------------------------------- | ---------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Share Link (Snapshot)              | 채팅 시점 스냅샷 공유 링크(불변)               | ⚠️ 부분    | `ShareExportMenu` "대화 공유"는 opt-in 확인 후 세션의 **최신 아티팩트**만 공개 토큰 링크(`ShareDialog`/`routes/public-share.ts`)로 위임. 대화 전체를 스냅샷 링크화하는 기능은 아님            |
| Community Platform 공유            | openwebui.com에 접근수준별 업로드              | ❌ 미개발  | 외부 커뮤니티 플랫폼 연동 없음(엔터프라이즈 사내 범위상 해당 없음)                                                                                                                            |
| Update / Delete Share Link         | 공유 스냅샷 갱신·링크 무효화·RBAC              | ⚠️ 부분    | 아티팩트 공유 링크의 만료(410)/revoke는 `useShare`+`public-share.ts`에 존재. 단 대화 스냅샷이 아니라 아티팩트 대상이며 스냅샷 갱신 개념 없음                                                  |
| Shared Chats Dashboard             | 공유한 모든 채팅 관리(검색·정렬·해제)          | ❌ 미개발  | 공유 채팅 목록/관리 대시보드 없음                                                                                                                                                             |
| Export (JSON / PDF / Markdown)     | 개별/전체 채팅을 3포맷 다운로드                | ✅ 개발됨  | `lib/export-conversation.ts`(md/json 클라이언트 직렬화) + `ShareExportMenu.exportPdf`(`chat-print-view` 렌더 후 `window.print()`, 신규 의존성 없음). 전체 일괄 export는 아니고 현재 대화 단위 |
| Import (JSON / ChatGPT / Custom)   | 내보낸 채팅·ChatGPT export 가져오기            | ❌ 미개발  | import/가져오기 라우트·UI·코드 전무(server/web grep 0건). 내보내기의 역방향 흐름 부재                                                                                                         |
| Message Branching (Tree Structure) | parent-child 메시지 트리로 대안 경로 분기·전환 | ✅ 개발됨  | 트리 모델(`parentOf/childrenOf/activeChildOf`) + `switchBranch`(`useSessionStream.ts:1008`), 편집/재생성 시 형제 생성, 새로고침 시 `parentMessageId`로 복원(`sessions.ts:274`)                |

### 후속질문 / 자동완성 / 제목 / 알림

| 기능                         | 설명                                                       | WChat 상태        | 근거/비고                                                                                                                                                                                                  |
| ---------------------------- | ---------------------------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Follow-Up Prompts            | 응답 후 문맥 기반 후속 질문 자동 제안·클릭 전송            | ✅ 개발됨         | `POST /:id/followups`(REST) → `orchestrator/followups.ts` `generateFollowups`(provider 호출 + `deriveFollowups` 결정적 폴백, ownership 검증), UI 칩 `ChatView.tsx:1039`/클릭 전송                          |
| Autocomplete (고스트 텍스트) | 입력 중 실시간 인라인 자동완성(Tab/→ 수락), task 모델 구동 | ❌ 미개발         | 고스트텍스트 입력 자동완성 없음(`autocomplete`/`ghost-text` grep 0건). 존재하는 자동완성은 `/`슬래시 커맨드 피커(`ChatInput.tsx`)뿐 — 성격이 다름                                                          |
| Title Generation             | 대화 기반 채팅 제목 자동 생성(task 모델)                   | ✅ 개발됨         | `session-title-tags.ts` LLM 제목(40자)+태그 생성, 파싱 실패 시 파생 폴백. 첫 턴 완료 후 `messages.ts:592` 호출 → 제목 update + `session_tags` 반영                                                         |
| Notifications                | 응답 완료 시 토스트·브라우저 알림(백그라운드 탭)           | ✅ 개발됨(제한적) | `useSessionStream.ts:175` `notifyTurnComplete`: `document.hidden`일 때만 브라우저 `Notification` 1회, 권한 처리(granted/default/denied 분기). 단 이 도메인의 웹훅·리마인더·미확인 배지 등 확장 알림은 없음 |

### WChat 고유 / 다르게 구현된 기능 (이 도메인)

- **아티팩트 중심 공유** — Open WebUI가 "대화 스냅샷"을 공유하는 것과 달리, WChat의 "대화 공유"는 세션의 **최신 산출물(아티팩트)** 을 공개 토큰 링크로 노출(`ShareDialog`, `routes/public-share.ts`, 만료/revoke 지원). 대화 텍스트가 아닌 결과물 배포에 최적화된 다른 모델.
- **세션 재진입 시 아티팩트 복원** — 히스토리 복원 시 메시지 트리뿐 아니라 `GET /:id/artifacts`로 생성 아티팩트도 함께 복원(`useSessionStream.ts:380`). Open WebUI 히스토리 복원에는 없는 결합.
- **멀티테넌트 org-스코프 데이터 모델** — 폴더·태그가 `org_id`를 보유하고 RLS 정책(`session_folders_select/modify`, `session_tags` org_id RLS)이 정의된 엔터프라이즈 격리 구조. Open WebUI의 per-user 단일 인스턴스 모델과 근본적으로 다름(단, chat-org 인벤토리상 런타임 RLS는 app-level `WHERE org_id` 필터가 실효 방어선).
- **핀 localStorage → 서버 승격 경로** — 핀 상태를 localStorage에서 서버 `pinned_at`로 승격하는 마이그레이션 경로(`lib/pinnedSessions.ts`, `0018` nullable-first). Open WebUI는 처음부터 서버 저장.
- **GIN pg_trgm 트라이그램 내용 검색 인덱스** — `0022`가 title + messages.content에 pg_trgm GIN 인덱스를 명시 구성(`session-data-access.ts` ILIKE + ESCAPE 와일드카드 처리). Open WebUI docs는 검색 존재만 언급, 인덱스 전략은 다름.

**주의(과장 방지)**: LLM 태그 자동 생성은 WChat 고유가 아님 — Open WebUI도 `ENABLE_TAGS_GENERATION`으로 동일 제공하므로 고유 목록에서 제외했다.

## 지식/RAG/도구/프롬프트/메모리

Open WebUI(이하 OWUI)의 해당 도메인 전 기능을 나열하고 WChat 상태를 판정. WChat 공통 전제: **모든 임베딩은 dev-stub 전용**(`createDevStubEmbeddingProvider`, 실 Voyage 미구현) — 벡터검색 "의미품질"은 LOCAL_ONLY 결정론적 stub에 의존. 근거는 repo 코드 확인 기준.

### RAG & 지식 (in chat)

| 기능                                    | 설명                                                | WChat 상태             | 근거/비고                                                                                                                                                                                                                                                                                            |
| --------------------------------------- | --------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `#` Document Loading                    | 업로드 문서를 `#`로 참조해 대화 컨텍스트에 주입     | ⚠️ 부분(실사용 무동작) | 첨부 검색측은 실배선(`messages.ts:334-346`→`ephemeral-chunk-search.ts`, SSE citation 방출)이나 **인덱싱 생산측(parse→chunk→embed→`INSERT ephemeral_chunks`)이 어디에도 없음**(`uploads.ts:44-63`). `ephemeral_chunks`가 절대 안 채워져 항상 빈 결과. `#` 참조 문법 UI 없음 — 첨부는 파일 업로드 방식 |
| `#url` Web Page                         | `#`+URL로 웹페이지를 문서로 로드                    | ❌ 미개발              | url 인제스트 코드 0건(grep). 웹은 web_search 도구 경로만 존재                                                                                                                                                                                                                                        |
| YouTube Transcript RAG                  | 유튜브 자막 로드·요약                               | ❌ 미개발              | youtube/transcript 로더 0건                                                                                                                                                                                                                                                                          |
| Knowledge Base Collections              | 재사용 지식베이스를 모델/대화에 연결                | ⚠️ 부분(런타임 미배선) | 인덱싱은 됨(`document-service.ts` parse+chunk+embed(dev-stub)→`DocumentChunkRepo`, app.ts:290-301). 그러나 `knowledge_search` 도구가 `assembleBuiltinTools`·app.ts 어디에도 미배선 + `KnowledgeRetrievalPort` pg 구현체 부재 → 모델이 조회 불가(PROGRESS P14-T3-01 명시)                             |
| Citations / References                  | 투입 문서 출처를 인용으로 추적·표시                 | ✅ 개발됨              | `orchestrator.ts:182+`가 tool_result의 `{citations}`를 `citation` ChatEvent로 방출. 환각방지 `dropUnmatchedCitationMarkers`(목록 밖 `[N]` 제거). 12변형 동결 준수                                                                                                                                    |
| Hybrid Search (BM25+Vector)             | 키워드+시맨틱 결합, relevance threshold             | ⚠️ 부분                | `search-service.hybridSearch` = vector(cosine)+bm25(count 근사)+RRF, org_settings topK/rrfK/threshold 반영(실코드). 단 임베딩 dev-stub, ephemeral 경로만 실소비, knowledge 경로 미배선                                                                                                               |
| Reranking                               | CrossEncoder로 청크 리랭킹, 상위만 사용             | ⚠️ 부분(RRF만)         | RRF fusion 랭킹은 있으나 별도 CrossEncoder 리랭커 모델 없음. admin `ragRrfK` 설정만 노출                                                                                                                                                                                                             |
| Full Context Mode ("전체 문서 주입")    | 청킹 없이 문서 전문 주입 토글                       | ❌ 미개발              | "Using Entire Document"/full-context 토글 없음                                                                                                                                                                                                                                                       |
| Multi-Format Parsing (Tika/Docling/OCR) | PDF·DOCX 등 다포맷 파싱 엔진 선택                   | ⚠️ 부분                | `document-service` 파싱 + `office-pdf-converter`(pptx→pdf) 존재. Tika/Docling/Mistral OCR 등 다엔진 선택 없음                                                                                                                                                                                        |
| Google Drive Integration                | 드라이브 문서 직접 업로드                           | ❌ 미개발              | 외부 커넥터 없음                                                                                                                                                                                                                                                                                     |
| File Upload / Drag-Drop / File Manager  | 파일 업로드·중앙 파일매니저·삭제 시 임베딩 딥클린업 | ⚠️ 부분                | 업로드 실동작(`uploads.ts` sha256 dedup + object store, migration 0014). 중앙 파일매니저 UI·임베딩 딥클린업 없음(인덱싱 자체가 미배선)                                                                                                                                                               |

### 웹검색 (in chat)

| 기능                   | 설명                                                        | WChat 상태        | 근거/비고                                                                                                                                                                              |
| ---------------------- | ----------------------------------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Live Web Search Toggle | 채팅별 웹검색 켜기                                          | ✅ 개발됨         | admin `webSearchEnabled` + 요청 `body.webSearch` 둘 다 true일 때만 도구셋 포함(`messages.ts:411-415`)                                                                                  |
| 20+ Providers          | SearXNG·Brave·Tavily 등 다수 공급자                         | ⚠️ 부분(Tavily만) | 실 adapter는 Tavily 1종(`web-search-provider-tavily.ts`) + dev-stub. org 설정 provider select도 tavily/dev-stub 2택. 20+ 아님                                                          |
| Web Search Citations   | 검색 출처 인용, Save to Knowledge                           | ⚠️ 부분           | web 결과를 계약 동결(`source: project\|ephemeral`)상 `"ephemeral"`+sourceUri로 근사(`web-search-handler.ts:98-107`). "web" source·Save to Knowledge 없음                               |
| Search Confirmation    | 외부 질의 전 사용자 승인                                    | ❌ 미개발         | 웹검색 사전확인 프롬프트 없음(단 일반 HITL은 별도 존재, 하단 참조)                                                                                                                     |
| Agentic Web Search     | 모델이 검색 필요 판단·`fetch_url` 링크 자율추적·다출처 종합 | ⚠️ 부분           | 모델-주도 web_search tool call은 기본 동작. `deep_research`가 plan→research→synthesis+gap 반성 수행하나 하위검색은 **web_search 한정**(fetch_url 전체페이지 자율추적·링크 팔로우 없음) |

### Tools & Function Calling

| 기능                              | 설명                                                | WChat 상태      | 근거/비고                                                                                                                                                                                                         |
| --------------------------------- | --------------------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Enable Tools Per Chat/Per Model   | 채팅·모델별 툴 활성                                 | ⚠️ 부분         | agent/chat 모드(`chat`→`tools=[]`)·web_search 토글만(`messages.ts:411-419`). `@멘션`/per-tool activation 없음. `selectRelevantTools`(tool-router)는 구현됐으나 런타임 미배선                                      |
| Native vs Legacy Function Calling | 구조화 JSON 툴콜 native / 프롬프트주입 legacy       | ⚠️ native만     | provider tool_use 기반 native 호출. legacy 프롬프트주입 모드 없음                                                                                                                                                 |
| Builtin Tools Categories          | Memory·Knowledge·Web Search 시스템 툴 카테고리 토글 | ⚠️ 부분         | web_search·code_interpreter·deep_research·artifact_create 배선. **knowledge_search·memory 툴 미배선**. per-model 카테고리 토글 없음                                                                               |
| MCP / OpenAPI Servers             | MCP·OpenAPI 서버를 툴로 연결                        | ⚠️ MCP만 실배선 | MCP 전구간 실배선: CRUD+SSRF(`validateMcpUrl` RFC-1918 차단+VPC CIDR 화이트리스트)+discovery(`mcp-bridge`)+JSON-RPC invoke+rate limit(`mcp-client-pool`), org별 조립(app.ts:80-110). **OpenAPI 서버 연결은 없음** |
| Import Community Tools            | openwebui.com 커뮤니티 파이썬 툴 가져오기           | ❌ 미개발       | 커뮤니티 마켓·툴 import 없음                                                                                                                                                                                      |
| Tool Valves / UserValves          | 관리자·사용자별 툴 설정(API키 등)                   | ❌ 미개발       | Valve 개념 없음(툴 설정은 org_settings에 한정)                                                                                                                                                                    |
| Functions — Pipe                  | 커스텀 모델/에이전트를 사이드바에 추가              | ❌ 미개발       | Python 플러그인 프레임워크 없음                                                                                                                                                                                   |
| Functions — Filter                | inlet/stream/outlet 미들웨어(번역·검열·로깅)        | ❌ 미개발       | 사용자 정의 필터 함수 없음                                                                                                                                                                                        |
| Functions — Action / Event        | 메시지 버튼·시스템 이벤트 백그라운드 로직           | ❌ 미개발       | 없음                                                                                                                                                                                                              |

### 프롬프트 라이브러리

| 기능                           | 설명                                                           | WChat 상태     | 근거/비고                                                                                              |
| ------------------------------ | -------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------ |
| Prompt Presets                 | 재사용 프롬프트 템플릿 저장                                    | ✅ 개발됨      | 서버 CRUD `routes/prompts.ts`(migration 0024, command unique 409), UI `PromptsManager.tsx`             |
| Slash Command (`/`)            | `/command`로 저장 프롬프트 삽입                                | ✅ 개발됨      | 컴포저 `/` 자동완성(`ChatInput.tsx` slash trigger + `ChatView.tsx:190-203` `prompt:<id>` 병합)         |
| Input Variables (Forms)        | text·dropdown·date·number·checkbox 타입 팝업 폼                | ❌ 미개발      | 타입 필드 폼 없음(`PromptsManager.tsx`에 폼필드 정의 0건)                                              |
| System Variables               | `{{CURRENT_DATE}}`·`{{USER_NAME}}`·`{{CLIPBOARD}}` 런타임 치환 | ⚠️ 부분(3종만) | `promptVariables.ts`는 `{{today}}`/`{{user}}`/`{{clipboard}}`만 치환. OWUI의 광범위 시스템 변수셋 없음 |
| Version History & Rollback     | 변경마다 버전·비교·복원                                        | ❌ 미개발      | prompts 라우트에 version/history/rollback 0건                                                          |
| Access Control / Tags / Toggle | 사용자·그룹 공유, 태그, 활성/비활성 토글                       | ⚠️ 부분        | private/org 접근제어는 있음(`prompts.ts`). 프롬프트 태그·enable/disable 토글 없음                      |

### 메모리

| 기능                        | 설명                                                           | WChat 상태           | 근거/비고                                                                                                                                                                                                 |
| --------------------------- | -------------------------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Persistent Memory           | 사용자 사실·선호를 대화 간 지속 저장·회상                      | ✅ 개발됨(저장·표시) | 서버 CRUD `routes/memories.ts`(POST/GET(category·pinned·cursor)/PATCH/DELETE, `ownedByActor` 격리). 단 대화에 자동 주입·회상하는 런타임 소비는 본 도메인에서 미확인(메모리 툴 부재로 모델 접근 경로 없음) |
| Manual Management           | Settings에서 수동 추가/편집/삭제                               | ✅ 개발됨            | `MemoryManager.tsx`(카테고리 필터·생성·편집·핀·삭제), 채팅내 `MemoryPanel.tsx`(핀 토글)                                                                                                                   |
| Autonomous Memory Tools     | `add_memory`/`update_memory`/`search_memories`로 모델 자율관리 | ❌ 미개발            | 모델-주도 메모리 툴 0건(grep). CRUD는 UI/REST 전용                                                                                                                                                        |
| Memory Organization / Type  | `work/projects` 경로 계층 + user/context 타입                  | ⚠️ 부분              | 카테고리 4종(user/feedback/project/reference)+핀 존재. 경로 계층·context 타입 자동분류 없음                                                                                                               |
| Automatic Background Review | 대화 주기 검토해 메모리 자동 갱신                              | ❌ 미개발            | 백그라운드 리뷰 잡 없음                                                                                                                                                                                   |

### Chat Controls & 파라미터

| 기능                  | 설명                                                                   | WChat 상태 | 근거/비고                                                                                                                                                                                                            |
| --------------------- | ---------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chat Controls Sidebar | 우측 사이드바에서 현재 대화 시스템프롬프트·파라미터 조정               | ❌ 미개발  | per-chat 컨트롤 사이드바 없음(파라미터는 admin org 설정에만)                                                                                                                                                         |
| 3-Level System Prompt | per-chat / per-account / per-model 계층                                | ⚠️ 부분    | org-level systemPrompt(admin `org-settings-schema`) + 모델 프리셋 수준. per-chat/per-account 계층 없음                                                                                                               |
| Advanced Parameters   | temperature·top-p·stop·context length 채팅/계정/모델 단위              | ⚠️ 부분    | org-level temperature/maxTokens/topP 저장·검증(admin). **topP는 런타임 미배선(ISOLATE 명시)**, reasoningEffort는 클라 전송하나 서버 no-op(`messages.ts` body 파싱에 없음, src 전체 0건). per-chat 파라미터 편집 없음 |
| Skill Mentions (`$`)  | `$`로 스킬 피커 열어 시스템프롬프트에 주입                             | ❌ 미개발  | `$` 스킬 피커 없음(skills=T5 별도 도메인)                                                                                                                                                                            |
| URL Parameters        | `model`·`q`·`web-search`·`tools`·`youtube`·`load-url` 등 쿼리 사전구성 | ❌ 미개발  | 세션 사전구성 URL 파라미터 파서 없음                                                                                                                                                                                 |

---

### WChat 고유 기능 (OWUI에 없거나 다르게 구현)

- **deep_research 멀티에이전트 도구** — plan(하위질문 분해, `maxSubQuestions=4`)→격리 서브에이전트 병렬 조사→synthesis→**gap 반성(`maxGapIterations=2`, MAST 종료조건 가드)**→citation drop→markdown 아티팩트 저장. 진행 스트림(planning/researching/synthesizing)+300s hang 가드. 실배선(`deep-research-handler.ts`, app.ts:237). OWUI의 agentic search와 달리 결과를 **아티팩트로 산출**하는 전용 프로덕트 도구.
- **HITL(Human-in-the-loop) 툴 승인** — `orchestrator.ts:301-545`가 `defaultPolicy==="hitl"` 도구에 대해 `hitl_request` 방출→승인 대기→`hitl_resolved`/`hitl_timeout`, denied 시 skip. 라우트 `POST /:id/messages/hitl`·`GET /:id/hitl/pending`(`hitl-manager.ts`). OWUI의 "웹검색 사전확인"보다 일반화된 **임의 툴 승인 게이트**(현재 내장툴은 all-allow, MCP 도구에서 트리거).
- **MCP SSRF 하드닝** — RFC-1918 차단 + **VPC CIDR 화이트리스트**(`url-validator.ts`), invoke마다 재검증, 서버별 고정윈도우 rate limit(기본 60/60s). 엔터프라이즈 방어. OWUI MCP는 이 수준의 CIDR 게이트를 노출하지 않음.
- **citation 환각 가드** — `matchCitations`+`dropUnmatchedCitationMarkers`로 실제 출처 목록에 없는 `[N]` 마커를 응답에서 제거. deep_research는 sub-question 지역 인덱스를 전역 순번으로 remap 후 unmatched drop. OWUI 인용은 추적·표시 중심으로, 이런 마커 정합성 강제는 명시되지 않음.
- **멀티에이전트 오케스트레이터 프리미티브** — `orchestrator-worker`·`dag-planner`·`routing-handoff`·`evaluator-optimizer`·`verification-worker` 실구현(현재 deep_research가 유일 소비 진입점). OWUI에는 대응 프리미티브 계층이 없음.
- **org-scoped web search provider 동적 해석** — invoke 시점 `ctx.orgId`로 provider/endpoint/apiKeyRef를 resolve, `apiKeyRef`는 보안상 `"TAVILY_API_KEY"` 하나만 허용(임의 secret 조회 거부). 멀티테넌트 org 단위 검색 설정 격리.

## 고급 채팅(코드/이미지/음성/렌더/노트/채널)

Open WebUI 이 도메인의 전 기능을 나열하고 WChat(현 repo, phase P19) 상태를 판정. 근거는 코드/라우트/grep 실측 기준.

### 코드 실행 & 렌더링

| 기능                               | 설명                                                                                                       | WChat 상태 | 근거/비고                                                                                                                                                                                                                                                                                            |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Code Interpreter (execute_code)    | 모델이 응답 중 파이썬을 자율 작성·실행                                                                     | ✅ 개발됨  | `tools/handlers/code-interpreter-handler.ts` + `assemble-builtin-tools.ts`에 `code_interpreter` 실배선. 산출물을 아티팩트로 저장, `ctx.signal` 취소 관통. 단 LOCAL_ONLY는 dev-stub(`sandbox-transport-dev-stub.ts`), 실 실행은 `E2B_API_KEY` 있을 때만 E2B 어댑터                                    |
| Python via Pyodide (브라우저 WASM) | numpy/pandas/matplotlib를 브라우저 WebAssembly 샌드박스에서 실행                                           | ❌ 미개발  | grep 0건(pyodide 없음). WChat은 브라우저 실행이 아니라 서버측 격리 샌드박스(E2B) 방식으로 다르게 구현                                                                                                                                                                                                |
| Jupyter Server Execution           | 패키지 설치 가능한 완전 파이썬 환경 연결                                                                   | ❌ 미개발  | grep 0건. E2B 컨테이너로 대체, Jupyter 커널 연결 경로 없음                                                                                                                                                                                                                                           |
| Open Terminal / Terminals          | 원격 셸(전체 OS 접근) 실행 API, 멀티테넌트 컨테이너 오케스트레이터                                         | ❌ 미개발  | 노출된 터미널 도구/라우트/UI 없음(grep 0). E2B 내부 `runCommand`는 code_interpreter 핸들러 내부 전용이며 사용자 셸로 노출 안 됨. 오케스트레이터 서버 연결 개념 부재                                                                                                                                  |
| Markdown & LaTeX 렌더링            | 종합 마크다운 + LaTeX 수식 렌더                                                                            | ✅ 개발됨  | `components/chat/Markdown.tsx` remark-gfm + remark-math + rehype-katex(`katex.min.css`). 스트리밍 미닫힌 펜스 보정(`balanceFences`)                                                                                                                                                                  |
| Mermaid 렌더링                     | MermaidJS 문법을 다이어그램으로 시각화                                                                     | ✅ 개발됨  | `components/chat/Mermaid.tsx` 동적 import, 코드↔다이어그램 토글, 실패 시 코드 폴백                                                                                                                                                                                                                   |
| Artifacts (HTML/CSS/JS·SVG)        | 인터랙티브 웹/애니 SVG/ThreeJS·D3를 별도 프리뷰 패널에 렌더, 샌드박스 iframe·버전추적·실시간 편집·전체화면 | ⚠️ 부분    | `artifacts/ArtifactPanel.tsx` `<iframe sandbox="" srcDoc>`로 HTML 렌더하나 **`sandbox=""`라 스크립트 차단** → ThreeJS/D3 등 인터랙티브 JS 실행 불가(정적 HTML/CSS만). 버전 페이저(`‹ vN/M ›`)는 탐색만, **버전 복원(revert) 액션 없음**. 데스크톱 사이드 패널/모바일 풀스크린 시트·리사이즈는 구현됨 |
| Writing / Content Blocks           | 콜론-펜스(`:::`) 블록을 스타일된 컨테이너로 렌더                                                           | ❌ 미개발  | remark-gfm 기반 표준 마크다운만. 콜론-펜스 커스텀 컨테이너 렌더러 없음                                                                                                                                                                                                                               |

### 이미지 생성 & 편집

| 기능                                         | 설명                                              | WChat 상태 | 근거/비고                                                                                                           |
| -------------------------------------------- | ------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------- |
| Native Tool Image Generation                 | 모델이 이미지 생성을 툴로 직접 호출               | ❌ 미개발  | 이미지 생성 도구/라우트/핸들러 grep 0건. 내장 도구 카탈로그(`assemble-builtin-tools.ts`)에 image 도구 없음(범위 밖) |
| Direct Image Prompt (토글)                   | Image Generation 토글 후 프롬프트를 바로 이미지로 | ❌ 미개발  | 이미지 생성 토글·엔진 없음                                                                                          |
| Image Editing / Inpainting                   | 이미지+텍스트로 배경 변경·요소 추가 편집          | ❌ 미개발  | 부재                                                                                                                |
| Image Compositing                            | 여러 이미지를 한 장면으로 합성                    | ❌ 미개발  | 부재                                                                                                                |
| Image Backends (DALL·E/Gemini/ComfyUI/A1111) | 이미지 생성 백엔드 선택                           | ❌ 미개발  | 외부 이미지 엔진 연동 없음                                                                                          |

### 음성 / 영상 (Call / STT / TTS)

| 기능                      | 설명                                  | WChat 상태 | 근거/비고                                                                                           |
| ------------------------- | ------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------- |
| Hands-Free Voice Mode     | 음소거 토글이 있는 핸즈프리 음성 대화 | ❌ 미개발  | voice-mode grep 0건                                                                                 |
| Video / Call Overlay      | 실시간 전사가 있는 통화/영상 오버레이 | ❌ 미개발  | call/video overlay grep 0건                                                                         |
| Speech-to-Text 받아쓰기   | 마이크 음성으로 메시지 입력           | ❌ 미개발  | whisper/MediaRecorder/SpeechRecognition/getUserMedia grep 0건. 컴포저는 텍스트 입력만               |
| Text-to-Speech Read Aloud | 응답을 음성으로 재생                  | ❌ 미개발  | speechSynthesis/read-aloud grep 0건. `MessageActions.tsx`에 낭독 버튼 없음(복사/편집/재생성/평가만) |
| Per-Model TTS Voice       | 모델 페르소나별 고유 TTS 보이스       | ❌ 미개발  | TTS 자체가 부재                                                                                     |

### 노트 (Notes)

| 기능                                    | 설명                                       | WChat 상태 | 근거/비고                                                                                                       |
| --------------------------------------- | ------------------------------------------ | ---------- | --------------------------------------------------------------------------------------------------------------- |
| Rich Text / Markdown Editor             | 플로팅 서식 툴바가 있는 노트 에디터        | ❌ 미개발  | Notes 기능 전체 부재 — 라우트(`routes/` 목록에 notes 없음)·UI 없음. PROGRESS P19 "범위 밖 명시: Notes·Channels" |
| AI Enhance                              | 선택/전체 노트를 AI로 재작성·개선          | ❌ 미개발  | 동일(Notes 부재)                                                                                                |
| Note Chat Sidebar                       | 노트 내용을 두고 에디터 내 집중 AI 대화    | ❌ 미개발  | 동일                                                                                                            |
| Attach Note to Chat (Context Injection) | 노트를 채팅에 청킹 없이 전문 첨부          | ❌ 미개발  | 동일. (WChat의 "메모리"는 별개 기능이며 노트가 아님)                                                            |
| Agentic Access (노트 자율 검색/수정)    | 모델이 노트를 장기 메모리로 검색·읽기·수정 | ❌ 미개발  | 동일                                                                                                            |
| Voice Dictation                         | 마이크 음성 받아쓰기로 노트 작성           | ❌ 미개발  | 동일(+STT 자체 부재)                                                                                            |
| Pin / Export / Import / Sharing         | 노트 고정·txt/md/pdf 내보내기·공유 링크    | ❌ 미개발  | 동일                                                                                                            |

### 채널 (Channels)

| 기능                              | 설명                                      | WChat 상태 | 근거/비고                                                                                                         |
| --------------------------------- | ----------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------- |
| Real-Time Team Channels           | 사람+AI 실시간 공유 공간, 스트리밍 응답   | ❌ 미개발  | Channels 기능 전체 부재(범위 밖 명시). grep의 `channel` 히트는 SSE `createProgressChannel`·알림 채널 등 무관 코드 |
| @model Tagging                    | 채널에서 AI 모델을 대화에 소환            | ❌ 미개발  | 동일                                                                                                              |
| Threaded Replies                  | 인라인/스레드 곁가지 대화                 | ❌ 미개발  | 동일                                                                                                              |
| Emoji Reactions / Pinned Messages | 메시지 이모지 반응·고정                   | ❌ 미개발  | 동일(채팅 메시지엔 반응/고정 없음; 세션 핀은 별개)                                                                |
| @mentions / #channel linking      | 사람 멘션 알림·채널 교차 링크             | ❌ 미개발  | 동일. WChat엔 @멘션 파싱 자체 없음(knowledge-tools 인벤토리 확인)                                                 |
| File Sharing (채널 내)            | 이미지·문서·코드 업로드 후 AI 분석        | ❌ 미개발  | 채널 부재                                                                                                         |
| Access Control / DM Status        | public·private·group·DM 권한, 온라인 상태 | ❌ 미개발  | 채널 부재                                                                                                         |
| AI Channel Search                 | 모델이 채널 메시지를 자율 검색·종합       | ❌ 미개발  | 채널 부재                                                                                                         |

### 플랫폼 (PWA / i18n)

| 기능                    | 설명                                          | WChat 상태 | 근거/비고                                                                                                                                                                               |
| ----------------------- | --------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Responsive Design & PWA | 데스크톱·모바일 반응형 + PWA(오프라인·설치형) | ⚠️ 부분    | 반응형은 구현(Tailwind, `ArtifactCanvas` 모바일 풀스크린 시트/드래그, 패널 리사이즈). 그러나 **PWA 없음** — manifest·service worker·`next-pwa`/workbox grep 0건, 오프라인/설치형 미지원 |
| Multilingual (i18n)     | i18n 다국어 지원으로 선호 언어 사용           | ❌ 미개발  | i18n 프레임워크 없음(next-intl/react-intl/i18next grep 0건). `app/layout.tsx`가 `<html lang="ko">` 하드코딩 — 한국어 단일 로케일(UI 문자열 직접 삽입)                                   |

---

### WChat 고유 기능 (Open WebUI에 없거나 다르게 구현)

- **오피스 문서 아티팩트 렌더 파이프라인** — 아티팩트 타입이 웹(HTML/SVG) 중심인 Open WebUI와 달리, WChat은 `pptx·pdf·docx·xlsx` 등 오피스 산출물 중심. `PdfRenderer.tsx`(react-pdf) 인패널 렌더, **pptx→PDF 서버 변환 위임 렌더**(`PptxRenderer.tsx` + office-pdf-converter). Open WebUI엔 없는 접근.
- **아티팩트 공개 토큰 공유 링크** — 개별 아티팩트를 HMAC 서명 URL·만료(60초)·revoke 지원 공개 링크로 공유(`ShareDialog`/`routes/artifact-shares.ts`/`public-share.ts`, 410 만료·revoked). Open WebUI의 채팅 스냅샷 공유와 다른, 아티팩트 단위 공유.
- **HITL(Human-in-the-Loop) 도구 승인** — 코드/도구 실행을 정책(`defaultPolicy:"hitl"`)에 따라 `hitl_request` 방출 후 사용자 승인 대기(`orchestrator.ts` + `POST /sessions/:id/messages/hitl`, `hitl-manager.ts`). Open WebUI엔 이 승인 게이트 개념이 없음(관리자 설정 confirmation은 웹검색 한정).
- **egress 차단 격리 샌드박스** — code_interpreter의 E2B 어댑터가 기본 `allowInternetAccess:false`로 네트워크 차단(`sandbox-transport-e2b.ts`). Open WebUI Pyodide/Jupyter/Terminal 대비 격리 지향.
- **deep_research 멀티에이전트 아티팩트** — plan→병렬 하위조사→synthesis→gap 반성을 거쳐 인용 포함 markdown 아티팩트를 생성(`deep-research-handler.ts`). Open WebUI의 단일 agentic search와 달리 멀티에이전트 산출물을 아티팩트로 저장.
- **인용 칩 + 환각 마커 방어 렌더** — `remarkCitations` 플러그인이 인용을 `CitationChip`(툴팁)으로 렌더하고, 목록에 없는 `[N]` 마커를 drop(`dropUnmatchedCitationMarkers`). 채팅 본문 인라인 렌더링 레벨의 인용 처리로 구현.

## 관리자: 사용자/RBAC/인증/API키/일반

> 판정 근거: WChat 인벤토리(코드 확인 완료) + 본 세션 직접 grep 재확인(`org-settings-schema.ts` defaultUserRole=member 3역할, `api-keys.ts` scopes 저장O·강제X, `session-title-tags.ts` 생성 배선, OAuth/LDAP/SCIM/password 0건). WChat 인증은 **매직링크+JWT** 방식이라 비밀번호 로그인 계열은 구조적으로 해당 없음.

### 시스템 역할 (System Roles)

| 기능                          | 설명                                                  | WChat 상태 | 근거/비고                                                                                                                                    |
| ----------------------------- | ----------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Admin 역할                    | 전체 시스템/사용자/설정 관리 슈퍼유저, 권한검사 우회  | ✅ 개발됨  | `owner`/`admin`이 `isAdmin(role)` 403 게이트 통과(라우트별 self-check). `auth-middleware.ts`, `admin*.ts`                                    |
| User(표준) 역할               | 암묵 권한 없는 일반 사용자                            | ✅ 개발됨  | WChat은 `member`(=User 대응). `defaultUserRole` 기본 member                                                                                  |
| Pending 역할                  | 신규가입 대기 상태, 승격 전 아무 동작 불가            | ❌ 미개발  | WChat 역할은 `member/admin/owner` 3종뿐(`org-settings-schema.ts:68`). 가입 즉시 member 활성 — 대기/승인 큐 개념 없음                         |
| First-User 자동 Admin         | fresh install 최초 계정 자동 admin                    | ⚠️ 부분    | `dev-login`이 fresh DB에서 org+owner를 즉석 생성(`auth.ts:324`)하나 이는 dev/test 전용(prod 404). 프로덕션 부트스트랩 admin 흐름은 별도 부재 |
| Primary Administrator 보호    | 최고령 admin 계정 삭제 방지                           | ❌ 미개발  | 사용자 삭제/primary 보호 로직 부재. `AdminUsersManager`는 role변경·suspend만                                                                 |
| DEFAULT_USER_ROLE             | 신규가입 기본 역할 설정                               | ✅ 개발됨  | org settings `defaultUserRole`(member/admin/owner), signup 시 소비(`auth.ts:287`), Permissions 탭 UI                                         |
| Pending 오버레이 커스터마이즈 | 대기화면 문구 지정                                    | ❌ 미개발  | pending 상태 자체가 없음                                                                                                                     |
| Headless Admin 생성           | `WEBUI_ADMIN_EMAIL/PASSWORD` env로 첫 admin 자동 생성 | ❌ 미개발  | 해당 env·부트스트랩 경로 없음(비밀번호 인증 자체 부재)                                                                                       |
| ENABLE_ADMIN_CHAT_ACCESS      | admin의 타 사용자 채팅 열람 토글                      | ❌ 미개발  | admin이 타 사용자 채팅 조회하는 라우트/토글 없음(모든 세션조회 `WHERE user_id=auth.sub`)                                                     |
| BYPASS_ADMIN_ACCESS_CONTROL   | admin이 private 리소스 접근 우회 여부                 | ❌ 미개발  | resource_grants 자체가 미배선이라 우회 토글 개념 없음                                                                                        |

### 사용자 관리 (User Management)

| 기능                        | 설명                                               | WChat 상태                 | 근거/비고                                                                                  |
| --------------------------- | -------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------ |
| 사용자 목록/역할 변경       | Admin Panel에서 role 토글·검색                     | ✅ 개발됨                  | `AdminUsersManager.tsx` + `admin.ts` GET `/users`(search·status·limit), PATCH `/users/:id` |
| 사용자 suspend/unsuspend    | 사용자 비활성화·복구                               | ✅ 개발됨(WChat 고유 확장) | POST `/users/:id/{suspend,unsuspend}`(reason). Open WebUI엔 명시적 suspend API 없음        |
| Preview Access (사용자)     | 특정 사용자가 read 가능한 전 리소스 미리보기(감사) | ❌ 미개발                  | `GET /users/{id}/preview` 상당 라우트 없음. resource_grants 미배선이라 미리볼 grant도 없음 |
| Preview Group Access (그룹) | 그룹 grant 스코프 미리보기                         | ❌ 미개발                  | 동일, 그룹 권한 나열 API 부재(`GroupsManager.tsx:6` 명시적 descope)                        |
| 활성 사용자 수 노출 토글    | active user count 공개/admin-only                  | ❌ 미개발                  | 대시보드에 사용자 수 카드는 있으나 공개범위 토글 없음                                      |
| User Status(active/away)    | 사용자 상태 표시 전역 토글                         | ❌ 미개발                  | presence/status 기능 없음(P19 범위밖)                                                      |

### 그룹 (Groups)

| 기능                               | 설명                                      | WChat 상태     | 근거/비고                                                                                                                       |
| ---------------------------------- | ----------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 그룹 CRUD + 멤버 관리              | 그룹 생성/이름변경/삭제 + 멤버 추가/제거  | ✅ 개발됨      | `admin-groups.ts`(GET/POST/PUT/DELETE + `/:id/members`), migration 0026, `GroupsManager.tsx`, RLS+`current_user_is_admin()`     |
| Additive Union 권한 병합           | 다중 그룹 멤버는 권한 superset(deny 없음) | ⚠️ 부분·미배선 | `canAccessResource`의 union 로직만 존재(`lib/access-control.ts`), 그룹 자체에 권한 토글 필드 없음 — 그룹은 순수 멤버십 컨테이너 |
| Default Permissions(전역 baseline) | 전 사용자 적용 기본 권한셋                | ❌ 미개발      | 61종 권한 스키마 부재. 권한 게이트는 admin/owner 여부·org 모델 화이트리스트뿐                                                   |
| Group Permissions 오버라이드       | 그룹별 권한 토글                          | ❌ 미개발      | 그룹에 permissions JSON 필드 없음(name/members만)                                                                               |
| 그룹 가시성(who can share)         | Anyone/Members/No one 노출 제어           | ❌ 미개발      | 공유 대상 그룹 노출 제어 개념 없음                                                                                              |
| DEFAULT_GROUP_ID 자동배정          | 가입 시 기본 그룹 배정                    | ❌ 미개발      | signup이 그룹 자동배정 안 함                                                                                                    |
| OAuth Group Sync                   | IdP claim으로 그룹 동기화                 | ❌ 미개발      | OAuth 자체 부재(아래)                                                                                                           |
| Trusted Header Group Sync          | 프록시 헤더로 그룹 동기화                 | ❌ 미개발      | trusted-header 인증 부재                                                                                                        |
| SCIM Group Sync                    | SCIM 프로비저닝 그룹 동기화               | ❌ 미개발      | SCIM 부재                                                                                                                       |

### 권한 카테고리 (Permissions ~61종) & 리소스 ACL

| 기능                         | 설명                                                                  | WChat 상태             | 근거/비고                                                                                                                                                                                                                                                |
| ---------------------------- | --------------------------------------------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace 권한(13종)         | Models/Knowledge/Prompts/Tools/Skills Access·Import·Export            | ❌ 미개발              | 세분 권한 스키마 없음. Import/Export·per-리소스 접근 토글 부재                                                                                                                                                                                           |
| Sharing 권한(15종)           | 리소스별 Share/Public 토글                                            | ❌ 미개발              | 공유는 아티팩트 공개토큰 링크만(`public-share.ts`), 리소스 공유 권한체계 없음                                                                                                                                                                            |
| Chat 권한(20종)              | File Upload/Delete/Edit/STT/TTS/Multiple Models 등 채팅 동작별 권한   | ❌ 미개발              | 채팅 기능은 org settings 토글(webSearch 등)·admin 게이트로만 제어, per-action RBAC 없음                                                                                                                                                                  |
| Features 권한(12종)          | API Keys/Notes/Channels/Web Search/Code Interpreter 등 기능 접근 권한 | ⚠️ 부분                | 세분 feature 권한 스키마는 없음. 다만 web_search는 admin `webSearchEnabled`+user 토글 2단 게이트로 근사(`messages.ts:411`). Notes/Channels/Calendar/Automations 기능 자체 부재                                                                           |
| Settings 권한(1종)           | 인터페이스 설정 접근 권한                                             | ❌ 미개발              | -                                                                                                                                                                                                                                                        |
| 리소스 ACL(Read/Write grant) | 모델/지식/도구/프롬프트에 그룹·사용자 read/write 부여                 | ⚠️ 부분·인프라만(격리) | migration 0027 + `resource-grants-data-access.ts` + `canAccessResource` 순수로직 + 통합테스트만 존재. **grant 생성/조회 HTTP 라우트·조회 필터 enforcement·UI 전부 부재** — 어떤 라우트도 호출 안 함(T1-14/T6-18 명시적 후속 descope). 실효 enforcement=0 |
| Public=wildcard grant        | 공개접근을 `*` principal grant로 표현                                 | ❌ 미개발              | grant 경로 미배선                                                                                                                                                                                                                                        |
| Knowledge Scoping            | 모델에 붙은 KB만 접근                                                 | ⚠️ 부분                | 프로젝트 문서 인덱싱은 되나 `knowledge_search` 도구 자체가 런타임 미배선(knowledge-tools 인벤토리 §2)                                                                                                                                                    |

### 인증 (OAuth / LDAP / SCIM / SSO / 로컬)

| 기능                             | 설명                                               | WChat 상태                 | 근거/비고                                                                                        |
| -------------------------------- | -------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------ |
| OAuth/OIDC 로그인                | Google/Microsoft/GitHub/Generic OIDC SSO           | ❌ 미개발                  | grep 0건, 주석상 "SSO 도입 예정"뿐(`auth.ts:58`). 외부 IdP provider 전무                         |
| OAuth Role/Group Management      | 토큰 claim으로 역할·그룹 관리                      | ❌ 미개발                  | OAuth 부재                                                                                       |
| OAuth 서버측 세션/토큰 갱신      | oauth_session 저장·refresh·backchannel logout      | ❌ 미개발                  | 해당 없음                                                                                        |
| LDAP / AD 인증                   | 디렉토리 bind 인증·자동 계정생성                   | ❌ 미개발                  | grep 0건                                                                                         |
| SCIM 2.0 프로비저닝              | Okta/Azure 사용자·그룹 자동 프로비저닝             | ❌ 미개발                  | grep 0건                                                                                         |
| Trusted Header 인증              | 리버스프록시 위임 인증(email/name/role/group 헤더) | ❌ 미개발                  | 해당 없음                                                                                        |
| SSO-only 모드(비밀번호 차단)     | `ENABLE_PASSWORD_AUTH=false`                       | ⚠️ 다르게 구현             | WChat은 애초에 **비밀번호 로그인 미제공**(매직링크+JWT). 개념상 항상 passwordless지만 SSO는 아님 |
| Magic-link + JWT 쿠키 인증       | (WChat 실제 방식) 매직링크 발급→JWT 쿠키           | ✅ 개발됨(WChat 고유 방식) | `auth.ts` `/magic-link`,`/verify`, httpOnly 쿠키, enumeration 방지. Open WebUI엔 없는 방식       |
| Refresh 토큰 rotation + 도난탐지 | (WChat 고유) family 재사용 탐지 revoke             | ✅ 개발됨(WChat 고유)      | `refresh_token_families`(0013), `REFRESH_TOKEN_REUSED` 401                                       |
| 도메인 게이트(ALLOWED_DOMAINS)   | 이메일 도메인으로 org 결정·가입 제한               | ✅ 개발됨(WChat 고유 강조) | `env.ts:11`→`auth.ts:175` `EMAIL_DOMAIN_FORBIDDEN` 403 + org별 `enableSignup` 2단                |

### API 키 (API Keys)

| 기능                                   | 설명                                                | WChat 상태     | 근거/비고                                                                                                       |
| -------------------------------------- | --------------------------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------- |
| API 키 발급/폐기/목록                  | 개인 액세스 토큰 CRUD, 평문 1회 노출                | ✅ 개발됨      | `api-keys.ts`(POST/GET/DELETE), migration 0025, `ApiKeysManager.tsx`. `key_hash`(sha256)만 저장                 |
| Bearer 인증 소비                       | `Authorization: Bearer`로 UI와 동일 엔드포인트 호출 | ✅ 개발됨      | `auth-middleware.ts:61` 쿠키 부재 시 `findActiveByRawKey`→payload 합성+`touchLastUsed`                          |
| 키가 발급자 role/group 상속            | 별도 권한모델 없이 사용자 권한 상속                 | ✅ 개발됨      | role은 `users` JOIN live 조회(auth-middleware.ts:70)                                                            |
| 2단 게이트(전역 Enable + feature 권한) | `ENABLE_API_KEYS` 마스터 + 비-admin feature 권한    | ⚠️ 부분        | self-service 발급은 되나 전역 마스터 토글·feature 권한 게이트 없음(누구나 발급 가능)                            |
| Endpoint Restrictions                  | 키별 허용 라우트 화이트리스트                       | ❌ 미개발      | endpoint 제한 로직 부재                                                                                         |
| Scope 제한                             | per-key scope 강제                                  | ⚠️ 부분·미강제 | `scopes` 저장O(`api-keys.ts:65`)·응답 포함O이나 **auth-middleware가 scope 미검사, 전권 부여** — 순수 메타데이터 |
| 커스텀 API 키 헤더                     | `CUSTOM_API_KEY_HEADER` 대체 헤더                   | ❌ 미개발      | `Authorization: Bearer`만 인식                                                                                  |

### General 설정 / 가입·로그인 / 토큰

| 기능                                 | 설명                                                                                                   | WChat 상태          | 근거/비고                                                                                                                                                                       |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------ | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ENABLE_SIGNUP 토글                   | 계정 생성 허용                                                                                         | ✅ 개발됨           | org settings `enableSignup`, signup 반영(`auth.ts:195` `SIGNUP_DISABLED` 403), Permissions 탭                                                                                   |
| Signup Password Confirmation         | 가입 시 비밀번호 확인 필드                                                                             | ❌ 미개발(해당없음) | 비밀번호 인증 미사용                                                                                                                                                            |
| ENABLE_LOGIN_FORM                    | 이메일/비밀번호 폼 토글                                                                                | ❌ 미개발(해당없음) | 매직링크 UX                                                                                                                                                                     |
| 비밀번호 정책(해시알고/복잡도 regex) | bcrypt/argon2·validation regex                                                                         | ❌ 미개발(해당없음) | 비밀번호 저장 자체 없음                                                                                                                                                         |
| Password Change Form 토글            | 비밀번호 변경 UI                                                                                       | ❌ 미개발(해당없음) | -                                                                                                                                                                               |
| JWT_EXPIRES_IN                       | JWT 만료 설정                                                                                          | ⚠️ 부분·하드코딩    | Access 15분/refresh 30일 고정(`auth.ts:65`), env 설정 토글 없음                                                                                                                 |
| DEFAULT_MODELS / 파라미터 기본값     | 전역 기본 모델·파라미터                                                                                | ✅ 개발됨           | Models 탭 `defaultModel`/maxTokens/temperature/topP(단 **topP 런타임 미배선 ISOLATE**), `admin-settings.ts`                                                                     |
| 제목 자동생성(Title Generation)      | task 모델로 채팅 제목 생성                                                                             | ✅ 개발됨           | `session-title-tags.ts:66` LLM 생성+`deriveSessionTitle` 폴백, `messages.ts:592` 소비                                                                                           |
| 태그 자동생성(Tags Generation)       | 채팅 태그 자동 생성                                                                                    | ✅ 개발됨           | 동일 함수가 태그(1~3개) 생성→`session_tags`(0020) 반영                                                                                                                          |
| Admin Webhook(신규가입 알림)         | Discord/Slack로 new_user POST                                                                          | ❌ 미개발           | webhook 발송 경로 없음                                                                                                                                                          |
| User Webhooks(개인 알림)             | 사용자별 완료 알림 webhook                                                                             | ❌ 미개발           | 완료 알림은 브라우저 Notification API만(`useSessionStream.ts:175`)                                                                                                              |
| 기능 토글 다수                       | message rating/community sharing/channels/folders/notes/memories/calendar/automations/version check 등 | ⚠️ 부분             | folders·memories·prompts·message rating은 기능 존재하나 **전역 admin on/off 토글은 없음**. channels/notes/calendar/automations/community sharing/version check는 기능 자체 부재 |
| Admin Export 토글                    | admin 데이터/DB export 표면                                                                            | ❌ 미개발           | admin export 라우트 없음(대화 export는 클라 직렬화)                                                                                                                             |
| Admin Analytics 토글                 | Analytics 탭 on/off                                                                                    | ⚠️ 부분             | 대시보드·툴메트릭은 상시 존재(`AdminDashboard`,`ToolMetricsTable`), 토글은 없음                                                                                                 |
| SHOW_ADMIN_DETAILS / ADMIN_EMAIL     | UI에 admin 정보 노출                                                                                   | ❌ 미개발           | -                                                                                                                                                                               |
| Response Watermark                   | 복사 시 삽입 워터마크 텍스트                                                                           | ⚠️ 부분·저장만      | `responseWatermark` Branding 탭 저장(`BrandingTab`), 런타임 삽입 소비 확인 안 됨(admin 인벤토리 범위밖)                                                                         |
| License Key / Offline Mode           | 엔터프라이즈 라이선스·오프라인                                                                         | ❌ 미개발           | 해당 없음                                                                                                                                                                       |
| IFRAME_CSP                           | Artifacts iframe CSP 주입                                                                              | ⚠️ 부분             | HTML 아티팩트는 `sandbox=""`(scripts 차단)로 고정(`ArtifactPanel.tsx`), env CSP 커스터마이즈는 없음                                                                             |

### 배너 (Banners)

| 기능                       | 설명                                                                           | WChat 상태       | 근거/비고                                                                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Typed 배너 스키마 + 실표시 | type(info/success/warning/error)·title·content·dismissible, 로그인 사용자 표시 | ✅ 개발됨        | `BannerSchema`(org-settings-schema), `Banner.tsx` 시맨틱 토큰+dismiss(sessionStorage), `config.ts:38` GET `/config` 노출                          |
| 배너 dismiss per-id 추적   | id별 닫힘 기억                                                                 | ⚠️ 부분          | sessionStorage 기반 닫힘(`AppShell.tsx:219`). id 변경 시 재노출 로직은 단일 배너 수준                                                             |
| 다중 배너 / typed 저작 UI  | 관리자가 여러 배너·type·title·dismissible 저작                                 | ⚠️ 부분·평문 1건 | 표시 파이프라인은 typed 완비이나 **BrandingTab은 평문 단일 input만**(`BrandingTab.tsx:42`, `banner: string`) — 관리자가 type/title/다중 저작 불가 |
| Banner HTML 렌더           | content를 HTML로 렌더                                                          | ⚠️ 부분          | Open WebUI는 HTML-only 배너. WChat 배너 content 렌더 방식은 시맨틱 텍스트 위주(HTML 화이트리스트 저작 미지원)                                     |

---

### WChat 고유 기능 (Open WebUI에 없거나 다르게 구현)

- **매직링크 + JWT 쿠키 인증**: 비밀번호 없이 이메일 매직링크→해시 저장·enumeration 방지. Open WebUI의 기본은 로컬 비밀번호 로그인이며, WChat은 이를 대체.
- **Refresh 토큰 rotation + family 기반 도난 탐지**: 이전 generation jti 재사용 시 family revoke + `REFRESH_TOKEN_REUSED` 401(`refresh_token_families` 0013). Open WebUI의 JWT 모델보다 세분화된 rotation 방어.
- **이메일 도메인 게이트(ALLOWED_DOMAINS)로 org 자동 결정**: 이메일 도메인만으로 org 귀속을 강제하고 body의 org 지정을 원천 차단. Open WebUI엔 org(멀티테넌시) 개념 자체가 약함 — WChat은 org-scoped 멀티테넌트가 기본.
- **App-level `WHERE org_id` 이중방어 + RLS(FORCE) 정책 상시 정의**: cross-org 격리를 모든 DA 쿼리 org 필터로 강제(orgId는 JWT에서만 파생). Open WebUI에는 이런 org 테넌시 격리 계층이 없음.
- **사용자 suspend/unsuspend(reason 포함)**: 명시적 정지/복구 API. Open WebUI는 role 강등(pending)으로 대체하는데 WChat엔 별도 suspend 상태가 있음.
- **툴 메트릭 대시보드(호출/오류율/p50·p95·p99)**: `ToolMetricsTable`로 도구 실행 관측성 제공 — Open WebUI Analytics의 토큰/모델 중심 지표와 초점이 다름(에이전틱 도구 실행 관측).
- **웹검색 provider 런타임 org-scoped 동적 해석**: admin 설정(provider/endpoint/apiKeyRef)이 invoke 시점 org별로 resolve되어 실 provider 구성(`web-search-handler.ts`). Open WebUI는 전역 env 기반.

## 관리자: 모델/설정/확장/플랫폼

> 판정 기준: WChat repo 코드 실측(grep/read) + 제공된 인벤토리. 공통 전제 — 이 도메인의 외부 의존(임베딩·검색·샌드박스·LLM)은 LOCAL_ONLY에서 **dev-stub**로 배선되며, 실 provider는 배포 시 교체 설계. runtime = Anthropic-or-devstub 단일 provider(멀티 registry 코드는 존재하나 1개만 등록).

### 1. 모델 프리셋 / Task Model

| 기능                                    | 설명                                                                                                              | WChat 상태 | 근거/비고                                                                                                                                                                |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Custom Models (Presets)                 | base 모델을 시스템프롬프트·도구·지식·스킬·파라미터로 감싼 재사용 프리셋(아바타·suggestion chip·import/export·ACL) | ❌ 미개발  | `grep model.?preset/customModel` 0건. 워크스페이스 커스텀 모델 개념 없음. 대체=org 단위 `defaultModel`+`systemPrompt`(`org-settings-schema.ts`)                          |
| Prompt Suggestions (starter chips)      | 새 채팅 진입 시 클릭형 스타터 칩(모델별/전역)                                                                     | ❌ 미개발  | 프리셋 부재의 하위 결과. suggestion chip 코드 없음                                                                                                                       |
| Global Model Defaults (params/metadata) | 전 모델 baseline 파라미터·capabilities(per-model 우선)                                                            | ⚠️ 부분    | org 단위 maxTokens/temperature/topP/systemPrompt 저장(`ModelsGenerationTab.tsx`). **topP는 저장·UI만, 런타임 미배선(ISOLATE 명시)**. per-model metadata/params 계층 없음 |
| Bulk 모델 관리 / Hide·Clone·Export      | Enabled/Hidden 필터 + 일괄 활성화, 프리셋 숨김·복제·export                                                        | ⚠️ 부분    | `allowed_models` 화이트리스트 칩 편집(추가/제거)만(`admin-models.ts`, PUT `/api/v1/admin/models`). Hide/Clone/Export/bulk 없음                                           |
| Task Model (보조작업 전용 모델 지정)    | 제목·쿼리·자동완성 등 백그라운드 작업용 별도 모델                                                                 | ❌ 미개발  | 별도 task model 설정 없음. 제목/태그/후속질문은 메인 provider 재사용                                                                                                     |
| Title Generation                        | 대화 기반 채팅 제목 자동 생성                                                                                     | ✅ 개발됨  | `orchestrator/session-title-tags.ts`(LLM 생성+`deriveSessionTitle` 폴백), `messages.ts:592` 소비                                                                         |
| Tags Generation                         | 채팅 태그 자동 생성                                                                                               | ✅ 개발됨  | 동상, `session_tags`(migration 0020) 반영                                                                                                                                |
| Follow-Up Generation                    | 응답 후 문맥 기반 후속질문 제안                                                                                   | ✅ 개발됨  | `orchestrator/followups.ts`, POST `/:id/followups`(REST)                                                                                                                 |
| Autocomplete Generation                 | 입력 중 고스트 텍스트 자동완성                                                                                    | ❌ 미개발  | server/web grep 무결과                                                                                                                                                   |
| Retrieval Query Generation              | 검색용 쿼리 LLM 생성                                                                                              | ❌ 미개발  | 별도 query-gen 없음(knowledge_search 자체가 미배선)                                                                                                                      |
| Context Compaction                      | 임계 초과 시 오래된 메시지 요약 압축                                                                              | ❌ 미개발  | 코드 없음                                                                                                                                                                |

### 2. 연결 (Connections)

| 기능                                      | 설명                                                          | WChat 상태 | 근거/비고                                                                                                                                                                                                |
| ----------------------------------------- | ------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenAI-compatible 다중 연결               | 다중 base URL·API 키(vLLM/OpenRouter/Groq 등)                 | ⚠️ 부분    | `llm-provider-registry.ts`(모델명 기준 라우팅) + `llm-provider-openai.ts`/`llm-failover.ts` 코드 존재하나 **app.ts는 Anthropic-or-devstub 1개만 등록**. base URL/키를 admin이 등록하는 연결 CRUD UI 없음 |
| Ollama 연결                               | 로컬 Ollama 백엔드(로드밸런싱)                                | ❌ 미개발  | Ollama adapter 없음                                                                                                                                                                                      |
| Direct Connections (사용자 브라우저 직결) | 사용자가 개인 OpenAI 엔드포인트를 브라우저에 저장·백엔드 우회 | ⚠️ 부분    | org 설정 `enableDirectConnections` 토글만 저장(`ConnectorsTab.tsx`). 실제 브라우저 직결 추론 경로 미구현                                                                                                 |
| Native HTTP MCP 서버                      | HTTP/SSE MCP 서버를 도구로 연결                               | ✅ 개발됨  | `routes/mcp-servers.ts`+`mcp-client-pool.ts`(JSON-RPC 2.0), SSRF 검증·rate limit, `app.ts:349` discover 배선                                                                                             |
| OpenAPI / MCPO 도구 서버                  | OpenAPI 스펙·stdio MCP 브릿지 연결                            | ❌ 미개발  | OpenAPI ingest·MCPO 어댑터 없음(Native HTTP MCP만)                                                                                                                                                       |
| Terminal Server 연결                      | Open Terminal / 오케스트레이터 실셸 연결                      | ❌ 미개발  | 대체=E2B code_interpreter 샌드박스(터미널 서버 아님)                                                                                                                                                     |
| 모델 리스트 캐싱 (TTL)                    | 연결 모델 목록 메모리 캐시                                    | ❌ 미개발  | `config.ts`가 registry 모델∩allowed 매 요청 필터, 캐시 TTL 없음                                                                                                                                          |

### 3. 문서 / RAG 설정

| 기능                                                                      | 설명                                 | WChat 상태       | 근거/비고                                                                                                                                                          |
| ------------------------------------------------------------------------- | ------------------------------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 임베딩 엔진 선택 (ST/Ollama/OpenAI/Azure)                                 | RAG 임베딩 provider 구성             | ⚠️ dev-stub      | `createDevStubEmbeddingProvider` 전용, 실 Voyage/OpenAI 임베딩 미구현(app.ts:256). 엔진 선택 UI 없음                                                               |
| Chunk 설정 (size/overlap)                                                 | 청크 크기·중첩 조정                  | ⚠️ 부분          | `KnowledgeRagTab.tsx` ragChunkSizeTokens/Overlap 저장·검증, `document-service.ts` 소비. 단 프로젝트 인덱싱만이고 첨부 인덱싱 생산측 미배선                         |
| Text Splitter / Markdown Header Splitter                                  | character/token 분할, 헤더 우선 분할 | ❌ 미개발        | 분할 전략 선택 없음                                                                                                                                                |
| Top-K / Hybrid / Relevance Threshold                                      | BM25+벡터 하이브리드·리랭킹·임계     | ⚠️ 부분          | ragTopK/rrfK/hybridEnabled/relevanceThreshold 저장(`org-settings-schema.ts`), `hybridSearch`(RRF) 알고리즘 실구현. 단 `knowledge_search` 도구 자체가 런타임 미배선 |
| Reranking (CrossEncoder/external)                                         | 검색 청크 리랭킹                     | ❌ 미개발        | 외부 리랭커 설정 없음(RRF 결합만)                                                                                                                                  |
| Content Extraction 엔진 (Tika/Docling/Mistral OCR/Azure DI/MinerU/Paddle) | 다중 문서 파싱 엔진 선택             | ❌ 미개발        | 엔진 선택 없음                                                                                                                                                     |
| RAG Template / Full Context                                               | 검색 컨텍스트 포맷·전문 주입         | ❌ 미개발        | 템플릿 편집 UI 없음                                                                                                                                                |
| 업로드 제한 (size/count/ext)                                              | 파일당 MB·동시수·확장자 화이트리스트 | ⚠️ 부분          | Quota 탭 maxUploadSizeMb/maxUploadCount 저장·검증(`QuotaTab.tsx`). 확장자 화이트리스트 없음                                                                        |
| Vector DB 선택 (chroma/milvus/qdrant/pgvector 등)                         | 벡터 스토어 백엔드 선택              | ⚠️ pgvector only | docker-compose pgvector. 선택 옵션 없음                                                                                                                            |
| External Knowledge Sources                                                | 외부 벡터DB 재임베딩 없이 직결       | ❌ 미개발        | 없음                                                                                                                                                               |
| Reindex (임베딩 모델 변경 시)                                             | 컬렉션 재청크·재임베딩               | ❌ 미개발        | Reindex 버튼/엔드포인트 없음                                                                                                                                       |
| Google Drive / OneDrive / YouTube 로더                                    | 외부 소스 ingest                     | ❌ 미개발        | 없음                                                                                                                                                               |
| Citations                                                                 | 투입 문서 출처 인용 추적             | ✅ 개발됨        | `orchestrator.ts:182+` SSE `citation` 이벤트, 환각 마커 drop                                                                                                       |

### 4. 웹검색 설정

| 기능                               | 설명                                 | WChat 상태 | 근거/비고                                                                                           |
| ---------------------------------- | ------------------------------------ | ---------- | --------------------------------------------------------------------------------------------------- |
| Enable Web Search 토글             | 전역/org 웹검색 활성                 | ✅ 개발됨  | `webSearchEnabled`(admin) + `body.webSearch` 이중 게이트(`messages.ts:411`)                         |
| Provider 선택 (20+ providers)      | SearXNG/Brave/Google/Tavily 등 다수  | ⚠️ 부분    | dev-stub / tavily **2종만**(`WebSearchTab.tsx`). Tavily 실 adapter(`web-search-provider-tavily.ts`) |
| Result Count                       | 크롤 결과 수                         | ✅ 개발됨  | `webSearchResultCount` 저장·소비                                                                    |
| Endpoint / API Key Ref 구성        | provider 엔드포인트·키 참조          | ✅ 개발됨  | invoke 시점 org resolve(`web-search-handler.ts:62`), 단 apiKeyRef는 `TAVILY_API_KEY`만 인식(보안)   |
| Domain Filter / SSRF Fetch Filter  | 도메인 allow/block·메타데이터 차단   | ⚠️ 부분    | MCP는 `url-validator.ts`(RFC1918 차단+VPC allowlist). 웹검색 전용 도메인 필터 UI 없음               |
| Search Confirmation                | 외부 질의 전 사용자 승인             | ❌ 미개발  | 없음                                                                                                |
| Loader 엔진 (Playwright/Firecrawl) | 페이지 스크래핑 로더 선택            | ❌ 미개발  | provider가 결과 반환, 별도 로더 엔진 선택 없음                                                      |
| Agentic Web Search                 | 모델이 검색 필요 여부 자율 판단·호출 | ✅ 개발됨  | native mode LLM-주도 `web_search` 도구 호출 기본 동작                                               |

### 5. 오디오 (STT / TTS / Voice)

| 기능                                      | 설명                        | WChat 상태 | 근거/비고                                      |
| ----------------------------------------- | --------------------------- | ---------- | ---------------------------------------------- |
| STT 엔진 (Whisper/OpenAI/Azure/Deepgram)  | 음성→텍스트 받아쓰기        | ❌ 미개발  | audio/stt/whisper grep 0건. 도메인 전체 미구현 |
| TTS 엔진 (Kokoro/OpenAI/Azure/ElevenLabs) | 텍스트→음성 낭독            | ❌ 미개발  | grep 0건                                       |
| per-model TTS Voice                       | 모델별 고유 보이스          | ❌ 미개발  | 프리셋·오디오 부재                             |
| Voice Mode / Call                         | 핸즈프리 음성·통화 오버레이 | ❌ 미개발  | 없음                                           |

### 6. 이미지 생성/편집

| 기능                                      | 설명                   | WChat 상태 | 근거/비고                                             |
| ----------------------------------------- | ---------------------- | ---------- | ----------------------------------------------------- |
| 이미지 생성 (DALL·E/Gemini/ComfyUI/A1111) | 프롬프트→이미지 생성   | ❌ 미개발  | image-generation/comfyui grep 0건. 도메인 전체 미구현 |
| 이미지 편집 / Inpainting / Compositing    | 기존 이미지 편집·합성  | ❌ 미개발  | 없음                                                  |
| 프롬프트 자동 향상                        | 생성 프롬프트 LLM 보강 | ❌ 미개발  | 없음                                                  |

### 7. 코드 실행

| 기능                              | 설명                              | WChat 상태 | 근거/비고                                                                                                             |
| --------------------------------- | --------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------- |
| Code Interpreter (agentic Python) | 모델이 코드 자율 작성·실행        | ✅ 개발됨  | `code-interpreter-handler.ts` + E2B 실 adapter(`sandbox-transport-e2b.ts`), LOCAL_ONLY=dev-stub. 산출물 artifact 저장 |
| Python via Pyodide (브라우저)     | WASM 샌드박스 실행                | ❌ 미개발  | Pyodide 없음                                                                                                          |
| Jupyter Server Execution          | 서버 파이썬 환경 연결             | ❌ 미개발  | 없음                                                                                                                  |
| Open Terminal (실셸)              | 원격 셸/멀티테넌트 오케스트레이터 | ❌ 미개발  | E2B 샌드박스가 인접 대체(egress 기본 차단)이나 터미널 서버 아님                                                       |
| Artifacts (HTML/CSS/JS·SVG)       | sandbox iframe 프리뷰·버전        | ✅ 개발됨  | `ArtifactCanvas/ArtifactPanel.tsx`, `sandbox=""` iframe, 버전 페이저                                                  |
| Markdown & LaTeX 렌더링           | GFM + KaTeX 수식                  | ✅ 개발됨  | `Markdown.tsx`(remark-gfm/math+rehype-katex)                                                                          |
| Mermaid 렌더링                    | 다이어그램 시각화                 | ✅ 개발됨  | `Mermaid.tsx`(동적 import, 코드 폴백)                                                                                 |
| IFRAME_CSP 구성                   | 프리뷰 iframe CSP 주입            | ⚠️ 부분    | `sandbox=""`로 스크립트 차단은 하나, 구성형 CSP env 없음                                                              |
| Blacklisted Modules               | import 차단 모듈(보안)            | ❌ 미개발  | 모듈 블랙리스트 설정 없음(E2B egress 차단으로 대체)                                                                   |

### 8. 확장 (Functions / Tools / Pipelines)

| 기능                                     | 설명                                    | WChat 상태 | 근거/비고                                                                                                                |
| ---------------------------------------- | --------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------ |
| Functions — Pipe                         | 사이드바 커스텀 모델/에이전트           | ❌ 미개발  | Python Functions 프레임워크 없음                                                                                         |
| Functions — Filter (inlet/stream/outlet) | 입출력 가로채 번역·검열·로깅            | ❌ 미개발  | 없음                                                                                                                     |
| Functions — Action / Event               | 메시지 버튼·시스템 이벤트 훅            | ❌ 미개발  | 없음(메시지 액션은 고정 셋)                                                                                              |
| Valves / UserValves + 암호화             | Admin/User 2-tier 설정, Fernet 암호화   | ❌ 미개발  | valve/frontmatter grep 0건                                                                                               |
| Workspace Tools (in-process Python)      | 서버 실행 커스텀 파이썬 도구            | ❌ 미개발  | 임의 Python 도구 실행 없음(내장 핸들러+MCP만)                                                                            |
| Native MCP 도구 서버                     | 외부 MCP를 도구로                       | ✅ 개발됨  | §2 참조(`mcp-servers.ts`, JSON-RPC, SSRF·rate limit)                                                                     |
| Builtin System Tools                     | query_knowledge/kb_exec/search_chats 등 | ⚠️ 부분    | deep_research·web_search·code_interpreter·artifact_create 실배선. **knowledge_search 미배선**, search_chats·kb_exec 없음 |
| Pipelines (legacy 워커)                  | 별도 컨테이너 OpenAI-API 플러그인       | ❌ 미개발  | 없음(범위 밖)                                                                                                            |
| Pip install (frontmatter requirements)   | 도구 의존성 자동 설치                   | ❌ 미개발  | 없음                                                                                                                     |
| Skills 워크스페이스                      | 재사용 마크다운 지시셋 관리             | ✅ 개발됨  | `tools/skills-engine.ts`, `routes/skills.ts`+`skill-assets.ts`, migration 0009                                           |

### 9. 평가 (Evaluation / Arena)

| 기능                            | 설명                          | WChat 상태 | 근거/비고                                                                 |
| ------------------------------- | ----------------------------- | ---------- | ------------------------------------------------------------------------- |
| Message Rating (thumbs up/down) | 응답 평가 수집                | ✅ 개발됨  | `POST/GET /:id/messages/:mid/feedback`, migration 0023 `message_feedback` |
| Arena Model (blind 비교)        | 풀에서 무작위 모델 blind 비교 | ❌ 미개발  | arena/elo grep = 무관 매치(env/url-validator)만, 기능 없음                |
| Elo Leaderboard                 | 모델 간 Elo 랭킹              | ❌ 미개발  | leaderboard 없음                                                          |
| Model Activity Chart            | 모델별 승/패 차트             | ❌ 미개발  | 없음                                                                      |
| Topic Tagging (eval re-ranking) | 도메인별 평가 태깅            | ❌ 미개발  | 세션 태그와 별개, 평가용 없음                                             |
| Chat Snapshots (finetuning용)   | 평가 스냅샷 캡처              | ❌ 미개발  | 없음                                                                      |

### 10. 분석 (Analytics)

| 기능                                | 설명                               | WChat 상태            | 근거/비고                                                                                                                                |
| ----------------------------------- | ---------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Analytics 탭 (사용량 인사이트)      | 메시지·토큰·모델 인사이트 대시보드 | ⚠️ 부분               | admin `/dashboard`(사용자/세션/24h오류 카드+도구 요약, `AdminDashboard.tsx`) 존재하나 OWUI식 메시지 타임라인/모델 사용 분석 UI 아님      |
| Token Usage Tracking                | input/output/cost 토큰 추적        | ✅ 개발됨             | `usage_logs`(tokens_in/out/cost_micros, migration 0010), `messages.ts:573` 기록                                                          |
| User Activity Table (per-user 집계) | 사용자별 메시지·토큰               | ⚠️ 부분               | `GET /usage`(admin, org-wide 날짜·사용자별 토큰/비용 집계, `routes/usage.ts`). 전용 activity 차트 UI 아님                                |
| Model Usage Table                   | 모델별 messages/tokens 랭킹        | ❌ 미개발             | 모델별 집계 뷰 없음                                                                                                                      |
| Message Timeline Chart              | 시간대별 메시지량 차트             | ❌ 미개발             | 없음                                                                                                                                     |
| Group Filtering (RBAC 그룹별)       | 부서별 리포팅 필터                 | ❌ 미개발             | usage 집계에 group_id 필터 없음                                                                                                          |
| Tool Metrics (도구 지표)            | 도구별 호출·오류율·지연            | ✅ 개발됨(WChat 특화) | `/admin/tool-metrics`(p50/p95/p99·error rate, `ToolMetricsTable.tsx`), `tool_metrics`(migration 0011) — OWUI엔 없는 per-tool 지연 백분위 |

### 11. DB / 스토리지 / 관측

| 기능                                | 설명                                | WChat 상태 | 근거/비고                                                                                                                         |
| ----------------------------------- | ----------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Database (Postgres)                 | 주 DB                               | ✅ 개발됨  | Postgres+pgvector(docker-compose), migration 0001–0027                                                                            |
| DB Migrations                       | 시작 시 마이그레이션                | ✅ 개발됨  | `db/migrations/` 순차 마이그레이션 시스템                                                                                         |
| Object Storage (local/s3/gcs/azure) | 업로드 저장 백엔드                  | ⚠️ 부분    | `lib/object-store.ts` Local/InMemory 포트, S3 구현은 배포 시 교체(uploads.s3_key 컬럼 예약). 다중 provider 선택 없음              |
| Redis (앱 상태·멀티워커)            | 상태 저장·pub/sub                   | ⚠️ 부분    | `REDIS_URL` env 필수+docker-compose 존재하나 런타임 미배선(health `redis:"unknown"` 플레이스홀더), HITL은 in-memory Map           |
| Websocket Manager                   | 실시간 상태 공유(redis)             | ❌ 미개발  | SSE 스트리밍만, websocket/redis pub-sub 없음                                                                                      |
| OpenTelemetry (traces/metrics/logs) | OTLP 관측 export                    | ⚠️ 부분    | `orchestrator.ts`가 OTel GenAI 시맨틱 속성명만 맞춤, **SDK 미도입**(계획 의존성 목록 외). 대체=`tool_metrics`/`error_logs` 테이블 |
| Audit Logs                          | 요청/응답 감사 로그                 | ❌ 미개발  | audit grep 0건. `error_logs`(observability)는 별개                                                                                |
| Persistent Config (DB>env)          | 설정 DB 저장·admin UI 편집          | ✅ 개발됨  | `org_settings`(migration 0017) + admin 7탭 PUT `/admin/settings`                                                                  |
| Health Check                        | 컴포넌트 상태 점검                  | ✅ 개발됨  | `/health`(db/redis/e2b/llm status, app.ts:118)                                                                                    |
| Instance Name / Branding            | 인스턴스 이름·브랜딩                | ⚠️ 부분    | `BrandingTab` instanceName 저장. WEBUI_NAME/URL/locale 등 세부 없음                                                               |
| License / Offline / Version Check   | 엔터프라이즈 라이선스·업데이트 체크 | ❌ 미개발  | 없음                                                                                                                              |

### 12. 웹훅 & 배너

| 기능                          | 설명                            | WChat 상태 | 근거/비고                                                                                                                                                       |
| ----------------------------- | ------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Admin Webhook (new_user 알림) | 가입 시 Slack/Teams POST        | ❌ 미개발  | new_user webhook 없음                                                                                                                                           |
| User Webhooks                 | 사용자별 응답 완료 알림 URL     | ❌ 미개발  | 없음(대체=브라우저 Notification, chat-core 도메인)                                                                                                              |
| Channel Webhooks              | 외부 서비스가 채널로 POST       | ❌ 미개발  | Channels 기능 자체 범위 밖                                                                                                                                      |
| Banners (typed 공지)          | info/success/warning/error 배너 | ⚠️ 부분    | typed 스키마+사용자 실표시 완비(`Banner.tsx`, dismissible+sessionStorage). **admin 저작 UI는 평문 단일 input만**(`BrandingTab.tsx`) — type/title/다중 저작 불가 |
| Response Watermark            | 복사 시 삽입 워터마크 텍스트    | ⚠️ 부분    | `responseWatermark` 저장(BrandingTab). 복사 시 실삽입 런타임은 본 조사 범위 밖(미검증)                                                                          |
| Calendar Alert / Scheduler    | 캘린더 이벤트 알림 토스트·웹훅  | ❌ 미개발  | Calendar 범위 밖                                                                                                                                                |

---

### WChat 고유 기능 (Open WebUI 엔 없거나 다르게 구현)

- **HITL(Human-in-the-Loop) 승인 게이트** — 오케스트레이터가 `defaultPolicy:"hitl"` 도구에 `hitl_request` 방출→승인 대기→`hitl_resolved`/`hitl_timeout`, denied 시 skip. 라우트 `POST /:id/messages/hitl`·`GET /:id/hitl/pending`(`orchestrator.ts:301+`, `hitl-manager.ts`). OWUI엔 내장 승인 게이트 없음(현재 내장도구는 all-allow이라 실트리거는 MCP 도구 한정).
- **멀티에이전트 오케스트레이터 프리미티브** — `orchestrator-worker`·`dag-planner`·`routing-handoff`·`evaluator-optimizer`·`verification-worker` 실구현, `deep_research`가 plan→병렬조사→synthesis→gap 반성(MAST 종료가드)로 소비. OWUI의 MOA는 채팅 내 응답 합성 수준이라 결이 다름.
- **MCP SSRF 하드닝 + per-server rate limit** — RFC-1918 차단 + VPC CIDR allowlist(`url-validator.ts`) + 서버별 고정윈도우 rate limit + invoke마다 재검증. OWUI 기본보다 방어 심화.
- **per-tool 지연 백분위 관측(tool_metrics)** — 도구별 호출/오류율/p50·p95·p99 admin 테이블(`ToolMetricsTable.tsx`). OWUI Analytics는 메시지·토큰 중심이라 도구 지연 백분위 뷰 없음.
- **데이터 보존 잡 + Slack 실패 알림** — `lib/data-retention.ts`가 단계별 실패 시 `SlackWebhookAlertNotifier`로 ops 알림(`alert-engine.ts`, `alert_events` 테이블). OWUI의 사용자향 webhook과 다른 내부 운영 알림.
- **org 단위 동적 모델 화이트리스트(`allowed_models`) + Zod 스키마 org 설정 7탭** — env 기반 OWUI와 달리 DB 컬럼 동적 화이트리스트 + `OrgSettingsSchema` fail-soft 정본으로 관리.
- **resource_grants 세분 RBAC 인프라(미배선)** — migration 0027 + `canAccessResource` additive-union 판정 로직 존재하나 grant 생성 라우트·enforcement·UI 전무(명시적 후속 범위축소). OWUI ACL 대응 개념이나 현재 dead-path.

---

## 부록 A. WChat 현행 인벤토리 (코드 근거, 6영역)

### WChat 인벤토리 [chat-core]

P19 채팅 코어/스트리밍/메시지 액션 CURRENT 구현 인벤토리 (실제 코드 확인 완료, feature_list P19 38/38 passes=true 이나 아래는 코드 근거 기준):

## 스트리밍 코어

- **SSE 스트리밍(POST 턴)** — ✅실구현 — `apps/server/src/routes/messages.ts` `POST /:id/messages` → `streamSSE` + `runTurn`, 클라 `hooks/useSessionStream.ts` `streamTurn`/`parseSseFrame`(`\n\n` 프레이밍)
- **멀티-leg(tool_use 후 이어짐)** — ✅실구현 — 서버는 leg마다 `stop` yield, 클라 `processEvent`가 `stop.reason==="tool_use"`를 종단으로 처리하지 않음(`useSessionStream.ts:641`)
- **keep-alive 하트비트** — ✅실구현 — `messages.ts:469` `setInterval(… ": ping\n\n", 10_000)`, 클라 `readFrom`가 모든 바이트로 `lastActivityRef` 갱신 + 14s stale 워치독(`useSessionStream.ts:294~327`)
- **resume(재연결/캐치업)** — ✅실구현 — `messages.ts` `GET /:id/messages/:messageId/stream` → `subscribeMessageRun` + 첫 이벤트 `message_replace`(contentSoFar), 클라 `resumeLeg`/`driveToTerminal`(bounded 12회) + `recoverFinalMessage` 폴백. 레지스트리 `orchestrator/message-run-registry.ts`
- **취소(Stop)/Abort 전파** — ✅실구현 — 클라 `stop()` → `DELETE /:id/active-run`(`sessions.ts:435` `abortRun`) + `AbortController`, 서버 `registerRun`/`handle.controller.signal` → `runTurn`
- **도구호출 상태 UI** — ✅실구현 — `components/chat/ToolCallRenderer.tsx`(`data-tool-status`, `StatusChip`, multi-agent badge) + `tool_progress` 스윔레인(tasks) + `RunRail.tsx`(눈금). 클라 상태 `MessagePart.status: queued|running|done|error`

## 메시지 액션

- **편집(editMessage)** — ✅실구현 — `useSessionStream.ts:891` 동일 부모 아래 새 user 형제 생성, UI `MessageActions.tsx` 편집 버튼
- **재생성(regenerate)** — ✅실구현 — `useSessionStream.ts:914` user 노드까지 부모체인 역행 후 새 assistant 형제, UI `ChatView.tsx:555`
- **분기(switchBranch) + 새로고침 복원(parentMessageId)** — ✅실구현 — 트리 모델(`parentOf/childrenOf/activeChildOf`) + `switchBranch`(`useSessionStream.ts:1008`), 복원은 `loadHistory`가 서버 `parentMessageId` 소비(`:364`). 서버 `GET /:id/messages` 응답에 `parentMessageId` 포함(`sessions.ts:274`), 영속 시 `messages.ts:572` `parentMessageId: userMessage?.id`
- **응답 이어쓰기(continue)** — ✅실구현 — 서버 `messages.ts` `POST /:id/messages/:mid/continue`(직전 assistant를 prefix로 재스트리밍, 완료 시 원본 행 `update`), 클라 `continueMessage`(`useSessionStream.ts:933`), UI `truncated` 시 "이어쓰기" 버튼(`ChatView.tsx:1018`). max_tokens stop→`truncated=true`(`:647`)
- **메시지 평가(👍/👎 feedback)** — ✅실구현 — 서버 `sessions.ts` `POST|GET /:id/messages/:messageId/feedback`(upsert/토글취소, ownership 검증, migration 0023 `message_feedback`), UI `MessageActions.tsx:36` `toggleFeedback` + `lib/messageFeedback.ts`(낙관적+롤백)
- **후속질문(followups)** — ✅실구현 — 서버 `messages.ts` `POST /:id/followups`(REST, SSE 아님) → `orchestrator/followups.ts` `generateFollowups`(실 `provider.chat` 호출 + 파싱실패/dev-stub 시 `deriveFollowups` 결정적 폴백, ownership 검증), UI 칩 `ChatView.tsx:1039`/클릭 전송 `:573`

## 모델/모드/토글 서버 실소비

- **모델 선택** — ✅서버 소비 — `messages.ts:373` `org.allowedModels` 화이트리스트 검증 후 `model=requestedModel`(미허용 400 `MODEL_NOT_ALLOWED`), org `defaultModel` 폴백(`:358`)
- **모드 agent/chat** — ✅서버 소비 — `messages.ts:419` `body.mode==="chat"` → `tools=[]`(도구 비활성), agent는 도구 유지
- **웹검색 토글** — ✅서버 소비 — `messages.ts:411` `includeWebSearch = resolvedSettings.webSearchEnabled && body.webSearch`; false면 tool set에서 `web_search` 필터 제거. admin off면 강제 off. org-scoped provider 해석 `tools/handlers/web-search-handler.ts`(dev-stub 폴백)
- **추론 강도(reasoningEffort)** — ⚠️클라 전용·서버 no-op — 클라는 `ChatInput.tsx:339`에서 body에 전송하나 `messages.ts` POST body 파싱 타입에 `reasoningEffort` 없음, `apps/server/src` 전체 0건(grep 확인). UI 피커만 존재(`ModelModePicker.tsx` effort select), 서버/오케스트레이터 미반영
- **임시 채팅(temporary)** — ✅서버 소비 — `messages.ts:271` `isTemporary` → `ensureSession`·`messages.insert`(user/assistant 모두) 스킵, 스트림만 반환. UI 토글 `ModelModePicker.tsx`(🕶️임시)+배너 `ChatInput.tsx:490`, 전송 `:341`

## 기타 채팅 기능

- **완료 알림** — ✅실구현(프론트) — `useSessionStream.ts:178` `notifyTurnComplete`: `document.hidden`일 때만 `Notification` 1회(권한 default면 요청, denied 재요청 안함), stop(non-tool_use)/continue stop 시 호출
- **PDF 내보내기** — ✅실구현(무의존) — `ShareExportMenu.tsx:58` `exportPdf` → 인쇄뷰(`chat-print-view`) 렌더 후 `window.print()`(신규 의존성 없음). md/JSON 내보내기도 동일 메뉴
- **프롬프트 라이브러리 + /명령 + 변수** — ✅실구현 — 서버 CRUD `routes/prompts.ts`(migration 0024, private/org 접근제어), UI `settings/PromptsManager.tsx` + 컴포저 `/` 자동완성 `ChatInput.tsx`(slashCommands) + 변수치환 `lib/promptVariables.ts`(`{{today}}/{{user}}/{{clipboard}}`), 조립 `ChatView.tsx:201/208`
- **세션 제목/태그 LLM 생성** — ✅실구현 — 첫 턴 완료 후 `messages.ts:592` `generateSessionTitleAndTags`(`orchestrator/session-title-tags.ts`, provider 호출 + `deriveSessionTitle` 파생 폴백), 태그는 `session_tags`(0020)에 반영

## 세션 정리(부수 확인)

- **핀 서버 영속** — ✅실구현 — `sessions.ts` `PATCH /:id/pin`(migration 0018 `pinned_at`, 목록 `pinned` 반영), 클라 `lib/pinnedSessions.ts`
- **폴더/태그/아카이브/내용검색** — ✅실구현 — `routes/folders.ts`(0019) · `sessions.ts` `POST/DELETE /:id/tags`(0020, `?tag=` 필터) · `PATCH /:id/archive`(0021, `?archived=` 필터) · `GET /search?q=`(0022) — 전부 `app.ts` 마운트 + `routes-mounted.test.ts` EXPECTED_ROUTES 등재 확인

## 없음/범위 밖(명시)

- **추론 과정 표시(thinking/reasoning stream)** — ❌없음 — ChatEvent frozen(신규 SSE 이벤트 금지)로 미구현. UI의 `Reasoning.tsx`는 별개(접힘 표시용), 서버 reasoning delta 이벤트 없음
- **reasoningEffort 서버 반영** — ❌없음(위 ⚠️ 참조) — provider 파라미터/thinking budget 매핑 부재

주요 파일: `apps/server/src/routes/messages.ts`, `apps/server/src/routes/sessions.ts`, `apps/server/src/app.ts`(184~260 배선), `apps/server/src/orchestrator/{message-run-registry,followups,session-title-tags}.ts`, `apps/web/src/hooks/useSessionStream.ts`, `apps/web/src/components/chat/{ChatView,MessageActions,ModelModePicker,ChatInput,ShareExportMenu,ToolCallRenderer,RunRail}.tsx`, `apps/web/src/lib/{promptVariables,messageFeedback}.ts`

### WChat 인벤토리 [chat-org]

Inventory complete. Here is the findings report.

---

# WChat 세션 조직화/데이터 관리 — 현재 구현 인벤토리

조사 범위: `apps/web/src/components/sessions/{SessionList,SessionCard}.tsx`, `apps/web/src/hooks/{useSessions,useGroups}.ts`, `apps/server/src/routes/{sessions,folders}.ts`, `apps/server/src/db/session-data-access.ts`, migrations 0018–0027, `feature_list.json`(P19 전 항목 `passes=true, attempts=1`), routes-mounted 테스트. 전 항목은 커밋된 상태.

참고: 태스크가 지목한 `useGroups.ts`는 **세션 그룹이 아니라 admin RBAC 그룹**(`/api/v1/admin/groups`, migration 0026) 소비 훅으로, 세션 조직화와 무관. 아래 인벤토리에서는 세션 데이터 관리 범위만 다룸.

## 핵심 기능 상태

**세션 목록** — 구현됨 — `GET /api/v1/sessions` (`sessions.ts:122`) → `useSessions.load` → `SessionList`. 최신순(`COALESCE(last_message_at, created_at) DESC`), `cursor`/`limit` 쿼리 파싱(`sessions.ts:124-125`). 날짜 그룹(고정 → 오늘 → 어제 → 이전 7일 → 이전, `groupSessionsByDate`).

- 한계: data-access `list()`가 `{ items }`만 반환하고 `nextCursor` 미생성(`session-data-access.ts` list는 단순 `LIMIT $4`) — 라우트/포트는 커서 페이지네이션 시그니처를 갖지만 **실제로는 단일 페이지(limit-only)**. 무한스크롤/다음페이지 미동작.

**히스토리 복원** — 구현됨 — `GET /:id/messages` (`sessions.ts:255`, 404 existence-leak 방지) → `useSessionStream.loadHistory` (`:335`). `parentMessageId` 트리 복원(편집/재생성 형제 분기 유지, P19-T6-01; 레거시 응답은 선형 체인 폴백). 세션 재진입 시 `GET /:id/artifacts`로 아티팩트도 복원(`:390`, P18-T6-02).

**이름변경(rename)** — 구현됨 — `PATCH /:id {title}` (`sessions.ts:360`, ownership-in-query) → `useSessions.renameSession` → `SessionCard` 인라인 편집 폼(Enter 저장/Esc 취소/blur 저장).

**삭제(delete)** — 구현됨 — `DELETE /:id` (`sessions.ts:425`, 204). ownership이 `WHERE id=.. AND user_id=..`에 내장. DB 레벨 cascade: messages/sessions_active_runs `ON DELETE CASCADE`(0002/0003), artifacts.session_id `ON DELETE SET NULL`(보존). `useSessions.deleteSession`이 목록+보관함에서 낙관적 제거.

**세션 생성(POST /sessions)** — **서버 핸들러 없음 / 갭** — `useSessions.createSession`(`:101`)과 `SessionList.handleNewSession`은 `POST /api/v1/sessions`를 호출하지만 **서버에 해당 핸들러가 존재하지 않음**(`sessions.ts`·`messages.ts`에 `app.post("/")` 없음; routes-mounted `EXPECTED_ROUTES`에도 POST `/sessions` 루트 없음 — GET `/`, GET `/:id/messages`, PATCH/DELETE `/:id`만 등록). 실제 세션 row는 **첫 메시지 전송 시 `ensureSession`의 `INSERT ... ON CONFLICT DO NOTHING`**(`app.ts:216`, 클라이언트 생성 UUID + `deriveSessionTitle`)으로 lazy 생성됨. 즉 `createSession()`의 POST는 매칭 라우트가 없어 응답 실패 시 `null` 반환 → "새 대화" 버튼 흐름이 이 경로에 의존한다면 잠재 결함(단, feature_list P17-T6-01은 passes=true로 표기됨 — 실제 UAT 검증 필요).

**폴더(session_folders)** — 구현됨 — migration 0019(개인 소유: `org_id`+`created_by`, RLS `session_folders_select/modify`; `sessions.folder_id` nullable FK `ON DELETE SET NULL`). `routes/folders.ts` CRUD(`POST/GET/PATCH/:id/DELETE/:id`, `/api/v1/folders` 마운트). 세션 할당은 `PATCH /:id {folderId}` (`sessions.ts:386`, 붙이기 전 `folders.byIdForOwner` 소유 검증 → 타 사용자 폴더는 400). UI: `SessionList`의 `FolderGroupHeader`/`partitionByFolder`(폴더 그룹, 생성/이름변경/삭제/접기), `SessionCard`의 폴더 지정 메뉴 + 해제.

**태그(session_tags) + 필터** — 구현됨 — migration 0020(`UNIQUE(session_id, tag)`, org_id RLS). `POST /:id/tags`, `DELETE /:id/tags/:tag`(`sessions.ts:182,207`, 세션 ownership 선검증 후 404). 서버 필터: `GET /?tag=`(`list()`에서 `EXISTS(session_tags)`, `sessions.ts:126`). 목록 응답에 `tags[]` 집계(`array_agg`). UI: `SessionCard` 태그 칩+추가/제거, `SessionList` 상단 태그 필터 바(`allTags`/`setTagFilter`).

- 참고: SessionList의 태그 필터는 **서버 `?tag=`가 아니라 클라이언트 측 `s.tags.includes(tagFilter)`**(`SessionList.tsx:291`)로 동작. 서버 필터 엔드포인트는 존재하나 목록 UI에서는 미사용.

**핀 서버영속(pinned_at)** — 구현됨 — migration 0018(nullable-first, localStorage → 서버 승격). `PATCH /:id/pin` 원자적 토글(`CASE WHEN pinned_at IS NULL THEN NOW() ELSE NULL`, `sessions.ts:224`). 목록 응답 `pinned` 반영. `useSessions.togglePin` 낙관적 업데이트(실패 시 롤백, `lib/pinnedSessions.ts` 경유). UI: `SessionCard` 핀/핀해제 버튼, "고정" 그룹이 날짜 그룹보다 최상단.

**아카이브(archived_at)** — 구현됨 — `archived_at` 컬럼은 0002부터 존재, migration 0021은 `(user_id, archived_at)` 인덱스 추가. `PATCH /:id/archive` 원자적 토글(`sessions.ts:240`), `PATCH /:id {archived}`도 지원. 기본 목록은 `archived_at IS NULL`만(`list()`), `GET /?archived=true`로 보관함 조회. `useSessions.archiveSession`/`loadArchived`/`archivedSessions`. UI: `SessionList` 보관함 뷰 토글(`archivedView`), `SessionCard` 보관/복원 액션.

**메시지 내용 검색(/sessions/search)** — 구현됨 — `GET /search?q=` (`sessions.ts:157`, q 없으면 400, userId는 auth 파생). data-access `search()`: `title ILIKE` OR `EXISTS(messages.content::text ILIKE)`, 와일드카드 `ESCAPE` 처리(`session-data-access.ts:157`). migration 0022 GIN `pg_trgm` 인덱스(title + messages.content). UI: `lib/sessionSearch`, `SessionList`가 200ms 디바운스 + `AbortController`로 호출, 제목 매칭(클라이언트 filter)과 별도로 "메시지 내용 검색결과" 스니펫 섹션 렌더(`SessionList.tsx:421`).

**공유(share)** — 구현됨(아티팩트 위임, 세션 전체 아님) — `ShareExportMenu`의 "대화 공유"는 명시적 opt-in 확인(alertdialog) 후 **세션의 최신 아티팩트**만 `ShareDialog`(기존 ArtifactShare 계약, 16-API-CONTRACT §8, 공개 토큰 링크)로 위임. 세션 대화 자체를 공개 링크화하는 기능은 아님. 익명 조회는 `useShare`+`routes/public-share.ts`(만료 410/revoked).

**내보내기 — Markdown / JSON** — 구현됨 — `lib/export-conversation.ts`(`conversationToMarkdown`/`conversationToJson`/`downloadTextFile`). `ShareExportMenu`에서 클라이언트 보유 messages를 즉시 직렬화·다운로드(**신규 서버 계약 없음**).

**내보내기 — PDF** — 구현됨 — `ShareExportMenu.exportPdf` → 인쇄용 뷰(`chat-print-view`) 렌더 후 `window.print()`(P19-T6-10, print stylesheet, 신규 의존성 없음).

**가져오기(import)** — **미구현** — import / 가져오기 / importConversation / `/import` 라우트·UI·코드 없음(server/web 전역 grep 무결과). md/json/PDF 내보내기의 역방향 흐름 부재.

**임시채팅(temporary)** — 구현됨 — 서버 P19-T2-05: `body.temporary === true`면 `ensureSession` 및 `messages.insert` 스킵(미영속), 스트림만 반환(`messages.ts:271` `isTemporary`, `:276` `if (auth && !isTemporary)`). UI P19-T6-11: `ModelModePicker` 임시 채팅 토글(`data-testid="model-picker-temporary"`, `:138`) + `ChatInput` 비저장 배너(`composer-temporary-banner`, `:490`) + 전송 payload `temporary:true`(`ChatInput.tsx:341,344`). 새로고침 시 히스토리에 미존재.

## 요약

| 기능                                   | 상태                                                                                                         |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 세션 목록                              | 구현됨 (단, 커서 페이지네이션 미동작 = limit-only 단일 페이지)                                               |
| 히스토리 복원 (메시지 트리 + 아티팩트) | 구현됨                                                                                                       |
| 이름변경 / 삭제                        | 구현됨                                                                                                       |
| 세션 생성 POST /sessions               | 서버 핸들러 없음 — 첫 메시지 lazy upsert(ensureSession)로 대체, 클라이언트 POST는 매칭 라우트 부재 (잠재 갭) |
| 폴더 (session_folders)                 | 구현됨 (개인 소유, CRUD + 할당 UI)                                                                           |
| 태그 (session_tags) + 필터             | 구현됨 (서버 `?tag=` 필터 존재하나 목록 UI는 클라이언트 필터 사용)                                           |
| 핀 서버영속 (pinned_at)                | 구현됨                                                                                                       |
| 아카이브 (archived_at)                 | 구현됨                                                                                                       |
| 메시지 내용 검색 (/sessions/search)    | 구현됨 (ILIKE + GIN pg_trgm, 스니펫 UI)                                                                      |
| 공유 (share)                           | 구현됨 — 세션 전체가 아니라 최신 아티팩트 공개링크 위임                                                      |
| 내보내기 md / json / PDF               | 구현됨 (클라이언트 직렬화 + window.print)                                                                    |
| 가져오기 (import)                      | **미구현 (부재)**                                                                                            |
| 임시채팅 (temporary)                   | 구현됨 (서버 미영속 + UI 토글/배너)                                                                          |

관련 파일 절대경로:

- `/Users/iremain/Documents/claudecode/W-Chat/apps/server/src/routes/sessions.ts`
- `/Users/iremain/Documents/claudecode/W-Chat/apps/server/src/routes/folders.ts`
- `/Users/iremain/Documents/claudecode/W-Chat/apps/server/src/db/session-data-access.ts`
- `/Users/iremain/Documents/claudecode/W-Chat/apps/server/src/routes/messages.ts` (임시채팅 `isTemporary`, ensureSession 배선은 `app.ts:216`)
- `/Users/iremain/Documents/claudecode/W-Chat/apps/web/src/hooks/useSessions.ts`
- `/Users/iremain/Documents/claudecode/W-Chat/apps/web/src/hooks/useSessionStream.ts` (loadHistory)
- `/Users/iremain/Documents/claudecode/W-Chat/apps/web/src/components/sessions/SessionList.tsx`
- `/Users/iremain/Documents/claudecode/W-Chat/apps/web/src/components/sessions/SessionCard.tsx`
- `/Users/iremain/Documents/claudecode/W-Chat/apps/web/src/components/chat/ShareExportMenu.tsx`
- `/Users/iremain/Documents/claudecode/W-Chat/apps/web/src/lib/export-conversation.ts`
- migrations `0018_session_pin.sql`, `0019_session_folders.sql`, `0020_session_tags.sql`, `0021_session_archive.sql`, `0022_session_search_index.sql` (dir: `/Users/iremain/Documents/claudecode/W-Chat/apps/server/src/db/migrations/`)

### WChat 인벤토리 [artifacts-misc]

# WChat 아티팩트/렌더링/프롬프트/메모리/알림 구현 인벤토리

전제: PROGRESS.md P19 및 `feature_list.json` 상 **P19 전 38개 태스크 passes=true (attempts=1)** — 이 영역 기능은 모두 구현·게이트 통과 상태.

## 1. 아티팩트 종류 (kind)

| 기능명                                                         | 상태        | 근거                                                                                                                           |
| -------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 타입 정의 8종 (`pptx·pdf·docx·xlsx·markdown·html·image·other`) | 구현됨      | `apps/web/src/components/artifacts/ArtifactPanel.tsx:14-23` (`ArtifactDto.type`), `ArtifactCanvas.tsx:103-112` (`KNOWN_TYPES`) |
| markdown — 인패널 렌더                                         | 구현됨      | `ArtifactPanel.tsx:65-72` content fetch → `<Markdown>` 재사용                                                                  |
| html — sandbox iframe 렌더                                     | 구현됨      | `ArtifactPanel.tsx:73-84` `<iframe sandbox="" srcDoc>` (scripts 차단)                                                          |
| pdf — 전용 렌더러                                              | 구현됨      | `ArtifactPanel.tsx:61-62` → `PdfRenderer.tsx` (react-pdf)                                                                      |
| pptx — PDF 변환 위임 렌더                                      | 구현됨      | `PptxRenderer.tsx` server office-pdf-converter 결과 blob → `PdfRenderer`                                                       |
| docx/xlsx/image/other — 미리보기 미지원(다운로드만)            | 부분/의도적 | `ArtifactPanel.tsx:85-87` "이 형식은 미리보기를 지원하지 않습니다" 폴백                                                        |
| 인라인 카드 아이콘은 `code·csv`도 매핑(미리보기는 없음)        | 부분        | `ArtifactCard.tsx:8-15` KIND_ICON (렌더러 없이 카드 표기용)                                                                    |

## 2. 미리보기 / 다운로드 / 버전 / 복원 / 인라인카드 / 모바일시트

| 기능명                                             | 상태     | 근거                                                                                                                                                                            |
| -------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 미리보기(preview) ↔ 코드(code) 탭 토글             | 구현됨   | `ArtifactCanvas.tsx:285-309`; 코드는 `/artifacts/:id/content` text fetch(178-192)                                                                                               |
| 다운로드                                           | 구현됨   | `ArtifactCanvas.tsx:275-281` `<a download>`; 서버 `artifacts.ts:94-142` GET `/:id/content` (RFC6266 UTF-8 파일명, inline stream / s3 HMAC 서명 60초 만료)                       |
| 버전 페이저 `‹ vN/M ›`                             | 구현됨   | `ArtifactCanvas.tsx:311-338` (`artifact-version-pager`) — 동일 파일명 아티팩트 배열을 index 로 순회                                                                             |
| 버전 **복원(restore/revert)** 액션                 | **없음** | 페이저는 탐색만; `grep restore/복원/revert` → 아티팩트엔 없음. "복원"은 전부 세션 히스토리/분기 복원(`useSessionStream.ts:329-411`)이고 아티팩트 버전 롤백 엔드포인트/버튼 부재 |
| 인라인 아티팩트 카드(메시지 하단 클릭 카드)        | 구현됨   | `ArtifactCard.tsx` (P18-T6-01), `data-testid=artifact-card`                                                                                                                     |
| 세션 재진입 시 아티팩트 복원 표시(`restored`)      | 구현됨   | `useSessionStream.ts:380-411` GET `/:id/artifacts`                                                                                                                              |
| 모바일 풀스크린 시트 + 드래그 grabber              | 구현됨   | `ArtifactCanvas.tsx:216-233` `fixed inset-0 z-[var(--z-modal)] … md:static` + grabber(232)                                                                                      |
| 데스크톱 사이드 패널 드래그 리사이즈               | 구현됨   | `ArtifactCanvas.tsx:194-208` (320~800px)                                                                                                                                        |
| 우패널 3탭(아티팩트·출처·활동) + 공유(ShareDialog) | 구현됨   | `ArtifactCanvas.tsx:23-27, 358-386`                                                                                                                                             |

## 3. 렌더링 (Markdown / LaTeX / Mermaid / HTML sandbox / code highlight)

| 기능명                                      | 상태   | 근거                                                                                                     |
| ------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------- |
| Markdown 렌더 (react-markdown + remark-gfm) | 구현됨 | `Markdown.tsx:6-8, 78-79` (GFM 테이블·리스트·링크 오버라이드)                                            |
| **LaTeX/수식** (remark-math + rehype-katex) | 구현됨 | `Markdown.tsx:8-11, 79-80` `import "katex/dist/katex.min.css"`                                           |
| Mermaid 다이어그램 (코드↔다이어그램 토글)   | 구현됨 | `Mermaid.tsx` (동적 import, SVG 렌더, 실패 시 코드 폴백); `Markdown.tsx:128-138` `language-mermaid` 감지 |
| 코드 문법 하이라이트 (rehype-highlight)     | 구현됨 | `Markdown.tsx:9, 80`; `CodeBlock.tsx` 언어라벨·복사·wrap 토글 chrome                                     |
| HTML sandbox (scripts 차단 iframe)          | 구현됨 | `ArtifactPanel.tsx:77-83` `sandbox=""`                                                                   |
| 스트리밍 중 미닫힌 코드펜스 보정            | 구현됨 | `Markdown.tsx:19-22` `balanceFences`                                                                     |
| 인용 칩/툴팁 (citation plugin)              | 구현됨 | `Markdown.tsx:14, 24-62, 82-95` remarkCitations → CitationChip                                           |

## 4. 프롬프트 라이브러리 (/명령 + 변수)

| 기능명                                           | 상태   | 근거                                                                                                                                   |
| ------------------------------------------------ | ------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| 프롬프트 CRUD 매니저 UI (카드 그리드+모달)       | 구현됨 | `apps/web/src/components/settings/PromptsManager.tsx` (P19-T6-13)                                                                      |
| 서버 CRUD 라우트 + org/private 접근제어          | 구현됨 | `apps/server/src/routes/prompts.ts` (POST/GET/GET:id/PATCH/DELETE, `command` unique 409, access private/org)                           |
| `usePrompts` 훅 / hand-written fetch 클라이언트  | 구현됨 | `apps/web/src/hooks/usePrompts.ts`, `apps/web/src/lib/prompts.ts`                                                                      |
| 컴포저 `/명령` 자동완성 합류                     | 구현됨 | `ChatView.tsx:190-203, 635-644` 정적 SLASH_COMMANDS + `prompt:<id>` 병합, `ChatInput.tsx:88-105,217-258` slash trigger                 |
| **변수 치환** `{{today}}·{{user}}·{{clipboard}}` | 구현됨 | `apps/web/src/lib/promptVariables.ts` `substitutePromptVariables`; `ChatView.tsx:208-221` 삽입 직전 치환(누락 변수=빈문자, throw 없음) |
| routes-mounted 가드 등록                         | 구현됨 | `routes-mounted.test.ts:47-48` `/api/v1/prompts`                                                                                       |

## 5. 메모리 CRUD / 패널

| 기능명                                               | 상태   | 근거                                                                                                                             |
| ---------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------- |
| 설정 메모리 매니저 (카테고리 필터·생성·편집·핀·삭제) | 구현됨 | `apps/web/src/components/settings/MemoryManager.tsx`; 카테고리 4종(user/feedback/project/reference), source(auto-extract/manual) |
| 채팅 내 인라인 메모리 패널(`/memories` 슬래시)       | 구현됨 | `apps/web/src/components/chat/MemoryPanel.tsx` (핀 토글만, 생성/편집/삭제는 설정 전용)                                           |
| `useMemories` 훅                                     | 구현됨 | `apps/web/src/hooks/useMemories.ts` (매니저·패널 공용)                                                                           |
| 서버 CRUD + 소유자 격리(404 leak 방지)               | 구현됨 | `apps/server/src/routes/memories.ts` (POST/GET(category·pinned·cursor)/PATCH/DELETE, `ownedByActor` 격리)                        |
| 카테고리·핀 필터 쿼리                                | 구현됨 | `memories.ts:83-112`                                                                                                             |

## 6. 완료 알림 (Notification API)

| 기능명                                                      | 상태   | 근거                                                                  |
| ----------------------------------------------------------- | ------ | --------------------------------------------------------------------- |
| 턴 완료 브라우저 알림                                       | 구현됨 | `apps/web/src/hooks/useSessionStream.ts:175-195` `notifyTurnComplete` |
| 백그라운드 탭 한정(`document.hidden`)                       | 구현됨 | `:179` 보이는 탭엔 미발생                                             |
| 권한 처리(granted 즉시 / default 요청 후 / denied 미재요청) | 구현됨 | `:188-194` `Notification.permission` 분기, 생성 실패 try/catch        |

## 7. 노트(notes) / 채널(channels) 존재여부

| 기능명            | 상태                   | 근거                                                                                                                                                         |
| ----------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Notes 기능**    | **없음(범위 밖 명시)** | 코드에 note UI/라우트 없음. `PROGRESS.md:200` P19 "범위 밖 명시: …Notes·Channels…". grep의 `note` 히트는 전부 테스트 fixture(예: 아티팩트 파일명 `notes.md`) |
| **Channels 기능** | **없음(범위 밖 명시)** | 동일. grep `channel` 히트는 무관: `orchestrator.ts` `createProgressChannel`(SSE 진행 스트림 내부), `alert-engine.ts`(알림 전송 채널) — 채팅 Channels 아님    |

## 추가 발견 (요청 항목과 인접, P19 완료)

- **임시 채팅(temporary/비저장)** — 구현됨: `ChatInput.tsx:495`, `ModelModePicker.tsx:138`, 서버 `body.temporary=true`시 미영속(P19-T2-05).
- **PDF 내보내기(대화)** — 구현됨: print stylesheet + `window.print()` (P19-T6-10, 무의존).
- **메시지 평가 👍👎 / 이어쓰기(continue) / 후속질문 칩** — 구현됨(P19-T1-07·T2-03·T2-04·T6-07/08/09).

핵심 경로 요약: 아티팩트 UI=`apps/web/src/components/artifacts/{ArtifactCanvas,ArtifactPanel,ArtifactCard,PdfRenderer,PptxRenderer,ShareDialog}.tsx` · 렌더=`apps/web/src/components/chat/{Markdown,CodeBlock,Mermaid}.tsx` · 프롬프트=`apps/web/src/components/settings/PromptsManager.tsx`+`apps/server/src/routes/prompts.ts`+`apps/web/src/lib/{prompts,promptVariables}.ts` · 메모리=`.../settings/MemoryManager.tsx`+`.../chat/MemoryPanel.tsx`+`apps/server/src/routes/memories.ts` · 알림=`apps/web/src/hooks/useSessionStream.ts:175-195`. Notes/Channels 부재.

### WChat 인벤토리 [knowledge-tools]

# WChat 지식/RAG/웹검색/도구/MCP/코드실행/멀티에이전트 인벤토리

조사 범위: `apps/server/src/{knowledge,tools,orchestrator,mcp,routes,db}/**`, `app.ts`, `PROGRESS.md`, `.ralph/*`. 현재 phase = **P19**. 공통 전제: 모든 임베딩은 **dev-stub 전용**(`createDevStubEmbeddingProvider`)으로 배선됨 — 실 Voyage 구현체는 존재하지 않고 `embedding-provider.ts`는 usage-tracking 래퍼일 뿐(app.ts:256,298). 따라서 아래 모든 벡터검색의 "의미검색 품질"은 LOCAL_ONLY에서 결정론적 stub 벡터에 의존한다.

---

## 1. 첨부/업로드 ephemeral RAG — **부분 구현 (검색 소비측 실배선 + dev-stub 임베딩 / 인덱싱 생산측 미배선 → 실사용 무동작)**

- **소비(검색)측은 실배선**: `messages.ts:334-346`이 첨부 uploadId들에 대해 `createPgAttachmentsPort.searchEphemeralChunks`(app.ts:255)를 호출 → `db/ephemeral-chunk-search.ts:47-112`가 pg `ephemeral_chunks` 테이블을 실제 쿼리하고 `hybridSearch`(search-service)로 랭킹해 Citation 반환. 결과는 SSE `citation` 이벤트로 실제 방출됨(`messages.ts:511-516`). 첨부 파일명 힌트 블록도 프롬프트에 추가됨(`messages.ts:316-325`).
- **생산(인덱싱)측은 미배선 (치명적 end-to-end gap)**: `routes/uploads.ts`는 파일을 sha256 dedup + object store에만 저장(`uploads.ts:52-58`). **업로드 시 parse→chunk→embed→`INSERT INTO ephemeral_chunks` 파이프라인이 어디에도 없음**(grep 결과 producer 0건; `ephemeral-chunk-search.ts:5-7`·`messages.ts:57-59`가 "인덱싱은 범위 밖"이라 명시). 즉 `ephemeral_chunks`는 **절대 채워지지 않아** 실사용에서 `searchEphemeralChunks`는 항상 빈 배열을 반환한다.
- 근거: `uploads.ts:44-63`(indexing 없음), `ephemeral-chunk-search.ts`, `messages.ts:298-346`, 마이그레이션 `0014_uploads.sql`(테이블만 존재).

## 2. knowledge_search (프로젝트 RAG hybridSearch) — **미배선 (알고리즘·핸들러는 실구현, 런타임 도구/retrieval pg 미배선)**

- **알고리즘 실구현**: `search-service.ts`의 `hybridSearch` = vector(cosine) + bm25(keyword count 근사) + RRF 결합, org_settings 기반 topK/rrfK/relevanceThreshold 반영(실코드). 핸들러 `knowledge-search-handler.ts:75-137`도 실구현(설정 invoke-time resolve, citation 조립).
- **런타임 미배선**: `createKnowledgeSearchTool`은 **`assembleBuiltinTools`에도 app.ts에도 호출되지 않음**(grep: 핸들러 파일·테스트 외 사용처 0). 즉 모델에게 `knowledge_search` 도구가 노출되지 않는다. 또한 `KnowledgeRetrievalPort.loadCandidates`의 **pg 구현체가 없음**(`knowledge-search-handler.ts:5` 자체 명시). 프로젝트 문서는 인덱싱은 되지만(`document-service.ts` parse+chunk+embed(dev-stub)→`DocumentChunkRepo`, app.ts:290-301) 런타임에 조회할 도구가 없다.
- 근거: `assemble-builtin-tools.ts:83-101`(knowledge_search 부재), PROGRESS P14-T3-01(2026-07-16) "이 툴은 app.ts 에 아직 미배선(P10-T2-03 부터 이어진 기존 구조적 갭)".

## 3. Citations — **실구현 (SSE citation 이벤트 실배선)**

- `orchestrator.ts:182+`가 tool_result의 json `{citations:[...]}`를 duck-typing해 각 citation을 `citation` ChatEvent로 펼쳐 방출(12변형 동결 준수). 인용 환각 방지: `citation-helper.matchCitations` + `dropUnmatchedCitationMarkers`로 목록에 없는 `[N]` 마커 제거.
- web 결과는 계약(`source: project|ephemeral` 동결)상 `"ephemeral"`+`sourceUri`로 근사(`web-search-handler.ts:98-107`, "web" source는 계약변경이라 격리).
- deep_research는 sub-question별 지역 인덱스를 전역 순번으로 remap 후 unmatched drop(`deep-research-handler.ts:290-313,460-464`).

## 4. deep_research (멀티에이전트 plan-research-synthesis) — **실구현 (실배선) / 단 하위검색 web_search 한정 + 키 없으면 dev-stub**

- P12 orchestrator 위의 얇은 파사드: plan(하위질문 분해, `maxSubQuestions=4` cap) → 각 하위질문 격리 `runTurn` 병렬(`Promise.all`) 조사 → synthesis → gap 반성(`maxGapIterations=2` hard cap, MAST 종료조건 가드) → citation drop 패스 → markdown artifact 저장. 진행 스트림(planning/researching/synthesizing) + 300s hang 가드. **assembleBuiltinTools/app.ts에 실배선됨**(`assemble-builtin-tools.ts:90`, app.ts:237).
- 한계: `workerTools: [webSearchTool]`만 부여 — **knowledge_search 미포함**(주석은 web+knowledge라 하나 실제 배열은 web_search 1개). lead=worker=동일 provider/model. LOCAL_ONLY에선 provider가 llm-provider-dev-stub(에코), 검색도 web-search dev-stub이라 end-to-end 왕복은 되나 **내용은 stub**.
- 근거: `deep-research-handler.ts` 전체, `assemble-builtin-tools.ts:90-100`.

## 5. web_search — **실구현 (Tavily 실 adapter 존재) / LOCAL_ONLY 기본 dev-stub 폴백, org provider 설정 실배선**

- 포트-어댑터: `web-search-provider-tavily.ts`(Tavily REST 실구현, native fetch, `fetchImpl` DI) + `web-search-provider-dev-stub.ts`(결정론적 in-memory). `assembleBuiltinTools:67-69`가 `TAVILY_API_KEY` 있으면 Tavily, 없으면 dev-stub(app.ts:244는 키 있을 때만 주입 → LOCAL_ONLY = dev-stub).
- **org-scoped provider 동적 선택 실배선**: invoke 시점 `webSearchProvider/webSearchEndpoint/webSearchApiKeyRef` resolve(`web-search-handler.ts:62-85`, `assemble-builtin-tools.ts:47-62`). 단 `apiKeyRef`는 보안상 `"TAVILY_API_KEY"` 하나만 인식.
- **활성 게이트 실배선**: admin `webSearchEnabled` + 요청 `body.webSearch` 둘 다 true일 때만 도구셋 포함(`messages.ts:411-415`).

## 6. code_interpreter (E2B/dev-stub) — **실구현 (E2B 실 adapter 존재) / LOCAL_ONLY 기본 dev-stub**

- 핸들러 실구현: `transport.start→writeFile→runCommand(stdout/stderr 버퍼)→listDir→readFile`로 OUTPUT_DIR 산출물을 artifact로 저장, ctx.signal 취소 관통(`code-interpreter-handler.ts`). E2B 실 어댑터(`sandbox-transport-e2b.ts`, e2b SDK를 `sandboxFactory` DI, egress `allowInternetAccess:false` 기본 차단). `assembleBuiltinTools:76-81`가 `E2B_API_KEY` 있으면 E2B, 없으면 dev-stub. app.ts LOCAL_ONLY = dev-stub(키 있을 때만 주입, app.ts:245). 실배선됨.

## 7. MCP 커넥터 (SSRF 방어·discovery·invoke) — **실구현 (전 구간 실배선)**

- **라우트**(`routes/mcp-servers.ts`): CRUD + org 경계 강제(존재-leak 방지 404) + 등록 시 `validateMcpUrl`(SSRF: RFC-1918 차단 + VPC CIDR 화이트리스트, `url-validator.ts`). app.ts:349-353에서 실 discover 주입.
- **discovery**(`mcp-bridge.ts`): `mcpClientPool.discover`를 25-30s 타임아웃으로 감싸 fail-soft([]), 서버별 tool registry에 등록 → `listRegisteredTools`.
- **invoke**(`mcp-client-pool.ts`): 실 JSON-RPC 2.0 over HTTP(`fetchImpl` DI), 서버 단위 고정윈도우 rate limit(기본 60/60s, 초과 시 WChatError), invoke마다 SSRF 재검증.
- **런타임 배선**: `assembleOrgMcpTools`(app.ts:80-110)가 org별 discovered MCP 도구를 AgentTool[]로 조립해 `messages.ts:388`에서 `runTurn`에 합류. LOCAL_ONLY엔 등록된 외부 서버가 없을 뿐 기계·배선은 실동작.

## 8. HITL 승인 — **실구현 (오케스트레이터 정책 강제 + 라우트 실배선) / in-memory bridge, 내장도구 중 hitl 정책 도구 없음**

- **정책 강제 실배선**: `orchestrator.ts:301-545`가 `spec.defaultPolicy==="hitl"` 도구에 대해 `hitl_request` 방출 → `ctx.hitl.askApproval` 대기 → `hitl_resolved`/`hitl_timeout` 방출, denied 시 skip. 순서 보존 세그먼트 처리.
- **라우트 실배선**: `POST /sessions/:id/messages/hitl`(승인/거부 resolve) + `GET /sessions/:id/hitl/pending`(대기목록) — `sessions.ts:441+`, `hitl-manager.ts`(in-memory Map, `resolved`/`gone` 구분, timeout/abort 처리).
- **한계**: bridge가 단일 프로세스 in-memory(Redis-backed는 배포 시 교체, LOCAL_ONLY). **내장 도구는 전부 `defaultPolicy:"allow"`** — 실제 HITL은 hitl 정책을 가진 MCP 도구(또는 향후 도구)에서만 트리거됨.

## 9. @멘션 / 도구 활성 — **부분 (web_search 토글·agent/chat 모드 실배선) / @멘션 기반 활성 미구현, tool-router 미배선**

- **실배선**: web_search 토글(admin+user, `messages.ts:411-415`), 모드 실동작(`body.mode==="chat"` → `tools=[]` 순수 대화, agent는 도구 유지, `messages.ts:417-419`). 모델-주도 tool 선택(LLM이 결정)은 기본 동작.
- **미구현/미배선**: `@멘션` 파싱이나 명시적 per-tool activation 로직 없음(`messages.ts`에 mention/enabledTools/allowedTools/toolChoice 검색 0건). semantic top-k 도구 선별기 `selectRelevantTools`(`tool-router.ts`)는 구현돼 있으나 **런타임(messages.ts)에 배선되지 않음** — 카탈로그 폭증(200+ MCP) 대비 코드만 존재.

---

## 부가: 멀티에이전트 오케스트레이터 프리미티브 (실구현)

`orchestrator-worker.ts`(격리 서브에이전트 `{task}` 파사드), `dag-planner.ts`, `routing-handoff.ts`, `evaluator-optimizer.ts`, `verification-worker.ts` 모두 실구현. deep_research가 이들을 소비하는 유일한 프로덕트화 진입점. UI는 `ToolCallRenderer.tsx`가 `{task}` 인자/`deep_research` 이름으로 "멀티에이전트" 배지 근사(전용 우패널·실시간 스트림은 범위 밖, PROGRESS P12-T6-01).

## 요약 매트릭스

| 기능                           | 상태                                                                                    |
| ------------------------------ | --------------------------------------------------------------------------------------- |
| 첨부 ephemeral RAG             | **부분** — 검색측 실배선+dev-stub 임베딩, **인덱싱 생산측 미배선(실사용 무동작)**       |
| knowledge_search(프로젝트 RAG) | **미배선** — 알고리즘/핸들러 실구현, 런타임 도구·retrieval pg 미배선                    |
| citations                      | **실구현** — SSE citation 이벤트, 환각 마커 drop                                        |
| deep_research                  | **실구현/실배선** — 단 하위검색 web_search 한정, 키 없으면 provider·검색 dev-stub       |
| web_search                     | **실구현** — Tavily 실 adapter, LOCAL_ONLY 기본 dev-stub, org provider 설정·토글 실배선 |
| code_interpreter               | **실구현** — E2B 실 adapter, LOCAL_ONLY 기본 dev-stub                                   |
| MCP 커넥터                     | **실구현/실배선** — SSRF 방어·discovery·JSON-RPC invoke·rate limit                      |
| HITL 승인                      | **실구현/실배선** — in-memory bridge, 내장도구는 all-allow(hitl 도구 없음)              |
| @멘션/도구 활성                | **부분** — web_search 토글·agent/chat 모드만, @멘션·tool-router 미배선                  |
| 임베딩 provider(전 RAG 공통)   | **dev-stub 전용** — 실 Voyage 미구현                                                    |

주요 파일(절대경로): `/Users/iremain/Documents/claudecode/W-Chat/apps/server/src/tools/assemble-builtin-tools.ts`, `.../app.ts`, `.../routes/messages.ts`, `.../routes/uploads.ts`, `.../db/ephemeral-chunk-search.ts`, `.../tools/handlers/{deep-research,web-search,code-interpreter,knowledge-search}-handler.ts`, `.../mcp/{mcp-client-pool,mcp-bridge,url-validator}.ts`, `.../orchestrator/orchestrator.ts`, `.../tools/hitl-manager.ts`, `.../tools/tool-router.ts`.

### WChat 인벤토리 [admin]

Inventory complete. Below is the consolidated finding set.

---

# WChat Admin (관리자) 구현 인벤토리 — P19 기준

전 항목 서버 라우트는 `apps/server/src/app.ts`(createApp)에 마운트 확인됨: `/api/v1/admin`(dashboard/users/tool-metrics/health, settings, models, groups), `/api/v1/config`, `/api/v1/api-keys`. 인증 미들웨어 `adminApp.use("*", authMiddleware)` + 각 라우트 `isAdmin(role)` 게이트(admin|owner)로 이중 보호. orgId 는 전부 auth(JWT/Bearer)에서만 파생 → cross-org 불가.

## 1. 설정 7탭 (`/admin/settings`)

화면: `apps/web/src/components/admin/settings/AdminSettingsScreen.tsx` — 탭 순서 models / rag / web-search / connectors / branding / permissions / quota. 공통 draft→dirty 감지→검증(`validateFields`)→PUT `/api/v1/admin/settings`→낙관적 롤백/토스트. 서버: `apps/server/src/routes/admin-settings.ts`(GET/PUT), 스키마 단일 출처 `apps/server/src/lib/org-settings-schema.ts`(LOCAL Zod, `OrgSettingsSchema` + `DEFAULT_ORG_SETTINGS` fail-soft). 훅 `apps/web/src/hooks/useAdminSettings.ts`.

| 기능(탭·필드)                                                                                                                        | 상태                         | 근거                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Models & Generation: maxTokens/temperature/topP/defaultModel(select)/systemPrompt/toolMaxTokens                                      | 구현완료(저장·검증)          | `ModelsGenerationTab.tsx`, 스키마 L26-31. **단, topP 는 저장/UI 만이고 런타임 미배선(ISOLATE)** — `org-settings-schema.ts:28` 명시 |
| Knowledge/RAG: ragTopK/ragRrfK/ragChunkSizeTokens/ragChunkOverlapTokens/ragHybridEnabled/ragRelevanceThreshold                       | 구현완료(저장·검증 UI)       | `KnowledgeRagTab.tsx`, 스키마 L34-39. 런타임 소비 여부는 본 인벤토리 범위 밖(미검증)                                               |
| Web Search: webSearchEnabled/webSearchResultCount/**webSearchProvider(select dev-stub·tavily)**/webSearchEndpoint/webSearchApiKeyRef | 구현완료                     | `WebSearchTab.tsx`, 스키마 L42-49                                                                                                  |
| Connectors/MCP: enableDirectConnections                                                                                              | 구현완료(토글)               | `ConnectorsTab.tsx` L23-33                                                                                                         |
| Connectors: allowedTools                                                                                                             | **읽기전용(설계상 격리)**    | `ConnectorsTab.tsx` L60-62 "이 화면에서는 읽기 전용" — organizations 컬럼이라 미편집                                               |
| Branding: instanceName / banner / responseWatermark                                                                                  | 구현완료(저장)               | `BrandingTab.tsx`                                                                                                                  |
| Permissions: defaultUserRole(select)/enableSignup                                                                                    | 구현완료 + **런타임 배선됨** | `PermissionsTab.tsx`; auth `/signup` 반영(P15-T1-01) — 스키마 L67-69                                                               |
| Quota: maxUploadSizeMb/maxUploadCount                                                                                                | 구현완료(저장·검증)          | `QuotaTab.tsx` L26-64                                                                                                              |
| Quota: defaultTokenBudgetMicros                                                                                                      | **읽기전용(설계상 격리)**    | `QuotaTab.tsx` L66-84 — organizations 컬럼                                                                                         |

## 2. allowedModels 편집 (읽기전용→편집)

- 상태: **읽기전용→편집 전환 완료** (P19-T6-14/T1-09, passes=true).
- 근거: `ModelsGenerationTab.tsx` L193-264 — 칩 목록 + 텍스트 입력(Enter/추가) + 제거(×) + "허용 모델 저장" 버튼. `admin-settings` 표와 별도로 자체 엔드포인트 PUT `/api/v1/admin/models`(`routes/admin-models.ts`, `AllowedModelsSchema`)를 직접 호출, 실패 시 롤백. 서버는 기존 `organizations.allowed_models` 컬럼 재사용(신규 테이블 없음).

## 3. 배너 typed + 실표시

- 스키마 typed: **완료** — `org-settings-schema.ts` `BannerSchema`(type[info|success|warning|error]/title/content/dismissible), 구버전 평문 문자열은 safeParse 단계에서 typed 배너 1건으로 폴백 변환(L8-22, 56-64).
- 사용자화면 실표시: **완료** (P19-T6-15) — `apps/web/src/components/layout/Banner.tsx` type별 시맨틱 토큰 스타일 + dismissible 시 닫기(X) + sessionStorage 로 닫힘 기억(`AppShell.tsx` L219-222). 서버 `routes/config.ts` L38 이 `settings.banner` 를 GET `/api/v1/config` 로 노출 → `useAppConfig` 소비. "저장돼도 안 뜨던" gap 해소.
- **부분 갭**: **admin 편집 UI(BrandingTab)는 배너를 단일 평문 문자열 input 으로만 편집**한다(`BrandingTab.tsx` L42-51, `useAdminSettings.ts:29` `banner: string`). type/title/dismissible/다중 배너를 관리자가 UI 에서 저작 불가 — 스키마가 평문을 단일 info·dismissible 배너로만 변환. 즉 typed 표시·저장 파이프라인은 완비됐으나 **관리자 저작 UI 는 평문 1건 수준**.

## 4. LLM 제목/태그 생성

- 상태: **구현완료 + 배선됨** (P19-T2-06, passes=true).
- 근거: `apps/server/src/orchestrator/session-title-tags.ts` — 첫 턴 완료 후 LLM `provider.chat` 로 제목(40자)+태그(1~3개) JSON 생성, 파싱/throw 실패 시 `deriveSessionTitle` + 결정적 파생 태그로 fail-soft 폴백(L5). 소비: `routes/messages.ts` L592-611(첫 턴·비취소 시 `generateSessionTitleAndTags` 호출 → 제목 update + `deps.tags.add` 로 session_tags 반영). 포트 주입: `app.ts` L190-211 `sessionTagDa`. 태그 데이터는 migration 0020 session_tags.

## 5. API 키 발급/폐기 + Bearer 인증

- 상태: **구현완료(발급/목록/폐기 + Bearer 소비)** (P19-T1-11/T6-16, passes=true).
- 서버 라우트: `routes/api-keys.ts` — POST(발급, 평문 `key` 를 응답에서 1회만 노출), GET(목록, keyPrefix 마스킹만), DELETE `/:id`(폐기). self-service(owner=auth.sub 범위). migration 0025 api_keys.
- Bearer 인증 소비: `middleware/auth-middleware.ts` L61-89 — **쿠키 JWT 없을 때만** `Authorization: Bearer <key>` 확인, `findActiveByRawKey`→auth payload 합성(org/role/sub) + `touchLastUsed`(실패 fail-soft). 기존 쿠키 라우트는 DB 조회 없이 그대로(L2).
- UI: `apps/web/src/components/settings/ApiKeysManager.tsx`(설정 화면, `/settings/api-keys` page 존재) — 발급 모달 + 평문 1회 노출 경고·복사 배너 + 카드 목록(마스킹·마지막사용) + 폐기. lib `apps/web/src/lib/apiKeys.ts`. (참고: 관리자 전용이 아니라 사용자 설정 영역 배치.)

## 6. 웹검색 provider (설정→런타임)

- 상태: **구현완료(설정+UI+런타임 동적 소비)** (P19-T1-12/T6-17, passes=true).
- 설정/UI: 위 §1 web-search 탭. 런타임: `tools/handlers/web-search-handler.ts` L28-85 — invoke 시점 `ctx.orgId` 로 `settings.resolve` → `resolveProvider({provider,endpoint,apiKeyRef})` 로 실 WebSearchPort 구성, provider≠tavily 또는 apiKeyRef 미인식/미설정이면 `deps.port`(dev-stub) 폴백(L2, throw 금지). 조립: `tools/assemble-builtin-tools.ts` L42-73 `buildWebSearchProviderResolver` — `apiKeyRef==="TAVILY_API_KEY"` 이고 서버 env `TAVILY_API_KEY` 존재 시에만 `createTavilyWebSearchProvider`(임의 secret 조회 거부, 보안). 실 provider `tools/web-search-provider-tavily.ts`(native fetch REST, 신규 의존성 0).

## 7. 대시보드 / 툴 메트릭 / 사용자 관리 / 그룹(RBAC)

| 기능                                          | 상태                | 근거                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 대시보드(`/admin`)                            | 구현완료            | `AdminDashboard.tsx` — 사용자/세션/24h오류 카드 3개 + 도구 요약 스트립(24h호출·에러율·p50). 서버 `admin.ts` GET `/dashboard`→`adminDa.dashboardSummary(org)`                                                                                                                                                                                                        |
| 툴 메트릭(`/admin/tool-metrics`)              | 구현완료            | `ToolMetricsTable.tsx` — 도구/호출/오류율(3%↑ accent 강조)/p50·p95·p99 고밀도 테이블. 서버 `admin.ts` GET `/tool-metrics`(from/to·기본 7일)→`toolMetricsSummary`                                                                                                                                                                                                    |
| 사용자 관리(`/admin/users`)                   | 구현완료            | `AdminUsersManager.tsx` — role select 변경 / 상태 배지 / suspend·unsuspend(reason=window.prompt). 서버 `admin.ts` GET `/users`(search·status·limit), PATCH `/users/:id`, POST `/users/:id/{suspend,unsuspend}`                                                                                                                                                      |
| 그룹 CRUD + 멤버(`/admin/groups`)             | 구현완료            | `GroupsManager.tsx`(생성/이름변경/삭제 + userId 멤버 추가·제거). 서버 `routes/admin-groups.ts`(GET/POST/PUT/DELETE + `/:id/members` POST·DELETE), migration 0026 groups/group_members. 훅 `useGroups.ts`                                                                                                                                                            |
| 리소스별 권한 부여 토글(RBAC resource_grants) | **미배선/범위축소** | 코어만 존재: `db/resource-grants-data-access.ts` + migration 0027(canAccessResource 판정). **admin HTTP CRUD 라우트(목록/부여/철회) 없음** — `routes/` 에 resource_grants 라우트 미존재. `GroupsManager.tsx` L6-10 주석이 명시적으로 이번 반복 descoped(그룹 전체 권한 나열 조회 API·관리 라우트 부재로 T6 파일소유권만으론 완성 불가, 후속 T1 라우트 후 배선 예정) |
| 네비게이션                                    | 구현완료            | `AdminSubNav.tsx` — 대시보드/사용자 관리/그룹 관리/도구 지표/설정                                                                                                                                                                                                                                                                                                   |

## 요약: 상태 분류

- **완전 구현·배선**: 설정 7탭 저장 파이프라인, allowedModels 편집, 배너 typed 스키마+사용자 실표시, LLM 제목/태그 생성, API 키 발급/폐기+Bearer 인증, 웹검색 provider 런타임 소비, 대시보드/툴메트릭/사용자관리/그룹 CRUD. (feature_list.json P19 admin 관련 태스크 전부 passes=true·attempts=1)
- **부분 갭(주의)**: (1) 관리자 배너 저작 UI 가 평문 단일 input 뿐 — typed(type/title/dismissible/다중) 저작 불가; (2) topP 저장·UI 만, 런타임 미배선(ISOLATE 명시).
- **설계상 읽기전용(격리)**: allowedTools(Connectors), defaultTokenBudgetMicros(Quota) — organizations 컬럼이라 미편집.
- **미배선/후속**: resource_grants(리소스별 접근 부여) 관리 HTTP 라우트·UI 부재(코어 판정 로직만 존재).

### WChat 인벤토리 [auth-rbac]

# WChat 인증/RBAC/권한/API키 구현 인벤토리

각 항목: **기능명 — 상태 — 근거(파일:라인)**

---

## 1. 인증 (Authentication)

**Magic-link + JWT 쿠키 — 실배선/완성 (end-to-end)** — `routes/auth.ts`(`createAuthRoutes`)가 `app.ts:145` 에서 `/api/v1/auth` 로 마운트. `POST /signup`, `POST /magic-link`, `GET /magic-link/verify`, `GET/PATCH /me`, `POST /logout`, `POST /refresh` 제공. 쿠키명 `{PROJECT_SLUG}_at`(access)·`{...}_rt`(refresh), `httpOnly`, `secure`=prod, `SameSite=Lax`(auth.ts:136-149). Access TTL 15분, refresh 30일(auth.ts:65-66). 토큰은 `randomBytes(32)` → `sha256` 해시만 DB 저장, magic-link enumeration 방지(입력오류 아니면 항상 `{sent:true}`, auth.ts:229).

**Refresh 토큰 rotation + 도난 탐지 — 실배선** — `refresh_token_families`(migration 0013) 기반. 이전 generation jti 재사용 시 `revoke(family, "theft_suspected")` + 쿠키 삭제 + `REFRESH_TOKEN_REUSED` 401(auth.ts:511-527). 정상 refresh 는 `rotate` 로 jti 교체.

**dev-login — 실배선, dev/test 전용** — `GET /api/v1/auth/dev-login`(auth.ts:308). `devLogin = (NODE_ENV !== "production")` 이라 prod 는 404(app.ts:151). fresh DB 에서 allowed-domain org 없으면 org + owner dev 유저를 즉석 생성(auth.ts:324-359). 주석에 "향후 SSO 로 교체될 로컬 테스트 편의 경로"로 명시.

**Bearer(API 키) 인증 — 실배선** — `middleware/auth-middleware.ts`. 쿠키 부재 시에만 `Authorization: Bearer <key>` 확인 → `findActiveByRawKey`(sha256 조회) → JWT 와 동등한 `AccessTokenPayload` 합성(role 은 `users` JOIN 으로 live 조회, auth-middleware.ts:65-79). 폐기/미존재 키는 401. `touchLastUsed` 는 fire-and-forget(실패해도 인증 흐름 미차단).

---

## 2. 역할 (Roles) — member / admin / owner

**org-level 3역할 — 실배선(admin 게이트만)** — 타입 단일 출처 `packages/interfaces/src/types.ts:120` (`User.role: "member"|"admin"|"owner"`). 별도로 `ProjectRole = owner|editor|viewer`(types.ts:87)는 프로젝트 멤버십용으로 분리 존재.

- **enforcement 방식**: 라우트별 `isAdmin(role) = role==="admin"||"owner"` self-check 로 403 반환 — `admin.ts`, `admin-models.ts`, `admin-settings.ts`, `admin-groups.ts`, `usage.ts:72` 에 반복 구현(공유 미들웨어 아님, 라우트 내부 인라인).
- 신규 유저 role 은 org 설정 `defaultUserRole`(기본 member)로 부여(auth.ts:287).
- **주의**: 쿠키 JWT 는 발급 시점 role 이 박제됨(refresh 전까지 role 변경 미반영). API 키 경로는 매 요청 `users` JOIN 으로 role live 조회 → 불일치.

---

## 3. 그룹 (groups / group_members)

**그룹 CRUD + 멤버 관리 — 실배선/완성 (end-to-end)** —

- **DB**: migration `0026_groups.sql` — `groups(org_id,name)` + `group_members(group_id,user_id 복합PK, org_id denormalized)`, 둘 다 `RLS ENABLE + FORCE`(select=org_id 일치, modify=org_id 일치 **AND** `current_user_is_admin()`).
- **DA**: `db/group-data-access.ts` — list/create/rename/remove/addMember/removeMember. `addMember` 는 group·user 둘 다 org 일치해야 INSERT 되는 서브쿼리로 cross-org 멤버추가 자체 차단(group-data-access.ts:82-92).
- **라우트**: `routes/admin-groups.ts` — `GET/POST /`, `PUT/DELETE /:id`, `POST /:id/members`, `DELETE /:id/members/:userId`. `app.ts:432` `adminApp.route("/groups", ...)` 로 `/api/v1/admin/groups` 마운트, 전 핸들러 `isAdmin` 403 self-check, orgId 는 `auth.org`(JWT)에서만 파생.
- **프론트**: `apps/web/src/components/admin/GroupsManager.tsx`(카드형 CRUD + 멤버 칩) + `hooks/useGroups.ts` + `app/(app)/admin/groups/page.tsx` 라우트 + AdminSubNav "그룹 관리" 링크 (PROGRESS P19-T6-18).

---

## 4. 세분화 권한 / 리소스 접근제어 (resource_grants, canAccessResource, additive union)

**리소스 접근제어 — 인프라만(NOT 실배선). 라우트 enforcement·grant 생성 경로·UI 전부 부재** — 이것이 이 인벤토리의 핵심 gap.

구현되어 있는 것(인프라):

- **DB**: migration `0027_resource_grants.sql` — `resource_grants(org_id, resource_type[model|knowledge|tool|prompt], resource_id, subject_type[user|group], subject_id, access[read|write])`, UNIQUE 복합키, `RLS ENABLE+FORCE`(modify=admin only). subject_id 다형이라 FK 미부여.
- **DA**: `db/resource-grants-data-access.ts` — `grant` / `grantsForResource` / `groupIdsForUser`.
- **판정 로직**: `lib/access-control.ts` `canAccessResource` — additive union(direct user grant **또는** 소속 group grant 중 **하나라도** 요청 access 만족 시 true, access.ts:28-33). 로직 자체는 정확.
- **테스트**: `__tests__/integration/access-control-composition.test.ts`(실 Postgres 4 tests) — additive union·read-only·direct-grant·cross-org 격리 검증.

**배선되지 않은 것 (결정적)**:

- `canAccessResource` 호출처는 **오직 위 통합 테스트뿐** — 어떤 route 도 import/호출 안 함(`grep -rn canAccessResource src --exclude __tests__` → 정의부만).
- `.grant(` / `grantsForResource` 를 호출하는 **HTTP 라우트가 없음** — grant 를 생성/조회/회수할 API 자체가 존재하지 않음(테스트에서만 `grants.grant(...)` 직접 호출).
- models/knowledge/tool/prompt 어느 조회 라우트도 grant 로 필터링하지 않음.
- **프론트 UI 없음** — `GroupsManager.tsx:6-9` 주석이 "리소스별 접근 부여 토글은 범위 축소, 후속 T1 라우트 필요"라 명시.

**T1-14 가 범위를 축소했는가 → 예 (부분 축소, ISOLATE 아님)** — `PROGRESS.md:238` 명시적 기록:

> "★스코프 조정(ISOLATE 아님, 부분 축소): 태스크 desc 의 '관련 조회 라우트 enforcement(비허용 리소스 미노출)' 는 이번 반복에서 구현하지 않음 … access-control 코어(migration+lib+실Postgres 통합테스트)만 완성. models/knowledge/tool/prompt 각 조회 라우트에 canAccessResource 를 실제로 배선하는 것은 … 후속 태스크로 남겨둠."

→ **결론: resource_grants 기반 세분화 RBAC 는 "데이터모델 + 순수판정 helper + 테스트"까지만 존재하는 인프라이며, 런타임 enforcement·grant 생성 경로·관리 UI 모두 미배선.** 현재 실제로 동작하는 경로가 하나도 없음(dead-path pending follow-up).

**실제로 오늘 강제되는 리소스 게이트(대체)** — org-wide 모델 화이트리스트뿐. `organizations.allowed_models` 컬럼 → `config.ts:30-31` 이 availableModels 필터, model-router `selectModel` 검증, `admin-models.ts` 가 편집. 이는 **org 단위**이지 per-user/per-group resource_grants 가 아님.

---

## 5. cross-org 격리 (RLS)

**RLS 정책 — 정의는 전 테이블에 존재하나, 런타임에서 사실상 미활성 / 실 격리는 app-level org 필터** —

- RLS 정책은 foundation(`0001_identity.sql`: `current_user_is_admin()` 함수 정의 포함) + `0015_project_team_scope_rls.sql` + 신규 0025/0026/0027 전부 `ENABLE+FORCE`, `org_id = NULLIF(current_setting('app.org_id',true),'')::uuid` 기반.
- **그러나 요청 시점에 GUC(`app.org_id`/`app.user_id`)를 세팅하는 코드 경로가 런타임 CRUD 라우트에 없음** — `set_config` 는 `auth-data-access.ts:410` `withRlsContext` 내부에만 존재하고, `grep '.withRlsContext('` 결과 **런타임 호출처 0건**(테스트/타입참조만). dev/test `DATABASE_URL` role 은 superuser 라 RLS 를 **우회**.
- 따라서 실제 cross-org 격리는 **모든 DA 쿼리의 `WHERE org_id = $` (application-level "이중 방어")** 가 담당. orgId 는 항상 `auth.org`(JWT)에서만 파생 — body/query 로 org 지정 불가(admin-groups.ts:2 등 컨벤션 주석). API 키/그룹 composition 테스트에 cross-org 격리 케이스 포함(PROGRESS T1-11/T1-13).
- **정리**: RLS 는 "prod 에서 비-superuser role + GUC 설정 미들웨어 도입 시" 활성화될 latent defense-in-depth. 현 런타임 격리의 실효 방어선은 app-level org 필터.

---

## 6. OAuth / LDAP / SCIM / SSO / SAML

**전부 부재 (미구현)** — `grep -riE 'oauth|saml|ldap|scim|openid|sso|okta|entra'` 결과, 구현 0건. 유일한 매치는 **주석뿐**: auth.ts:58/307·app.ts:150·login/page.tsx:38 이 모두 "SSO 도입 전까지의 로컬 편의(dev-login)"라고 서술. 외부 IdP·소셜로그인·디렉토리 동기화 provider 없음.

---

## 7. 도메인 게이트 (ALLOWED_DOMAINS)

**실배선** — `env.ts:11` `ALLOWED_DOMAINS`(필수 string) → `app.ts:147` comma-split → auth 라우트 주입. `signup` 이 비허용 도메인 `EMAIL_DOMAIN_FORBIDDEN` 403(auth.ts:175). org 는 **오직 이메일 도메인**으로 결정(`findOrgByDomain`, body 지정 불가). magic-link 도 도메인 확인(auth.ts:232). 그 위에 org-level `enableSignup` 게이트(org settings) 2단 적용 — 비활성 org 는 허용 도메인이라도 `SIGNUP_DISABLED` 403(auth.ts:195).

---

## 8. API 키

**발급/폐기 + Bearer 소비 — 실배선/완성 (백엔드 end-to-end)** —

- **DB**: migration `0025_api_keys.sql` — `key_hash`(sha256 hex, UNIQUE) 만 저장(평문 미저장), `key_prefix`(마스킹 표시용), `scopes TEXT[]`, `last_used_at`, `revoked_at`. RLS ENABLE+FORCE(org 방어선).
- **DA**: `db/api-key-data-access.ts` — `generateApiKey`(`wchat_sk_<base64url>`, prefix 14자), create/listForOwner/revokeForOwner/findActiveByRawKey/touchLastUsed. self-service 격리는 app-level `WHERE user_id=$`(superuser RLS 우회 대비 이중방어).
- **라우트**: `routes/api-keys.ts` — `POST /`(평문 rawKey 는 생성 응답 1회만 노출), `GET /`(keyPrefix 마스킹 목록), `DELETE /:id`(owner 아니면 404). `app.ts:434-436` `/api/v1/api-keys` 마운트.
- **주의 — scope 미강제**: `scopes` 는 발급 시 저장·응답에 포함되나, `auth-middleware.ts` Bearer 경로는 scope 를 전혀 검사하지 않고 **해당 유저와 동등한 전권**을 부여(auth-middleware.ts:70-79). scope 는 현재 순수 메타데이터.
- **UI**: PROGRESS T1-11 이 "apiKeys UI(P19-T6-16)는 별도 후속 태스크"로 명시 — `apps/web/src/components/admin/` 에 API 키 관리 컴포넌트 없음(백엔드만 완성).

---

## 요약 매트릭스 (enforcement 관점)

| 기능                                                  | 실배선(런타임 enforce)                | 인프라만                                                                                           |
| ----------------------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Magic-link + JWT 쿠키, refresh rotation/도난탐지      | ✅                                    |                                                                                                    |
| dev-login (dev/test 전용)                             | ✅                                    |                                                                                                    |
| Bearer API 키 인증                                    | ✅ (단 scope 미강제)                  |                                                                                                    |
| member/admin/owner — admin 게이트(isAdmin 403)        | ✅                                    |                                                                                                    |
| 그룹 CRUD/멤버(groups·group_members)                  | ✅ (BE+FE)                            |                                                                                                    |
| **resource_grants / canAccessResource (세분화 RBAC)** | ❌ **미배선**                         | ✅ (migration+lib+test only; grant 생성 route·조회 필터·UI 전부 부재. T1-14/T6-18 명시적 범위축소) |
| org 모델 화이트리스트(allowed_models)                 | ✅ (단 org 단위, per-user/group 아님) |                                                                                                    |
| cross-org 격리                                        | ✅ app-level `WHERE org_id`           | RLS 정책은 정의됐으나 런타임 GUC 미설정+superuser 우회로 사실상 latent                             |
| 도메인 게이트(ALLOWED_DOMAINS) + enableSignup         | ✅                                    |                                                                                                    |
| OAuth/LDAP/SCIM/SSO/SAML                              | ❌ 전무 (주석상 "SSO 예정"뿐)         | ❌                                                                                                 |

**핵심 gap 한 줄**: RBAC 세분화 권한(resource_grants)은 데이터모델·`canAccessResource` 순수로직·통합테스트까지만 존재하는 **인프라이며, 어떤 라우트도 이를 호출하지 않고 grant 를 만들 API·UI 조차 없어 현재 실효 enforcement 가 0** — T1-14(라우트 enforcement)·T6-18(관리 UI) 모두 명시적으로 후속 태스크로 범위 축소됨. 실제 권한 강제는 (1) org 단위 `allowed_models` 화이트리스트, (2) admin/owner `isAdmin` 403 게이트, (3) app-level `WHERE org_id`(+ 일부 `user_id`) 격리, 3가지뿐.

---

## 부록 B. Open WebUI 카탈로그 (출처 URL 포함, 3도메인)

### Open WebUI 카탈로그 [owui-chat]

# Open WebUI — 채팅 + 워크스페이스 사용자 기능 전수 조사

docs 리포지토리(raw markdown) + README + WebSearch 기반. 각 기능은 "**기능명** — 설명" 형식, 카테고리별 그룹.

---

## 1. 멀티모델 채팅 & 모델 전환

- **Multi-Model Chat** — 하나의 채팅 안에서 여러 모델을 동시에 붙여 같은 프롬프트를 병렬로 질의. 헤더의 `+` 버튼으로 모델 추가.
- **Parallel Response Display** — 여러 모델 응답을 나란히/스택 형태로 표시해 side-by-side 비교·벤치마킹.
- **Model Switching / Selector** — 채팅 중 모델 셀렉터로 언제든 모델 교체, 응답별로 다른 모델 사용 가능.
- **Merge / Mixture-of-Agents (MOA) Synthesizer** — 활성 모델들의 출력을 지정한 Synthesizer Model에 보내 하나의 정제된 응답으로 합성.
- **Cross-Model Fact Validation** — 모델 간 응답 불일치를 교차 검증해 사실 확인.
- **Reasoning / Thinking Model 표시** — `<think>` 등 사고 태그를 자동 감지해 접이식 "Thinking" 블록으로 렌더, 커스텀 `reasoning_tags`·reasoning effort(low/med/high) 지원, 사고 내용은 히스토리에 보존·재전송.
- **Direct Connections** — 사용자가 자기 OpenAI-호환 엔드포인트(Base URL+API Key)를 개인 설정에 추가, 키는 브라우저에 저장하고 백엔드 우회하여 직접 추론.

## 2. 채팅 조직화 (폴더/프로젝트/태그/핀/아카이브/임시)

- **Folders / Project Workspaces** — 채팅을 폴더로 묶어 프로젝트 워크스페이스화. 폴더별 시스템 프롬프트·지식베이스 연결로 RAG 상속.
- **Nested Folders** — 하위 폴더 계층 구조, 확장/축소 가능.
- **Folder System Prompt & Knowledge** — 폴더 내 생성된 모든 채팅에 자동 적용되는 시스템 프롬프트·지식 첨부.
- **Active Workspace Selection** — 폴더를 클릭하면 활성화되어 새 채팅이 그 안에 생성·설정 상속.
- **Drag & Drop / Right-click 이동** — 사이드바에서 채팅을 폴더 간 드래그, 우클릭 컨텍스트 메뉴로 이동/관리.
- **Folder Sharing** — 폴더를 특정 사용자/그룹과 read/write 권한으로 공유, 하위 폴더 권한 상속.
- **Folder Background Customization** — 폴더별 배경 이미지 업로드로 시각적 구분.
- **Tags** — 채팅에 태그 라벨링, 폴더 경계 넘어 키워드 필터·검색.
- **Pin** — 자주 쓰는 채팅을 상단 고정.
- **Archive / Bulk Archive** — 채팅을 아카이브로 이동해 사이드바 정리(검색·복원 가능), 전체 일괄 아카이브도 지원.
- **Temporary Chat** — 히스토리를 저장하지 않는 일회성 세션(`temporary-chat=true`).
- **Unread Indicators** — 백그라운드에서 새 활동이 생긴 채팅에 미확인 표시.
- **Custom / Auto Title** — 자동 생성된 제목을 연필 아이콘으로 수정, task 모델이 제목 자동 생성.

## 3. 히스토리 / 검색 / 필터

- **Persistent History** — 채팅이 `webui.db`에 저장되어 모든 기기에서 접근, Today/Yesterday/Previous 7 Days 등 시간대별 자동 그룹.
- **Global Search (Cmd/Ctrl+K)** — 제목·본문·태그를 아우르는 퍼지 검색 바.
- **Prefix Filters** — `tag:` `folder:` `pinned:` `archived:` `shared:` 접두어로 범위 좁히기, 조합 가능.
- **Result Snippets** — 검색 결과에 매칭 메시지 발췌 표시.
- **Agentic Chat Search** — 모델이 `search_chats`·`view_chat` 네이티브 툴로 과거 대화를 자율 검색·불러오기.

## 4. 공유 / 내보내기 / 가져오기 / 브랜칭

- **Share Link (Snapshot)** — 채팅의 특정 시점 스냅샷 공유 링크 생성(불변).
- **Community Platform 공유** — openwebui.com에 Private/Public/Public+Full History 접근 수준으로 업로드.
- **Update / Delete Share Link** — 공유 스냅샷 갱신 또는 링크 무효화, RBAC 접근 제어.
- **Shared Chats Dashboard** — 공유한 모든 채팅을 한 곳에서 관리(검색·정렬·링크 복사·공유 해제·페이지네이션).
- **Export (JSON/PDF/Markdown)** — 개별/전체 채팅을 JSON·PDF·Markdown으로 다운로드.
- **Import (JSON / ChatGPT / Custom)** — Open WebUI JSON, ChatGPT 내보내기(자동 감지·변환), 커스텀 JSON 가져오기(비파괴적 추가).
- **Message Branching (Tree Structure)** — parent-child 메시지 트리로 대안 대화 경로 분기·전환 지원.

## 5. 메시지 액션 & 편집

- **Copy** — 메시지 내용을 클립보드로 복사.
- **Edit** — 사용자 메시지 편집(재전송) 및 어시스턴트 응답 편집.
- **Regenerate** — 동일 프롬프트로 응답 재생성(형제 메시지 생성).
- **Continue Response** — 잘린 응답을 이어서 계속 생성.
- **Delete** — 개별 메시지/채팅 삭제.
- **Rating / Feedback** — 응답에 thumbs up/down, 세밀한 1~10 평점(파인튜닝·평가용), 형제 메시지 자동 다운보트.
- **Read Aloud (TTS)** — 응답을 음성으로 낭독.
- **Generate Image (message action)** — LLM 응답에서 이미지 생성 버튼(커뮤니티 액션).
- **Info** — 토큰 수·응답 시간 등 생성 메타 표시.
- **Structured Response Editing** — 툴 콜·reasoning 블록·코드 출력이 포함된 응답을 접이식 필드/JSON 접근으로 편집.
- **Action Buttons (Custom)** — Action Function으로 요약·내보내기 등 커스텀 클릭 버튼을 메시지 툴바에 추가.

## 6. 메시지 큐 / 태스크 / 후속질문 / 자동완성

- **Message Queue** — 응답 생성 중 메시지를 큐에 쌓아 두고 완료 시 합쳐 전송, Send Now(즉시 전송)·편집·삭제, 세션 저장. 기본 활성(즉시 인터럽트 모드로 전환 가능).
- **Task / Todo Management** — 에이전트 모델이 `create_tasks`·`update_task`로 다단계 체크리스트를 채팅 내 실시간 진행률과 함께 관리.
- **Follow-Up Prompts** — 응답 후 문맥 기반 후속 질문 자동 제안, 히스토리 유지·클릭 시 입력/즉시전송·재생성 옵션.
- **Autocomplete** — 입력 중 실시간 고스트 텍스트 자동완성(Tab/→로 수락), task 모델 구동, 전역/개인 토글.
- **Title Generation** — 대화 기반 채팅 제목 자동 생성(task 모델).
- **Temporal Awareness** — `{{CURRENT_DATE/TIME/WEEKDAY}}` 주입 및 `get_current_timestamp`·`calculate_timestamp` 툴로 시간 추론·상대 시간 계산.

## 7. RAG & 지식 (in chat)

- **`#` Document Loading** — 업로드한 문서를 `#`로 참조해 대화 컨텍스트에 주입.
- **`#url` Web Page** — `#` + URL로 웹페이지를 문서로 로드/워크스페이스에 통합.
- **YouTube Transcript RAG** — 유튜브 URL로 영상 자막을 불러와 요약·질의.
- **Knowledge Base Collections** — 재사용 지식베이스를 모델/대화에 연결해 일관된 검색.
- **Citations / References** — LLM에 투입된 문서 출처를 인용으로 추적·표시.
- **Hybrid Search (BM25 + Vector)** — 키워드+시맨틱 결합, CrossEncoder 리랭킹, relevance threshold 설정.
- **Reranking** — 검색 청크를 리랭킹해 관련도 상위만 사용.
- **Full Context Mode ("Using Entire Document")** — 청킹/검색 없이 문서 전문을 그대로 주입.
- **Multi-Format Parsing / Document Extraction** — PDF·DOCX 등 다양한 포맷 파싱(Apache Tika·Docling·Mistral OCR 엔진 선택).
- **Google Drive Integration** — 드라이브 문서·슬라이드·시트를 채팅에 직접 업로드.
- **File Upload / Drag-Drop / File Manager** — 채팅에 파일 드래그·업로드, 파일 메타데이터 표시, 중앙 파일 매니저·삭제 시 임베딩 딥클린업.

## 8. 웹검색 (in chat)

- **Live Web Search Toggle** — 채팅별로 웹검색 켜기, 라이브 웹을 검색·페이지 fetch해 근거 기반 답변.
- **20+ Providers** — SearXNG·Brave·Google PSE·Tavily·Bing·DuckDuckGo·Exa·Perplexity·Firecrawl 등 다수 공급자 선택.
- **Web Search Citations** — 검색 출처 인용, 결과를 지식으로 저장(Save to Knowledge).
- **Search Confirmation** — 외부 질의 전 사용자 승인 요구(관리자 설정).
- **Agentic Web Search** — 모델이 검색 필요 여부를 스스로 판단, `fetch_url`로 전체 페이지(최대 50k자) 조회·링크 자율 추적, thinking↔action 반복으로 다출처 종합·사실 검증·질의 정제.

## 9. 코드 실행 & 렌더링

- **Code Interpreter (execute_code)** — 모델이 응답 중 파이썬 코드를 자율 작성·실행.
- **Python via Pyodide** — 브라우저 WebAssembly 샌드박스 실행(numpy·pandas·matplotlib 등).
- **Jupyter Server Execution** — 패키지 설치 가능한 완전 파이썬 환경 연결.
- **Open Terminal / Terminals** — 원격 셸 실행 API(전체 OS 접근), 엔터프라이즈용 멀티테넌트 컨테이너 오케스트레이터.
- **Markdown & LaTeX 렌더링** — 종합 마크다운 서식과 LaTeX 수식 렌더.
- **Mermaid 렌더링** — MermaidJS 문법을 플로차트·다이어그램으로 시각화.
- **Artifacts (HTML/CSS/JS·SVG)** — 인터랙티브 웹페이지·애니메이션 SVG·ThreeJS/D3 시각화를 별도 프리뷰 패널에 렌더, 샌드박스 iframe·버전 추적·실시간 편집·전체화면.
- **Writing / Content Blocks** — 콜론-펜스 블록을 스타일된 컨테이너로 렌더.

## 10. 이미지 생성 & 편집

- **Native Tool Image Generation** — Native Function Calling 모델이 이미지 생성을 툴로 직접 호출.
- **Direct Image Prompt** — Image Generation 토글 후 프롬프트를 바로 이미지로 생성(LLM 응답 불필요).
- **Image Editing / Inpainting** — 이미지+텍스트 프롬프트로 배경 변경·요소 추가 등 편집.
- **Image Compositing** — 여러 이미지를 일관된 조명·스타일의 한 장면으로 합성.
- **Backends** — DALL·E(OpenAI)·Gemini·ComfyUI·AUTOMATIC1111 등 백엔드 지원.

## 11. 음성 / 영상 (Call / STT / TTS)

- **Hands-Free Voice Mode** — 음소거 토글이 있는 핸즈프리 음성 대화 시작.
- **Video / Call Overlay** — `call=true`로 실시간 전사가 있는 통화/영상 오버레이 실행.
- **Speech-to-Text 받아쓰기** — 마이크 음성으로 메시지 입력(OpenAI STT·Voxtral 등 엔진 선택).
- **Text-to-Speech Read Aloud** — 응답을 음성으로 재생(Kokoro·OpenAI TTS·Edge TTS 등 다중 엔진/보이스).
- **Per-Model TTS Voice** — 모델 페르소나별 고유 TTS 보이스 지정.

## 12. 프롬프트 라이브러리

- **Prompt Presets** — 재사용 프롬프트 템플릿 저장.
- **Slash Command (`/`)** — `/command`로 저장된 프롬프트를 채팅에 삽입.
- **Input Variables (Forms)** — text·dropdown·date·number·checkbox 등 타입 필드 팝업 폼으로 비기술 사용자도 실행.
- **System Variables** — `{{CURRENT_DATE}}`·`{{USER_NAME}}`·`{{CLIPBOARD}}` 등 런타임 자동 치환.
- **Version History & Rollback** — 변경마다 버전 생성·비교·복원.
- **Access Control / Tags / Toggle** — 사용자·그룹·공개 공유, 태그 분류, 삭제 없이 활성/비활성 토글.

## 13. 메모리

- **Persistent Memory** — 사용자에 관한 사실·선호를 대화 간 지속 저장·회상.
- **Manual Management** — Settings > Personalization에서 메모리 수동 추가/편집/삭제.
- **Autonomous Memory Tools** — `add_memory`·`update_memory`·`delete_memory`·`search_memories`·`replace_memory_content`로 모델이 자율 관리.
- **Memory Organization / Type** — `work/projects` 경로 계층 및 `user`/`context` 타입 분류.
- **Automatic Background Review** — 대화를 주기적으로 검토해 컨텍스트 메모리 자동 갱신.

## 14. Tools & Function Calling (Functions)

- **Enable Tools Per Chat / Per Model** — 채팅 `+` 아이콘으로 툴 활성 또는 Workspace 모델 편집기에서 기본 툴 지정.
- **Native vs Legacy Function Calling** — 구조화 JSON 툴콜의 Native 모드(기본)와 프롬프트 주입 방식 Legacy 모드.
- **Builtin Tools Categories** — Memory·Knowledge·Web Search 등 시스템 툴 카테고리를 모델별 세분 토글.
- **MCP / OpenAPI Servers** — MCP(HTTP/SSE·stdio)·OpenAPI 서버를 호출 가능한 툴로 연결.
- **Import Community Tools** — openwebui.com에서 커뮤니티 툴(파이썬) 가져오기.
- **Tool Valves / UserValves** — 관리자·사용자별 툴/함수 설정(API 키·언어 등).
- **Functions — Pipe** — 사이드바에 나타나는 커스텀 모델/에이전트 추가.
- **Functions — Filter** — 모델 입출력을 가로채 번역·모더레이션·로깅(대화별 on/off 토글).
- **Functions — Action / Event** — 메시지 버튼 추가 및 시스템 이벤트 기반 백그라운드 로직.

## 15. Chat Controls & 파라미터

- **Chat Controls Sidebar** — 우측 사이드바에서 현재 대화의 시스템 프롬프트·고급 파라미터 조정.
- **3-Level System Prompt** — per-chat / per-account / per-model 계층으로 시스템 프롬프트 적용.
- **Advanced Parameters** — temperature·top-p·stop·context length 등 채팅·계정·모델 단위 설정(관리자 오버라이드 보존).
- **Skill Mentions (`$`)** — `$`로 스킬 피커를 열어 스킬 내용을 시스템 프롬프트에 즉시 주입.
- **URL Parameters** — `model`·`q`·`web-search`·`tools`·`code-interpreter`·`image-generation`·`youtube`·`load-url`·`call`·`temporary-chat` 등 쿼리로 세션 사전 구성.

## 16. 워크스페이스 (Models / Knowledge / Prompts / Skills / Tools)

- **Custom Models (Presets)** — 베이스 모델을 시스템 프롬프트·툴·지식·스킬·파라미터로 감싼 재사용 프리셋. 아바타(GIF/WebP)·프롬프트 서제스천 칩·동적 변수·import/export·접근제어·공개/비공개.
- **Knowledge Bases** — 문서 업로드 컬렉션 생성, 디렉토리 구조·로컬 폴더 증분 싱크(SHA-256 해시)·모델 연결·`#` 참조·하이브리드 검색·Full Context·에이전트 툴 접근(`query_knowledge_files`·`kb_exec`)·zip 내보내기.
- **Prompts** — (§12) 슬래시 커맨드 프롬프트 라이브러리.
- **Skills** — 모델에 붙이거나 `$`로 즉시 호출하는 마크다운 지시셋. 채팅별 토글·모델 바인딩·lazy loading(`view_skill`)·import/export·접근제어.
- **Tools** — (§14) 커스텀 파이썬 툴/외부 API·코드·웹 접근.

## 17. 노트 (Notes)

- **Rich Text / Markdown Editor** — 플로팅 서식 툴바(볼드·이탤릭·코드 등).
- **AI Enhance** — 선택 영역 또는 노트 전체를 AI로 재작성·개선.
- **Note Chat Sidebar** — 노트 내용을 두고 에디터 안에서 집중 AI 대화.
- **Attach Note to Chat (Context Injection)** — 노트를 채팅에 청킹 없이 전문 컨텍스트로 첨부.
- **Agentic Access** — 모델이 노트를 자율 검색·읽기·수정(장기 메모리화).
- **Voice Dictation** — 마이크로 음성 받아쓰기 작성.
- **Pin / Export / Import / Sharing** — 사이드바 고정, txt·md·pdf 내보내기(다크모드 감지), md 드래그 가져오기, 공유 링크·접근제어.

## 18. 채널 (Channels)

- **Real-Time Team Channels** — 사람+AI가 함께 쓰는 실시간 공유 공간, 스트리밍 응답.
- **@model Tagging** — 아무 AI 모델이나 대화에 소환(툴·RAG·필터·함수 풀 에이전트 기능).
- **Threaded Replies** — 인라인/스레드 곁가지 대화로 정리.
- **Emoji Reactions / Pinned Messages** — 메시지 이모지 반응·중요 메시지 고정.
- **@mentions / #channel linking** — 사람 멘션 알림, 채널 간 교차 참조 링크.
- **File Sharing** — 이미지·문서·코드 업로드 후 AI 분석.
- **Access Control / DM Status** — public·private·group·DM 권한, 온라인/오프라인 상태 표시.
- **AI Channel Search** — 모델이 채널 메시지를 자율 검색·종합.

## 19. 캘린더 & 자동화

- **Automations (Scheduled Prompts)** — 프롬프트를 hourly/daily/weekly/monthly/custom RRULE로 예약 실행, Run Now·일시정지·실행 히스토리·터미널 컨텍스트·채팅으로 생성/관리·권한 게이팅.
- **Calendar Views** — month/week/day 뷰 UI.
- **Recurring Events / Reminders** — RRULE 반복 일정, 이벤트별 토스트·브라우저 알림·웹훅 리마인더.
- **AI-Powered Scheduling** — 자연어로 모델이 이벤트 생성/수정/삭제 및 캘린더 텍스트·날짜 범위 검색.
- **Calendar Sharing / Multi-Calendar** — 사용자·그룹 read/write 공유, 색상별 다중 캘린더, 참석자·RSVP 관리.
- **Automation Overlay** — 활성 자동화·과거 실행을 Scheduled Tasks 캘린더의 가상 이벤트로 표시.

## 20. 플랫폼 기능 (알림 / 단축키 / PWA / i18n)

- **Notifications** — 이벤트/응답 완료 시 토스트·브라우저 알림(백그라운드 탭·리마인더·웹훅 포함).
- **Keyboard Shortcuts** — 단축키 모달(Ctrl+/)로 조회, 새 채팅(Ctrl+N) 등 지원(지속 확장 중).
- **Responsive Design & PWA** — 데스크톱·모바일 반응형, Progressive Web App로 네이티브 앱 유사 경험·오프라인 접근.
- **Multilingual (i18n)** — i18n 다국어 지원으로 선호 언어 사용.
- **Broad Model & API Integration** — Ollama 로컬 모델 및 모든 OpenAI-호환 API 연결.

---

## 출처 (Sources)

- README: https://raw.githubusercontent.com/open-webui/open-webui/main/README.md
- Chat features index: https://raw.githubusercontent.com/open-webui/docs/main/docs/features/chat-conversations/chat-features/index.mdx
- Multi-model: https://raw.githubusercontent.com/open-webui/docs/main/docs/features/chat-conversations/chat-features/multi-model-chats.mdx
- Conversation organization: https://raw.githubusercontent.com/open-webui/docs/main/docs/features/chat-conversations/chat-features/conversation-organization.md
- History & search: https://raw.githubusercontent.com/open-webui/docs/main/docs/features/chat-conversations/chat-features/history-search.mdx
- Message queue: https://raw.githubusercontent.com/open-webui/docs/main/docs/features/chat-conversations/chat-features/message-queue.mdx
- Follow-up prompts: https://raw.githubusercontent.com/open-webui/docs/main/docs/features/chat-conversations/chat-features/follow-up-prompts.md
- Autocomplete: https://raw.githubusercontent.com/open-webui/docs/main/docs/features/chat-conversations/chat-features/autocomplete.md
- Chat sharing: https://raw.githubusercontent.com/open-webui/docs/main/docs/features/chat-conversations/chat-features/chatshare.md
- Chat params: https://raw.githubusercontent.com/open-webui/docs/main/docs/features/chat-conversations/chat-features/chat-params.md
- Task management: https://raw.githubusercontent.com/open-webui/docs/main/docs/features/chat-conversations/chat-features/task-management.mdx
- Temporal awareness: https://raw.githubusercontent.com/open-webui/docs/main/docs/features/chat-conversations/chat-features/temporal-awareness.mdx
- Reasoning models: https://raw.githubusercontent.com/open-webui/docs/main/docs/features/chat-conversations/chat-features/reasoning-models.mdx
- Automations: https://raw.githubusercontent.com/open-webui/docs/main/docs/features/chat-conversations/chat-features/automations.mdx
- URL params: https://raw.githubusercontent.com/open-webui/docs/main/docs/features/chat-conversations/chat-features/url-params.md
- Memory: https://raw.githubusercontent.com/open-webui/docs/main/docs/features/chat-conversations/memory.mdx
- Direct connections: https://raw.githubusercontent.com/open-webui/docs/main/docs/features/chat-conversations/direct-connections.mdx
- Import/export: https://raw.githubusercontent.com/open-webui/docs/main/docs/features/chat-conversations/data-controls/import-export.md
- Archived chats: https://raw.githubusercontent.com/open-webui/docs/main/docs/features/chat-conversations/data-controls/archived-chats.md
- Shared chats: https://raw.githubusercontent.com/open-webui/docs/main/docs/features/chat-conversations/data-controls/shared-chats.md
- Files: https://raw.githubusercontent.com/open-webui/docs/main/docs/features/chat-conversations/data-controls/files.md
- RAG: https://raw.githubusercontent.com/open-webui/docs/main/docs/features/chat-conversations/rag/index.md
- Web search: https://raw.githubusercontent.com/open-webui/docs/main/docs/features/chat-conversations/web-search/index.mdx
- Agentic search: https://raw.githubusercontent.com/open-webui/docs/main/docs/features/chat-conversations/web-search/agentic-search.mdx
- Code execution: https://raw.githubusercontent.com/open-webui/docs/main/docs/features/chat-conversations/chat-features/code-execution/index.md
- Artifacts: https://raw.githubusercontent.com/open-webui/docs/main/docs/features/chat-conversations/chat-features/code-execution/artifacts.md
- Image generation: https://raw.githubusercontent.com/open-webui/docs/main/docs/features/chat-conversations/image-generation-and-editing/usage.md
- Audio: https://raw.githubusercontent.com/open-webui/docs/main/docs/features/chat-conversations/audio/index.mdx
- Workspace: https://raw.githubusercontent.com/open-webui/docs/main/docs/features/workspace/index.mdx
- Models: https://raw.githubusercontent.com/open-webui/docs/main/docs/features/workspace/models.md
- Knowledge: https://raw.githubusercontent.com/open-webui/docs/main/docs/features/workspace/knowledge.mdx
- Prompts: https://raw.githubusercontent.com/open-webui/docs/main/docs/features/workspace/prompts.md
- Skills: https://raw.githubusercontent.com/open-webui/docs/main/docs/features/workspace/skills.md
- Tools: https://raw.githubusercontent.com/open-webui/docs/main/docs/features/extensibility/plugin/tools/index.mdx
- Functions: https://raw.githubusercontent.com/open-webui/docs/main/docs/features/extensibility/plugin/functions/index.mdx
- Channels: https://raw.githubusercontent.com/open-webui/docs/main/docs/features/channels/index.md
- Notes: https://raw.githubusercontent.com/open-webui/docs/main/docs/features/notes/index.md
- Calendar: https://raw.githubusercontent.com/open-webui/docs/main/docs/features/calendar/index.md
- 평점/피드백(1–10, thumbs): https://github.com/open-webui/open-webui/discussions/4551 · https://docs.openwebui.com/features/administration/evaluation/
- 단축키: https://github.com/open-webui/open-webui/issues/1132 · https://github.com/open-webui/open-webui/issues/17015

### Open WebUI 카탈로그 [owui-admin-users]

I have comprehensive coverage across all requested areas. Here is the full report.

---

# Open WebUI — Admin / RBAC / Auth / API Keys / General Settings / Banners 전수조사

> 조사 방법: `raw.githubusercontent.com/open-webui/docs/main/docs/...` 원문 마크다운 + GitHub API 트리 + WebSearch. (docs.openwebui.com 직접 fetch 미사용 — 403.) 출처는 각 그룹 말미에 canonical URL로 표기.

권한 개수 실측: Workspace 13 + Sharing 15 + Chat 20 + Features 12 + Settings 1 = **총 61종** (문서 표기 "~61" 정확히 일치).

---

## 1. 시스템 역할 (System Roles)

세 가지 역할은 Groups·Permissions와 별개인 "기본 신뢰 수준"을 정의한다.

- **Admin (`admin`)** — 슈퍼유저. 전체 시스템·사용자·그룹·글로벌 설정 관리, 대부분의 권한 검사 우회(bypass). 내부적으로 `check_permission()==True`로 취급되어 "Web Search 끔" 같은 granular 권한이 admin에겐 대체로 적용되지 않음.
- **User (`user`)** — 표준 사용자. 암묵적 접근 없음. 모든 기능은 Global Default Permissions 또는 Group 멤버십으로만 부여됨(additive).
- **Pending (`pending`)** — 신규 가입자(설정 시)·비활성화 사용자의 기본 상태. 어떤 동작·콘텐츠도 불가. Admin이 `user`/`admin`으로 승격해야 함.

### Admin 제약 (환경변수로 한정 가능)

- **`ENABLE_ADMIN_CHAT_ACCESS=False`** — admin이 타 사용자 채팅 열람 불가 (admin-panel 표면 차단).
- **`BYPASS_ADMIN_ACCESS_CONTROL=False`** — admin도 private 모델/지식/노트 접근에 명시적 권한 필요.
- 문서 권장: bypass에만 의존하지 말고 admin을 별도 "Administrators" 그룹으로 권한 스키마에 편입.
- 주의: 이 `ENABLE_ADMIN_*`/`BYPASS_*` 토글은 "제품 UI/API 표면"만 제어하며 admin 본인에 대한 보안 경계가 아님 — admin은 설계상 root-equivalent(DB·env·Functions·Tools 직접 접근).

### 역할 배정 & 초기 셋업

- **First User** — fresh install에서 최초 생성 계정은 자동으로 **Admin**.
- **Primary Administrator** — 특별 플래그 없이 "생성 timestamp가 가장 오래된 admin 계정"이 primary. UI에 삭제 버튼 미노출 + 백엔드 user API가 삭제 거부(부트스트랩 계정 실수 삭제 방지). 보안 경계는 아니며 DB 레이어에서 교체 가능(계정 재구성/삭제로 최고령 계정이 곧 primary가 됨).
- **Subsequent Users** — 신규 가입은 `DEFAULT_USER_ROLE` 값(`pending`/`user`/`admin`, 기본 `pending`)을 받음. 공개/공유 인스턴스는 `pending` 권장.
- **Changing Roles** — Admin Panel > Users에서 언제든 승격/강등. admin→user 강등 시 권한 시스템 재적용.
- **Pending 오버레이 커스터마이즈** — `PENDING_USER_OVERLAY_TITLE`, `PENDING_USER_OVERLAY_CONTENT`로 대기 화면 문구 지정.

### Headless / 자동화 Admin 생성

- **`WEBUI_ADMIN_EMAIL` + `WEBUI_ADMIN_PASSWORD`** (+선택 `WEBUI_ADMIN_NAME`, 기본 "Admin") — DB가 비어 있는 첫 기동 시에만 admin 계정 자동 생성, 비밀번호 해시 저장, `ENABLE_SIGNUP=False` 자동 설정. 이미 사용자가 있으면 변수 무시(일회성). Docker/K8s/CI-CD용.

출처: `features/authentication-access/rbac/roles.md`, `.../rbac/index.mdx`, `reference/env-configuration.mdx`

- https://docs.openwebui.com/features/authentication-access/rbac/roles/
- https://docs.openwebui.com/features/authentication-access/rbac/

---

## 2. 사용자 관리 (User CRUD / Preview Access)

- **역할 변경** — Admin Panel > Users에서 role 토글(admin/user/pending).
- **Preview Access (사용자)** — Admin Panel > Users에서 비-admin 행에 hover → eye 아이콘. 해당 사용자가 read 가능한 모든 모델·지식·도구를 그룹 멤버십+직접 grant 합산해 한 화면에 표시. Admin 전용·read-only. API: `GET /api/v1/users/{user_id}/preview`.
- **Preview Group Access (그룹)** — Groups 편집기의 Preview Group Access 패널. 동일 형태로 그룹 grant만 스코프. API: `GET /api/v1/groups/id/{id}/preview`. 권한 변경 후 결과 검증 / 주기적 RBAC 감사용.
- **활성 사용자 수 노출** — `ENABLE_PUBLIC_ACTIVE_USERS_COUNT=False` 시 admin만 active user count 조회.
- **User Status** — `ENABLE_USER_STATUS` (Admin Panel > Settings > General > User Status)로 상태 표시(active/away, 상태 메시지) 전역 on/off.

출처: `features/authentication-access/rbac/groups.md`

- https://docs.openwebui.com/features/authentication-access/rbac/groups/

---

## 3. 그룹 (Groups)

목적: (1) 대규모 권한 관리, (2) private 리소스(모델·지식·도구) 접근 제어(ACL).

- **가산(additive)·Union 병합** — 다중 그룹 멤버는 모든 권한의 **superset**. Group A가 "Image Generation" 허용·B가 불허 → 사용자는 허용됨. "Deny" 없음, "Grant"만 존재.
- **Default Permissions** — Admin Panel > Users > Groups > Default Permissions. admin 포함 모든 사용자에 적용되는 baseline.
- **Group Permissions (오버라이드)** — 그룹별 권한 토글 ON = 전역에서 꺼져 있어도 멤버는 그 기능 획득. 기본 상태는 추가 권한 없음(전역 default 의존).
- **그룹 가시성 — "Who can share to this group"**:
  - **Anyone (기본)** — 모든 사용자가 공유 Access-Control 메뉴에서 이 그룹을 봄.
  - **Members** — 이미 멤버인 사용자에게만 노출(팀 사설 협업용).
  - **No one** — 공유 메뉴에서 완전 숨김(RBAC 권한 배정 전용 기술 그룹용).
  - 기본값은 `DEFAULT_GROUP_SHARE_PERMISSION`(`members`/`true`/`false`, 기본 `members`)로 신규 그룹에 적용.
- **전략: Permission Groups vs Sharing Groups** — 권한 부여용 그룹(share=No one)과 사람 조직용 그룹(share=Members/Anyone, 권한은 비움) 분리 → 전역 권한 회수(revocation)가 즉시 반영되도록 유지.
- **그룹 구조** — Name, Description, Permissions(default 권한 오버라이드 JSON), Members(User ID 목록).
- **신규 사용자 자동 그룹** — `DEFAULT_GROUP_ID`로 가입 시 기본 그룹 배정.

### 그룹 동기화 (외부 IdP)

- **OAuth Group Sync** — `ENABLE_OAUTH_GROUP_MANAGEMENT=true`. 로그인마다 OAuth claim과 **엄격 동기화**(claim에 없는 그룹은 제거). `OAUTH_GROUP_CLAIM`(기본 `groups`, nested 가능). `ENABLE_OAUTH_GROUP_CREATION`으로 미존재 그룹 JIT 자동 생성. `OAUTH_GROUP_DEFAULT_SHARE`로 JIT 그룹의 공유 기본값. **Admin 사용자의 그룹은 OAuth로 자동 갱신되지 않음.**
- **Trusted Header Group Sync** — `WEBUI_AUTH_TRUSTED_GROUPS_HEADER`(콤마 구분 그룹명). 존재하는 그룹만 배정, 자동 생성 없음.
- **SCIM Group Sync** — §7 참조.

출처: `features/authentication-access/rbac/groups.md`, `reference/env-configuration.mdx`

- https://docs.openwebui.com/features/authentication-access/rbac/groups/

---

## 4. 권한 카테고리 (Permissions — 5 카테고리 / 61종)

권한은 **additive**: 유효권한 = Global Defaults ∪ 모든 Group 멤버십. "True가 False를 이김", Deny 불가. 완전 제한하려면 전역 default와 **모든** 소속 그룹 양쪽에서 꺼야 함. 최소권한 원칙: default 최소화 → 그룹으로 grant.

### 4.1 Workspace 권한 (13종)

- **Models Access** (Parent) — Models 워크스페이스 접근(커스텀 모델 생성/편집).
- **Models Import** — (Models Access 필요) JSON/파일에서 모델 import.
- **Models Export** — (Models Access 필요) 모델 파일로 export.
- **Knowledge Access** — Knowledge 워크스페이스 접근(지식 베이스 관리).
- **Prompts Access** (Parent) — Prompts 워크스페이스 접근(커스텀 시스템 프롬프트).
- **Prompts Import** — (Prompts Access 필요) 프롬프트 import.
- **Prompts Export** — (Prompts Access 필요) 프롬프트 export.
- **Tools Access** (Parent) — Tools 워크스페이스 접근. ⚠️ **root-equivalent**: Tools/Functions는 임의 Python 실행 = 서버 셸 접근에 준함. 신뢰 사용자에게만.
- **Tools Import** — (Tools Access 필요) 도구 import.
- **Tools Export** — (Tools Access 필요) 도구 export.
- **Skills Access** — Skills 워크스페이스 접근(재사용 지시셋 생성/관리).
- **Import Skills** — Skills 워크스페이스로 skill import.
- **Export Skills** — Skills 워크스페이스에서 skill export.

### 4.2 Sharing 권한 (15종)

- **Share Models** (Parent) — 모델 공유. **Public Models** — (필요) 공개 검색 노출.
- **Share Knowledge** (Parent) — 지식 공유. **Public Knowledge** — (필요) 공개.
- **Share Prompts** (Parent) — 프롬프트 공유. **Public Prompts** — (필요) 공개.
- **Share Tools** (Parent) — 도구 공유. **Public Tools** — (필요) 공개.
- **Share Skills** (Parent) — skill 공유. **Public Skills** — (필요) 공개.
- **Share Notes** (Parent) — 노트 공유. **Public Notes** — (필요) 공개.
- **Folders Sharing** — 채팅 폴더(+내부 채팅)를 특정 사용자/그룹에 read/write 공유. 하위폴더 상속, 폴더는 공개 불가. Admin 항상 예외.
- **Chats Public Sharing** — (Share Chat 필요) 채팅 공유 링크를 비인증 방문자 포함 누구나 접근 가능하게. 끄면 비-admin에게 "Public" 옵션 숨김(특정 사용자/그룹 공유는 가능).
- **Calendars Public Sharing** — (Features>Calendar 필요) 캘린더를 모든 캘린더 사용자에게 공개 read/write. 끄면 wildcard grant 제거.

### 4.3 Chat 권한 (20종)

- **Chat Controls** (Parent) — 고급 채팅 설정(Valves/System Prompt/Parameters 필수 전제).
- **Model Valves** — (필요) 모델별 "valve" 설정.
- **System Prompt** — (필요) 대화 시스템 프롬프트 편집.
- **Parameters** — (필요) LLM 파라미터(temperature, top_k 등) 조정.
- **File Upload** — 채팅에 파일 업로드.
- **Delete Chat** — 대화 전체 삭제.
- **Delete Message** — 개별 메시지 삭제.
- **Edit Message** — 메시지 편집.
- **Continue Response** — 잘린 응답 "Continue".
- **Regenerate Response** — AI 응답 재생성.
- **Rate Response** — 응답 thumbs up/down.
- **Share Chat** — 채팅 공유 링크 생성.
- **Export Chat** — 채팅 히스토리 export.
- **Allow Chat Import** — export한 채팅 다시 업로드(import).
- **Speech-to-Text (STT)** — 음성 입력.
- **Text-to-Speech (TTS)** — 음성 출력.
- **Audio Call** — 실시간 오디오 콜.
- **Multiple Models** — 다중 모델 동시 응답.
- **Temporary Chat** (Parent) — 임시 채팅(incognito/히스토리 off) 토글. 이 모드에선 백엔드 문서 파싱 비활성(프라이버시).
- **Enforced Temporary** — (필요) 사용자를 항상 임시 채팅으로 강제(히스토리 비활성).

### 4.4 Features 권한 (12종)

- **API Keys** — 비-admin이 User Settings에서 개인 액세스 토큰 생성. (`USER_PERMISSIONS_FEATURES_API_KEYS`)
- **Notes** — Notes 기능 접근.
- **Channels** — Channels 기능 접근.
- **Folders** — 채팅 정리용 폴더 사용.
- **Web Search** — 웹 검색 통합 사용.
- **Image Generation** — 이미지 생성 도구 사용.
- **Code Interpreter** — Python 코드 인터프리터 사용.
- **Direct Tool Servers** — 설정에서 커스텀 Tool Server 연결.
- **Memories** — 지속 사용자 컨텍스트 Memories 기능.
- **Automations** — 비-admin이 Automations 페이지 접근·자기 스케줄 자동화 CRUD/run/pause. (admin은 `features.automations` 면제, `USER_PERMISSIONS_FEATURES_AUTOMATIONS`)
- **Calendar** — 캘린더 생성·이벤트 관리·공유 캘린더 열람. (admin 면제, `USER_PERMISSIONS_FEATURES_CALENDAR`)
- **User Webhooks** — 사용자가 Settings>Account에서 개인 알림 webhook URL 설정. 기본 off.

### 4.5 Settings 권한 (1종)

- **Interface Settings Access** — user settings의 인터페이스 설정 접근/수정.

### 권한 관련 노트

- **API Keys 권한 스코프** — (1) 전역 `Enable API Keys` ON 필수, (2) 비-admin은 `features.api_keys` 필요, (3) admin은 전역 ON이면 개별 권한 없이 생성 가능.
- **환경변수 default** — `USER_PERMISSIONS_*` 접두. 예: `ENABLE_IMAGE_GENERATION`, `ENABLE_WEB_SEARCH`, `USER_PERMISSIONS_CHAT_FILE_UPLOAD`.
- **Best Practice** — "Administrators" 그룹 생성·전 admin 편입 → 신규 admin 권한 추가 시 그룹으로 일괄 부여.
- **RBAC 범위 경계** — RBAC는 Open WebUI 내부 동작만 제어. 외부 provider(LiteLLM/OpenRouter 등)는 별도 최소권한 자격증명 사용, 관리/마스터 키를 일반 트래픽에 쓰지 말 것.

출처: `features/authentication-access/rbac/permissions.md`

- https://docs.openwebui.com/features/authentication-access/rbac/permissions/

---

## 5. 리소스 ACL (Access Grants)

- **가시성 태그** — 모델/지식 베이스 생성·편집 시 Private 또는 Restricted 지정.
- **Grant 부여** — 특정 그룹 또는 개별 사용자에 **Read**(열람·사용) / **Write**(수정·삭제) 부여. 재설계된 UI로 다중 추가 가능.
- **정규화된 Access Grant** — DB 저장. 각 grant = {Resource(type+id), Principal(group 또는 user), Permission(read/write)}. 예: Marketing 그룹 read + 특정 editor user write → grant 2건.
- **Public = wildcard** — 공개 접근은 principal이 wildcard `*`인 user grant로 표현.
- **Knowledge Scoping** — 모델에 지식 베이스가 attach되면 그 KB만 접근(전체 사용자 KB 아님).
- **지원 리소스** — 모델, 지식, 도구, Skills 모두 fine-grained ACL. 리소스는 기본 private, 생성자가 접근 제어.
- **Preview Access** — §2 참조(감사용).

출처: `features/authentication-access/rbac/groups.md`, `.../index.mdx`

- https://docs.openwebui.com/features/authentication-access/rbac/groups/

---

## 6. OAuth / OIDC / SSO / Trusted Header

- ⚠️ **OIDC provider 1개 제한** — `OPENID_PROVIDER_URL`로 동시 1개만(MS+Google 동시 불가). 커뮤니티 Dual OAuth 우회 존재.

### 공통 OAuth 설정

- **`WEBUI_URL`** (필수) — 공개 주소, redirect URI에 사용. OAuth 활성화 전 먼저 설정.
- **`ENABLE_OAUTH_SIGNUP`** — OAuth 로그인 시 계정 생성 허용(`ENABLE_SIGNUP`과 별개).
- **`ENABLE_OAUTH_PERSISTENT_CONFIG`** (기본 false) — true면 OAuth 설정을 DB에서 로드(Admin Panel 관리), false면 env 우선.
- **`OAUTH_AUTO_REDIRECT`** — `/auth`의 미인증 사용자를 provider 로그인으로 직행("Continue with SSO" 스킵). provider 1개+`ENABLE_LOGIN_FORM=false`+LDAP 없음 필요. `/auth?form=true`로 로컬 폼 escape.
- **`OAUTH_MERGE_ACCOUNTS_BY_EMAIL`** — 이메일 일치로 OAuth 로그인 병합(provider가 이메일 미검증 시 위험).
- **`OAUTH_UPDATE_PICTURE_ON_LOGIN`** / **`OAUTH_PICTURE_CLAIM`**(기본 `picture`) — 로그인마다 프로필 사진 갱신 / claim 필드 지정.
- **`ENABLE_PROFILE_IMAGE_URL_FORWARDING`** (기본 true) — IdP avatar URL로 302 리다이렉트(클라이언트 IP/UA/Referer 유출 가능). false 권장.
- **`WEBUI_AUTH_SIGNOUT_REDIRECT_URL`** — 로그아웃 후 리다이렉트 URL.
- **`WEBUI_SECRET_KEY`** (필수, 특히 클러스터) — 세션/OAuth 키. `OAUTH_SESSION_TOKEN_ENCRYPTION_KEY`, `OAUTH_CLIENT_INFO_ENCRYPTION_KEY`(MCP OAuth 2.1용)로 개별 키 분리 가능.

### 서버측 세션 관리

- **서버측 토큰 저장** — 큰 토큰(AD FS 그룹 claim 등 쿠키 한계 초과)을 암호화해 `oauth_session` 테이블에 저장, 브라우저엔 작은 httponly `oauth_session_id` 쿠키만.
- **`OAUTH_MAX_SESSIONS_PER_USER`** (기본 10) — provider별 동시 세션 상한(초과 시 오래된 것 prune, 멀티디바이스 지원).
- **자동 토큰 갱신** — 만료 임박 시 저장된 refresh_token으로 자동 재발급.
- **`ENABLE_OAUTH_ID_TOKEN_COOKIE`** (기본 true, false 권장) — 레거시 `oauth_id_token` 쿠키.
- **`ENABLE_OAUTH_TOKEN_EXCHANGE`** — 외부 앱이 OAuth 액세스 토큰을 Open WebUI JWT로 교환하는 엔드포인트(CLI/스크립트용).
- **`ENABLE_OAUTH_BACKCHANNEL_LOGOUT`** — OIDC Back-Channel Logout(`POST /oauth/backchannel-logout`). IdP 주도 서버-투-서버 로그아웃. **Redis 필요**(없으면 세션은 지우나 발급된 JWT는 만료까지 유효).

### Provider별

- **Google** — `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, redirect `/oauth/google/callback`, `OPENID_PROVIDER_URL`(로그아웃용). `GOOGLE_OAUTH_AUTHORIZE_PARAMS`로 prompt/login_hint/hd 등 추가.
- **Microsoft** — `MICROSOFT_CLIENT_ID`/`SECRET`/`CLIENT_TENANT_ID`/`REDIRECT_URI`, single-tenant. 토큰 갱신엔 `MICROSOFT_OAUTH_SCOPE`에 `offline_access` 추가(없으면 1h 후 MCP·OneDrive·프로필사진 갱신 실패).
- **GitHub** — `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET`, redirect `/oauth/github/callback`.
- **Generic OIDC** — `OAUTH_CLIENT_ID`/`SECRET`, `OPENID_PROVIDER_URL`(필수, well-known), `OAUTH_PROVIDER_NAME`(UI 표시, 기본 SSO), `OAUTH_SCOPES`(기본 `openid email profile`), `OPENID_REDIRECT_URI`(`/oauth/oidc/callback`), `OAUTH_AUDIENCE`. `email` claim 필수. Authentik/Authelia 예시 포함.

### OAuth Role Management

- **`ENABLE_OAUTH_ROLE_MANAGEMENT=true`** — OAuth 토큰의 role로 Open WebUI 역할 관리.
- **`OAUTH_ROLES_CLAIM`**(기본 `roles`, nested 가능), **`OAUTH_ALLOWED_ROLES`**(로그인 허용 role, `*` wildcard→`user`), **`OAUTH_ADMIN_ROLES`**(admin 부여 role), **`OAUTH_ROLES_SEPARATOR`**(대체 구분자). 역할 변경 시 재로그인 필요.

### OAuth Group Management

- §3 참조 (`ENABLE_OAUTH_GROUP_MANAGEMENT`, `OAUTH_GROUP_CLAIM`, `ENABLE_OAUTH_GROUP_CREATION`, `OAUTH_GROUP_DEFAULT_SHARE`). 엄격 동기화, admin 그룹은 자동 갱신 제외.

### Trusted Header (인증 리버스 프록시 위임)

- ⚠️ 잘못 구성 시 임의 사용자 사칭 가능 — 프록시만 접근 허용(`HOST=127.0.0.1` 등).
- **`WEBUI_AUTH_TRUSTED_EMAIL_HEADER`** — 헤더의 이메일로 자동 등록/로그인. **`WEBUI_AUTH_TRUSTED_NAME_HEADER`** — 이름.
- **`WEBUI_AUTH_TRUSTED_GROUPS_HEADER`** — 콤마 구분 그룹 동기화(기존 그룹만, 자동생성 없음, 미포함 그룹은 해제).
- **`WEBUI_AUTH_TRUSTED_ROLE_HEADER`** — `admin`/`user`/`pending` 역할을 매 로그인마다 반영(무효값이면 미변경+경고). ⚠️ 신뢰 프록시만 이 헤더 설정 가능해야 함(admin 상승 위험).
- 지원 예시: Tailscale Serve(`Tailscale-User-Login`), Cloudflare Tunnel+Access(`Cf-Access-Authenticated-User-Email`), oauth2-proxy(`X-Forwarded-Email`), Authelia.

### SSO 지향 UX

- **`ENABLE_PASSWORD_AUTH=false`** — 로컬 비밀번호 로그인 완전 차단(`ENABLE_OAUTH_SIGNUP=true`일 때만). **`ENABLE_PASSWORD_CHANGE_FORM=false`** — 계정 페이지 비밀번호 변경 UI 숨김.

출처: `features/authentication-access/auth/sso/index.mdx`, `reference/env-configuration.mdx`

- https://docs.openwebui.com/features/authentication-access/auth/sso/

---

## 7. LDAP / AD

- **`ENABLE_LDAP="true"`** — LDAP 인증 활성화(Admin Panel > Settings > General에서도 설정). env는 첫 기동에만 읽힘(`ENABLE_PERSISTENT_CONFIG=false` 아니면 이후 UI로).
- **서버 설정** — `LDAP_SERVER_LABEL`, `LDAP_SERVER_HOST`, `LDAP_SERVER_PORT`(389 평문/StartTLS, 636 LDAPS; 따옴표 금지), `LDAP_USE_TLS`, `LDAP_VALIDATE_CERT`.
- **바인드 자격** — `LDAP_APP_DN`, `LDAP_APP_PASSWORD`.
- **사용자 스키마** — `LDAP_SEARCH_BASE`, `LDAP_ATTRIBUTE_FOR_USERNAME`(예 uid), `LDAP_ATTRIBUTE_FOR_MAIL`(예 mail), `LDAP_SEARCH_FILTER`(선택, 그룹 멤버십 필터 등; `%(user)s`류 플레이스홀더 미지원).
- **동작** — 이중 바인드(app bind → 사용자 자격 bind). 최초 로그인 성공 시 "User" 역할로 계정 자동 생성, 이후 admin이 승격 가능.
- OpenLDAP/phpLDAPadmin Docker 예시·LDIF 시드·트러블슈팅(err=49, TLS 핸드셰이크) 포함.

출처: `features/authentication-access/auth/ldap.mdx`

- https://docs.openwebui.com/features/authentication-access/auth/ldap/

---

## 8. SCIM 2.0

- **용도** — Okta/Azure AD/Google Workspace 등에서 사용자·그룹 자동 프로비저닝(생성/갱신/비활성화/멤버십). env 전용, UI 설정 없음.
- **설정** — `SCIM_ENABLED=true`, `SCIM_TOKEN`(bearer, `openssl rand -base64 32` 권장), `SCIM_AUTH_PROVIDER`(externalId 연동할 OAuth provider명, 예 microsoft/oidc — 미설정 시 externalId 작업 500 에러).
- **Base URL** — `<url>/api/v1/scim/v2/`, Bearer 인증.
- **User Ops** — Create/Get/Update(PUT·PATCH)/Delete(비활성화)/List `/Users` (필터 지원).
- **Group Ops** — Create/Get/Update/Delete/List `/Groups`.
- **User 속성** — `userName`(이메일, unique 필수), `name.givenName`/`familyName`, `emails`(primary), `active`, `externalId`(사용자 `scim` JSON에 provider별 저장).
- **Group 속성** — `displayName`(필수), `members`, `externalId`.
- **필터 연산자** — eq, ne, co, sw, ew, pr, gt, ge, lt, le.
- **Account Linking** — externalId로 사용자 조회, 없으면 OAuth `sub` fallback으로 기존 계정 자동 연결.
- **한계** — 커스텀 스키마 확장·bulk·ETag 미지원.
- SSO(OIDC 인증) + SCIM(프로비저닝) 조합 권장.

출처: `features/authentication-access/auth/scim.mdx`

- https://docs.openwebui.com/features/authentication-access/auth/scim/

---

## 9. API Keys

- **개념** — 개인 액세스 토큰. 웹 UI와 동일 엔드포인트를 `Authorization: Bearer`로 호출. **생성 사용자의 role·group 권한을 그대로 상속**(별도 권한 모델 없음).
- **2단 게이트** — (1) Admin Panel > Settings > General > **Enable API Keys**(`ENABLE_API_KEYS`, 전역 마스터; off면 admin도 불가), (2) 비-admin은 **API Keys** feature 권한(`USER_PERMISSIONS_FEATURES_API_KEYS`, default 또는 그룹). admin은 전역 ON이면 즉시 생성.
- **Endpoint Restrictions** — 선택. `API Key Endpoint Restrictions`로 허용 라우트 콤마 목록 제한(예 `/api/v1/models,/api/v1/chat/completions`).
- **생성** — Settings > Account > API Keys > Generate. **생성 직후 1회만 표시**(재열람 불가).
- **커스텀 헤더** — 리버스 프록시가 `Authorization` 소비 시 대체. 미들웨어 순서: `Authorization: Bearer` → `token` 쿠키 → 커스텀 헤더(기본 `x-api-key`, `CUSTOM_API_KEY_HEADER`로 변경).
- **한계** — 생성 후 열람 불가, per-key 권한 제한 불가(endpoint restriction 제외), 자동 만료 없음(수동 회전).
- **Best Practice** — 전용 non-admin 서비스 계정, endpoint 화이트리스트, 주기적 회전.

출처: `features/authentication-access/api-keys.md`

- https://docs.openwebui.com/features/authentication-access/api-keys/

---

## 10. General 설정 (Admin Panel > Settings > General) & 관련 토글

### 가입 / 로그인

- **`ENABLE_SIGNUP`** (기본 True) — 계정 생성 토글.
- **`ENABLE_SIGNUP_PASSWORD_CONFIRMATION`** (기본 False) — 가입 페이지에 "Confirm Password" 필드 추가.
- **`ENABLE_LOGIN_FORM`** (기본 True) — 이메일/비밀번호/sign-in 폼 요소 토글.
- **`DEFAULT_USER_ROLE`** (기본 pending) — 신규 사용자 기본 역할.
- **`DEFAULT_GROUP_ID`** — 가입 시 자동 배정 그룹.
- **`DEFAULT_LOCALE`** (기본 en) — 기본 로케일.

### 비밀번호 정책

- **`ENABLE_PASSWORD_AUTH`** (기본 True) — 비밀번호 로그인 허용(false=SSO 전용 강제).
- **`ENABLE_PASSWORD_CHANGE_FORM`** (기본 True) — 비밀번호 변경 UI 노출.
- **`PASSWORD_HASH_ALGORITHM`** (기본 bcrypt; argon2) — 신규 비밀번호 해시 알고리즘(bcrypt는 72바이트 제한, argon2 무제한).
- **`ENABLE_PASSWORD_VALIDATION`** (기본 False) — 복잡도 검증 활성화(가입/변경/생성/리셋 시 적용, 기존 사용자 소급 강제 안 함).
- **`PASSWORD_VALIDATION_REGEX_PATTERN`** — 기본 8자+대/소/숫자/특수 각 1(`^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^\w\s]).{8,}$`).

### 인증 토큰 (JWT)

- **`JWT_EXPIRES_IN`** (기본 `4w`) — JWT 만료(단위 s/m/h/d/w, `-1`=무한 — 프로덕션 금지). Redis 없으면 로그아웃/비밀번호 변경이 기존 JWT를 즉시 무효화하지 못함(만료까지 유효).

### 기본 모델 / 파라미터

- **`DEFAULT_MODELS`** — 기본 LLM 지정.
- **`DEFAULT_PINNED_MODELS`** — 신규 사용자 기본 pin 모델 콤마 목록.
- **`DEFAULT_MODEL_METADATA`** — 전 모델 기본 metadata(capabilities 등, per-model 우선). Admin Settings→Models.
- **`DEFAULT_MODEL_PARAMS`** — 전 모델 기본 파라미터(temperature/top_p/max_tokens/seed 등, per-model 우선).
- **`ENABLE_CUSTOM_MODEL_FALLBACK`** (기본 False) — 커스텀 모델의 base 부재 시 `DEFAULT_MODELS` 첫 모델로 fallback.

### 제목/태그 생성 · Webhook

- **`ENABLE_TITLE_GENERATION`** (기본 True) — 채팅 제목 자동 생성. `TITLE_GENERATION_PROMPT_TEMPLATE`로 프롬프트 커스터마이즈.
- **`ENABLE_TAGS_GENERATION`** — 태그 자동 생성.
- **`WEBHOOK_URL`** (Admin Webhook) — 신규 가입 시 Discord/Slack/Teams로 `{"event":"new_user",...}` POST 알림.
- **`ENABLE_USER_WEBHOOKS`** (기본 False) — 사용자별 개인 알림 webhook 허용(long-running 응답 준비 알림, 탭 비활성 시만 발송). private/reserved IP는 SSRF 차단.
- **Channel Webhooks** — 외부 서비스가 채널에 메시지 POST(`{WEBUI_API_BASE_URL}/channels/webhooks/{id}/{token}`). 채널 매니저/admin만 관리, name·profile image·"webhook" role 표시.

### 기능 토글 (Feature Toggles)

- **`ENABLE_MESSAGE_RATING`** (기본 True) — 메시지 평가(thumbs).
- **`ENABLE_COMMUNITY_SHARING`** (기본 True) — Open WebUI 커뮤니티 공유/발견 UI.
- **`ENABLE_CHANNELS`** (기본 False) — 채널.
- **`ENABLE_FOLDERS`** (기본 True) / `FOLDER_MAX_FILE_COUNT`.
- **`ENABLE_NOTES`** (기본 True) · **`ENABLE_MEMORIES`** (기본 True) · `ENABLE_MEMORY_SYSTEM_CONTEXT` · **`ENABLE_CALENDAR`** (기본 True) · **`ENABLE_AUTOMATIONS`** (기본 True, `AUTOMATION_MAX_COUNT`·`AUTOMATION_MIN_INTERVAL`).
- **`ENABLE_USER_STATUS`** (기본 True) — 사용자 상태(active/away) UI.
- **`ENABLE_EASTER_EGGS`** (기본 True) — UI 노벨티(예 "Her" 테마).
- **`ENABLE_VERSION_UPDATE_CHECK`** (기본 True) — 자동 버전 업데이트 확인/알림(`OFFLINE_MODE` 시 강제 false).

### Admin 표면 토글 (Admin Posture)

- **`ENABLE_ADMIN_EXPORT`** (기본 True) — admin 데이터/채팅/DB export 표면.
- **`ENABLE_ADMIN_CHAT_ACCESS`** (기본 True) — admin의 타 사용자 채팅 열람.
- **`ENABLE_ADMIN_ANALYTICS`** (기본 True) — Analytics 탭/라우터.
- **`BYPASS_ADMIN_ACCESS_CONTROL`** (기본 True) — admin이 리스트/셀렉터에서 타 사용자 워크스페이스 항목 표시(false=본인+공유만). ※per-id 직접 엔드포인트는 의도적 비게이트.
- **`SHOW_ADMIN_DETAILS`** (기본 True) + `ADMIN_EMAIL` — UI에 admin 정보 노출.
- **`ENABLE_PUBLIC_ACTIVE_USERS_COUNT`** (기본 True) — active user count 전체 공개 여부.

### Watermark / License / 기타

- **`RESPONSE_WATERMARK`** — 메시지 복사 시 삽입되는 커스텀 텍스트(예 "This text is AI generated").
- **`LICENSE_KEY`** — Enterprise 라이선스 키.
- **`IFRAME_CSP`** — Artifacts/코드·HTML 프리뷰 등 srcdoc iframe에 주입할 CSP(방어 심화).
- **`WEBUI_BANNERS`** — §11 배너.

출처: `reference/env-configuration.mdx`, `features/administration/webhooks.md`, `features/administration/index.mdx`

- https://docs.openwebui.com/reference/env-configuration/
- https://docs.openwebui.com/features/administration/webhooks/

---

## 11. Banners (커스터마이즈 배너)

- **개요** — 로그인 사용자 대상 시스템 공지. 지속형, 선택적 dismissible. 설정: (1) Admin Panel > Settings > General > Banners, (2) `WEBUI_BANNERS` env(JSON 배열, GitOps용).
- **배너 속성** — `id`(필수, dismiss 추적), `type`(필수: `info` 파랑/`success` 초록/`warning` 노랑/`error` 빨강), `title`(선택), `content`(필수, **HTML only** — Markdown 미렌더), `dismissible`(필수 bool), `timestamp`(필수지만 프런트에서 표시 타이밍 제어에 미사용).
- **Dismiss 동작** — 클라이언트(브라우저) 저장. 캐시 삭제/다른 기기/브라우저에서 재출현. per-`id` 추적 → `id` 변경 시 새 배너 취급(업데이트 재노출 전략).
- **지원 HTML** — 텍스트 서식(b/strong, i/em, u, s/del, mark, small, sub/sup, code/kbd, abbr), 구조(br, hr, details/summary), 링크·이미지(a target=_blank, img width/height), inline style(span/div). **미지원**: 헤딩/리스트/테이블/blockquote/Markdown.
- **주의점** — literal newline이 줄바꿈 → 컴팩트 HTML 권장; anchor 닫기·`&`→`&amp;`; `WEBUI_BANNERS`는 유효 JSON 배열(스마트쿼트 금지); 외부 이미지 로드/프라이버시 리스크.
- **유형 일관성** — info(공지)/success(해결·완료)/warning(계획 점검·부분 저하)/error(활성 장애). alert fatigue 방지 위해 error 남용 금지.

출처: `features/administration/banners.md`, `features/administration/index.mdx`

- https://docs.openwebui.com/features/administration/banners/

---

## 부록 — 원문 출처 (raw 경로)

모든 내용은 아래 raw 마크다운 원문에서 확인:

- `raw.githubusercontent.com/open-webui/docs/main/docs/features/authentication-access/index.mdx`
- `.../rbac/{index.mdx, roles.md, permissions.md, groups.md}`
- `.../auth/{sso/index.mdx, ldap.mdx, scim.mdx}`
- `.../authentication-access/api-keys.md`
- `.../features/administration/{index.mdx, banners.md, webhooks.md}`
- `.../reference/env-configuration.mdx`

canonical(human): https://docs.openwebui.com/features/authentication-access/ · `/features/administration/` · `/reference/env-configuration/`

### Open WebUI 카탈로그 [owui-admin-platform]

I now have exhaustive coverage across every requested area. Here is the full survey.

---

# Open WebUI 관리자 기능 전수 조사

> 조사 출처: `raw.githubusercontent.com/open-webui/docs/main/docs/reference/env-configuration.mdx` (763개 환경변수 전량 파싱), 각 기능별 docs 페이지 raw, README, WebSearch. 접근 경로는 **Admin Panel → Settings** 기준. 형식: **기능/설정 — 설명** (관련 환경변수 표기).

---

## 1. 모델 (Models / 프리셋) & Task Model

출처: `docs/features/workspace/models.md`, `env-configuration#tasks`

**모델 프리셋 (Workspace Model)**

- **모델 프리셋** — 임의의 base model 위에 시스템프롬프트·도구·지식·스킬·파라미터를 묶은 "얇은 래퍼" 에이전트. base 모델 자체를 수정하지 않음.
- **Core 설정** — Avatar(GIF/WebP 지원), Name/ID, Base Model, Description, Tags, Visibility(Private 사용자·그룹 / Public).
- **시스템 프롬프트 + 동적 변수** — Jinja 스타일 `{{USER_NAME}}`·`{{CURRENT_DATE}}`·`{{CURRENT_TIME}}`·`{{USER_GROUPS}}`(그룹 인지형, 서버측 치환).
- **Capabilities/Bindings** — Knowledge(Focused Retrieval↔Full Context 토글), Tools(force-enable), Skills, Filters, Actions, Vision, Web Search, Code Interpreter, Image Generation, Builtin Tools(Time/Memory/Chats/Notes/Knowledge/Channels/Task Mgmt/Automations), File Context, **per-model TTS Voice**.
- **Advanced Parameters** — Stop Sequences, Temperature/Top P 등 창의성·결정성 조정.
- **Prompt Suggestions** — 새 채팅 진입 시 뜨는 클릭형 스타터 칩(모델별/전역 `DEFAULT_PROMPT_SUGGESTIONS`).
- **모델 관리 액션** — Edit / **Hide**(선택기에서 숨김, 삭제 아님) / **Clone**(편집 가능 복제) / Copy Link / **Export**(.json) / **Share**(커뮤니티) / Delete.
- **Import/Export** — .json 또는 커뮤니티 링크로 import, 전체 커스텀 모델을 단일 .json 로 export, 커뮤니티 프리셋 Discover.
- **Global Model Defaults (Admin)** — `DEFAULT_MODEL_METADATA`(capabilities baseline, deep-merge) / `DEFAULT_MODEL_PARAMS`(temperature·top_p·max_tokens·function_calling 등 baseline). per-model 값이 우선.
- **Bulk 관리** — Enabled/Disabled/Visible/Hidden 상태 필터 + **Bulk Actions**로 현재 뷰의 모델 일괄 활성/비활성(수백개 provider 모델 대응).
- **Curated-interface 배포 규칙** — 커스텀 모델은 항상 base 모델 접근권을 상속. base 를 Public+Hidden 으로 두고 그 위에 curated 모델 공유하는 패턴 권장.
- **ENABLE_CUSTOM_MODEL_FALLBACK** — base 모델 소실 시 `DEFAULT_MODELS` 첫 모델로 폴백(기본 False).
- **BYPASS_MODEL_ACCESS_CONTROL** — 모든 사용자/관리자가 privacy 무시하고 모든 모델 접근(소규모용, 기본 False).

**Task Model (제목·쿼리 생성 등 보조 작업용)**

- **TASK_MODEL / TASK_MODEL_EXTERNAL** — 제목 생성·웹검색 쿼리 생성 등 백그라운드 작업에 쓰는 기본 모델(로컬/외부).
- **ENABLE_TITLE_GENERATION** + `TITLE_GENERATION_PROMPT_TEMPLATE` — 채팅 제목 자동 생성.
- **ENABLE_TAGS_GENERATION** + `TAGS_GENERATION_PROMPT_TEMPLATE` — 채팅 태그 자동 생성.
- **ENABLE_AUTOCOMPLETE_GENERATION** — 입력 자동완성(`AUTOCOMPLETE_GENERATION_INPUT_MAX_LENGTH`, 프롬프트 템플릿).
- **ENABLE_FOLLOW_UP_GENERATION** — 후속 질문 제안 생성.
- **ENABLE_RETRIEVAL_QUERY_GENERATION** / `QUERY_GENERATION_PROMPT_TEMPLATE` — 검색 쿼리 생성.
- **ENABLE_CONTEXT_COMPACTION** — 컨텍스트 임계치(`CONTEXT_COMPACTION_TOKEN_THRESHOLD` 기본 80k, `_TOKEN_CAP`) 초과 시 오래된 메시지 요약 체크포인트로 압축(`CONTEXT_COMPACTION_PROMPT_TEMPLATE`).
- **TOOLS_FUNCTION_CALLING_PROMPT_TEMPLATE** — 도구 호출 프롬프트 템플릿.

---

## 2. 연결 (Connections)

출처: `env-configuration#ollama`, `#openai`, `direct-connections.mdx`, `#direct-connections-openapimcpo-tool-servers`, `#model-caching`

**Ollama**

- **ENABLE_OLLAMA_API** — Ollama API 사용 토글.
- **OLLAMA_BASE_URL / OLLAMA_BASE_URLS** — 단일/로드밸런싱 다중 Ollama 백엔드(`;` 구분).
- **OLLAMA_API_CONFIGS** — 연결별 설정 JSON(enable·prefix_id·model_ids·tags·connection_type).

**OpenAI-compatible (다중)**

- **ENABLE_OPENAI_API** — OpenAI 호환 API 사용 토글.
- **OPENAI_API_BASE_URL / \_URLS** + **OPENAI_API_KEY / \_KEYS** — 다중 base URL·키(`;` 구분). vLLM·OpenRouter·LM Studio·Groq·Mistral 등 모두 여기로.
- **OPENAI_API_CONFIGS** — 연결별 설정 JSON(enable·prefix_id·model_ids·tags 등).
- **ENABLE_OPENAI_API_PASSTHROUGH** — catch-all 프록시로 임의 요청 상류 전달(기본 False→403).

**Direct Connections (실험적)**

- **ENABLE_DIRECT_CONNECTIONS** — 사용자가 브라우저에서 OpenAI 호환 엔드포인트로 직접 연결(백엔드 우회, 키는 브라우저 로컬 저장). CORS 필요.

**Tool Servers (외부 도구 서버)**

- **TOOL_SERVER_CONNECTIONS** — OpenAPI/MCPO 프로토콜 외부 도구 서버 연결 JSON 배열(관리자 설정).
- **Native HTTP MCP** — HTTP/SSE MCP 서버 직접 연결(`Settings > Connections`).
- **MCPO (Proxy)** — stdio 기반 MCP 서버를 MCPO 어댑터로 브릿지.
- **OpenAPI Servers** — REST/OpenAPI 스펙을 ingest 해 엔드포인트를 도구로 취급.
- **MCP_INITIALIZE_TIMEOUT** — MCP handshake 타임아웃(기본 10s).
- **AIOHTTP_CLIENT_TIMEOUT_TOOL_SERVER / \_DATA / \_SSL** — 도구 서버 실행·메타데이터·SSL 검증 설정.

**Terminal Server**

- **TERMINAL_SERVER_CONNECTIONS** — Open Terminal / 오케스트레이터 연결(관리자 설정, URL·키가 브라우저에 노출 안됨, group access_grants 지원).
- **TERMINAL_PROXY_HEADERS** — 터미널 프록시 응답 헤더 주입.

**모델 리스트 캐싱**

- **ENABLE_BASE_MODELS_CACHE** — 연결된 Ollama/OpenAI 모델 목록 메모리 캐시(Connections > "Cache Base Model List").
- **MODELS_CACHE_TTL** — 모델 목록 캐시 TTL(초, 기본 1).

---

## 3. 문서 / RAG (Documents)

출처: `docs/features/chat-conversations/rag/index.md`, `env-configuration#retrieval-augmented-generation-rag`, `#rag-content-extraction-engine`, `#vector-database`

**임베딩 엔진**

- **RAG_EMBEDDING_ENGINE** — 로컬 SentenceTransformers(기본) / Ollama / OpenAI / Azure OpenAI 선택.
- **RAG_EMBEDDING_MODEL** — 임베딩 모델(기본 `all-MiniLM-L6-v2`).
- **RAG_EMBEDDING_BATCH_SIZE / \_OPENAI_BATCH_SIZE** — 외부 provider 배치 크기.
- **ENABLE_ASYNC_EMBEDDING** + **RAG_EMBEDDING_CONCURRENT_REQUESTS** — 병렬 임베딩·동시요청 제한.
- **RAG_EMBEDDING_CONTENT_PREFIX / \_QUERY_PREFIX / \_PREFIX_FIELD_NAME** — nomic 등 task-prefix 모델 지원.
- **RAG_OPENAI/\_OLLAMA/_AZURE_OPENAI_ 계열** — RAG 전용 임베딩 엔드포인트·키·버전.
- **RAG_EMBEDDING_TIMEOUT** — 로컬 임베딩 타임아웃.

**청크(Chunk) 설정**

- **CHUNK_SIZE / CHUNK_OVERLAP** — 청크 크기(기본 1000)·중첩(기본 100).
- **CHUNK_MIN_SIZE_TARGET** — 작은 청크를 이웃과 지능형 병합(마크다운 헤더 스플리터 필요).
- **RAG_TEXT_SPLITTER** — `character`(기본) / `token`(Tiktoken 또는 `RAG_TOKENIZER_MODEL` HF 토크나이저).
- **ENABLE_MARKDOWN_HEADER_TEXT_SPLITTER** — H1–H6 헤더 우선 분할(구조 보존).
- **TIKTOKEN_CACHE_DIR / \_ENCODING_NAME** — Tiktoken 캐시·인코딩(cl100k_base).
- **PDF_LOADER_MODE / PDF_EXTRACT_IMAGES** — PDF page/single 모드, OCR 이미지 추출.

**Top-K / Hybrid / Rerank**

- **RAG_TOP_K** (기본 3) / **RAG_TOP_K_RERANKER** / **RAG_RELEVANCE_THRESHOLD**.
- **ENABLE_RAG_HYBRID_SEARCH** — BM25 + 벡터 하이브리드 검색(+옵션 rerank).
- **RAG_HYBRID_BM25_WEIGHT** — 키워드 검색 가중치(0=벡터만, 1=키워드만).
- **ENABLE_RAG_HYBRID_SEARCH_ENRICHED_TEXTS** — 파일명·제목·섹션 메타데이터로 BM25 강화.
- **RAG_RERANKING_ENGINE** — 로컬 CrossEncoder(기본) 또는 `external`.
- **RAG_RERANKING_MODEL / \_BATCH_SIZE** + **RAG_EXTERNAL_RERANKER_URL / \_API_KEY / \_TIMEOUT** — 리랭킹 모델·외부 API.
- **ENABLE_KB_EXEC** — 모델이 지식베이스에 셸 스타일(`ls/tree/grep/cat/head` + 파이프) 접근하는 `kb_exec` 도구(native mode).

**RAG 템플릿 / Query Gen**

- **RAG_TEMPLATE** — 검색 컨텍스트 포맷팅 템플릿(`{{CONTEXT}}` 자리표시자, Admin > Documents 편집).
- **ENABLE_QUERIES_CACHE** — 웹검색용 생성 쿼리를 RAG 검색에 재사용(중복 LLM 호출 제거).
- **RAG_FULL_CONTEXT / RAG_SYSTEM_CONTEXT / BYPASS_EMBEDDING_AND_RETRIEVAL** — 전체컨텍스트·시스템메시지 주입(KV 캐시 유지)·임베딩 우회.

**Content Extraction 엔진 (다수)**

- **CONTENT_EXTRACTION_ENGINE** — 문서 파싱 엔진 선택.
- **Apache Tika** (`TIKA_SERVER_URL`) — 범용 문서 추출.
- **Docling** (`DOCLING_SERVER_URL`·`DOCLING_API_KEY`·`DOCLING_PARAMS`) — 고급 레이아웃 파싱.
- **Mistral OCR** (`MISTRAL_OCR_API_KEY`·`_BASE_URL`·`_USE_BASE64`) — OCR.
- **Azure Document Intelligence** (`DOCUMENT_INTELLIGENCE_ENDPOINT`·`_KEY`·`_MODEL`).
- **MinerU** (`MINERU_FILE_EXTENSIONS`·`_PARAMS`·`_MAX_MARKDOWN_BYTES`·`_API_TIMEOUT`) — OCR/수식/표.
- **PaddleOCR-VL** (`PADDLEOCR_VL_BASE_URL`·`_TOKEN`) — 레이아웃 파싱.
- **External Document Loader** (`EXTERNAL_DOCUMENT_LOADER_URL`·`_API_KEY`·`_HEADERS`) — 커스텀 로더.

**업로드 제한**

- **RAG_FILE_MAX_SIZE / RAG_FILE_MAX_COUNT** — 파일당 최대 MB·동시 업로드 수.
- **RAG_ALLOWED_FILE_EXTENSIONS** — 허용 확장자 화이트리스트.
- **RAG_FILE_CONTENT_SEARCH_MAX_CHARS** — 콘텐츠 검색 스캔 상한(기본 64 MiB).
- **FILE_IMAGE_COMPRESSION_WIDTH / \_HEIGHT** — 업로드 이미지 압축 크기.
- **FOLDER_MAX_FILE_COUNT** — 폴더당 처리 파일 수.

**Vector DB (다수)**

- **VECTOR_DB** — chroma(기본)/elasticsearch/milvus/mariadb/opensearch/pgvector/qdrant/pinecone/weaviate/oracle23ai/s3/valkey.
- **ChromaDB** — 로컬 또는 원격(`CHROMA_HTTP_HOST` 등, 멀티워커 필수).
- **PGVector** — `PGVECTOR_DB_URL`, HNSW/IVFFlat 인덱스, `halfvec`, pgcrypto 암호화, 풀 설정.
- **Milvus** — HNSW/AUTOINDEX/IVF/DISKANN, 멀티테넌시 모드.
- **Qdrant** — gRPC, on-disk, 멀티테넌시(기본 True).
- **Elasticsearch / OpenSearch / Weaviate / Pinecone / MariaDB Vector / Oracle 23ai / S3 Vector Bucket / Valkey** — 각 URL·인증·인덱스 파라미터.

**External Knowledge Sources (외부 벡터DB 직결, 실험적)**

- **External KB** — Qdrant/Milvus/pgvector 외부 DB를 재-임베딩 없이 직접 쿼리. Admin > Integrations > External Knowledge Sources 에서 Provider·Endpoint·API Key·Collection·필드 매핑(Content/Title/Source/URL/Doc ID/Page/Metadata/Score)·Test query.

**Reindex / 설정 변경**

- **Reindex** — 임베딩 모델 변경 시 필수. 벡터 컬렉션 삭제→재청크→재임베딩(Admin > Documents > Reindex 버튼). 청크 설정만 변경 시엔 선택적. standalone 채팅 파일은 재인덱스 대상 아님(재업로드 필요).

**외부 소스 연동**

- **Google Drive** (`ENABLE_GOOGLE_DRIVE_INTEGRATION`·`GOOGLE_DRIVE_CLIENT_ID`·`_API_KEY`) — Picker/Drive API 연동, 채팅에서 Drive 파일 업로드.
- **OneDrive** (`ENABLE_ONEDRIVE_INTEGRATION`, Personal/Business 분리, `ONEDRIVE_CLIENT_ID_PERSONAL/_BUSINESS`, `ONEDRIVE_SHAREPOINT_URL/_TENANT_ID`).
- **YouTube Loader** (`YOUTUBE_LOADER_LANGUAGE`·`_PROXY_URL`) — 영상 자막 RAG.
- **Citations** — LLM에 투입된 문서 컨텍스트 추적용 인용 표기.

---

## 4. 웹검색 (Web Search)

출처: `docs/features/chat-conversations/web-search/index.mdx`, `env-configuration#web-search`

**핵심 제어**

- **ENABLE_WEB_SEARCH** — 웹검색 토글(기본 False).
- **WEB_SEARCH_ENGINE** — 검색 provider 선택.
- **WEB_SEARCH_RESULT_COUNT** — 크롤할 결과 수(기본 3, native 모드 상한).
- **WEB_SEARCH_CONCURRENT_REQUESTS / WEB_LOADER_CONCURRENT_REQUESTS** — 검색·로더 동시요청.
- **WEB_SEARCH_DOMAIN_FILTER_LIST** — 도메인 allowlist/`!`blocklist.
- **WEB_FETCH_FILTER_LIST** — SSRF 방어 URL 필터(클라우드 메타데이터 기본 차단).
- **ENABLE_WEB_SEARCH_CONFIRMATION** + `WEB_SEARCH_CONFIRMATION_CONTENT` — 검색 실행 전 사용자 확인 프롬프트.
- **BYPASS_WEB_SEARCH_EMBEDDING_AND_RETRIEVAL / \_WEB_LOADER** — 임베딩·전체페이지 로딩 우회(스니펫만).
- **WEB_FETCH_MAX_CONTENT_LENGTH** — 가져온 페이지 문자 상한.

**검색 엔진 (수십 종)**

- **SearXNG** (`SEARXNG_QUERY_URL`·`_LANGUAGE`) · **Google PSE** (`GOOGLE_PSE_API_KEY`·`_ENGINE_ID`) · **Brave** & **Brave LLM Context** (`BRAVE_SEARCH_API_KEY`·`BRAVE_SEARCH_CONTEXT_TOKENS`) · **Kagi** · **Mojeek** · **Serpstack** · **Serper** · **Serply** · **SearchAPI** (`SEARCHAPI_ENGINE`) · **SerpAPI** (`SERPAPI_ENGINE`) · **SerpHouse** (`SERPHOUSE_DOMAIN`) · **Tavily** (`TAVILY_EXTRACT_DEPTH`) · **Linkup** (`LINKUP_SEARCH_PARAMS`) · **Jina** (`JINA_API_BASE_URL`) · **Bing v7** · **Bocha** · **Exa** · **Azure AI Search** (`AZURE_AI_SEARCH_ENDPOINT`·`_INDEX_NAME`) · **Sogou** (`SOUGOU_API_SID/_SK`) · **Ollama Cloud** (`OLLAMA_CLOUD_API_KEY`) · **YaCy** (user/pass) · **Yandex** (`YANDEX_WEB_SEARCH_CONFIG`) · **Perplexity** & **Perplexity Search** (`PERPLEXITY_MODEL`·`_SEARCH_CONTEXT_USAGE`) · **You.com** (`YOUCOM_API_KEY`) · **Microsoft Web IQ** (`MICROSOFT_WEB_IQ_API_KEY`·`_LANGUAGE`) · **DDGS** (`DDGS_BACKEND`) · **External Web Search** (`EXTERNAL_WEB_SEARCH_URL`·`_API_KEY`).

**Loader 엔진**

- **WEB_LOADER_ENGINE** — 페이지 스크래핑 로더 선택.
- **Playwright** (`PLAYWRIGHT_WS_URL`·`_TIMEOUT`) — 원격 브라우저.
- **Firecrawl** (`FIRECRAWL_API_BASE_URL`·`_API_KEY`·`_TIMEOUT`).
- **External Web Loader** (`EXTERNAL_WEB_LOADER_URL`·`_API_KEY`).
- **WEB_SEARCH_TRUST_ENV / WEB_LOADER_TIMEOUT / USER_AGENT** — 프록시 신뢰·타임아웃·UA 위장(봇 차단 회피).
- **Agentic Search** — native 모드에서 모델이 `search_web` 도구를 스스로 호출.

---

## 5. 오디오 (Audio: STT/TTS/Voice)

출처: `docs/features/chat-conversations/audio/`, `env-configuration#audio`

**STT (Speech-to-Text)**

- **AUDIO_STT_ENGINE** — 로컬 Whisper(기본 빈값) / OpenAI / Azure / Deepgram / Mistral.
- **Whisper (로컬)** — `WHISPER_MODEL`(기본 base), `_COMPUTE_TYPE`(int8/float16), `_VAD_FILTER`, `_LANGUAGE`, `_MULTILINGUAL`, `_MODEL_DIR`.
- **OpenAI STT** — `AUDIO_STT_MODEL`(whisper-1), `_OPENAI_API_BASE_URL/_KEY`, `_REQUEST_FORMAT`(multipart/json).
- **Azure STT** — `AUDIO_STT_AZURE_API_KEY`·`_REGION`·`_LOCALES`·`_MAX_SPEAKERS`(diarization).
- **Deepgram** (`DEEPGRAM_API_KEY`) · **Mistral** (`AUDIO_STT_MISTRAL_API_KEY`·`_USE_CHAT_COMPLETIONS`).
- **AUDIO_STT_SUPPORTED_CONTENT_TYPES / \_ALLOWED_EXTENSIONS** — 허용 MIME·확장자.
- **BYPASS_PYDUB_PREPROCESSING** — pydub 전처리(변환·분할) 건너뛰기.

**TTS (Text-to-Speech)**

- **AUDIO_TTS_ENGINE** — 백엔드 TTS 엔진(빈값=브라우저 의존).
- **AUDIO_TTS_MODEL / \_VOICE / \_API_KEY / \_SPLIT_ON** — 모델(tts-1)·보이스(alloy)·분할 기준.
- **OpenAI TTS** (`AUDIO_TTS_OPENAI_API_BASE_URL/_KEY/_PARAMS`).
- **Azure TTS** (`AUDIO_TTS_AZURE_SPEECH_REGION`·`_OUTPUT_FORMAT`·`_BASE_URL`).
- **Mistral TTS** (`AUDIO_TTS_MISTRAL_API_KEY`·`_BASE_URL`) · **ElevenLabs** (`ELEVENLABS_API_BASE_URL`).
- 통합 문서 엔진: Kokoro-FastAPI / Kokoro-Web / Chatterbox / OpenAI-Edge-TTS / openedai-speech / Voxtral(STT).
- **per-model TTS Voice** — 모델 프리셋마다 고유 보이스 지정(§1).

**Voice Mode / Call**

- **ENABLE_VOICE_MODE_PROMPT** + `VOICE_MODE_PROMPT_TEMPLATE` — 음성 대화용 시스템 프롬프트(스타일/길이/톤).
- **AIOHTTP_CLIENT_SESSION_SSL** — STT/TTS 엔드포인트 SSL 검증(v0.9.6+).

---

## 6. 이미지 (Image Generation & Editing)

출처: `docs/features/chat-conversations/image-generation-and-editing/`, `env-configuration#image-generation`

**공통**

- **ENABLE_IMAGE_GENERATION** — 이미지 생성 토글(기본 False).
- **ENABLE_IMAGE_PROMPT_GENERATION** + `IMAGE_PROMPT_GENERATION_PROMPT_TEMPLATE` — 프롬프트 자동 향상.
- **IMAGE_GENERATION_ENGINE** — openai(기본)/comfyui/automatic1111/gemini.
- **IMAGE_GENERATION_MODEL / IMAGE_SIZE / IMAGE_STEPS** — 모델·크기(512x512, `auto` 지원)·iteration steps(50).
- **IMAGE_AUTO_SIZE_MODELS_REGEX_PATTERN / IMAGE_URL_RESPONSE_MODELS_REGEX_PATTERN** — auto 크기·URL 응답 모델 매칭.

**Image Editing**

- **ENABLE_IMAGE_EDIT** + **IMAGE_EDIT_ENGINE / \_MODEL / \_SIZE** — 기존 이미지 텍스트 프롬프트 편집.
- **ENABLE_OPENAI_IMAGE_EDIT_NORMALIZATION** — 입력 이미지 정규화.

**엔진별**

- **OpenAI DALL·E** — `IMAGES_OPENAI_API_BASE_URL`·`_API_KEY`·`_API_VERSION`(Azure)·`_API_PARAMS`(quality/style). 편집: `IMAGES_EDIT_OPENAI_*`.
- **Gemini** — `IMAGES_GEMINI_API_BASE_URL`·`_API_KEY`·`_ENDPOINT_METHOD`(Imagen/Gemini). 편집: `IMAGES_EDIT_GEMINI_*`.
- **ComfyUI** — `COMFYUI_BASE_URL`·`_API_KEY`·`COMFYUI_WORKFLOW`(API Format JSON)·`_WORKFLOW_NODES`(노드 매핑). 편집: `IMAGES_EDIT_COMFYUI_*`.
- **AUTOMATIC1111** — `AUTOMATIC1111_BASE_URL`·`_API_AUTH`·`_PARAMS`(cfg_scale/sampler/scheduler).
- 추가 문서 엔진: Image Router, Lumenfall.

---

## 7. 코드 실행 (Code Execution / Interpreter)

출처: `docs/features/chat-conversations/chat-features/code-execution/`, `env-configuration#code-execution`, `#code-interpreter`

- **ENABLE_CODE_EXECUTION** + **CODE_EXECUTION_ENGINE** — `pyodide`(브라우저) / `jupyter`(서버). 둘 다 **legacy**, 풀 접근은 Open Terminal 권장.
- **CODE_EXECUTION_JUPYTER_URL / \_AUTH / \_AUTH_TOKEN / \_AUTH_PASSWORD / \_TIMEOUT** — Jupyter 실행 설정.
- **ENABLE_PYODIDE_FILE_PERSISTENCE** — Pyodide 가상 파일시스템 리로드 간 영속(IndexedDB).
- **ENABLE_CODE_INTERPRETER** + **CODE_INTERPRETER_ENGINE** — Code Interpreter(agentic Python 실행).
- **CODE_INTERPRETER_BLACKLISTED_MODULES** — import 차단 모듈(보안).
- *_CODE_INTERPRETER_PROMPT_TEMPLATE / *JUPYTER*_ ** — 프롬프트·Jupyter 연결.
- **Artifacts / Mermaid / Python** — 코드 실행 결과 렌더링(HTML preview, 다이어그램).
- **Open Terminal** — 별도 격리 Docker 컨테이너 실셸(`run_command`·`read_file`·`grep_search` 등 built-in 도구). Code Interpreter 와 구분되는 코드실행·파일처리 환경.
- **IFRAME_CSP** — Artifacts/코드 프리뷰 iframe 에 CSP 주입(LLM 생성 HTML 네트워크 제약).

---

## 8. 확장 (Extensibility: Functions / Tools / Pipelines)

출처: `docs/features/extensibility/`, `env-configuration#install-required-python-packages`, `#security-variables`

**Functions (Admin, Python 플러그인) — 4종**

- **Pipe** (`class Pipe`) — 커스텀 모델/에이전트를 사이드바에 등록(non-OpenAI provider, 다단계 에이전트, non-LLM 인터페이스, manifold 다중모델).
- **Filter** (`class Filter`) — `inlet()`(요청 전)·`stream()`(스트림 청크)·`outlet()`(응답 후) 미들웨어. 번역·검열·PII 마스킹·로깅·rate limit. global/모델별/toggleable.
- **Action** (`class Action`) — 메시지 툴바에 커스텀 버튼 추가(요약·export·워크플로 트리거).
- **Event** (`class Event`, 0.10.0+) — 시스템 이벤트(가입·채팅삭제·서버시작·설정변경) 응답 Python 실행, 자체 API 등록 가능.
- **Type 자동 감지** — 클래스명으로 유형 판별. Frontmatter(title·version·icon_url·requirements 등)로 메타데이터·pip 의존성.
- **관리** — Admin Panel > Functions: Active/Global 토글, Valves(⚙️), Export/Delete, 커뮤니티/URL/수동 import.

**Tools (도구)**

- **Native Features** — Web Search·URL Fetch·Image Gen·Memory·RAG (native mode 에서 도구로 노출).
- **Workspace Tools** — in-process Python 스크립트(가장 강력, 서버 셸 접근급 권한, 신뢰 사용자만).
- **Native MCP / MCPO / OpenAPI** — 외부 도구 서버(§2 연결).
- **Builtin System Tools** — `query_knowledge_bases`·`view_knowledge_file`·`search_chats`·`kb_exec` 등(native/agentic mode).

**Pipelines (legacy)**

- **Pipelines** — 별도 워커 컨테이너 OpenAI-API 플러그인 프레임워크(pipe/filter). **현재 legacy**, Functions/Tools/외부 도구서버로 대체 권장. Connections 에 `http://host:9099` 연결, Pipelines 탭에서 valve 편집.

**Valve 암호화 & 플러그인 전역**

- **ENABLE_VALVE_ENCRYPTION** — Tool/Function Valve 값을 Fernet(AES-128)로 저장 시 암호화(API 키 등).
- **Valves / UserValves** — Pydantic 기반 2-tier 설정(Admin 전역 / 사용자별).
- **ENABLE_PLUGINS** — Tools/Functions 전체 실행면 마스터 스위치(SAFE_MODE 보다 강함).
- **ENABLE_PIP_INSTALL_FRONTMATTER_REQUIREMENTS / PIP_OPTIONS / PIP_PACKAGE_INDEX_OPTIONS** — frontmatter requirements 자동 pip 설치·옵션.
- **SAFE_MODE** — 모든 Functions 비활성화.
- **ENABLE_API_OUTLET_FILTERS** — 직접 API 호출에도 outlet 필터 적용.

---

## 9. 평가 (Evaluation: Arena / Elo / Rating)

출처: `docs/features/administration/evaluation/index.mdx`, `env-configuration#evaluation-arena-model`

- **Arena Model** (`EVALUATION_ARENA_MODELS`, `ENABLE_EVALUATION_ARENA_MODELS`) — 풀에서 모델 무작위 선택해 blind 비교(ecological validity 제거). Chatbot Arena 스타일 재현 가능.
- **Thumbs up/down Rating** (`ENABLE_MESSAGE_RATING`) — 채팅 중 응답 평가. sibling message(재생성/side-by-side)가 있어야 리더보드 반영.
- **Elo Leaderboard** — Admin Panel 리더보드, 체스식 Elo 랭킹. 두 다른 모델 비교만 순위에 영향.
- **Model Activity Chart** — 모델별 승/패 다이버징 차트(30D/1Y/All, 주간 집계), 상세 평가 모달.
- **Topic Tagging** — 채팅을 주제별 태그(자동/수동)해 도메인별(고객서비스·기술지원 등) re-ranking.
- **Chat Snapshots** — 평가 시 대화 스냅샷 캡처(향후 fine-tuning용, 개발중).
- **ENABLE_COMMUNITY_SHARING** — 커뮤니티 공유/리소스 접근 UI 노출. 평가 데이터는 기본적으로 인스턴스 내 보관.

---

## 10. 분석 (Analytics)

출처: `docs/features/administration/analytics/index.mdx`

- **Analytics 탭** (`ENABLE_ADMIN_ANALYTICS`) — Admin 전용 사용량·토큰·모델 인사이트. `chat_message` 테이블 기반(backfill + dual-write).
- **Time Period** — 24h/7d/30d/90d/All(24h=시간별 granularity), 브라우저 세션 간 유지.
- **Group Filtering** — RBAC 그룹별 필터(부서 리포팅·비용 배분·파일럿 모니터링).
- **Summary Stats** — Total Messages(assistant 응답 수)·Tokens(input+output)·Chats·Users.
- **Message Timeline Chart** — 시간대별 메시지량, 모델별 최대 8종 색상 구분, hover 툴팁.
- **Model Usage Table** — 모델별 messages·tokens·% 랭킹(정렬), 클릭 시 상세 모달.
- **Model Details Modal** — Overview(피드백 활동 차트 30D/1Y/All, 상위 태그) + Chats 탭(`ENABLE_ADMIN_CHAT_ACCESS` 필요).
- **User Activity Table** — 사용자별 messages·tokens(power user·per-user 비용).
- **Token Usage Tracking** — input/output/total 토큰 정규화(OpenAI·Ollama·llama.cpp), 비용 추정.
- **API Endpoints** — `/api/v1/analytics/{summary,models,users,messages,daily,tokens}`(admin bearer, start_date·end_date·group_id).

---

## 11. DB / 스토리지 / 플랫폼 (Platform)

출처: `env-configuration#misc-environment-variables`, `#logging`, `#security-variables`

**데이터베이스**

- **DATABASE_URL / DATABASE_TYPE** — SQLite(기본) / PostgreSQL / sqlite+sqlcipher. 개별 파라미터(`DATABASE_USER/PASSWORD/HOST/PORT/NAME`)로도 구성.
- **ENABLE_DB_MIGRATIONS** — 시작 시 마이그레이션(멀티팟은 1개만 master).
- **DATABASE_ENABLE_IAM_TOKEN_AUTH** — AWS RDS IAM 토큰 인증(Postgres).
- **DB Pool** — `DATABASE_POOL_SIZE/_MAX_OVERFLOW/_TIMEOUT/_RECYCLE`, `DATABASE_ENABLE_SESSION_SHARING`.
- **Encrypted SQLite (SQLCipher)** + **WAL/PRAGMA** — `DATABASE_ENABLE_SQLITE_WAL`, `_PRAGMA_SYNCHRONOUS/_BUSY_TIMEOUT/_CACHE_SIZE/_TEMP_STORE/_MMAP_SIZE/_JOURNAL_SIZE_LIMIT`.

**Object Storage**

- **STORAGE_PROVIDER** — local(기본)/s3/gcs/azure, `STORAGE_LOCAL_CACHE`.
- **S3** — `S3_ACCESS_KEY_ID`·`_SECRET_ACCESS_KEY`·`_BUCKET_NAME`·`_ENDPOINT_URL`·`_REGION_NAME`·`_KEY_PREFIX`·`_ADDRESSING_STYLE`·`_USE_ACCELERATE_ENDPOINT`·`_ENABLE_TAGGING`(R2는 False).
- **GCS** — `GOOGLE_APPLICATION_CREDENTIALS_JSON`·`GCS_BUCKET_NAME`.
- **Azure** — `AZURE_STORAGE_ENDPOINT`·`_CONTAINER_NAME`·`_KEY`.

**Redis / Websocket**

- **REDIS_URL** — 앱 상태 저장(멀티워커 필수), `REDIS_KEY_PREFIX`·Sentinel(`REDIS_SENTINEL_HOSTS/_PORT`)·Cluster(`REDIS_CLUSTER`).
- **WEBSOCKET_MANAGER=redis** + `WEBSOCKET_REDIS_URL`·Sentinel·Cluster·`_OPTIONS` — 실시간 채팅 상태 공유.
- **ENABLE_WEBSOCKET_SUPPORT / \_SERVER_LOGGING / \_PING_TIMEOUT / \_PING_INTERVAL / \_EVENT_CALLER_TIMEOUT** — 웹소켓 튜닝.
- **ENABLE_STAR_SESSIONS_MIDDLEWARE** — OAuth 세션 Redis 저장(멀티레플리카 CSRF 해결).

**OpenTelemetry (관측성)**

- **ENABLE_OTEL** (+ `_TRACES/_METRICS/_LOGS`) — traces·metrics·logs OTLP 수집·export.
- **OTEL_EXPORTER_OTLP_ENDPOINT** (+ metrics/logs 전용) · `_INSECURE` · `_SERVICE_NAME`(open-webui) · `_RESOURCE_ATTRIBUTES` · `_TRACES_SAMPLER` · basic auth · `_METRICS_EXPORT_INTERVAL_MILLIS` · gRPC/HTTP 프로토콜.

**감사 로그 & 로깅**

- **Audit Logs** — `AUDIT_LOG_LEVEL`(NONE/METADATA/REQUEST/REQUEST_RESPONSE), `ENABLE_AUDIT_LOGS_FILE`·`ENABLE_AUDIT_STDOUT`, `AUDIT_LOGS_FILE_PATH`·`_ROTATION_SIZE`, `AUDIT_EXCLUDED/INCLUDED_PATHS`, `MAX_BODY_LOG_SIZE`.
- **GLOBAL_LOG_LEVEL / LOG_FORMAT** — 로그 레벨·JSON 구조화 로깅(Loki/Datadog).

**Persistent Config & 플랫폼 일반**

- **ENABLE_PERSISTENT_CONFIG** — DB 저장 설정을 env 보다 우선(대부분 설정이 ConfigVar, Admin UI 에서 변경).
- **RESET_CONFIG_ON_START** — 시작 시 config.json 리셋.
- **WEBUI_URL / WEBUI_NAME / PORT / DEFAULT_LOCALE** — 기본 URL·이름·포트·로케일.
- **UVICORN_WORKERS / THREAD_POOL_SIZE** — 워커 프로세스·블로킹 스레드풀.
- **WEBUI_SECRET_KEY** — JWT 서명·민감데이터 암호화(OAuth 토큰 포함).
- **CACHE_CONTROL / ENABLE_COMPRESSION_MIDDLEWARE / CORS_ALLOW_ORIGIN** — HTTP 캐시·gzip·CORS.
- **LICENSE_KEY / OFFLINE_MODE / ENABLE_VERSION_UPDATE_CHECK** — 엔터프라이즈 라이선스·오프라인·업데이트 체크.
- **STT/TTS/Whisper/Embedding용 CUDA** — `USE_CUDA_DOCKER`·`DEVICE_TYPE`.

---

## 12. 웹훅 & 배너 (Webhooks & Banners)

출처: `docs/features/administration/webhooks.md`, `docs/features/administration/banners.md`

**Webhooks (3종)**

- **Admin Webhook** (`WEBHOOK_URL`) — 신규 사용자 가입 알림(Discord/Slack/Teams), payload `{event:"new_user", user:{email,name}}`. Admin > Settings > General > "Webhook URL".
- **User Webhook** (`ENABLE_USER_WEBHOOKS`, 기본 False) — 사용자별 장시간 작업 응답 완료 알림(탭 비활성 시에만). Settings > Account 에서 개인 URL. SSRF: 사설 IP는 `ENABLE_RAG_LOCAL_WEB_FETCH` 없으면 차단.
- **Channel Webhooks** — 외부 서비스가 특정 채널로 메시지 POST(incoming).

**Banners**

- **WEBUI_BANNERS** — 로그인 사용자 대상 공지 배너(JSON 배열). Admin > Settings > General > Banners(+아이콘).
- **Banner 속성** — `id`(dismiss 추적)·`type`(info/success/warning/error)·`title`·`content`(HTML)·`dismissible`·`timestamp`. dismiss 는 브라우저 클라이언트 저장(id 변경 시 재노출).
- **CALENDAR_ALERT / SCHEDULER** — 캘린더 이벤트 alert 토스트·웹훅 알림(`CALENDAR_ALERT_LOOKAHEAD_MINUTES`, `SCHEDULER_POLL_INTERVAL`).
- **RESPONSE_WATERMARK** — 메시지 복사 시 삽입되는 워터마크 텍스트.

---

## 주요 출처 URL

- 환경변수 단일 정본: https://docs.openwebui.com/reference/env-configuration/ (raw: `raw.githubusercontent.com/open-webui/docs/main/docs/reference/env-configuration.mdx`)
- 모델: https://docs.openwebui.com/features/workspace/models/
- 연결(Direct/Tool): https://docs.openwebui.com/features/chat-conversations/direct-connections , https://docs.openwebui.com/features/extensibility/plugin/tools/
- RAG: https://docs.openwebui.com/features/chat-conversations/rag/
- 웹검색: https://docs.openwebui.com/features/chat-conversations/web-search/
- 오디오/이미지: https://docs.openwebui.com/features/chat-conversations/audio/ , https://docs.openwebui.com/features/chat-conversations/image-generation-and-editing/
- 코드실행/터미널: https://docs.openwebui.com/features/chat-conversations/chat-features/code-execution/ , https://docs.openwebui.com/features/open-terminal/
- 확장(Functions/Pipelines): https://docs.openwebui.com/features/extensibility/plugin/functions/ , https://docs.openwebui.com/features/extensibility/pipelines/
- 평가/분석/배너/웹훅: https://docs.openwebui.com/features/administration/evaluation/ , /analytics/ , /banners , /webhooks

(주: 위 docs.openwebui.com 페이지는 직접 fetch 시 403이라 모두 raw.githubusercontent.com 경로로 원문 확인함. env-configuration 763개 변수 전량과 각 기능 문서를 파싱해 정리했으며, 스크래치패드 파싱 파일 경로: `/private/tmp/claude-501/-Users-iremain-Documents-claudecode-W-Chat/64bacf93-0494-40ea-b380-54f2ac69fe8c/scratchpad/env_parsed.txt`)
