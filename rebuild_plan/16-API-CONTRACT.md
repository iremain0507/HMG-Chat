# 16 · API Contract — REST API 명세

> ## Source of Truth (계층 — 단일 흐름)
>
> ```
> packages/shared/src/schemas/*.ts        ← Zod schema (runtime authority — 정의)
>           │
>           ↓ import
> apps/server/src/routes/*.ts             ← Hono route + zod-validator (server 사용)
>           │
>           ↓ @hono/zod-openapi
> apps/server/openapi.json                ← OpenAPI 3.1 (생성물 — schema dump)
>           │
>           ↓ openapi-typescript
> apps/web/src/lib/api-types.generated.ts ← TS types (생성물 — web 사용)
>           │
>           ↓ reflect
> 16-API-CONTRACT.md (본 문서)             ← 사람용 정리 (refresh 시 generator 호출)
> ```
>
> **단일 source = `packages/shared/src/schemas/*.ts` (Zod schema)**. 변경은 항상 schema 먼저 → 나머지는 도구가 생성. 본 문서·routes·OpenAPI·web types 는 schema 의 reflect — 손으로 수정 금지.
> CI 의 `api-contract-check` job 이 schema → openapi → web types 사이의 drift 를 자동 검출.
>
> ## Phase 0.5 와의 관계 (반복 질문 차단 — 순환 오해 차단)
>
> 매 라운드 LLM 검토에서 "16 부록 A 가 source-of-truth 인데 build_prompt 는 Phase 0.5 가 부록 A 보고 shared schema 를 생성하라고 함 → 순환" 가 반복 지적되는데, **이는 spec vs runtime 두 layer 의 시간적 분리**:
> - **본 문서 § 부록 A** = **spec source of truth** (사람/agent 가 읽는 plan). Phase 0.5 시작 시점의 단일 진실원.
> - **`packages/shared/src/schemas/*.ts`** = **runtime source of truth** (실 코드 가 import 하는 .ts). Phase 0.5 owner 가 부록 A 를 보고 **1:1 변환** 후 commit.
> - Phase 0.5 머지 후엔 두 출처가 동기화된 상태로 유지. 이후 변경은 **`*.ts` 먼저 → 부록 A reflect** (변경 owner 가 부록 A 도 동시 PR 안에 업데이트, lint § 5 가 drift 자동 검출).
>
> 즉 **bootstrap 시점에는 부록 A → .ts**, **유지 시점에는 .ts → 부록 A**. 표면적 순환이지만 시간 축에서 단방향. v1.0 의 의도된 boundary.

## URL 구조 (L8 — share/health path 일관)

| URL | 위치 | 인증 | 비고 |
|---|---|---|---|
| `/health` | server (ALB health check) | none | `/api/v1` prefix 없음. ALB target group health check 가 직접 호출 |
| `/api/v1/*` | server REST API | cookie `{{PROJECT_SLUG}}_at` | 본 문서의 대부분 endpoint |
| `/api/v1/share/<token>` | server (metadata JSON, 인증 우회) | none | authMiddleware **전** mount. envelope 적용 |
| `/api/v1/share/<token>/content` | server (binary stream, 인증 우회) | none | authMiddleware **전** mount. envelope 면제 (binary) |
| `/share/<token>` | web (Next.js page) | none | UI 렌더링 — metadata 는 `/api/v1/share/<token>`, 본문은 `/api/v1/share/<token>/content` 호출 |

ALB routing rule ([11-DEPLOYMENT.md § ALB](11-DEPLOYMENT.md)):
- `/health` → server target group
- `/api/v1/share/*` → server (rule 1, metadata + content 둘 다)
- `/api/v1/*` → server (rule 2)
- `/share/*` → web target group
- `/*` → web target group (default)

## 공통 규약

### Base URL
- 개발: `http://localhost:4000/api/v1`
- 운영: `https://{{APP_DOMAIN_PROD}}/api/v1`
- 익명 share path: `/api/v1/share/<token>` (인증 우회 mount)

### 인증
- 모든 `/api/v1/*` (share 제외) 는 `Cookie: {{PROJECT_SLUG}}_at=<jwt>` 필수.
- 미인증 시 `401 Unauthorized` + `WWW-Authenticate: refresh`.

### 응답 envelope

**불변 규칙 (모든 JSON endpoint 의무 — 명시 예외만 허용)**:
- 성공 응답 (2xx, `Content-Type: application/json`) — 항상 `{ data: <T>, meta: { requestId } }`.
- 에러 응답 (4xx/5xx, JSON) — 항상 `{ error: {...}, meta: { requestId } }`.
- bare body (`{ ok: true }`, `{ sent: true }`, bare User 등) 는 **모두 금지**.

**명시 예외 (envelope 적용 안 함 — 본문 형식이 envelope 으로 표현 불가능한 경우만)**:

| 예외 | 이유 | endpoint |
|---|---|---|
| 204 No Content | body 없음 (HTTP spec) | `DELETE /sessions/:id`, `DELETE /uploads/:id`, `DELETE /artifacts/:id/share/:token`, `DELETE /projects/:id/members/:userId`, `DELETE /projects/:id/documents/:docId` |
| 302 Redirect | 브라우저 redirect — body 없음 | `GET /auth/magic-link/verify` |
| `text/event-stream` (SSE) | event-name + JSON data 의 **event stream**. envelope 은 단발성 JSON 에만 적용. 각 SSE event payload 는 envelope 없이 `{ ...event fields }` (예: `{ messageId, ... }`). | `POST /sessions/:id/messages`, `GET /sessions/:id/messages/:messageId/stream` (resume), `GET /notifications` |
| binary / inline content | mime 따라 raw byte stream 또는 inline HTML | `GET /api/v1/share/:token/content`, `GET /artifacts/:id/content`, `GET /skills/:id/SKILL.md`, `GET /skill-assets/:skillId/:filename` |
| `GET /health` | ALB target-group health check 가 직접 파싱 (사내 표준 형식) | `/health` |

> SSE 의 event payload 가 `{ data: ..., meta: ... }` 형태일 수도 있지만 그것은 **event 의 자체 필드** 일 뿐 envelope 의무 대상 아님. SSE 의 contract 단일 출처는 § /sessions/:id/messages 의 `event:` 라인 + 14-INTERFACES § ChatEvent.

### MessageRun 상태 머신 (반복 질문 차단)

매 라운드 검토에서 "POST /messages 가 enqueue 와 SSE 를 동시에 말해 모순" 이 반복 지적되는데, **enqueue 는 server-internal abstraction, SSE 는 client-facing wire** — 두 layer 가 모순이 아니라 협동.

**MessageRun = DB `sessions_active_runs.status` 4-state (CHECK constraint = single source of truth, 06-DATA-MODEL § 0003)**:
```
pending → running → completed | cancelled
                ↓
            (tool/HITL 대기 시 running 유지 — DB row 상으론 같은 상태,
             내부적으로만 streaming/waiting 구분)
```

| DB status | 의미 | SSE event 시점 |
|---|---|---|
| `pending` | run row 생성됨, LLM 호출 전 | (event 없음 — server-internal) |
| `running` | LLM streaming 중 또는 tool/HITL 대기 (`stop reason='tool_use'` 후 resume 포함) | `message_start`, `message_replace`, `text_delta`, `tool_use`, `tool_result`, `hitl_request`, `hitl_resolved`, `hitl_timeout`, `citation`, `artifact_created`, `stop` (reason="tool_use") |
| `completed` | LLM `end_turn` 또는 `max_tokens` 정상 종료 (terminal) | `stop` (reason="end_turn" \| "max_tokens") |
| `cancelled` | user abort, LLM error, timeout — 모두 cancelled 로 통합 | `stop` (reason="aborted") 또는 `error` 후 `stop` |

> **`stop reason='tool_use'` 는 running 안의 wire signal — DB status 전이 X** (반복 질문 차단). 라운드 25~27 가 reducer 측에서 처리했지만 본 표는 stop 4 값을 모두 completed 에 두었음 → 실제는 `end_turn`/`max_tokens` 만 completed 로 전이. `tool_use` 는 wire-level "이 stream 종료, 곧 같은 messageId 로 새 stream" 신호일 뿐 message terminal 아님.

> **`failed` 별도 상태 없음** — DB CHECK 가 4 값. LLM 에러는 DB status='cancelled' + SSE `event: error` 로 표현 (메시지 content 안에 error 정보 persist).

