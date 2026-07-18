# RFC: P22 계약 배치 (Contract Batch) — Tier3 20개 태스크의 FROZEN 표면 변경 제안

- 태스크: `P22-C-01` (phase P22, team RC, 휴먼게이트)
- 상태: **PENDING HUMAN REVIEW** — 이 문서는 *제안*이다. `packages/interfaces`·`packages/shared`·migration 은 **아직 한 줄도 수정하지 않았다.**
- 근거: `docs/P22-GAP-CATALOG.md` (딥리서치 갭 대장), `rebuild_plan/14-INTERFACES.md`, `rebuild_plan/16-API-CONTRACT.md`, `CLAUDE.md` path ownership
- 승인 방법: 검토 후 `.ralph/CONTRACT_APPROVED` 를 생성하고, **승인한 변경 단위 ID(C1~C17) 화이트리스트**를 그 안에 적는다. 화이트리스트에 없는 단위는 계속 격리된다.

## 0. 요약

Tier3 20개 태스크는 모두 `packages/interfaces`·`packages/shared`·DB migration·미지정 dependency 중 하나 이상을 요구해서 루프가 자율 구현할 수 없다. 이 RFC 는 그 요구를 **17개 변경 단위(C1~C17)** 로 묶고, 각 단위마다 제안 diff·migration·롤백 경로·영향 파일·권고를 적는다.

권고 분포:

| 권고                                                             | 단위                         | 태스크                                          |
| ---------------------------------------------------------------- | ---------------------------- | ----------------------------------------------- |
| **APPROVE** (작고 additive, 즉시 가치)                           | C1, C2, C3, C4, C9, C10, C17 | T1-10, T1-13, T1-15, T4-03, T6-13, T6-16, T6-19 |
| **APPROVE-with-scope** (크지만 OWUI 파리티 핵심, 단계 축소 제안) | C5, C6, C7, C11, C12, C13    | T6-10, T6-14, T6-15, T6-17, T6-18, T1-12        |
| **DEFER** (엔터프라이즈 거버넌스 phase — 계약만 예약, 구현 보류) | C8, C14, C15, C16            | T6-12, T1-11, T1-16, T1-17                      |
| **REJECT / WON'T-BUILD** (설계상 스코프 밖)                      | —                            | T1-14, T6-11, T6-20                             |
| **DEPENDENCY-ONLY** (기존 격리 태스크 해제용)                    | C18                          | P22-T2-03 (이미 blocked)                        |

### 설계 원칙 (모든 제안에 공통 적용)

1. **Additive only** — 기존 필드·시그니처 제거/의미변경 금지. 기존 호출부는 컴파일·런타임 모두 무변경.
2. **Nullable-first** — 새 DB 컬럼은 전부 `NULL` 허용(또는 DEFAULT 동반). 기존 행 백필 불필요.
3. **Optional-first (TS)** — 새 인터페이스 멤버는 `?:` 또는 optional 파라미터. 기존 구현체(fake/in-memory 포함)가 깨지지 않음.
4. **롤백 경로 명시** — migration 마다 `-- 롤백 경로:` 주석(dev/staging 전용 역DDL, prod forward-only) — 기존 0001~0031 관례 준수.
5. **단일 출처 동기화** — `packages/interfaces` 를 고치면 `rebuild_plan/14-INTERFACES.md` 의 동일 블록도 같은 커밋에서 고친다. 새 REST 엔드포인트는 `rebuild_plan/16-API-CONTRACT.md` 에 먼저 적는다.
6. **RLS 필수** — 새 org-scoped 테이블은 `ENABLE` + `FORCE ROW LEVEL SECURITY` + `org_id = NULLIF(current_setting('app.org_id', true), '')::uuid` 정책(0031 패턴).

### 검토 중 발견한 사실 (승인 판단에 영향)

- **`packages/shared` 는 사실상 빈 스텁이다.** `packages/shared/src/index.ts` 는 `export {};` 한 줄이고 `schemas/` 디렉토리가 없다. 갭 카탈로그 다수가 "packages/shared/src/schemas/\*.ts 에 Zod 스키마 추가"를 전제하지만 **그 관례는 현재 코드베이스에 존재하지 않는다.** 실제 Zod 스키마는 전부 `apps/server/src/` 안에 산다(`lib/org-settings-schema.ts` 가 대표 패턴이며 헤더에 `packages/interfaces·shared 미사용(frozen 회피)` 라고 명시).
  → **권고: 계약용 Zod 스키마는 `packages/shared` 로 옮기지 말고 지금처럼 `apps/server/src/lib/*-schema.ts` 에 두자.** 그러면 C9/C10/C13 등 다수 항목이 FROZEN 변경 없이(=휴먼게이트 없이) 진행 가능해져 승인 표면이 크게 줄어든다. 이 RFC 는 그 전제로 작성했다. 반대 의견이면 승인서에 "shared-schemas: yes" 로 표시해 달라.
