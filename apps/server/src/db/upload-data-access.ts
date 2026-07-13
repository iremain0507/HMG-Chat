// db/upload-data-access.ts — db/upload-service.ts 의 UploadDataAccess pg 구현체
// (db/project-data-access.ts 와 동일 패턴). dev/test DATABASE_URL role 은 superuser 라
// RLS(0014_uploads.sql)를 우회한다 — upload-service.ts 가 application 레벨에서 소유자 격리를 강제한다.
import type { UploadRecord } from "@wchat/interfaces";
import type { UploadDataAccess } from "./upload-service.js";
import { pgPool } from "./client.js";

function toUpload(row: Record<string, unknown>): UploadRecord {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    sessionId: (row.session_id as string | null) ?? null,
    filename: row.filename as string,
    mimeType: row.mime_type as string,
    sizeBytes: Number(row.size_bytes),
    s3Key: row.s3_key as string,
    sha256: row.sha256 as string,
    expiresAt: row.expires_at as Date,
    createdAt: row.created_at as Date,
  };
}

export function createPgUploadDataAccess(): UploadDataAccess {
  return {
    uploads: {
      async insert(data) {
        const res = await pgPool.query(
          `INSERT INTO uploads (user_id, session_id, filename, mime_type, size_bytes, s3_key, sha256, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING *`,
          [
            data.userId,
            data.sessionId ?? null,
            data.filename,
            data.mimeType,
            data.sizeBytes,
            data.s3Key,
            data.sha256,
            data.expiresAt,
          ],
        );
        return toUpload(res.rows[0]);
      },
      async bulkInsert(rows) {
        const results: UploadRecord[] = [];
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
          ["filename", "filename"],
          ["mimeType", "mime_type"],
          ["sessionId", "session_id"],
        ] as const) {
          if (key in data) {
            fields.push(`${col} = $${i}`);
            values.push((data as Record<string, unknown>)[key]);
            i++;
          }
        }
        values.push(id);
        const res = await pgPool.query(
          `UPDATE uploads SET ${fields.join(", ")} WHERE id = $${i} RETURNING *`,
          values,
        );
        return toUpload(res.rows[0]);
      },
      async delete(id) {
        await pgPool.query("DELETE FROM uploads WHERE id = $1", [id]);
      },
      async byId(id) {
        const res = await pgPool.query("SELECT * FROM uploads WHERE id = $1", [
          id,
        ]);
        return res.rows[0] ? toUpload(res.rows[0]) : null;
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
        if (filter?.sessionId !== undefined) {
          conditions.push(
            filter.sessionId === null
              ? "session_id IS NULL"
              : `session_id = $${i}`,
          );
          if (filter.sessionId !== null) {
            values.push(filter.sessionId);
            i++;
          }
        }
        const where = conditions.length
          ? `WHERE ${conditions.join(" AND ")}`
          : "";
        const limit = pagination?.limit ?? 50;
        values.push(limit);
        const res = await pgPool.query(
          `SELECT * FROM uploads ${where} ORDER BY created_at DESC LIMIT $${i}`,
          values,
        );
        return { items: res.rows.map(toUpload) };
      },
      async bySha256(userId, sha256) {
        const res = await pgPool.query(
          "SELECT * FROM uploads WHERE user_id = $1 AND sha256 = $2",
          [userId, sha256],
        );
        return res.rows[0] ? toUpload(res.rows[0]) : null;
      },
      async expiredOlderThan(cutoff) {
        const res = await pgPool.query(
          "SELECT * FROM uploads WHERE expires_at < $1",
          [cutoff],
        );
        return res.rows.map(toUpload);
      },
    },
  };
}
