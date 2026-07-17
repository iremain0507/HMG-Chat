// session-search-composition.test.ts — P19-T1-06: GET /sessions/search?q= (제목+메시지 내용
// ILIKE, migration 0022 GIN trgm 인덱스)가 실 Postgres + createApp(실HTTP)에서 동작·cross-org
// 격리되는지 검증한다(L1 last-mile — 유닛만으로는 마운트/실쿼리 결합을 증명 못 함).
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

describe("routes/sessions.ts 검색(GET /search?q=, app.ts 실 조립) — P19-T1-06", () => {
  const app = createApp(TEST_ENV);
  const cookieName = "wchat_at";

  const orgA = {
    id: randomUUID(),
    domain: `org-search-a-${randomUUID()}.example.com`,
  };
  const orgB = {
    id: randomUUID(),
    domain: `org-search-b-${randomUUID()}.example.com`,
  };
  const userA = { id: randomUUID(), email: "" };
  const userB = { id: randomUUID(), email: "" };
  userA.email = `user-a-${randomUUID()}@${orgA.domain}`;
  userB.email = `user-b-${randomUUID()}@${orgB.domain}`;

  beforeAll(async () => {
    await pgPool.query(
      "INSERT INTO organizations (id, name, domain) VALUES ($1, 'Org Search A', $2), ($3, 'Org Search B', $4)",
      [orgA.id, orgA.domain, orgB.id, orgB.domain],
    );
    await pgPool.query(
      "INSERT INTO users (id, org_id, email) VALUES ($1, $2, $3), ($4, $5, $6)",
      [userA.id, orgA.id, userA.email, userB.id, orgB.id, userB.email],
    );
  });

  afterAll(async () => {
    await pgPool.query("DELETE FROM sessions WHERE user_id IN ($1, $2)", [
      userA.id,
      userB.id,
    ]);
    await pgPool.query("DELETE FROM users WHERE id IN ($1, $2)", [
      userA.id,
      userB.id,
    ]);
    await pgPool.query("DELETE FROM organizations WHERE id IN ($1, $2)", [
      orgA.id,
      orgB.id,
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

  async function createSession(userId: string, title: string): Promise<string> {
    const id = randomUUID();
    await pgPool.query(
      "INSERT INTO sessions (id, user_id, title) VALUES ($1, $2, $3)",
      [id, userId, title],
    );
    return id;
  }

  async function createMessage(
    sessionId: string,
    content: string,
  ): Promise<void> {
    await pgPool.query(
      "INSERT INTO messages (session_id, role, content) VALUES ($1, 'user', $2::jsonb)",
      [sessionId, JSON.stringify({ text: content })],
    );
  }

  async function createTag(
    sessionId: string,
    orgId: string,
    tag: string,
  ): Promise<void> {
    await pgPool.query(
      "INSERT INTO session_tags (session_id, org_id, tag) VALUES ($1, $2, $3)",
      [sessionId, orgId, tag],
    );
  }

  // P20-T1-07 — 접두어 필터 테스트 헬퍼(폴더 생성, 핀/아카이브 직접 세팅).
  async function createFolder(
    orgId: string,
    userId: string,
    name: string,
  ): Promise<string> {
    const id = randomUUID();
    await pgPool.query(
      "INSERT INTO session_folders (id, org_id, name, created_by) VALUES ($1, $2, $3, $4)",
      [id, orgId, name, userId],
    );
    return id;
  }

  async function setFolder(sessionId: string, folderId: string): Promise<void> {
    await pgPool.query("UPDATE sessions SET folder_id = $1 WHERE id = $2", [
      folderId,
      sessionId,
    ]);
  }

  async function setPinned(sessionId: string, pinned: boolean): Promise<void> {
    await pgPool.query("UPDATE sessions SET pinned_at = $1 WHERE id = $2", [
      pinned ? new Date() : null,
      sessionId,
    ]);
  }

  async function setArchived(
    sessionId: string,
    archived: boolean,
  ): Promise<void> {
    await pgPool.query("UPDATE sessions SET archived_at = $1 WHERE id = $2", [
      archived ? new Date() : null,
      sessionId,
    ]);
  }

  it("제목이 매칭되는 세션을 반환한다", async () => {
    const matching = await createSession(userA.id, "분기별 예산 계획");
    const other = await createSession(userA.id, "무관한 세션");

    const res = await app.request("/api/v1/sessions/search?q=예산", {
      headers: { Cookie: cookieFor(userA, orgA) },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: Array<{ id: string }> };
    expect(json.data.some((s) => s.id === matching)).toBe(true);
    expect(json.data.some((s) => s.id === other)).toBe(false);
  });

  it("메시지 내용이 매칭되는 세션을 제목이 무관해도 반환한다", async () => {
    const sessionId = await createSession(userA.id, "제목무관");
    await createMessage(sessionId, "여기 특이한키워드ABC 가 있습니다");

    const res = await app.request("/api/v1/sessions/search?q=특이한키워드ABC", {
      headers: { Cookie: cookieFor(userA, orgA) },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: Array<{ id: string }> };
    expect(json.data.some((s) => s.id === sessionId)).toBe(true);
  });

  it("태그로만 매칭되는 세션(제목/본문 불일치)을 검색 결과에 포함한다", async () => {
    const sessionId = await createSession(userA.id, "제목도내용도무관함");
    const uniqueTag = `tag-${randomUUID()}`;
    await createTag(sessionId, orgA.id, uniqueTag);

    const res = await app.request(`/api/v1/sessions/search?q=${uniqueTag}`, {
      headers: { Cookie: cookieFor(userA, orgA) },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: Array<{ id: string }> };
    expect(json.data.some((s) => s.id === sessionId)).toBe(true);
  });

  it("q 가 없으면 400 을 반환한다", async () => {
    const res = await app.request("/api/v1/sessions/search", {
      headers: { Cookie: cookieFor(userA, orgA) },
    });
    expect(res.status).toBe(400);
  });

  it("cross-org — B 는 A 의 세션 제목/내용/태그를 검색 결과에서 볼 수 없다", async () => {
    const sessionId = await createSession(userA.id, "A전용예산문서");
    await createMessage(sessionId, "A조직만의비밀키워드");
    const orgATag = `a-only-tag-${randomUUID()}`;
    await createTag(sessionId, orgA.id, orgATag);

    const titleRes = await app.request(
      "/api/v1/sessions/search?q=A전용예산문서",
      { headers: { Cookie: cookieFor(userB, orgB) } },
    );
    const titleJson = (await titleRes.json()) as {
      data: Array<{ id: string }>;
    };
    expect(titleJson.data.some((s) => s.id === sessionId)).toBe(false);

    const contentRes = await app.request(
      "/api/v1/sessions/search?q=A조직만의비밀키워드",
      { headers: { Cookie: cookieFor(userB, orgB) } },
    );
    const contentJson = (await contentRes.json()) as {
      data: Array<{ id: string }>;
    };
    expect(contentJson.data.some((s) => s.id === sessionId)).toBe(false);

    const tagRes = await app.request(`/api/v1/sessions/search?q=${orgATag}`, {
      headers: { Cookie: cookieFor(userB, orgB) },
    });
    const tagJson = (await tagRes.json()) as {
      data: Array<{ id: string }>;
    };
    expect(tagJson.data.some((s) => s.id === sessionId)).toBe(false);
  });

  // P20-T1-07 — 검색 접두어 필터(tag:/folder:/pinned:/archived:).
  it("tag: 접두어 + 잔여 자유텍스트를 결합해 태그와 본문 둘 다 만족하는 세션만 반환한다", async () => {
    const uniqueTag = `report-${randomUUID()}`;
    const matching = await createSession(userA.id, "report 태그+예산 세션");
    await createTag(matching, orgA.id, uniqueTag);
    await createMessage(matching, "이번 분기 예산 검토");

    const tagOnlyNoText = await createSession(userA.id, "report 태그만");
    await createTag(tagOnlyNoText, orgA.id, uniqueTag);

    const textOnlyNoTag = await createSession(userA.id, "예산 이야기만");

    const res = await app.request(
      `/api/v1/sessions/search?q=${encodeURIComponent(`tag:${uniqueTag} 예산`)}`,
      { headers: { Cookie: cookieFor(userA, orgA) } },
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: Array<{ id: string }> };
    expect(json.data.some((s) => s.id === matching)).toBe(true);
    expect(json.data.some((s) => s.id === tagOnlyNoText)).toBe(false);
    expect(json.data.some((s) => s.id === textOnlyNoTag)).toBe(false);
  });

  it("folder: 접두어로 해당 이름의 폴더에 속한 세션만 반환한다", async () => {
    const folderId = await createFolder(orgA.id, userA.id, "업무");
    const otherFolderId = await createFolder(orgA.id, userA.id, "개인");
    const inFolder = await createSession(userA.id, "업무 폴더 세션");
    await setFolder(inFolder, folderId);
    const inOtherFolder = await createSession(userA.id, "개인 폴더 세션");
    await setFolder(inOtherFolder, otherFolderId);
    const noFolder = await createSession(userA.id, "폴더 없는 세션");

    const res = await app.request(
      `/api/v1/sessions/search?q=${encodeURIComponent("folder:업무")}`,
      { headers: { Cookie: cookieFor(userA, orgA) } },
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: Array<{ id: string }> };
    expect(json.data.some((s) => s.id === inFolder)).toBe(true);
    expect(json.data.some((s) => s.id === inOtherFolder)).toBe(false);
    expect(json.data.some((s) => s.id === noFolder)).toBe(false);
  });

  it("pinned:true 접두어로 핀된 세션만, pinned:false 로 핀 안 된 세션만 반환한다", async () => {
    const marker = `pin-marker-${randomUUID()}`;
    const pinned = await createSession(userA.id, `${marker} 핀됨`);
    await setPinned(pinned, true);
    const unpinned = await createSession(userA.id, `${marker} 안핀됨`);

    const pinnedRes = await app.request(
      `/api/v1/sessions/search?q=${encodeURIComponent(`pinned:true ${marker}`)}`,
      { headers: { Cookie: cookieFor(userA, orgA) } },
    );
    const pinnedJson = (await pinnedRes.json()) as {
      data: Array<{ id: string }>;
    };
    expect(pinnedJson.data.some((s) => s.id === pinned)).toBe(true);
    expect(pinnedJson.data.some((s) => s.id === unpinned)).toBe(false);

    const unpinnedRes = await app.request(
      `/api/v1/sessions/search?q=${encodeURIComponent(`pinned:false ${marker}`)}`,
      { headers: { Cookie: cookieFor(userA, orgA) } },
    );
    const unpinnedJson = (await unpinnedRes.json()) as {
      data: Array<{ id: string }>;
    };
    expect(unpinnedJson.data.some((s) => s.id === unpinned)).toBe(true);
    expect(unpinnedJson.data.some((s) => s.id === pinned)).toBe(false);
  });

  it("archived:true 접두어로 아카이브된 세션만 반환한다(기본 검색은 아카이브 포함)", async () => {
    const marker = `archive-marker-${randomUUID()}`;
    const archived = await createSession(userA.id, `${marker} 보관됨`);
    await setArchived(archived, true);
    const active = await createSession(userA.id, `${marker} 활성`);

    const bothRes = await app.request(
      `/api/v1/sessions/search?q=${encodeURIComponent(marker)}`,
      { headers: { Cookie: cookieFor(userA, orgA) } },
    );
    const bothJson = (await bothRes.json()) as { data: Array<{ id: string }> };
    expect(bothJson.data.some((s) => s.id === archived)).toBe(true);
    expect(bothJson.data.some((s) => s.id === active)).toBe(true);

    const archivedOnlyRes = await app.request(
      `/api/v1/sessions/search?q=${encodeURIComponent(`archived:true ${marker}`)}`,
      { headers: { Cookie: cookieFor(userA, orgA) } },
    );
    const archivedOnlyJson = (await archivedOnlyRes.json()) as {
      data: Array<{ id: string }>;
    };
    expect(archivedOnlyJson.data.some((s) => s.id === archived)).toBe(true);
    expect(archivedOnlyJson.data.some((s) => s.id === active)).toBe(false);
  });

  it("cross-org — folder: 접두어도 타 org 폴더/세션을 노출하지 않는다", async () => {
    const folderId = await createFolder(orgA.id, userA.id, "cross-org-폴더");
    const sessionId = await createSession(userA.id, "cross-org 폴더 세션");
    await setFolder(sessionId, folderId);

    const res = await app.request(
      `/api/v1/sessions/search?q=${encodeURIComponent("folder:cross-org-폴더")}`,
      { headers: { Cookie: cookieFor(userB, orgB) } },
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: Array<{ id: string }> };
    expect(json.data.some((s) => s.id === sessionId)).toBe(false);
  });
});