### MessageRun 의 server 내부 sub-state (DB 에 노출 안 함)

server 의 orchestrator 가 running 안에서 추가 sub-state 추적 (메모리만, DB 무관):
```
running:
  ├─ streaming      (LLM 토큰 받는 중)
  ├─ waiting_tool   (tool handler 실행 중)
  └─ waiting_hitl   (HITL 사용자 응답 대기)
```

| 내부 sub-state 전이 | 트리거 | SSE event |
|---|---|---|
| pending → streaming | LLM provider 첫 응답 | `message_start` |
| streaming (계속) | LLM token chunk | `text_delta` |
| streaming → waiting_tool | LLM `tool_use` (policy=allow) | `tool_use` |
| streaming → waiting_hitl | LLM `tool_use` (policy=hitl) | `hitl_request` (tool_use 는 approved 후에 emit) |
| waiting_hitl → waiting_tool | client `POST /messages/hitl` approved | `hitl_resolved` → `tool_use` |
| waiting_hitl → streaming | client denied 또는 timeout | `hitl_resolved` 또는 `hitl_timeout` (tool_use 실행 안 함, 모델이 후속 응답) |
| waiting_tool → streaming | tool 결과 도착 | `tool_result` |
| streaming → completed | LLM `end_turn` 또는 max_tokens | `stop` (reason) |
| * → cancelled | client `DELETE /active-run` 또는 LLM error | `error` (선택) + `stop` (reason="aborted") |

**idempotency**: `Idempotency-Key` 헤더 24h 캐시 — 같은 key 재호출 시 캐시된 final response 반환 (stream 재생 X, completed message 의 JSON snapshot 만).

**partial message persistence**: streaming 중 매 ~1초마다 `messages` row 의 `content` 갱신 (`UPDATE messages SET content = ... WHERE id = ?`). abort 시 마지막 content + `\n\n[잘림]` marker. final 시 완전한 content + Reference 섹션.

**concurrent send**: 같은 세션에 동시 두 message 가 들어오면 두 번째는 `409 CONCURRENT_RUN` — `sessions_active_runs` PK = `session_id` 라 자동 차단.

> 본 상태 머신은 **plan contract** (server side 의 본문 구현은 T2 의 책임 — orchestrator/orchestrator.ts). client 는 SSE event 만 보고 UI 갱신.

### `stop` event reason 4값 의미 (반복 질문 차단)

매 라운드 LLM 검토에서 "`stop` reason='tool_use' 가 UI 의 terminal stop 과 충돌" 이 반복 지적되는데, **stop event 는 SSE stream 의 종료 신호일 뿐 message 의 완결 신호가 아님**. tool_use 의 경우 client 는 stop 받은 직후 새 message 를 시작하지 않고 **같은 messageId 의 다음 stream** 을 기다림.

| reason | 의미 | client 동작 | 후속 |
|---|---|---|---|
| `end_turn` | 모델 자연어 완결 (assistant turn 끝) | "응답 완료" 표시, message 영속화 | 없음 — turn 종료 |
| `max_tokens` | 토큰 한도 도달 | "잘림" marker 표시 | 사용자가 "계속" 클릭 시 새 message |
| `tool_use` | 모델이 도구 호출 emit 후 stream 일시 종료 | **"중간 정지" — 도구 실행 대기 표시**. message **terminal 처리 금지** | server 가 tool_result 받으면 **같은 messageId 로 새 SSE stream 시작** → client 가 `message_replace` event 로 message content 교체 |
| `aborted` | user Stop 또는 LLM 에러 | "사용자 취소" 표시, partial content + `[잘림]` marker | 없음 |

> **tool_use 후속 stream 의 ChatEvent**: server 가 같은 messageId 로 `GET /sessions/:id/messages/:messageId/stream` (resume endpoint, § 본 문서 본문) → 새 event 시퀀스 시작:
> ```
> event: message_replace          # 14-INTERFACES § ChatEvent.message_replace
> data: { messageId, contentSoFar }  # 도구 실행 전까지의 누적 content (idempotent merge)
> event: tool_result              # 직전 tool_call 의 결과
> event: text_delta               # 모델 후속 자연어
> ...
> event: stop
> data: { reason: "end_turn", usage }
> ```
> reason='tool_use' 후 reason='end_turn' 이 와야 message 가 진짜 완결. 두 stop 사이에 tool_result + 후속 text_delta 가 들어옴.

**client 룰** ([18-FRONTEND-WIREFRAMES § /chat](18-FRONTEND-WIREFRAMES.md) 의 streaming reducer):
- `reason='end_turn'|'max_tokens'|'aborted'` → message terminal, "다음 입력 받기" 모드로 전환.
- `reason='tool_use'` → message **non-terminal**, "도구 실행 중..." spinner 유지, 같은 messageId 의 추가 event 대기.

### SSE wire format vs TypeScript ChatEvent (반복 질문 차단)

매 라운드 LLM 검토에서 "ChatEvent 의 `type` discriminant 가 SSE wire 의 `event:` 와 충돌?" 가 반복 지적되는데, **두 표현은 같은 정보의 다른 layer 일 뿐**. 충돌 아님.

```
SSE wire (over HTTP)              client wrapper (apps/web/src/lib/chat-stream.ts)              TypeScript ChatEvent
─────────────────────             ──────────────────────────────                                ──────────────────
event: text_delta                 e.event = "text_delta"; data = JSON.parse(line);              { type: "text_delta", text: "..." }
data: {"text":"..."}              return { type: e.event, ...data };
                                  ↑ client wrapper 가 SSE event name 을 TS discriminant 의 `type` 으로 reconstruct
```

**규칙** (단일 출처):
1. **SSE wire**: `event:` line 이 wire-level discriminant. `data:` line 은 type 필드 **생략** (event name 으로 이미 결정됨, 중복 회피).
2. **TS ChatEvent** ([14-INTERFACES § ChatEvent](14-INTERFACES.md)): `{ type: <name>, ...payload }` discriminated union.
3. **client wrapper**: SSE event 를 받아 `{ type: e.event, ...JSON.parse(e.data) }` 로 재구성 → 14 의 ChatEvent 와 정확히 일치.

`ChatSsePayload<E>` 헬퍼 타입 (14-INTERFACES 가 export):
```ts
export type ChatSsePayload<E extends ChatEvent["type"]> = Omit<Extract<ChatEvent, { type: E }>, "type">;
```
→ server 가 `data:` line 에 직렬화하는 payload 의 타입.

성공:
```json
{ "data": <T>, "meta": { "requestId": "uuid" } }
```

에러:
```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "category": "http",
    "message": "사람 읽을 메시지 (한국어)",
    "details": [...]            // Zod issues 등
  },
  "meta": { "requestId": "uuid" }
}
```

### envelope 자동 검증

- `apps/server/src/middleware/envelope.ts` (Hono after middleware) 가 모든 응답 body 를 검사:
  - 204/302/share inline 제외 모든 응답이 envelope 형식이 아니면 dev/test 환경에서 500 + console.error (regression catch). prod 에선 logger.warn.
- `e2e` job 의 smoke 테스트 (`scripts/smoke-test.sh`) 가 `.data` 만 추출 (fallback 금지) — 본 규칙 미준수 시 CI fail.

### 페이지네이션
list 엔드포인트는 cursor 방식:
```
GET .../sessions?cursor=<opaque>&limit=20
→ { data: [...], meta: { nextCursor?: string, totalApprox?: number } }
```

### Rate limit
- 글로벌: `120 req/min/user` (env `RATE_LIMIT_GLOBAL_MAX`)
- `POST /sessions/:id/messages`: `20 req/min/user`
- `POST /uploads`: `10 req/min/user`
- 초과 시 `429` + `Retry-After: <seconds>`.

### Idempotency
`POST` 와 `PUT` 중 다음은 `Idempotency-Key: <uuid>` 헤더 지원:
- `POST /sessions/:id/messages`
- `POST /artifacts/:id/share`
- `POST /uploads`

같은 키 24시간 내 재호출은 캐싱된 응답 반환.

---

## EmailSender 인터페이스 (env `EMAIL_SENDER_KIND` 로 backend 선택)

> **단일 출처는 [14-INTERFACES.md § 12. EmailSender](14-INTERFACES.md)** — 시그니처는 그쪽이 authoritative. 본 절은 사용 사례·환경 매트릭스만.

