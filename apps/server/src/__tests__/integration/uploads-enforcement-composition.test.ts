// uploads-enforcement-composition.test.ts — P20-T1-17 acceptance: org_settings 의
// allowedUploadExtensions/maxUploadSizeMb/maxUploadCount 가 실제 POST /api/v1/uploads
// 검증까지 도달하는지 실 HTTP + 실 Postgres 로 검증한다(L1). 구현 전에는
// routes/uploads.ts 가 이 값들을 전혀 조회하지 않아 화이트리스트 밖 확장자·용량/개수
// 초과 업로드가 모두 201 로 통과한다(RED, 잘못된 이유가 아니라 enforcement 부재).
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

describe("POST /api/v1/uploads — org_settings 화이트리스트/size/count enforcement — P20-T1-17", () => {
  const org = {
    id: randomUUID(),
    domain: `org-ue-${randomUUID()}.example.com`,
  };
  const admin = {
    id: randomUUID(),
    email: `admin-ue-${randomUUID()}@${org.domain}`,
  };
  const member = {
    id: randomUUID(),
    email: `member-ue-${randomUUID()}@${org.domain}`,
  };
  const app = createApp(TEST_ENV);
  const cookieName = "wchat_at";

  beforeAll(async () => {
    await pgPool.query(
      "INSERT INTO organizations (id, name, domain) VALUES ($1, 'Org UE', $2)",
      [org.id, org.domain],
    );
    await pgPool.query(
      `INSERT INTO users (id, org_id, email, role) VALUES
         ($1, $2, $3, 'admin'), ($4, $2, $5, 'member')`,
      [admin.id, org.id, admin.email, member.id, member.email],
    );
  });

  afterAll(async () => {
    await pgPool.query("DELETE FROM uploads WHERE user_id = $1", [member.id]);
    await pgPool.query("DELETE FROM org_settings WHERE org_id = $1", [org.id]);
    await pgPool.query("DELETE FROM users WHERE org_id = $1", [org.id]);
    await pgPool.query("DELETE FROM organizations WHERE id = $1", [org.id]);
  });

  function cookieFor(user: { id: string; role: "admin" | "member" }): string {
    const token = signAccessToken({
      userId: user.id,
      orgId: org.id,
      role: user.role,
    });
    return `${cookieName}=${token}`;
  }

  function multipartBody(content: string | Buffer, filename: string): FormData {
    const form = new FormData();
    const bytes = typeof content === "string" ? content : content;
    form.append(
      "file",
      new File([bytes], filename, { type: "application/octet-stream" }),
    );
    return form;
  }

  it("org_settings 를 화이트리스트 1종(txt) + maxUploadSizeMb=1 + maxUploadCount=2 로 설정", async () => {
    const res = await app.request("/api/v1/admin/settings", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        Cookie: cookieFor({ id: admin.id, role: "admin" }),
      },
      body: JSON.stringify({
        allowedUploadExtensions: ["txt"],
        maxUploadSizeMb: 1,
        maxUploadCount: 2,
      }),
    });
    expect(res.status).toBe(200);
  });

  it("화이트리스트 밖 확장자(.exe) 업로드는 400 으로 거부된다", async () => {
    const res = await app.request("/api/v1/uploads", {
      method: "POST",
      headers: { Cookie: cookieFor({ id: member.id, role: "member" }) },
      body: multipartBody("MZ fake binary", "malware.exe"),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("UNSUPPORTED_MEDIA_TYPE");
  });

  it("maxUploadSizeMb(1MB) 초과 업로드는 400 으로 거부된다", async () => {
    const oversized = Buffer.alloc(2 * 1024 * 1024, "a");
    const res = await app.request("/api/v1/uploads", {
      method: "POST",
      headers: { Cookie: cookieFor({ id: member.id, role: "member" }) },
      body: multipartBody(oversized, "big.txt"),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("한도 내(2개) 업로드는 통과하고, maxUploadCount(2) 초과 3번째 업로드는 400 으로 거부된다", async () => {
    const first = await app.request("/api/v1/uploads", {
      method: "POST",
      headers: { Cookie: cookieFor({ id: member.id, role: "member" }) },
      body: multipartBody("content one", "one.txt"),
    });
    expect(first.status).toBe(201);

    const second = await app.request("/api/v1/uploads", {
      method: "POST",
      headers: { Cookie: cookieFor({ id: member.id, role: "member" }) },
      body: multipartBody("content two", "two.txt"),
    });
    expect(second.status).toBe(201);

    const third = await app.request("/api/v1/uploads", {
      method: "POST",
      headers: { Cookie: cookieFor({ id: member.id, role: "member" }) },
      body: multipartBody("content three", "three.txt"),
    });
    expect(third.status).toBe(400);
    const body = (await third.json()) as { error: { code: string } };
    expect(body.error.code).toBe("QUOTA_EXCEEDED");
  });
});
