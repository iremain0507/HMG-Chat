// db/audit-log-data-access.ts — audit_log(migration 0031) pg 구현. dev/test DATABASE_URL role 은
// superuser 라 RLS 를 우회하므로(group-data-access.ts/resource-grants-data-access.ts 와 동일 사유),
// org 격리는 모든 쿼리의 WHERE org_id = $ 로 application 레벨에서도 명시적으로 강제한다(이중 방어).
import { pgPool } from "./client.js";

export interface AuditLogEntry {
  id: string;
  orgId: string;
  actorUserId: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface AuditLogRecordInput {
  orgId: string;
  actorUserId?: string | null;
  action: string;
  resourceType?: string | null;
  resourceId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface AuditLogListOptions {
  action?: string;
  cursor?: string;
  limit?: number;
}

export interface AuditLogPage {
  items: AuditLogEntry[];
  nextCursor: string | null;
}

export interface AuditLogDataAccess {
  record(input: AuditLogRecordInput): Promise<void>;
  list(orgId: string, options?: AuditLogListOptions): Promise<AuditLogPage>;
}

function toEntry(row: {
  id: string;
  org_id: string;
  actor_user_id: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
}): AuditLogEntry {
  return {
    id: row.id,
    orgId: row.org_id,
    actorUserId: row.actor_user_id,
    action: row.action,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    metadata: row.metadata,
    createdAt: row.created_at,
  };
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export function createPgAuditLogDataAccess(): AuditLogDataAccess {
  return {
    async record(input) {
      await pgPool.query(
        `INSERT INTO audit_log (org_id, actor_user_id, action, resource_type, resource_id, metadata)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          input.orgId,
          input.actorUserId ?? null,
          input.action,
          input.resourceType ?? null,
          input.resourceId ?? null,
          JSON.stringify(input.metadata ?? {}),
        ],
      );
    },
    async list(orgId, options) {
      const limit = Math.min(options?.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
      // keyset cursor: 이전 페이지 마지막 행의 created_at(ISO) — 동시각 중복행은
      // sessions.ts 목록과 동일하게 허용 오차로 취급(감사 로그는 append-only 라 실무 영향 미미).
      const cursorDate = options?.cursor ? new Date(options.cursor) : null;
      const res = await pgPool.query(
        `SELECT id, org_id, actor_user_id, action, resource_type, resource_id, metadata, created_at
         FROM audit_log
         WHERE org_id = $1
           AND ($2::text IS NULL OR action = $2)
           AND ($3::timestamptz IS NULL OR created_at < $3)
         ORDER BY created_at DESC
         LIMIT $4`,
        [
          orgId,
          options?.action ?? null,
          cursorDate && !Number.isNaN(cursorDate.getTime())
            ? cursorDate.toISOString()
            : null,
          limit,
        ],
      );
      const items = res.rows.map(toEntry);
      const last = items[items.length - 1];
      return {
        items,
        nextCursor:
          items.length === limit && last ? last.createdAt.toISOString() : null,
      };
    },
  };
}
