# 14 · Interfaces — packages/interfaces 의 12개 contract

> 1~~8 = 핵심 contract (별도 .ts 파일). 9~~11 = `ToolContext` 안의 보조 contract (`apps/server/src/lib/` 또는 `tools/` 안에서 구현). 12 = EmailSender.

## Source of Truth 분리 — 본 문서 vs 16-API-CONTRACT

본 문서는 **packages/interfaces 의 단일 출처** = DB Record 타입 (Drizzle row 매핑) + Domain Repo 인터페이스 + 도메인 보조 인터페이스 (Logger/HitlBridge/BudgetClaim/EmailSender 등).
16-API-CONTRACT 는 **HTTP API 의 단일 출처** = Zod schema (request/response DTO).

같은 entity (예: `ProjectDocument`) 가 두 곳에 등장하면:

- **DB Record** (`ProjectDocumentRecord` in 14) = DB 컬럼 1:1 매핑 (Date 객체, `failure_reason: string | null` 등). server-only 필드 (`s3Key`, `inlineContent`, `tokenHash` 등) 포함.
- **API DTO** (`ProjectDocument` Zod in 16) = HTTP wire format (ISO 문자열 timestamp, `failureReason: string | null`). server-only 필드 **제외** — leak 방지.

**mapper 파일 naming convention (단일 출처)**:

- 위치: `apps/server/src/mappers/<entity>-mapper.ts` (route 별이 아닌 entity 별 — 같은 mapper 가 여러 route 에서 import).
- 함수: `<entity>RecordToDto(rec: <Entity>Record): z.infer<typeof <Entity>>` (정방향) + 필요 시 `<entity>DtoToInsert(dto): Partial<<Entity>Record>` (역방향, e.g. POST body → DB insert).
- 예:
  ```
  apps/server/src/mappers/
  ├── project-document-mapper.ts   # projectDocumentRecordToDto, projectDocumentDtoToInsert
  ├── artifact-mapper.ts           # artifactRecordToDto (s3Key/inlineContent 제외), artifactRecordToShareDto
  ├── upload-mapper.ts             # uploadRecordToDto (s3Key 제외)
  ├── session-mapper.ts            # sessionRecordToDto
  ├── message-mapper.ts            # messageRecordToDto
  ├── user-mapper.ts               # userRecordToDto (passwordHash/lastLoginIp 등 제외)
  └── share-mapper.ts              # artifactShareRecordToDto, shareMetadataDto (token 평문 노출 OK, 외부 노출 endpoint 전용)
  ```
- **lint-plan § 23**: 위 mapper 파일 manifest 와 실 source-of-truth 의 entity 표 (14 § DataAccess) 와 정합 검사.

server 의 mapping 함수 (`apps/server/src/mappers/*-mapper.ts`) 가 Record → DTO 변환 담당. drift 가능 영역이므로 lint § 5 가 핵심 컬럼 양쪽 존재를 자동 검사.

## 본 문서의 boundary (반복 질문 차단)

본 문서는 **interface spec 의 단일 출처** (타입 시그니처 + import 그래프 + 파일 분할). **완전한 컴파일-ready TypeScript 본문은 Phase 0.5 의 Contract Bootstrap PR 이 생성** (PR author = integration owner (RC) 1 명, merge approval = Tier B 7-owner — [08 § Phase 0.5](08-SPRINT-PLAN.md), [07 § Phase 0.5](07-AGENT-TEAMS.md)).

흔한 오해: "본 문서의 코드 블록을 그대로 파일로 만들면 컴파일 안 됨 — spec 이 부실하다" — **이는 plan 의 의도된 boundary**. 본 문서가 spec 으로서의 단일 출처 역할만 하고, 실 .ts 파일 생성은 Phase 0.5 owner 가 책임. 본 문서의 코드 블록은 **시그니처와 import 규칙** 을 보여줌 (사람이 읽을 수 있도록), 실제 컴파일 가능 본문은 Phase 0.5 가 § 파일 분할 + import 그래프 + AgentTool facade 예외 규칙을 그대로 따라 생성.

**검증 경로**: Phase 0.5 PR 의 acceptance 가 `pnpm --filter @{{PROJECT_SLUG}}/interfaces typecheck` 0 exit 통과 — 본 문서의 spec 이 실 .ts 로 변환되어 compile 되는 시점.

## 파일 분할 (단일 출처 — `packages/interfaces/src/`)

각 인터페이스는 정확히 1 파일. 공유 타입은 `types.ts` + `errors.ts` 에서 re-export. `index.ts` barrel 이 모든 파일 모음.

```
packages/interfaces/src/
├── index.ts                 # barrel: re-export all
├── types.ts                 # § 0 — 모든 foundational + shared 타입 (아래 표 참조). 모든 다른 .ts 가 import 가능.
├── errors.ts                # ErrorCategory, AppError 베이스 (Logger + types.ts 가 import)
├── AgentTool.ts             # § 1 — ToolContext (facade) 만. AgentToolSpec/Invocation/Result/AgentTool 인터페이스는 types.ts 에 위치.
├── SandboxTransport.ts      # § 2
├── DataAccess.ts            # § 3 — DataAccess facade interface + entity 1-바운드 Repo + cross-cutting Repo (단, Repo<T,F> generic 자체는 types.ts)
├── ArtifactStore.ts         # § 4
├── EmbeddingProvider.ts     # § 5
├── LLMProvider.ts           # § 6
├── SkillRegistry.ts         # § 7
├── McpClientPool.ts         # § 8
├── HitlBridge.ts            # § 9 + HitlDecision
├── BudgetClaim.ts           # § 10
├── Logger.ts                # § 11 (errors.ts 에서 ErrorCategory import)
└── EmailSender.ts           # § 12
```

> **`types.ts` 의 내용 (반복 질문 차단)** — 본 파일은 **모든 다른 .ts 가 import 하는 단일 출처**. 다음 카테고리 모두 포함:
>
> 1. **Foundational primitives** — `JsonSchema`, `JsonSchemaType`
> 2. **Generic containers** — `Repo<T,F>`, `Pagination`, `Page<T>` (DataAccess 가 사용하지만 정의는 본 파일)
> 3. **Domain enums** — `PermissionTier`, `ToolPolicy`, `ActiveRunStatus`, `Visibility`, `ProjectRole`
> 4. **Domain entities (DB row 매핑)** — `Organization`, `User`, `OrgUnit`, `Session`, `Message`, `Project`, `ProjectMember`, `DocumentChunk`, `UserMemory`
> 5. **Record 타입 (server-only 필드 포함)** — `ProjectDocumentRecord`, `ArtifactRecord`, `ArtifactShareRecord`, `UploadRecord`, `McpServerRecord`, `SkillAssetRecord`, `MagicLinkTokenRecord`, `RefreshTokenFamilyRecord`, `UserQuotaInfo`, `UsageLogEntry`, `ErrorLogEntry`, `ToolMetricEntry`, `HealthCheckResult`, `AlertEvent`, `EphemeralChunk`
> 6. **Filter 타입** — `OrgFilter`, `UserFilter`, `OrgUnitFilter`, `ChunkFilter` 등
> 7. **Tool spec 타입** — `AgentToolSpec`, `AgentToolInvocation`, `AgentToolResult`, `AgentTool` (interface). `ToolContext` 는 AgentTool.ts 의 facade.
> 8. **Streaming union** — `ChatEvent`, `ChatSsePayload<E>`, `TokenUsage`, `LLMMessage`, `ContentPart`, `NotificationEvent`, `HybridSearchResult`, `SearchHit`
>
> 본 보고서의 § 0 본문은 위 8 카테고리를 **장 단위로 표현** (사람이 읽을 수 있게 그룹화). 실 `types.ts` 파일은 이 § 0 의 모든 export 를 한 파일에 담음.

> **DataAccess.ts 의 내용 (반복 질문 차단)**: `DataAccess` interface (facade) + entity-bound Repo (SessionRepo, MessageRepo, ProjectRepo 등) + cross-cutting Repo (DocumentChunkRepo, EphemeralChunkRepo 등) + auth Repo (MagicLinkTokenRepo, RefreshTokenFamilyRepo). 이 Repo 들은 `types.ts` 의 `Repo<T,F>` 를 extend.

