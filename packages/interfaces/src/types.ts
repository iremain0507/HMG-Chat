// packages/interfaces/src/types.ts
//
// § 0 — Foundational + shared types. Single source of truth.
// Every other interface file may import from here. This file (together with
// errors.ts) is a ROOT of the import graph: it imports ONLY from errors.ts and
// must never import from another interface file (no cycles).
//
// Contents (8 categories — see § 파일 분할):
//   1. Foundational primitives — JsonSchema, JsonSchemaType
//   2. Generic containers       — Repo<T,F>, Pagination, Page<T>
//   3. Domain enums             — PermissionTier, ToolPolicy, ActiveRunStatus, Visibility, ProjectRole
//   4. Domain entities (DB row) — Organization, User, OrgUnit, Session, Message, Project, ...
//   5. Record types (server-only fields) — ProjectDocumentRecord, ArtifactRecord, ...
//   6. Filter types             — OrgFilter, UserFilter, OrgUnitFilter, ChunkFilter, ...
//   7. Tool spec types          — AgentToolSpec, AgentToolResult, AgentToolBase (spec-only)
//   8. Streaming union          — ChatEvent, ChatSsePayload<E>, TokenUsage, LLMMessage, ...

import type { ErrorCategory, SerializedError, WChatError } from "./errors.js";

// ─────────────────────────────────────────────────────────────────────────────
// 1. JSON Schema (tool inputSchema 등) — Draft-2020-12 subset, no external lib.
// ─────────────────────────────────────────────────────────────────────────────

export type JsonSchemaType =
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "object"
  | "array"
  | "null";

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

// ─────────────────────────────────────────────────────────────────────────────
// 2. Generic container types (Repo, Pagination, Page).
//    Every Repo interface extends Repo<T,F>. Defined here to avoid forward refs.
// ─────────────────────────────────────────────────────────────────────────────

export interface Pagination {
  cursor?: string;
  limit: number /* max 100 */;
}

export interface Page<T> {
  items: T[];
  nextCursor?: string;
  totalApprox?: number;
}

