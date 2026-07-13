// db/mcp-server-data-access.ts — 06-DATA-MODEL.md § 0009_mcp_servers_skills.sql +
// 14-INTERFACES.md McpServerRepo 의 pg 구현체 (artifact-share-data-access.ts 와 동일 패턴).
// dev/test DATABASE_URL role 은 superuser 라 RLS(0009_mcp_servers_skill_assets.sql)를 우회한다 —
// scope 격리는 routes/mcp-servers.ts(T1, P8-T1-01) 가 application 레벨에서 강제한다.
import type { DataAccess, McpServerRecord } from "@wchat/interfaces";
import { pgPool } from "./client.js";

export type McpServerDataAccess = Pick<DataAccess, "mcpServers">;

function toMcpServer(row: Record<string, unknown>): McpServerRecord {
  return {
    id: row.id as string,
    orgId: row.org_id as string,
    projectId: (row.project_id as string | null) ?? null,
    userId: (row.user_id as string | null) ?? null,
    name: row.name as string,
    url: row.url as string,
    transport: row.transport as McpServerRecord["transport"],
    authHeaderName: (row.auth_header_name as string | null) ?? null,
    authSecretArn: (row.auth_secret_arn as string | null) ?? null,
    supportedTools:
      (row.supported_tools as McpServerRecord["supportedTools"]) ?? [],
    lastDiscoveredAt: (row.last_discovered_at as Date | null) ?? null,
    status: row.status as McpServerRecord["status"],
  };
}

export function createPgMcpServerDataAccess(): McpServerDataAccess {
  return {
    mcpServers: {
      async insert(data) {
        const res = await pgPool.query(
          `INSERT INTO mcp_servers
             (org_id, project_id, user_id, name, url, transport,
              auth_header_name, auth_secret_arn, supported_tools,
              last_discovered_at, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           RETURNING *`,
          [
            data.orgId,
            data.projectId ?? null,
            data.userId ?? null,
            data.name,
            data.url,
            data.transport,
            data.authHeaderName ?? null,
            data.authSecretArn ?? null,
            JSON.stringify(data.supportedTools ?? []),
            data.lastDiscoveredAt ?? null,
            data.status ?? "active",
          ],
        );
        return toMcpServer(res.rows[0]);
      },
      async bulkInsert(rows) {
        const results: McpServerRecord[] = [];
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
          ["projectId", "project_id"],
          ["userId", "user_id"],
          ["name", "name"],
          ["url", "url"],
          ["transport", "transport"],
          ["authHeaderName", "auth_header_name"],
          ["authSecretArn", "auth_secret_arn"],
          ["lastDiscoveredAt", "last_discovered_at"],
          ["status", "status"],
        ] as const) {
          if (key in data) {
            fields.push(`${col} = $${i}`);
            values.push((data as Record<string, unknown>)[key]);
            i++;
          }
        }
        if ("supportedTools" in data) {
          fields.push(`supported_tools = $${i}`);
          values.push(JSON.stringify(data.supportedTools));
          i++;
        }
        values.push(id);
        const res = await pgPool.query(
          `UPDATE mcp_servers SET ${fields.join(", ")} WHERE id = $${i} RETURNING *`,
          values,
        );
        return toMcpServer(res.rows[0]);
      },
      async delete(id) {
        await pgPool.query("DELETE FROM mcp_servers WHERE id = $1", [id]);
      },
      async byId(id) {
        const res = await pgPool.query(
          "SELECT * FROM mcp_servers WHERE id = $1",
          [id],
        );
        return res.rows[0] ? toMcpServer(res.rows[0]) : null;
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
        if (filter?.projectId !== undefined) {
          if (filter.projectId === null) {
            conditions.push("project_id IS NULL");
          } else {
            conditions.push(`project_id = $${i}`);
            values.push(filter.projectId);
            i++;
          }
        }
        if (filter?.userId !== undefined) {
          if (filter.userId === null) {
            conditions.push("user_id IS NULL");
          } else {
            conditions.push(`user_id = $${i}`);
            values.push(filter.userId);
            i++;
          }
        }
        const where = conditions.length
          ? `WHERE ${conditions.join(" AND ")}`
          : "";
        const limit = pagination?.limit ?? 50;
        values.push(limit);
        const res = await pgPool.query(
          `SELECT * FROM mcp_servers ${where} ORDER BY created_at DESC LIMIT $${i}`,
          values,
        );
        return { items: res.rows.map(toMcpServer) };
      },
      async updateDiscovery(id, supportedTools) {
        await pgPool.query(
          `UPDATE mcp_servers
           SET supported_tools = $1, last_discovered_at = NOW()
           WHERE id = $2`,
          [JSON.stringify(supportedTools), id],
        );
      },
    },
  };
}
