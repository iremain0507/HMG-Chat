// db/artifact-data-access.ts — db/artifact-service.ts 의 ArtifactDataAccess pg 구현체
// (db/upload-data-access.ts 와 동일 패턴). dev/test DATABASE_URL role 은 superuser 라
// RLS(0006_artifacts_revisions.sql)를 우회한다 — artifact-service.ts 가 application 레벨에서
// 생성자 격리(existence-leak 방지)를 강제한다.
import type { ArtifactRecord } from "@wchat/interfaces";
import type { ArtifactDataAccess } from "./artifact-service.js";
import { pgPool } from "./client.js";

function toArtifact(row: Record<string, unknown>): ArtifactRecord {
  return {
    id: row.id as string,
    sessionId: (row.session_id as string | null) ?? null,
    createdBy: row.created_by as string,
    type: row.type as ArtifactRecord["type"],
    filename: row.filename as string,
    mimeType: (row.mime_type as string | null) ?? null,
    sizeBytes: Number(row.size_bytes),
    storageKind: row.storage_kind as ArtifactRecord["storageKind"],
    s3Key: (row.s3_key as string | null) ?? null,
    inlineContent: (row.inline_content as Buffer | null) ?? null,
    sharedAt: (row.shared_at as Date | null) ?? null,
    createdAt: row.created_at as Date,
  };
}

export function createPgArtifactDataAccess(): ArtifactDataAccess {
  return {
    artifacts: {
      async insert(data) {
        const res = await pgPool.query(
          `INSERT INTO artifacts (session_id, created_by, type, filename, mime_type, size_bytes, s3_key, storage_kind, inline_content, shared_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING *`,
          [
            data.sessionId ?? null,
            data.createdBy,
            data.type,
            data.filename,
            data.mimeType ?? null,
            data.sizeBytes,
            data.s3Key ?? null,
            data.storageKind,
            data.inlineContent ?? null,
            data.sharedAt ?? null,
          ],
        );
        return toArtifact(res.rows[0]);
      },
      async bulkInsert(rows) {
        const results: ArtifactRecord[] = [];
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
          ["sessionId", "session_id"],
          ["s3Key", "s3_key"],
          ["sharedAt", "shared_at"],
        ] as const) {
          if (key in data) {
            fields.push(`${col} = $${i}`);
            values.push((data as Record<string, unknown>)[key]);
            i++;
          }
        }
        values.push(id);
        const res = await pgPool.query(
          `UPDATE artifacts SET ${fields.join(", ")} WHERE id = $${i} RETURNING *`,
          values,
        );
        return toArtifact(res.rows[0]);
      },
      async delete(id) {
        await pgPool.query("DELETE FROM artifacts WHERE id = $1", [id]);
      },
      async byId(id) {
        const res = await pgPool.query(
          "SELECT * FROM artifacts WHERE id = $1",
          [id],
        );
        return res.rows[0] ? toArtifact(res.rows[0]) : null;
      },
      async list(filter, pagination) {
        const conditions: string[] = [];
        const values: unknown[] = [];
        let i = 1;
        if (filter?.sessionId) {
          conditions.push(`session_id = $${i}`);
          values.push(filter.sessionId);
          i++;
        }
        if (filter?.createdBy) {
          conditions.push(`created_by = $${i}`);
          values.push(filter.createdBy);
          i++;
        }
        const where = conditions.length
          ? `WHERE ${conditions.join(" AND ")}`
          : "";
        const limit = pagination?.limit ?? 50;
        values.push(limit);
        const res = await pgPool.query(
          `SELECT * FROM artifacts ${where} ORDER BY created_at DESC LIMIT $${i}`,
          values,
        );
        return { items: res.rows.map(toArtifact) };
      },
      // 보존정책 cron 전용 시스템 스코프 열거(P22-C-01 / C3). list() 와 달리 session/creator
      // 필터 없이 org 전체를 본다 — 호출자는 auth context 가 없는 retention job 뿐이다.
      // upload-data-access.ts:120 expiredOlderThan 와 동일 패턴.
      async expiredOlderThan(cutoff) {
        const res = await pgPool.query(
          "SELECT * FROM artifacts WHERE created_at < $1 ORDER BY created_at ASC",
          [cutoff],
        );
        return res.rows.map(toArtifact);
      },
    },
  };
}
