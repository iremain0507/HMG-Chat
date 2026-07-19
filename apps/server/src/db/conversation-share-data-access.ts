// db/conversation-share-data-access.ts — db/conversation-share-service.ts 의
// ConversationSharesDataAccess pg 구현체(db/artifact-share-data-access.ts 와 동일 패턴).
// dev/test DATABASE_URL role 은 superuser 라 RLS(0030_conversation_shares.sql)를 우회한다 —
// conversation-share-service.ts 가 application 레벨에서 발급자 격리를 강제한다.
import type {
  ConversationShareRecord,
  ConversationSharesDataAccess,
} from "./conversation-share-service.js";
import { pgPool } from "./client.js";

function toConversationShare(
  row: Record<string, unknown>,
): ConversationShareRecord {
  return {
    id: row.id as string,
    orgId: row.org_id as string,
    sessionId: row.session_id as string,
    createdBy: row.created_by as string,
    snapshot: row.snapshot as ConversationShareRecord["snapshot"],
    token: row.token as string,
    expiresAt: (row.expires_at as Date | null) ?? null,
    revokedAt: (row.revoked_at as Date | null) ?? null,
    createdAt: row.created_at as Date,
  };
}

export function createPgConversationShareDataAccess(): ConversationSharesDataAccess {
  return {
    conversationShares: {
      async insert(data) {
        const res = await pgPool.query(
          `INSERT INTO conversation_shares (org_id, session_id, created_by, snapshot, expires_at)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING *`,
          [
            data.orgId,
            data.sessionId,
            data.createdBy,
            JSON.stringify(data.snapshot),
            data.expiresAt ?? null,
          ],
        );
        return toConversationShare(res.rows[0]);
      },
      async byId(id) {
        const res = await pgPool.query(
          "SELECT * FROM conversation_shares WHERE id = $1",
          [id],
        );
        return res.rows[0] ? toConversationShare(res.rows[0]) : null;
      },
      async byToken(token) {
        const res = await pgPool.query(
          "SELECT * FROM conversation_shares WHERE token = $1",
          [token],
        );
        return res.rows[0] ? toConversationShare(res.rows[0]) : null;
      },
      async revoke(id) {
        await pgPool.query(
          "UPDATE conversation_shares SET revoked_at = NOW() WHERE id = $1",
          [id],
        );
      },
    },
  };
}
