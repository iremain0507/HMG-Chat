// db/openapi-tool-server-data-access.ts — 0032_openapi_tool_servers.sql 의 pg 구현체
// (db/mcp-server-data-access.ts 미러, P22-T1-12).
// 계약 승인 C13: packages/interfaces 는 변경하지 않는다 — AgentToolSpec 은 이미 충분하므로
//   레코드 타입/Repo 계약을 이 모듈 로컬에 둔다(FROZEN 회피, apps/server/src/lib/*-schema.ts 관례와 동일).
// dev/test DATABASE_URL role 은 superuser 라 RLS(0032)를 우회한다 —
//   org 경계는 routes/openapi-tool-servers.ts 가 application 레벨에서 강제한다(404 existence-leak 방지).
import type { AgentToolSpec } from "@wchat/interfaces";
import type { OpenApiOperation } from "../tools/openapi-tool-adapter.js";
import { pgPool } from "./client.js";

export interface OpenApiToolServerRecord {
  id: string;
  orgId: string;
  projectId: string | null;
  userId: string | null;
  name: string;
  /** OpenAPI 문서를 가져올 URL (SSRF 검증 대상). */
  specUrl: string;
  /** 실제 endpoint 호출의 base URL (spec 의 servers[0] 또는 등록자가 지정, SSRF 검증 대상). */
  baseUrl: string;
  authHeaderName: string | null;
  authSecretArn: string | null;
  /** discover 결과 캐시 — orchestrator 가 재파싱 없이 조립할 수 있게 spec 을 통째로 보관. */
  supportedTools: AgentToolSpec[];
  /** 같은 discover 시점의 operation 메타(method/path/parameters) — 호출 시 요청 조립용. */
  operations: OpenApiOperation[];
  lastDiscoveredAt: Date | null;
  status: "active" | "disabled";
}

export type OpenApiToolServerInsert = Omit<OpenApiToolServerRecord, "id">;

export interface OpenApiToolServerRepo {
  insert(data: OpenApiToolServerInsert): Promise<OpenApiToolServerRecord>;
  byId(id: string): Promise<OpenApiToolServerRecord | null>;
  list(filter: {
    orgId: string;
    projectId?: string;
    userId?: string;
  }): Promise<{ items: OpenApiToolServerRecord[] }>;
  updateDiscovery(
    id: string,
    supportedTools: AgentToolSpec[],
    operations: OpenApiOperation[],
  ): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface OpenApiToolServerDataAccess {
  openApiToolServers: OpenApiToolServerRepo;
}

export function toOpenApiToolServer(
  row: Record<string, unknown>,
): OpenApiToolServerRecord {
  return {
    id: row.id as string,
    orgId: row.org_id as string,
    projectId: (row.project_id as string | null) ?? null,
    userId: (row.user_id as string | null) ?? null,
    name: row.name as string,
    specUrl: row.spec_url as string,
    baseUrl: row.base_url as string,
    authHeaderName: (row.auth_header_name as string | null) ?? null,
    authSecretArn: (row.auth_secret_arn as string | null) ?? null,
    supportedTools: (row.supported_tools as AgentToolSpec[] | null) ?? [],
    operations: (row.operations as OpenApiOperation[] | null) ?? [],
    lastDiscoveredAt: (row.last_discovered_at as Date | null) ?? null,
    status: row.status as OpenApiToolServerRecord["status"],
  };
}

export function createPgOpenApiToolServerDataAccess(): OpenApiToolServerDataAccess {
  return {
    openApiToolServers: {
      async insert(data) {
        const res = await pgPool.query(
          `INSERT INTO openapi_tool_servers
             (org_id, project_id, user_id, name, spec_url, base_url,
              auth_header_name, auth_secret_arn, supported_tools, operations,
              last_discovered_at, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           RETURNING *`,
          [
            data.orgId,
            data.projectId,
            data.userId,
            data.name,
            data.specUrl,
            data.baseUrl,
            data.authHeaderName,
            data.authSecretArn,
            JSON.stringify(data.supportedTools ?? []),
            JSON.stringify(data.operations ?? []),
            data.lastDiscoveredAt,
            data.status,
          ],
        );
        return toOpenApiToolServer(res.rows[0]);
      },
      async byId(id) {
        const res = await pgPool.query(
          "SELECT * FROM openapi_tool_servers WHERE id = $1",
          [id],
        );
        return res.rows[0] ? toOpenApiToolServer(res.rows[0]) : null;
      },
      async list(filter) {
        const conditions = ["org_id = $1"];
        const values: unknown[] = [filter.orgId];
        let i = 2;
        if (filter.projectId !== undefined) {
          conditions.push(`project_id = $${i}`);
          values.push(filter.projectId);
          i++;
        }
        if (filter.userId !== undefined) {
          conditions.push(`user_id = $${i}`);
          values.push(filter.userId);
          i++;
        }
        const res = await pgPool.query(
          `SELECT * FROM openapi_tool_servers
           WHERE ${conditions.join(" AND ")}
           ORDER BY created_at DESC`,
          values,
        );
        return { items: res.rows.map(toOpenApiToolServer) };
      },
      async updateDiscovery(id, supportedTools, operations) {
        await pgPool.query(
          `UPDATE openapi_tool_servers
           SET supported_tools = $1, operations = $2, last_discovered_at = NOW()
           WHERE id = $3`,
          [JSON.stringify(supportedTools), JSON.stringify(operations), id],
        );
      },
      async delete(id) {
        await pgPool.query("DELETE FROM openapi_tool_servers WHERE id = $1", [
          id,
        ]);
      },
    },
  };
}
