// db/user-memory-data-access.ts 의 UserMemoryRepo pg 구현체 — 06-DATA-MODEL.md § 0008 /
// 14-INTERFACES.md UserMemoryRepo 단일 출처. RLS(app.user_id) 는 rls-*.test.ts 가 별도 검증.
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { pgPool } from "../../db/client";
import { createPgUserMemoryDataAccess } from "../../db/user-memory-data-access";

describe("user-memory-data-access (UserMemoryRepo)", () => {
  const da = createPgUserMemoryDataAccess();
  const org = {
    id: randomUUID(),
    domain: `org-umd-${randomUUID()}.example.com`,
  };
  const user = {
    id: randomUUID(),
    email: `user-umd-${randomUUID()}@${org.domain}`,
  };

  beforeAll(async () => {
    await pgPool.query(
      "INSERT INTO organizations (id, name, domain) VALUES ($1, 'Org UMD', $2)",
      [org.id, org.domain],
    );
    await pgPool.query(
      "INSERT INTO users (id, org_id, email) VALUES ($1, $2, $3)",
      [user.id, org.id, user.email],
    );
  });

  afterEach(async () => {
    await pgPool.query("DELETE FROM user_memories WHERE user_id = $1", [
      user.id,
    ]);
  });

  afterAll(async () => {
    await pgPool.query("DELETE FROM users WHERE id = $1", [user.id]);
    await pgPool.query("DELETE FROM organizations WHERE id = $1", [org.id]);
  });

  it("insert 후 byId 로 조회된다", async () => {
    const created = await da.userMemories.insert({
      userId: user.id,
      category: "user",
      content: "사용자는 다크 모드를 선호한다",
      source: "auto-extract",
      sessionId: null,
      pinned: false,
      metadata: null,
    });
    expect(created.id).toBeTruthy();

    const found = await da.userMemories.byId(created.id);
    expect(found?.content).toBe("사용자는 다크 모드를 선호한다");
    expect(found?.category).toBe("user");
    expect(found?.source).toBe("auto-extract");
    expect(found?.pinned).toBe(false);
  });

  it("list 는 userId/category/pinned filter 를 적용한다", async () => {
    await da.userMemories.insert({
      userId: user.id,
      category: "feedback",
      content: "테스트를 mock 하지 말 것",
      source: "manual",
      sessionId: null,
      pinned: true,
      metadata: null,
    });
    await da.userMemories.insert({
      userId: user.id,
      category: "project",
      content: "WChat 프로젝트 진행중",
      source: "auto-extract",
      sessionId: null,
      pinned: false,
      metadata: null,
    });

    const feedbackOnly = await da.userMemories.list({
      userId: user.id,
      category: "feedback",
    });
    expect(feedbackOnly.items).toHaveLength(1);
    expect(feedbackOnly.items[0].content).toBe("테스트를 mock 하지 말 것");

    const pinnedOnly = await da.userMemories.list({
      userId: user.id,
      pinned: true,
    });
    expect(pinnedOnly.items).toHaveLength(1);
    expect(pinnedOnly.items[0].pinned).toBe(true);
  });

  it("pin() 은 pinned 값을 갱신한다", async () => {
    const created = await da.userMemories.insert({
      userId: user.id,
      category: "reference",
      content: "grafana.internal/d/api-latency",
      source: "manual",
      sessionId: null,
      pinned: false,
      metadata: null,
    });

    await da.userMemories.pin(created.id, true);
    expect((await da.userMemories.byId(created.id))?.pinned).toBe(true);

    await da.userMemories.pin(created.id, false);
    expect((await da.userMemories.byId(created.id))?.pinned).toBe(false);
  });

  it("delete() 는 row 를 제거한다", async () => {
    const created = await da.userMemories.insert({
      userId: user.id,
      category: "user",
      content: "삭제될 메모리",
      source: "manual",
      sessionId: null,
      pinned: false,
      metadata: null,
    });

    await da.userMemories.delete(created.id);
    expect(await da.userMemories.byId(created.id)).toBeNull();
  });
});