- **migration 은 forward-only 이고 `meta/_journal.json` 동기화가 필요하다.** 새 migration 은 `0032_` 부터이며 journal 에 `idx: 31, tag: "0032_...", when: <직전+100000>` 항목을 추가해야 한다.
- **△UNVERIFIED 3건은 실재 확인 완료(진짜 갭).** `apps/`·`packages/` 전체에서 `oidc|oauth|saml|trusted-header`(T1-17), `arena|leaderboard`(T6-11), `getUserMedia|webrtc`(T6-20) 매치 0건. 가짜 갭 아님.

---

## C1 — Health history 시간범위 필터 + `ts` 필드 (P22-T1-10)

**갭**: `GET /admin/health/history` 에 from/to 범위 필터가 없고, 응답 항목에 `ts` 가 없어 계약(`16-API-CONTRACT.md:946`)과 불일치.

**제안 diff** — `packages/interfaces/src/types.ts:322`

```diff
 export interface HealthCheckResult {
   target: string;
   status: "healthy" | "degraded" | "down";
   latencyMs: number | null;
+  /** 계약 16-API-CONTRACT.md § admin/health/history. 기존 append 호출부 호환 위해 optional —
+   *  저장소가 채워 넣고, 조회 응답에서는 항상 존재한다. */
+  ts?: Date;
   context?: Record<string, unknown>;
 }
```

`packages/interfaces/src/types.ts:588` — **`recent` 는 그대로 두고 오버로드가 아닌 optional 3번째 인자로 확장**(기존 호출부 무변경):

```diff
 export interface HealthHistoryRepo {
   append(entry: HealthCheckResult): Promise<void>;
-  recent(target: string, limit: number): Promise<HealthCheckResult[]>;
+  recent(
+    target: string,
+    limit: number,
+    range?: { from?: Date; to?: Date },
+  ): Promise<HealthCheckResult[]>;
 }
```

**Migration**: 불필요. `health_check_history` 에 타임스탬프 컬럼이 이미 있다(구현 시 `admin-data-access.ts` 에서 select 목록에 추가만 하면 됨 — 구현 태스크가 확인할 것).

**영향 파일**: `packages/interfaces/src/types.ts`, `rebuild_plan/14-INTERFACES.md`(동일 블록), `apps/server/src/db/admin-data-access.ts`, `apps/server/src/routes/admin.ts`.

**롤백**: 코드 revert 만. DB 무변경.

**권고: APPROVE** — 순수 additive, 계약 준수 방향, 위험 최소.

---

## C2 — 보존기간 삭제 계약: error_logs / health_history / messages (P22-T1-15)

**갭**: 부록 H 보존정책 3·4·5 항이 미구현. `ErrorLogRepo`·`HealthHistoryRepo` 에 삭제 메서드가 없고 `Organization` 에 보존일수 필드가 없어 `data-retention.ts` 가 해당 단계를 아예 갖지 못한다(파일 헤더에도 그 사유가 적혀 있다).

**제안 diff** — `packages/interfaces/src/types.ts`

```diff
 export interface ErrorLogRepo {
   append(entry: ErrorLogEntry): Promise<void>;
   list(...): Promise<Page<ErrorLogEntry>>;
+  /** 보존정책 cron 전용. 삭제된 행 수를 반환. UploadRepo.expiredOlderThan 와 동일 계열. */
+  deleteOlderThan(cutoff: Date): Promise<number>;
 }

 export interface HealthHistoryRepo {
   append(entry: HealthCheckResult): Promise<void>;
   recent(...): Promise<HealthCheckResult[]>;
+  deleteOlderThan(cutoff: Date): Promise<number>;
 }

 export interface MessageRepo extends Repo<Message, {...}> {
   appendStream(...): Promise<Message>;
+  /** org 보존정책 cron 전용 벌크 삭제. orgId 생략 시 전 org(시스템 스코프). */
+  deleteOlderThan(cutoff: Date, orgId?: string): Promise<number>;
 }

 export interface Organization {
   ...
   defaultTokenBudgetMicros: number | null;
+  /** 메시지 보존일수. null = 무기한 보존(기존 동작). */
+  retentionDays: number | null;
   createdAt: Date;
   updatedAt: Date;
 }
```

**Migration `0032_org_retention_days.sql`** (nullable-first, 기존 행 전부 `NULL` = 현행 동작 유지):

```sql
-- 0032 · organizations.retention_days (메시지 보존정책)
-- 단일 출처: rebuild_plan/12-OPS-SECURITY.md 부록 H, packages/interfaces Organization
-- nullable-first: NULL = 무기한 보존(기존 동작). 백필 불필요.
-- 롤백 경로: dev/staging 전용 — ALTER TABLE organizations DROP COLUMN retention_days.
--   prod 는 forward-only 정책.
ALTER TABLE organizations
  ADD COLUMN retention_days INTEGER;                -- NULL = 무기한

ALTER TABLE organizations
  ADD CONSTRAINT organizations_retention_days_positive
  CHECK (retention_days IS NULL OR retention_days > 0);
```

