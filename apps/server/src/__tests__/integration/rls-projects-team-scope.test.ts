// 0015_project_team_scope_rls.sql 이 만드는 projects_select RLS 의 visibility 매트릭스를 검증.
// 단일 출처: rebuild_plan/08-SPRINT-PLAN.md § Phase 3 visibility 매트릭스.
// non-member 는 3 갈래(같은 org_unit / 같은 org 다른 org_unit / 다른 org)로 분기 —
// 3 visibility(private/team/org) × 3 non-member 분기 = 정확히 9 actor scenario.
// 실 Postgres 필요 (docker-compose.local.yml 또는 CI test-server-integration 의 service container).
// 마이그레이션은 이 테스트 실행 전 `pnpm db:migrate` 로 이미 적용돼 있어야 한다.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

const ADMIN_URL =
  process.env.DATABASE_URL ??
  "postgres://wchat:localdev@localhost:5432/wchat_dev";

const RLS_ROLE = "rls_proj_scope_test_role";
const RLS_PASSWORD = "rls_proj_scope_test_pw";

function urlForRole(adminUrl: string, user: string, password: string): string {
  const url = new URL(adminUrl);
  url.username = user;
  url.password = password;
  return url.toString();
}

async function asUser<T>(
  client: Client,
  userId: string,
  orgId: string,
  fn: () => Promise<T>,
): Promise<T> {
  await client.query("BEGIN");
  try {
    await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    await client.query("SELECT set_config('app.org_id', $1, true)", [orgId]);
    return await fn();
  } finally {
    await client.query("ROLLBACK");
  }
}

