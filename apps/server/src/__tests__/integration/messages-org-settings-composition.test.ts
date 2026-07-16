// messages-org-settings-composition.test.ts — P14-T2-01 acceptance: app.ts 가 조립한
// settingsService(createSettingsService, admin-settings.ts 와 동일 인스턴스 공유)를
// routes/messages.ts 가 실제로 소비해 org_settings 의 defaultModel 이 실 turn model 로
// 반영되는지 실HTTP(createApp) + 실 Postgres 로 검증한다(21-LOOP-LESSONS.md L1 last-mile —
// 유닛에서 settings-service 가 green 이어도 app.ts 조립 배선이 실제로 연결됐는지는 별개다).
// maxTokens(트리거 버그 근본해결)의 ChatInput 실 수신 여부는 dev-stub LLMProvider 가
// maxTokens 를 응답에 echo 하지 않아(model 만 meta 로 노출) 여기서 직접 관측할 수 없으므로,
// routes/__tests__/messages.test.ts 가 real runTurn(orchestrator.ts, 미수정) 을 통해
// capturing fake provider 로 ChatInput.maxTokens 를 직접 단언한다(동일 L1 last-mile 요건을
// dev-stub 관측 한계 안에서 만족하는 지점).
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

describe("routes/messages.ts org_settings 배선(app.ts 실 조립) — P14-T2-01", () => {
  const org = {
    id: randomUUID(),
    domain: `org-msgset-${randomUUID()}.example.com`,
  };
  const admin = {
    id: randomUUID(),
    email: `admin-msgset-${randomUUID()}@${org.domain}`,
  };
  const app = createApp(TEST_ENV);
  const cookieName = "wchat_at";

  beforeAll(async () => {
    await pgPool.query(
      "INSERT INTO organizations (id, name, domain) VALUES ($1, 'Org MsgSet', $2)",
      [org.id, org.domain],
    );
    await pgPool.query(
      "INSERT INTO users (id, org_id, email, role) VALUES ($1, $2, $3, 'admin')",
      [admin.id, org.id, admin.email],
    );
  });

  afterAll(async () => {
    await pgPool.query("DELETE FROM org_settings WHERE org_id = $1", [org.id]);
    await pgPool.query(
      "DELETE FROM sessions_active_runs WHERE session_id IN (SELECT id FROM sessions WHERE user_id = $1)",
      [admin.id],
    );
    await pgPool.query("DELETE FROM sessions WHERE user_id = $1", [admin.id]);
    await pgPool.query("DELETE FROM users WHERE id = $1", [admin.id]);
    await pgPool.query("DELETE FROM organizations WHERE id = $1", [org.id]);
  });

  function authCookie(): string {
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
      "INSERT INTO sessions (id, user_id, title) VALUES ($1, $2, 'settings-test')",
      [id, admin.id],
    );
    return id;
  }

  it("admin PUT 으로 저장한 defaultModel 이 body.model 미지정 turn 의 실 model 로 반영된다(app.ts 조립 배선)", async () => {
    const putRes = await app.request("/api/v1/admin/settings", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        Cookie: authCookie(),
      },
      body: JSON.stringify({ defaultModel: "org-msgset-default-model" }),
    });
    expect(putRes.status).toBe(200);

    const sessionId = await createSession();
    const res = await app.request(`/api/v1/sessions/${sessionId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: authCookie() },
      body: JSON.stringify({ content: "hi" }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('"model":"org-msgset-default-model"');
  });

  it("org_settings 조회에 실패해도(잘못된 org) SSE 는 throw 없이 정상 stop 까지 완주한다(L2/L5)", async () => {
    // 존재하지 않는 org 로 서명된 토큰 — settingsService.resolve 가 org_settings 미조회(행 없음)
    // 경로를 타지만, 그래도 DEFAULT_ORG_SETTINGS 로 fail-soft 해 요청 자체는 정상 완주해야 한다.
    const strayOrgAdmin = { id: randomUUID(), orgId: randomUUID() };
    const token = signAccessToken({
      userId: strayOrgAdmin.id,
      orgId: strayOrgAdmin.orgId,
      role: "admin",
    });
    const sessionId = randomUUID();
    await pgPool.query(
      "INSERT INTO sessions (id, user_id, title) VALUES ($1, $2, 'settings-test-2')",
      [sessionId, admin.id],
    );

    const res = await app.request(`/api/v1/sessions/${sessionId}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${cookieName}=${token}`,
      },
      body: JSON.stringify({ content: "hi" }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("event: stop");
  });
});