| `EMAIL_SENDER_KIND` 값 | 동작 | 환경 |
|---|---|---|
| `console` | 토큰을 stdout 으로 출력 (실제 발송 X) | local dev (default) |
| `smtp` | SMTP relay (env `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`) | dev/staging 옵션 |
| `ses` | AWS SES SendEmail (env `EMAIL_FROM`, IAM role) | staging/prod 기본 |
| `test` | in-memory 큐 (테스트 inspect 가능) | unit test (ConsoleEmailSender 의 test 변형) |
| `noop` | 발송 안 함, 반환만 정상 | CI smoke (계정 기반 미사용 환경) |

[14-INTERFACES.md § 12](14-INTERFACES.md) 의 시그니처 요약:
```ts
// packages/interfaces/src/EmailSender.ts — 단일 출처
export interface EmailSendInput {
  to: string;
  subject: string;
  html: string;                       // 본문 (HTML 필수)
  text?: string;                      // plain-text fallback (auto-strip if absent)
  category: "auth" | "notification";  // logger / metric tagging
  idempotencyKey?: string;            // 24h dedup
}
export interface EmailSendResult {
  messageId: string;
  acceptedAt: Date;
}
export interface EmailSender {
  send(input: EmailSendInput, signal?: AbortSignal): Promise<EmailSendResult>;
}
```

> **이전 표기** (`EmailMessage` / `textBody` / `htmlBody` / `kind` 필드) 는 14 와 16 사이의 drift 였음 — 14 형식으로 통일. 구현은 `ConsoleEmailSender` / `SesEmailSender` / `SmtpEmailSender` 세 종 + 테스트용 `InMemoryEmailSender` (kind="test").

**dev 대체 경로** (사내 SMTP 미설정 시):
- `EMAIL_SENDER_KIND=console` → magic-link 토큰이 server stdout 에 출력.
- `EMAIL_SENDER_KIND=noop` + **password fallback**: `POST /auth/login` 의 `password` 분기 사용 (admin 계정 또는 dev 계정).
- CI smoke test: `EMAIL_SENDER_KIND=test` → in-memory 큐에서 토큰 추출해 verify endpoint 직접 호출.

30분 onboarding 안내 ([08-SPRINT-PLAN.md § Phase 0](08-SPRINT-PLAN.md)) 에서 dev 환경은 `EMAIL_SENDER_KIND=console` 기본 — magic-link 클릭 대신 server log 의 URL 을 사용자가 직접 브라우저에 붙여넣음.

## 1. Auth

### `POST /auth/login`
```
Request:
  { email: string, password: string }
  또는
  { email: string, magicToken: string }
Response 200:
  # AuthMeResponse 와 동일 shape — /auth/me, /auth/login 둘 다 { user, org } 통일 (§ 부록 A AuthMeResponse).
  # /auth/magic-link/verify 는 302 redirect (body 없음) — AuthMeResponse 적용 안 함. cookie set 후 / 로 redirect, 다음 페이지에서 /auth/me 호출로 user/org 획득.
  { data: { user: { id, email, name, orgId, role, customInstructions, createdAt },
            org:  { id, name, domain, plan, allowedModels, allowedTools, defaultTokenBudgetMicros, createdAt, updatedAt } },
    meta: { requestId } }
  Set-Cookie: {{PROJECT_SLUG}}_at=...; HttpOnly; Secure; SameSite=Lax; Path=/
  Set-Cookie: {{PROJECT_SLUG}}_rt=...; HttpOnly; Secure; SameSite=Lax; Path=/api/v1/auth/refresh
Error:
  400 INVALID_INPUT (form 검증 — 이메일 형식 오류 등)
  401 INVALID_CREDENTIALS
  403 EMAIL_DOMAIN_FORBIDDEN — ALLOWED_DOMAINS 에 없는 이메일 도메인 (예: gmail.com). 08 § Phase 1 acceptance 와 단일 출처. UI form 의 도메인 안내 메시지 ("@{{ORG_DOMAIN}} 만 가입 가능") 와 매칭.
  429 RATE_LIMITED
```

### `POST /auth/signup`
```
신규 사용자 가입 — magic-link 발송 트리거 (intent='signup')
Request:
  { email: string, name: string }
Response 200:
  { data: { sent: true }, meta: { requestId } }   # 항상 동일 (enumeration 방지)
Errors:
  403 EMAIL_DOMAIN_FORBIDDEN — ALLOWED_DOMAINS env 검사 (POST /auth/login 과 동일 정책)
  400 INVALID_INPUT — 이메일 형식 오류 등
  429 RATE_LIMITED

부수효과:
- email 도메인 검증 (*@ORG_DOMAIN)
- magic_link_tokens insert: { email, user_id=NULL, org_id=<email 도메인으로 매칭>, intent='signup', signup_name=<request.name> }
- 이메일 발송 ([EmailSender interface](#email-sender-인터페이스) — env `EMAIL_SENDER_KIND` 로 선택)

토큰 클릭 시 GET /auth/magic-link/verify → `users INSERT (..., name = magic_link_tokens.signup_name, ...)` + login
```

### `POST /auth/magic-link`
```
기존 사용자 로그인 (또는 신규 사용자 첫 로그인) — magic-link 발송 (intent='login')
Request:
  { email: string }
Response 200:
  { data: { sent: true }, meta: { requestId } }   # 이메일 발송 여부와 무관 (enumeration 방지)

부수효과:
- email 도메인 검증
- user 존재하면 user_id 채워서 magic_link_tokens insert (intent='login')
- user 없으면 signup 흐름으로 redirect (사실상 같은 동작 — UX 단순화)
```

### `GET /auth/magic-link/verify?token=<base64>`
```
사용자가 이메일 링크 클릭 시 호출되는 endpoint. 서버 302 단일 흐름 ([18-FRONTEND § routes](18-FRONTEND-WIREFRAMES.md) 와 일관).
Request: query string token
Response:
  - intent='signup' 이고 user_id IS NULL: create_user_from_magic_link(token_hash) 호출 → user 생성 + login (302 to `/`). 홈 (`/`) 가 session 목록 페이지 — 사용자가 새 세션 선택 후 `/chat/<sessionId>` 진입.
  - intent='login' 이고 user_id 존재: magic_link_tokens.used_at 갱신 + login (302 to `/`).
  - 만료: 302 to /login?error=expired
  - 이미 사용: 302 to /login?error=used
Set-Cookie: {{PROJECT_SLUG}}_at=... (15분), {{PROJECT_SLUG}}_rt=... (30일)

부수효과:
- signup 흐름: server 가 동일 트랜잭션 안에서 `create_user_from_magic_link(token_hash)` SECURITY DEFINER 함수 호출 ([06 § 0012](06-DATA-MODEL.md)) — token 검증 + users INSERT + magic_link_tokens.used_at 갱신을 1 함수로 처리. 후속으로 `SET LOCAL app.user_id = <new id>` → refresh_token_families insert (RLS 통과).
- login 흐름: server 가 token verify 후 magic_link_tokens.used_at 갱신 + `SET LOCAL app.user_id = <existing user.id>` → refresh_token_families insert.
- 두 흐름 모두 cookie set + 302 redirect (`/` 또는 `/login?error=...`). 18 § routes inventory 와 일관 — `/` 가 home (세션 목록), `/chat/<sessionId>` 는 dynamic route.
- audit log: 항상 application logger (`logger.info('auth.login.success', ...)`). DB 적재는 **Phase 9 (0010 usage_logs) 적용 이후** 활성 — 그 전엔 logger 만.
  - Server 측 구현: `recordUsage()` 헬퍼가 0010 적용 전 no-op (테이블 부재 catch). 단일 코드 경로 유지.
```

> **CSRF 예외**: magic-link verify 는 GET + one-time token (`token_hash` 검증) 기반 → 별도 CSRF custom header 불요. 12-OPS-SECURITY § CSRF 정책의 명시 예외. token 자체가 sha256 random — replay 시 used_at 검증으로 차단.

### `POST /auth/logout`
```
Response 200: { data: { ok: true }, meta: { requestId } }
Set-Cookie: {{PROJECT_SLUG}}_at=; Max-Age=0
Set-Cookie: {{PROJECT_SLUG}}_rt=; Max-Age=0
```

