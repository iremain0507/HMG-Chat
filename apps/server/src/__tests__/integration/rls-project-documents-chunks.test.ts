// 0005_project_documents_chunks.sql 이 만드는 RLS 정책(pd_*/dc_*)의 실제 동작을 검증.
// 실 Postgres 필요 (docker-compose.local.yml 또는 CI test-server-integration 의 service container).
// 마이그레이션은 이 테스트 실행 전 `pnpm db:migrate` 로 이미 적용돼 있어야 한다.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

const ADMIN_URL =
  process.env.DATABASE_URL ??
  "postgres://wchat:localdev@localhost:5432/wchat_dev";

const RLS_ROLE = "rls_docs_test_role";
const RLS_PASSWORD = "rls_docs_test_pw";

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

describe("rls (project_documents / document_chunks)", () => {
  const admin = new Client({ connectionString: ADMIN_URL });
  let scoped: Client;

  const org = {
    id: randomUUID(),
    domain: `org-docs-${randomUUID()}.example.com`,
  };
  const owner = {
    id: randomUUID(),
    email: `owner-${randomUUID()}@x.example.com`,
  };
  const viewer = {
    id: randomUUID(),
    email: `viewer-${randomUUID()}@x.example.com`,
  };
  const outsider = {
    id: randomUUID(),
    email: `outsider-${randomUUID()}@x.example.com`,
  };

  const privateProject = { id: randomUUID() };
  const document = { id: randomUUID() };
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
      `GRANT SELECT, INSERT, UPDATE, DELETE ON organizations, users, projects, project_members, project_documents, document_chunks TO ${RLS_ROLE}`,
    );

    await admin.query(
      "INSERT INTO organizations (id, name, domain) VALUES ($1, 'Org Docs', $2)",
      [org.id, org.domain],
    );
    await admin.query(
      "INSERT INTO users (id, org_id, email) VALUES ($1, $2, $3), ($4, $2, $5), ($6, $2, $7)",
      [
        owner.id,
        org.id,
        owner.email,
        viewer.id,
        viewer.email,
        outsider.id,
        outsider.email,
      ],
    );
    await admin.query(
      "INSERT INTO projects (id, org_id, owner_id, name, visibility) VALUES ($1, $2, $3, 'Docs Project', 'private')",
      [privateProject.id, org.id, owner.id],
    );
    await admin.query(
      "INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'owner'), ($1, $3, 'viewer')",
      [privateProject.id, owner.id, viewer.id],
    );
    await admin.query(
      "INSERT INTO project_documents (id, project_id, filename, content_hash, mime_type, size_bytes, s3_key, created_by) VALUES ($1, $2, 'a.pdf', 'hash-a', 'application/pdf', 100, 's3://a', $3)",
      [document.id, privateProject.id, owner.id],
    );
    await admin.query(
      "INSERT INTO document_chunks (id, document_id, chunk_index, content) VALUES ($1, $2, 0, 'hello world')",
      [chunk.id, document.id],
    );

    scoped = new Client({
      connectionString: urlForRole(ADMIN_URL, RLS_ROLE, RLS_PASSWORD),
    });
    await scoped.connect();
  });

  afterAll(async () => {
    await admin.query("DELETE FROM document_chunks WHERE document_id = $1", [
      document.id,
    ]);
    await admin.query("DELETE FROM project_documents WHERE id = $1", [
      document.id,
    ]);
    await admin.query("DELETE FROM project_members WHERE project_id = $1", [
      privateProject.id,
    ]);
    await admin.query("DELETE FROM projects WHERE id = $1", [
      privateProject.id,
    ]);
    await admin.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [
      [owner.id, viewer.id, outsider.id],
    ]);
    await admin.query("DELETE FROM organizations WHERE id = $1", [org.id]);
    await scoped?.end();
    await admin.end();
  });

  it("project member(viewer) 는 project_documents 를 읽을 수 있다", async () => {
    const rows = await asUser(scoped, viewer.id, org.id, async () => {
      const res = await scoped.query(
        "SELECT id FROM project_documents WHERE id = $1",
        [document.id],
      );
      return res.rows;
    });
    expect(rows).toEqual([{ id: document.id }]);
  });

  it("project member(viewer) 는 document_chunks 를 읽을 수 있다", async () => {
    const rows = await asUser(scoped, viewer.id, org.id, async () => {
      const res = await scoped.query(
        "SELECT id FROM document_chunks WHERE id = $1",
        [chunk.id],
      );
      return res.rows;
    });
    expect(rows).toEqual([{ id: chunk.id }]);
  });

  it("project 의 non-member 는 project_documents 를 읽을 수 없다 (existence-leak 방지)", async () => {
    const rows = await asUser(scoped, outsider.id, org.id, async () => {
      const res = await scoped.query(
        "SELECT id FROM project_documents WHERE id = $1",
        [document.id],
      );
      return res.rows;
    });
    expect(rows).toEqual([]);
  });

  it("project 의 non-member 는 document_chunks 를 읽을 수 없다", async () => {
    const rows = await asUser(scoped, outsider.id, org.id, async () => {
      const res = await scoped.query(
        "SELECT id FROM document_chunks WHERE id = $1",
        [chunk.id],
      );
      return res.rows;
    });
    expect(rows).toEqual([]);
  });

  it("viewer 는 write 권한이 없어 project_documents 를 INSERT 할 수 없다", async () => {
    const rowCount = await asUser(scoped, viewer.id, org.id, async () => {
      const res = await scoped.query(
        "INSERT INTO project_documents (id, project_id, filename, content_hash, mime_type, size_bytes, s3_key, created_by) VALUES ($1, $2, 'b.pdf', 'hash-b', 'application/pdf', 200, 's3://b', $3)",
        [randomUUID(), privateProject.id, viewer.id],
      );
      return res.rowCount;
    }).catch((err: Error) => {
      expect(err).toBeInstanceOf(Error);
      return 0;
    });
    expect(rowCount).toBe(0);
  });

  it("owner 는 write 권한이 있어 document_chunks 를 UPDATE 할 수 있다", async () => {
    const rowCount = await asUser(scoped, owner.id, org.id, async () => {
      const res = await scoped.query(
        "UPDATE document_chunks SET content = 'updated' WHERE id = $1",
        [chunk.id],
      );
      return res.rowCount;
    });
    expect(rowCount).toBe(1);
    await admin.query("UPDATE document_chunks SET content = $1 WHERE id = $2", [
      "hello world",
      chunk.id,
    ]);
  });

  it("viewer 는 write 권한이 없어 document_chunks 를 UPDATE 할 수 없다", async () => {
    const rowCount = await asUser(scoped, viewer.id, org.id, async () => {
      const res = await scoped.query(
        "UPDATE document_chunks SET content = 'hacked' WHERE id = $1",
        [chunk.id],
      );
      return res.rowCount;
    });
    expect(rowCount).toBe(0);
  });
});
