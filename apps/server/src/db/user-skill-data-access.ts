// db/user-skill-data-access.ts — 0038_user_skills.sql 의 pg 구현체 (db/agent-data-access.ts 미러, P22-T6-18).
// 계약 승인 C12: UserSkill / UserSkillStore 는 packages/interfaces 단일 출처(FROZEN 화이트리스트 범위).
// dev/test DATABASE_URL role 은 superuser 라 RLS(0038)를 우회한다 —
//   org 경계(다른 org 조회/변경 차단)는 routes/skills.ts 가 application 레벨에서 강제한다(404 existence-leak 방지).
import type { UserSkill, UserSkillStore } from "@wchat/interfaces";
import { pgPool } from "./client.js";

function toUserSkill(row: Record<string, unknown>): UserSkill {
  return {
    id: row.id as string,
    orgId: row.org_id as string,
    userId: row.user_id as string,
    name: row.name as string,
    version: row.version as string,
    skillMd: row.skill_md as string,
    enabled: row.enabled as boolean,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
}

export function createPgUserSkillStore(): UserSkillStore {
  return {
    async create(input) {
      const res = await pgPool.query(
        `INSERT INTO user_skills (org_id, user_id, name, version, skill_md)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [input.orgId, input.userId, input.name, input.version, input.skillMd],
      );
      return toUserSkill(res.rows[0]);
    },
    async update(id, input) {
      const fields: string[] = [];
      const values: unknown[] = [];
      let i = 1;
      for (const [key, col] of [
        ["skillMd", "skill_md"],
        ["name", "name"],
        ["version", "version"],
      ] as const) {
        if (input[key] !== undefined) {
          fields.push(`${col} = $${i}`);
          values.push(input[key]);
          i++;
        }
      }
      fields.push("updated_at = NOW()");
      values.push(id);
      const res = await pgPool.query(
        `UPDATE user_skills SET ${fields.join(", ")} WHERE id = $${i} RETURNING *`,
        values,
      );
      return toUserSkill(res.rows[0]);
    },
    async setEnabled(id, enabled) {
      await pgPool.query(
        "UPDATE user_skills SET enabled = $1, updated_at = NOW() WHERE id = $2",
        [enabled, id],
      );
    },
    async remove(id) {
      await pgPool.query("DELETE FROM user_skills WHERE id = $1", [id]);
    },
    async byId(id) {
      const res = await pgPool.query(
        "SELECT * FROM user_skills WHERE id = $1",
        [id],
      );
      return res.rows[0] ? toUserSkill(res.rows[0]) : null;
    },
    async list(scope) {
      const res = await pgPool.query(
        `SELECT * FROM user_skills
         WHERE org_id = $1 AND user_id = $2
         ORDER BY updated_at DESC`,
        [scope.orgId, scope.userId],
      );
      return res.rows.map(toUserSkill);
    },
  };
}