### `POST /auth/refresh`
- Cookie `{{PROJECT_SLUG}}_rt` 필수 (jti + family_id claim 포함)
- DB 의 `refresh_token_families.current_jti` 와 token jti 비교:
  - **일치**: 새 access + refresh 발급, `current_jti` rotate, `current_generation += 1`, `last_used_at = NOW()`
  - **불일치** (이전 generation 의 token): 도난 의심 → `revoked_at = NOW()`, `revoke_reason = 'theft_suspected'`, 사용자에게 알림. 응답 401 + `WWW-Authenticate: re-login`
- 만료 시 401 + 강제 로그아웃 (cookie 제거)

### `GET /auth/me`
```
frontend bootstrap (18 § AppContext.AppProvider) 가 한 번 호출 → user + org 동시 응답.
Response 200: {
  data: {
    user: {
      id: string, email: string, name: string|null,
      orgId: string, role: "member"|"admin"|"owner",
      customInstructions: string|null,
      createdAt: string                            // ISO timestamp
    },
    org: {
      id: string, name: string, domain: string, plan: string,
      allowedModels: string[], allowedTools: string[],
      defaultTokenBudgetMicros: number | null,
      createdAt: string, updatedAt: string
    }
  },
  meta: { requestId }
}
```

> **frontend 18 § AppContext 와 단일 출처**: `user` + `org` 두 필드 모두 본 응답에서 받음. 별도 `/orgs/:id` 호출 불필요 (org 의 fine-grained 관리는 admin endpoint).
> mapper: `apps/server/src/mappers/user-mapper.ts # authMeDto(user, org)`.

### `PATCH /auth/me`
```
본인 프로필/customInstructions 수정 (18 § /settings/profile 가 사용).
Request: {
  name?: string,                       // 1~100자
  customInstructions?: string | null   // null = 제거, max 2000자
}
Response 200: { data: <User>, meta: { requestId } }   # 갱신된 본인 정보
Errors:
  400 INVALID_INPUT
```

### `DELETE /auth/me`
```
GDPR 우향 삭제 요청 ([12-OPS-SECURITY.md § GDPR](12-OPS-SECURITY.md)).
30일 grace period 후 hard delete (cascade). 즉시: 모든 세션 강제 로그아웃.
Request: { confirmation: string }      # "DELETE_MY_ACCOUNT" 정확히 입력
Response 202: {
  data: {
    scheduledHardDeleteAt: string,     # ISO timestamp (now + 30d)
    ticketId: string
  },
  meta: { requestId }
}
Errors:
  400 INVALID_CONFIRMATION
```

## 2. Sessions

### `POST /sessions`
```
Request: { title?: string, projectId?: string }
Response 201: { data: { id: string, title: string|null, projectId: string|null, createdAt: string }, meta: { requestId } }
```

### `GET /sessions?cursor&limit&projectId&archived`
```
Response 200: {
  data: Array<{ id, title, lastMessageAt, projectId, archived }>,
  meta: { requestId, nextCursor? }
}
```

### `GET /sessions/:id`
```
Response 200: { data: { id, title, projectId, createdAt, archivedAt }, meta: { requestId } }
Errors: 404 NOT_FOUND (RLS 위반은 항상 404, 존재 leak 방지)
```

### `PATCH /sessions/:id`
```
Request: { title?: string, archived?: boolean, projectId?: string|null }
Response 200: { data: <Session>, meta: { requestId } }
```

### `DELETE /sessions/:id`
```
Response 204                              # envelope 예외 — body 없음
부수효과: messages, sessions_active_runs 도 cascade delete (artifacts.session_id 는 SET NULL 로 보존)
```

### `DELETE /sessions/:id/active-run`
```
abort signal 전파 — 진행 중 message job 즉시 cancel
Response 200: { data: { cancelled: boolean }, meta: { requestId } }
```

### `POST /sessions/:id/messages/hitl`
```
HITL 도구 호출에 대한 사용자 응답 전달 ([14-INTERFACES.md § 9 HitlBridge](14-INTERFACES.md))

Request:
  {
    toolCallId: string,                    // HitlBridge.askApproval 의 toolCallId
    decision: "approved" | "denied",
    modifiedArgs?: Record<string, unknown>, // approved 시 인자 수정 옵션
    reason?: string                         // denied 시 사용자 메모
  }
Response 200: { data: { delivered: boolean }, meta: { requestId } }
부수효과:
  - Redis key `hitl:{sessionId}:{toolCallId}` 에 응답 SET
  - bridge.askApproval Promise resolve → 도구 실행 재개
Errors:
  404 NOT_FOUND — 해당 toolCallId 의 HITL 요청 없음 (이미 timeout/abort)
  410 GONE     — HITL 이 이미 처리됨 (중복 응답)
  403 FORBIDDEN — 다른 사용자의 세션
```

### `GET /sessions/:id/hitl/pending`
```
현재 대기 중인 HITL 요청 목록 (UI 가 polling 또는 SSE notifications 로)
Response 200: {
  data: Array<{
    toolCallId: string,
    toolName: string,
    args: Record<string, unknown>,
    rationale: string,
    requestedAt: string,
    expiresAt: string                       // timeoutMs 기준
  }>,
  meta: { requestId }
}
```

## 3. Messages

### `POST /sessions/:id/messages` (SSE)
```
Headers:
  Accept: text/event-stream
  Idempotency-Key: <uuid>          # 권장
Request: { content: string, attachments?: Array<{ uploadId: string }> }

> **Phase 2/4 phase boundary (반복 질문 차단)**:
> - Phase 2 (현재): `attachments` 필드 받지만 **무시** (or `400 ATTACHMENTS_NOT_SUPPORTED` — 정책 선택). uploads 테이블 / ephemeral_chunks / parser-pipeline 모두 Phase 4 산출물. Phase 2 server route 는 `attachments` 가 빈 배열일 때만 200 응답.
> - Phase 4 (knowledge 적용 후): 본 부수효과 절 활성화. 16 § OpenAPI 가 attachments 를 optional → required 로 promote 안 함 (Phase 2 client 가 안 보내도 OK).
> - lint § 새 check 가 Phase 2 acceptance 에 attachments empty/400 검증 명시 의무.

부수효과 (attachment → RAG 자동 인덱싱) — **Phase 4 부터 활성**:
- 각 `uploadId` 의 `uploads` row 를 조회. PDF/PPTX/DOCX/XLSX/MD 이면 자동으로 ephemeral RAG 인덱싱:
  1. server 가 `parser-pipeline` 으로 markdown 변환 ([03-ARCHITECTURE § Flow B](03-ARCHITECTURE.md))
  2. `chunker` 로 chunk 분할, `embedding-provider` 로 임베딩
  3. **세션 scope ephemeral 인덱스** 에 저장 — `project_documents` 와 별개 (session 종료 시 자동 정리).
     테이블: `ephemeral_chunks` (session_id, upload_id, content, embedding, bm25_tsv) — Phase 4 의 `0014_uploads.sql` 동반.
  4. 본 message 의 LLM 호출 시 system prompt 에 "다음 첨부 문서 검색 가능: <filename>..." 추가, `knowledge_search` 도구가 자동으로 session+project 양쪽 인덱스 검색.
- citation 은 `text_delta` 안에 `[N]` 마커로 inline + `event: citation` 으로 reference 발행 (17-PROMPT-ASSETS § citation 단일 출처):
  ```
  event: citation
  data: { index: 1, source: "project" | "ephemeral", documentId? | uploadId, filename, title?, page?, sourceUri?, snippet }   # 14 § ChatEvent.citation 과 1:1. filename/title/sourceUri 로 footer Reference 섹션 렌더.
  ```
  > 18-FRONTEND-WIREFRAMES § /chat 의 footer 영역이 `index` 로 정렬해 `[1]`, `[2]` 형태로 렌더.

Response 200 (SSE):
  # 모든 event payload 는 14-INTERFACES § ChatEvent (discriminated union) 과 1:1.
  event: message_start
  data: { messageId, meta: { provider, model } }   # 14 의 message_start type 과 동일 nested 형태

  # message_replace — stop reason='tool_use' 후 server 가 tool 실행 후 같은 messageId 로 stream 재개 시. § stop 의미 표 참조.
  event: message_replace
  data: { messageId, contentSoFar }                # 도구 실행 전까지의 누적 content (idempotent merge)

  event: text_delta
  data: { text: "..." }

  event: tool_use
  data: { toolCallId, name, args }

  event: tool_result
  data: { toolCallId, content }

  # HITL — 도구 정책이 'hitl' 이거나 모델 위험 판단 시. client 는 POST /sessions/:id/messages/hitl 로 응답.
  # hitl_request 는 tool_use 직전, hitl_resolved/hitl_timeout 은 client 응답 후 또는 expiresAt 도달 시 emit.
  event: hitl_request
  data: { toolCallId, toolName, args, rationale, expiresAt }    # 14 § ChatEvent.hitl_request 와 1:1.

  event: hitl_resolved
  data: { toolCallId, decision: "approved"|"denied", modifiedArgs?, reason? }

  event: hitl_timeout
  data: { toolCallId }

  event: citation
  data: { index, source: "project"|"ephemeral", documentId?, uploadId?, filename, title?, page?, sourceUri?, snippet }   # 14 § ChatEvent.citation 과 1:1. project → documentId, ephemeral → uploadId. filename/title/sourceUri 가 footer Reference 섹션 렌더 (라운드 28).

  event: artifact_created
  data: { artifactId, artifactKind, filename, sizeBytes, downloadUrl? }   # 14 § ChatEvent.artifact_created 와 1:1. entity 종류는 artifactKind (SSE event discriminant `type` 과 분리).

  event: stop
  data: { reason: "end_turn"|"tool_use"|"max_tokens"|"aborted", usage: { ... } }
  # HITL denied/timeout → 모델이 후속 자연어 응답을 만들며 reason='end_turn'. tool_use 가 실제로 실행되지 않았으면 reason='tool_use' 가 아님.

  event: error
  data: { error: SerializedError }   # SerializedError = { code, category, message, retryable?, details? } — 14 § SerializedError 단일 출처. Error class instance 가 아닌 JSON shape.

Errors:
  401, 403 (quota 초과 시), 429, 503 (LLM provider down)
```

