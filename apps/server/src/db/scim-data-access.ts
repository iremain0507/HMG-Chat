// db/scim-data-access.ts — routes/scim.ts(P22-T1-16, 계약배치 C15) 의 pg 구현.
// SCIM 은 IdP 가 서버-대-서버로 호출하므로 사용자 JWT 가 아니라 전용 Bearer 토큰
// (migration 0040 scim_tokens, sha256 hex 만 저장 — api-key-data-access.ts 와 동일 패턴)
// 으로 인증하고, 그 토큰이 곧 org 를 결정한다(요청 body/path 로 org 를 받지 않아 cross-org 불가).
//
// 리소스 매핑(신규 테이블 없음 — 기존 identity 스키마 재사용):
//   SCIM User  → users (userName=email, externalId=users.external_id, active=status)
//   SCIM Group → groups + group_members (migration 0026, admin-groups.ts 와 같은 테이블)
// dev/test DATABASE_URL role 은 superuser 라 RLS 를 우회하므로(group-data-access.ts 와 동일
// 사유) 모든 쿼리에 WHERE org_id = $ 를 명시해 application 레벨에서도 org 를 이중 방어한다.
import { createHash } from "node:crypto";
import { pgPool } from "./client.js";

export interface ScimUserRecord {
  id: string;
  orgId: string;
  email: string;
  name: string | null;
  role: "member" | "admin" | "owner";
  status: "active" | "suspended" | "deleted";
  externalId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ScimGroupRecord {
  id: string;
  orgId: string;
  name: string;
  externalId: string | null;
  memberUserIds: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ScimListOptions {
  startIndex: number;
  count: number;
}

export interface ScimDataAccess {
  /** 원문 Bearer 토큰 → org. 폐기(revoked)·미등록 토큰은 null. */
  resolveToken(rawToken: string): Promise<{ orgId: string } | null>;

  listUsers(
    orgId: string,
    opts: ScimListOptions & { email?: string; externalId?: string },
  ): Promise<{ items: ScimUserRecord[]; total: number }>;
  userById(orgId: string, id: string): Promise<ScimUserRecord | null>;
  userByEmail(orgId: string, email: string): Promise<ScimUserRecord | null>;
  createUser(
    orgId: string,
    data: {
      email: string;
      name: string | null;
      externalId: string | null;
      active: boolean;
    },
  ): Promise<ScimUserRecord>;
  updateUser(
    orgId: string,
    id: string,
    data: {
      email?: string;
      name?: string | null;
      externalId?: string | null;
      active?: boolean;
    },
  ): Promise<ScimUserRecord | null>;

  listGroups(
    orgId: string,
    opts: ScimListOptions & { displayName?: string },
  ): Promise<{ items: ScimGroupRecord[]; total: number }>;
  groupById(orgId: string, id: string): Promise<ScimGroupRecord | null>;
  groupByName(orgId: string, name: string): Promise<ScimGroupRecord | null>;
  createGroup(
    orgId: string,
    data: {
      name: string;
      externalId: string | null;
      memberUserIds: string[];
    },
  ): Promise<ScimGroupRecord>;
  updateGroup(
    orgId: string,
    id: string,
    data: {
      name?: string;
      externalId?: string | null;
      memberUserIds?: string[];
    },
  ): Promise<ScimGroupRecord | null>;
  deleteGroup(orgId: string, id: string): Promise<boolean>;
}

/** routes/auth.ts hashToken / hashApiKey 와 동일 패턴(sha256 hex). 원문은 저장하지 않는다. */
export function hashScimToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

function toUser(row: Record<string, unknown>): ScimUserRecord {
  return {
    id: row.id as string,
    orgId: row.org_id as string,
    email: row.email as string,
    name: (row.name as string | null) ?? null,
    role: row.role as ScimUserRecord["role"],
    status: row.status as ScimUserRecord["status"],
    externalId: (row.external_id as string | null) ?? null,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
}

function toGroup(row: Record<string, unknown>): ScimGroupRecord {
  return {
    id: row.id as string,
    orgId: row.org_id as string,
    name: row.name as string,
    externalId: (row.external_id as string | null) ?? null,
    memberUserIds: (row.member_user_ids as string[]) ?? [],
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
}

// groups + 멤버 배열 집계 (group-data-access.ts list() 와 동일한 LEFT JOIN 형태)
const GROUP_SELECT = `
  SELECT g.*, COALESCE(
    array_agg(gm.user_id) FILTER (WHERE gm.user_id IS NOT NULL), '{}'
  ) AS member_user_ids
  FROM groups g
  LEFT JOIN group_members gm ON gm.group_id = g.id AND gm.org_id = g.org_id`;

export function createPgScimDataAccess(): ScimDataAccess {
  async function readGroup(
    orgId: string,
    id: string,
  ): Promise<ScimGroupRecord | null> {
    const res = await pgPool.query(
      `${GROUP_SELECT} WHERE g.id = $1 AND g.org_id = $2 GROUP BY g.id`,
      [id, orgId],
    );
    return res.rows[0] ? toGroup(res.rows[0]) : null;
  }

  // 멤버 전체 교체. group_members 는 (group_id,user_id) PK 라 delete→insert 로 단순화하고,
  // 같은 org 의 실존 user 만 넣는다(SELECT ... FROM users WHERE org_id 필터 = 이중 방어).
  async function replaceMembers(
    orgId: string,
    groupId: string,
    memberUserIds: string[],
  ): Promise<void> {
    const client = await pgPool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `DELETE FROM group_members WHERE group_id = $1 AND org_id = $2`,
        [groupId, orgId],
      );
      if (memberUserIds.length > 0) {
        await client.query(
          `INSERT INTO group_members (group_id, user_id, org_id)
           SELECT $1, u.id, $2 FROM users u
           WHERE u.id = ANY($3::uuid[]) AND u.org_id = $2
           ON CONFLICT (group_id, user_id) DO NOTHING`,
          [groupId, orgId, memberUserIds],
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  return {
    async resolveToken(rawToken) {
      const res = await pgPool.query(
        `SELECT org_id FROM scim_tokens
         WHERE token_hash = $1 AND revoked_at IS NULL`,
        [hashScimToken(rawToken)],
      );
      if (!res.rows[0]) return null;
      // 마지막 사용시각 기록은 실패해도 인증을 막지 않는다(api_keys 와 동일 취급).
      await pgPool
        .query(
          `UPDATE scim_tokens SET last_used_at = NOW() WHERE token_hash = $1`,
          [hashScimToken(rawToken)],
        )
        .catch(() => undefined);
      return { orgId: res.rows[0].org_id as string };
    },

    async listUsers(orgId, opts) {
      const filters: string[] = ["org_id = $1"];
      const params: unknown[] = [orgId];
      if (opts.email) {
        params.push(opts.email);
        filters.push(`email = $${params.length}`);
      }
      if (opts.externalId) {
        params.push(opts.externalId);
        filters.push(`external_id = $${params.length}`);
      }
      const where = filters.join(" AND ");
      const totalRes = await pgPool.query(
        `SELECT COUNT(*)::int AS n FROM users WHERE ${where}`,
        params,
      );
      const offset = Math.max(1, opts.startIndex) - 1;
      const res = await pgPool.query(
        `SELECT * FROM users WHERE ${where} ORDER BY created_at ASC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, opts.count, offset],
      );
      return {
        items: res.rows.map(toUser),
        total: totalRes.rows[0].n as number,
      };
    },

    async userById(orgId, id) {
      const res = await pgPool.query(
        `SELECT * FROM users WHERE id = $1 AND org_id = $2`,
        [id, orgId],
      );
      return res.rows[0] ? toUser(res.rows[0]) : null;
    },

    async userByEmail(orgId, email) {
      const res = await pgPool.query(
        `SELECT * FROM users WHERE email = $1 AND org_id = $2`,
        [email, orgId],
      );
      return res.rows[0] ? toUser(res.rows[0]) : null;
    },

    async createUser(orgId, data) {
      const res = await pgPool.query(
        `INSERT INTO users (org_id, email, name, external_id, status)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [
          orgId,
          data.email,
          data.name,
          data.externalId,
          data.active ? "active" : "suspended",
        ],
      );
      return toUser(res.rows[0]);
    },

    async updateUser(orgId, id, data) {
      const res = await pgPool.query(
        `UPDATE users SET
           email = COALESCE($3, email),
           name = CASE WHEN $4::boolean THEN $5 ELSE name END,
           external_id = CASE WHEN $6::boolean THEN $7 ELSE external_id END,
           status = COALESCE($8, status)
         WHERE id = $1 AND org_id = $2 RETURNING *`,
        [
          id,
          orgId,
          data.email ?? null,
          data.name !== undefined,
          data.name ?? null,
          data.externalId !== undefined,
          data.externalId ?? null,
          data.active === undefined
            ? null
            : data.active
              ? "active"
              : "suspended",
        ],
      );
      return res.rows[0] ? toUser(res.rows[0]) : null;
    },

    async listGroups(orgId, opts) {
      const filters: string[] = ["g.org_id = $1"];
      const params: unknown[] = [orgId];
      if (opts.displayName) {
        params.push(opts.displayName);
        filters.push(`g.name = $${params.length}`);
      }
      const where = filters.join(" AND ");
      const totalRes = await pgPool.query(
        `SELECT COUNT(*)::int AS n FROM groups g WHERE ${where}`,
        params,
      );
      const offset = Math.max(1, opts.startIndex) - 1;
      const res = await pgPool.query(
        `${GROUP_SELECT} WHERE ${where} GROUP BY g.id ORDER BY g.created_at ASC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, opts.count, offset],
      );
      return {
        items: res.rows.map(toGroup),
        total: totalRes.rows[0].n as number,
      };
    },

    groupById: readGroup,

    async groupByName(orgId, name) {
      const res = await pgPool.query(
        `${GROUP_SELECT} WHERE g.org_id = $1 AND g.name = $2 GROUP BY g.id`,
        [orgId, name],
      );
      return res.rows[0] ? toGroup(res.rows[0]) : null;
    },

    async createGroup(orgId, data) {
      const res = await pgPool.query(
        `INSERT INTO groups (org_id, name, external_id) VALUES ($1, $2, $3)
         RETURNING id`,
        [orgId, data.name, data.externalId],
      );
      const id = res.rows[0].id as string;
      if (data.memberUserIds.length > 0) {
        await replaceMembers(orgId, id, data.memberUserIds);
      }
      const created = await readGroup(orgId, id);
      if (!created) throw new Error("scim: created group not readable");
      return created;
    },

    async updateGroup(orgId, id, data) {
      const res = await pgPool.query(
        `UPDATE groups SET
           name = COALESCE($3, name),
           external_id = CASE WHEN $4::boolean THEN $5 ELSE external_id END
         WHERE id = $1 AND org_id = $2 RETURNING id`,
        [
          id,
          orgId,
          data.name ?? null,
          data.externalId !== undefined,
          data.externalId ?? null,
        ],
      );
      if (!res.rows[0]) return null;
      if (data.memberUserIds) {
        await replaceMembers(orgId, id, data.memberUserIds);
      }
      return readGroup(orgId, id);
    },

    async deleteGroup(orgId, id) {
      const res = await pgPool.query(
        `DELETE FROM groups WHERE id = $1 AND org_id = $2`,
        [id, orgId],
      );
      return (res.rowCount ?? 0) > 0;
    },
  };
}
