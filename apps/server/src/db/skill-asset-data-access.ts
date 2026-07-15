// db/skill-asset-data-access.ts — 06-DATA-MODEL.md § 0009_mcp_servers_skills.sql +
// 14-INTERFACES.md SkillAssetRepo 의 pg 구현체 (mcp-server-data-access.ts 와 동일 패턴).
// composite PK(skill_id, filename) — byId(id)/delete(id) 대신 byKey/deleteByKey 사용.
// skill_assets_read_anyone RLS(0009) 는 공개 읽기이므로 scope 격리 불필요.
import type { DataAccess, SkillAssetRecord } from "@wchat/interfaces";
import { pgPool } from "./client.js";

export type SkillAssetDataAccess = Pick<DataAccess, "skillAssets">;

function toSkillAsset(row: Record<string, unknown>): SkillAssetRecord {
  return {
    skillId: row.skill_id as string,
    filename: row.filename as string,
    contentType: (row.content_type as string | null) ?? null,
    sizeBytes: Number(row.size_bytes),
    s3Key: row.s3_key as string,
    createdAt: row.created_at as Date,
  };
}

export function createPgSkillAssetDataAccess(): SkillAssetDataAccess {
  return {
    skillAssets: {
      async insert(data) {
        const res = await pgPool.query(
          `INSERT INTO skill_assets (skill_id, filename, content_type, size_bytes, s3_key)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING *`,
          [
            data.skillId,
            data.filename,
            data.contentType ?? null,
            data.sizeBytes,
            data.s3Key,
          ],
        );
        return toSkillAsset(res.rows[0]);
      },
      async bulkInsert(rows) {
        const results: SkillAssetRecord[] = [];
        for (const row of rows) {
          results.push(await this.insert(row));
        }
        return results;
      },
      async byKey(skillId, filename) {
        const res = await pgPool.query(
          "SELECT * FROM skill_assets WHERE skill_id = $1 AND filename = $2",
          [skillId, filename],
        );
        return res.rows[0] ? toSkillAsset(res.rows[0]) : null;
      },
      async bySkill(skillId) {
        const res = await pgPool.query(
          "SELECT * FROM skill_assets WHERE skill_id = $1 ORDER BY filename",
          [skillId],
        );
        return res.rows.map(toSkillAsset);
      },
      async deleteByKey(skillId, filename) {
        await pgPool.query(
          "DELETE FROM skill_assets WHERE skill_id = $1 AND filename = $2",
          [skillId, filename],
        );
      },
      async deleteBySkill(skillId) {
        const res = await pgPool.query(
          "DELETE FROM skill_assets WHERE skill_id = $1",
          [skillId],
        );
        return res.rowCount ?? 0;
      },
      async list(filter, pagination) {
        const conditions: string[] = [];
        const values: unknown[] = [];
        let i = 1;
        if (filter?.skillId) {
          conditions.push(`skill_id = $${i}`);
          values.push(filter.skillId);
          i++;
        }
        const where = conditions.length
          ? `WHERE ${conditions.join(" AND ")}`
          : "";
        const limit = pagination?.limit ?? 50;
        values.push(limit);
        const res = await pgPool.query(
          `SELECT * FROM skill_assets ${where} ORDER BY created_at DESC LIMIT $${i}`,
          values,
        );
        return { items: res.rows.map(toSkillAsset) };
      },
    },
  };
}