> **단일 출처**: 위 12 event = 14-INTERFACES § ChatEvent union. 본문 표기는 그 reflect. 추가/변경은 14 먼저 → 16 follow.

### `GET /sessions/:id/messages/:messageId/stream` (SSE — resume after stop reason='tool_use' 또는 client reconnect)

```
stop reason='tool_use' 후 server 가 tool 실행 → 같은 messageId 의 후속 stream 을 본 endpoint 가 emit.
client 가 stop reason='tool_use' 를 받으면 자동으로 본 endpoint 에 GET (또는 server-pushed reconnect).
또한 SSE 연결이 네트워크 오류로 끊겼을 때 client 가 마지막 messageId 로 재연결.

Path:
  :messageId — server 가 message_start event 에서 발급한 ID

Idempotency:
  서버가 같은 messageId 에 대해 multiple subscriber 를 OK (broadcast). 동일 client 의 재요청은 마지막 cursor 부터.

Response 200 (SSE):
  # 첫 event 는 항상 message_replace (현재까지 누적된 content 를 client 상태와 동기화)
  event: message_replace
  data: { messageId, contentSoFar }

  # 그 다음은 stop reason='tool_use' 직후 시퀀스 — tool_result → text_delta → ... → stop
  event: tool_result
  data: { toolCallId, content }

  event: text_delta
  data: { text }

  event: stop
  data: { reason: "end_turn"|"max_tokens"|"aborted", usage }

Errors:
  404 NOT_FOUND       — messageId 존재하지 않음 또는 다른 user 소유
  410 GONE            — message 가 이미 terminal (reason='end_turn'/'max_tokens'/'aborted' 로 완료됨, resume 불필요)
  409 CONCURRENT_RUN  — message 가 다른 client 의 active stream 에 잡혀있음 (옵션, 정책에 따라 broadcast 허용 시 409 안 줌)
```

> **client 동작**: 18-FRONTEND § /chat 의 streaming reducer 는 stop reason='tool_use' 받자마자 `EventSource(\`/api/v1/sessions/${sessionId}/messages/${messageId}/stream\`)` 자동 연결. 첫 message_replace 로 상태 동기화 후 후속 event 처리.

### `GET /sessions/:id/messages?cursor&limit`
```
Response 200: {
  data: Array<Message>,
  meta: { requestId, nextCursor? }
}
Message: { id, sessionId, role, content, createdAt, tokensIn?, tokensOut?, costMicros? }
```

## 4. Projects

### `POST /projects`
```
Request: {
  name: string,                           // 1~200자
  description?: string,
  visibility: "private"|"team"|"org",
  orgUnitId?: string                       // visibility="team" 일 때 필수 (UUID),
                                           // 그 외에는 무시됨
}
Response 201: { data: <Project>, meta: { requestId } }

부수효과 (단일 트랜잭션):
- projects insert (org_id=actor.org_id, org_unit_id=request.orgUnitId) — server 가 일반 INSERT (projects 의 RLS `projects_insert` 가 통과).
- project_members insert (project_id=new.id, user_id=actor.id, role='owner') — RLS 의 `pm_modify` (USING user_is_project_owner) 가 자기참조라 신규 row 에선 deny.
  → 같은 트랜잭션 안에서 server 가 `bootstrap_project_owner(p_project_id, p_user_id)` SECURITY DEFINER 함수 호출로 우회.
  구현: `apps/server/src/db/project-service.ts` 의 `createProjectWithOwner()` — projects INSERT (server) + bootstrap_project_owner() (SECURITY DEFINER 가 project_members INSERT 만 수행). **DDL 함수는 project_members 1 INSERT 만** ([06 § bootstrap_project_owner](06-DATA-MODEL.md) 와 일관). projects INSERT 는 server-level.
- (visibility=team 일 때) request.orgUnitId 가 actor 의 user_org_units 에 있는지 추가 검증.
Errors:
  400 INVALID_INPUT
    - visibility="team" AND orgUnitId 누락 → "team scope 는 orgUnitId 필수"
    - orgUnitId 가 사용자의 user_org_units 에 없음 → "해당 org_unit 멤버 아님"
```

### `GET /projects?cursor&limit&visibility`
```
Response 200: { data: Array<Project>, meta: { requestId, nextCursor? } }
```

### `GET|PATCH|DELETE /projects/:id` — 표준

### `GET /projects/:id/members`
```
Response 200: { data: Array<ProjectMember & { user: { id, email, displayName } }>, meta: { requestId } }
권한: visibility=team/org 이면 동일 org_unit 멤버 조회 가능, private 이면 멤버만.
와이어프레임 18-FRONTEND-WIREFRAMES §17 "프로젝트 상세" 화면이 호출.
```

### `POST /projects/:id/members`
```
Request: { userId: string, role: "owner"|"editor"|"viewer" }
Response 201: { data: <ProjectMember>, meta: { requestId } }
```

### `DELETE /projects/:id/members/:userId`
```
Response 204
```

## 5. Project Documents

### `POST /projects/:id/documents` (multipart)
```
Headers: Content-Type: multipart/form-data
Body: file=<binary>, metadata={...}
Response 202: { data: { documentId, indexStatus: "pending" }, meta: { requestId } }
부수효과:
- S3 업로드
- parser-pipeline 큐잉 (indexStatus: pending → parsing → chunking → embedding → indexed | failed)
- 진행 상태는 (a) 폴링 `GET /projects/:id/documents/:docId` 또는 (b) SSE `/notifications` 의 `document_indexed` event 로 추적.
```

### `GET /projects/:id/documents`
```
Response 200: { data: Array<{ id, filename, indexStatus, chunkCount, indexedAt }>, meta: { requestId } }
```

### `GET /projects/:id/documents/:docId` (단일 상태 폴링)
```
Response 200: {
  data: {
    id, projectId, filename, contentHash, mimeType, sizeBytes,
    # s3Key 는 DTO 에서 제외 (server-only) — 다운로드 필요 시 별도 endpoint
    indexStatus,                          // pending|parsing|chunking|embedding|indexed|failed
    chunkCount, indexedAt,
    failureReason,                        // indexStatus='failed' 일 때만 채워짐
    progress: { stage, percent, etaSec }, // 진행 표시용 (UI 폴링)
    createdBy, createdAt, updatedAt
  },
  meta: { requestId }
}

부수효과: 없음 (read-only).
```

### `POST /projects/:id/documents/:docId/retry`
```
indexStatus='failed' 인 document 의 재인덱싱 trigger.
Response 202: { data: { documentId, indexStatus: "pending" }, meta: { requestId } }
부수효과: existing chunks soft-delete (DB cascade), parser-pipeline 재큐잉.
Errors:
  404 NOT_FOUND
  409 CONFLICT (indexStatus != 'failed' — 진행 중이거나 이미 indexed)
```

