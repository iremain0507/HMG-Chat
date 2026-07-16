// db/session-data-access.ts — routes/sessions.ts SessionsPort(GET /, GET /:id/messages —
// P17-T1-02, TS-08/10)의 pg 구현. dev/test DATABASE_URL role 은 superuser 라
// RLS(0002_sessions_messages.sql)를 우회한다 — user_id = $1 조건으로 application 레벨
// 격리를 강제한다(message-data-access.ts 와 동일 사유/패턴).
import type { Session } from "@wchat/interfaces";
import { pgPool } from "./client.js";

function toSession(row: Record<string, unknown>): Session {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    projectId: (row.project_id as string | null) ?? null,
    title: (row.title as string | null) ?? null,
    archivedAt: (row.archived_at as Date | null) ?? null,
    lastMessageAt: (row.last_message_at as Date | null) ?? null,
    createdAt: row.created_at as Date,
  };
}

export interface SessionsDataAccess {
  list(
    filter: { userId: string },
    pagination?: { cursor?: string; limit?: number },
  ): Promise<{ items: Session[]; nextCursor?: string }>;
  byId(id: string): Promise<Session | null>;
  updateForOwner(
    userId: string,
    id: string,
    data: { title?: string | null; archived?: boolean },
  ): Promise<Session | null>;
  deleteForOwner(userId: string, id: string): Promise<boolean>;
}

export function createPgSessionDataAccess(): SessionsDataAccess {
  return {
    async list(filter, pagination) {
      const limit = pagination?.limit ?? 20;
      const res = await pgPool.query(
        `SELECT * FROM sessions WHERE user_id = $1
         ORDER BY COALESCE(last_message_at, created_at) DESC LIMIT $2`,
        [filter.userId, limit],
      );
      return { items: res.rows.map(toSession) };
    },
    async byId(id) {
      const res = await pgPool.query("SELECT * FROM sessions WHERE id = $1", [
        id,
      ]);
      return res.rows[0] ? toSession(res.rows[0]) : null;
    },
    async updateForOwner(userId, id, data) {
      const fields: string[] = [];
      const values: unknown[] = [];
      let i = 1;
      if (data.title !== undefined) {
        fields.push(`title = $${i}`);
        values.push(data.title);
        i++;
      }
      if (data.archived !== undefined) {
        fields.push(`archived_at = $${i}`);
        values.push(data.archived ? new Date() : null);
        i++;
      }
      if (fields.length === 0) return this.byId(id);
      values.push(id, userId);
      const res = await pgPool.query(
        `UPDATE sessions SET ${fields.join(", ")}
         WHERE id = $${i} AND user_id = $${i + 1} RETURNING *`,
        values,
      );
      return res.rows[0] ? toSession(res.rows[0]) : null;
    },
    async deleteForOwner(userId, id) {
      const res = await pgPool.query(
        "DELETE FROM sessions WHERE id = $1 AND user_id = $2",
        [id, userId],
      );
      return (res.rowCount ?? 0) > 0;
    },
  };
}
