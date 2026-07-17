// db/group-data-access.ts — routes/admin-groups.ts(P19-T1-13) 가 사용하는 groups +
// group_members(migration 0026) pg 구현. dev/test DATABASE_URL role 은 superuser 라 RLS 를
// 우회하므로(api-key-data-access.ts 와 동일 사유), org 격리는 모든 쿼리의 WHERE org_id = $
// 로 application 레벨에서도 명시적으로 강제한다(이중 방어).
import { pgPool } from "./client.js";

export interface Group {
  id: string;
  orgId: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface GroupWithMembers extends Group {
  memberUserIds: string[];
}

function toGroup(row: Record<string, unknown>): Group {
  return {
    id: row.id as string,
    orgId: row.org_id as string,
    name: row.name as string,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
}

export interface GroupDataAccess {
  list(orgId: string): Promise<GroupWithMembers[]>;
  create(orgId: string, name: string): Promise<Group>;
  rename(orgId: string, id: string, name: string): Promise<Group | null>;
  remove(orgId: string, id: string): Promise<boolean>;
  addMember(orgId: string, groupId: string, userId: string): Promise<boolean>;
  removeMember(
    orgId: string,
    groupId: string,
    userId: string,
  ): Promise<boolean>;
}

export function createPgGroupDataAccess(): GroupDataAccess {
  return {
    async list(orgId) {
      const res = await pgPool.query(
        `SELECT g.*, COALESCE(
           array_agg(gm.user_id) FILTER (WHERE gm.user_id IS NOT NULL), '{}'
         ) AS member_user_ids
         FROM groups g
         LEFT JOIN group_members gm ON gm.group_id = g.id AND gm.org_id = g.org_id
         WHERE g.org_id = $1
         GROUP BY g.id
         ORDER BY g.created_at ASC`,
        [orgId],
      );
      return res.rows.map((row) => ({
        ...toGroup(row),
        memberUserIds: (row.member_user_ids as string[]) ?? [],
      }));
    },
    async create(orgId, name) {
      const res = await pgPool.query(
        `INSERT INTO groups (org_id, name) VALUES ($1, $2) RETURNING *`,
        [orgId, name],
      );
      return toGroup(res.rows[0]);
    },
    async rename(orgId, id, name) {
      const res = await pgPool.query(
        `UPDATE groups SET name = $3 WHERE id = $1 AND org_id = $2 RETURNING *`,
        [id, orgId, name],
      );
      return res.rows[0] ? toGroup(res.rows[0]) : null;
    },
    async remove(orgId, id) {
      const res = await pgPool.query(
        `DELETE FROM groups WHERE id = $1 AND org_id = $2`,
        [id, orgId],
      );
      return (res.rowCount ?? 0) > 0;
    },
    async addMember(orgId, groupId, userId) {
      const res = await pgPool.query(
        `INSERT INTO group_members (group_id, user_id, org_id)
         SELECT g.id, u.id, $1
         FROM groups g, users u
         WHERE g.id = $2 AND g.org_id = $1 AND u.id = $3 AND u.org_id = $1
         ON CONFLICT (group_id, user_id) DO NOTHING
         RETURNING group_id`,
        [orgId, groupId, userId],
      );
      return res.rowCount !== null && res.rowCount > 0;
    },
    async removeMember(orgId, groupId, userId) {
      const res = await pgPool.query(
        `DELETE FROM group_members
         WHERE group_id = $1 AND user_id = $2 AND org_id = $3`,
        [groupId, userId, orgId],
      );
      return (res.rowCount ?? 0) > 0;
    },
  };
}