### `DELETE /projects/:id/documents/:docId`
```
부수효과: chunks cascade delete, S3 object 삭제. Response 204.
```

> **SSE alternative (선호)**: `GET /notifications` 의 `document_indexed { documentId, projectId, indexStatus }` event 가 18 wireframe 의 upload modal 에서 progress bar 갱신용으로 사용. 폴링은 SSE 미지원 환경 fallback.

## 6. Uploads (세션 첨부)

### `POST /uploads` (multipart)
```
Body: file=<binary>, sessionId?=<uuid>
Response 201: { data: <Upload>, meta: { requestId } }  # 부록 A § Upload
30일 후 자동 정리 (data-retention)
부수효과: S3 upload + uploads 테이블 insert (sha256 dedup)
```

### `GET /uploads/:id`
```
Response 200: { data: <Upload> & { downloadUrl: string }, meta: { requestId } }  # S3 presigned 60초
```

### `DELETE /uploads/:id`
```
Response 204
부수효과: uploads row + S3 object 즉시 삭제
```

## 7. Artifacts

### `GET /artifacts/:id`
```
Response 200: {
  data: {
    id, sessionId, type, filename, sizeBytes, createdAt,
    storageKind: "inline" | "s3",           // 06-DATA-MODEL § artifacts 의 storage_kind
    downloadUrl: string | null              // s3 일 때만 presigned URL (60s), inline 이면 null
  },
  meta: { requestId }
}
```

> **storage_kind 분기 정책** (단일 출처): artifact 가 `storage_kind='inline'` 이면 본문 byte 가 DB BYTEA 컬럼에 있음 → `downloadUrl=null`, 클라이언트는 `GET /artifacts/:id/content` 로 stream. `storage_kind='s3'` 이면 S3 에 저장 → `downloadUrl` 에 presigned URL. 임계치: ≤ 256KB → inline, > 256KB → S3. server 가 `ArtifactStore.put()` 호출 시 자동 분기.

### `GET /artifacts/:id/content`
```
바이트 직접 응답 (storage_kind='inline' 또는 storage_kind='s3' 모두 동작 — server 가 통합 처리)
- inline: DB BYTEA stream
- s3: presigned URL 로 redirect (302) 또는 stream proxy
```

### `GET /sessions/:sessionId/artifacts`
```
Response 200: { data: Array<Artifact>, meta: { requestId } }
```

## 8. Artifact Shares

### `POST /artifacts/:id/share`
```
Request: { ttlDays?: number /* default 30, max 90 */ }
Response 201: { data: { token, url, expiresAt }, meta: { requestId } }
url 예: "https://{{APP_DOMAIN_PROD}}/share/<token>"
```

### `GET /artifacts/:id/shares`
```
Response 200: { data: Array<{ id, token, expiresAt, revokedAt, viewCount }>, meta: { requestId } }
```

### `DELETE /artifacts/:id/share/:token`
```
revoke
Response 204
```

### `GET /api/v1/share/:token` (metadata — 인증 우회)
```
share 페이지 (18-FRONTEND § /share/[token]) 가 제일 먼저 호출 — expires_at, revoked, artifact 메타 표시용.

Response 200: {
  data: {
    token: string,
    artifactId: string,
    filename: string,
    type: ArtifactType,                  // pdf/pptx/...
    sizeBytes: number,
    mimeType: string,
    expiresAt: string,                   // ISO timestamp
    viewCount: number,
    revokedAt: string | null
  },
  meta: { requestId }
}
404 NOT_FOUND (잘못된 토큰)
410 GONE (만료/revoked) — data 대신 error
```

### `GET /api/v1/share/:token/content` (binary/inline — 인증 우회)
```
실 artifact 내용 stream. mime 따라 binary (PDF) 또는 inline HTML.

Response 200: binary stream 또는 inline HTML (Content-Type 그대로)
404 NOT_FOUND
410 GONE
410 GONE (만료/revoke)
부수효과: artifact_shares.view_count += 1
```

## 9. Memories

### `POST /memories`
```
Request: { category: "user"|"feedback"|"project"|"reference", content: string, sessionId?: string, pinned?: boolean }
Response 201: { data: <UserMemory>, meta: { requestId } }
```

### `GET /memories?category&pinned&cursor&limit`
```
Response 200: { data: Array<UserMemory>, meta: { requestId, nextCursor? } }
```

### `PATCH|DELETE /memories/:id`

## 10. MCP Servers

### `POST /mcp-servers`
```
Request: {
  name: string,
  url: string,                     # SSRF validator 통과 의무
  transport: "streamable_http"|"sse",
  scope: { orgId?: string, projectId?: string, userId?: string },
  authHeaderName?: string,
  authSecretArn?: string
}
Response 201: { data: <McpServerRecord>, meta: { requestId } }
부수효과: 즉시 도구 discovery
```

### `GET /mcp-servers`
```
scope 기반 필터링
Response 200: { data: Array<McpServerRecord>, meta: { requestId } }
```

### `POST /mcp-servers/:id/refresh` — 도구 재발견

### `DELETE /mcp-servers/:id`

## 11. Skills

### `GET /skills`
```
사용자가 사용 가능한 스킬 목록 (org/project/user scope)
Response 200: { data: Array<SkillSpec>, meta: { requestId } }
```

### `GET /skills/:id/SKILL.md` — 본문

### `GET /skill-assets/:skillId/:filename` — binary

## 12. Config / Quota / Usage

### `GET /config`
```
클라이언트 부트스트랩
Response 200: {
  data: {
    availableModels: string[],
    availableTools: string[],
    features: { artifactShare: boolean, memory: boolean, ... }
  },
  meta: { requestId }
}
```

### `GET /quota`
```
Response 200: { data: { budgetMicros, usedMicros, periodEnd }, meta: { requestId } }
```

### `GET /usage/me?from&to`
```
일반 사용자 — 본인 usage 만. /settings/quota UI 가 사용 (18 § /settings/quota).
Response 200: { data: Array<{ date, tokensIn, tokensOut, costMicros }>, meta: { requestId } }
```

### `GET /usage?from&to`
```
admin 전용 — 모든 사용자 usage (userId 포함).
Response 200: { data: Array<{ date, userId, tokensIn, tokensOut, costMicros }>, meta: { requestId } }
```

## 13. Notifications (SSE)

### `GET /notifications` (SSE)
```
Headers: Accept: text/event-stream

events (14-INTERFACES § NotificationEvent 와 1:1):
  event: document_indexed
  data: { documentId, projectId, indexStatus }

  event: quota_warning
  data: { remaining, periodEnd }

  event: alert_event
  data: { rule, severity, payload }

  event: ping
  data: {}                                         # 30초 heartbeat (ALB idle timeout 방지)
```

## 14. Health / Admin

### `GET /health` (envelope 예외 — 단순 health probe, ALB 가 직접 파싱)
```
Response 200: { status: "ok", deps: { db: "ok", redis: "ok", e2b: "ok", llm: "ok" }, ts: "..." }
Response 503: 위 deps 중 하나라도 fail
```

### `GET /admin/dashboard` — admin
```
관리자 대시보드 요약 (사용자/세션/에러 카운트).
Response 200: {
  data: {
    users: { total, activeLast24h, newLast7d },
    sessions: { total, activeNow, completedLast24h },
    errors: { last24h, last7d, critical },
    tools: { totalCalls24h, errorRate, p50LatencyMs }
  },
  meta: { requestId }
}
```

### `GET /admin/health/history?target&from&to` — admin
```
deps 별 health probe 이력 (alarm 분석용).
Query: target (db|redis|e2b|llm), from (ISO date), to (ISO date)
Response 200: {
  data: Array<{ target, status, ts, latencyMs?, errorMessage? }>,
  meta: { requestId }
}
```

### `GET /admin/users?cursor&limit&search&status` — admin
```
사용자 관리 테이블 데이터.
Response 200: {
  data: Array<{ id, email, name, orgId, role, status, lastLoginAt }>,
  meta: { requestId, nextCursor? }
}
```

### `PATCH /admin/users/:id` — admin
```
role / status 변경.
Request: { role?: "member"|"admin"|"owner", status?: "active"|"suspended" }
Response 200: { data: <User>, meta: { requestId } }
부수효과: 변경 audit log 적재.
```