export interface Repo<T, F = Record<string, unknown>> {
  insert(data: Partial<T>): Promise<T>;
  bulkInsert(rows: Partial<T>[]): Promise<T[]>;
  update(id: string, data: Partial<T>): Promise<T>;
  delete(id: string): Promise<void>;
  byId(id: string): Promise<T | null>;
  list(filter?: F, pagination?: Pagination): Promise<Page<T>>;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Domain enums.
// ─────────────────────────────────────────────────────────────────────────────

export type PermissionTier = "system" | "project" | "user" | "tool";
export type ToolPolicy = "allow" | "hitl" | "deny";
export type ActiveRunStatus = "pending" | "running" | "cancelled" | "completed";
export type Visibility = "private" | "team" | "org";
export type ProjectRole = "owner" | "editor" | "viewer";

// ─────────────────────────────────────────────────────────────────────────────
// 4. Domain entities (DataAccess Repo<T> 의 T). 06-DATA-MODEL 테이블과 1:1,
//    snake_case → camelCase.
// ─────────────────────────────────────────────────────────────────────────────

export interface Organization {
  id: string;
  name: string;
  domain: string;
  plan: string;
  allowedModels: string[];
  allowedTools: string[];
  defaultTokenBudgetMicros: number | null;
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
  embedding: number[] | null; // 1024 dim
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

// ─────────────────────────────────────────────────────────────────────────────
// 5. Record types (server-only fields included).
// ─────────────────────────────────────────────────────────────────────────────

export interface ProjectDocumentRecord {
  id: string;
  projectId: string;
  filename: string;
  contentHash: string; // sha256 of original bytes — dedup key
  mimeType: string;
  sizeBytes: number;
  indexStatus:
    | "pending"
    | "parsing"
    | "chunking"
    | "embedding"
    | "indexed"
    | "failed";
  chunkCount: number;
  s3Key: string; // raw upload location
  indexedAt: Date | null;
  failureReason: string | null;
  createdBy: string; // user id
  createdAt: Date;
  updatedAt: Date;
}

export interface ArtifactRecord {
  id: string;
  sessionId: string | null;
  createdBy: string;
  type:
    | "pptx"
    | "pdf"
    | "docx"
    | "xlsx"
    | "markdown"
    | "html"
    | "image"
    | "other";
  filename: string;
  mimeType: string | null;
  sizeBytes: number;
  storageKind: "inline" | "s3"; // 06-DATA-MODEL § artifacts CHECK + 16 § storage_kind
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

// 06-DATA-MODEL § 0014_uploads.sql 의 uploads 테이블 + 16-API-CONTRACT § 6 Uploads 단일 출처
export interface UploadRecord {
  id: string;
  userId: string;
  sessionId: string | null;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  s3Key: string;
  sha256: string; // dedup key — UNIQUE (user_id, sha256)
  expiresAt: Date; // 30일 후 자동 정리
  createdAt: Date;
}

export interface McpServerRecord {
  id: string;
  orgId: string;
  projectId: string | null;
  userId: string | null;
  name: string;
  url: string;
  transport: "streamable_http" | "sse";
  authHeaderName: string | null;
  authSecretArn: string | null;
  supportedTools: Array<{
    name: string;
    description: string;
    inputSchema: JsonSchema;
  }>;
  lastDiscoveredAt: Date | null;
  status: "active" | "degraded" | "suspended";
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
  level: "debug" | "info" | "warn" | "error" | "fatal";
  category: ErrorCategory;
  message: string;
  context?: Record<string, unknown>;
  requestId?: string;
  userId?: string;
  orgId?: string;
}

export interface ToolMetricEntry {
  toolName: string;
  status: "ok" | "error" | "timeout" | "denied" | "hitl-pending";
  durationMs: number;
  userId?: string;
  orgId?: string;
}

export interface HealthCheckResult {
  target: string;
  status: "healthy" | "degraded" | "down";
  latencyMs: number | null;
  context?: Record<string, unknown>;
}

export interface AlertEvent {
  id: string;
  ruleId: string;
  severity: "info" | "warn" | "critical";
  message: string;
  payload: Record<string, unknown>;
  createdAt: Date;
  resolvedAt: Date | null;
}

// ─── auth (06 § 0012/0013) — DDL 1:1, server-side only ───

export interface MagicLinkTokenRecord {
  tokenHash: string; // PRIMARY KEY (DDL: token_hash). 평문은 메일로만, DB 는 sha256
  email: string;
  userId: string | null; // signup 단계에선 null
  orgId: string; // email 도메인 매칭으로 결정된 org
  intent: "signup" | "login";
  signupName: string | null; // intent='signup' 일 때만
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}

export interface RefreshTokenFamilyRecord {
  familyId: string; // PRIMARY KEY (DDL: family_id)
  userId: string;
  currentGeneration: number; // rotate 마다 +1
  currentJti: string; // 활성 refresh token 의 jti claim
  createdAt: Date;
  lastUsedAt: Date; // rotate 마다 NOW()
  revokedAt: Date | null;
  revokeReason: "theft_suspected" | "logout" | "admin" | "expired" | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Filter types (Repo<T,F> 의 F).
// ─────────────────────────────────────────────────────────────────────────────

export interface OrgFilter {
  domainEq?: string;
}

export interface UserFilter {
  orgId?: string;
  emailEq?: string;
  statusIn?: User["status"][];
}

export interface OrgUnitFilter {
  orgId?: string;
  parentId?: string | null;
  pathPrefix?: string;
}

export interface ChunkFilter {
  documentId?: string;
  projectId?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Entity-bound + special Repos (Repo<T,F> 만으로 부족한 경우).
// (DataAccess.ts 의 cross-cutting Repo 들은 그쪽 파일에 위치. 본 § 0 은 도메인
//  코어 entity Repo + auth Repo + 보조 Repo 를 보유 — § 파일 분할 주석 참조.)
// ─────────────────────────────────────────────────────────────────────────────

export interface SessionRepo
  extends Repo<Session, { userId?: string; projectId?: string | null }> {
  lock(
    sessionId: string,
    ttlMs: number,
    signal: AbortSignal,
  ): Promise<{ unlock(): Promise<void> }>;
  // status: DB CHECK (sessions_active_runs.status) 와 동일 4-state.
  setActiveRun(
    sessionId: string,
    jobId: string,
    status: ActiveRunStatus,
  ): Promise<void>;
  clearActiveRun(sessionId: string): Promise<void>;
}

export interface MessageRepo
  extends Repo<Message, { sessionId: string; role?: Message["role"] }> {
  appendStream(
    sessionId: string,
    role: Message["role"],
    chunks: AsyncIterable<unknown>,
  ): Promise<Message>;
}

export interface ProjectRepo
  extends Repo<Project, { orgId?: string; visibility?: Project["visibility"] }> {
  byOwner(userId: string): Promise<Project[]>;
}

// ProjectMember 는 composite PK (projectId, userId). 일반 Repo<T> 사용 불가.
export interface ProjectMemberRepo {
  insert(data: ProjectMember): Promise<ProjectMember>;
  bulkInsert(rows: ProjectMember[]): Promise<ProjectMember[]>;
  upsert(input: ProjectMember): Promise<ProjectMember>;
  byKey(projectId: string, userId: string): Promise<ProjectMember | null>;
  updateRole(
    projectId: string,
    userId: string,
    role: ProjectMember["role"],
  ): Promise<ProjectMember>;
  deleteByKey(projectId: string, userId: string): Promise<void>;
  list(
    filter?: { projectId?: string; userId?: string },
    pagination?: Pagination,
  ): Promise<Page<ProjectMember>>;
}

export interface ProjectDocumentRepo
  extends Repo<
    ProjectDocumentRecord,
    { projectId?: string; indexStatus?: ProjectDocumentRecord["indexStatus"] }
  > {
  byContentHash(
    projectId: string,
    hash: string,
  ): Promise<ProjectDocumentRecord | null>;
  updateIndexStatus(
    id: string,
    status: ProjectDocumentRecord["indexStatus"],
    chunkCount?: number,
  ): Promise<void>;
}

// spec adaptation: § 0 writes `interface ArtifactRepo extends Repo<...> {}` (empty
// body). An empty extending interface trips ESLint `no-empty-object-type`; a type
// alias is semantically identical and is the recommended resolution.
export type ArtifactRepo = Repo<
  ArtifactRecord,
  { sessionId?: string; createdBy?: string }
>;

export interface ArtifactRevisionRepo {
  insert(input: {
    artifactId: string;
    version: number;
    s3Key: string;
    diffSummary?: string;
  }): Promise<void>;
  list(
    artifactId: string,
  ): Promise<
    Array<{
      version: number;
      s3Key: string;
      diffSummary: string | null;
      createdAt: Date;
    }>
  >;
  byVersion(
    artifactId: string,
    version: number,
  ): Promise<{ s3Key: string } | null>;
}

export interface ArtifactShareRepo
  extends Repo<ArtifactShareRecord, { artifactId?: string; tokenEq?: string }> {
  byToken(token: string): Promise<ArtifactShareRecord | null>;
  incrementViewCount(token: string): Promise<void>;
  revoke(id: string): Promise<void>;
}

export interface UploadRepo
  extends Repo<
    UploadRecord,
    { userId?: string; sessionId?: string | null; expiresBeforeNow?: boolean }
  > {
  bySha256(userId: string, sha256: string): Promise<UploadRecord | null>;
  expiredOlderThan(cutoff: Date): Promise<UploadRecord[]>; // data-retention cron
}

export interface UserMemoryRepo
  extends Repo<
    UserMemory,
    { userId?: string; category?: UserMemory["category"]; pinned?: boolean }
  > {
  pin(id: string, pinned: boolean): Promise<void>;
}

export interface McpServerRepo
  extends Repo<
    McpServerRecord,
    { orgId?: string; projectId?: string | null; userId?: string | null }
  > {
  updateDiscovery(
    id: string,
    supportedTools: McpServerRecord["supportedTools"],
  ): Promise<void>;
}

// SkillAsset 는 composite PK (skillId, filename). byId/delete(id) 사용 불가.
export interface SkillAssetRepo {
  insert(data: SkillAssetRecord): Promise<SkillAssetRecord>;
  bulkInsert(rows: SkillAssetRecord[]): Promise<SkillAssetRecord[]>;
  byKey(skillId: string, filename: string): Promise<SkillAssetRecord | null>;
  bySkill(skillId: string): Promise<SkillAssetRecord[]>;
  deleteByKey(skillId: string, filename: string): Promise<void>;
  deleteBySkill(skillId: string): Promise<number>; // 반환값 = 삭제 row 수
  list(
    filter?: { skillId?: string },
    pagination?: Pagination,
  ): Promise<Page<SkillAssetRecord>>;
}

// UserQuotaInfo 는 PK = userId (1:1).
export interface UserQuotaRepo {
  byUserId(userId: string): Promise<UserQuotaInfo | null>;
  upsert(info: UserQuotaInfo): Promise<UserQuotaInfo>;
  consume(userId: string, micros: number): Promise<{ remaining: number }>;
  refund(userId: string, micros: number): Promise<void>;
  list(
    filter?: { userId?: string },
    pagination?: Pagination,
  ): Promise<Page<UserQuotaInfo>>;
}

export interface UsageLogRepo {
  append(entry: UsageLogEntry): Promise<void>;
  list(
    filter: { userId?: string; orgId?: string; fromDate?: Date; toDate?: Date },
    p: Pagination,
  ): Promise<Page<UsageLogEntry>>;
  aggregate(filter: {
    userId?: string;
    orgId?: string;
    fromDate: Date;
    toDate: Date;
  }): Promise<{ tokensIn: number; tokensOut: number; costMicros: number }>;
}

export interface ErrorLogRepo {
  append(entry: ErrorLogEntry): Promise<void>;
  list(
    filter: { category?: ErrorCategory; level?: ErrorLogEntry["level"]; from?: Date },
    p: Pagination,
  ): Promise<Page<ErrorLogEntry>>;
}

export interface ToolMetricRepo {
  append(entry: ToolMetricEntry): Promise<void>;
  aggregate(
    toolName: string,
    from: Date,
    to: Date,
  ): Promise<{ count: number; errorCount: number; p50DurationMs: number }>;
}

export interface HealthHistoryRepo {
  append(entry: HealthCheckResult): Promise<void>;
  recent(target: string, limit: number): Promise<HealthCheckResult[]>;
}

export interface AlertEventRepo
  extends Repo<
    AlertEvent,
    { severity?: AlertEvent["severity"]; unresolved?: boolean }
  > {
  resolve(id: string): Promise<void>;
}

export interface MagicLinkTokenRepo
  extends Repo<
    MagicLinkTokenRecord,
    {
      email?: string;
      intent?: MagicLinkTokenRecord["intent"];
      unusedOnly?: boolean;
    }
  > {
  byTokenHash(hash: string): Promise<MagicLinkTokenRecord | null>; // = byId alias
  markUsed(tokenHash: string, usedAt: Date): Promise<void>;
  expireOlderThan(cutoff: Date): Promise<number>; // GC, 반환값 = 삭제 row 수
}

export interface RefreshTokenFamilyRepo
  extends Repo<
    RefreshTokenFamilyRecord,
    { userId?: string; activeOnly?: boolean }
  > {
  byCurrentJti(jti: string): Promise<RefreshTokenFamilyRecord | null>;
  rotate(familyId: string, newJti: string): Promise<{ generation: number }>;
  revoke(
    familyId: string,
    reason: RefreshTokenFamilyRecord["revokeReason"],
  ): Promise<void>;
  revokeAllForUser(
    userId: string,
    reason: RefreshTokenFamilyRecord["revokeReason"],
  ): Promise<number>;
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. Tool spec types (AgentToolSpec / AgentToolResult / AgentToolBase).
//    LLMProvider/SkillRegistry/McpClientPool 가 본 spec 을 참조 — types.ts 에 위치.
//    AgentTool.ts 는 ToolContext (facade) + AgentToolInvocation + AgentTool 정의.
// ─────────────────────────────────────────────────────────────────────────────

export interface AgentToolSpec {
  name: string; // 'bash' / 'knowledge_search' / 'mcp:wchat-search'
  description: string; // LLM 에게 보일 한국어 설명
  inputSchema: JsonSchema;
  outputSchema?: JsonSchema;
  permissionTier: PermissionTier;
  defaultPolicy: ToolPolicy;
  tags?: string[];
  costEstimate?: { ms: number; tokens?: number };
}

// AgentToolInvocation 은 ToolContext 의존 → AgentTool.ts 에 정의 (forward ref 회피).
export interface AgentToolResult {
  toolCallId: string;
  content:
    | { kind: "text"; text: string }
    | { kind: "json"; data: unknown }
    | { kind: "file"; artifactId: string }
    | { kind: "error"; error: WChatError };
  metadata?: { durationMs: number; tokens?: number; provider?: string };
}

// AgentTool interface 는 spec 만 본다. invoke 시그니처는 AgentTool.ts 에서 final.
export interface AgentToolBase {
  spec: AgentToolSpec;
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. Streaming union (ChatEvent / ChatSsePayload / TokenUsage / LLMMessage / ...).
//    16-API-CONTRACT § /sessions/:id/messages (SSE) 와 1:1.
// ─────────────────────────────────────────────────────────────────────────────

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}

export type ChatEvent =
  | {
      type: "message_start";
      messageId: string;
      meta: { provider: string; model: string };
    }
  | { type: "message_replace"; messageId: string; contentSoFar: string }
  | { type: "text_delta"; text: string }
  | { type: "tool_use"; toolCallId: string; name: string; args: unknown }
  | { type: "tool_result"; toolCallId: string; content: string | unknown }
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
    }
  | {
      type: "artifact_created";
      artifactId: string;
      artifactKind: string;
      filename: string;
      sizeBytes: number;
      downloadUrl?: string;
    }
  | {
      type: "stop";
      reason: "end_turn" | "tool_use" | "max_tokens" | "aborted";
      usage: TokenUsage;
    }
  | { type: "error"; error: SerializedError };

// SSE 의 data: 라인에 직렬화되는 payload = ChatEvent 에서 type 필드 제거.
//   const payload: ChatSsePayload<"text_delta"> = JSON.parse(eventData);
//   const chatEvent: ChatEvent = { type: e.event as ChatEvent["type"], ...payload };
export type ChatSsePayload<E extends ChatEvent["type"]> = Omit<
  Extract<ChatEvent, { type: E }>,
  "type"
>;

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
  | { type: "ping" }; // 30초 heartbeat

export interface PromptBlock {
  tier: PermissionTier;
  content: string;
  cacheControl?: "ephemeral";
}

// LLM 호출 시점의 turn 단위 메시지 — 도메인 entity Message 와 별개.
export interface LLMMessage {
  role: "user" | "assistant" | "tool";
  content: string | ContentPart[];
}

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "tool_use"; toolCallId: string; name: string; args: unknown }
  | { type: "tool_result"; toolCallId: string; content: string | unknown };

// ─────────────────────────────────────────────────────────────────────────────
// Search result types (DataAccess.ts 의 DocumentChunkRepo/EphemeralChunkRepo 가
// 반환). EphemeralChunk 그 자체는 session-scope 라 DataAccess.ts 에 위치하지만,
// HybridSearchResult 는 project-scope DocumentChunk 만 참조하므로 여기 둔다.
// SearchHit 는 EphemeralChunk 를 참조하므로 DataAccess.ts 에 위치.
// ─────────────────────────────────────────────────────────────────────────────

// project-scope (DocumentChunkRepo) 단일 source 결과.
export interface HybridSearchResult {
  chunk: DocumentChunk;
  vectorScore: number;
  bm25Score: number;
  rrfScore: number;
  rank: number;
}