import 규칙 (단일 출처):

1. **`types.ts` + `errors.ts` 는 root**. 모든 다른 .ts 가 import 가능 (순환 없음).
2. **모든 interface 파일 (`AgentTool.ts` ~ `EmailSender.ts`, `DataAccess.ts`) 은 `types.ts` 와 `errors.ts` 만 직접 import**. 서로 직접 import 금지.
3. **`AgentTool.ts` 의 명시 예외**: `ToolContext` 가 facade 라 `Logger.ts`, `HitlBridge.ts`, `BudgetClaim.ts` 의 타입 (Logger, HitlBridge, BudgetClaim) 을 직접 import. 본 예외는 § 1 AgentTool 본문 import 그래프 주석에 명시.
4. **`Logger.ts` 의 명시 예외**: `errors.ts` 의 `ErrorCategory` 를 직접 import (Logger 시그니처가 category 받음).
5. **외부 (apps/server, apps/web)**: 반드시 barrel — `import { X } from "@{{PROJECT_SLUG}}/interfaces"`. 개별 파일 직접 import 금지.

> **검증**: 본 import 그래프가 무결한지는 `pnpm --filter @{{PROJECT_SLUG}}/interfaces typecheck` 가 0 exit 통과로 자동 검증. forward reference / 순환 import 가 있으면 컴파일 실패.

`tsconfig.json` 의 `"composite": true` + `"declaration": true` → `pnpm --filter @{{PROJECT_SLUG}}/interfaces typecheck` 가 0 exit 통과해야 Phase 0 acceptance.

## 0. Foundational types (`packages/interfaces/src/types.ts`)

여러 인터페이스가 공유하는 기본 타입. 본 문서가 단일 출처.