### `POST /admin/users/:id/suspend` — admin
```
사용자 즉시 suspend (모든 세션 강제 로그아웃).
Request: { reason: string }
Response 200: { data: { ok: true, sessionsRevoked: number }, meta: { requestId } }
```

### `POST /admin/users/:id/unsuspend` — admin
```
suspend 해제.
Response 200: { data: { ok: true }, meta: { requestId } }
```

### `GET /admin/tool-metrics?from&to` — admin
```
도구별 호출 통계 + 에러율 + 지연시간.
Response 200: {
  data: Array<{
    toolName, count, errorCount, errorRate,
    p50DurationMs, p95DurationMs, p99DurationMs,
    last24h: { count, errorRate }
  }>,
  meta: { requestId }
}
```

## 15. Errors (자체 리포팅)

### `POST /errors`
```
client error 보고 endpoint
Request: { level, category, message, context, requestId? }
Response 202: { data: { received: true }, meta: { requestId } }
```

---

## OpenAPI 생성

**Toolchain (단일 출처)**:
- 빌더: `@hono/zod-openapi` 패키지. `apps/server/src/openapi.ts` 가 zod schema 들을 모아 OpenAPI 3.1 spec 생성.
- 정적 dump CLI: `apps/server/scripts/generate-openapi.ts` (위 빌더 호출 → 파일 쓰기).
- 출력: `apps/server/openapi.json` (web 의 `api-types:generate` 가 `openapi-typescript` 로 .d.ts 생성).

> **이전 문서에서 `zod-to-openapi` 또는 `z.toJSONSchema` 가 언급된 경우는 모두 drift — `@hono/zod-openapi` 단일 사용.** (zod-to-openapi 는 동일 기능이지만 두 라이브러리를 섞으면 schema 직렬화가 미세하게 갈림. 본 plan 은 hono 와 통합 가능한 `@hono/zod-openapi` 만 사용.)

**파일 명명**:
- `apps/server/src/openapi.ts` — 빌더 (runtime 에서 `/openapi.json` endpoint 도 동일 함수 사용).
- `apps/server/scripts/generate-openapi.ts` — CLI 래퍼 (CI 가 호출).

```bash
# server 패키지 내부 실행
pnpm --filter @{{PROJECT_SLUG}}/server openapi:generate

# 또는 root 에서 (gen:api-docs 가 위 명령으로 proxy)
pnpm gen:api-docs
# 출력: apps/server/openapi.json
```

`apps/web/scripts/generate-types.ts` 가 OpenAPI → TypeScript types 변환:

```bash
pnpm --filter @{{PROJECT_SLUG}}/web api-types:generate
# 출력: apps/web/src/lib/api-types.generated.ts
```

CI 의 `api-contract-check` job 이 두 파일이 diff 가 없는지 확인 (15 참조).

## 클라이언트 사용 패턴

`apps/web/src/lib/api-client.ts`:
```ts
import type { paths } from "./api-types.generated";

export async function createSession(body: paths["/sessions"]["post"]["requestBody"]) {
  // ... typed
}
```

## 변경 정책

- Breaking change (status/body/path 시그니처 변경): minor 버전업 (`/api/v2/`), 6개월 deprecation
- Additive change (새 endpoint, optional field 추가): patch — 즉시 가능
- 모든 변경은 PR description 의 `## Migration` 섹션에 기록 + ADR 자동 생성

---

## 부록 A · Named Response Types (Zod schema)

> 본 부록은 위 § 본문 head 의 source-of-truth 계층의 reflect. 본 부록의 schema 정의는 plan 안에 작성하지만, **실 빌드 시점에는 `packages/shared/src/schemas/*.ts` 가 단일 출처** — server routes / OpenAPI / web types 모두 그것을 import/generate. 본 부록을 손으로 수정하지 말고 `packages/shared/src/schemas/` 의 Zod 를 먼저 고친 뒤 `pnpm gen:api-docs` 로 재생성.