- `meta/_journal.json` 에 `idx: 31, tag: "0032_org_retention_days"` 추가.

**주의(구현 태스크가 지킬 것)**: 메시지 삭제는 파괴적이다. 구현 시 (a) `retentionDays IS NULL` 인 org 는 **건드리지 않는다**, (b) 삭제 전 건수를 로그·audit_log 에 남긴다, (c) 배치 크기 상한(예: 1000행/틱)을 둔다.

**영향 파일**: `packages/interfaces/src/types.ts`, `rebuild_plan/14-INTERFACES.md`, `apps/server/src/db/migrations/0032_*.sql` + `meta/_journal.json`, `apps/server/src/db/admin-data-access.ts`(또는 해당 repo 구현), `apps/server/src/lib/data-retention.ts`, `apps/server/src/lib/retention-scheduler.ts`.

**권고: APPROVE** — 단, 위 "주의" 3항을 승인 조건으로 명시할 것.

---

## C3 — `ArtifactStore.cleanupExpired` 실동작 + 90일 artifact 보존 (P22-T4-03)

**갭**: `artifact-store.s3.ts:50` 과 `artifact-store.inline.ts:49` 둘 다 `return { deletedCount: 0 }` 스텁. `data-retention.ts` 의 2단계가 **항상 성공하는 no-op** 다. 현재 시그니처 `cleanupExpired(): Promise<...>` 는 인자가 없어 어떤 artifact 가 만료인지 알 방법 자체가 없다.

**제안 diff** — `packages/interfaces/src/types.ts` (UploadRepo 의 기존 관례를 그대로 미러):

```diff
-export type ArtifactRepo = Repo<
-  ArtifactRecord,
-  { sessionId?: string; createdBy?: string }
->;
+export interface ArtifactRepo extends Repo<
+  ArtifactRecord,
+  { sessionId?: string; createdBy?: string }
+> {
+  /** 보존정책 cron 전용. createdAt < cutoff 인 artifact 를 시스템 스코프로 열거.
+   *  UploadRepo.expiredOlderThan(types.ts:507) 와 동일 계열. */
+  expiredOlderThan(cutoff: Date): Promise<ArtifactRecord[]>;
+}
```

`packages/interfaces/src/ArtifactStore.ts:23` — **인자를 optional 로 추가**(기존 호출부 `cleanupExpired()` 무변경 컴파일):

```diff
   remove(artifactId: string): Promise<void>;
-  cleanupExpired(): Promise<{ deletedCount: number }>;
+  /** 인자 없이 호출하면 기존과 동일(no-op 허용). 보존 cron 은 열거된 만료 id 를 넘긴다. */
+  cleanupExpired(input?: {
+    artifactIds: string[];
+  }): Promise<{ deletedCount: number }>;
```

**설계 근거**: `ArtifactStore` 는 자기-완결 타입만 쓰는(파일 헤더 규칙) 바이트 저장 포트다. 여기에 Repo 의존을 주입하면 그 규칙이 깨진다. 대신 **열거는 `data-retention.ts`(DataAccess 보유)가 하고, 저장소는 id 목록만 받아 바이트를 지운다** — 책임 분리가 유지되고 인터페이스 변경도 최소다.

**Migration**: 불필요.

**보존 규칙(계약, `12-OPS-SECURITY.md:187`)**: 90일 초과 artifact 중 **활성(미취소·미만료) share 가 붙은 것은 삭제하지 않는다.** `RetentionDataAccess` 를 `Pick<DataAccess, "uploads" | "artifactShares" | "artifacts">` 로 확장해야 한다.

**영향 파일**: `packages/interfaces/src/types.ts`, `packages/interfaces/src/ArtifactStore.ts`, `rebuild_plan/14-INTERFACES.md`, `apps/server/src/lib/{artifact-store.s3,artifact-store.inline,data-retention}.ts`, artifact repo 구현.

**권고: APPROVE**.

---

## C4 — 비밀번호 로그인 `POST /auth/login` (P22-T1-13)

**갭**: `users.password_hash` 컬럼은 **이미 존재**(`0012_password_or_magic.sql:10`)하는데 로그인 핸들러가 없고, 해시를 읽어올 계약 경로가 없다.

**제안 diff** — **`User` 에 `passwordHash` 를 추가하지 말 것**(모든 `/me`·`/login` 직렬화에서 해시를 다시 지워야 하는 유출 위험). 대신 **전용 자격증명 조회 메서드**를 users repo 에 추가:

```diff
 // packages/interfaces/src/DataAccess.ts (users repo 정의부)
+  /** 비밀번호 로그인 전용. User 본체에 해시를 싣지 않기 위한 분리 경로 —
+   *  이 메서드 반환값은 절대 응답 직렬화에 넣지 않는다. */
+  credentialsByEmail(
+    email: string,
+  ): Promise<{ userId: string; orgId: string; passwordHash: string | null } | null>;
```