```ts
// ─── JSON Schema (도구 inputSchema 등) ───
// 외부 라이브러리 없이 정의 — Draft-2020-12 의 subset.
export type JsonSchemaType = "string" | "number" | "integer" | "boolean" | "object" | "array" | "null";

export interface JsonSchema {
  type?: JsonSchemaType | JsonSchemaType[];
  description?: string;
  enum?: unknown[];
  const?: unknown;
  // object
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  // array
  items?: JsonSchema | JsonSchema[];
  minItems?: number;
  maxItems?: number;
  // string
  format?: string;
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  // number
  minimum?: number;
  maximum?: number;
  // composition
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  allOf?: JsonSchema[];
}

// ─── Domain entities (DataAccess 의 Repo<T> 의 T) ───
// 06-DATA-MODEL.md 의 테이블과 1:1, snake_case → camelCase 변환.

export interface Organization {
  id: string;
  name: string;
  domain: string;
  plan: string;
  allowedModels: string[];
  allowedTools: string[];
  defaultTokenBudgetMicros: number | null;
  /** 메시지 보존일수(12-OPS-SECURITY.md 부록 H 3번). null = 무기한 보존. (P22-C-01 / C2) */
  retentionDays: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrgUnit {
  id: string;
  orgId: string;
  parentId: string | null;
  name: string;
  pathKey: string;
  createdAt: Date;
}

export interface User {
  id: string;
  orgId: string;
  email: string;
  name: string | null;
  role: "member" | "admin" | "owner";
  customInstructions: string | null;
  status: "active" | "suspended" | "deleted";
  lastLoginAt: Date | null;
  createdAt: Date;
}

export interface Session {
  id: string;
  userId: string;
  projectId: string | null;
  title: string | null;
  archivedAt: Date | null;
  lastMessageAt: Date | null;
  createdAt: Date;
}

export interface Message {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "system" | "tool";
  content: unknown;
  toolCallIds: string[];
  parentMessageId: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  costMicros: number | null;
  createdAt: Date;
}

export interface Project {
  id: string;
  orgId: string;
  ownerId: string;
  orgUnitId: string | null;
  name: string;
  description: string | null;
  visibility: "private" | "team" | "org";
  archivedAt: Date | null;
  createdAt: Date;
}

export interface ProjectMember {
  projectId: string;
  userId: string;
  role: "owner" | "editor" | "viewer";
  createdAt: Date;
}

export interface DocumentChunk {
  id: string;
  documentId: string;
  chunkIndex: number;
  content: string;
  tokenCount: number | null;
  embedding: number[] | null;          // 1024 dim
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface UserMemory {
  id: string;
  userId: string;
  category: "user" | "feedback" | "project" | "reference";
  content: string;
  source: "auto-extract" | "manual";
  sessionId: string | null;
  pinned: boolean;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Filter / Repo 의 type param ───

export interface OrgFilter   { domainEq?: string }
export interface UserFilter  { orgId?: string; emailEq?: string; statusIn?: User["status"][] }

// P22-T1-13(계약배치 C4) — 비밀번호 로그인 전용. 해시를 User DTO 에 싣지 않기 위한 분리 경로.
// 반환값은 절대 응답 직렬화에 넣지 않는다. passwordHash=null 이면 magic-link 전용 계정.
export interface UserCredentials { userId: string; orgId: string; passwordHash: string | null }
export interface UserRepo extends Repo<User, UserFilter> {
  credentialsByEmail(email: string): Promise<UserCredentials | null>;
}
export interface OrgUnitFilter { orgId?: string; parentId?: string | null; pathPrefix?: string }
export interface ChunkFilter { documentId?: string; projectId?: string }

// (다른 filter 도 필요 시 본 파일에 동일 패턴으로 추가)

// ─── 특수 Repo (Repo<T,F> 가 부족한 경우) ───

export type ActiveRunStatus = "pending" | "running" | "cancelled" | "completed";

export interface SessionRepo extends Repo<Session, { userId?: string; projectId?: string | null }> {
  lock(sessionId: string, ttlMs: number, signal: AbortSignal): Promise<{ unlock(): Promise<void> }>;
  // status: DB CHECK (sessions_active_runs.status) 와 동일 4-state.
  //   pending  → 큐에 job 추가됨, 아직 실행 안 됨
  //   running  → 실행 중
  //   cancelled → user Stop / abort signal 로 중단됨 (DELETE /sessions/:id/active-run)
  //   completed → 정상 종료
  setActiveRun(sessionId: string, jobId: string, status: ActiveRunStatus): Promise<void>;
  clearActiveRun(sessionId: string): Promise<void>;
}

export interface MessageRepo extends Repo<Message, { sessionId: string; role?: Message["role"] }> {
  appendStream(sessionId: string, role: Message["role"], chunks: AsyncIterable<unknown>): Promise<Message>;
  /** org 보존정책 cron 전용 벌크 삭제(부록 H 3번). orgId 생략 시 전 org. 배치 상한 존재. (P22-C-01 / C2) */
  deleteOlderThan(cutoff: Date, orgId?: string): Promise<number>;
}

export interface ProjectRepo extends Repo<Project, { orgId?: string; visibility?: Project["visibility"] }> {
  byOwner(userId: string): Promise<Project[]>;
}

// ProjectMember 는 composite PK (projectId, userId). 일반 Repo<T> 의 byId/delete/update(id) 사용 불가.
// 본 인터페이스가 composite-key 메서드를 명시. types.ts § Repo<T> 의 byId/update(id)/delete(id) 는 본 entity 에서 throw NOT_SUPPORTED — 컴파일이 강제하지 못하므로 contract test 가 검증.
export interface ProjectMemberRepo {
  insert(data: ProjectMember): Promise<ProjectMember>;
  bulkInsert(rows: ProjectMember[]): Promise<ProjectMember[]>;
  upsert(input: ProjectMember): Promise<ProjectMember>;
  byKey(projectId: string, userId: string): Promise<ProjectMember | null>;
  updateRole(projectId: string, userId: string, role: ProjectMember["role"]): Promise<ProjectMember>;
  deleteByKey(projectId: string, userId: string): Promise<void>;
  list(filter?: { projectId?: string; userId?: string }, pagination?: Pagination): Promise<Page<ProjectMember>>;
}

export interface ProjectDocumentRecord {
  id: string;
  projectId: string;
  filename: string;
  contentHash: string;              // sha256 of original bytes — dedup key
  mimeType: string;
  sizeBytes: number;
  indexStatus: "pending" | "parsing" | "chunking" | "embedding" | "indexed" | "failed";
  chunkCount: number;
  s3Key: string;                    // raw upload location
  indexedAt: Date | null;
  failureReason: string | null;
  createdBy: string;                // user id
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectDocumentRepo extends Repo<ProjectDocumentRecord, { projectId?: string; indexStatus?: ProjectDocumentRecord["indexStatus"] }> {
  byContentHash(projectId: string, hash: string): Promise<ProjectDocumentRecord | null>;
  updateIndexStatus(id: string, status: ProjectDocumentRecord["indexStatus"], chunkCount?: number): Promise<void>;
}

export interface ArtifactRepo extends Repo<ArtifactRecord, { sessionId?: string; createdBy?: string }> {
  /** 보존정책 cron 전용. createdAt < cutoff 인 artifact 를 시스템 스코프로 열거한다
   *  (list() 는 RLS/사용자 스코프라 org 전체를 볼 수 없다). UploadRepo.expiredOlderThan 동일 계열. (P22-C-01 / C3) */
  expiredOlderThan(cutoff: Date): Promise<ArtifactRecord[]>;
}
export interface ArtifactRevisionRepo {
  insert(input: { artifactId: string; version: number; s3Key: string; diffSummary?: string }): Promise<void>;
  list(artifactId: string): Promise<Array<{ version: number; s3Key: string; diffSummary: string | null; createdAt: Date }>>;
  byVersion(artifactId: string, version: number): Promise<{ s3Key: string } | null>;
}

export interface ArtifactRecord {
  id: string;
  sessionId: string | null;
  createdBy: string;
  type: "pptx"|"pdf"|"docx"|"xlsx"|"markdown"|"html"|"image"|"other";
  filename: string;
  mimeType: string | null;
  sizeBytes: number;
  storageKind: "inline"|"s3";          // 06-DATA-MODEL § artifacts CHECK + 16-API-CONTRACT § storage_kind 단일 출처
  s3Key: string | null;
  inlineContent: Buffer | null;
  sharedAt: Date | null;
  createdAt: Date;
}

export interface ArtifactShareRecord {
  id: string;
  artifactId: string;
  token: string;
  issuedBy: string;
  expiresAt: Date;
  revokedAt: Date | null;
  viewCount: number;
  createdAt: Date;
}

export interface McpServerRecord {
  id: string;
  orgId: string;
  projectId: string | null;
  userId: string | null;
  name: string;
  url: string;
  transport: "streamable_http"|"sse";
  authHeaderName: string | null;
  authSecretArn: string | null;
  supportedTools: Array<{ name: string; description: string; inputSchema: JsonSchema }>;
  lastDiscoveredAt: Date | null;
  status: "active"|"degraded"|"suspended";
}

// Agent — 커스텀 워크스페이스 에이전트(P22-T6-10, 계약 승인 C5). 도구 호출 계약 AgentTool* 과 별개.
export interface Agent {
  id: string;
  orgId: string;
  name: string;
  description: string | null;
  baseModel: string;
  systemPrompt: string | null;
  toolIds: string[];
  skillIds: string[];
  projectIds: string[];
  visibility: "private"|"org";
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface SkillAssetRecord {
  skillId: string;
  filename: string;
  contentType: string | null;
  sizeBytes: number;
  s3Key: string;
  createdAt: Date;
}

export interface UserQuotaInfo {
  userId: string;
  budgetMicros: number;
  usedMicros: number;
  periodStart: Date;
  periodEnd: Date;
}

export interface UsageLogEntry {
  userId: string;
  orgId: string;
  sessionId: string | null;
  provider: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costMicros: number;
  createdAt: Date;
}

export interface ErrorLogEntry {
  level: "debug"|"info"|"warn"|"error"|"fatal";
  category: ErrorCategory;
  message: string;
  context?: Record<string, unknown>;
  requestId?: string;
  userId?: string;
  orgId?: string;
}

export interface ToolMetricEntry {
  toolName: string;
  status: "ok"|"error"|"timeout"|"denied"|"hitl-pending";
  durationMs: number;
  userId?: string;
  orgId?: string;
  source?: "builtin"|"mcp"|"skill"|"openapi";   // 기존 행은 null → UI 는 '내장' 표시(P22-T6-19 / C17B).
}

export interface HealthCheckResult {
  target: string;
  status: "healthy"|"degraded"|"down";
  latencyMs: number | null;
  ts?: Date;                       // 조회 응답에는 항상 존재(P22-C-01 / C1). append 호환 위해 optional.
  context?: Record<string, unknown>;
}

export interface AlertEvent {
  id: string;
  ruleId: string;
  severity: "info"|"warn"|"critical";
  message: string;
  payload: Record<string, unknown>;
  createdAt: Date;
  resolvedAt: Date | null;
}
export interface ArtifactShareRepo extends Repo<ArtifactShareRecord, { artifactId?: string; tokenEq?: string }> {
  byToken(token: string): Promise<ArtifactShareRecord | null>;
  incrementViewCount(token: string): Promise<void>;
  revoke(id: string): Promise<void>;
}

// 06-DATA-MODEL § 0014_uploads.sql 의 uploads 테이블 + 16-API-CONTRACT § 6 Uploads 단일 출처
export interface UploadRecord {
  id: string;
  userId: string;
  sessionId: string | null;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  s3Key: string;
  sha256: string;                    // dedup key — UNIQUE (user_id, sha256)
  expiresAt: Date;                   // 30일 후 자동 정리
  createdAt: Date;
}
export interface UploadRepo extends Repo<UploadRecord, { userId?: string; sessionId?: string | null; expiresBeforeNow?: boolean }> {
  bySha256(userId: string, sha256: string): Promise<UploadRecord | null>;
  expiredOlderThan(cutoff: Date): Promise<UploadRecord[]>;        // data-retention cron job
}

export interface UserMemoryRepo extends Repo<UserMemory, { userId?: string; category?: UserMemory["category"]; pinned?: boolean }> {
  pin(id: string, pinned: boolean): Promise<void>;
}
export interface McpServerRepo extends Repo<McpServerRecord, { orgId?: string; projectId?: string | null; userId?: string | null }> {
  updateDiscovery(id: string, supportedTools: McpServerRecord["supportedTools"]): Promise<void>;
}
export type AgentRepo = Repo<Agent, { orgId?: string; createdBy?: string; visibility?: Agent["visibility"] }>;
// SkillAsset 는 composite PK (skillId, filename). byId/delete(id) 사용 불가.
export interface SkillAssetRepo {
  insert(data: SkillAssetRecord): Promise<SkillAssetRecord>;
  bulkInsert(rows: SkillAssetRecord[]): Promise<SkillAssetRecord[]>;
  byKey(skillId: string, filename: string): Promise<SkillAssetRecord | null>;
  bySkill(skillId: string): Promise<SkillAssetRecord[]>;
  deleteByKey(skillId: string, filename: string): Promise<void>;
  deleteBySkill(skillId: string): Promise<number>;   // 반환값 = 삭제 row 수
  list(filter?: { skillId?: string }, pagination?: Pagination): Promise<Page<SkillAssetRecord>>;
}

// UserQuotaInfo 는 PK = userId (1:1). Repo<T> 의 byId 가 user_id 와 일치하지만, 명시적으로 byUserId 제공.
export interface UserQuotaRepo {
  byUserId(userId: string): Promise<UserQuotaInfo | null>;
  upsert(info: UserQuotaInfo): Promise<UserQuotaInfo>;
  consume(userId: string, micros: number): Promise<{ remaining: number }>;
  refund(userId: string, micros: number): Promise<void>;
  list(filter?: { userId?: string }, pagination?: Pagination): Promise<Page<UserQuotaInfo>>;
}

export interface UsageLogRepo {
  append(entry: UsageLogEntry): Promise<void>;
  list(filter: { userId?: string; orgId?: string; fromDate?: Date; toDate?: Date }, p: Pagination): Promise<Page<UsageLogEntry>>;
  aggregate(filter: { userId?: string; orgId?: string; fromDate: Date; toDate: Date }): Promise<{ tokensIn: number; tokensOut: number; costMicros: number }>;
}

export interface ErrorLogRepo {
  append(entry: ErrorLogEntry): Promise<void>;
  list(filter: { category?: ErrorCategory; level?: ErrorLogEntry["level"]; from?: Date }, p: Pagination): Promise<Page<ErrorLogEntry>>;
  /** 보존정책 cron 전용(부록 H 4번). 삭제된 행 수 반환. (P22-C-01 / C2) */
  deleteOlderThan(cutoff: Date): Promise<number>;
}

export interface ToolMetricRepo {
  append(entry: ToolMetricEntry): Promise<void>;
  aggregate(toolName: string, from: Date, to: Date): Promise<{ count: number; errorCount: number; p50DurationMs: number }>;
}

export interface HealthHistoryRepo {
  append(entry: HealthCheckResult): Promise<void>;
  /** range 는 optional — 생략 시 기존 동작(최신 limit 개)과 동일. (P22-C-01 / C1) */
  recent(target: string, limit: number, range?: { from?: Date; to?: Date }): Promise<HealthCheckResult[]>;
  /** 보존정책 cron 전용(부록 H 5번). 삭제된 행 수 반환. (P22-C-01 / C2) */
  deleteOlderThan(cutoff: Date): Promise<number>;
}

export interface AlertEventRepo extends Repo<AlertEvent, { severity?: AlertEvent["severity"]; unresolved?: boolean }> {
  resolve(id: string): Promise<void>;
}

// ─── auth (06 § 0012/0013) — DDL 1:1 매핑. server-side 만 호출, client/web 접근 금지 ───
// magic_link_tokens: RLS 미적용 (signup 흐름엔 user 없음 → server SECURITY DEFINER trans 로 처리). app.user_id 미설정 상태 호출 허용.
// refresh_token_families: RLS 적용 (rtf_owner). insert/update 전에 SET LOCAL app.user_id 필수.
// 본 두 Record 의 컬럼은 06 § 0012/0013 DDL 과 정확히 1:1 (snake_case → camelCase). lint § 31 가 자동 검증.
export interface MagicLinkTokenRecord {
  tokenHash: string;                // PRIMARY KEY (DDL: token_hash). 평문은 메일로만 전달, DB 는 sha256
  email: string;
  userId: string | null;            // signup 단계에선 null (verify 시 user 생성 후 채워짐)
  orgId: string;                    // email 도메인 매칭으로 결정된 org
  intent: "signup" | "login";
  signupName: string | null;        // intent='signup' 일 때만 채워짐
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}

// Repo<T> 의 'id' 가 본 entity 에선 'tokenHash' 이라 byId(tokenHash) 로 호출. delete(tokenHash) 도 동일.
// Repo generic 의 string id 가 tokenHash 로 사용된다는 점 명시 (다른 entity 는 uuid).
export interface MagicLinkTokenRepo extends Repo<MagicLinkTokenRecord, { email?: string; intent?: MagicLinkTokenRecord["intent"]; unusedOnly?: boolean }> {
  byTokenHash(hash: string): Promise<MagicLinkTokenRecord | null>;   // = byId, 의미 명시용 alias
  markUsed(tokenHash: string, usedAt: Date): Promise<void>;
  expireOlderThan(cutoff: Date): Promise<number>;   // GC, 반환값 = 삭제 row 수
}

export interface RefreshTokenFamilyRecord {
  familyId: string;                 // PRIMARY KEY (DDL: family_id). Repo 의 byId/delete 가 사용.
  userId: string;
  currentGeneration: number;        // DDL: current_generation, rotate 마다 +1
  currentJti: string;               // DDL: current_jti, 활성 refresh token 의 jti claim
  createdAt: Date;
  lastUsedAt: Date;                 // DDL: last_used_at, rotate 마다 NOW()
  revokedAt: Date | null;           // 도난 감지 또는 logout 시
  revokeReason: "theft_suspected" | "logout" | "admin" | "expired" | null;   // DDL: revoke_reason CHECK
}

export interface RefreshTokenFamilyRepo extends Repo<RefreshTokenFamilyRecord, { userId?: string; activeOnly?: boolean }> {
  byCurrentJti(jti: string): Promise<RefreshTokenFamilyRecord | null>;
  // rotate: current_jti 교체 + current_generation++ + last_used_at = NOW(). atomic (single UPDATE).
  rotate(familyId: string, newJti: string): Promise<{ generation: number }>;
  revoke(familyId: string, reason: RefreshTokenFamilyRecord["revokeReason"]): Promise<void>;
  revokeAllForUser(userId: string, reason: RefreshTokenFamilyRecord["revokeReason"]): Promise<number>;
}

// ─── Generic container 타입 (Repo, Pagination, Page) ───
// 모든 Repo 인터페이스가 본 generic 을 extend. 본 § 0 (types.ts) 에 위치해 forward reference 회피.

export interface Repo<T, F = Record<string, unknown>> {
  insert(data: Partial<T>): Promise<T>;
  bulkInsert(rows: Partial<T>[]): Promise<T[]>;
  update(id: string, data: Partial<T>): Promise<T>;
  delete(id: string): Promise<void>;
  byId(id: string): Promise<T | null>;
  list(filter?: F, pagination?: Pagination): Promise<Page<T>>;
}

export interface Pagination { cursor?: string; limit: number /* max 100 */ }
export interface Page<T> { items: T[]; nextCursor?: string; totalApprox?: number }

// ─── Tool spec 타입 (AgentToolSpec/Invocation/Result/AgentTool) ───
// LLMProvider/SkillRegistry/McpClientPool 가 본 spec 을 참조 — types.ts 에 위치해 import 그래프 무결.
// AgentTool.ts 는 ToolContext (facade) 만 정의.

export type PermissionTier = "system" | "project" | "user" | "tool";
export type ToolPolicy = "allow" | "hitl" | "deny";

export interface AgentToolSpec {
  name: string;                    // 'bash' / 'knowledge_search' / 'mcp:{{ORG_NAME_LOWER}}-search'
  description: string;             // LLM 에게 보일 한국어 설명
  inputSchema: JsonSchema;
  outputSchema?: JsonSchema;
  permissionTier: PermissionTier;
  defaultPolicy: ToolPolicy;
  tags?: string[];
  costEstimate?: { ms: number; tokens?: number };
}

// AgentToolInvocation 은 ToolContext 를 참조 → AgentTool.ts 에 정의. types.ts 에 두지 않음 (forward reference 회피).
// types.ts 는 AgentToolSpec / AgentToolResult / AgentTool 만 보유. LLMProvider/SkillRegistry/McpClientPool 가
// AgentToolInvocation 가 필요하면 AgentTool.ts 를 import (§ 28 의 "facade 예외" 규칙).

export interface AgentToolResult {
  toolCallId: string;
  content:
    | { kind: "text"; text: string }
    | { kind: "json"; data: unknown }
    | { kind: "file"; artifactId: string }
    | { kind: "error"; error: {{PROJECT_NAME_PASCAL}}Error };
  metadata?: { durationMs: number; tokens?: number; provider?: string };
}

// AgentTool interface 는 spec 만 본다 (invoke 의 input 형은 AgentTool.ts 에서 import 함).
// invoke 시그니처도 AgentTool.ts 에서 final 형태로 정의 (AgentToolInvocation 사용).
export interface AgentToolBase {
  spec: AgentToolSpec;
}
```