```ts
// ─── 공통 ───
import { z } from "zod";

export const Uuid = z.string().uuid();
export const Timestamp = z.string().datetime({ offset: true });
export const TokenMicros = z.number().int().nonnegative();

// ─── User / Org ───
export const Role = z.enum(["member","admin","owner"]);
export const UserStatus = z.enum(["active","suspended","deleted"]);

// User = 내부 admin DTO (status, lastLoginAt 등 server-only 필드 포함).
// /admin/users 같은 admin endpoint 에서 사용.
export const User = z.object({
  id: Uuid,
  email: z.string().email(),
  name: z.string().nullable(),
  orgId: Uuid,
  role: Role,
  customInstructions: z.string().nullable(),
  status: UserStatus,
  lastLoginAt: Timestamp.nullable(),
  createdAt: Timestamp,
});

// AuthUser = /auth/me, /auth/login, /auth/magic-link/verify 응답의 user 필드 전용.
// status / lastLoginAt 제외 (본인 정보엔 노출 불필요, 보안 ↑).
export const AuthUser = z.object({
  id: Uuid,
  email: z.string().email(),
  name: z.string().nullable(),
  orgId: Uuid,
  role: Role,
  customInstructions: z.string().nullable(),
  createdAt: Timestamp,
});

// Organization = 내부 admin DTO (defaultTokenBudgetMicros, updatedAt 포함).
export const Organization = z.object({
  id: Uuid,
  name: z.string(),
  domain: z.string(),
  plan: z.string(),
  allowedModels: z.array(z.string()),
  allowedTools: z.array(z.string()),
  defaultTokenBudgetMicros: z.number().int().nullable(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});

// AuthOrganization = /auth/me, login 응답의 org 필드 전용 — admin 전용 필드 제거 가능 시점에 좁힘.
// v1.0 은 Organization 과 동일 shape (모든 멤버가 보는 정보로 결정됨).
export const AuthOrganization = Organization;

// AuthMeResponse — /auth/me, /auth/login 응답 단일 출처. /auth/magic-link/verify 는 302 redirect (body 없음, 본 schema 미사용).
// 모든 3 endpoint 가 본 schema 반환. envelope: { data: AuthMeResponse, meta: { requestId } }.
export const AuthMeResponse = z.object({
  user: AuthUser,
  org: AuthOrganization,
});

export const OrgUnit = z.object({
  id: Uuid,
  orgId: Uuid,
  parentId: Uuid.nullable(),
  name: z.string(),
  pathKey: z.string(),
});

// ─── Session / Message ───
export const Session = z.object({
  id: Uuid,
  userId: Uuid,
  projectId: Uuid.nullable(),
  title: z.string().nullable(),
  archivedAt: Timestamp.nullable(),
  lastMessageAt: Timestamp.nullable(),
  createdAt: Timestamp,
});

export const MessageRole = z.enum(["user","assistant","system","tool"]);
export const ToolCallContent = z.object({
  toolCallId: z.string(),
  name: z.string(),
  args: z.record(z.unknown()),
});
export const ToolResultContent = z.object({
  toolCallId: z.string(),
  content: z.union([z.string(), z.record(z.unknown())]),
});

// MessageCitation — SSE citation event payload 와 1:1. Message 가 persist 한 inline reference.
// reload 후에도 frontend 가 footer Reference 섹션 재구성 가능.
export const MessageCitation = z.object({
  index: z.number().int().positive(),
  source: z.enum(["project", "ephemeral"]),
  documentId: Uuid.optional(),
  uploadId: Uuid.optional(),
  filename: z.string(),
  title: z.string().optional(),
  page: z.number().int().optional(),
  sourceUri: z.string().optional(),
  snippet: z.string(),
});

export const Message = z.object({
  id: Uuid,
  sessionId: Uuid,
  role: MessageRole,
  content: z.union([
    z.string(),
    z.array(z.discriminatedUnion("type", [
      z.object({ type: z.literal("text"), text: z.string() }),
      z.object({ type: z.literal("tool_use"), ...ToolCallContent.shape }),
      z.object({ type: z.literal("tool_result"), ...ToolResultContent.shape }),
    ])),
  ]),
  parentMessageId: Uuid.nullable(),
  // streaming 상태 복원 (reload 후 footer/panel 재구성):
  citations: z.array(MessageCitation).default([]),       // inline [N] 마커의 reference
  artifactIds: z.array(Uuid).default([]),                // 본 message 에서 생성된 artifact id
  toolCallIds: z.array(z.string()).default([]),          // 본 message 의 tool_use 호출 id (orchestrator log 와 join)
  runStatus: z.enum(["pending","running","completed","cancelled"]).optional(),  // sessions_active_runs 와 join — assistant message 만 의미. user/tool 메시지는 미설정.
  tokensIn: z.number().int().optional(),
  tokensOut: z.number().int().optional(),
  costMicros: TokenMicros.optional(),
  createdAt: Timestamp,
});

// ─── Project ───
export const Visibility = z.enum(["private","team","org"]);
export const ProjectRole = z.enum(["owner","editor","viewer"]);

export const Project = z.object({
  id: Uuid,
  orgId: Uuid,
  ownerId: Uuid,
  orgUnitId: Uuid.nullable(),
  name: z.string().min(1).max(200),
  description: z.string().nullable(),
  visibility: Visibility,
  archivedAt: Timestamp.nullable(),
  createdAt: Timestamp,
});

export const ProjectMember = z.object({
  projectId: Uuid,
  userId: Uuid,
  role: ProjectRole,
  createdAt: Timestamp,
});

// IndexStatus — 14-INTERFACES § ProjectDocumentRecord 와 단일 출처 일치.
export const IndexStatus = z.enum(["pending","parsing","chunking","embedding","indexed","failed"]);
// HTTP DTO — 14-INTERFACES § ProjectDocumentRecord 에서 server-only 필드 (s3Key) 를 **제외** 한 형태.
// mapper: apps/server/src/mappers/project-document-mapper.ts # projectDocumentRecordToDto.
// lint § 32 가 본 DTO 에 s3Key/inlineContent/tokenHash 등 server-only 필드가 없는지 자동 검사.
export const ProjectDocument = z.object({
  id: Uuid,
  projectId: Uuid,
  filename: z.string(),
  contentHash: z.string(),
  mimeType: z.string(),                              // non-null
  sizeBytes: z.number().int(),
  // s3Key 는 server-only — DTO 에 노출 금지. 다운로드 필요 시 별도 endpoint `GET /projects/:id/documents/:docId/content` 또는 presigned URL 발급.
  indexStatus: IndexStatus,
  chunkCount: z.number().int(),
  indexedAt: Timestamp.nullable(),
  failureReason: z.string().nullable(),
  createdBy: Uuid,                                   // 작성자
  createdAt: Timestamp,
  updatedAt: Timestamp,
});

// ─── Artifact ───
export const ArtifactType = z.enum([
  "pptx","pdf","docx","xlsx","markdown","html","image","other"
]);
// 06-DATA-MODEL § artifacts CHECK + 14-INTERFACES § ArtifactStore 와 단일 출처 일치.
export const StorageKind = z.enum(["inline","s3"]);

export const Artifact = z.object({
  id: Uuid,
  sessionId: Uuid.nullable(),
  createdBy: Uuid,
  type: ArtifactType,
  filename: z.string(),
  mimeType: z.string().nullable(),
  sizeBytes: z.number().int(),
  storageKind: StorageKind,
  sharedAt: Timestamp.nullable(),
  createdAt: Timestamp,
});

export const ArtifactShare = z.object({
  id: Uuid,
  artifactId: Uuid,
  token: Uuid,
  issuedBy: Uuid,
  expiresAt: Timestamp,
  revokedAt: Timestamp.nullable(),
  viewCount: z.number().int().nonnegative(),
  createdAt: Timestamp,
});

// ─── Memory ───
export const MemoryCategory = z.enum(["user","feedback","project","reference"]);
export const MemorySource = z.enum(["auto-extract","manual"]);

export const UserMemory = z.object({
  id: Uuid,
  userId: Uuid,
  category: MemoryCategory,
  content: z.string().min(1).max(2000),
  source: MemorySource,
  sessionId: Uuid.nullable(),
  pinned: z.boolean(),
  metadata: z.record(z.unknown()).nullable(),
  createdAt: Timestamp,
});

// ─── Skill / MCP ───
export const PermissionTier = z.enum(["system","project","user","tool"]);

export const SkillSpec = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*@\d+\.\d+\.\d+$/),  // '{{BRAND_PPTX_SKILL_NAME}}@1.0.0'
  name: z.string(),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  description: z.string().min(20),
  triggers: z.array(z.string()),
  entryPoint: z.string(),
  permissions: PermissionTier,
  assets: z.array(z.object({ filename: z.string(), s3Key: z.string() })).optional(),
});

export const McpTransport = z.enum(["streamable_http","sse"]);
export const McpServerStatus = z.enum(["active","degraded","suspended"]);

export const McpServerRecord = z.object({
  id: Uuid,
  orgId: Uuid,
  projectId: Uuid.nullable(),
  userId: Uuid.nullable(),
  name: z.string(),
  url: z.string().url(),
  transport: McpTransport,
  authHeaderName: z.string().nullable(),
  authSecretArn: z.string().nullable(),
  supportedTools: z.array(z.object({
    name: z.string(),
    description: z.string(),
    inputSchema: z.record(z.unknown()),
  })),
  lastDiscoveredAt: Timestamp.nullable(),
  status: McpServerStatus,
});

// ─── Quota / Usage ───
export const QuotaInfo = z.object({
  budgetMicros: TokenMicros,
  usedMicros: TokenMicros,
  periodStart: Timestamp,
  periodEnd: Timestamp,
  warningThreshold: z.number().min(0).max(1),       // 0.9 default
});

export const UsageLogEntry = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  userId: Uuid,
  provider: z.string(),
  model: z.string(),
  tokensIn: z.number().int(),
  tokensOut: z.number().int(),
  costMicros: TokenMicros,
});

// ─── Upload ───
export const Upload = z.object({
  id: Uuid,
  filename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
  expiresAt: Timestamp,
  createdAt: Timestamp,
});

// ─── 공통 응답 envelope ───
export const Envelope = <T extends z.ZodTypeAny>(data: T) => z.object({
  data,
  meta: z.object({
    requestId: Uuid,
    nextCursor: z.string().optional(),
    totalApprox: z.number().int().optional(),
  }),
});

export const ErrorEnvelope = z.object({
  error: z.object({
    code: z.string(),
    category: z.string(),
    message: z.string(),
    details: z.array(z.unknown()).optional(),
  }),
  meta: z.object({ requestId: Uuid }),
});
```

### endpoint × response 매핑

위 schema 가 각 endpoint 의 응답에 어떻게 쓰이는지:

| Endpoint | Response data 타입 |
|---|---|
| `POST /auth/login`, `GET /auth/me` | `AuthMeResponse` = `{ user: User, org: Organization }` (envelope: `{ data: AuthMeResponse, meta }`) — 18 § AppContext bootstrap 단일 출처 |
| `POST /sessions`, `GET /sessions/:id` | `Session` |
| `GET /sessions` | `Page<Session>` (envelope.data = `Session[]`, nextCursor) |
| `POST /messages` (SSE) | (events 는 별도 — Anthropic SSE → ChatEvent 매핑 [14-INTERFACES.md § 6](14-INTERFACES.md)) |
| `GET /sessions/:id/messages` | `Page<Message>` |
| `POST/GET /projects[/:id]` | `Project`, `Page<Project>` |
| `POST /projects/:id/members` | `ProjectMember` |
| `POST /projects/:id/documents` | `ProjectDocument` |
| `GET /artifacts/:id` | `Artifact & { downloadUrl: string }` |
| `POST /artifacts/:id/share` | `ArtifactShare & { url: string }` |
| `POST/GET /memories` | `UserMemory`, `Page<UserMemory>` |
| `POST/GET /mcp-servers` | `McpServerRecord`, `Page<McpServerRecord>` |
| `GET /skills` | `Page<SkillSpec>` |
| `GET /quota` | `QuotaInfo` |
| `GET /usage` | `Page<UsageLogEntry>` |
| `POST /uploads` | `Upload` |

OpenAPI 생성:
```bash
pnpm --filter @{{PROJECT_SLUG}}/server openapi:generate
# 위 schema 들을 @hono/zod-openapi 로 OpenAPI 3.1 spec 변환 → apps/server/openapi.json
```

`pnpm --filter @{{PROJECT_SLUG}}/web api-types:generate` 가 그 openapi.json 을 받아 TypeScript 타입 생성 (`apps/web/src/lib/api-types.generated.ts`).
