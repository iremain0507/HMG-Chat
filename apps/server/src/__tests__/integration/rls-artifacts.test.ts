// 0006_artifacts_revisions.sql 이 만드는 RLS 정책(artifacts_owner_or_session/artifact_revisions_via_artifact)의
// 실제 동작을 검증. 실 Postgres 필요 (docker-compose.local.yml 또는 CI test-server-integration 의 service container).
// 마이그레이션은 이 테스트 실행 전 `pnpm db:migrate` 로 이미 적용돼 있어야 한다.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

const ADMIN_URL =
  process.env.DATABASE_URL ??
  "postgres://wchat:localdev@localhost:5432/wchat_dev";

const RLS_ROLE = "rls_artifacts_test_role";
const RLS_PASSWORD = "rls_artifacts_test_pw";

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

describe("rls (artifacts / artifact_revisions)", () => {
  const admin = new Client({ connectionString: ADMIN_URL });
  let scoped: Client;

  const org = {
    id: randomUUID(),
    domain: `org-artifacts-${randomUUID()}.example.com`,
  };
  const owner = {
    id: randomUUID(),
    email: `owner-${randomUUID()}@x.example.com`,
  };
  const outsider = {
    id: randomUUID(),
    email: `outsider-${randomUUID()}@x.example.com`,
  };

  const sessionlessArtifact = { id: randomUUID() };

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
      `GRANT SELECT, INSERT, UPDATE, DELETE ON organizations, users, sessions, artifacts, artifact_revisions TO ${RLS_ROLE}`,
    );

    await admin.query(
      "INSERT INTO organizations (id, name, domain) VALUES ($1, 'Org Artifacts', $2)",
      [org.id, org.domain],
    );
    await admin.query(
      "INSERT INTO users (id, org_id, email) VALUES ($1, $2, $3), ($4, $2, $5)",
      [owner.id, org.id, owner.email, outsider.id, outsider.email],
    );
    // session_id NULL — L03: session 없이도 artifact 생성 가능해야 한다.
    await admin.query(
      `INSERT INTO artifacts (id, session_id, created_by, type, filename, size_bytes, storage_kind, inline_content)
       VALUES ($1, NULL, $2, 'markdown', 'note.md', 5, 'inline', 'hello')`,
      [sessionlessArtifact.id, owner.id],
    );
    await admin.query(
      "INSERT INTO artifact_revisions (artifact_id, version, s3_key) VALUES ($1, 1, $2)",
      [sessionlessArtifact.id, "artifacts/note-v1.md"],
    );

    scoped = new Client({
      connectionString: urlForRole(ADMIN_URL, RLS_ROLE, RLS_PASSWORD),
    });
    await scoped.connect();
  });

  afterAll(async () => {
    await admin.query("DELETE FROM artifact_revisions WHERE artifact_id = $1", [
      sessionlessArtifact.id,
    ]);
    await admin.query("DELETE FROM artifacts WHERE id = $1", [
      sessionlessArtifact.id,
    ]);
    await admin.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [
      [owner.id, outsider.id],
    ]);
    await admin.query("DELETE FROM organizations WHERE id = $1", [org.id]);
    await scoped?.end();
    await admin.end();
  });

  it("session_id 가 NULL 이어도 생성자는 artifact 를 읽을 수 있다", async () => {
    const rows = await asUser(scoped, owner.id, async () => {
      const res = await scoped.query("SELECT id FROM artifacts WHERE id = $1", [
        sessionlessArtifact.id,
      ]);
      return res.rows;
    });
    expect(rows).toEqual([{ id: sessionlessArtifact.id }]);
  });

  it("다른 사용자는 artifact 를 읽을 수 없다 (existence-leak 방지)", async () => {
    const rows = await asUser(scoped, outsider.id, async () => {
      const res = await scoped.query("SELECT id FROM artifacts WHERE id = $1", [
        sessionlessArtifact.id,
      ]);
      return res.rows;
    });
    expect(rows).toEqual([]);
  });

  it("다른 사용자는 artifact 를 UPDATE 할 수 없다", async () => {
    const rowCount = await asUser(scoped, outsider.id, async () => {
      const res = await scoped.query(
        "UPDATE artifacts SET filename = 'hacked.md' WHERE id = $1",
        [sessionlessArtifact.id],
      );
      return res.rowCount;
    });
    expect(rowCount).toBe(0);
  });

  it("생성자는 artifact 를 UPDATE 할 수 있다", async () => {
    const rowCount = await asUser(scoped, owner.id, async () => {
      const res = await scoped.query(
        "UPDATE artifacts SET filename = 'renamed.md' WHERE id = $1",
        [sessionlessArtifact.id],
      );
      return res.rowCount;
    });
    expect(rowCount).toBe(1);
    await admin.query("UPDATE artifacts SET filename = $1 WHERE id = $2", [
      "note.md",
      sessionlessArtifact.id,
    ]);
  });

  it("생성자는 artifact_revisions 를 읽을 수 있다", async () => {
    const rows = await asUser(scoped, owner.id, async () => {
      const res = await scoped.query(
        "SELECT artifact_id, version FROM artifact_revisions WHERE artifact_id = $1",
        [sessionlessArtifact.id],
      );
      return res.rows;
    });
    expect(rows).toEqual([{ artifact_id: sessionlessArtifact.id, version: 1 }]);
  });

  it("다른 사용자는 artifact_revisions 를 읽을 수 없다", async () => {
    const rows = await asUser(scoped, outsider.id, async () => {
      const res = await scoped.query(
        "SELECT artifact_id FROM artifact_revisions WHERE artifact_id = $1",
        [sessionlessArtifact.id],
      );
      return res.rows;
    });
    expect(rows).toEqual([]);
  });

  it("app.user_id 가 설정되지 않으면 artifacts 결과가 비어있다", async () => {
    await scoped.query("BEGIN");
    try {
      const res = await scoped.query("SELECT id FROM artifacts WHERE id = $1", [
        sessionlessArtifact.id,
      ]);
      expect(res.rows).toEqual([]);
    } finally {
      await scoped.query("ROLLBACK");
    }
  });
});
