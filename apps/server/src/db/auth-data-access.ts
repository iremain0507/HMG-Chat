// db/auth-data-access.ts — routes/auth.ts 의 AuthDataAccess(Pick<DataAccess, ...>) pg 구현체.
// dev/test 환경의 DATABASE_URL role 은 superuser(FORCE RLS 도 우회, rls.test.ts §초기 데이터
// 삽입 주석과 동일 근거) 라 여기선 RLS 컨텍스트 없이 직접 query 한다.
import type {
  MagicLinkTokenRecord,
  Organization,
  RefreshTokenFamilyRecord,
  User,
} from "@wchat/interfaces";
import type { AuthDataAccess } from "../routes/auth.js";
import { pgPool } from "./client.js";

function toOrganization(row: Record<string, unknown>): Organization {
  return {
    id: row.id as string,
    name: row.name as string,
    domain: row.domain as string,
    plan: row.plan as string,
    allowedModels: row.allowed_models as string[],
    allowedTools: row.allowed_tools as string[],
    defaultTokenBudgetMicros:
      (row.default_token_budget_micros as string | null) === null
        ? null
        : Number(row.default_token_budget_micros),
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
}

function toUser(row: Record<string, unknown>): User {
  return {
    id: row.id as string,
    orgId: row.org_id as string,
    email: row.email as string,
    name: (row.name as string | null) ?? null,
    role: row.role as User["role"],
    customInstructions: (row.custom_instructions as string | null) ?? null,
    status: row.status as User["status"],
    lastLoginAt: (row.last_login_at as Date | null) ?? null,
    createdAt: row.created_at as Date,
  };
}

function toMagicLinkToken(row: Record<string, unknown>): MagicLinkTokenRecord {
  return {
    tokenHash: row.token_hash as string,
    email: row.email as string,
    userId: (row.user_id as string | null) ?? null,
    orgId: row.org_id as string,
    intent: row.intent as MagicLinkTokenRecord["intent"],
    signupName: (row.signup_name as string | null) ?? null,
    expiresAt: row.expires_at as Date,
    usedAt: (row.used_at as Date | null) ?? null,
    createdAt: row.created_at as Date,
  };
}

function toRefreshTokenFamily(
  row: Record<string, unknown>,
): RefreshTokenFamilyRecord {
  return {
    familyId: row.family_id as string,
    userId: row.user_id as string,
    currentGeneration: row.current_generation as number,
    currentJti: row.current_jti as string,
    createdAt: row.created_at as Date,
    lastUsedAt: row.last_used_at as Date,
    revokedAt: (row.revoked_at as Date | null) ?? null,
    revokeReason:
      (row.revoke_reason as RefreshTokenFamilyRecord["revokeReason"]) ?? null,
  };
}

export function createPgAuthDataAccess(): AuthDataAccess {
  return {
    organizations: {
      async insert(data) {
        const res = await pgPool.query(
          `INSERT INTO organizations (name, domain, plan, allowed_models, allowed_tools, default_token_budget_micros)
           VALUES ($1, $2, COALESCE($3, 'standard'), COALESCE($4, '[]'::jsonb), COALESCE($5, '[]'::jsonb), $6)
           RETURNING *`,
          [
            data.name,
            data.domain,
            data.plan ?? null,
            data.allowedModels ? JSON.stringify(data.allowedModels) : null,
            data.allowedTools ? JSON.stringify(data.allowedTools) : null,
            data.defaultTokenBudgetMicros ?? null,
          ],
        );
        return toOrganization(res.rows[0]);
      },
      async bulkInsert(rows) {
        return Promise.all(rows.map((row) => this.insert(row)));
      },
      async update(id, data) {
        const res = await pgPool.query(
          `UPDATE organizations SET
             name = COALESCE($2, name),
             domain = COALESCE($3, domain),
             plan = COALESCE($4, plan),
             allowed_models = COALESCE($5, allowed_models),
             allowed_tools = COALESCE($6, allowed_tools),
             default_token_budget_micros = COALESCE($7, default_token_budget_micros)
           WHERE id = $1 RETURNING *`,
          [
            id,
            data.name ?? null,
            data.domain ?? null,
            data.plan ?? null,
            data.allowedModels ? JSON.stringify(data.allowedModels) : null,
            data.allowedTools ? JSON.stringify(data.allowedTools) : null,
            data.defaultTokenBudgetMicros ?? null,
          ],
        );
        if (res.rows.length === 0) throw new Error("organization not found");
        return toOrganization(res.rows[0]);
      },
      async delete(id) {
        await pgPool.query("DELETE FROM organizations WHERE id = $1", [id]);
      },
      async byId(id) {
        const res = await pgPool.query(
          "SELECT * FROM organizations WHERE id = $1",
          [id],
        );
        return res.rows[0] ? toOrganization(res.rows[0]) : null;
      },
      async list(filter) {
        const res = filter?.domainEq
          ? await pgPool.query(
              "SELECT * FROM organizations WHERE domain = $1",
              [filter.domainEq],
            )
          : await pgPool.query("SELECT * FROM organizations");
        return { items: res.rows.map(toOrganization) };
      },
    },
    users: {
      async insert(data) {
        const res = await pgPool.query(
          `INSERT INTO users (org_id, email, name, role, custom_instructions, status, last_login_at)
           VALUES ($1, $2, $3, COALESCE($4, 'member'), $5, COALESCE($6, 'active'), $7)
           RETURNING *`,
          [
            data.orgId,
            data.email,
            data.name ?? null,
            data.role ?? null,
            data.customInstructions ?? null,
            data.status ?? null,
            data.lastLoginAt ?? null,
          ],
        );
        return toUser(res.rows[0]);
      },
      async bulkInsert(rows) {
        return Promise.all(rows.map((row) => this.insert(row)));
      },
      async update(id, data) {
        const res = await pgPool.query(
          `UPDATE users SET
             name = COALESCE($2, name),
             role = COALESCE($3, role),
             custom_instructions = COALESCE($4, custom_instructions),
             status = COALESCE($5, status),
             last_login_at = COALESCE($6, last_login_at)
           WHERE id = $1 RETURNING *`,
          [
            id,
            data.name ?? null,
            data.role ?? null,
            data.customInstructions ?? null,
            data.status ?? null,
            data.lastLoginAt ?? null,
          ],
        );
        if (res.rows.length === 0) throw new Error("user not found");
        return toUser(res.rows[0]);
      },
      async delete(id) {
        await pgPool.query("DELETE FROM users WHERE id = $1", [id]);
      },
      async byId(id) {
        const res = await pgPool.query("SELECT * FROM users WHERE id = $1", [
          id,
        ]);
        return res.rows[0] ? toUser(res.rows[0]) : null;
      },
      async list(filter) {
        const conditions: string[] = [];
        const params: unknown[] = [];
        if (filter?.orgId) {
          params.push(filter.orgId);
          conditions.push(`org_id = $${params.length}`);
        }
        if (filter?.emailEq) {
          params.push(filter.emailEq);
          conditions.push(`email = $${params.length}`);
        }
        const where = conditions.length
          ? `WHERE ${conditions.join(" AND ")}`
          : "";
        const res = await pgPool.query(`SELECT * FROM users ${where}`, params);
        return { items: res.rows.map(toUser) };
      },
    },
    magicLinkTokens: {
      async insert(data) {
        const res = await pgPool.query(
          `INSERT INTO magic_link_tokens (token_hash, email, user_id, org_id, intent, signup_name, expires_at, used_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING *`,
          [
            data.tokenHash,
            data.email,
            data.userId ?? null,
            data.orgId,
            data.intent,
            data.signupName ?? null,
            data.expiresAt,
            data.usedAt ?? null,
          ],
        );
        return toMagicLinkToken(res.rows[0]);
      },
      async bulkInsert(rows) {
        return Promise.all(rows.map((row) => this.insert(row)));
      },
      async update(id, data) {
        const res = await pgPool.query(
          `UPDATE magic_link_tokens SET
             user_id = COALESCE($2, user_id),
             used_at = COALESCE($3, used_at)
           WHERE token_hash = $1 RETURNING *`,
          [id, data.userId ?? null, data.usedAt ?? null],
        );
        if (res.rows.length === 0)
          throw new Error("magic_link_token not found");
        return toMagicLinkToken(res.rows[0]);
      },
      async delete(id) {
        await pgPool.query(
          "DELETE FROM magic_link_tokens WHERE token_hash = $1",
          [id],
        );
      },
      async byId(id) {
        return this.byTokenHash(id);
      },
      async byTokenHash(hash) {
        const res = await pgPool.query(
          "SELECT * FROM magic_link_tokens WHERE token_hash = $1",
          [hash],
        );
        return res.rows[0] ? toMagicLinkToken(res.rows[0]) : null;
      },
      async markUsed(tokenHash, usedAt) {
        await pgPool.query(
          "UPDATE magic_link_tokens SET used_at = $2 WHERE token_hash = $1",
          [tokenHash, usedAt],
        );
      },
      async expireOlderThan(cutoff) {
        const res = await pgPool.query(
          "DELETE FROM magic_link_tokens WHERE expires_at < $1 AND used_at IS NULL",
          [cutoff],
        );
        return res.rowCount ?? 0;
      },
      async list(filter) {
        const conditions: string[] = [];
        const params: unknown[] = [];
        if (filter?.email) {
          params.push(filter.email);
          conditions.push(`email = $${params.length}`);
        }
        if (filter?.intent) {
          params.push(filter.intent);
          conditions.push(`intent = $${params.length}`);
        }
        if (filter?.unusedOnly) {
          conditions.push("used_at IS NULL");
        }
        const where = conditions.length
          ? `WHERE ${conditions.join(" AND ")}`
          : "";
        const res = await pgPool.query(
          `SELECT * FROM magic_link_tokens ${where}`,
          params,
        );
        return { items: res.rows.map(toMagicLinkToken) };
      },
    },
    refreshTokenFamilies: {
      async insert(data) {
        const res = await pgPool.query(
          `INSERT INTO refresh_token_families (family_id, user_id, current_generation, current_jti, last_used_at, revoked_at, revoke_reason)
           VALUES (COALESCE($1, uuid_generate_v4()), $2, COALESCE($3, 1), $4, COALESCE($5, NOW()), $6, $7)
           RETURNING *`,
          [
            data.familyId ?? null,
            data.userId,
            data.currentGeneration ?? null,
            data.currentJti,
            data.lastUsedAt ?? null,
            data.revokedAt ?? null,
            data.revokeReason ?? null,
          ],
        );
        return toRefreshTokenFamily(res.rows[0]);
      },
      async bulkInsert(rows) {
        return Promise.all(rows.map((row) => this.insert(row)));
      },
      async update(id, data) {
        const res = await pgPool.query(
          `UPDATE refresh_token_families SET
             current_generation = COALESCE($2, current_generation),
             current_jti = COALESCE($3, current_jti),
             last_used_at = COALESCE($4, last_used_at),
             revoked_at = COALESCE($5, revoked_at),
             revoke_reason = COALESCE($6, revoke_reason)
           WHERE family_id = $1 RETURNING *`,
          [
            id,
            data.currentGeneration ?? null,
            data.currentJti ?? null,
            data.lastUsedAt ?? null,
            data.revokedAt ?? null,
            data.revokeReason ?? null,
          ],
        );
        if (res.rows.length === 0)
          throw new Error("refresh_token_family not found");
        return toRefreshTokenFamily(res.rows[0]);
      },
      async delete(id) {
        await pgPool.query(
          "DELETE FROM refresh_token_families WHERE family_id = $1",
          [id],
        );
      },
      async byId(id) {
        const res = await pgPool.query(
          "SELECT * FROM refresh_token_families WHERE family_id = $1",
          [id],
        );
        return res.rows[0] ? toRefreshTokenFamily(res.rows[0]) : null;
      },
      async byCurrentJti(jti) {
        const res = await pgPool.query(
          "SELECT * FROM refresh_token_families WHERE current_jti = $1",
          [jti],
        );
        return res.rows[0] ? toRefreshTokenFamily(res.rows[0]) : null;
      },
      async rotate(familyId, newJti) {
        const res = await pgPool.query(
          `UPDATE refresh_token_families
           SET current_jti = $2, current_generation = current_generation + 1, last_used_at = NOW()
           WHERE family_id = $1 RETURNING current_generation`,
          [familyId, newJti],
        );
        if (res.rows.length === 0)
          throw new Error("refresh_token_family not found");
        return { generation: res.rows[0].current_generation as number };
      },
      async revoke(familyId, reason) {
        await pgPool.query(
          `UPDATE refresh_token_families SET revoked_at = NOW(), revoke_reason = $2 WHERE family_id = $1`,
          [familyId, reason],
        );
      },
      async revokeAllForUser(userId, reason) {
        const res = await pgPool.query(
          `UPDATE refresh_token_families SET revoked_at = NOW(), revoke_reason = $2
           WHERE user_id = $1 AND revoked_at IS NULL`,
          [userId, reason],
        );
        return res.rowCount ?? 0;
      },
      async list(filter) {
        const conditions: string[] = [];
        const params: unknown[] = [];
        if (filter?.userId) {
          params.push(filter.userId);
          conditions.push(`user_id = $${params.length}`);
        }
        if (filter?.activeOnly) {
          conditions.push("revoked_at IS NULL");
        }
        const where = conditions.length
          ? `WHERE ${conditions.join(" AND ")}`
          : "";
        const res = await pgPool.query(
          `SELECT * FROM refresh_token_families ${where}`,
          params,
        );
        return { items: res.rows.map(toRefreshTokenFamily) };
      },
    },
    // AuthDataAccess 를 통해선 이 method 가 실제로 호출되지 않는다(dev/test DATABASE_URL role 은
    // superuser 라 RLS 자체가 우회됨, rls.test.ts §초기 데이터 삽입 주석 참고) — 계약만 충족.
    async withRlsContext(ctx, fn) {
      const client = await pgPool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          "SELECT set_config('app.org_id', $1, true), set_config('app.user_id', $2, true)",
          [ctx.orgId, ctx.userId],
        );
        const result = await fn();
        await client.query("COMMIT");
        return result;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },
  };
}