> **import graph 결정 (단일 출처 — 라운드 27 fixed)**:
>
> - `types.ts` 가 정의: `AgentToolSpec`, `AgentToolResult`, `AgentToolBase` (spec-only 부분).
> - `AgentTool.ts` 가 정의: `AgentToolInvocation` (ToolContext 의존), `AgentTool extends AgentToolBase { invoke(input: AgentToolInvocation): ... }`, `ToolContext`.
> - 외부 의존 (LLMProvider/SkillRegistry/McpClientPool 등) 은 `AgentToolSpec` 만 필요 → `types.ts` import. `AgentToolInvocation` 까지 필요한 코드 (orchestrator 호출 layer) 는 `AgentTool.ts` 또는 barrel import.
> - 본 layout 으로 import 그래프 무순환 + Phase 0.5 가 compile-ready 상태로 작성 가능. 라운드 25 의 "Phase 0.5 owner 선택" 모호함 제거.

> ⚠️ 위 `unknown` 으로 둔 타입 (Artifact / ArtifactRevision / ArtifactShare / McpServerRecord / SkillAssetMetadata / UserQuotaInfo / UsageLogEntry / ErrorLogEntry / ToolMetricEntry / HealthCheckResult / AlertEvent) 는 [16-API-CONTRACT.md § 부록 A](16-API-CONTRACT.md) 의 Zod schema 로부터 `z.infer<typeof X>` 로 도출. typescript 컴파일 시점에 자동 정합.