**Dependency 요청**: 비밀번호 검증용 해시 라이브러리가 **어느 package.json 에도 없다.** 0012 주석은 `bcrypt cost 12` 를 전제한다.

- 1순위 권고: **`bcryptjs`** (순수 JS, 네이티브 빌드 불필요 → CI/도커 단순, 컨테이너 재빌드 이슈 없음)
- 대안: `bcrypt`(네이티브, 더 빠름 / node-gyp 필요), `argon2`(더 강함 / 네이티브 + 0012 주석과 불일치 → 해시 형식 마이그레이션 필요)
- 승인 시 `apps/server/package.json` 에 1개 추가.

**Migration**: 불필요(컬럼 존재).

**보안 조건(승인 조건으로 명시 권고)**: 실패 시 계정 존재 여부가 새지 않도록 타이밍 동일화(존재하지 않는 이메일도 더미 해시 비교), 실패 임계 초과 시 `429 RATE_LIMITED`, `ALLOWED_DOMAINS` 밖이면 `403 EMAIL_DOMAIN_FORBIDDEN`, 성공 응답은 기존 `AuthMeResponse` shape + `_at`/`_rt` 쿠키.

**영향 파일**: `packages/interfaces/src/DataAccess.ts`, `rebuild_plan/14-INTERFACES.md`, `rebuild_plan/16-API-CONTRACT.md`(§auth 에 `POST /auth/login` 추가), `apps/server/src/routes/auth.ts`, `apps/server/src/__tests__/routes-mounted.test.ts`, users repo 구현, `apps/server/package.json`.

**권고: APPROVE** (dependency = `bcryptjs`).

---

## C5 — Agent 레지스트리 (커스텀 워크스페이스 모델) (P22-T6-10)

**갭**: 에이전트 생성/편집 UI·API·타입이 전무. 홈 화면은 `BUILTIN_AGENT_COUNT=4` 하드코딩.

**제안 diff** — `packages/interfaces/src/types.ts` 에 신규 엔티티 + repo:

```diff
+export interface Agent {
+  id: string;
+  orgId: string;
+  name: string;
+  description: string | null;
+  baseModel: string;                 // organizations.allowedModels 중 하나
+  systemPrompt: string | null;
+  toolIds: string[];                 // AgentToolSpec.name 참조
+  skillIds: string[];                // SkillSpec.id 참조
+  projectIds: string[];              // 지식 스코프
+  visibility: "private" | "org";
+  createdBy: string;
+  createdAt: Date;
+  updatedAt: Date;
+}
+
+export type AgentRepo = Repo<Agent, { orgId?: string; createdBy?: string; visibility?: Agent["visibility"] }>;
```

- `DataAccess` 파사드에 `agents: AgentRepo;` 추가.

**Migration `0033_agents.sql`** (신규 테이블 → nullable-first 해당 없음, RLS 필수):

```sql
-- 0033 · agents (커스텀 워크스페이스 에이전트)
-- 단일 출처: rebuild_plan/14-INTERFACES.md Agent, 16-API-CONTRACT.md § agents
-- nullable-first: 신규 테이블이라 해당 없음. description/system_prompt 는 선택 입력이라 nullable.
-- 롤백 경로: dev/staging 전용 — DROP TABLE agents. prod 는 forward-only 정책.
CREATE TABLE agents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  description   TEXT,
  base_model    TEXT NOT NULL,
  system_prompt TEXT,
  tool_ids      TEXT[] NOT NULL DEFAULT '{}',
  skill_ids     TEXT[] NOT NULL DEFAULT '{}',
  project_ids   UUID[] NOT NULL DEFAULT '{}',
  visibility    TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','org')),
  created_by    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, name)
);
CREATE INDEX agents_org_idx ON agents (org_id, updated_at DESC);

ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents FORCE  ROW LEVEL SECURITY;
-- 0001~0031 과 동일: SET LOCAL GUC 가 ROLLBACK 후 빈 문자열로 남는 특성 때문에 NULLIF 사용
CREATE POLICY agents_org_isolation ON agents
  USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
```

**API 계약 추가**(`16-API-CONTRACT.md`): `GET/POST /api/v1/agents`, `GET/PATCH/DELETE /api/v1/agents/:id`.

**영향 파일**: interfaces + 14-INTERFACES.md + 16-API-CONTRACT.md, `apps/server/src/db/migrations/0033_*.sql`(+journal), 신규 `apps/server/src/routes/agents.ts`(+ app.ts 마운트 + EXPECTED_ROUTES), `apps/web/src/components/layout/NavRail.tsx`, `apps/web/src/app/(app)/page.tsx`, 신규 `apps/web/src/components/agents/*`.

