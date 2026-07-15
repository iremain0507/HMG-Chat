// db/active-runs-service.ts 의 status enum 전이 검증 — 실 Postgres CHECK constraint 대상.
// 마이그레이션은 이 테스트 실행 전 `pnpm db:migrate` 로 이미 적용돼 있어야 한다.
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { pgPool } from "../../db/client";
import {
  clearActiveRun,
  getActiveRun,
  setActiveRun,
} from "../../db/active-runs-service";

describe("active-runs-service (status enum 전이)", () => {
  const org = {
    id: randomUUID(),
    domain: `org-ar-${randomUUID()}.example.com`,
  };
  const user = {
    id: randomUUID(),
    email: `user-ar-${randomUUID()}@${org.domain}`,
  };
  const session = { id: randomUUID() };

  beforeAll(async () => {
    await pgPool.query(
      "INSERT INTO organizations (id, name, domain) VALUES ($1, 'Org AR', $2)",
      [org.id, org.domain],
    );
    await pgPool.query(
      "INSERT INTO users (id, org_id, email) VALUES ($1, $2, $3)",
      [user.id, org.id, user.email],
    );
    await pgPool.query(
      "INSERT INTO sessions (id, user_id, title) VALUES ($1, $2, 'AR')",
      [session.id, user.id],
    );
  });

  afterEach(async () => {
    await pgPool.query(
      "DELETE FROM sessions_active_runs WHERE session_id = $1",
      [session.id],
    );
  });

  afterAll(async () => {
    await pgPool.query("DELETE FROM sessions WHERE id = $1", [session.id]);
    await pgPool.query("DELETE FROM users WHERE id = $1", [user.id]);
    await pgPool.query("DELETE FROM organizations WHERE id = $1", [org.id]);
  });

  it("pending → running → completed 로 정상 전이한다", async () => {
    const jobId = randomUUID();
    await setActiveRun(session.id, jobId, "pending");
    expect((await getActiveRun(session.id))?.status).toBe("pending");

    await setActiveRun(session.id, jobId, "running");
    expect((await getActiveRun(session.id))?.status).toBe("running");

    await setActiveRun(session.id, jobId, "completed");
    expect((await getActiveRun(session.id))?.status).toBe("completed");
  });

  it("pending → running → cancelled 로 전이한다", async () => {
    const jobId = randomUUID();
    await setActiveRun(session.id, jobId, "pending");
    await setActiveRun(session.id, jobId, "running");
    await setActiveRun(session.id, jobId, "cancelled");
    expect((await getActiveRun(session.id))?.status).toBe("cancelled");
  });

  it("CHECK constraint 밖의 status 는 DB 가 거부한다", async () => {
    const jobId = randomUUID();
    await expect(
      setActiveRun(session.id, jobId, "bogus" as never),
    ).rejects.toThrow();
    expect(await getActiveRun(session.id)).toBeNull();
  });

  it("clearActiveRun 은 row 를 삭제한다", async () => {
    const jobId = randomUUID();
    await setActiveRun(session.id, jobId, "running");
    expect(await getActiveRun(session.id)).not.toBeNull();

    await clearActiveRun(session.id);
    expect(await getActiveRun(session.id)).toBeNull();
  });
});
