# 19 — UI/UX Upgrade: 상용 수준 Agentic Chat (Phase P10)

> 목적: WChat 채팅 UI/UX 를 **상용 엔터프라이즈 에이전틱 챗봇(ChatGPT / Claude / Gemini Agentspace / Copilot / Perplexity)** 수준으로 끌어올린다.
> 근거: 2026 상용 제품·에이전트 프레임워크 딥리서치(기능 최소기준 + UI/UX 패턴) + 현 코드/계약/루프 감사.
> 이 문서는 신규 **Phase P10** 의 단일 출처(개발 계획)다. 태스크 목록은 [08-SPRINT-PLAN.md](08-SPRINT-PLAN.md) § Phase 10 과 `feature_list.json` 의 `P10-*` 항목, 실행 프롬프트는 `PROMPT.P10.md`.

---

## 19.1 목표 & 성공 기준

**목표**: 사용자가 ChatGPT/Claude 를 쓰다 WChat 으로 와도 "격차 없다"고 느끼는 채팅 경험. 단순 외형이 아니라 **에이전틱 동작이 실제로 살아 움직이는**(툴콜·인용·아티팩트·HITL 승인이 실 데이터로 렌더) 수준.

**성공 기준 (Definition of Done, Phase Gate)**

- G1. 3분할 앱 셸(사이드바+본문+우패널) + 대화 히스토리 + 라이트/다크 토글이 모든 인증 화면에 적용된다.
- G2. 메시지: assistant 풀폭 문서형 + 코드 문법하이라이트/복사 + 표/수식/mermaid + hover 액션(복사/재생성/피드백).
- G3. 스트리밍: 중단·추론 접이식·강제스크롤 없음·"최신으로↓"·shimmer, 그리고 **aria-live 디바운스**로 스크린리더 대응(WCAG 2.2 AA).
- G4. 에이전틱 라이브: 실제 turn 에서 **tool_use/tool_result 카드**, **HITL 승인 카드**, **citation 칩+소스**, **artifact 패널**이 서버가 emit 한 실 이벤트로 렌더된다.
- G5. 컴포저: 첨부(드래그/붙여넣기/업로드) + 슬래시/@멘션 + 모델·모드 피커.
- G6. 대화관리/신뢰: 프로젝트 스코핑·메모리 노출·메시지 편집/분기(트리)·공유/내보내기·원인별 에러+재시도+토스트+재연결.
- G7. 커버리지: web ≥ 60%, server ≥ 80% 유지([09-TDD-GUIDE.md](09-TDD-GUIDE.md)). 모든 신규 behavior 는 RED-first.
- G8. **브라우저 검증**: 모든 FE 태스크는 실제 headless 브라우저(Playwright)로 렌더/인터랙션이 검증되고 스크린샷이 남는다(§19.4.1). jsdom/RTL 로는 Tailwind 컴파일·CSS·rehype·테마 실렌더를 못 잡는다.

---

## 19.2 연구 요약 — 2026 상용 에이전틱 챗봇 최소 기준

딥리서치가 도출한 "상용급으로 불릴 최소 기준"(약 21항목) 중 **본 UI/UX phase 가 다루는 범위**와 **이미 보유/후속 phase** 를 구분한다.

