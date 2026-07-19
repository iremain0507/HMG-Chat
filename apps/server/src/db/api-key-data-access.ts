// db/api-key-data-access.ts — routes/api-keys.ts(P19-T1-11) + middleware/auth-middleware.ts
// (Bearer 인증)이 공유하는 api_keys(migration 0025) pg 구현. 평문 키는 저장하지 않는다 —
// key_hash(sha256 hex, routes/auth.ts hashToken 과 동일 패턴)만 저장, key_prefix 는 목록
// 마스킹 표시용. dev/test DATABASE_URL role 은 superuser 라 RLS 를 우회하므로, user 단위
// self-service 격리(본인 키만 조회/폐기)는 application 레벨(WHERE user_id=$)에서 강제한다
// (prompts private access 와 동일한 이중 방어 패턴).
import { randomBytes, createHash } from "node:crypto";
import { pgPool } from "./client.js";

export interface ApiKey {
  id: string;
  orgId: string;
  userId: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface ApiKeyAuth {
  id: string;
  orgId: string;
  userId: string;
  role: "member" | "admin" | "owner";
  scopes: string[];
}

function toApiKey(row: Record<string, unknown>): ApiKey {
  return {
    id: row.id as string,
    orgId: row.org_id as string,
    userId: row.user_id as string,
    name: row.name as string,
    keyPrefix: row.key_prefix as string,
    scopes: (row.scopes as string[]) ?? [],
    lastUsedAt: (row.last_used_at as Date | null) ?? null,
    revokedAt: (row.revoked_at as Date | null) ?? null,
    createdAt: row.created_at as Date,
  };
}

export function hashApiKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

export function generateApiKey(): { rawKey: string; keyPrefix: string } {
  const secret = randomBytes(24).toString("base64url");
  const rawKey = `wchat_sk_${secret}`;
  return { rawKey, keyPrefix: rawKey.slice(0, 14) };
}

export interface ApiKeyDataAccess {
  create(
    orgId: string,
    userId: string,
    input: { name: string; scopes: string[] },
  ): Promise<{ key: ApiKey; rawKey: string }>;
  listForOwner(orgId: string, userId: string): Promise<ApiKey[]>;
  revokeForOwner(orgId: string, userId: string, id: string): Promise<boolean>;
  findActiveByRawKey(rawKey: string): Promise<ApiKeyAuth | null>;
  touchLastUsed(id: string): Promise<void>;
}

export function createPgApiKeyDataAccess(): ApiKeyDataAccess {
  return {
    async create(orgId, userId, input) {
      const { rawKey, keyPrefix } = generateApiKey();
      const keyHash = hashApiKey(rawKey);
      const res = await pgPool.query(
        `INSERT INTO api_keys (org_id, user_id, name, key_hash, key_prefix, scopes)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [orgId, userId, input.name, keyHash, keyPrefix, input.scopes],
      );
      return { key: toApiKey(res.rows[0]), rawKey };
    },
    async listForOwner(orgId, userId) {
      const res = await pgPool.query(
        `SELECT * FROM api_keys WHERE org_id = $1 AND user_id = $2 ORDER BY created_at ASC`,
        [orgId, userId],
      );
      return res.rows.map(toApiKey);
    },
    async revokeForOwner(orgId, userId, id) {
      const res = await pgPool.query(
        `UPDATE api_keys SET revoked_at = NOW()
         WHERE id = $1 AND org_id = $2 AND user_id = $3 AND revoked_at IS NULL`,
        [id, orgId, userId],
      );
      return (res.rowCount ?? 0) > 0;
    },
    async findActiveByRawKey(rawKey) {
      const keyHash = hashApiKey(rawKey);
      const res = await pgPool.query(
        `SELECT ak.id, ak.org_id, ak.user_id, ak.scopes, u.role
         FROM api_keys ak
         JOIN users u ON u.id = ak.user_id
         WHERE ak.key_hash = $1 AND ak.revoked_at IS NULL`,
        [keyHash],
      );
      const row = res.rows[0];
      if (!row) return null;
      return {
        id: row.id as string,
        orgId: row.org_id as string,
        userId: row.user_id as string,
        role: row.role as "member" | "admin" | "owner",
        scopes: (row.scopes as string[]) ?? [],
      };
    },
    async touchLastUsed(id) {
      await pgPool.query(
        `UPDATE api_keys SET last_used_at = NOW() WHERE id = $1`,
        [id],
      );
    },
  };
}
