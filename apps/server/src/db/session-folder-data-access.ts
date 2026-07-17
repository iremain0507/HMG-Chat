// db/session-folder-data-access.ts — routes/folders.ts SessionFolderDataAccess(P19-T1-03)의
// pg 구현. dev/test DATABASE_URL role 은 superuser 라 RLS(0019_session_folders.sql)를
// 우회한다 — org_id + created_by 이중 조건으로 application 레벨 격리를 강제한다
// (session-data-access.ts 의 user_id 단일 조건과 달리, session_folders 는 org_id 컬럼도
// 갖고 있어 migration 주석의 "이중 검사" 방침을 그대로 따른다).
import { pgPool } from "./client.js";

export interface SessionFolder {
  id: string;
  orgId: string;
  name: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

function toFolder(row: Record<string, unknown>): SessionFolder {
  return {
    id: row.id as string,
    orgId: row.org_id as string,
    name: row.name as string,
    createdBy: row.created_by as string,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
}

export interface SessionFolderDataAccess {
  create(orgId: string, userId: string, name: string): Promise<SessionFolder>;
  list(orgId: string, userId: string): Promise<SessionFolder[]>;
  byIdForOwner(
    orgId: string,
    userId: string,
    id: string,
  ): Promise<SessionFolder | null>;
  renameForOwner(
    orgId: string,
    userId: string,
    id: string,
    name: string,
  ): Promise<SessionFolder | null>;
  deleteForOwner(orgId: string, userId: string, id: string): Promise<boolean>;
}

export function createPgSessionFolderDataAccess(): SessionFolderDataAccess {
  return {
    async create(orgId, userId, name) {
      const res = await pgPool.query(
        `INSERT INTO session_folders (org_id, name, created_by)
         VALUES ($1, $2, $3) RETURNING *`,
        [orgId, name, userId],
      );
      return toFolder(res.rows[0]);
    },
    async list(orgId, userId) {
      const res = await pgPool.query(
        `SELECT * FROM session_folders WHERE org_id = $1 AND created_by = $2
         ORDER BY created_at ASC`,
        [orgId, userId],
      );
      return res.rows.map(toFolder);
    },
    async byIdForOwner(orgId, userId, id) {
      const res = await pgPool.query(
        `SELECT * FROM session_folders WHERE id = $1 AND org_id = $2 AND created_by = $3`,
        [id, orgId, userId],
      );
      return res.rows[0] ? toFolder(res.rows[0]) : null;
    },
    async renameForOwner(orgId, userId, id, name) {
      const res = await pgPool.query(
        `UPDATE session_folders SET name = $1
         WHERE id = $2 AND org_id = $3 AND created_by = $4 RETURNING *`,
        [name, id, orgId, userId],
      );
      return res.rows[0] ? toFolder(res.rows[0]) : null;
    },
    async deleteForOwner(orgId, userId, id) {
      const res = await pgPool.query(
        `DELETE FROM session_folders WHERE id = $1 AND org_id = $2 AND created_by = $3`,
        [id, orgId, userId],
      );
      return (res.rowCount ?? 0) > 0;
    },
  };
}
