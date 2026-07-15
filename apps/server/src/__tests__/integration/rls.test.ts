// 0001_identity.sql 이 만드는 RLS 정책의 실제 동작을 검증.
// 실 Postgres 필요 (docker-compose.local.yml 또는 CI test-server-integration 의 service container).
// 마이그레이션은 이 테스트 실행 전 `pnpm db:migrate` 로 이미 적용돼 있어야 한다 (test-server-integration job 패턴).
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

const ADMIN_URL =
  process.env.DATABASE_URL ??
  "postgres://wchat:localdev@localhost:5432/wchat_dev";

const RLS_ROLE = "rls_test_role";
const RLS_PASSWORD = "rls_test_pw";

function urlForRole(adminUrl: string, user: string, password: string): string {
  const url = new URL(adminUrl);
  url.username = user;
  url.password = password;
  return url.toString();
}

async function withTransaction<T>(
  client: Client,
  orgId: string,
  userId: string,
  fn: () => Promise<T>,
): Promise<T> {
  await client.query("BEGIN");
  try {
    await client.query("SELECT set_config('app.org_id', $1, true)", [orgId]);
    await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    const result = await fn();
    return result;
  } finally {
    await client.query("ROLLBACK");
  }
}

describe("rls (organizations / org_units / users / user_org_units)", () => {
  const admin = new Client({ connectionString: ADMIN_URL });
  let scoped: Client;

  const orgA = {
    id: randomUUID(),
    domain: `org-a-${randomUUID()}.example.com`,
  };
  const orgB = {
    id: randomUUID(),
    domain: `org-b-${randomUUID()}.example.com`,
  };
  const userA = {
    id: randomUUID(),
    email: `user-a-${randomUUID()}@${orgA.domain}`,
  };
  const userB = {
    id: randomUUID(),
    email: `user-b-${randomUUID()}@${orgB.domain}`,
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
      `GRANT SELECT, INSERT, UPDATE, DELETE ON organizations, org_units, users, user_org_units TO ${RLS_ROLE}`,
    );

    // 초기 데이터는 superuser 연결로 삽입 (superuser 는 RLS 무조건 우회 — FORCE 무관).
    await admin.query(
      "INSERT INTO organizations (id, name, domain) VALUES ($1, 'Org A', $2), ($3, 'Org B', $4)",
      [orgA.id, orgA.domain, orgB.id, orgB.domain],
    );
    await admin.query(
      "INSERT INTO users (id, org_id, email) VALUES ($1, $2, $3), ($4, $5, $6)",
      [userA.id, orgA.id, userA.email, userB.id, orgB.id, userB.email],
    );

    scoped = new Client({
      connectionString: urlForRole(ADMIN_URL, RLS_ROLE, RLS_PASSWORD),
    });
    await scoped.connect();
  });

  afterAll(async () => {
    await admin.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [
      [userA.id, userB.id],
    ]);
    await admin.query("DELETE FROM organizations WHERE id = ANY($1::uuid[])", [
      [orgA.id, orgB.id],
    ]);
    await scoped?.end();
    await admin.end();
  });

  it("org A 사용자는 organizations 조회 시 자기 org 만 보인다", async () => {
    const rows = await withTransaction(scoped, orgA.id, userA.id, async () => {
      const res = await scoped.query(
        "SELECT id FROM organizations WHERE id = ANY($1::uuid[])",
        [[orgA.id, orgB.id]],
      );
      return res.rows;
    });
    expect(rows.map((r) => r.id)).toEqual([orgA.id]);
  });

  it("org A 사용자는 users 조회 시 org B 사용자를 볼 수 없다", async () => {
    const rows = await withTransaction(scoped, orgA.id, userA.id, async () => {
      const res = await scoped.query(
        "SELECT id FROM users WHERE id = ANY($1::uuid[])",
        [[userA.id, userB.id]],
      );
      return res.rows;
    });
    expect(rows.map((r) => r.id)).toEqual([userA.id]);
  });

  it("org A 사용자는 org B 의 organizations row 를 UPDATE 해도 0 row 영향(RLS 차단)", async () => {
    const rowCount = await withTransaction(
      scoped,
      orgA.id,
      userA.id,
      async () => {
        const res = await scoped.query(
          "UPDATE organizations SET name = 'hacked' WHERE id = $1",
          [orgB.id],
        );
        return res.rowCount;
      },
    );
    expect(rowCount).toBe(0);
  });

  it("app.org_id 가 설정되지 않으면 organizations 조회 결과가 비어있다", async () => {
    await scoped.query("BEGIN");
    try {
      const res = await scoped.query(
        "SELECT id FROM organizations WHERE id = ANY($1::uuid[])",
        [[orgA.id, orgB.id]],
      );
      expect(res.rows).toEqual([]);
    } finally {
      await scoped.query("ROLLBACK");
    }
  });
});
