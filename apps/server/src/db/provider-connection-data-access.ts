// db/provider-connection-data-access.ts — 0035_provider_connections.sql 의 pg 구현체
// (db/agent-data-access.ts 미러, P22-T6-14, 계약 승인 C6).
//
// 비밀 취급 규칙: SELECT * 를 쓰지 않고 컬럼을 명시해 api_key_encrypted 가 실수로 DTO 에
//   흘러들지 않게 한다. 복호화 경로는 secretById() 하나뿐이다.
// dev/test DATABASE_URL role 은 superuser 라 RLS(0035)를 우회한다 —
//   org 경계는 routes/connections.ts 가 application 레벨에서 강제한다(404 existence-leak 방지).
import type { DataAccess, ProviderConnection } from "@wchat/interfaces";
import { pgPool } from "./client.js";
import type { KekProvider } from "../lib/kek-provider.js";

export type ProviderConnectionDataAccess = Pick<
  DataAccess,
  "providerConnections"
>;

// api_key_encrypted 제외 — DTO 로 나갈 수 있는 컬럼만.
const COLUMNS = `id, org_id, name, kind, base_url, key_prefix, enabled,
                 verified_at, models, created_by, created_at, updated_at`;

/** 표시용 마스킹: 앞 6자만 남긴다(api_keys 마스킹 미러). */
export function keyPrefixOf(apiKey: string): string {
  return `${apiKey.slice(0, 6)}…`;
}

function toConnection(row: Record<string, unknown>): ProviderConnection {
  return {
    id: row.id as string,
    orgId: row.org_id as string,
    name: row.name as string,
    kind: row.kind as ProviderConnection["kind"],
    baseUrl: row.base_url as string,
    keyPrefix: row.key_prefix as string,
    enabled: row.enabled as boolean,
    verifiedAt: (row.verified_at as Date | null) ?? null,
    models: (row.models as string[]) ?? [],
    createdBy: row.created_by as string,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
}

export function createPgProviderConnectionDataAccess(deps: {
  kek: KekProvider;
}): ProviderConnectionDataAccess {
  return {
    providerConnections: {
      async insertWithSecret(data, apiKey) {
        const sealed = await deps.kek.encrypt(apiKey);
        const res = await pgPool.query(
          `INSERT INTO provider_connections
             (org_id, name, kind, base_url, api_key_encrypted, key_prefix,
              enabled, models, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING ${COLUMNS}`,
          [
            data.orgId,
            data.name,
            data.kind,
            data.baseUrl,
            sealed,
            keyPrefixOf(apiKey),
            data.enabled,
            data.models ?? [],
            data.createdBy,
          ],
        );
        return toConnection(res.rows[0]);
      },
      async insert() {
        // 키 없는 연결은 존재할 수 없다(api_key_encrypted NOT NULL) — 계약상 사용 금지.
        throw new Error(
          "provider_connections 는 insertWithSecret(data, apiKey) 로만 생성합니다.",
        );
      },
      async bulkInsert() {
        throw new Error(
          "provider_connections 는 bulkInsert 를 지원하지 않습니다.",
        );
      },
      async update(id, data) {
        const fields: string[] = [];
        const values: unknown[] = [];
        let i = 1;
        for (const [key, col] of [
          ["name", "name"],
          ["baseUrl", "base_url"],
          ["enabled", "enabled"],
          ["models", "models"],
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
          `UPDATE provider_connections SET ${fields.join(", ")}
           WHERE id = $${i} RETURNING ${COLUMNS}`,
          values,
        );
        return toConnection(res.rows[0]);
      },
      async updateSecret(id, apiKey) {
        const sealed = await deps.kek.encrypt(apiKey);
        await pgPool.query(
          `UPDATE provider_connections
             SET api_key_encrypted = $1, key_prefix = $2, updated_at = NOW()
           WHERE id = $3`,
          [sealed, keyPrefixOf(apiKey), id],
        );
      },
      async secretById(id) {
        const res = await pgPool.query(
          "SELECT api_key_encrypted FROM provider_connections WHERE id = $1",
          [id],
        );
        const sealed = res.rows[0]?.api_key_encrypted as Buffer | undefined;
        return sealed ? await deps.kek.decrypt(sealed) : null;
      },
      async markVerified(id, verifiedAt) {
        await pgPool.query(
          "UPDATE provider_connections SET verified_at = $1, updated_at = NOW() WHERE id = $2",
          [verifiedAt, id],
        );
      },
      async delete(id) {
        await pgPool.query("DELETE FROM provider_connections WHERE id = $1", [
          id,
        ]);
      },
      async byId(id) {
        const res = await pgPool.query(
          `SELECT ${COLUMNS} FROM provider_connections WHERE id = $1`,
          [id],
        );
        return res.rows[0] ? toConnection(res.rows[0]) : null;
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
        if (filter?.enabled !== undefined) {
          conditions.push(`enabled = $${i}`);
          values.push(filter.enabled);
          i++;
        }
        const where = conditions.length
          ? `WHERE ${conditions.join(" AND ")}`
          : "";
        values.push(pagination?.limit ?? 100);
        const res = await pgPool.query(
          `SELECT ${COLUMNS} FROM provider_connections ${where}
           ORDER BY updated_at DESC LIMIT $${i}`,
          values,
        );
        return { items: res.rows.map(toConnection) };
      },
    },
  };
}
