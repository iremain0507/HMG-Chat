// packages/interfaces/src/DataAccess.ts
// § 3 — DB 호출의 단일 진입점. production 은 Drizzle, 테스트는 InMemory.
//
// 본 파일은 DataAccess facade interface + cross-cutting Repo (DocumentChunkRepo,
// EphemeralChunkRepo) + 그에 딸린 session-scope 타입 (EphemeralChunk, SearchHit) 을
// 보유. entity-bound Repo (SessionRepo/MessageRepo/...) + auth Repo + Repo<T,F>
// generic 자체는 types.ts 단일 출처 → 본 파일은 types.ts 만 import.

import type {
  AgentRepo,
  AlertEventRepo,
  ArtifactRepo,
  ArtifactRevisionRepo,
  ArtifactShareRepo,
  ChunkFilter,
  DocumentChunk,
  ErrorLogRepo,
  HealthHistoryRepo,
  HybridSearchResult,
  MagicLinkTokenRepo,
  McpServerRepo,
  MessageRepo,
  Organization,
  OrgFilter,
  OrgUnit,
  OrgUnitFilter,
  ProjectDocumentRepo,
  ProjectMemberRepo,
  ProjectRepo,
  RefreshTokenFamilyRepo,
  Repo,
  SessionRepo,
  SkillAssetRepo,
  ToolMetricRepo,
  UploadRepo,
  UsageLogRepo,
  UserMemoryRepo,
  UserRepo,
  UserQuotaRepo,
} from "./types.js";

export interface DataAccess {
  organizations: Repo<Organization, OrgFilter>;
  users: UserRepo;
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
  agents: AgentRepo; // C5 · P22-T6-10 커스텀 워크스페이스 에이전트
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

// Repo<T,F> / Pagination / Page<T> generic 정의는 § 0 types.ts 단일 출처.
// 본 § 3 의 Repo 들은 모두 그 generic 을 extend.

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

// 06-DATA-MODEL § 0014 의 ephemeral_chunks + 16 § POST /sessions/:id/messages 첨부 RAG.
// 세션 scope, project_documents 와 분리. session cascade delete 로 자동 정리.
export interface EphemeralChunk {
  id: string;
  sessionId: string;
  uploadId: string;
  chunkIndex: number;
  pageNumber: number | null; // PDF/PPT citation. null = N/A
  content: string;
  embedding: number[]; // 1024-dim (voyage-multilingual-2)
  metadata: Record<string, unknown>; // { heading?, section?, charStart?, charEnd?, ... }
  createdAt: Date;
}

// NOTE (spec adaptation): § 3 가 EphemeralChunkRepo 에 `bulkInsert(input:
// Omit<EphemeralChunk,"id"|"createdAt">[]): Promise<void>` 를 명시하는데, 이는
// types.ts 의 `Repo<T>.bulkInsert(rows: Partial<T>[]): Promise<T[]>` 와 반환형이
// 충돌한다 (void vs T[]). spec 의 의도 (입력은 id/createdAt 없는 새 chunk, 반환은
// void) 를 보존하기 위해 base 의 bulkInsert 만 Omit 하고 narrowed 시그니처를 단다.
export interface EphemeralChunkRepo extends Omit<
  Repo<EphemeralChunk, { sessionId?: string; uploadId?: string }>,
  "bulkInsert"
> {
  // session+project 동시 검색: server 의 knowledge_search 도구가 호출.
  hybridSearchUnified(
    input: {
      sessionId: string;
      projectId: string | null; // null 이면 project chunk 없이 session 만 검색
      queryEmbedding: number[];
      queryText: string;
      topK: number;
      rrfK: number;
    },
    signal?: AbortSignal,
  ): Promise<SearchHit[]>;

  bulkInsert(input: Omit<EphemeralChunk, "id" | "createdAt">[]): Promise<void>;
}

// session+project 통합 검색 결과 — discriminated union (source 별 chunk 타입 분기).
// 16 § /sessions/:id/messages 의 citation event 가 본 union 의 source/chunk 정보 사용.
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
