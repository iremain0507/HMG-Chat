// db/artifact-share-data-access.ts — db/artifact-share-service.ts 의 ArtifactShareDataAccess pg
// 구현체 (db/artifact-data-access.ts 와 동일 패턴). dev/test DATABASE_URL role 은 superuser 라
// RLS(0007_artifact_shares.sql)를 우회한다 — artifact-share-service.ts 가 application 레벨에서
// 발급자 격리(existence-leak 방지)를 강제한다.
import type { ArtifactShareRecord } from "@wchat/interfaces";
import type { ArtifactShareDataAccess } from "./artifact-share-service.js";
import { pgPool } from "./client.js";

function toArtifactShare(row: Record<string, unknown>): ArtifactShareRecord {
  return {
    id: row.id as string,
    artifactId: row.artifact_id as string,
    token: row.token as string,
    issuedBy: row.issued_by as string,
    expiresAt: row.expires_at as Date,
    revokedAt: (row.revoked_at as Date | null) ?? null,
    viewCount: Number(row.view_count),
    createdAt: row.created_at as Date,
  };
}

export function createPgArtifactShareDataAccess(): ArtifactShareDataAccess {
  return {
    artifactShares: {
      async insert(data) {
        const res = await pgPool.query(
          `INSERT INTO artifact_shares (artifact_id, issued_by, expires_at, revoked_at, view_count)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING *`,
          [
            data.artifactId,
            data.issuedBy,
            data.expiresAt,
            data.revokedAt ?? null,
            data.viewCount ?? 0,
          ],
        );
        return toArtifactShare(res.rows[0]);
      },
      async bulkInsert(rows) {
        const results: ArtifactShareRecord[] = [];
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
          ["expiresAt", "expires_at"],
          ["revokedAt", "revoked_at"],
          ["viewCount", "view_count"],
        ] as const) {
          if (key in data) {
            fields.push(`${col} = $${i}`);
            values.push((data as Record<string, unknown>)[key]);
            i++;
          }
        }
        values.push(id);
        const res = await pgPool.query(
          `UPDATE artifact_shares SET ${fields.join(", ")} WHERE id = $${i} RETURNING *`,
          values,
        );
        return toArtifactShare(res.rows[0]);
      },
      async delete(id) {
        await pgPool.query("DELETE FROM artifact_shares WHERE id = $1", [id]);
      },
      async byId(id) {
        const res = await pgPool.query(
          "SELECT * FROM artifact_shares WHERE id = $1",
          [id],
        );
        return res.rows[0] ? toArtifactShare(res.rows[0]) : null;
      },
      async list(filter, pagination) {
        const conditions: string[] = [];
        const values: unknown[] = [];
        let i = 1;
        if (filter?.artifactId) {
          conditions.push(`artifact_id = $${i}`);
          values.push(filter.artifactId);
          i++;
        }
        if (filter?.tokenEq) {
          conditions.push(`token = $${i}`);
          values.push(filter.tokenEq);
          i++;
        }
        const where = conditions.length
          ? `WHERE ${conditions.join(" AND ")}`
          : "";
        const limit = pagination?.limit ?? 50;
        values.push(limit);
        const res = await pgPool.query(
          `SELECT * FROM artifact_shares ${where} ORDER BY created_at DESC LIMIT $${i}`,
          values,
        );
        return { items: res.rows.map(toArtifactShare) };
      },
      async byToken(token) {
        const res = await pgPool.query(
          "SELECT * FROM artifact_shares WHERE token = $1",
          [token],
        );
        return res.rows[0] ? toArtifactShare(res.rows[0]) : null;
      },
      async incrementViewCount(token) {
        await pgPool.query(
          "UPDATE artifact_shares SET view_count = view_count + 1 WHERE token = $1",
          [token],
        );
      },
      async revoke(id) {
        await pgPool.query(
          "UPDATE artifact_shares SET revoked_at = NOW() WHERE id = $1",
          [id],
        );
      },
    },
  };
}
