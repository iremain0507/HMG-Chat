// documents-composition.test.ts — P4-T3-07 acceptance: routes/documents.ts 가 app.ts 에 실제
// mount 돼 있는지 + project_documents 목록/조회/삭제(+ content_hash dedup 조회)가 실 HTTP +
// 실 Postgres 레벨에서 동작하는지 검증. 다른 org 의 private 프로젝트 문서 조회/삭제 시
// existence-leak 없이 404 를 반환하는지도 함께 검증 (routes/projects.ts, routes/uploads.ts 와 동일 패턴).
// 목록/조회/삭제 테스트용 문서 row는 rls-project-documents-chunks.test.ts 와 동일하게 admin
// pgPool 로 직접 insert 한다. POST(P4-T3-08)는 실 parser-pipeline+dev-stub embedding 을 거쳐야
// 하므로 실제 multipart 업로드로 검증한다 (knowledge/__tests__/fixtures 의 docx fixture 재사용).
// 마이그레이션은 이 테스트 실행 전 `pnpm db:migrate` 로 이미 적용돼 있어야 한다.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import type { Env } from "../../env.js";
import { pgPool } from "../../db/client.js";
import { signAccessToken } from "../../middleware/jwt.js";
import { createLocalObjectStore } from "../../lib/object-store.js";

const docxFixturePath = new URL(
  "../../knowledge/__tests__/fixtures/single-paragraph.docx",
  import.meta.url,
);

process.env.JWT_SECRET = "test-only-jwt-secret-32chars-minimum-xxxx";
process.env.PROJECT_SLUG = "wchat";

const TEST_ENV: Env = {
  NODE_ENV: "test",
  PORT: 4000,
  DATABASE_URL:
    process.env.DATABASE_URL ??
    "postgres://wchat:localdev@localhost:5432/wchat_dev",
  REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379",
  JWT_SECRET: process.env.JWT_SECRET,
  ALLOWED_DOMAINS: "example.com",
  EMAIL_SENDER_KIND: "test",
};