**권고: APPROVE-with-scope** — OWUI 파리티 핵심이지만 표면이 넓다. **1단계(이번 승인)**: CRUD + 목록/에디터 UI + 홈 카운트 실데이터화. **2단계(별도 승인)**: 지식/툴 접근제어 그레인·공유. 1단계만 승인 권고.

---

## C6 — Connections (외부 OpenAI 호환 provider 관리) (P22-T6-14)

**갭**: base URL + API 키로 외부 provider 를 등록/검증/활성화하는 경로가 전무.

**제안 diff** — `packages/interfaces/src/types.ts`:

```diff
+export interface ProviderConnection {
+  id: string;
+  orgId: string;
+  name: string;
+  kind: "openai-compatible";        // 향후 확장 여지
+  baseUrl: string;
+  keyPrefix: string;                // 예: "sk-...abcd" — 응답에는 이것만 노출
+  enabled: boolean;
+  verifiedAt: Date | null;
+  models: string[];
+  createdAt: Date;
+  updatedAt: Date;
+}
+
+export type ProviderConnectionRepo = Repo<ProviderConnection, { orgId?: string; enabled?: boolean }>;
```

**중요**: `ProviderConnection` DTO 에 **암호화된 키 본문을 넣지 않는다.** 키는 DB 컬럼(`api_key_encrypted`)에만 존재하고 repo 의 별도 메서드(`secretById(id): Promise<string|null>`)로만 읽는다 — C4 와 동일한 "비밀은 DTO 밖" 원칙.

**Migration `0034_provider_connections.sql`**: 위 C5 와 동일한 신규-테이블 + RLS 패턴. `api_key_encrypted BYTEA NOT NULL`, `UNIQUE (org_id, name)`, 롤백 경로 `DROP TABLE provider_connections`.

**미해결 질문(승인자 결정 필요)**: 키 암호화 키(KEK) 를 어디서 가져오나? 현재 `env.ts` 에 해당 secret 이 없다. 옵션 (a) 신규 env `PROVIDER_KEY_ENCRYPTION_KEY`(LOCAL_ONLY 는 dev 고정값), (b) AWS KMS(배포 시 human gate). **(a) 로 시작하고 배포 시 (b) 전환 권고.**

**권고: APPROVE-with-scope** — 등록/검증/활성화 + orchestrator 라우팅까지. KEK 는 (a) env 방식으로 승인 요청.

---

## C7 — Notes 워크스페이스 (P22-T6-17)

**제안 diff**:

```diff
+export interface Note {
+  id: string;
+  orgId: string;
+  userId: string;
+  title: string;
+  content: string;              // markdown
+  createdAt: Date;
+  updatedAt: Date;
+}
+export type NoteRepo = Repo<Note, { userId?: string }>;
```

**Migration `0035_notes.sql`**: 신규 테이블 + RLS(위 패턴), 롤백 `DROP TABLE notes`.
**API**: `/api/v1/notes` CRUD + `POST /api/v1/notes/:id/enhance`(orchestrator 경유 AI 개선).

**권고: APPROVE-with-scope** — **CRUD + 마크다운 에디터 + 채팅 컨텍스트 주입까지만.** AI-enhance 는 C10(completions)과 같은 백엔드 패턴이므로 C10 승인 시 함께, 아니면 2단계로.

---

## C8 — Channels (실시간 다중사용자 협업) (P22-T6-12)

**요구**: 신규 타입 6종(Channel/ChannelMember/ChannelMessage/Reaction/Mention/Presence) + 신규 migration 다수 + **실시간 전송 계층이 코드베이스에 전무**(websocket/socket.io/presence 인프라 0). SSE 는 단방향 1:1 스트리밍이라 다자 채널에 부적합.

**권고: DEFER** — 이번 배치에서 가장 큰 단일 항목이고, 나머지 19개를 전부 합친 것과 맞먹는 신규 인프라(양방향 전송 + presence + fan-out)를 끌어들인다. C5~C7(Agent/Connections/Notes)이 자리잡은 뒤 **독립 phase** 로 다루자. 지금 승인하면 다른 항목의 완성도를 갉아먹을 위험이 크다.

---

## C9 — 대화 가져오기(Chat import: native / ChatGPT) (P22-T6-13)

**요구 재평가**: 갭 카탈로그는 "packages/shared 에 Zod 스키마 추가"를 전제하지만, §0 에서 확인했듯 **그 관례가 없다.** `apps/server/src/lib/import-schema.ts`(로컬 Zod, org-settings-schema 패턴)로 두면 **FROZEN 변경이 전혀 없다.**

- interfaces 변경: **없음**(세션/메시지 생성은 기존 repo 로 충분)
- migration: **없음**
- dependency: **없음**
- 계약 문서: `16-API-CONTRACT.md` 에 `POST /api/v1/sessions/import` 추가(문서는 FROZEN 아님)

