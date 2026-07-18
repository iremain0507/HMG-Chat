// db/note-data-access.ts — 0037_notes.sql 의 pg 구현체 (db/agent-data-access.ts 미러, P22-T6-17).
// 계약 승인 C7: Note / NoteRepo 는 packages/interfaces 단일 출처(FROZEN 화이트리스트 범위).
// dev/test DATABASE_URL role 은 superuser 라 RLS(0037)를 우회한다 —
//   org 경계와 소유자(userId) 경계는 routes/notes.ts 가 application 레벨에서 강제한다
//   (404 existence-leak 방지).
import type { DataAccess, Note } from "@wchat/interfaces";
import { pgPool } from "./client.js";

export type NoteDataAccess = Pick<DataAccess, "notes">;

function toNote(row: Record<string, unknown>): Note {
  return {
    id: row.id as string,
    orgId: row.org_id as string,
    userId: row.user_id as string,
    title: row.title as string,
    content: row.content as string,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
}

export function createPgNoteDataAccess(): NoteDataAccess {
  return {
    notes: {
      async insert(data) {
        const res = await pgPool.query(
          `INSERT INTO notes (org_id, user_id, title, content)
           VALUES ($1, $2, $3, $4)
           RETURNING *`,
          [data.orgId, data.userId, data.title ?? "", data.content ?? ""],
        );
        return toNote(res.rows[0]);
      },
      async bulkInsert(rows) {
        const results: Note[] = [];
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
          ["title", "title"],
          ["content", "content"],
        ] as const) {
          if (key in data) {
            fields.push(`${col} = $${i}`);
            values.push((data as Record<string, unknown>)[key]);
            i++;
          }
        }
        fields.push("updated_at = NOW()");
        values.push(id);
        const res = await pgPool.query(
          `UPDATE notes SET ${fields.join(", ")} WHERE id = $${i} RETURNING *`,
          values,
        );
        return toNote(res.rows[0]);
      },
      async delete(id) {
        await pgPool.query("DELETE FROM notes WHERE id = $1", [id]);
      },
      async byId(id) {
        const res = await pgPool.query("SELECT * FROM notes WHERE id = $1", [
          id,
        ]);
        return res.rows[0] ? toNote(res.rows[0]) : null;
      },
      async list(filter, pagination) {
        const conditions: string[] = [];
        const values: unknown[] = [];
        let i = 1;
        if (filter?.orgId) {
          conditions.push(`org_id = $${i}`);
          values.push(filter.orgId);
          i++;
        }
        if (filter?.userId) {
          conditions.push(`user_id = $${i}`);
          values.push(filter.userId);
          i++;
        }
        const where = conditions.length
          ? `WHERE ${conditions.join(" AND ")}`
          : "";
        const limit = pagination?.limit ?? 100;
        values.push(limit);
        const res = await pgPool.query(
          `SELECT * FROM notes ${where} ORDER BY updated_at DESC LIMIT $${i}`,
          values,
        );
        return { items: res.rows.map(toNote) };
      },
    },
  };
}
