// db/message-feedback-data-access.ts — routes/sessions.ts MessageFeedbackPort(P19-T1-07)의
// pg 구현. dev/test DATABASE_URL role 은 superuser 라 RLS(0023_message_feedback.sql)를
// 우회한다 — org_id = $1 조건으로 application 레벨 방어선을 만든다(session-tag-data-access.ts
// 와 동일 사유). 메시지 자체의 ownership(요청자 소유 세션인지)은 routes/sessions.ts 가
// sessions.byId + messages.byId 로 먼저 검증한다.
import { pgPool } from "./client.js";

export interface MessageFeedback {
  messageId: string;
  userId: string;
  orgId: string;
  rating: 1 | -1;
}

function toFeedback(row: Record<string, unknown>): MessageFeedback {
  return {
    messageId: row.message_id as string,
    userId: row.user_id as string,
    orgId: row.org_id as string,
    rating: row.rating as 1 | -1,
  };
}

export interface MessageFeedbackDataAccess {
  upsert(
    orgId: string,
    messageId: string,
    userId: string,
    rating: 1 | -1,
  ): Promise<MessageFeedback>;
  remove(orgId: string, messageId: string, userId: string): Promise<boolean>;
  get(
    orgId: string,
    messageId: string,
    userId: string,
  ): Promise<MessageFeedback | null>;
}

export function createPgMessageFeedbackDataAccess(): MessageFeedbackDataAccess {
  return {
    async upsert(orgId, messageId, userId, rating) {
      const res = await pgPool.query(
        `INSERT INTO message_feedback (message_id, user_id, org_id, rating)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (message_id, user_id) DO UPDATE SET rating = EXCLUDED.rating
         RETURNING *`,
        [messageId, userId, orgId, rating],
      );
      return toFeedback(res.rows[0]);
    },
    async remove(orgId, messageId, userId) {
      const res = await pgPool.query(
        `DELETE FROM message_feedback WHERE message_id = $1 AND user_id = $2 AND org_id = $3`,
        [messageId, userId, orgId],
      );
      return (res.rowCount ?? 0) > 0;
    },
    async get(orgId, messageId, userId) {
      const res = await pgPool.query(
        `SELECT * FROM message_feedback WHERE message_id = $1 AND user_id = $2 AND org_id = $3`,
        [messageId, userId, orgId],
      );
      return res.rows[0] ? toFeedback(res.rows[0]) : null;
    },
  };
}
