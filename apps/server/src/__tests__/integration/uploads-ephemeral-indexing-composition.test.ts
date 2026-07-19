// uploads-ephemeral-indexing-composition.test.ts — P20-T1-01 acceptance: app.ts 가
// ephemeral-indexer.ts(T3 순수함수)+ephemeral-chunk-data-access.ts(bulkInsert)를
// createUploadRoutes 에 실제로 주입해, POST /api/v1/uploads(세션 첨부) 가 ephemeral_chunks
// row 를 실제로 채우는지(L1 last-mile) + 그 결과가 같은 세션 턴에서 citation ChatEvent 로
// 방출되는지(P17-T1-05 소비측과 end-to-end 연결) createApp(실HTTP) + 실 Postgres 로 검증.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import type { Env } from "../../env.js";
import { pgPool } from "../../db/client.js";
import { signAccessToken } from "../../middleware/jwt.js";

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

describe("app.ts 업로드 → ephemeral_chunks 실배선(RAG 인덱싱 생산측) — P20-T1-01", () => {
  const org = {
    id: randomUUID(),
    domain: `org-upload-idx-${randomUUID()}.example.com`,
  };
  const user = {
    id: randomUUID(),
    email: `user-upload-idx-${randomUUID()}@${org.domain}`,
  };
  const admin = {
    id: randomUUID(),
    email: `admin-upload-idx-${randomUUID()}@${org.domain}`,
  };
  const app = createApp(TEST_ENV);
  const cookieName = "wchat_at";

  beforeAll(async () => {
    await pgPool.query(
      "INSERT INTO organizations (id, name, domain) VALUES ($1, 'Org UploadIdx', $2)",
      [org.id, org.domain],
    );
    await pgPool.query(
      `INSERT INTO users (id, org_id, email, role) VALUES
         ($1, $2, $3, 'member'), ($4, $2, $5, 'admin')`,
      [user.id, org.id, user.email, admin.id, admin.email],
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
    await pgPool.query("DELETE FROM org_settings WHERE org_id = $1", [org.id]);
    await pgPool.query("DELETE FROM users WHERE org_id = $1", [org.id]);
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

  function adminCookie(): string {
    const token = signAccessToken({
      userId: admin.id,
      orgId: org.id,
      role: "admin",
    });
    return `${cookieName}=${token}`;
  }

  async function createSession(): Promise<string> {
    const id = randomUUID();
    await pgPool.query(
      "INSERT INTO sessions (id, user_id, title) VALUES ($1, $2, 'upload-idx-test')",
      [id, user.id],
    );
    return id;
  }

  function multipartBody(
    content: string,
    filename: string,
    sessionId: string,
  ): FormData {
    const form = new FormData();
    form.append("file", new File([content], filename, { type: "text/plain" }));
    form.append("sessionId", sessionId);
    return form;
  }

  it("세션 첨부 업로드 시 ephemeral_chunks row 가 실제로 생성된다(인덱싱 생산측 실배선)", async () => {
    const sessionId = await createSession();
    const createRes = await app.request("/api/v1/uploads", {
      method: "POST",
      headers: { Cookie: authCookie() },
      body: multipartBody(
        "분기 매출은 1000억원이며 전년 대비 12% 증가했다.",
        "sales.txt",
        sessionId,
      ),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { data: { id: string } };

    const chunkRes = await pgPool.query(
      "SELECT * FROM ephemeral_chunks WHERE upload_id = $1",
      [created.data.id],
    );
    expect(chunkRes.rows.length).toBeGreaterThan(0);
    expect(chunkRes.rows[0].session_id).toBe(sessionId);
    expect(chunkRes.rows[0].content).toContain("매출");
  });

  it("업로드 직후 같은 세션 턴에서 첨부 근거로 citation ChatEvent 가 방출된다(생산측→소비측 end-to-end)", async () => {
    const sessionId = await createSession();
    const createRes = await app.request("/api/v1/uploads", {
      method: "POST",
      headers: { Cookie: authCookie() },
      body: multipartBody(
        "3분기 영업이익은 500억원으로 전분기 대비 8% 늘었다.",
        "profit.txt",
        sessionId,
      ),
    });
    const created = (await createRes.json()) as { data: { id: string } };
    const uploadId = created.data.id;

    const res = await app.request(`/api/v1/sessions/${sessionId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: authCookie() },
      body: JSON.stringify({
        content: "영업이익이 얼마인지 문서에서 찾아줘",
        attachments: [{ uploadId }],
      }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();

    expect(text).toContain("event: citation");
    const citationLine = text
      .split("\n\n")
      .find((frame) => frame.includes("event: citation"));
    const dataLine = citationLine!
      .split("\n")
      .find((line) => line.startsWith("data:"));
    const payload = JSON.parse(dataLine!.slice("data:".length).trim());
    expect(payload.source).toBe("ephemeral");
    expect(payload.uploadId).toBe(uploadId);
    expect(payload.filename).toBe("profit.txt");
  });

  it("org_settings.ragChunkSizeTokens 를 작게 설정하면 첨부 인덱싱이 org 설정 청크 경계를 따른다(P22-T3-03)", async () => {
    // admin 이 org 청크 크기를 50토큰(≈40단어)로 축소 → 200단어 첨부는 다청크로 쪼개져야 한다.
    // (미배선 시 DEFAULT 800토큰 고정이라 200단어는 단일 청크 → 이 테스트가 RED).
    const putRes = await app.request("/api/v1/admin/settings", {
      method: "PUT",
      headers: { "content-type": "application/json", Cookie: adminCookie() },
      body: JSON.stringify({
        ragChunkSizeTokens: 50,
        ragChunkOverlapTokens: 0,
      }),
    });
    expect(putRes.status).toBe(200);

    const sessionId = await createSession();
    const longText = Array.from({ length: 200 }, (_, i) => `word${i}`).join(
      " ",
    );
    const createRes = await app.request("/api/v1/uploads", {
      method: "POST",
      headers: { Cookie: authCookie() },
      body: multipartBody(longText, "long-org-scoped.txt", sessionId),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { data: { id: string } };

    const chunkRes = await pgPool.query(
      "SELECT * FROM ephemeral_chunks WHERE upload_id = $1 AND session_id = $2",
      [created.data.id, sessionId],
    );
    // 50토큰(≈40단어)/청크 · 200단어 → 다청크. DEFAULT 800이면 1청크였을 것.
    expect(chunkRes.rows.length).toBeGreaterThan(1);
  });

  it("같은 바이트를 다른 세션에 첨부하면(sha256 dedup 재사용) 그 세션에도 재인덱싱된다(L2 열화조건)", async () => {
    const sessionA = await createSession();
    const sessionB = await createSession();
    const content = "R&D 투자는 200억원으로 전년 동기 대비 15% 증가했다.";

    const createResA = await app.request("/api/v1/uploads", {
      method: "POST",
      headers: { Cookie: authCookie() },
      body: multipartBody(content, "rnd-a.txt", sessionA),
    });
    const createdA = (await createResA.json()) as { data: { id: string } };

    const createResB = await app.request("/api/v1/uploads", {
      method: "POST",
      headers: { Cookie: authCookie() },
      body: multipartBody(content, "rnd-b.txt", sessionB),
    });
    const createdB = (await createResB.json()) as { data: { id: string } };
    // sha256 dedup — 두 응답 모두 같은 upload row 를 가리킨다.
    expect(createdB.data.id).toBe(createdA.data.id);

    const chunkResB = await pgPool.query(
      "SELECT * FROM ephemeral_chunks WHERE upload_id = $1 AND session_id = $2",
      [createdA.data.id, sessionB],
    );
    expect(chunkResB.rows.length).toBeGreaterThan(0);
  });
});
