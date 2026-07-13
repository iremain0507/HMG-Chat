// 0007_artifact_shares.sql 이 만드는 RLS 정책(artifact_shares_issuer_or_admin)의 실제 동작을
// 검증 — issuer 본인, 같은-org admin, 다른-org admin, 무관계 유저 4가지 케이스. 실 Postgres
// 필요 (docker-compose.local.yml 또는 CI test-server-integration 의 service container).
// 마이그레이션은 이 테스트 실행 전 `pnpm db:migrate` 로 이미 적용돼 있어야 한다.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

const ADMIN_URL =
  process.env.DATABASE_URL ??
  "postgres://wchat:localdev@localhost:5432/wchat_dev";

const RLS_ROLE = "rls_artifact_shares_test_role";
const RLS_PASSWORD = "rls_artifact_shares_test_pw";

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

describe("rls (artifact_shares)", () => {
  const admin = new Client({ connectionString: ADMIN_URL });
  let scoped: Client;

  const orgA = {
    id: randomUUID(),
    domain: `org-shares-a-${randomUUID()}.example.com`,
  };
  const orgB = {
    id: randomUUID(),
    domain: `org-shares-b-${randomUUID()}.example.com`,
  };
  const issuer = {
    id: randomUUID(),
    email: `issuer-${randomUUID()}@x.example.com`,
  };
  const sameOrgAdmin = {
    id: randomUUID(),
    email: `admin-a-${randomUUID()}@x.example.com`,
  };
  const otherOrgAdmin = {
    id: randomUUID(),
    email: `admin-b-${randomUUID()}@x.example.com`,
  };
  const outsider = {
    id: randomUUID(),
    email: `outsider-${randomUUID()}@x.example.com`,
  };

  const artifact = { id: randomUUID() };
  const share = { id: randomUUID(), token: randomUUID() };

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
      `GRANT SELECT, INSERT, UPDATE, DELETE ON organizations, users, sessions, artifacts, artifact_shares TO ${RLS_ROLE}`,
    );

    await admin.query(
      "INSERT INTO organizations (id, name, domain) VALUES ($1, 'Org Shares A', $2), ($3, 'Org Shares B', $4)",
      [orgA.id, orgA.domain, orgB.id, orgB.domain],
    );
    await admin.query(
      `INSERT INTO users (id, org_id, email, role) VALUES
         ($1, $2, $3, 'member'),
         ($4, $2, $5, 'admin'),
         ($6, $7, $8, 'admin'),
         ($9, $2, $10, 'member')`,
      [
        issuer.id,
        orgA.id,
        issuer.email,
        sameOrgAdmin.id,
        sameOrgAdmin.email,
        otherOrgAdmin.id,
        orgB.id,
        otherOrgAdmin.email,
        outsider.id,
        outsider.email,
      ],
    );
    await admin.query(
      `INSERT INTO artifacts (id, session_id, created_by, type, filename, size_bytes, storage_kind, inline_content)
       VALUES ($1, NULL, $2, 'markdown', 'note.md', 5, 'inline', 'hello')`,
      [artifact.id, issuer.id],
    );
    await admin.query(
      `INSERT INTO artifact_shares (id, artifact_id, token, issued_by, expires_at, view_count)
       VALUES ($1, $2, $3, $4, NOW() + interval '30 days', 0)`,
      [share.id, artifact.id, share.token, issuer.id],
    );

    scoped = new Client({
      connectionString: urlForRole(ADMIN_URL, RLS_ROLE, RLS_PASSWORD),
    });
    await scoped.connect();
  });

  afterAll(async () => {
    await admin.query("DELETE FROM artifact_shares WHERE id = $1", [share.id]);
    await admin.query("DELETE FROM artifacts WHERE id = $1", [artifact.id]);
    await admin.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [
      [issuer.id, sameOrgAdmin.id, otherOrgAdmin.id, outsider.id],
    ]);
    await admin.query("DELETE FROM organizations WHERE id = ANY($1::uuid[])", [
      [orgA.id, orgB.id],
    ]);
    await scoped?.end();
    await admin.end();
  });

  it("발급자 본인은 share 를 읽을 수 있다", async () => {
    const rows = await asUser(scoped, issuer.id, orgA.id, async () => {
      const res = await scoped.query(
        "SELECT id FROM artifact_shares WHERE id = $1",
        [share.id],
      );
      return res.rows;
    });
    expect(rows).toEqual([{ id: share.id }]);
  });

  it("같은-org admin 은 share 를 읽을 수 있다", async () => {
    const rows = await asUser(scoped, sameOrgAdmin.id, orgA.id, async () => {
      const res = await scoped.query(
        "SELECT id FROM artifact_shares WHERE id = $1",
        [share.id],
      );
      return res.rows;
    });
    expect(rows).toEqual([{ id: share.id }]);
  });

  it("다른-org admin 은 share 를 읽을 수 없다 (org boundary 강제)", async () => {
    const rows = await asUser(scoped, otherOrgAdmin.id, orgB.id, async () => {
      const res = await scoped.query(
        "SELECT id FROM artifact_shares WHERE id = $1",
        [share.id],
      );
      return res.rows;
    });
    expect(rows).toEqual([]);
  });

  it("발급자도 admin 도 아닌 유저는 share 를 읽을 수 없다 (existence-leak 방지)", async () => {
    const rows = await asUser(scoped, outsider.id, orgA.id, async () => {
      const res = await scoped.query(
        "SELECT id FROM artifact_shares WHERE id = $1",
        [share.id],
      );
      return res.rows;
    });
    expect(rows).toEqual([]);
  });

  it("발급자 본인은 revoke(UPDATE revoked_at) 할 수 있다", async () => {
    const rowCount = await asUser(scoped, issuer.id, orgA.id, async () => {
      const res = await scoped.query(
        "UPDATE artifact_shares SET revoked_at = NOW() WHERE id = $1",
        [share.id],
      );
      return res.rowCount;
    });
    expect(rowCount).toBe(1);
    await admin.query(
      "UPDATE artifact_shares SET revoked_at = NULL WHERE id = $1",
      [share.id],
    );
  });

  it("무관계 유저는 revoke 할 수 없다", async () => {
    const rowCount = await asUser(scoped, outsider.id, orgA.id, async () => {
      const res = await scoped.query(
        "UPDATE artifact_shares SET revoked_at = NOW() WHERE id = $1",
        [share.id],
      );
      return res.rowCount;
    });
    expect(rowCount).toBe(0);
  });

  it("app.user_id 가 설정되지 않으면 artifact_shares 결과가 비어있다", async () => {
    await scoped.query("BEGIN");
    try {
      const res = await scoped.query(
        "SELECT id FROM artifact_shares WHERE id = $1",
        [share.id],
      );
      expect(res.rows).toEqual([]);
    } finally {
      await scoped.query("ROLLBACK");
    }
  });
});