| #   | 최소기준 항목                                             | WChat 현재                                     | P10 대상                         |
| --- | --------------------------------------------------------- | ---------------------------------------------- | -------------------------------- |
| 1   | 에이전트 루프(plan→tool→observe→iterate)                  | orchestrator passthrough(툴 미실행)            | ✅ P10-T2-01                     |
| 2   | 타입드 툴콜 + 병렬 + tool_choice                          | LLMProvider tool_use emit 만, 실행 루프 없음   | ✅ P10-T2-01                     |
| 3   | MCP 커넥터                                                | mcp-servers CRUD + discovery + SSRF 가드 보유  | 렌더 라벨만(P10-T6-07)           |
| 4   | 서브에이전트 위임                                         | 없음                                           | ✖ 후속(E)                        |
| 5   | 상태영속/체크포인트                                       | active_runs + run-registry 보유                | 유지                             |
| 6   | 백그라운드/비동기 태스크                                  | 없음                                           | ✖ 후속(E)                        |
| 7   | HITL 승인 게이트                                          | 계약만(hitl_* 미emit)                          | ✅ P10-T2-02 / T6-08             |
| 8   | 중단/스티어링 + 스텝 트레이스                             | abort 보유, 트레이스 UI 없음                   | ✅ P10-T6-05/07                  |
| 9   | 최소권한 스코핑                                           | RLS multi-tenant + prompt 4-tier 보유          | 유지                             |
| 10  | 문서업로드/커넥터                                         | uploads/documents + parser + embedding 보유    | 첨부 UI(P10-T6-11 / T2-06)       |
| 11  | 소스 ACL 트리밍 검색                                      | RLS 기반 보유                                  | 유지                             |
| 12  | 검증가능 인용                                             | citation 계약만(미emit)                        | ✅ P10-T2-03 / T6-09             |
| 13  | per-project 지식 + 하이브리드 검색                        | knowledge/RAG 보유                             | 스코핑 UI(P10-T6-14)             |
| 14  | 아티팩트/캔버스                                           | ArtifactPanel 컴포넌트만, 채팅 미연동          | ✅ P10-T2-04/05 / T6-10          |
| 15  | 크로스세션 메모리                                         | memories CRUD + extractor/retriever 보유       | 노출 UI(P10-T6-14)               |
| 16  | 프로젝트/스페이스 + 검색 + 공유                           | projects + share 계약 보유                     | 사이드바/스코핑(P10-T6-02/14/16) |
| 17  | SSO/SCIM/RBAC/멀티테넌트                                  | magic-link + RLS + admin 보유(SSO/SCIM 미도입) | ✖ 거버넌스 phase(별도)           |
| 18  | 감사로그/DLP/레지던시/리텐션                              | error/usage/quota + admin 보유(DLP 미도입)     | ✖ 거버넌스 phase(별도)           |
| 19  | 컴플라이언스 + prompt-injection 방어                      | SSRF 가드 보유(분류기 미도입)                  | ✖ 거버넌스 phase(별도)           |
| 20  | 관측/평가/피드백 루프                                     | usage/quota/admin metrics 보유                 | 피드백 UI(P10-T6-03 thumbs)      |
| 21  | 모델 피커 + 스트리밍 + 멀티모달 + 재생성/편집 + 인용 렌더 | 스트리밍만                                     | ✅ P10-T6-03/13/15               |

