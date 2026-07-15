// 0003_sessions_active_runs.sql 정적 검증 (06-DATA-MODEL.md § 부록 F 0003 본문과 일치 여부).
// 실 Postgres 없이도 실행 가능 — DDL 문자열 구조 + journal 등록 순서만 확인.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const MIGRATION_PATH = new URL(
  "../migrations/0003_sessions_active_runs.sql",
  import.meta.url,
);
const JOURNAL_PATH = new URL(
  "../migrations/meta/_journal.json",
  import.meta.url,
);

describe("0003_sessions_active_runs migration", () => {
  const sql = readFileSync(MIGRATION_PATH, "utf-8");

  it("sessions_active_runs 를 session_id PK/FK + job_id + status CHECK 로 생성한다", () => {
    expect(sql).toMatch(/CREATE TABLE sessions_active_runs/);
    expect(sql).toMatch(
      /session_id UUID PRIMARY KEY REFERENCES sessions\(id\) ON DELETE CASCADE/,
    );
    expect(sql).toMatch(/job_id UUID NOT NULL/);
    expect(sql).toMatch(
      /status TEXT NOT NULL CHECK \(status IN \('pending','running','cancelled','completed'\)\)/,
    );
    expect(sql).toMatch(/pending_hitl JSONB/);
  });

  it("touch trigger 를 갖는다", () => {
    expect(sql).toMatch(
      /CREATE TRIGGER sessions_active_runs_touch BEFORE UPDATE ON sessions_active_runs FOR EACH ROW EXECUTE FUNCTION touch_updated_at\(\)/,
    );
  });

  it("RLS 를 활성화하고 session 경유 소유자 기반 policy 를 정의한다", () => {
    expect(sql).toMatch(
      /ALTER TABLE sessions_active_runs ENABLE ROW LEVEL SECURITY/,
    );
    expect(sql).toMatch(
      /CREATE POLICY active_runs_via_session ON sessions_active_runs/,
    );
    expect(sql).toMatch(/EXISTS \(\s*SELECT 1 FROM sessions s/);
    expect(sql).toMatch(
      /s\.user_id = NULLIF\(current_setting\('app\.user_id', true\), ''\)::uuid/,
    );
  });
});

describe("migration journal", () => {
  it("0003_sessions_active_runs 가 0002_sessions_messages 이후 순서로 등록돼 있다", () => {
    const journal = JSON.parse(readFileSync(JOURNAL_PATH, "utf-8")) as {
      entries: { tag: string }[];
    };
    const tags = journal.entries.map((e) => e.tag);
    expect(tags).toContain("0003_sessions_active_runs");
    expect(tags.indexOf("0003_sessions_active_runs")).toBeGreaterThan(
      tags.indexOf("0002_sessions_messages"),
    );
  });
});