**권고: APPROVE** — 실질적으로 계약 잠금 없이 진행 가능. 승인서에 "C9: local-schema 로 진행" 만 적어주면 루프가 바로 빌드한다. (cross-org 격리 테스트 필수.)

---

## C10 — 입력 자동완성(ghost text) `POST /completions` (P22-T6-16)

C9 와 동일 구조: 신규 라우트 + 로컬 Zod 스키마로 충분하고, **interfaces·migration·dependency 변경 없음.** 기존 `orchestrator/followups.ts`(generateFollowups) 패턴 재사용. org 설정 토글은 기존 `org-settings-schema.ts` 에 `autocompleteEnabled?: boolean` 추가(JSONB 라 migration 불필요).

**권고: APPROVE** — 조건: 요청 취소(AbortSignal) 및 stale 응답 무시가 acceptance 에 포함될 것.

---

## C11 — i18n (다국어) + 사용자 언어 설정 (P22-T6-15)

**요구**: (a) `User.language`, (b) 저장용 API, (c) i18n dependency.

**제안 diff**:

```diff
 export interface User {
   ...
   customInstructions: string | null;
+  /** BCP-47 태그. null = 서버 기본(ko). 기존 사용자 전부 null → 현행 동작 유지. */
+  language: string | null;
   status: "active" | "suspended" | "deleted";
```

**Migration `0036_user_language.sql`**:

```sql
-- 0036 · users.language (사용자별 UI 언어)
-- nullable-first: NULL = 기본 'ko'(기존 동작). 백필 불필요.
-- 롤백 경로: dev/staging 전용 — ALTER TABLE users DROP COLUMN language. prod 는 forward-only.
ALTER TABLE users ADD COLUMN language TEXT;
ALTER TABLE users ADD CONSTRAINT users_language_bcp47
  CHECK (language IS NULL OR language ~ '^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$');
```

**Dependency 요청**: `next-intl`(Next.js App Router 네이티브 통합, 서버 컴포넌트 지원 → **1순위 권고**) vs `react-i18next`(생태계 큼, App Router 서버 컴포넌트와 궁합 나쁨) vs 자체 catalog 모듈(의존성 0, 복수/날짜 포맷을 직접 구현해야 함).

**권고: APPROVE-with-scope** — `User.language` + `PATCH /api/v1/me` + `next-intl` + **ko/en 2개 로케일**. 전체 문자열 추출은 점진(신규/핵심 화면부터). 주의: 현재 UI 문자열이 코드 전반에 하드코딩된 한국어라 **전면 추출은 대규모 diff** 다 — 범위를 나눠 승인하길 권한다.

---

## C12 — Skills 작성/업로드/활성화 (P22-T6-18)

**요구**: `SkillRegistry` 는 현재 읽기 전용(`list`/`byId`/`reload`)이고 스킬은 "파일시스템 불변 자산" 설계다.

**제안 diff** — 기존 인터페이스를 오염시키지 않도록 **별도 인터페이스로 분리**:

```diff
+/** 사용자 작성 스킬 저장소. 읽기 전용 SkillRegistry 와 분리해 파일시스템 기반
+ *  빌트인 스킬의 불변성을 유지한다. */
+export interface UserSkillStore {
+  create(input: { orgId: string; userId: string; skillMd: string; assets?: { filename: string; content: Buffer }[] }): Promise<SkillSpec>;
+  update(id: string, input: { skillMd?: string }): Promise<SkillSpec>;
+  setEnabled(id: string, enabled: boolean): Promise<void>;
+  remove(id: string): Promise<void>;
+}
```

**Migration `0037_user_skills.sql`**: 신규 테이블(org-scoped, RLS) — `id, org_id, user_id, name, version, skill_md, enabled BOOLEAN NOT NULL DEFAULT true, created_at, updated_at`, `UNIQUE (org_id, name, version)`. 롤백 `DROP TABLE user_skills`.

**보안 조건(필수)**: 업로드된 SKILL.md 의 entryPoint 는 **반드시 기존 샌드박스(T1 sandbox)에서만 실행**되고, `permissions` 기본값은 `user` 티어로 강제. 임의 스크립트 실행 경로가 열리지 않도록 승인 조건에 명시할 것.

**권고: APPROVE-with-scope** — 위 보안 조건 하에, 먼저 **enable/disable 토글만**(migration + 토글 API) 승인하고 create/upload 는 샌드박스 실행 경로 리뷰 후 2단계 승인 권고.

---

## C13 — OpenAPI 툴서버 인제스션 (P22-T1-12)

**요구 재평가**: `AgentTool`/`AgentToolSpec` 인터페이스는 **이미 충분**하다(카탈로그도 그렇게 적고 있다). 필요한 것은 등록된 서버를 저장할 곳과 라우트뿐 → **interfaces 변경 없음**, 로컬 Zod 스키마로 충분.