**결론**: 백엔드 계약·데이터·인프라는 대부분 이미 존재한다. 상용 "체감"의 공백은 **(a) 프론트 렌더/인터랙션(T6)** 과 **(b) turn 중 이벤트 emit(T2)** 두 곳에 집중된다. 엔터프라이즈 거버넌스(#17~19)는 UI/UX 초점 밖 — 별도 로드맵으로 분리(§19.8).

---

## 19.3 현 상태 갭 분석 (감사 결과)

- **셸 부재**: `app/layout.tsx` 는 빈 `<html><body>` — AppShell·사이드바·테마토글·z-index 토큰·Pretendard 실제 로드 없음. 디자인 토큰(`globals.css @theme`)은 [DESIGN.md](../apps/web/DESIGN.md) 와 drift 없이 견고하나 다크는 `prefers-color-scheme` 뿐(수동 토글 미배선).
- **채팅 UI 는 Phase-2 최소본**: `components/chat/` 에 `ChatView` + `Markdown` 2파일뿐. `useSessionStream` 이 `ChatEvent` 를 4변형(message_start/text_delta/stop/error)으로 **의도적으로 축소** — 주석에 "tool_use/hitl_*/citation/artifact_created/message_replace 는 Phase 3/4 이후 확장".
- **서버 emit 공백**: `ChatEvent` 12변형은 [14-INTERFACES.md](14-INTERFACES.md) 에 **동결(frozen)**. 그러나 `orchestrator.runTurn` 은 provider 출력 passthrough라 실제로는 `tool_use`(anthropic provider) 외 `tool_result`/`hitl_*`/`citation`/`artifact_created`/`message_replace` 를 **emit 하지 않는다**. 첨부는 현재 `400 ATTACHMENTS_NOT_SUPPORTED`.
- **미연동 자산**: `ArtifactPanel`·`Pdf/PptxRenderer`, `settings/{Memory,Mcp,Skills}Manager` 등은 존재하나 채팅과 미연동 또는 시각적으로 barebones.

---

## 19.4 아키텍처 원칙 (교차 관심사 — 모든 P10 태스크에 적용)

리서치가 도출한 상용급 구현의 핵심 5원칙 + WChat 특수 제약 2가지. 각 태스크 구현 시 준수한다.

1. **패턴 채택 → WIA 토큰화**: Vercel AI Elements / shadcn 계열의 검증된 컴포넌트 분류(Message/Conversation/Response/Tool/Reasoning/Confirmation/InlineCitation/Artifact …)를 **참조 taxonomy** 로 삼되, 스타일은 반드시 시맨틱 토큰(`bg-primary`·`text-accent`·`border-border` …)으로. **하드코딩 hex 금지**([DESIGN.md](../apps/web/DESIGN.md)). 외부 CDN/폰트 링크 금지(로컬 self-host).
2. **메시지 = 트리 데이터모델(day-one)**: 편집/분기와 아티팩트 버전을 위해 메시지 스토어를 처음부터 트리(부모 포인터 + 활성 경로)로 설계. 나중 리트로핏 금지.
3. **단일 AbortController 관통**: 컴포저 Stop → 스트리밍 → 툴/에이전트 체인 전체를 하나의 signal 로 취소. 부분 출력은 유지·재생성 가능.
4. **tool/reasoning/text = 순서있는 message-parts**: 세 종류를 1급 "parts" 로 모델링해 스트림 순서대로 인터리브 렌더(툴카드가 발화 위치에 삽입). `stop.reason==="tool_use"` 는 **비종결** — 입력 재활성화 금지, resume 스트림 재연결.
5. **접근성·지연체감 내장**: `aria-live="polite"` + `aria-atomic="false"` + `role="log"` + **디바운스 announce**, 강제 오토스크롤 금지(하단일 때만 추종, 벗어나면 "최신으로↓"), 첫 토큰 <~300ms 체감(shimmer/optimistic). a11y 를 나중에 붙이지 말 것.
6. **[WChat] 동결 계약에만 맞춘다**: 신규 타입은 [14-INTERFACES.md](14-INTERFACES.md) 의 `ChatEvent` 12변형 등 **기존 정의만** 사용. `packages/interfaces/**`·`packages/shared/**` 및 Phase-0.5 소유 파일(`apps/web/src/lib/{api-client,api-types.generated}.ts` 등)은 **수정 금지** — 새 타입이 필요하면 태스크를 격리(`.ralph/blocked_tasks`)한다.
7. **[WChat] 서버 없이도 렌더러 완성**: T6 렌더러는 서버 emit 전에도 **동결 이벤트 shape 에 대한 SSE-frame 스텁**(`ChatView.test.tsx` 패턴: `fetch`→`ReadableStream` 로 `event: <type>\ndata: {...}\n\n` 주입)으로 RED-first 구축·검증한다. 대응 T2 태스크가 passes 되면 end-to-end 로 살아난다.

### 동결 `ChatEvent` 변형 (그대로 사용 — 신규 금지)

`message_start` · `message_replace` · `text_delta` · `tool_use` · `tool_result` · `hitl_request` · `hitl_resolved` · `hitl_timeout` · `citation` · `artifact_created` · `stop` · `error`. SSE 판별자는 `type`(=`event:` 라인), `data:` 는 `type` 제외 payload. (아티팩트 엔티티 종류는 `artifactKind` — 판별자 `type` 과 구분.)

### 19.4.1 브라우저 검증 (2계층 — 게이트 G8, 모든 FE 태스크 DoD)

jsdom/RTL 은 실렌더를 못 본다(초기 "빈 화면" = Tailwind 미컴파일 버그가 그 예). 실제 headless 브라우저(Playwright chromium)로 2계층 검증한다.

- **Layer 1 — 태스크별 스모크(빠름, 매 FE 태스크)**: 프리뷰 라우트 `apps/web/src/app/preview/page.tsx`(dev 전용, 인증·서버 불필요)에 컴포넌트를 목/stub 상태로 렌더 — 각 FE 태스크는 자기 컴포넌트 섹션(`data-testid="preview-<name>"`)을 추가. Playwright 스펙 `apps/web/e2e/*.pw.ts`(vitest 충돌 회피 네이밍)가 프리뷰를 열어 렌더/인터랙션 검증 + 스크린샷 `.ralph/screenshots/`. 실행: `bash scripts/verify-browser.sh`(전용 3100 포트 자동기동, dev :3000 무충돌, chromium 자동설치). **FE 태스크 DoD = RTL GREEN + verify-browser.sh 통과 + 스크린샷 산출.**
- **Layer 2 — phase-end 풀스택 e2e(P10-T6-18, 1회)**: 로컬 풀스택(docker DB + server + web, 테스트 유저 시드) → Playwright 가 magic-link 콘솔 토큰 로그인 → 채팅 → 전송 → 툴/인용/아티팩트 실화면 스크린샷. P9-T6-02 에서 배포-시로 미룬 e2e 를 P10 완료 시 로컬 실행.
- **적용 범위**: Layer 1 은 T6-07 이후 모든 FE 태스크 필수. 이미 완료된 T6-01~06 은 프리뷰 갤러리 + Layer 2 e2e 로 소급 커버.
- **의존성(계획 명시)**: `@playwright/test`(apps/web devDep). chromium 바이너리는 로컬 1회 설치(`verify-browser.sh` 가드).

---

## 19.5 P10 태스크 정의

23개 태스크(T6 17 + T2 6). 각 항목은 `feature_list.json` 의 `P10-*` 와 1:1. **path ownership**: T6 = `apps/web/src/**`(단 `components/artifacts/**` 는 T4 공동) / T2 = `apps/server/src/{orchestrator/**, tools/handlers/**, routes/{sessions,messages}.ts}`. 각 태스크는 RED-first 테스트 → 최소구현 → GREEN.

### 기반 (A)

- **P10-T6-01 · 앱 셸 & 레이아웃 [A1]** — `components/layout/AppShell.tsx`(좌 nav rail + 3분할 + 우패널 슬롯) + `(chat)/layout.tsx` 3-column + 사이드바 접기 + z-index 토큰(`--z-modal:100/--z-toast:200/--z-hitl:300`) + Pretendard self-host(`@font-face`) + 테마 토글(`data-theme` 가 `prefers-color-scheme` 를 양방향 override).
  - RED: AppShell 이 3 region 을 렌더하고 토글이 `data-theme` 를 스탬프하는지; 모바일 폭에서 사이드바가 슬라이드오버로 접히는지.
  - Accept: 모든 인증 화면이 AppShell 아래 마운트, 라이트/다크 전환 시 토큰 색 반영.
- **P10-T6-02 · 세션 히스토리 사이드바 [A2]** — `components/sessions/{SessionList,SessionCard,NewSessionButton}`; 날짜그룹(오늘/어제/이전7일)·핀 우선·검색·이름변경, `GET /sessions`(cursor)·`POST /sessions`·`PATCH/DELETE /sessions/:id` 연동. 새 세션 = `POST /sessions`(현 랜덤UUID 대체).
  - RED: 세션 목록 fetch→날짜그룹 렌더, 새세션 클릭이 POST 호출, 이름변경 PATCH.
- **P10-T6-03 · 메시지 렌더링 고도화 [A3a]** — assistant 풀폭 문서형(버블 제거)·hover `MessageActions`(복사=마크다운 원문/재생성/👍👎)·코드블록 문법하이라이트+복사버튼+wrap 토글·표 `overflow-x:auto`. 스트리밍 중 미완 마크다운(미닫힌 코드펜스) 안전 처리.
  - RED: 코드블록 하이라이트+복사, user=우측/assistant=풀폭, thumbs 클릭 상태.
- **P10-T6-04 · 수식·다이어그램 [A3b]** — `Markdown` 에 KaTeX(remark-math/rehype-katex) + Mermaid(코드/다이어그램 토글 카드). 의존성은 계획 명시 범위 내에서만 추가(미지정 시 격리).
  - RED: `$...$` 수식 렌더, mermaid 코드→SVG.
- **P10-T6-05 · 스트리밍/추론 UX [A4a]** — `Reasoning` 접이식(스트리밍 요약→완료 시 "N초 생각" 칩으로 접힘, 기본 접힘)·강제 오토스크롤 제거(하단 추종 + 벗어나면 "최신으로↓" pill)·shimmer/skeleton(첫 토큰 전).
  - RED: 스크롤 이탈 시 자동추종 해제 + pill 노출; reasoning 블록 접힘/펼침.
- **P10-T6-06 · 접근성 [A4b]** — 스트리밍 컨테이너 `aria-live="polite"`+`aria-atomic="false"`+`role="log"`, **announce 디바운스**, 포커스 관리(새 turn 이 포커스 탈취 금지), 아이콘 버튼 접근가능 이름, 키보드 내비.
  - RED: live region 속성 존재 + 빠른 델타에서 announce 디바운스.

### 에이전틱 라이브 (B) — T6 렌더러 + T2 서버 emit

- **P10-T2-01 · 실 tool-execution 루프 [B1-srv]** — orchestrator turn 에서 `ChatInput.tools` 배선, `tool_use`→핸들러 실행→`tool_result` emit→모델 재호출 반복(`stop.reason==="tool_use"` 비종결). AbortSignal 관통.
  - RED: 툴 1개 등록 시 tool_use→tool_result→최종 text 시퀀스; abort 즉시 중단.
- **P10-T6-07 · 툴콜 시각화 [B1-FE]** — `components/chat/ToolCallRenderer.tsx` + `StatusChip`(queued/running/done/error 공용 어휘). 헤더=툴명+상태칩(+MCP `server › tool` 라벨), 본문=args/result 펼침(대형 payload 접힘). 스트림 위치에 인터리브.
  - RED: tool_use→러닝 칩, tool_result→done+결과 요약, error→재시도 가능 칩.
- **P10-T2-02 · HITL 브리지 [B2-srv]** — 부수효과 툴 게이팅: `hitl_request` emit 후 turn 일시정지, `POST /sessions/:id/messages/hitl` 대기→`hitl_resolved`(승인 시 실행, 수정인자 반영)/`hitl_timeout`. `GET /sessions/:id/hitl/pending` 제공.
  - RED: 게이트 툴이 hitl_request 후 pause; approved→실행, denied→스킵, 만료→timeout.
- **P10-T6-08 · HITL 승인 카드 [B2-FE]** — `components/chat/HitlPrompt.tsx`(z-300, `aria-live="assertive"`): 평문 액션 설명 + [거부][수정][승인], **인자 인라인 편집** 후 승인, → POST hitl. 위험(부수효과)만 게이트, 읽기전용은 무프롬프트.
  - RED: 카드가 승인/거부 전송, 인자수정→modifiedArgs 반영.
- **P10-T2-03 · knowledge_search → citation emit [B3-srv]** — tools/handlers 의 검색 핸들러가 기존 retrieval 을 호출, `citation` 이벤트 emit + `Message.citations[]` 채움(기존 knowledge/** 편집 필요 시 격리).
  - RED: 검색 툴 호출 turn 이 index/filename/snippet 갖춘 citation emit.
- **P10-T6-09 · 인용 UI [B3-FE]** — `lib/citation-plugin.ts`(remark) 로 문장끝 `[N]` 칩 + `## Reference` 푸터(`[1] doc.pdf p.3`) + hover 스니펫 팝오버 + 클릭→우패널 소스 하이라이트.
  - RED: citation 이벤트→[N] 칩 렌더+클릭 시 소스 포커스.
- **P10-T2-04 · artifact-create → emit [B4-srv]** — 아티팩트 생성 툴 핸들러가 store 에 등록 후 `artifact_created`(artifactId/artifactKind/filename/downloadUrl) emit(기존 artifact-store lib 호출; 편집 필요 시 격리).
  - RED: 생성 툴 turn 이 artifact_created emit + `GET /sessions/:id/artifacts` 반영.
- **P10-T2-05 · resume-stream 엔드포인트 [B4-srv]** — `GET /sessions/:id/messages/:messageId/stream`: 첫 이벤트 `message_replace`(contentSoFar) 후 계속. `stop.reason==="tool_use"` 재연결 대상. (신규 route prefix 아님 — 기존 sessions mount 하위. 새 prefix 필요 시 app.ts + routes-mounted.test.ts 갱신.)
  - RED: 재연결 시 message_replace 선행 + 이어받기; 404/410/409 경로.
- **P10-T6-10 · 아티팩트/캔버스 패널 [B4-FE]** — `components/artifacts/`(T4 공동): 우측 리사이즈 분할·미리보기/코드 토글·버전 페이저 `‹v3/5›`·다운로드/공유(`ShareDialog`)·`artifact_created` 자동 오픈·`Cmd+\` 토글. 모바일=풀스크린 시트.
  - RED: artifact_created→패널 오픈, 미리보기/코드 토글, 버전 네비.

### 컴포저 (C)

- **P10-T2-06 · 첨부 수용 [C1-srv]** — `routes/messages.ts` 가 `attachments:[{uploadId}]` 수용(현 400 제거), turn 에 ephemeral RAG 컨텍스트로 전달.
  - RED: uploadId 포함 메시지가 400 아님 + ephemeral 소스 반영.
- **P10-T6-11 · 컴포저 첨부 [C1-FE]** — `components/chat/ChatInput.tsx` 에 📎 + 드래그드롭(드롭존 하이라이트) + 이미지 붙여넣기 → `POST /uploads`→`uploadId` → 첨부 칩(제거가능). 타입/크기 검증.
  - RED: 드롭/붙여넣기→업로드→칩, 전송 시 attachments 포함.
- **P10-T6-12 · 슬래시/@멘션 [C2]** — `/` 액션 팝오버(콜백 실행) + `@` 엔티티 픽커(파일/툴/지식→참조 토큰).
  - RED: `/`→필터 팝오버 선택 시 액션, `@`→토큰 삽입.
- **P10-T6-13 · 모델/모드 피커 [C3]** — 컴포저 내 모델(추론 effort 포함)+모드(Agent/Chat·웹검색) 피커, `GET /config` `availableModels`. 미가용 옵션은 숨김.
  - RED: config fetch→피커 렌더, 선택이 전송 payload 반영.

### 대화관리·개인화·신뢰 (D)

- **P10-T6-14 · 프로젝트 스코핑 + 메모리 노출 [D1]** — 채팅 헤더 `[Project ▾]`(스코프 전환, `GET /projects`) + 메모리 채팅 내 노출/토글(`/memories`).
  - RED: 프로젝트 전환이 세션 스코프 반영, 메모리 표시.
- **P10-T6-15 · 메시지 편집/분기(트리) + 버전 [D2]** — user 메시지 편집→분기 생성, 편집 turn 에 `‹2/3›` 형제 페이저. 스토어를 트리로(원칙 2).
  - RED: user 편집→새 분기, 페이저로 형제 전환, 활성경로 렌더.
- **P10-T6-16 · 공유/내보내기 [D3]** — 대화 공개링크(명시 opt-in + 리뷰) + 마크다운/JSON export. 기존 share 계약 활용.
  - RED: export 가 md/JSON 생성, 공유는 opt-in 확인 후에만.
- **P10-T6-17 · 에러/신뢰 [D4]** — turn 내 원인별 에러배너 + 재시도(재시도 가능 코드만; 429=백오프 메시지) + 토스트 시스템(앱레벨 이벤트) + SSE 드롭 재연결/resume + 오프라인 상태. 입력 draft 보존.
  - RED: 재시도가능 에러만 Retry 노출, 비재시도(크레딧 부족 등)엔 없음; 토스트.

### 검증 (V)

- **P10-T6-18 · phase-end 풀스택 e2e [Layer 2]** — 로컬 풀스택(docker DB + server + web, 테스트 유저 시드) + Playwright: magic-link 콘솔 토큰 로그인 → 채팅 → 전송 → 툴콜/인용/아티팩트/HITL 실화면 스크린샷. P10 완료 직전 1회(§19.4.1 Layer 2, P9-T6-02 의 로컬 실행판). 스택 기동/시드가 세션에서 불가하면 격리.
  - Accept: 로그인→채팅→전송 e2e green + 각 P10 화면 스크린샷 `.ralph/screenshots/e2e/`.

**태스크 간 의존/시퀀스**: B 기능은 대응 T2(emit) + T6(렌더) 두 태스크가 모두 passes 되어야 end-to-end 로 산다. `feature_list.json` 배열 순서 = 루프 우선순위(기반 → 각 B의 srv→FE 쌍 → C → D). 서버 편집이 T3/T4 소유 파일까지 필요하면 해당 태스크를 격리하고 다음으로 진행(루프를 멈추지 않는다).

---

## 19.6 계약·게이트 준수 체크리스트 (커밋 전)

- [ ] 신규 타입 0 — [14-INTERFACES.md](14-INTERFACES.md) 정의만 사용(특히 `ChatEvent` 12변형). 필요 시 격리.
- [ ] `packages/**` · Phase-0.5 소유 파일 · `apps/web/src/lib/{api-client,api-types.generated}.ts` 미수정.
- [ ] 새 HTTP route prefix 추가 시 `app.ts` 마운트 + `routes-mounted.test.ts` EXPECTED_ROUTES 갱신(P10 은 원칙적으로 신규 prefix 없음).
- [ ] RED 증거: 신규 behavior 테스트가 구현 전 올바른 이유로 실패. SSE UI 는 `ChatView.test.tsx` 스텁 패턴.
- [ ] `bash scripts/verify-gates.sh` exit 0 (typecheck·lint·test·validate-state·lint-plan). web ≥ 60% 커버리지.
- [ ] `feature_list.json` 은 해당 항목 `passes` 만 true(+`attempts`). 다른 필드/항목 불변.
- [ ] **브라우저 검증(G8)**: FE 태스크는 프리뷰 갤러리에 컴포넌트 추가 + `apps/web/e2e/*.pw.ts` 스펙 + `bash scripts/verify-browser.sh` 통과 + `.ralph/screenshots/` 스크린샷 산출. "실행하지 않은 검증 통과 서술 금지".

---

## 19.7 실행 방법 (loop engineering)

1. **spec drift 승인**(계획 문서 추가/수정 후 1회): `rm .ralph/spec.md5`.
2. **현재 phase 확인**: `.ralph/current_phase` = `P10`.
3. **루프 실행**: `MAX_ITERS=40 BUDGET_USD=3 MODEL=sonnet bash scripts/loop.sh`
   - P10 에서는 loop 이 `PROMPT.P10.md`(전용 프롬프트)를 사용(§ loop.sh 의 phase-specific prompt 선택).
   - 반복당 태스크 1개: RED → GREEN → verify-gates → `passes:true` → 1커밋.
4. **phase 완료**: 격리 안된 P10 항목 전부 passes → `<PHASE_COMPLETE:P10>` 출력·정지(사람 검증). `PHASE_VERIFY=1` 이면 독립검증(`PROMPT.phase.md`) 후 자동.
5. **검증 데모**: dev 서버(server:4000/web:3000) + 브라우저로 툴콜·인용·아티팩트·HITL end-to-end 확인.

> ⚠️ 루프는 원격을 건드리지 않는다(push/merge 금지). PR·push 는 사람이 수행.

---

## 19.8 범위 밖 (후속 로드맵)

- **E 티어(differentiator, 후속 phase)**: 서브에이전트 중첩 스텝/활동 패널, 음성 입력(STT), 딥리서치 모드, 백그라운드/비동기 장기 태스크, computer-use, resume/replay-fork.
- **엔터프라이즈 거버넌스(별도 phase, 대부분 배포·인프라 게이트)**: SSO(SAML/OIDC)+SCIM, 세분 RBAC, 감사로그 SIEM/OTel export + Compliance API, DLP/PII 레닥션, 데이터 레지던시/리텐션/BYOK, prompt-injection 분류기(OWASP LLM/Agentic Top 10), 관측/평가(evals) 하네스. — UI/UX 초점을 흐리지 않도록 P10 과 분리하되, 상용 엔터프라이즈 판매를 위해 반드시 후속에서 다룬다.
