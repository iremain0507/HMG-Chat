// access-control-composition.test.ts — P19-T1-14 acceptance: resource_grants(migration 0027)
// + lib/access-control.ts 의 canAccessResource 가 "additive union"(direct user grant 또는
// 사용자가 속한 어느 group 의 grant 든 하나라도 만족하면 허용) 을 실 Postgres + group_members
// (migration 0026)와 연동해 올바르게 판정하는지 검증. HTTP 라우트는 이 태스크 스코프 밖(follow-up).
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pgPool } from "../../db/client.js";
import { createPgGroupDataAccess } from "../../db/group-data-access.js";
import { createPgResourceGrantsDataAccess } from "../../db/resource-grants-data-access.js";
import { canAccessResource } from "../../lib/access-control.js";

describe("resource_grants + access-control — P19-T1-14", () => {
  const org = {
    id: randomUUID(),
    domain: `org-acc-${randomUUID()}.example.com`,
  };
  const otherOrg = {
    id: randomUUID(),
    domain: `org-acc-other-${randomUUID()}.example.com`,
  };
  const member = { id: randomUUID() };
  const nonMember = { id: randomUUID() };
  const directUser = { id: randomUUID() };
  const groups = createPgGroupDataAccess();
  const grants = createPgResourceGrantsDataAccess();
  let groupId = "";

  beforeAll(async () => {
    await pgPool.query(
      "INSERT INTO organizations (id, name, domain) VALUES ($1, 'Org ACC', $2), ($3, 'Org ACC Other', $4)",
      [org.id, org.domain, otherOrg.id, otherOrg.domain],
    );
    await pgPool.query(
      `INSERT INTO users (id, org_id, email, role) VALUES
         ($1, $2, $3, 'member'), ($4, $2, $5, 'member'), ($6, $2, $7, 'member')`,
      [
        member.id,
        org.id,
        `member-acc-${randomUUID()}@${org.domain}`,
        nonMember.id,
        `nonmember-acc-${randomUUID()}@${org.domain}`,
        directUser.id,
        `directuser-acc-${randomUUID()}@${org.domain}`,
      ],
    );
    const group = await groups.create(org.id, "acc-test-group");
    groupId = group.id;
    await groups.addMember(org.id, groupId, member.id);
  });

  afterAll(async () => {
    await pgPool.query("DELETE FROM resource_grants WHERE org_id = ANY($1)", [
      [org.id, otherOrg.id],
    ]);
    await pgPool.query("DELETE FROM group_members WHERE org_id = ANY($1)", [
      [org.id, otherOrg.id],
    ]);
    await pgPool.query("DELETE FROM groups WHERE org_id = ANY($1)", [
      [org.id, otherOrg.id],
    ]);
    await pgPool.query("DELETE FROM users WHERE org_id = ANY($1)", [
      [org.id, otherOrg.id],
    ]);
    await pgPool.query("DELETE FROM organizations WHERE id = ANY($1)", [
      [org.id, otherOrg.id],
    ]);
  });

  it("그룹에 read 부여 → 그룹 멤버는 접근 허용, 비멤버는 거부(additive union)", async () => {
    const resourceId = randomUUID();
    await grants.grant(org.id, "prompt", resourceId, "group", groupId, "read");

    const memberCanRead = await canAccessResource(grants, {
      orgId: org.id,
      userId: member.id,
      resourceType: "prompt",
      resourceId,
      access: "read",
    });
    expect(memberCanRead).toBe(true);

    const nonMemberCanRead = await canAccessResource(grants, {
      orgId: org.id,
      userId: nonMember.id,
      resourceType: "prompt",
      resourceId,
      access: "read",
    });
    expect(nonMemberCanRead).toBe(false);
  });

  it("그룹에 read 만 부여된 경우 write 는 여전히 거부된다", async () => {
    const resourceId = randomUUID();
    await grants.grant(org.id, "prompt", resourceId, "group", groupId, "read");

    const memberCanWrite = await canAccessResource(grants, {
      orgId: org.id,
      userId: member.id,
      resourceType: "prompt",
      resourceId,
      access: "write",
    });
    expect(memberCanWrite).toBe(false);
  });

  it("direct user grant 는 그룹 소속과 무관하게 해당 사용자에게만 허용된다", async () => {
    const resourceId = randomUUID();
    await grants.grant(
      org.id,
      "model",
      resourceId,
      "user",
      directUser.id,
      "read",
    );

    const directUserCanRead = await canAccessResource(grants, {
      orgId: org.id,
      userId: directUser.id,
      resourceType: "model",
      resourceId,
      access: "read",
    });
    expect(directUserCanRead).toBe(true);

    const memberCanRead = await canAccessResource(grants, {
      orgId: org.id,
      userId: member.id,
      resourceType: "model",
      resourceId,
      access: "read",
    });
    expect(memberCanRead).toBe(false);
  });

  it("cross-org: 다른 org 의 grant 조회에는 이 org 의 grant 가 섞이지 않는다", async () => {
    const resourceId = randomUUID();
    await grants.grant(org.id, "tool", resourceId, "group", groupId, "read");

    const otherOrgGrants = await grants.grantsForResource(
      otherOrg.id,
      "tool",
      resourceId,
    );
    expect(otherOrgGrants).toEqual([]);
  });
});