> 본 문서는 6개 도메인 팀이 **병렬로 일하기 위한 동기화 포인트**. 이 인터페이스를 의존하는 모든 코드는 구현체에 무관하게 같은 시맨틱.
> 모든 인터페이스는 `packages/interfaces/src/` 에 위치.

## 공통 규약

### 에러 모델

```ts
// packages/interfaces/src/errors.ts
export class {{PROJECT_NAME_PASCAL}}Error extends Error {
  constructor(
    public code: string,           // 'AUTH_INVALID' / 'QUOTA_EXCEEDED' / ...
    public category: ErrorCategory,
    public retryable: boolean,
    message: string,
    public cause?: unknown,
    public context?: Record<string, unknown>,
  ) { super(message); }
}

export type ErrorCategory =
  | "auth" | "tool" | "db" | "mcp" | "sandbox"
  | "rate-limit" | "external-api" | "parser"
  | "orchestrator" | "http" | "system";

// SerializedError — wire format (SSE event, HTTP envelope, log JSON 모두 동일).
// Error class instance 는 SSE/HTTP JSON 으로 직접 직렬화 불가 (stack/cause 등 non-serializable) → 본 shape 로 변환 후 전송.
// mapper: server 의 `apps/server/src/lib/errors.ts # serializeError({{PROJECT_NAME_PASCAL}}Error → SerializedError)`.
// ChatEvent.error / HTTP error envelope / Logger 모두 본 타입 사용.
export interface SerializedError {
  code: string;                           // 'AUTH_INVALID' 등
  category: ErrorCategory;
  message: string;                        // 사용자/agent 가 읽을 수 있는 한국어
  retryable: boolean;
  requestId?: string;                     // 16-API envelope.meta.requestId 와 join
  details?: Record<string, unknown>;      // context 의 safe-to-expose subset (stack/cause 제외)
}
```

### Abort 의무 (L06)

모든 장시간 메서드는 `signal?: AbortSignal` 옵션을 받음. abort 시 `AbortError` throw 또는 stream end.

### Result 패턴

실패가 흔한 외부 호출에는 throw 대신 `Result<T, {{PROJECT_NAME_PASCAL}}Error>` 권장. RLS 위반 등 보안 위반은 항상 throw.

---

## 1. `AgentTool`

모든 도구(빌트인 + Skill + MCP) 의 공통 호출 인터페이스. orchestrator 가 한 가지 형태로 호출, 실제 backend (handlers/sandbox/MCP/skill engine) 는 자유.

```ts
// packages/interfaces/src/AgentTool.ts
// types.ts 에서 spec-only 타입 import. ToolContext 는 본 파일이 정의 (Logger/HitlBridge/BudgetClaim 의존).
// AgentToolInvocation 은 ToolContext 의존이라 본 파일에 정의 (types.ts forward reference 차단).
// AgentTool interface 의 invoke 시그니처 final 형태도 본 파일.
//
// AgentTool.ts 의 import 그래프 (§ 파일 분할 규칙 명시 예외):
//   AgentTool.ts → types.ts (AgentToolSpec, AgentToolResult, AgentToolBase, JsonSchema)
//                → HitlBridge.ts (HitlBridge 타입)
//                → BudgetClaim.ts (BudgetClaim 타입)
//                → Logger.ts (Logger 타입)
//                → errors.ts ({{PROJECT_NAME_PASCAL}}Error)
// 위 4 facade 파일은 AgentTool.ts 가 직접 import — § "interface 파일끼리 직접 import 금지" 의 명시 예외.
import type { AgentToolSpec, AgentToolResult, AgentToolBase } from "./types.js";
import type { Logger } from "./Logger.js";
import type { HitlBridge } from "./HitlBridge.js";
import type { BudgetClaim } from "./BudgetClaim.js";

export interface ToolContext {
  requestId: string;
  userId: string;
  orgId: string;
  sessionId: string;
  projectId?: string;
  signal: AbortSignal; // 필수 (L06)
  logger: Logger;
  hitl: HitlBridge;
  budget: BudgetClaim;
  emitProgress?(progress: ToolProgress): void; // 선택적 — orchestrator 주입 시 tool_progress ChatEvent 로 relay, 미주입 시 no-op. 장시간 툴(deep_research)이 실행 중 진행 방출.
}

// types.ts 의 AgentToolBase 를 extend 해 invoke 시그니처 추가 (입력형 ToolContext 의존).
export interface AgentToolInvocation {
  toolCallId: string;
  args: Record<string, unknown>;
  ctx: ToolContext;
}

export interface AgentTool extends AgentToolBase {
  invoke(input: AgentToolInvocation): Promise<AgentToolResult>;
}
```

### 시맨틱 명세

- `invoke()` 는 **idempotent 보장 없음**. 같은 toolCallId 두 번 호출 시 두 번 실행 → orchestrator 가 dedup.
- `signal.aborted === true` 검출 즉시 stop. HITL 대기 중에도 abort race.
- 권한 위반 (`policy=deny` 인데 호출됨) → `{{PROJECT_NAME_PASCAL}}Error("TOOL_FORBIDDEN", "auth", false)`.

## 2. `SandboxTransport`

E2B (또는 mock) 와의 통신을 추상화. orchestrator 직접 의존 안 함, bash 같은 handler 가 의존 (L11).

```ts
// packages/interfaces/src/SandboxTransport.ts
export interface SandboxHandle {
  id: string;
  startedAt: Date;
  templateId: string;
}

export type Chunk =
  | { type: "stdout"; data: string }
  | { type: "stderr"; data: string }
  | { type: "exit"; code: number; reason?: "ok" | "timeout" | "killed" };

export interface SandboxTransport {
  start(
    input: {
      sessionId: string;
      templateId: string; // '{{SANDBOX_TEMPLATE_ID}}' 등
      envVars?: Record<string, string>;
      timeoutMs?: number; // default 15 * 60_000
    },
    signal?: AbortSignal,
  ): Promise<SandboxHandle>;

  // 명령 실행 — stdout/stderr 를 chunk 로 stream
  runCommand(
    handle: SandboxHandle,
    cmd: string,
    opts: {
      cwd?: string;
      envVars?: Record<string, string>;
      timeoutMs?: number;
    },
    signal: AbortSignal,
  ): AsyncIterable<Chunk>;

  writeFile(
    handle: SandboxHandle,
    path: string,
    content: Buffer | string,
  ): Promise<void>;
  readFile(handle: SandboxHandle, path: string): Promise<Buffer>;
  listDir(
    handle: SandboxHandle,
    path: string,
  ): Promise<{ name: string; isDir: boolean; size: number }[]>;
  uploadToS3(
    handle: SandboxHandle,
    srcPath: string,
    s3Key: string,
  ): Promise<void>;

  stop(
    handle: SandboxHandle,
    reason?: "idle" | "manual" | "error",
  ): Promise<void>;

