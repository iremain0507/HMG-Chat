// 0004_projects_members.sql 이 만드는 RLS 정책 + bootstrap_project_owner 함수의 실제 동작을 검증.
// 실 Postgres 필요 (docker-compose.local.yml 또는 CI test-server-integration 의 service container).
// 마이그레이션은 이 테스트 실행 전 `pnpm db:migrate` 로 이미 적용돼 있어야 한다.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

const ADMIN_URL =
  process.env.DATABASE_URL ??
  "postgres://wchat:localdev@localhost:5432/wchat_dev";

const RLS_ROLE = "rls_proj_test_role";
const RLS_PASSWORD = "rls_proj_test_pw";

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

describe("rls (projects / project_members)", () => {
  const admin = new Client({ connectionString: ADMIN_URL });
  let scoped: Client;

  const org = {
    id: randomUUID(),
    domain: `org-proj-${randomUUID()}.example.com`,
  };
  const owner = {
    id: randomUUID(),
    email: `owner-${randomUUID()}@x.example.com`,
  };
  const member = {
    id: randomUUID(),
    email: `member-${randomUUID()}@x.example.com`,
  };
  const outsider = {
    id: randomUUID(),
    email: `outsider-${randomUUID()}@x.example.com`,
  };

  const orgProject = { id: randomUUID() }; // visibility='org'
  const privateProject = { id: randomUUID() }; // visibility='private', owner 만 member

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
      `GRANT SELECT, INSERT, UPDATE, DELETE ON organizations, users, projects, project_members TO ${RLS_ROLE}`,
    );

    await admin.query(
      "INSERT INTO organizations (id, name, domain) VALUES ($1, 'Org Proj', $2)",
      [org.id, org.domain],
    );
    await admin.query(
      "INSERT INTO users (id, org_id, email) VALUES ($1, $2, $3), ($4, $2, $5), ($6, $2, $7)",
      [
        owner.id,
        org.id,
        owner.email,
        member.id,
        member.email,
        outsider.id,
        outsider.email,
      ],
    );
    await admin.query(
      "INSERT INTO projects (id, org_id, owner_id, name, visibility) VALUES ($1, $2, $3, 'Org Visible', 'org')",
      [orgProject.id, org.id, owner.id],
    );
    await admin.query(
      "INSERT INTO projects (id, org_id, owner_id, name, visibility) VALUES ($1, $2, $3, 'Private', 'private')",
      [privateProject.id, org.id, owner.id],
    );
    await admin.query(
      "INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'owner'), ($3, $2, 'owner')",
      [orgProject.id, owner.id, privateProject.id],
    );

    scoped = new Client({
      connectionString: urlForRole(ADMIN_URL, RLS_ROLE, RLS_PASSWORD),
    });
    await scoped.connect();
  });

  afterAll(async () => {
    await admin.query(
      "DELETE FROM project_members WHERE project_id = ANY($1::uuid[])",
      [[orgProject.id, privateProject.id]],
    );
    await admin.query("DELETE FROM projects WHERE id = ANY($1::uuid[])", [
      [orgProject.id, privateProject.id],
    ]);
    await admin.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [
      [owner.id, member.id, outsider.id],
    ]);
    await admin.query("DELETE FROM organizations WHERE id = $1", [org.id]);
    await scoped?.end();
    await admin.end();
  });

  it("같은 org 의 비멤버는 visibility=org 프로젝트를 볼 수 있다", async () => {
    const rows = await asUser(scoped, member.id, org.id, async () => {
      const res = await scoped.query(
        "SELECT id FROM projects WHERE id = ANY($1::uuid[])",
        [[orgProject.id, privateProject.id]],
      );
      return res.rows;
    });
    expect(rows.map((r) => r.id)).toEqual([orgProject.id]);
  });

  it("비멤버는 visibility=private 프로젝트를 볼 수 없다", async () => {
    const rows = await asUser(scoped, member.id, org.id, async () => {
      const res = await scoped.query("SELECT id FROM projects WHERE id = $1", [
        privateProject.id,
      ]);
      return res.rows;
    });
    expect(rows).toEqual([]);
  });

  it("INSERT 시 owner_id 가 요청자 자신이 아니면 거부된다(RLS WITH CHECK)", async () => {
    await expect(
      asUser(scoped, member.id, org.id, async () => {
        await scoped.query(
          "INSERT INTO projects (id, org_id, owner_id, name, visibility) VALUES ($1, $2, $3, 'Spoofed', 'org')",
          [randomUUID(), org.id, outsider.id],
        );
      }),
    ).rejects.toThrow();
  });

  it("bootstrap_project_owner 는 최초 owner row 를 생성한다", async () => {
    const newProjectId = randomUUID();
    await admin.query(
      "INSERT INTO projects (id, org_id, owner_id, name, visibility) VALUES ($1, $2, $3, 'Bootstrap', 'private')",
      [newProjectId, org.id, owner.id],
    );
    try {
      const rows = await asUser(scoped, owner.id, org.id, async () => {
        await scoped.query("SELECT bootstrap_project_owner($1, $2)", [
          newProjectId,
          owner.id,
        ]);
        const res = await scoped.query(
          "SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2",
          [newProjectId, owner.id],
        );
        return res.rows;
      });
      expect(rows).toEqual([{ role: "owner" }]);
    } finally {
      await admin.query("DELETE FROM projects WHERE id = $1", [newProjectId]);
    }
  });

  it("bootstrap_project_owner 는 다른 user_id 로 호출하면 거부된다", async () => {
    await expect(
      asUser(scoped, outsider.id, org.id, async () => {
        await scoped.query("SELECT bootstrap_project_owner($1, $2)", [
          privateProject.id,
          owner.id,
        ]);
      }),
    ).rejects.toThrow();
  });

  it("bootstrap_project_owner 는 이미 owner 가 있으면 거부된다(중복 호출 방지)", async () => {
    await expect(
      asUser(scoped, owner.id, org.id, async () => {
        await scoped.query("SELECT bootstrap_project_owner($1, $2)", [
          privateProject.id,
          owner.id,
        ]);
      }),
    ).rejects.toThrow();
  });

  it("project_members 가 아닌 사용자는 project_members 를 수정할 수 없다", async () => {
    const rowCount = await asUser(scoped, outsider.id, org.id, async () => {
      const res = await scoped.query(
        "UPDATE project_members SET role = 'viewer' WHERE project_id = $1 AND user_id = $2",
        [privateProject.id, owner.id],
      );
      return res.rowCount;
    });
    expect(rowCount).toBe(0);
  });
});
