// db/user-memory-data-access.ts — 06-DATA-MODEL.md § 0008_user_memories.sql + 14-INTERFACES.md
// UserMemoryRepo 의 pg 구현체 (artifact-share-data-access.ts 와 동일 패턴). dev/test DATABASE_URL
// role 은 superuser 라 RLS(0008_user_memories_locks.sql)를 우회한다 — 소유자 격리은 routes/memories.ts
// (T2, P7-T2-03) 가 application 레벨에서 강제한다.
import type { DataAccess, UserMemory } from "@wchat/interfaces";
import { pgPool } from "./client.js";

export type UserMemoryDataAccess = Pick<DataAccess, "userMemories">;

function toUserMemory(row: Record<string, unknown>): UserMemory {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    category: row.category as UserMemory["category"],
    content: row.content as string,
    source: row.source as UserMemory["source"],
    sessionId: (row.session_id as string | null) ?? null,
    pinned: row.pinned as boolean,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
}

export function createPgUserMemoryDataAccess(): UserMemoryDataAccess {
  return {
    userMemories: {
      async insert(data) {
        const res = await pgPool.query(
          `INSERT INTO user_memories (user_id, category, content, source, session_id, pinned, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING *`,
          [
            data.userId,
            data.category,
            data.content,
            data.source,
            data.sessionId ?? null,
            data.pinned ?? false,
            data.metadata ?? null,
          ],
        );
        return toUserMemory(res.rows[0]);
      },
      async bulkInsert(rows) {
        const results: UserMemory[] = [];
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
          ["category", "category"],
          ["content", "content"],
          ["source", "source"],
          ["sessionId", "session_id"],
          ["pinned", "pinned"],
          ["metadata", "metadata"],
        ] as const) {
          if (key in data) {
            fields.push(`${col} = $${i}`);
            values.push((data as Record<string, unknown>)[key]);
            i++;
          }
        }
        values.push(id);
        const res = await pgPool.query(
          `UPDATE user_memories SET ${fields.join(", ")} WHERE id = $${i} RETURNING *`,
          values,
        );
        return toUserMemory(res.rows[0]);
      },
      async delete(id) {
        await pgPool.query("DELETE FROM user_memories WHERE id = $1", [id]);
      },
      async byId(id) {
        const res = await pgPool.query(
          "SELECT * FROM user_memories WHERE id = $1",
          [id],
        );
        return res.rows[0] ? toUserMemory(res.rows[0]) : null;
      },
      async list(filter, pagination) {
        const conditions: string[] = [];
        const values: unknown[] = [];
        let i = 1;
        if (filter?.userId) {
          conditions.push(`user_id = $${i}`);
          values.push(filter.userId);
          i++;
        }
        if (filter?.category) {
          conditions.push(`category = $${i}`);
          values.push(filter.category);
          i++;
        }
        if (filter?.pinned !== undefined) {
          conditions.push(`pinned = $${i}`);
          values.push(filter.pinned);
          i++;
        }
        const where = conditions.length
          ? `WHERE ${conditions.join(" AND ")}`
          : "";
        const limit = pagination?.limit ?? 50;
        values.push(limit);
        const res = await pgPool.query(
          `SELECT * FROM user_memories ${where}
           ORDER BY pinned DESC, created_at DESC LIMIT $${i}`,
          values,
        );
        return { items: res.rows.map(toUserMemory) };
      },
      async pin(id, pinned) {
        await pgPool.query(
          "UPDATE user_memories SET pinned = $1 WHERE id = $2",
          [pinned, id],
        );
      },
    },
  };
}