describe("rls (projects visibility matrix — team org_unit scope)", () => {
  const admin = new Client({ connectionString: ADMIN_URL });
  let scoped: Client;

  const orgA = {
    id: randomUUID(),
    domain: `org-scope-a-${randomUUID()}.example.com`,
  };
  const orgB = {
    id: randomUUID(),
    domain: `org-scope-b-${randomUUID()}.example.com`,
  };

  const unitA1 = { id: randomUUID() }; // team project 의 org_unit
  const unitA2 = { id: randomUUID() }; // orgA 소속이지만 다른 org_unit

  const owner = {
    id: randomUUID(),
    email: `owner-${randomUUID()}@x.example.com`,
  };
  const sameUnitUser = {
    id: randomUUID(),
    email: `same-unit-${randomUUID()}@x.example.com`,
  };
  const diffUnitUser = {
    id: randomUUID(),
    email: `diff-unit-${randomUUID()}@x.example.com`,
  };
  const otherOrgUser = {
    id: randomUUID(),
    email: `other-org-${randomUUID()}@x.example.com`,
  };

  const privateProject = { id: randomUUID() };
  const teamProject = { id: randomUUID() };
  const orgProject = { id: randomUUID() };

  beforeAll(async () => {
    await admin.connect();

    await admin.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${RLS_ROLE}') THEN
          CREATE ROLE ${RLS_ROLE} LOGIN PASSWORD '${RLS_PASSWORD}';
        END IF;
      END $$;
    `);
    await admin.query(`GRANT USAGE ON SCHEMA public TO ${RLS_ROLE}`);
    await admin.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON organizations, org_units, users, user_org_units, projects, project_members TO ${RLS_ROLE}`,
    );

    await admin.query(
      "INSERT INTO organizations (id, name, domain) VALUES ($1, 'Org Scope A', $2), ($3, 'Org Scope B', $4)",
      [orgA.id, orgA.domain, orgB.id, orgB.domain],
    );
    await admin.query(
      "INSERT INTO org_units (id, org_id, name, path_key) VALUES ($1, $2, 'Unit A1', 'a1'), ($3, $2, 'Unit A2', 'a2')",
      [unitA1.id, orgA.id, unitA2.id],
    );
    await admin.query(
      "INSERT INTO users (id, org_id, email) VALUES ($1, $2, $3), ($4, $2, $5), ($6, $2, $7), ($8, $9, $10)",
      [
        owner.id,
        orgA.id,
        owner.email,
        sameUnitUser.id,
        sameUnitUser.email,
        diffUnitUser.id,
        diffUnitUser.email,
        otherOrgUser.id,
        orgB.id,
        otherOrgUser.email,
      ],
    );
    await admin.query(
      "INSERT INTO user_org_units (user_id, org_unit_id) VALUES ($1, $2), ($3, $4)",
      [sameUnitUser.id, unitA1.id, diffUnitUser.id, unitA2.id],
    );

    await admin.query(
      "INSERT INTO projects (id, org_id, owner_id, name, visibility, org_unit_id) VALUES ($1, $2, $3, 'Private', 'private', $4)",
      [privateProject.id, orgA.id, owner.id, unitA1.id],
    );
    await admin.query(
      "INSERT INTO projects (id, org_id, owner_id, name, visibility, org_unit_id) VALUES ($1, $2, $3, 'Team', 'team', $4)",
      [teamProject.id, orgA.id, owner.id, unitA1.id],
    );
    await admin.query(
      "INSERT INTO projects (id, org_id, owner_id, name, visibility, org_unit_id) VALUES ($1, $2, $3, 'Org', 'org', $4)",
      [orgProject.id, orgA.id, owner.id, unitA1.id],
    );
    await admin.query(
      "INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'owner'), ($3, $2, 'owner'), ($4, $2, 'owner')",
      [privateProject.id, owner.id, teamProject.id, orgProject.id],
    );

    scoped = new Client({
      connectionString: urlForRole(ADMIN_URL, RLS_ROLE, RLS_PASSWORD),
    });
    await scoped.connect();
  });

  afterAll(async () => {
    await admin.query(
      "DELETE FROM project_members WHERE project_id = ANY($1::uuid[])",
      [[privateProject.id, teamProject.id, orgProject.id]],
    );
    await admin.query("DELETE FROM projects WHERE id = ANY($1::uuid[])", [
      [privateProject.id, teamProject.id, orgProject.id],
    ]);
    await admin.query(
      "DELETE FROM user_org_units WHERE user_id = ANY($1::uuid[])",
      [[sameUnitUser.id, diffUnitUser.id]],
    );
    await admin.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [
      [owner.id, sameUnitUser.id, diffUnitUser.id, otherOrgUser.id],
    ]);
    await admin.query("DELETE FROM org_units WHERE id = ANY($1::uuid[])", [
      [unitA1.id, unitA2.id],
    ]);
    await admin.query("DELETE FROM organizations WHERE id = ANY($1::uuid[])", [
      [orgA.id, orgB.id],
    ]);
    await scoped?.end();
    await admin.end();
  });

  async function canSee(
    project: { id: string },
    actor: { id: string },
    orgId: string,
  ): Promise<boolean> {
    const rows = await asUser(scoped, actor.id, orgId, async () => {
      const res = await scoped.query("SELECT id FROM projects WHERE id = $1", [
        project.id,
      ]);
      return res.rows;
    });
    return rows.length === 1;
  }

  // 3 visibility × 3 non-member 분기 = 정확히 9 actor scenario (08-SPRINT-PLAN.md § Phase 3 visibility 매트릭스 단일 출처)
  it("private: 같은 org_unit 비멤버는 볼 수 없다 (404)", async () => {
    expect(await canSee(privateProject, sameUnitUser, orgA.id)).toBe(false);
  });
  it("private: 같은 org 다른 org_unit 비멤버는 볼 수 없다 (404)", async () => {
    expect(await canSee(privateProject, diffUnitUser, orgA.id)).toBe(false);
  });
  it("private: 다른 org 사용자는 볼 수 없다 (404)", async () => {
    expect(await canSee(privateProject, otherOrgUser, orgB.id)).toBe(false);
  });

  it("team: 같은 org_unit 비멤버는 read 할 수 있다", async () => {
    expect(await canSee(teamProject, sameUnitUser, orgA.id)).toBe(true);
  });
  it("team: 같은 org 다른 org_unit 비멤버는 볼 수 없다 (404, org_unit 불일치)", async () => {
    expect(await canSee(teamProject, diffUnitUser, orgA.id)).toBe(false);
  });
  it("team: 다른 org 사용자는 볼 수 없다 (404)", async () => {
    expect(await canSee(teamProject, otherOrgUser, orgB.id)).toBe(false);
  });

  it("org: 같은 org_unit 비멤버는 read 할 수 있다", async () => {
    expect(await canSee(orgProject, sameUnitUser, orgA.id)).toBe(true);
  });
  it("org: 같은 org 다른 org_unit 비멤버도 read 할 수 있다", async () => {
    expect(await canSee(orgProject, diffUnitUser, orgA.id)).toBe(true);
  });
  it("org: 다른 org 사용자는 볼 수 없다 (404)", async () => {
    expect(await canSee(orgProject, otherOrgUser, orgB.id)).toBe(false);
  });
});