**Migration `0038_openapi_tool_servers.sql`**: 신규 org-scoped 테이블 + RLS(패턴 동일). 롤백 `DROP TABLE openapi_tool_servers`.

**보안 조건(필수)**: spec URL fetch 와 endpoint 호출 **양쪽 모두** 기존 `apps/server/src/mcp/url-validator.ts` 로 SSRF 검증(사설/내부 주소 거부). 기존 MCP 스택과 동일한 방어를 재사용할 것.

**권고: APPROVE-with-scope** — migration 1개만 승인하면 나머지는 T1 자율 범위.

---

## C14 — LDAP / Active Directory 인증 (P22-T1-11)

**요구**: `LdapAuthConfig` + `AuthProvider` 추상(현 magic-link 전용 User 모델엔 없음) + 미지정 dependency(`ldapjs`/`ldapts`) + 그룹→롤 매핑.
**계획 문서 상태**: 엔터프라이즈 거버넌스 phase 로 명시적 연기.

**권고: DEFER** — C4(비밀번호 로그인)로 비-매직링크 인증 경로를 먼저 확보한 뒤, C14/C15/C16 을 **하나의 "엔터프라이즈 아이덴티티" phase** 로 묶어 `AuthProvider` 추상을 한 번에 설계하는 편이 낫다. 지금 개별로 넣으면 인증 추상이 세 번 흔들린다.

---

## C15 — SCIM 2.0 프로비저닝 (P22-T1-16)

**요구**: SCIM User/Group 리소스 스키마 + PATCH ops + `/scim/v2` 라우트 + `externalId` 컬럼 + 계약 신규 섹션. 계획상 엔터프라이즈 거버넌스 phase 연기.

**권고: DEFER** — C14 와 같은 묶음. (SCIM 은 IdP 가 실제로 붙어야 검증 가치가 있는데 현재 LOCAL_ONLY 환경에서 그 검증이 불가하다.)

---

## C16 — OAuth/OIDC SSO + trusted-header (P22-T1-17, △UNVERIFIED→실재 확인됨)

**실재 확인**: `apps/`·`packages/` 에서 `oidc|oauth|saml|trusted-header` 매치 **0건** → 진짜 갭. 가짜 갭 아님.
**요구**: IdP 설정 타입, 콜백 라우트, 클레임→롤 매핑, 신규 dependency(`openid-client` 등).

**권고: DEFER** — C14/C15 와 같은 "엔터프라이즈 아이덴티티" 묶음. 셋 중 **실사용 우선순위는 C16(OIDC) > C14(LDAP) > C15(SCIM)** 이라고 본다(현대 IdP 는 대부분 OIDC 를 제공하고, OIDC 하나로 LDAP 요구의 상당수가 해소된다). 그 phase 를 시작할 때 이 순서를 권한다.

---

## C17 — 모델별 비용 분해 + 툴 메트릭 source/추세 (P22-T6-19)

두 하위기능이 독립적이다.

**(A) QuotaPanel 모델별 비용** — 데이터는 이미 있고 **interfaces 변경 불필요**. `routes/usage.ts` `GET /me` 에 `byModel: Array<{model, costMicros, tokensIn, tokensOut}>` 집계를 추가하고 `16-API-CONTRACT.md §12` 확장 + `useQuota.ts`/`QuotaPanel.tsx` 렌더. → **FROZEN 무관, 즉시 빌드 가능.**

**(B) 툴 메트릭 source 컬럼** — `ToolMetricEntry` 확장 필요:

```diff
 export interface ToolMetricEntry {
   toolName: string;
   status: "ok" | "error" | "timeout" | "denied" | "hitl-pending";
   durationMs: number;
   userId?: string;
   orgId?: string;
+  /** 툴 출처. 기존 행은 null → UI 는 '내장'으로 표시(하위호환). */
+  source?: "builtin" | "mcp" | "skill" | "openapi";
 }
```

**Migration `0039_tool_metrics_source.sql`**:

```sql
-- 0039 · tool_metrics.source (툴 출처 구분)
-- nullable-first: NULL = 기존 행(=내장 툴로 표시). 백필 불필요.
-- 롤백 경로: dev/staging 전용 — ALTER TABLE tool_metrics DROP COLUMN source. prod 는 forward-only.
ALTER TABLE tool_metrics ADD COLUMN source TEXT
  CHECK (source IS NULL OR source IN ('builtin','mcp','skill','openapi'));
```

**권고: APPROVE** — (A)는 사실상 잠금 없음, (B)는 nullable 컬럼 1개. 저위험.

---

## C18 — Redis dependency (기존 격리 태스크 P22-T2-03 해제용)

`.ralph/blocked_tasks` 의 `P22-T2-03`(cross-instance abort/resume/HITL)은 **미지정 dependency** 사유로 격리돼 있다. acceptance(두 인스턴스가 상태 공유)는 실제 pub/sub 없이는 충족 불가.

