// db/message-data-access.ts — 14-INTERFACES.md § MessageRepo 의 pg 구현체
// (db/artifact-data-access.ts 와 동일 패턴). dev/test DATABASE_URL role 은 superuser 라
// RLS(0002_sessions_messages.sql)를 우회한다 — routes/messages.ts 가 sessionId 를 auth 로만
// 받아 application 레벨에서 격리한다(cross-org sessionId 는 애초에 조회되지 않음).
import type { Message } from "@wchat/interfaces";
import type { MessageRepo } from "@wchat/interfaces";
import { pgPool } from "./client.js";

function toMessage(row: Record<string, unknown>): Message {
  return {
    id: row.id as string,
    sessionId: row.session_id as string,
    role: row.role as Message["role"],
    content: row.content,
    toolCallIds: (row.tool_call_ids as string[] | null) ?? [],
    parentMessageId: (row.parent_message_id as string | null) ?? null,
    tokensIn: (row.tokens_in as number | null) ?? null,
    tokensOut: (row.tokens_out as number | null) ?? null,
    costMicros: (row.cost_micros as number | null) ?? null,
    createdAt: row.created_at as Date,
  };
}

/** deleteOlderThan 1배치당 삭제 상한 — 긴 락을 피하려고 나눠 지운다(부록 H 3번). */
const MESSAGE_PURGE_BATCH = 1000;

export function createPgMessageDataAccess(): MessageRepo {
  return {
    async insert(data) {
      const res = await pgPool.query(
        `INSERT INTO messages (session_id, role, content, tool_call_ids, parent_message_id, tokens_in, tokens_out, cost_micros)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          data.sessionId,
          data.role,
          JSON.stringify(data.content ?? null),
          data.toolCallIds ?? null,
          data.parentMessageId ?? null,
          data.tokensIn ?? null,
          data.tokensOut ?? null,
          data.costMicros ?? null,
        ],
      );
      return toMessage(res.rows[0]);
    },
    async bulkInsert(rows) {
      const results: Message[] = [];
      for (const row of rows) {
        results.push(await this.insert(row));
      }
      return results;
    },
    async update(id, data) {
      const fields: string[] = [];
      const values: unknown[] = [];
      let i = 1;
      for (const [key, col] of [
        ["content", "content"],
        ["toolCallIds", "tool_call_ids"],
        ["tokensIn", "tokens_in"],
        ["tokensOut", "tokens_out"],
        ["costMicros", "cost_micros"],
      ] as const) {
        if (key in data) {
          const value = (data as Record<string, unknown>)[key];
          fields.push(`${col} = $${i}`);
          values.push(key === "content" ? JSON.stringify(value) : value);
          i++;
        }
      }
      values.push(id);
      const res = await pgPool.query(
        `UPDATE messages SET ${fields.join(", ")} WHERE id = $${i} RETURNING *`,
        values,
      );
      return toMessage(res.rows[0]);
    },
    async delete(id) {
      await pgPool.query("DELETE FROM messages WHERE id = $1", [id]);
    },
    async byId(id) {
      const res = await pgPool.query("SELECT * FROM messages WHERE id = $1", [
        id,
      ]);
      return res.rows[0] ? toMessage(res.rows[0]) : null;
    },
    async list(filter, pagination) {
      const conditions: string[] = [`session_id = $1`];
      const values: unknown[] = [filter?.sessionId];
      let i = 2;
      if (filter?.role) {
        conditions.push(`role = $${i}`);
        values.push(filter.role);
        i++;
      }
      const limit = pagination?.limit ?? 100;
      values.push(limit);
      const res = await pgPool.query(
        `SELECT * FROM messages WHERE ${conditions.join(" AND ")} ORDER BY created_at ASC LIMIT $${i}`,
        values,
      );
      return { items: res.rows.map(toMessage) };
    },
    async appendStream(sessionId, role, chunks) {
      const collected: unknown[] = [];
      for await (const chunk of chunks) {
        collected.push(chunk);
      }
      return this.insert({ sessionId, role, content: collected });
    },
    // 부록 H 3번 — org 보존정책 cron 전용 벌크 삭제. orgId 생략 시 전 org(시스템 스코프).
    // 한 틱에 무제한 DELETE 를 돌면 장시간 락이 잡히므로 배치 상한(MESSAGE_PURGE_BATCH)을 두고
    // 더 지울 게 없을 때까지 반복한다(각 배치가 독립 트랜잭션 → 중단돼도 다음 실행이 이어받음).
    async deleteOlderThan(cutoff, orgId) {
      let total = 0;
      for (;;) {
        const res = await pgPool.query(
          `DELETE FROM messages WHERE id IN (
             SELECT m.id FROM messages m
             JOIN sessions s ON s.id = m.session_id
             JOIN users u ON u.id = s.user_id
             WHERE m.created_at < $1${orgId ? " AND u.org_id = $3" : ""}
             LIMIT $2
           )`,
          orgId
            ? [cutoff, MESSAGE_PURGE_BATCH, orgId]
            : [cutoff, MESSAGE_PURGE_BATCH],
        );
        const deleted = res.rowCount ?? 0;
        total += deleted;
        if (deleted < MESSAGE_PURGE_BATCH) break;
      }
      return total;
    },
  };
}
