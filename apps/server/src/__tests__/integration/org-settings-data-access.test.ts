// db/org-settings-data-access.ts 의 OrgSettingsDataAccess pg 구현체 +
// db/auth-data-access.ts organizations.update 의 allowedModels/allowedTools/defaultTokenBudgetMicros 확장 검증.
// RLS(app.org_id/admin) 는 rls-org-settings.test.ts 가 별도 검증 — 여기는 superuser role 로 로직만 확인.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pgPool } from "../../db/client";
import { createPgOrgSettingsDataAccess } from "../../db/org-settings-data-access";
import { createPgAuthDataAccess } from "../../db/auth-data-access";

describe("org-settings-data-access (OrgSettingsDataAccess)", () => {
  const da = createPgOrgSettingsDataAccess();
  const authDa = createPgAuthDataAccess();
  const org = {
    id: randomUUID(),
    domain: `org-settings-da-${randomUUID()}.example.com`,
  };
  const admin = {
    id: randomUUID(),
    email: `admin-settings-da-${randomUUID()}@${org.domain}`,
  };

  beforeAll(async () => {
    await pgPool.query(
      "INSERT INTO organizations (id, name, domain) VALUES ($1, 'Org Settings DA', $2)",
      [org.id, org.domain],
    );
    await pgPool.query(
      "INSERT INTO users (id, org_id, email, role) VALUES ($1, $2, $3, 'admin')",
      [admin.id, org.id, admin.email],
    );
  });

  afterAll(async () => {
    await pgPool.query("DELETE FROM org_settings WHERE org_id = $1", [org.id]);
    await pgPool.query("DELETE FROM users WHERE id = $1", [admin.id]);
    await pgPool.query("DELETE FROM organizations WHERE id = $1", [org.id]);
  });

  it("행이 없는 org 는 getByOrgId 가 null 을 반환한다", async () => {
    expect(await da.getByOrgId(org.id)).toBeNull();
  });

  it("upsert 후 getByOrgId 가 저장된 설정을 반환한다", async () => {
    const created = await da.upsert(org.id, { maxTokens: 8192 }, admin.id);
    expect(created.settings).toEqual({ maxTokens: 8192 });
    expect(created.updatedBy).toBe(admin.id);

    const found = await da.getByOrgId(org.id);
    expect(found?.settings).toEqual({ maxTokens: 8192 });
  });

  it("upsert 를 반복하면 기존 설정과 머지된다 (부분 패치가 다른 키를 덮어쓰지 않음)", async () => {
    const merged = await da.upsert(org.id, { temperature: 0.5 }, admin.id);
    expect(merged.settings).toEqual({ maxTokens: 8192, temperature: 0.5 });

    const found = await da.getByOrgId(org.id);
    expect(found?.settings).toEqual({ maxTokens: 8192, temperature: 0.5 });
  });

  it("동일 키로 다시 upsert 하면 그 키만 갱신된다", async () => {
    const merged = await da.upsert(org.id, { maxTokens: 2048 }, admin.id);
    expect(merged.settings).toEqual({ maxTokens: 2048, temperature: 0.5 });
  });

  it("organizations.update 가 allowedModels/allowedTools/defaultTokenBudgetMicros 를 JSONB round-trip 한다", async () => {
    const updated = await authDa.organizations.update(org.id, {
      allowedModels: ["claude-sonnet-5", "claude-opus-4-8"],
      allowedTools: ["web_search"],
      defaultTokenBudgetMicros: 5_000_000,
    });
    expect(updated.allowedModels).toEqual([
      "claude-sonnet-5",
      "claude-opus-4-8",
    ]);
    expect(updated.allowedTools).toEqual(["web_search"]);
    expect(updated.defaultTokenBudgetMicros).toBe(5_000_000);

    const found = await authDa.organizations.byId(org.id);
    expect(found?.allowedModels).toEqual([
      "claude-sonnet-5",
      "claude-opus-4-8",
    ]);
    expect(found?.allowedTools).toEqual(["web_search"]);
    expect(found?.defaultTokenBudgetMicros).toBe(5_000_000);
  });
});
