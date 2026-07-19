// db/agent-data-access.ts — 0034_agents.sql 의 pg 구현체 (db/mcp-server-data-access.ts 미러, P22-T6-10).
// 계약 승인 C5: Agent / AgentRepo 는 packages/interfaces 단일 출처(FROZEN 화이트리스트 범위).
// dev/test DATABASE_URL role 은 superuser 라 RLS(0034)를 우회한다 —
//   org 경계(다른 org 조회 차단)는 routes/agents.ts 가 application 레벨에서 강제한다(404 existence-leak 방지).
import type { Agent, DataAccess } from "@wchat/interfaces";
import { pgPool } from "./client.js";

export type AgentDataAccess = Pick<DataAccess, "agents">;

function toAgent(row: Record<string, unknown>): Agent {
  return {
    id: row.id as string,
    orgId: row.org_id as string,
    name: row.name as string,
    description: (row.description as string | null) ?? null,
    baseModel: row.base_model as string,
    systemPrompt: (row.system_prompt as string | null) ?? null,
    toolIds: (row.tool_ids as string[]) ?? [],
    skillIds: (row.skill_ids as string[]) ?? [],
    projectIds: (row.project_ids as string[]) ?? [],
    visibility: row.visibility as Agent["visibility"],
    createdBy: row.created_by as string,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
}

export function createPgAgentDataAccess(): AgentDataAccess {
  return {
    agents: {
      async insert(data) {
        const res = await pgPool.query(
          `INSERT INTO agents
             (org_id, name, description, base_model, system_prompt,
              tool_ids, skill_ids, project_ids, visibility, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING *`,
          [
            data.orgId,
            data.name,
            data.description ?? null,
            data.baseModel,
            data.systemPrompt ?? null,
            data.toolIds ?? [],
            data.skillIds ?? [],
            data.projectIds ?? [],
            data.visibility ?? "private",
            data.createdBy,
          ],
        );
        return toAgent(res.rows[0]);
      },
      async bulkInsert(rows) {
        const results: Agent[] = [];
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
          ["name", "name"],
          ["description", "description"],
          ["baseModel", "base_model"],
          ["systemPrompt", "system_prompt"],
          ["toolIds", "tool_ids"],
          ["skillIds", "skill_ids"],
          ["projectIds", "project_ids"],
          ["visibility", "visibility"],
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
          `UPDATE agents SET ${fields.join(", ")} WHERE id = $${i} RETURNING *`,
          values,
        );
        return toAgent(res.rows[0]);
      },
      async delete(id) {
        await pgPool.query("DELETE FROM agents WHERE id = $1", [id]);
      },
      async byId(id) {
        const res = await pgPool.query("SELECT * FROM agents WHERE id = $1", [
          id,
        ]);
        return res.rows[0] ? toAgent(res.rows[0]) : null;
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
        if (filter?.createdBy) {
          conditions.push(`created_by = $${i}`);
          values.push(filter.createdBy);
          i++;
        }
        if (filter?.visibility) {
          conditions.push(`visibility = $${i}`);
          values.push(filter.visibility);
          i++;
        }
        const where = conditions.length
          ? `WHERE ${conditions.join(" AND ")}`
          : "";
        const limit = pagination?.limit ?? 100;
        values.push(limit);
        const res = await pgPool.query(
          `SELECT * FROM agents ${where} ORDER BY updated_at DESC LIMIT $${i}`,
          values,
        );
        return { items: res.rows.map(toAgent) };
      },
    },
  };
}
