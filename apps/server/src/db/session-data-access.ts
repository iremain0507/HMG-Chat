// db/session-data-access.ts — routes/sessions.ts SessionsPort(GET /, GET /:id/messages —
// P17-T1-02, TS-08/10)의 pg 구현. dev/test DATABASE_URL role 은 superuser 라
// RLS(0002_sessions_messages.sql)를 우회한다 — user_id = $1 조건으로 application 레벨
// 격리를 강제한다(message-data-access.ts 와 동일 사유/패턴).
import type { Session } from "@wchat/interfaces";
import { pgPool } from "./client.js";

// P19-T1-02 — sessions.pinned_at(migration 0018)은 frozen Session(14-INTERFACES)에 없는 신규
// 컬럼이라, packages/interfaces 를 건드리지 않고 로컬 교집합 타입으로 확장한다(org-settings-schema.ts
// 의 "LOCAL 타입, frozen 회피" 컨벤션과 동일 사유 — 이 포트는 애초에 SessionRepo 전체가 아니라
// routes/sessions.ts 가 실제 쓰는 부분만 좁힌 로컬 포트, P17-T1-02 주석 참조).
// P19-T1-03 — sessions.folder_id(migration 0019)도 frozen Session 에 없는 신규 컬럼이라
// pinnedAt 과 동일 사유로 로컬 교집합 타입에 확장한다.
export type SessionWithPin = Session & {
  pinnedAt: Date | null;
  folderId: string | null;
};

function toSession(row: Record<string, unknown>): SessionWithPin {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    projectId: (row.project_id as string | null) ?? null,
    title: (row.title as string | null) ?? null,
    archivedAt: (row.archived_at as Date | null) ?? null,
    pinnedAt: (row.pinned_at as Date | null) ?? null,
    folderId: (row.folder_id as string | null) ?? null,
    lastMessageAt: (row.last_message_at as Date | null) ?? null,
    createdAt: row.created_at as Date,
  };
}

export interface SessionsDataAccess {
  list(
    filter: { userId: string },
    pagination?: { cursor?: string; limit?: number },
  ): Promise<{ items: SessionWithPin[]; nextCursor?: string }>;
  byId(id: string): Promise<SessionWithPin | null>;
  updateForOwner(
    userId: string,
    id: string,
    data: {
      title?: string | null;
      archived?: boolean;
      folderId?: string | null;
    },
  ): Promise<SessionWithPin | null>;
  deleteForOwner(userId: string, id: string): Promise<boolean>;
  // 토글: 현재 pinned_at 이 NULL 이면 NOW() 로, 아니면 NULL 로 — 원자적 단일 UPDATE
  // (read-then-write race 방지). ownership 은 WHERE id=.. AND user_id=.. 로 쿼리에 내장(TS-09 패턴).
  togglePinForOwner(userId: string, id: string): Promise<SessionWithPin | null>;
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
      if (data.folderId !== undefined) {
        fields.push(`folder_id = $${i}`);
        values.push(data.folderId);
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
    async togglePinForOwner(userId, id) {
      const res = await pgPool.query(
        `UPDATE sessions
         SET pinned_at = CASE WHEN pinned_at IS NULL THEN NOW() ELSE NULL END
         WHERE id = $1 AND user_id = $2
         RETURNING *`,
        [id, userId],
      );
      return res.rows[0] ? toSession(res.rows[0]) : null;
    },
  };
}