  warmUp?(templateId: string, count: number): Promise<void>;
}
```

### 시맨틱

- `runCommand()` 는 streaming. `Chunk` 가 `exit` 이면 stream end.
- abort 시 transport 는 컨테이너 즉시 kill, 다음 chunk 가 `exit reason=killed`.
- `start()` 가 warm pool hit 이면 즉시, miss 면 cold start (수초~수십초).
- 동일 sessionId 의 재호출은 같은 handle 반환 (session-sandbox 매핑).

## 3. `DataAccess`

DB 호출의 단일 진입점. production 은 Drizzle, 테스트는 InMemory.

```ts
// packages/interfaces/src/DataAccess.ts
export interface DataAccess {
  organizations: Repo<Organization, OrgFilter>;
  users: UserRepo; // P22-T1-13(C4): Repo<User,UserFilter> + credentialsByEmail
  orgUnits: Repo<OrgUnit, OrgUnitFilter>;
  sessions: SessionRepo;
  messages: MessageRepo;
  projects: ProjectRepo;
  projectMembers: ProjectMemberRepo;
  projectDocuments: ProjectDocumentRepo;
  documentChunks: DocumentChunkRepo;
  ephemeralChunks: EphemeralChunkRepo;
  artifacts: ArtifactRepo;
  artifactRevisions: ArtifactRevisionRepo;
  artifactShares: ArtifactShareRepo;
  uploads: UploadRepo;
  userMemories: UserMemoryRepo;
  mcpServers: McpServerRepo;
  agents: AgentRepo;
  skillAssets: SkillAssetRepo;
  userQuotas: UserQuotaRepo;
  usageLogs: UsageLogRepo;
  errorLogs: ErrorLogRepo;
  toolMetrics: ToolMetricRepo;
  healthHistory: HealthHistoryRepo;
  alertEvents: AlertEventRepo;
  // ─── auth (06 § 0012/0013) — server-only, SECURITY DEFINER 또는 사전 SET LOCAL 후 호출 ───
  magicLinkTokens: MagicLinkTokenRepo;
  refreshTokenFamilies: RefreshTokenFamilyRepo;

  withTx<T>(fn: (tx: DataAccess) => Promise<T>): Promise<T>;
  withRlsContext<T>(
    ctx: { userId: string; orgId: string },
    fn: () => Promise<T>,
  ): Promise<T>;
}

// Repo<T,F> / Pagination / Page<T> generic 정의는 § 0 types.ts 단일 출처. 본 § 3 의 Repo 들은 모두 그 generic 을 extend.

export interface DocumentChunkRepo extends Repo<DocumentChunk, ChunkFilter> {
  hybridSearch(
    input: {
      projectId: string;
      queryEmbedding: number[];
      queryText: string;
      topK: number; // default 10
      rrfK: number; // default 60
    },
    signal?: AbortSignal,
  ): Promise<HybridSearchResult[]>;
}

// 06-DATA-MODEL § 0014 의 ephemeral_chunks + 16-API-CONTRACT § POST /sessions/:id/messages 의 첨부 RAG 단일 출처.
// 세션 scope, project_documents 와 분리. session cascade delete 로 자동 정리.
export interface EphemeralChunk {
  id: string;
  sessionId: string;
  uploadId: string;
  chunkIndex: number;
  pageNumber: number | null; // 06-DATA-MODEL § 0014 page_number — PDF/PPT citation. null = N/A
  content: string;
  embedding: number[]; // 1024-dim (voyage-multilingual-2)
  metadata: Record<string, unknown>; // { heading?, section?, charStart?, charEnd?, ... } — citation/스니펫
  createdAt: Date;
}

export interface EphemeralChunkRepo extends Repo<
  EphemeralChunk,
  { sessionId?: string; uploadId?: string }
> {
  // session+project 동시 검색: server 의 knowledge_search 도구가 호출.
  // session 의 첨부 chunk + (sessionId 가 속한 project 의 documents) 양쪽을 합쳐 RRF 후 topK 반환.
  hybridSearchUnified(
    input: {
      sessionId: string;
      projectId: string | null; // session.project_id (null 이면 project chunk 없이 session 만 검색)
      queryEmbedding: number[];
      queryText: string;
      topK: number;
      rrfK: number;
    },
    signal?: AbortSignal,
  ): Promise<SearchHit[]>;

  bulkInsert(input: Omit<EphemeralChunk, "id" | "createdAt">[]): Promise<void>;
}

// project-scope (DocumentChunkRepo) 의 단일 source 결과 형태.
export interface HybridSearchResult {
  chunk: DocumentChunk;
  vectorScore: number;
  bm25Score: number;
  rrfScore: number;
  rank: number;
}

// session+project 통합 검색 결과 — discriminated union (source 별로 chunk 타입 분기).
// 16-API-CONTRACT § /sessions/:id/messages 의 citation event 가 본 union 의 source 와 chunk 정보 사용.
export type SearchHit =
  | {
      source: "project";
      chunk: DocumentChunk;
      vectorScore: number;
      bm25Score: number;
      rrfScore: number;
      rank: number;
    }
  | {
      source: "ephemeral";
      chunk: EphemeralChunk;
      vectorScore: number;
      bm25Score: number;
      rrfScore: number;
      rank: number;
    };
```

### 시맨틱

- 모든 메서드는 RLS context 가 SET 된 상태에서 호출돼야 함. `withRlsContext` 미사용 시 throw (`RLS_CONTEXT_MISSING`).
- `withTx` 안에서 호출되는 모든 repo 메서드는 같은 트랜잭션. nested tx 는 savepoint 자동.
- InMemory 구현체는 production 과 **같은 contract test** 통과 — `__tests__/data-access.contract.test.ts`.

### `withRlsContext` 구현 정책 (반복 질문 차단 — SSE 장시간 요청과 RLS SET LOCAL 충돌)

매 라운드 검토에서 "SSE 요청 전체 (수십 초) 를 DB transaction 으로 묶으면 connection 점유·deadlock 위험" 가 반복 지적되는데, **본 plan 의 `withRlsContext` 는 transaction-wide 가 아니라 operation-wide**:

- `withRlsContext(ctx, fn)` 가 `fn()` 안의 각 DataAccess operation 별로 **짧은 transaction** 을 BEGIN/SET LOCAL/SQL/COMMIT.
- SSE handler 본문이 수십 초 걸려도 각 DB op 는 ms 단위 — connection pool 차단 X.
- 명시적으로 묶고 싶을 때는 `withTx(tx => withRlsContext(ctx, () => tx.foo() + tx.bar()))` — 사용자가 자기 책임으로 큰 transaction 선언.
- `withRlsContext` default 흐름 (각 op 짧은 tx) 가 v1.0 의 안전한 boundary. orchestrator/SSE handler 가 본 default 를 그대로 사용.
- 구현 위치: `apps/server/src/db/data-access.ts` — Drizzle pool 의 `connect()` 후 `BEGIN; SET LOCAL app.user_id; SET LOCAL app.org_id; <sql>; COMMIT` per op.

## 4. `ArtifactStore`

artifact 본문 저장/조회. 작은 건 DB, 큰 건 S3.

```ts
export interface ArtifactStore {
  put(input: {
    artifactId: string;
    content: Buffer | NodeJS.ReadableStream;
    sizeBytes: number;
    mimeType: string;
  }): Promise<{ storageKind: "inline" | "s3"; locator: string }>; // locator: s3_key (s3) 또는 artifact id (inline)

  get(artifactId: string): Promise<NodeJS.ReadableStream>;

  // share 페이지에서 사용 — inline content (ADR-22)
  getInline(
    artifactId: string,
    maxBytes?: number,
  ): Promise<{
    content: Buffer;
    mimeType: string;
    truncated: boolean;
  }>;

  remove(artifactId: string): Promise<void>;
  /** 보존정책 cron 이 열거한 만료 artifact 의 **바이트**를 지운다. 어떤 artifact 가 만료인지는
   *  DataAccess 를 가진 호출자(lib/data-retention.ts)가 판단하고 id 목록만 넘긴다 —
   *  이 포트는 Repo 의존 없는 바이트 저장소로 남는다. 인자 없이 호출하면 대상이 없다는 뜻. (P22-C-01 / C3) */
  cleanupExpired(input?: {
    artifactIds: string[];
  }): Promise<{ deletedCount: number }>;
}
```

라우팅 규칙: `sizeBytes < 256_000` → DB (`artifacts.inline_content BYTEA`, [06-DATA-MODEL.md § 0006](06-DATA-MODEL.md)), 그 외 → S3 (server-side encrypted, `artifacts.s3_key TEXT`). `storage_kind` 컬럼이 어느 쪽인지 명시 + CHECK 제약으로 둘 중 하나만.

## 5. `EmbeddingProvider`

문서/쿼리 임베딩.

```ts
export interface EmbeddingProvider {
  name: string; // 'voyage-multilingual-2'
  dim: number; // 1024 (v1.0 결정)
  embed(
    input: string[],
    opts?: { type: "document" | "query"; signal?: AbortSignal },
  ): Promise<number[][]>;
}
```

> **결정 (보강)**: v1.0 은 `voyage-multilingual-2` 단일, `dim=1024`. 모델 변경 시 마이그레이션 필요 (재임베딩 cron). 04-TECH-STACK.md, 06-DATA-MODEL.md 가 본 결정을 참조.

## 6. `LLMProvider`

Anthropic / OpenAI / Gemini 의 공통 어댑터.

```ts
export interface LLMProvider {
  name: string; // 'anthropic'
  models: string[]; // ['claude-opus-4-7', 'claude-sonnet-4-6', ...]
  chat(input: ChatInput, signal: AbortSignal): AsyncIterable<ChatEvent>;
}