describe("app.ts /api/v1/documents mount — P4-T3-07", () => {
  const orgA = {
    id: randomUUID(),
    domain: `org-dc-a-${randomUUID()}.example.com`,
  };
  const orgB = {
    id: randomUUID(),
    domain: `org-dc-b-${randomUUID()}.example.com`,
  };
  const userA = {
    id: randomUUID(),
    email: `user-dc-a-${randomUUID()}@${orgA.domain}`,
  };
  const userB = {
    id: randomUUID(),
    email: `user-dc-b-${randomUUID()}@${orgB.domain}`,
  };
  const app = createApp(TEST_ENV);
  const cookieName = "wchat_at";
  const projectId = randomUUID();

  beforeAll(async () => {
    await pgPool.query(
      "INSERT INTO organizations (id, name, domain) VALUES ($1, 'Org DC A', $2), ($3, 'Org DC B', $4)",
      [orgA.id, orgA.domain, orgB.id, orgB.domain],
    );
    await pgPool.query(
      "INSERT INTO users (id, org_id, email) VALUES ($1, $2, $3), ($4, $5, $6)",
      [userA.id, orgA.id, userA.email, userB.id, orgB.id, userB.email],
    );
    await pgPool.query(
      "INSERT INTO projects (id, org_id, owner_id, name, visibility) VALUES ($1, $2, $3, 'Docs Project', 'private')",
      [projectId, orgA.id, userA.id],
    );
    await pgPool.query(
      "INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, 'owner')",
      [projectId, userA.id],
    );
  });

  afterAll(async () => {
    await pgPool.query("DELETE FROM project_documents WHERE project_id = $1", [
      projectId,
    ]);
    await pgPool.query("DELETE FROM project_members WHERE project_id = $1", [
      projectId,
    ]);
    await pgPool.query("DELETE FROM projects WHERE id = $1", [projectId]);
    await pgPool.query("DELETE FROM users WHERE id = ANY($1)", [
      [userA.id, userB.id],
    ]);
    await pgPool.query("DELETE FROM organizations WHERE id = ANY($1)", [
      [orgA.id, orgB.id],
    ]);
  });

  function cookieFor(user: { id: string }, org: { id: string }): string {
    const token = signAccessToken({
      userId: user.id,
      orgId: org.id,
      role: "member",
    });
    return `${cookieName}=${token}`;
  }

  async function insertDocument(filename: string, contentHash: string) {
    const id = randomUUID();
    await pgPool.query(
      `INSERT INTO project_documents (id, project_id, filename, content_hash, mime_type, size_bytes, s3_key, created_by)
       VALUES ($1, $2, $3, $4, 'application/pdf', 100, $5, $6)`,
      [id, projectId, filename, contentHash, `documents/${id}`, userA.id],
    );
    return id;
  }

  it("미인증 GET /api/v1/documents → 401", async () => {
    const res = await app.request(`/api/v1/documents?projectId=${projectId}`);
    expect(res.status).toBe(401);
  });

  it("project member 는 문서 목록/단건을 조회할 수 있다", async () => {
    const docId = await insertDocument("a.pdf", "hash-a");

    const listRes = await app.request(
      `/api/v1/documents?projectId=${projectId}`,
      { headers: { Cookie: cookieFor(userA, orgA) } },
    );
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as { data: Array<{ id: string }> };
    expect(list.data.some((d) => d.id === docId)).toBe(true);

    const getRes = await app.request(`/api/v1/documents/${docId}`, {
      headers: { Cookie: cookieFor(userA, orgA) },
    });
    expect(getRes.status).toBe(200);
    const got = (await getRes.json()) as {
      data: { id: string; filename: string; contentHash: string };
    };
    expect(got.data.filename).toBe("a.pdf");
    expect(got.data.contentHash).toBe("hash-a");
  });

  it("contentHash 쿼리로 dedup 조회할 수 있다", async () => {
    await insertDocument("b.pdf", "hash-b");

    const res = await app.request(
      `/api/v1/documents?projectId=${projectId}&contentHash=hash-b`,
      { headers: { Cookie: cookieFor(userA, orgA) } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ filename: string }>;
    };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.filename).toBe("b.pdf");
  });

  it("다른 org 사용자는 문서 목록/단건 조회/삭제를 할 수 없다 (404, existence-leak 방지)", async () => {
    const docId = await insertDocument("secret.pdf", "hash-secret");

    const listRes = await app.request(
      `/api/v1/documents?projectId=${projectId}`,
      { headers: { Cookie: cookieFor(userB, orgB) } },
    );
    expect(listRes.status).toBe(404);

    const getRes = await app.request(`/api/v1/documents/${docId}`, {
      headers: { Cookie: cookieFor(userB, orgB) },
    });
    expect(getRes.status).toBe(404);

    const deleteRes = await app.request(`/api/v1/documents/${docId}`, {
      method: "DELETE",
      headers: { Cookie: cookieFor(userB, orgB) },
    });
    expect(deleteRes.status).toBe(404);
  });

  it("DELETE /api/v1/documents/:id → 204 + 이후 GET 은 404", async () => {
    const docId = await insertDocument("d.pdf", "hash-d");

    const deleteRes = await app.request(`/api/v1/documents/${docId}`, {
      method: "DELETE",
      headers: { Cookie: cookieFor(userA, orgA) },
    });
    expect(deleteRes.status).toBe(204);

    const getRes = await app.request(`/api/v1/documents/${docId}`, {
      headers: { Cookie: cookieFor(userA, orgA) },
    });
    expect(getRes.status).toBe(404);
  });

  it("POST /api/v1/documents (P4-T3-08) — 작은 docx 업로드 → 201 → document_chunks 생성", async () => {
    const bytes = readFileSync(docxFixturePath);
    const form = new FormData();
    form.set("projectId", projectId);
    form.set(
      "file",
      new File([bytes], "single-paragraph.docx", {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
    );

    const res = await app.request("/api/v1/documents", {
      method: "POST",
      headers: { Cookie: cookieFor(userA, orgA) },
      body: form,
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      data: { id: string; indexStatus: string; chunkCount: number };
    };
    expect(body.data.indexStatus).toBe("indexed");
    expect(body.data.chunkCount).toBeGreaterThan(0);

    const chunks = await pgPool.query(
      "SELECT count(*)::int AS count FROM document_chunks WHERE document_id = $1",
      [body.data.id],
    );
    expect(chunks.rows[0]?.count).toBe(body.data.chunkCount);
  });

  describe("POST /api/v1/documents/:id/retry (P17-T1-06 / TS-15)", () => {
    const objectStore = createLocalObjectStore();

    async function insertFailedDocument(filename: string, contentHash: string) {
      const id = randomUUID();
      const s3Key = `documents/${id}`;
      await objectStore.put(s3Key, readFileSync(docxFixturePath));
      await pgPool.query(
        `INSERT INTO project_documents
           (id, project_id, filename, content_hash, mime_type, size_bytes, s3_key, created_by, index_status, failure_reason)
         VALUES ($1, $2, $3, $4,
           'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
           100, $5, $6, 'failed', 'parse error')`,
        [id, projectId, filename, contentHash, s3Key, userA.id],
      );
      return id;
    }

    it("미마운트/미인증 상태 확인 없이 실패 문서를 재인덱싱하면 200 + indexed", async () => {
      const docId = await insertFailedDocument("retry-a.docx", "hash-retry-a");

      const res = await app.request(`/api/v1/documents/${docId}/retry`, {
        method: "POST",
        headers: { Cookie: cookieFor(userA, orgA) },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        data: { id: string; indexStatus: string; chunkCount: number };
      };
      expect(body.data.indexStatus).toBe("indexed");
      expect(body.data.chunkCount).toBeGreaterThan(0);

      const chunks = await pgPool.query(
        "SELECT count(*)::int AS count FROM document_chunks WHERE document_id = $1",
        [docId],
      );
      expect(chunks.rows[0]?.count).toBe(body.data.chunkCount);
    });

    it("indexStatus 가 'failed' 가 아니면 409 CONFLICT", async () => {
      const docId = await insertDocument("retry-indexed.pdf", "hash-retry-b");

      const res = await app.request(`/api/v1/documents/${docId}/retry`, {
        method: "POST",
        headers: { Cookie: cookieFor(userA, orgA) },
      });
      expect(res.status).toBe(409);
    });

    it("다른 org 사용자는 재시도할 수 없다 (404, existence-leak 방지)", async () => {
      const docId = await insertFailedDocument("retry-c.docx", "hash-retry-c");

      const res = await app.request(`/api/v1/documents/${docId}/retry`, {
        method: "POST",
        headers: { Cookie: cookieFor(userB, orgB) },
      });
      expect(res.status).toBe(404);
    });

    it("미인증 요청은 401", async () => {
      const docId = await insertFailedDocument("retry-d.docx", "hash-retry-d");

      const res = await app.request(`/api/v1/documents/${docId}/retry`, {
        method: "POST",
      });
      expect(res.status).toBe(401);
    });
  });
});
