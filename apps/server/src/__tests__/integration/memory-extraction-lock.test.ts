// memory_extraction_locks DB layer — 06-DATA-MODEL.md § 0008 / rebuild_plan 08-SPRINT-PLAN.md P7-T1-01.
// Redis 없이 Postgres INSERT..ON CONFLICT 로 동시성 안전한 lock 을 구현 (active-runs-service.ts 와 동일 패턴).
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { pgPool } from "../../db/client";
import {
  acquireExtractionLock,
  releaseExtractionLock,
} from "../../db/memory-extraction-lock";

describe("memory-extraction-lock (동시 추출 안전)", () => {
  const org = {
    id: randomUUID(),
    domain: `org-mel-${randomUUID()}.example.com`,
  };
  const user = {
    id: randomUUID(),
    email: `user-mel-${randomUUID()}@${org.domain}`,
  };
  const session = { id: randomUUID() };

  beforeAll(async () => {
    await pgPool.query(
      "INSERT INTO organizations (id, name, domain) VALUES ($1, 'Org MEL', $2)",
      [org.id, org.domain],
    );
    await pgPool.query(
      "INSERT INTO users (id, org_id, email) VALUES ($1, $2, $3)",
      [user.id, org.id, user.email],
    );
    await pgPool.query(
      "INSERT INTO sessions (id, user_id, title) VALUES ($1, $2, 'MEL')",
      [session.id, user.id],
    );
  });

  afterEach(async () => {
    await pgPool.query(
      "DELETE FROM memory_extraction_locks WHERE session_id = $1",
      [session.id],
    );
  });

  afterAll(async () => {
    await pgPool.query("DELETE FROM sessions WHERE id = $1", [session.id]);
    await pgPool.query("DELETE FROM users WHERE id = $1", [user.id]);
    await pgPool.query("DELETE FROM organizations WHERE id = $1", [org.id]);
  });

  it("동시에 acquire 하면 정확히 하나만 성공한다", async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        acquireExtractionLock(session.id, 60_000),
      ),
    );
    expect(results.filter(Boolean).length).toBe(1);
  });

  it("release 후에는 다시 acquire 할 수 있다", async () => {
    expect(await acquireExtractionLock(session.id, 60_000)).toBe(true);
    expect(await acquireExtractionLock(session.id, 60_000)).toBe(false);

    await releaseExtractionLock(session.id);

    expect(await acquireExtractionLock(session.id, 60_000)).toBe(true);
  });

  it("만료된 lock 은 다른 acquire 가 가져갈 수 있다", async () => {
    expect(await acquireExtractionLock(session.id, -1)).toBe(true);

    expect(await acquireExtractionLock(session.id, 60_000)).toBe(true);
  });
});
