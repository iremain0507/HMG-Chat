// messages-attachments-rag-composition.test.ts — P17-T1-05 acceptance(TS-14): app.ts 가
// attachments dep(AttachmentsPort)를 createMessageRoutes 에 실제로 전달해, routes/messages.ts
// 가 세션 첨부 문서의 ephemeral_chunks(0014_uploads.sql)를 실제 hybridSearch 로 검색하고
// citation SSE 이벤트로 반영하는지 createApp(실HTTP) + 실 Postgres 로 검증한다
// (L1 last-mile — 유닛만으로는 실제 DB 배선을 증명 못 함). 청크 인덱싱(업로드 시 parse+chunk
// +embed 적재)은 이 태스크 표 밖이라 테스트에서 fixture 로 직접 적재한다.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import type { Env } from "../../env.js";
import { pgPool } from "../../db/client.js";
import { signAccessToken } from "../../middleware/jwt.js";
import { createDevStubEmbeddingProvider } from "../../knowledge/embedding-provider-dev-stub.js";

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

describe("routes/messages.ts 첨부 ephemeral RAG 배선(app.ts 실 조립) — P17-T1-05", () => {
  const org = {
    id: randomUUID(),
    domain: `org-attachrag-${randomUUID()}.example.com`,
  };
  const user = {
    id: randomUUID(),
    email: `user-attachrag-${randomUUID()}@${org.domain}`,
  };
  const app = createApp(TEST_ENV);
  const cookieName = "wchat_at";
  const embeddingProvider = createDevStubEmbeddingProvider();

  beforeAll(async () => {
    await pgPool.query(
      "INSERT INTO organizations (id, name, domain) VALUES ($1, 'Org AttachRAG', $2)",
      [org.id, org.domain],
    );
    await pgPool.query(
      "INSERT INTO users (id, org_id, email) VALUES ($1, $2, $3)",
      [user.id, org.id, user.email],
    );
  });

  afterAll(async () => {
    await pgPool.query(
      "DELETE FROM messages WHERE session_id IN (SELECT id FROM sessions WHERE user_id = $1)",
      [user.id],
    );
    await pgPool.query(
      "DELETE FROM sessions_active_runs WHERE session_id IN (SELECT id FROM sessions WHERE user_id = $1)",
      [user.id],
    );
    await pgPool.query("DELETE FROM uploads WHERE user_id = $1", [user.id]);
    await pgPool.query("DELETE FROM sessions WHERE user_id = $1", [user.id]);
    await pgPool.query("DELETE FROM users WHERE id = $1", [user.id]);
    await pgPool.query("DELETE FROM organizations WHERE id = $1", [org.id]);
  });

  function authCookie(): string {
    const token = signAccessToken({
      userId: user.id,
      orgId: org.id,
      role: "member",
    });
    return `${cookieName}=${token}`;
  }

  async function createSession(): Promise<string> {
    const id = randomUUID();
    await pgPool.query(
      "INSERT INTO sessions (id, user_id, title) VALUES ($1, $2, 'attach-rag-test')",
      [id, user.id],
    );
    return id;
  }

  async function createUploadWithChunk(
    sessionId: string,
    chunkContent: string,
  ): Promise<string> {
    const uploadId = randomUUID();
    await pgPool.query(
      `INSERT INTO uploads (id, user_id, session_id, filename, mime_type, size_bytes, s3_key, sha256, expires_at)
       VALUES ($1, $2, $3, 'quarterly-report.pdf', 'application/pdf', 1234, $4, $5, NOW() + interval '30 days')`,
      [
        uploadId,
        user.id,
        sessionId,
        `s3/${uploadId}`,
        randomUUID().replace(/-/g, ""),
      ],
    );
    const [embedding] = await embeddingProvider.embed([chunkContent], {
      type: "document",
    });
    await pgPool.query(
      `INSERT INTO ephemeral_chunks (session_id, upload_id, chunk_index, page_number, content, embedding)
       VALUES ($1, $2, 0, 7, $3, $4::vector)`,
      [sessionId, uploadId, chunkContent, `[${(embedding ?? []).join(",")}]`],
    );
    return uploadId;
  }

  it("첨부(uploadId) 가 있으면 ephemeral_chunks 를 검색해 citation SSE 이벤트로 반영한다", async () => {
    const sessionId = await createSession();
    const uploadId = await createUploadWithChunk(
      sessionId,
      "분기 매출은 1000억원이며 전년 대비 12% 증가했다.",
    );

    const res = await app.request(`/api/v1/sessions/${sessionId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: authCookie() },
      body: JSON.stringify({
        content: "분기 매출이 얼마인지 문서에서 찾아줘",
        attachments: [{ uploadId }],
      }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();

    expect(text).toContain("event: citation");
    const citationLine = text
      .split("\n\n")
      .find((frame) => frame.includes("event: citation"));
    expect(citationLine).toBeDefined();
    const dataLine = citationLine!
      .split("\n")
      .find((line) => line.startsWith("data:"));
    const payload = JSON.parse(dataLine!.slice("data:".length).trim());
    expect(payload.source).toBe("ephemeral");
    expect(payload.uploadId).toBe(uploadId);
    expect(payload.filename).toBe("quarterly-report.pdf");
    expect(payload.snippet).toContain("매출");
  });

  it("첨부가 없으면 citation 이벤트가 없다(기존 동작 보존)", async () => {
    const sessionId = await createSession();
    const res = await app.request(`/api/v1/sessions/${sessionId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: authCookie() },
      body: JSON.stringify({ content: "안녕" }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("event: citation");
  });
});