export interface ChatInput {
  model: string;
  systemBlocks: PromptBlock[]; // PermissionTier=system, project
  messages: LLMMessage[]; // LLM turn 단위 (도메인 Message 아님)
  tools?: AgentToolSpec[];
  maxTokens: number;
  temperature?: number;
  topP?: number; // nucleus sampling — provider 지원 시 forward (미설정 시 provider 기본)
  cacheControl?: "ephemeral"; // Anthropic prompt cache
  toolChoice?: "auto" | "any" | { type: "tool"; name: string };
  parallelToolCalls?: boolean; // default false (v1.0)
}

// 16-API-CONTRACT § /sessions/:id/messages (SSE) 와 1:1 일치 — server 가 ChatEvent → SSE event 로 변환.
// HITL 흐름: tool_use 직전에 hitl_request → client POST /messages/hitl → hitl_resolved → (approved 면) tool_result, (denied/timeout 면) error + stop reason='end_turn'.
// stop reason='tool_use' 흐름: stop → server tool 실행 → message_replace (same messageId, 누적 content) → tool_result → text_delta → stop reason='end_turn'.
// 장시간 멀티스텝 툴(deep_research 등 orchestrator-worker 파사드)의 실행 중 진행 스냅샷.
//   snapshot 시맨틱 — 매 이벤트가 현재 전체 상태를 담아 소비측은 최신 것으로 교체(delta 불필요).
export interface ToolProgressTask {
  id: string;
  title: string;
  status: "queued" | "running" | "done" | "error";
  sourceCount?: number;
}
export interface ToolProgress {
  stage: "planning" | "researching" | "synthesizing" | "done";
  label?: string;
  tasks?: ToolProgressTask[];
}

export type ChatEvent =
  | {
      type: "message_start";
      messageId: string;
      meta: { provider: string; model: string };
    }
  | { type: "message_replace"; messageId: string; contentSoFar: string } // stop reason='tool_use' 후 re-stream 시작 신호 — 16 § stop 의미 표
  | { type: "text_delta"; text: string }
  | { type: "tool_use"; toolCallId: string; name: string; args: unknown }
  | { type: "tool_result"; toolCallId: string; content: string | unknown }
  | ({ type: "tool_progress"; toolCallId: string } & ToolProgress) // 실행 중 진행(비종단, 여러 번). ToolContext.emitProgress → orchestrator 가 부모 toolCallId 로 방출. UI 는 해당 tool part 라이브 표시(스윔레인).
  // HITL — 도구 호출 정책 'hitl' 또는 모델이 위험 판단 시 emit. client 는 POST /sessions/:id/messages/hitl 로 응답.
  | {
      type: "hitl_request";
      toolCallId: string;
      toolName: string;
      args: Record<string, unknown>;
      rationale: string;
      expiresAt: string;
    }
  | {
      type: "hitl_resolved";
      toolCallId: string;
      decision: "approved" | "denied";
      modifiedArgs?: Record<string, unknown>;
      reason?: string;
    }
  | { type: "hitl_timeout"; toolCallId: string }
  | {
      type: "citation";
      index: number;
      source: "project" | "ephemeral";
      documentId?: string;
      uploadId?: string;
      filename: string;
      title?: string;
      page?: number;
      sourceUri?: string;
      snippet: string;
    } // text_delta 안의 [N] 마커와 매칭. UI 의 footer Reference 섹션 렌더 (filename + page → "ABC.pdf (p.3)", title → 강조 표시, sourceUri → 클릭 시 새 탭). source='project' → documentId 필수, 'ephemeral' → uploadId 필수.
  | {
      type: "artifact_created";
      artifactId: string;
      artifactKind: string;
      filename: string;
      sizeBytes: number;
      downloadUrl?: string;
    } // 도구가 artifact 생성 시 — UI 가 자동 패널 표시. SSE wire 의 `type` (event discriminant) 과 충돌하지 않게 entity 타입은 `artifactKind` 로 명명.
  // reason 4-state — 16 § MessageRun 상태 머신과 1:1. "failed" 는 별도 reason 아님 (cancelled + 선행 error event). HITL denied/timeout → 'end_turn' (모델이 후속 자연어 응답 생성).
  | {
      type: "stop";
      reason: "end_turn" | "tool_use" | "max_tokens" | "aborted";
      usage: TokenUsage;
    }
  | { type: "error"; error: SerializedError }; // wire format — Error class 인스턴스가 아니라 SerializedError (§ errors.ts). server 가 throw 시 serializeError() 로 변환.

// 16-API-CONTRACT § SSE wire format vs TypeScript ChatEvent 단일 출처.
// SSE 의 data: 라인에 직렬화되는 payload 타입 = ChatEvent 에서 type 필드 제거.
// 사용 예 (client wrapper):
//   const payload: ChatSsePayload<"text_delta"> = JSON.parse(eventData);
//   const chatEvent: ChatEvent = { type: e.event as ChatEvent["type"], ...payload };
export type ChatSsePayload<E extends ChatEvent["type"]> = Omit<
  Extract<ChatEvent, { type: E }>,
  "type"
>;

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}

// 16-API-CONTRACT § GET /notifications (SSE) 와 1:1. 사용자 단위 push 채널.
export type NotificationEvent =
  | {
      type: "document_indexed";
      documentId: string;
      projectId: string;
      indexStatus: ProjectDocumentRecord["indexStatus"];
    }
  | { type: "quota_warning"; remaining: number; periodEnd: string }
  | {
      type: "alert_event";
      rule: string;
      severity: "info" | "warn" | "critical";
      payload: Record<string, unknown>;
    }
  | { type: "ping" }; // 30초 heartbeat (ALB idle timeout 방지)

export interface PromptBlock {
  tier: PermissionTier;
  content: string;
  cacheControl?: "ephemeral";
}

// LLM 호출 시점의 turn 단위 메시지 — 도메인 entity Message (line 87) 와 별개.
export interface LLMMessage {
  role: "user" | "assistant" | "tool";
  content: string | ContentPart[];
}

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "tool_use"; toolCallId: string; name: string; args: unknown }
  | { type: "tool_result"; toolCallId: string; content: string | unknown };
```

> **Naming 분리**: 도메인 entity 인 `Message` (line 87, DB row 매핑) 와 LLM 호출 시점의 `LLMMessage` (line 631, Anthropic SDK 의 message turn) 는 별개 타입. ChatInput.messages 는 후자 사용.

### Streaming 매핑 (Coverage gap 1 보완)

Anthropic SSE → ChatEvent 매핑:

| Anthropic event                             | → ChatEvent                     |
| ------------------------------------------- | ------------------------------- |
| `message_start`                             | `message_start`                 |
| `content_block_start type=text`             | (no emit)                       |
| `content_block_delta type=text_delta`       | `text_delta`                    |
| `content_block_start type=tool_use`         | (buffer)                        |
| `content_block_delta type=input_json_delta` | (buffer json)                   |
| `content_block_stop`                        | `tool_use` (if tool_use buffer) |
| `message_delta stop_reason=...`             | (capture)                       |
| `message_stop`                              | `stop`                          |
| error                                       | `error`                         |

### Parallel tool calls (Coverage gap 2 보완)

v1.0: `parallelToolCalls=false`. 같은 turn 에 여러 tool_use 가 와도 **순차 처리** (안전 우선). v1.1+ 에서 dependency-free 검증 후 parallel 허용.

## 7. `SkillRegistry`

SKILL.md 디스커버리 + 활성화.

```ts
export interface SkillSpec {
  id: string; // '{{BRAND_PPTX_SKILL_NAME}}@1.0.0'
  name: string; // '{{BRAND_PPTX_SKILL_NAME}}'
  version: string; // '1.0.0' (semver strict, L09)
  description: string; // LLM 에 prompt 주입
  triggers: string[]; // 키워드 힌트
  entryPoint: string; // 'skills/{{BRAND_PPTX_SKILL_NAME}}/scripts/build.py'
  permissions: PermissionTier; // 기본 'user'
  assets?: { filename: string; s3Key: string }[];
}

