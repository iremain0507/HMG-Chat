// db/resource-grants-data-access.ts — lib/access-control.ts(P19-T1-14) 가 소비하는
// resource_grants(migration 0027) pg 구현. dev/test DATABASE_URL role 은 superuser 라 RLS 를
// 우회하므로(group-data-access.ts 와 동일 사유), org 격리는 모든 쿼리의 WHERE org_id = $ 로
// application 레벨에서도 명시적으로 강제한다(이중 방어).
import { pgPool } from "./client.js";

export type ResourceType = "model" | "knowledge" | "tool" | "prompt";
export type SubjectType = "user" | "group";
export type AccessLevel = "read" | "write";

export interface ResourceGrant {
  subjectType: SubjectType;
  subjectId: string;
  access: AccessLevel;
}

export interface ResourceGrantsDataAccess {
  /** subjectId 가 org 에 속하지 않으면 grant 하지 않고 false 를 반환한다(cross-org 거부). */
  grant(
    orgId: string,
    resourceType: ResourceType,
    resourceId: string,
    subjectType: SubjectType,
    subjectId: string,
    access: AccessLevel,
  ): Promise<boolean>;
  grantsForResource(
    orgId: string,
    resourceType: ResourceType,
    resourceId: string,
  ): Promise<ResourceGrant[]>;
  groupIdsForUser(orgId: string, userId: string): Promise<string[]>;
  revoke(
    orgId: string,
    resourceType: ResourceType,
    resourceId: string,
    subjectType: SubjectType,
    subjectId: string,
    access: AccessLevel,
  ): Promise<boolean>;
}

export function createPgResourceGrantsDataAccess(): ResourceGrantsDataAccess {
  return {
    async grant(
      orgId,
      resourceType,
      resourceId,
      subjectType,
      subjectId,
      access,
    ) {
      const subjectExists =
        subjectType === "user"
          ? await pgPool.query(
              `SELECT 1 FROM users WHERE id = $1 AND org_id = $2`,
              [subjectId, orgId],
            )
          : await pgPool.query(
              `SELECT 1 FROM groups WHERE id = $1 AND org_id = $2`,
              [subjectId, orgId],
            );
      if ((subjectExists.rowCount ?? 0) === 0) return false;
      await pgPool.query(
        `INSERT INTO resource_grants (org_id, resource_type, resource_id, subject_type, subject_id, access)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (org_id, resource_type, resource_id, subject_type, subject_id, access) DO NOTHING`,
        [orgId, resourceType, resourceId, subjectType, subjectId, access],
      );
      return true;
    },
    async grantsForResource(orgId, resourceType, resourceId) {
      const res = await pgPool.query(
        `SELECT subject_type, subject_id, access
         FROM resource_grants
         WHERE org_id = $1 AND resource_type = $2 AND resource_id = $3`,
        [orgId, resourceType, resourceId],
      );
      return res.rows.map((row) => ({
        subjectType: row.subject_type as SubjectType,
        subjectId: row.subject_id as string,
        access: row.access as AccessLevel,
      }));
    },
    async groupIdsForUser(orgId, userId) {
      const res = await pgPool.query(
        `SELECT group_id FROM group_members WHERE org_id = $1 AND user_id = $2`,
        [orgId, userId],
      );
      return res.rows.map((row) => row.group_id as string);
    },
    async revoke(
      orgId,
      resourceType,
      resourceId,
      subjectType,
      subjectId,
      access,
    ) {
      const res = await pgPool.query(
        `DELETE FROM resource_grants
         WHERE org_id = $1 AND resource_type = $2 AND resource_id = $3
           AND subject_type = $4 AND subject_id = $5 AND access = $6`,
        [orgId, resourceType, resourceId, subjectType, subjectId, access],
      );
      return (res.rowCount ?? 0) > 0;
    },
  };
}
