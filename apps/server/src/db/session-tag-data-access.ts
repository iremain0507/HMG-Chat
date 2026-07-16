// db/session-tag-data-access.ts — routes/sessions.ts SessionTagDataAccess(P19-T1-04)의
// pg 구현. dev/test DATABASE_URL role 은 superuser 라 RLS(0020_session_tags.sql)를 우회한다 —
// org_id = $1 조건으로 application 레벨 방어선을 만든다(session-folder-data-access.ts 와 동일
// 사유). 사용자 단위 격리는 session_id 자체가 이미 sessions.user_id 소유 세션으로 한정되므로
// (routes/sessions.ts 가 세션 ownership 을 먼저 검증) 여기선 org_id 만 확인한다.
import { pgPool } from "./client.js";

export interface SessionTag {
  id: string;
  sessionId: string;
  orgId: string;
  tag: string;
  createdAt: Date;
}

function toTag(row: Record<string, unknown>): SessionTag {
  return {
    id: row.id as string,
    sessionId: row.session_id as string,
    orgId: row.org_id as string,
    tag: row.tag as string,
    createdAt: row.created_at as Date,
  };
}

export interface SessionTagDataAccess {
  add(orgId: string, sessionId: string, tag: string): Promise<SessionTag>;
  remove(orgId: string, sessionId: string, tag: string): Promise<boolean>;
  listForSession(orgId: string, sessionId: string): Promise<SessionTag[]>;
}

export function createPgSessionTagDataAccess(): SessionTagDataAccess {
  return {
    async add(orgId, sessionId, tag) {
      const res = await pgPool.query(
        `INSERT INTO session_tags (session_id, org_id, tag)
         VALUES ($1, $2, $3)
         ON CONFLICT (session_id, tag) DO UPDATE SET tag = EXCLUDED.tag
         RETURNING *`,
        [sessionId, orgId, tag],
      );
      return toTag(res.rows[0]);
    },
    async remove(orgId, sessionId, tag) {
      const res = await pgPool.query(
        `DELETE FROM session_tags WHERE session_id = $1 AND org_id = $2 AND tag = $3`,
        [sessionId, orgId, tag],
      );
      return (res.rowCount ?? 0) > 0;
    },
    async listForSession(orgId, sessionId) {
      const res = await pgPool.query(
        `SELECT * FROM session_tags WHERE session_id = $1 AND org_id = $2
         ORDER BY tag ASC`,
        [sessionId, orgId],
      );
      return res.rows.map(toTag);
    },
  };
}
