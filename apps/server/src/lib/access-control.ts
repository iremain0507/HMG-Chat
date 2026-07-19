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

export interface FilterAccessibleResourceIdsParams {
  orgId: string;
  userId: string;
  resourceType: ResourceType;
  resourceIds: string[];
  access: AccessLevel;
}

// P20-T1-11 — 목록 조회 라우트(documents.ts/prompts.ts/mcp-servers.ts) enforcement 공통 헬퍼.
// additive-union 이므로 "grant 가 하나도 없는 리소스 = 전체 공개"(기존 동작 보존), grant 가
// 존재할 때만 canAccessResource 와 동일한 판정(direct user grant 또는 소속 group grant)으로 필터.
export async function filterAccessibleResourceIds(
  da: Pick<ResourceGrantsDataAccess, "grantsForResources" | "groupIdsForUser">,
  params: FilterAccessibleResourceIdsParams,
): Promise<Set<string>> {
  const { orgId, userId, resourceType, resourceIds, access } = params;
  if (resourceIds.length === 0) return new Set();
  const [grantRows, groupIds] = await Promise.all([
    da.grantsForResources(orgId, resourceType, resourceIds),
    da.groupIdsForUser(orgId, userId),
  ]);
  const groupIdSet = new Set(groupIds);
  const resourceIdsWithGrant = new Set<string>();
  const accessibleResourceIds = new Set<string>();
  for (const row of grantRows) {
    resourceIdsWithGrant.add(row.resourceId);
    if (
      row.access === access &&
      ((row.subjectType === "user" && row.subjectId === userId) ||
        (row.subjectType === "group" && groupIdSet.has(row.subjectId)))
    ) {
      accessibleResourceIds.add(row.resourceId);
    }
  }
  return new Set(
    resourceIds.filter(
      (id) => !resourceIdsWithGrant.has(id) || accessibleResourceIds.has(id),
    ),
  );
}
