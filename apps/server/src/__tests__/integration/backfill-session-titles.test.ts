// P18-T1-01: 기존 '(제목 없음)' 세션(title=null) 백필 검증.
// 실 Postgres 필요 — rls-sessions-messages.test.ts 와 동일 패턴(admin Client, superuser 로
// RLS 우회). 마이그레이션은 이 테스트 실행 전 `pnpm db:migrate` 로 이미 적용돼 있어야 한다.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { backfillSessionTitles } from "../../lib/backfill-session-titles.js";

const ADMIN_URL =
  process.env.DATABASE_URL ??
  "postgres://wchat:localdev@localhost:5432/wchat_dev";

describe("backfillSessionTitles", () => {
  const admin = new Client({ connectionString: ADMIN_URL });

  const org = {
    id: randomUUID(),
    domain: `org-backfill-${randomUUID()}.example.com`,
  };
  const user = { id: randomUUID(), email: `u-${randomUUID()}@${org.domain}` };
  const sessionWithMessage = { id: randomUUID() };
  const sessionWithoutMessage = { id: randomUUID() };
  const sessionAlreadyTitled = { id: randomUUID() };

  beforeAll(async () => {
    await admin.connect();
    await admin.query(
      "INSERT INTO organizations (id, name, domain) VALUES ($1, 'Org Backfill', $2)",
      [org.id, org.domain],
    );
    await admin.query(
      "INSERT INTO users (id, org_id, email) VALUES ($1, $2, $3)",
      [user.id, org.id, user.email],
    );
    await admin.query(
      `INSERT INTO sessions (id, user_id, title) VALUES
         ($1, $4, NULL), ($2, $4, NULL), ($3, $4, '이미 있는 제목')`,
      [
        sessionWithMessage.id,
        sessionWithoutMessage.id,
        sessionAlreadyTitled.id,
        user.id,
      ],
    );
    await admin.query(
      `INSERT INTO messages (session_id, role, content) VALUES ($1, 'user', $2::jsonb)`,
      [
        sessionWithMessage.id,
        JSON.stringify("첫 메시지에서 파생될 제목입니다"),
      ],
    );
  });

  afterAll(async () => {
    await admin.query(
      "DELETE FROM messages WHERE session_id = ANY($1::uuid[])",
      [
        [
          sessionWithMessage.id,
          sessionWithoutMessage.id,
          sessionAlreadyTitled.id,
        ],
      ],
    );
    await admin.query("DELETE FROM sessions WHERE id = ANY($1::uuid[])", [
      [
        sessionWithMessage.id,
        sessionWithoutMessage.id,
        sessionAlreadyTitled.id,
      ],
    ]);
    await admin.query("DELETE FROM users WHERE id = $1", [user.id]);
    await admin.query("DELETE FROM organizations WHERE id = $1", [org.id]);
    await admin.end();
  });

  it("메시지 있는 null 제목 세션은 첫 사용자 메시지에서 파생된 제목으로 백필된다", async () => {
    const result = await backfillSessionTitles(admin);
    expect(result.updated).toBeGreaterThanOrEqual(1);

    const res = await admin.query("SELECT title FROM sessions WHERE id = $1", [
      sessionWithMessage.id,
    ]);
    expect(res.rows[0]?.title).toBe("첫 메시지에서 파생될 제목입니다");
  });

  it("메시지 없는 null 제목 세션은 그대로 null 을 유지한다", async () => {
    const res = await admin.query("SELECT title FROM sessions WHERE id = $1", [
      sessionWithoutMessage.id,
    ]);
    expect(res.rows[0]?.title).toBeNull();
  });

  it("이미 제목이 있는 세션은 건드리지 않는다", async () => {
    const res = await admin.query("SELECT title FROM sessions WHERE id = $1", [
      sessionAlreadyTitled.id,
    ]);
    expect(res.rows[0]?.title).toBe("이미 있는 제목");
  });

  it("재실행해도 이미 백필된 세션은 다시 건드리지 않는다(idempotent)", async () => {
    const result = await backfillSessionTitles(admin);
    expect(result.updated).toBe(0);

    const res = await admin.query("SELECT title FROM sessions WHERE id = $1", [
      sessionWithMessage.id,
    ]);
    expect(res.rows[0]?.title).toBe("첫 메시지에서 파생될 제목입니다");
  });
});