**Dependency 요청**: `ioredis`(성숙·클러스터 지원 → 1순위) vs `node-redis`(공식). 인프라에 Redis 자체는 이미 있다(`docker-compose.local.yml`).
**조건**: dev/테스트는 현행 in-memory seam 유지(Redis 미기동 시에도 단일 인스턴스 동작), Redis 는 배포 선택형.

**권고: APPROVE (dependency only)** — `ioredis` 승인 시 P22-T2-03 격리 해제 가능.

---

## 거부 권고 (WON'T-BUILD)

| 태스크                                                               | 사유                                                                                                                                                                                                                                                                                              |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P22-T1-14** 사용자 작성 Python Tools / Valves / Pipe-Filter-Action | 설계상 스코프 밖. 이 플랫폼의 확장성은 **MCP + Skills + 내장 툴**로 의도적으로 고정돼 있다(`rebuild_plan/20-MULTI-AGENT-TOOL.md`). 인앱 Python 플러그인 런타임은 임의 코드 실행 표면을 새로 여는 것이라 보안·운영 비용이 이득을 압도한다. 갭 카탈로그 자신도 `scope_class: out-of-scope` 로 판정. |
| **P22-T6-11** Arena A/B + ELO 리더보드                               | 실재 확인 결과 진짜 미구현이나 계획에 없고 out-of-scope. 메시지 피드백(👍/👎)은 이미 있어 품질 신호는 확보돼 있다. 단일 조직 사내 도구에서 ELO 리더보드의 실효가 낮다.                                                                                                                            |
| **P22-T6-20** 핸즈프리 음성/영상 통화 모드                           | 계획이 E-tier 후속 phase 로 명시 연기. STT(P22-T6-08)·TTS(P22-T6-09)가 이미 들어갔으므로 기본 음성 요구는 충족된 상태. 풀 통화 모드는 WebRTC 인프라(=C8 과 같은 급의 신규 전송 계층)를 요구한다.                                                                                                  |

거부 승인 시 이 3건은 `.ralph/blocked_tasks` 에 "WON'T-BUILD (승인됨)" 사유로 영구 격리한다.

---

## 승인 요청 요약 (체크리스트)

승인자는 아래에서 **허용할 항목만** 골라 `.ralph/CONTRACT_APPROVED` 에 적어주면 된다.

**FROZEN 파일 변경 (packages/interfaces)**

- [ ] C1 `HealthCheckResult.ts?` + `HealthHistoryRepo.recent(range?)`
- [ ] C2 `ErrorLogRepo`/`HealthHistoryRepo`/`MessageRepo`.`deleteOlderThan` + `Organization.retentionDays`
- [ ] C3 `ArtifactRepo.expiredOlderThan` + `ArtifactStore.cleanupExpired(input?)`
- [ ] C4 users repo `credentialsByEmail`
- [ ] C5 `Agent` + `AgentRepo` (+DataAccess)
- [ ] C6 `ProviderConnection` + repo (+`secretById`)
- [ ] C7 `Note` + `NoteRepo`
- [ ] C11 `User.language`
- [ ] C12 `UserSkillStore` (신규, SkillRegistry 불변)
- [ ] C17(B) `ToolMetricEntry.source?`

**Migration (전부 nullable-first + 롤백 주석 + journal 갱신)**

- [ ] `0032_org_retention_days` (C2)
- [ ] `0033_agents` (C5)
- [ ] `0034_provider_connections` (C6)
- [ ] `0035_notes` (C7)
- [ ] `0036_user_language` (C11)
- [ ] `0037_user_skills` (C12)
- [ ] `0038_openapi_tool_servers` (C13)
- [ ] `0039_tool_metrics_source` (C17B)

**Dependency**

- [ ] `bcryptjs` (C4 비밀번호 해시)
- [ ] `next-intl` (C11 i18n)
- [ ] `ioredis` (C18, P22-T2-03 격리 해제)

**FROZEN 변경 없이 즉시 빌드 가능 — "진행" 표시만 필요**

- [ ] C9 대화 가져오기 (로컬 Zod 스키마)
- [ ] C10 입력 자동완성 (로컬 Zod 스키마)
- [ ] C13 OpenAPI 툴서버 (migration 0038 만)
- [ ] C17(A) 모델별 비용 분해

**연기 확인**

- [ ] C8 Channels / C14 LDAP / C15 SCIM / C16 OIDC → 별도 phase

**거부 확인**

- [ ] P22-T1-14 / P22-T6-11 / P22-T6-20 → WON'T-BUILD 영구 격리

**정책 질문 (답변 필요)**

- [ ] 계약 Zod 스키마 위치: `apps/server/src/lib/*-schema.ts` 유지(권고) / `packages/shared/src/schemas/` 신설
- [ ] C6 provider 키 암호화 KEK: 신규 env `PROVIDER_KEY_ENCRYPTION_KEY`(권고) / AWS KMS(배포 human gate)
