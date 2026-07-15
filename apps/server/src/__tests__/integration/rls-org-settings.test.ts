// 0017_org_settings.sql 이 만드는 RLS 정책(org_settings_select/org_settings_modify_admin)의 실제 동작을 검증.
// 실 Postgres 필요 (docker-compose.local.yml 또는 CI test-server-integration 의 service container).
// 마이그레이션은 이 테스트 실행 전 `pnpm db:migrate` 로 이미 적용돼 있어야 한다.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

const ADMIN_URL =
  process.env.DATABASE_URL ??
  "postgres://wchat:localdev@localhost:5432/wchat_dev";

const RLS_ROLE = "rls_org_settings_test_role";
const RLS_PASSWORD = "rls_org_settings_test_pw";

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

describe("rls (org_settings)", () => {
  const admin = new Client({ connectionString: ADMIN_URL });
  let scoped: Client;

  const orgA = {
    id: randomUUID(),
    domain: `org-settings-a-${randomUUID()}.example.com`,
  };
  const orgB = {
    id: randomUUID(),
    domain: `org-settings-b-${randomUUID()}.example.com`,
  };
  const adminA = {
    id: randomUUID(),
    email: `admin-a-${randomUUID()}@x.example.com`,
  };
  const memberA = {
    id: randomUUID(),
    email: `member-a-${randomUUID()}@x.example.com`,
  };
  const adminB = {
    id: randomUUID(),
    email: `admin-b-${randomUUID()}@x.example.com`,
  };

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
      `GRANT SELECT, INSERT, UPDATE, DELETE ON organizations, users, org_settings TO ${RLS_ROLE}`,
    );

    await admin.query(
      "INSERT INTO organizations (id, name, domain) VALUES ($1, 'Org Settings A', $2), ($3, 'Org Settings B', $4)",
      [orgA.id, orgA.domain, orgB.id, orgB.domain],
    );
    await admin.query(
      "INSERT INTO users (id, org_id, email, role) VALUES ($1, $2, $3, 'admin'), ($4, $2, $5, 'member'), ($6, $7, $8, 'admin')",
      [
        adminA.id,
        orgA.id,
        adminA.email,
        memberA.id,
        memberA.email,
        adminB.id,
        orgB.id,
        adminB.email,
      ],
    );
    await admin.query(
      "INSERT INTO org_settings (org_id, settings, updated_by) VALUES ($1, $2, $3)",
      [orgA.id, JSON.stringify({ maxTokens: 8192 }), adminA.id],
    );

    scoped = new Client({
      connectionString: urlForRole(ADMIN_URL, RLS_ROLE, RLS_PASSWORD),
    });
    await scoped.connect();
  });

  afterAll(async () => {
    await admin.query(
      "DELETE FROM org_settings WHERE org_id = ANY($1::uuid[])",
      [[orgA.id, orgB.id]],
    );
    await admin.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [
      [adminA.id, memberA.id, adminB.id],
    ]);
    await admin.query("DELETE FROM organizations WHERE id = ANY($1::uuid[])", [
      [orgA.id, orgB.id],
    ]);
    await scoped?.end();
    await admin.end();
  });

  it("org A admin 은 자기 org 의 설정을 SELECT 할 수 있다", async () => {
    const rows = await asUser(scoped, adminA.id, orgA.id, async () => {
      const res = await scoped.query(
        "SELECT org_id, settings FROM org_settings WHERE org_id = $1",
        [orgA.id],
      );
      return res.rows;
    });
    expect(rows).toEqual([{ org_id: orgA.id, settings: { maxTokens: 8192 } }]);
  });

  it("org A member 도 자기 org 의 설정을 SELECT 할 수 있다 (select 정책은 org-scope, admin 한정 아님)", async () => {
    const rows = await asUser(scoped, memberA.id, orgA.id, async () => {
      const res = await scoped.query(
        "SELECT org_id FROM org_settings WHERE org_id = $1",
        [orgA.id],
      );
      return res.rows;
    });
    expect(rows).toEqual([{ org_id: orgA.id }]);
  });

  it("org B admin 은 org A 의 설정을 SELECT 할 수 없다 (cross-org 격리, existence-leak 방지)", async () => {
    const rows = await asUser(scoped, adminB.id, orgB.id, async () => {
      const res = await scoped.query(
        "SELECT org_id FROM org_settings WHERE org_id = $1",
        [orgA.id],
      );
      return res.rows;
    });
    expect(rows).toEqual([]);
  });

  it("org A admin 은 자기 org 의 설정을 UPDATE 할 수 있다", async () => {
    const rowCount = await asUser(scoped, adminA.id, orgA.id, async () => {
      const res = await scoped.query(
        "UPDATE org_settings SET settings = $1 WHERE org_id = $2",
        [JSON.stringify({ maxTokens: 4096 }), orgA.id],
      );
      return res.rowCount;
    });
    expect(rowCount).toBe(1);
  });

  it("org A member 는 자기 org 의 설정이라도 UPDATE 할 수 없다 (admin 만 modify)", async () => {
    const rowCount = await asUser(scoped, memberA.id, orgA.id, async () => {
      const res = await scoped.query(
        "UPDATE org_settings SET settings = $1 WHERE org_id = $2",
        [JSON.stringify({ maxTokens: 1 }), orgA.id],
      );
      return res.rowCount;
    });
    expect(rowCount).toBe(0);
  });

  it("org B admin 은 org A 의 설정을 UPDATE 할 수 없다 (cross-org 격리)", async () => {
    const rowCount = await asUser(scoped, adminB.id, orgB.id, async () => {
      const res = await scoped.query(
        "UPDATE org_settings SET settings = $1 WHERE org_id = $2",
        [JSON.stringify({ maxTokens: 1 }), orgA.id],
      );
      return res.rowCount;
    });
    expect(rowCount).toBe(0);
  });

  it("org B admin 은 org B 로 신규 설정 행을 INSERT 할 수 있다 (같은 org + admin)", async () => {
    const rowCount = await asUser(scoped, adminB.id, orgB.id, async () => {
      const res = await scoped.query(
        "INSERT INTO org_settings (org_id, settings, updated_by) VALUES ($1, $2, $3)",
        [orgB.id, JSON.stringify({ maxTokens: 4096 }), adminB.id],
      );
      return res.rowCount;
    });
    expect(rowCount).toBe(1);
  });

  it("app.org_id 가 설정되지 않으면 org_settings 결과가 비어있다", async () => {
    await scoped.query("BEGIN");
    try {
      const res = await scoped.query(
        "SELECT org_id FROM org_settings WHERE org_id = $1",
        [orgA.id],
      );
      expect(res.rows).toEqual([]);
    } finally {
      await scoped.query("ROLLBACK");
    }
  });
});
