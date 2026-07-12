// 0002_sessions_messages.sql 정적 검증 (06-DATA-MODEL.md § 부록 F 0002 본문과 일치 여부).
// 실 Postgres 없이도 실행 가능 — DDL 문자열 구조 + journal 등록 순서만 확인.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const MIGRATION_PATH = new URL(
  "../migrations/0002_sessions_messages.sql",
  import.meta.url,
);
const JOURNAL_PATH = new URL(
  "../migrations/meta/_journal.json",
  import.meta.url,
);

describe("0002_sessions_messages migration", () => {
  const sql = readFileSync(MIGRATION_PATH, "utf-8");

  it("sessions 를 user_id FK + nullable project_id(FK 는 0004 에서 추가) 로 생성한다", () => {
    expect(sql).toMatch(/CREATE TABLE sessions/);
    expect(sql).toMatch(
      /user_id UUID NOT NULL REFERENCES users\(id\) ON DELETE CASCADE/,
    );
    expect(sql).toMatch(/project_id UUID,/);
    expect(sql).not.toMatch(/project_id UUID NOT NULL/);
    expect(sql).not.toMatch(/project_id UUID.*REFERENCES projects/);
  });

  it("sessions 에 last_message_at 기준 조회용 인덱스와 touch trigger 를 갖는다", () => {
    expect(sql).toMatch(
      /CREATE INDEX sessions_user_lastmsg_idx ON sessions\(user_id, last_message_at DESC\)/,
    );
    expect(sql).toMatch(
      /CREATE TRIGGER sessions_touch BEFORE UPDATE ON sessions FOR EACH ROW EXECUTE FUNCTION touch_updated_at\(\)/,
    );
  });

  it("messages 를 session_id FK + role CHECK + content JSONB 로 생성한다", () => {
    expect(sql).toMatch(/CREATE TABLE messages/);
    expect(sql).toMatch(
      /session_id UUID NOT NULL REFERENCES sessions\(id\) ON DELETE CASCADE/,
    );
    expect(sql).toMatch(
      /role TEXT NOT NULL CHECK \(role IN \('user','assistant','system','tool'\)\)/,
    );
    expect(sql).toMatch(/content JSONB NOT NULL/);
    expect(sql).toMatch(
      /parent_message_id UUID REFERENCES messages\(id\) ON DELETE SET NULL/,
    );
  });

  it("messages_session_created_idx 와 project_id partial index 를 갖는다", () => {
    expect(sql).toMatch(
      /CREATE INDEX messages_session_created_idx ON messages\(session_id, created_at\)/,
    );
    expect(sql).toMatch(
      /CREATE INDEX sessions_project_idx ON sessions\(project_id\) WHERE project_id IS NOT NULL/,
    );
  });

  it("sessions/messages 에 RLS 를 활성화하고 소유자 기반 policy 를 정의한다", () => {
    expect(sql).toMatch(/ALTER TABLE sessions ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/ALTER TABLE messages ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/CREATE POLICY sessions_owner ON sessions/);
    expect(sql).toMatch(
      /USING \(user_id = NULLIF\(current_setting\('app\.user_id', true\), ''\)::uuid\)/,
    );
    expect(sql).toMatch(/CREATE POLICY messages_via_session ON messages/);
    expect(sql).toMatch(/EXISTS \(\s*SELECT 1 FROM sessions s/);
  });
});

describe("migration journal", () => {
  it("0002_sessions_messages 가 0001_identity 이후 순서로 등록돼 있다", () => {
    const journal = JSON.parse(readFileSync(JOURNAL_PATH, "utf-8")) as {
      entries: { tag: string }[];
    };
    const tags = journal.entries.map((e) => e.tag);
    expect(tags).toContain("0002_sessions_messages");
    expect(tags.indexOf("0002_sessions_messages")).toBeGreaterThan(
      tags.indexOf("0001_identity"),
    );
  });
});
