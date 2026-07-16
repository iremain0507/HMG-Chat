// lib/access-control.ts — resource_grants(migration 0027) 기반 리소스 접근 판정.
//   판정 규칙은 "additive union": 리소스에 대해 direct user grant 또는 사용자가 속한 어느
//   group 의 grant 든 하나라도 요청한 access 를 만족하면 허용(하나라도 만족하면 true, AND 아님).
import type {
  AccessLevel,
  ResourceGrantsDataAccess,
  ResourceType,
} from "../db/resource-grants-data-access.js";

export interface CanAccessResourceParams {
  orgId: string;
  userId: string;
  resourceType: ResourceType;
  resourceId: string;
  access: AccessLevel;
}

export async function canAccessResource(
  da: Pick<ResourceGrantsDataAccess, "grantsForResource" | "groupIdsForUser">,
  params: CanAccessResourceParams,
): Promise<boolean> {
  const { orgId, userId, resourceType, resourceId, access } = params;
  const [grants, groupIds] = await Promise.all([
    da.grantsForResource(orgId, resourceType, resourceId),
    da.groupIdsForUser(orgId, userId),
  ]);
  const groupIdSet = new Set(groupIds);
  return grants.some(
    (g) =>
      g.access === access &&
      ((g.subjectType === "user" && g.subjectId === userId) ||
        (g.subjectType === "group" && groupIdSet.has(g.subjectId))),
  );
}
