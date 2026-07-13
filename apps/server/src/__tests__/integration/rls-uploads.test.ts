// 0014_uploads.sql 이 만드는 RLS 정책(uploads_owner_*/ephemeral_chunks_session_owner)의 실제 동작을 검증.
// 실 Postgres 필요 (docker-compose.local.yml 또는 CI test-server-integration 의 service container).
// 마이그레이션은 이 테스트 실행 전 `pnpm db:migrate` 로 이미 적용돼 있어야 한다.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

const ADMIN_URL =
  process.env.DATABASE_URL ??
  "postgres://wchat:localdev@localhost:5432/wchat_dev";

const RLS_ROLE = "rls_uploads_test_role";
const RLS_PASSWORD = "rls_uploads_test_pw";

function urlForRole(adminUrl: string, user: string, password: string): string {
  const url = new URL(adminUrl);
  url.username = user;
  url.password = password;
  return url.toString();
}

async function asUser<T>(
  client: Client,
  userId: string,
  fn: () => Promise<T>,
): Promise<T> {
  await client.query("BEGIN");
  try {
    await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    return await fn();
  } finally {
    await client.query("ROLLBACK");
  }
}

describe("rls (uploads / ephemeral_chunks)", () => {
  const admin = new Client({ connectionString: ADMIN_URL });
  let scoped: Client;

  const org = {
    id: randomUUID(),
    domain: `org-uploads-${randomUUID()}.example.com`,
  };
  const owner = {
    id: randomUUID(),
    email: `owner-${randomUUID()}@x.example.com`,
  };
  const outsider = {
    id: randomUUID(),
    email: `outsider-${randomUUID()}@x.example.com`,
  };

  const upload = { id: randomUUID() };
  const session = { id: randomUUID() };
  const chunk = { id: randomUUID() };

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
      `GRANT SELECT, INSERT, UPDATE, DELETE ON organizations, users, sessions, uploads, ephemeral_chunks TO ${RLS_ROLE}`,
    );

    await admin.query(
      "INSERT INTO organizations (id, name, domain) VALUES ($1, 'Org Uploads', $2)",
      [org.id, org.domain],
    );
    await admin.query(
      "INSERT INTO users (id, org_id, email) VALUES ($1, $2, $3), ($4, $2, $5)",
      [owner.id, org.id, owner.email, outsider.id, outsider.email],
    );
    await admin.query(
      "INSERT INTO sessions (id, user_id, title) VALUES ($1, $2, 'Upload session')",
      [session.id, owner.id],
    );
    await admin.query(
      "INSERT INTO uploads (id, user_id, session_id, filename, mime_type, size_bytes, s3_key, sha256, expires_at) VALUES ($1, $2, $3, 'a.pdf', 'application/pdf', 100, 's3://a', 'sha-a', NOW() + INTERVAL '30 days')",
      [upload.id, owner.id, session.id],
    );
    await admin.query(
      "INSERT INTO ephemeral_chunks (id, session_id, upload_id, chunk_index, content, embedding) VALUES ($1, $2, $3, 0, 'hello world', $4)",
      [
        chunk.id,
        session.id,
        upload.id,
        `[${new Array(1024).fill(0).join(",")}]`,
      ],
    );

    scoped = new Client({
      connectionString: urlForRole(ADMIN_URL, RLS_ROLE, RLS_PASSWORD),
    });
    await scoped.connect();
  });

  afterAll(async () => {
    await admin.query("DELETE FROM ephemeral_chunks WHERE id = $1", [chunk.id]);
    await admin.query("DELETE FROM uploads WHERE id = $1", [upload.id]);
    await admin.query("DELETE FROM sessions WHERE id = $1", [session.id]);
    await admin.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [
      [owner.id, outsider.id],
    ]);
    await admin.query("DELETE FROM organizations WHERE id = $1", [org.id]);
    await scoped?.end();
    await admin.end();
  });

  it("업로드한 본인은 uploads 를 읽을 수 있다", async () => {
    const rows = await asUser(scoped, owner.id, async () => {
      const res = await scoped.query("SELECT id FROM uploads WHERE id = $1", [
        upload.id,
      ]);
      return res.rows;
    });
    expect(rows).toEqual([{ id: upload.id }]);
  });

  it("다른 사용자는 uploads 를 읽을 수 없다 (existence-leak 방지)", async () => {
    const rows = await asUser(scoped, outsider.id, async () => {
      const res = await scoped.query("SELECT id FROM uploads WHERE id = $1", [
        upload.id,
      ]);
      return res.rows;
    });
    expect(rows).toEqual([]);
  });

  it("다른 사용자는 uploads 를 UPDATE 할 수 없다", async () => {
    const rowCount = await asUser(scoped, outsider.id, async () => {
      const res = await scoped.query(
        "UPDATE uploads SET filename = 'hacked.pdf' WHERE id = $1",
        [upload.id],
      );
      return res.rowCount;
    });
    expect(rowCount).toBe(0);
  });

  it("본인은 uploads 를 UPDATE 할 수 있다", async () => {
    const rowCount = await asUser(scoped, owner.id, async () => {
      const res = await scoped.query(
        "UPDATE uploads SET filename = 'renamed.pdf' WHERE id = $1",
        [upload.id],
      );
      return res.rowCount;
    });
    expect(rowCount).toBe(1);
    await admin.query("UPDATE uploads SET filename = $1 WHERE id = $2", [
      "a.pdf",
      upload.id,
    ]);
  });

  it("세션 소유자는 ephemeral_chunks 를 읽을 수 있다", async () => {
    const rows = await asUser(scoped, owner.id, async () => {
      const res = await scoped.query(
        "SELECT id FROM ephemeral_chunks WHERE id = $1",
        [chunk.id],
      );
      return res.rows;
    });
    expect(rows).toEqual([{ id: chunk.id }]);
  });

  it("세션 비소유자는 ephemeral_chunks 를 읽을 수 없다", async () => {
    const rows = await asUser(scoped, outsider.id, async () => {
      const res = await scoped.query(
        "SELECT id FROM ephemeral_chunks WHERE id = $1",
        [chunk.id],
      );
      return res.rows;
    });
    expect(rows).toEqual([]);
  });

  it("app.user_id 가 설정되지 않으면 uploads 결과가 비어있다", async () => {
    await scoped.query("BEGIN");
    try {
      const res = await scoped.query("SELECT id FROM uploads WHERE id = $1", [
        upload.id,
      ]);
      expect(res.rows).toEqual([]);
    } finally {
      await scoped.query("ROLLBACK");
    }
  });
});
