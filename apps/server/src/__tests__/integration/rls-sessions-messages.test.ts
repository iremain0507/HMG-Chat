// 0002_sessions_messages.sql 이 만드는 RLS 정책의 실제 동작을 검증.
// 실 Postgres 필요 (docker-compose.local.yml 또는 CI test-server-integration 의 service container).
// 마이그레이션은 이 테스트 실행 전 `pnpm db:migrate` 로 이미 적용돼 있어야 한다.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

const ADMIN_URL =
  process.env.DATABASE_URL ??
  "postgres://wchat:localdev@localhost:5432/wchat_dev";

const RLS_ROLE = "rls_sm_test_role";
const RLS_PASSWORD = "rls_sm_test_pw";

function urlForRole(adminUrl: string, user: string, password: string): string {
  const url = new URL(adminUrl);
  url.username = user;
  url.password = password;
  return url.toString();
}

async function withTransaction<T>(
  client: Client,
  userId: string,
  fn: () => Promise<T>,
): Promise<T> {
  await client.query("BEGIN");
  try {
    await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    const result = await fn();
    return result;
  } finally {
    await client.query("ROLLBACK");
  }
}

describe("rls (sessions / messages)", () => {
  const admin = new Client({ connectionString: ADMIN_URL });
  let scoped: Client;

  const org = {
    id: randomUUID(),
    domain: `org-sm-${randomUUID()}.example.com`,
  };
  const userA = {
    id: randomUUID(),
    email: `user-a-${randomUUID()}@${org.domain}`,
  };
  const userB = {
    id: randomUUID(),
    email: `user-b-${randomUUID()}@${org.domain}`,
  };
  const sessionA = { id: randomUUID() };
  const sessionB = { id: randomUUID() };
  const messageA = { id: randomUUID() };
  const messageB = { id: randomUUID() };

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
      `GRANT SELECT, INSERT, UPDATE, DELETE ON organizations, users, sessions, messages TO ${RLS_ROLE}`,
    );

    await admin.query(
      "INSERT INTO organizations (id, name, domain) VALUES ($1, 'Org SM', $2)",
      [org.id, org.domain],
    );
    await admin.query(
      "INSERT INTO users (id, org_id, email) VALUES ($1, $2, $3), ($4, $2, $5)",
      [userA.id, org.id, userA.email, userB.id, userB.email],
    );
    await admin.query(
      "INSERT INTO sessions (id, user_id, title) VALUES ($1, $2, 'A'), ($3, $4, 'B')",
      [sessionA.id, userA.id, sessionB.id, userB.id],
    );
    await admin.query(
      "INSERT INTO messages (id, session_id, role, content) VALUES ($1, $2, 'user', '{}'::jsonb), ($3, $4, 'user', '{}'::jsonb)",
      [messageA.id, sessionA.id, messageB.id, sessionB.id],
    );

    scoped = new Client({
      connectionString: urlForRole(ADMIN_URL, RLS_ROLE, RLS_PASSWORD),
    });
    await scoped.connect();
  });

  afterAll(async () => {
    await admin.query("DELETE FROM messages WHERE id = ANY($1::uuid[])", [
      [messageA.id, messageB.id],
    ]);
    await admin.query("DELETE FROM sessions WHERE id = ANY($1::uuid[])", [
      [sessionA.id, sessionB.id],
    ]);
    await admin.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [
      [userA.id, userB.id],
    ]);
    await admin.query("DELETE FROM organizations WHERE id = $1", [org.id]);
    await scoped?.end();
    await admin.end();
  });

  it("userA 는 sessions 조회 시 본인 세션만 보인다", async () => {
    const rows = await withTransaction(scoped, userA.id, async () => {
      const res = await scoped.query(
        "SELECT id FROM sessions WHERE id = ANY($1::uuid[])",
        [[sessionA.id, sessionB.id]],
      );
      return res.rows;
    });
    expect(rows.map((r) => r.id)).toEqual([sessionA.id]);
  });

  it("userA 는 messages 조회 시 본인 세션의 메시지만 보인다 (session 경유 RLS)", async () => {
    const rows = await withTransaction(scoped, userA.id, async () => {
      const res = await scoped.query(
        "SELECT id FROM messages WHERE id = ANY($1::uuid[])",
        [[messageA.id, messageB.id]],
      );
      return res.rows;
    });
    expect(rows.map((r) => r.id)).toEqual([messageA.id]);
  });

  it("userA 는 userB 의 session 을 UPDATE 해도 0 row 영향(RLS 차단)", async () => {
    const rowCount = await withTransaction(scoped, userA.id, async () => {
      const res = await scoped.query(
        "UPDATE sessions SET title = 'hacked' WHERE id = $1",
        [sessionB.id],
      );
      return res.rowCount;
    });
    expect(rowCount).toBe(0);
  });

  it("app.user_id 가 설정되지 않으면 sessions 조회 결과가 비어있다", async () => {
    await scoped.query("BEGIN");
    try {
      const res = await scoped.query(
        "SELECT id FROM sessions WHERE id = ANY($1::uuid[])",
        [[sessionA.id, sessionB.id]],
      );
      expect(res.rows).toEqual([]);
    } finally {
      await scoped.query("ROLLBACK");
    }
  });
});