export interface SkillRegistry {
  list(scope: {
    orgId: string;
    userId: string;
    projectId?: string;
  }): Promise<SkillSpec[]>;
  byId(id: string): Promise<SkillSpec | null>; // '{{BRAND_PPTX_SKILL_NAME}}@1.0.0' 같은 id 조회
  reload(): Promise<void>;
}
```

### 활성화 알고리즘 (Coverage gap 15 보완)

1. orchestrator 가 사용자 메시지를 받음
2. SkillRegistry.list 의 각 skill.description 을 LLM 의 system prompt 에 "available skills" 섹션으로 주입
3. LLM 이 응답에 `<activate_skill id="..."/>` 태그 또는 tool_use 로 활성화 요청
4. 활성화된 skill 의 SKILL.md 본문이 다음 turn 의 system prompt 에 추가
5. skill 의 scripts/* 는 bash tool 을 통해 sandbox 에서 실행

## 8. `McpClientPool`

MCP 서버 풀 + 도구 발견.

```ts
export interface McpClientPool {
  list(scope: {
    orgId: string;
    userId: string;
    projectId?: string;
  }): Promise<McpClient[]>;
  byId(id: string): Promise<McpClient | null>;
  discover(serverId: string): Promise<AgentToolSpec[]>;
  invoke(
    serverId: string,
    toolName: string,
    args: unknown,
    signal: AbortSignal,
  ): Promise<AgentToolResult>;
}

export interface McpClient {
  id: string;
  name: string;
  url: string; // SSRF 통과한 URL (12절 § SSRF 알고리즘)
  transport: "streamable_http" | "sse";
  health: "healthy" | "degraded" | "down";
  lastDiscoveredAt: Date | null;
}
```

---

## 권한 4계층 (Permission Tier) — 충돌 해결 매트릭스 (단일 출처)

> **결정 (보강)**: `System > Project > User > Tool` (1번 강), 한 등급 안에서는 최신 우세. 본 문서가 단일 출처.
> 01-LESSONS-LEARNED.md L05, 03-ARCHITECTURE.md, 08-SPRINT-PLAN.md Phase 2 acceptance 모두 본 표를 인용.

| 충돌             | 승리    |
| ---------------- | ------- |
| System ↔ Project | System  |
| System ↔ User    | System  |
| System ↔ Tool    | System  |
| Project ↔ User   | Project |
| Project ↔ Tool   | Project |
| User ↔ Tool      | User    |

### 사용자 메모리 = "강한 User"

prompt 안에서 다음 마크업으로 표기:

```
## 🔒 사용자 영구 지시사항 (System 다음 등급, 모든 도구 결과보다 우선)
- 사용자는 영업 담당입니다.
- ...
```

LLM 에게 이 섹션을 _"System 다음 등급으로 절대 무시 금지"_ 라고 명시.

- 단순 user 메시지와 충돌 시: 메모리 우선 (예: 메모리 "한국어로 답해" → 사용자가 영어 질문해도 한국어)
- System 과 충돌 시: System 우선 (예: 메모리 "비밀 키 알려줘" → System 의 보안 정책이 우선)

---

## 9. `HitlBridge` (보조 인터페이스, ToolContext 안에서 사용)

`apps/server/src/tools/hitl-manager.ts` 가 구현.

```ts
export interface HitlBridge {
  // 도구 호출 직전에 사용자 승인 요청
  // toolCallId 는 호출자가 미리 생성 (uuid v4) — Redis key + API path 모두 사용.
  // 동일 sessionId + toolCallId 호출은 idempotent (재시도 안전).
  askApproval(
    input: {
      sessionId: string; // bridge 가 Redis key 와 user routing 에 사용
      toolCallId: string; // 외부 식별자 — 16-API-CONTRACT § /sessions/:id/messages/hitl 가 요구
      toolName: string;
      args: Record<string, unknown>;
      rationale: string; // 모델이 작성한 "왜 이걸 호출하는지"
      timeoutMs?: number; // default 300_000 (5분)
    },
    signal: AbortSignal,
  ): Promise<HitlDecision>;
}

export type HitlDecision =
  | { kind: "approved"; modifiedArgs?: Record<string, unknown> }
  | { kind: "denied"; reason?: string }
  | { kind: "timeout" };
```

### Redis queue 구조

- Key: `hitl:{sessionId}:{toolCallId}`
- Value: JSON `{ kind: "pending", args, rationale, expiresAt }`
- TTL: timeoutMs
- 사용자 응답 시: client → POST `/sessions/:id/messages/hitl` → Redis SET → bridge resolve
- `signal.aborted` 시: Redis 키 DEL + promise reject AbortError

## 10. `BudgetClaim` (ToolContext 안)

`apps/server/src/db/quota-store.ts` + Redis counter.

```ts
export interface BudgetClaim {
  // 도구 실행 전 예산 차감 (낙관적)
  claim(estimateMicros: number): Promise<void>; // 부족 시 throw QUOTA_EXCEEDED
  // 실행 후 실 사용량 확정 (음수 가능)
  settle(actualMicros: number): Promise<void>;
  // 도구 실패 시 환불
  refund(): Promise<void>;

  // 남은 예산 조회 (논블로킹)
  readonly remaining: number;
}
```

## 11. `Logger`

`apps/server/src/lib/logger.ts` 가 Pino wrapper.

```ts
import type { ErrorCategory } from "./errors.js";

export interface LogPayload {
  category: ErrorCategory;
  msg: string;
  requestId?: string;
  userId?: string;
  orgId?: string;
  durationMs?: number;
  context?: Record<string, unknown>;
}

export interface Logger {
  debug(p: LogPayload): void;
  info(p: LogPayload): void;
  warn(p: LogPayload): void;
  error(p: LogPayload & { error?: unknown }): void;
  fatal(p: LogPayload & { error?: unknown }): void;
  child(ctx: { requestId?: string; userId?: string; orgId?: string }): Logger;
}
```

> string-only call 금지. ESLint rule `@{{PROJECT_SLUG}}/no-console` 가 `console.log/error` 도 금지.

---

## 12. `EmailSender` (auth flow 의존 — Phase 1 부터 필수)

`apps/server/src/lib/email-sender.ts` 가 구현 — `EMAIL_SENDER_KIND` env 에 따라 console/SES/SMTP 중 하나 instantiate.
[16-API-CONTRACT § signup/magic-link](16-API-CONTRACT.md) 가 직접 호출.

```ts
export interface EmailSendInput {
  to: string;
  subject: string;
  html: string; // 본문 (HTML)
  text?: string; // plain-text fallback (없으면 html → text 자동 변환)
  category: "auth" | "notification"; // logger / metric tagging
  idempotencyKey?: string; // 같은 key 의 재전송 차단 (24h)
}

export interface EmailSendResult {
  messageId: string; // provider 발급
  acceptedAt: Date;
}

export interface EmailSender {
  send(input: EmailSendInput, signal?: AbortSignal): Promise<EmailSendResult>;
}

// 구현 3종:
// - ConsoleEmailSender: stdout 출력 (dev/test). NODE_ENV !== "production" 일 때만 사용 가능.
// - SesEmailSender: AWS SDK SES v2 (prod default).
// - SmtpEmailSender: nodemailer (사내 SMTP 사용 시).
```

> `EMAIL_SENDER_KIND=console` 이 Phase 1 dev 의 첫 magic-link 흐름을 막지 않게 하는 핵심 — 이메일 본문이 server 로그에 그대로 출력되어 사용자가 URL 복사 가능.

---

## 인터페이스 변경 정책

12개 중 어느 것이든 변경 시:

1. `docs/rfc/<date>-interface-change.md` RFC 작성
2. 7일 dispute window
3. PR 의 모든 영향 받는 패키지 typecheck 통과 (turbo graph)
4. CODEOWNERS 의 모든 팀 1+ 승인
