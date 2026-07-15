// 0012_password_or_magic.sql 정적 검증 (06-DATA-MODEL.md § 0012 본문과 일치 여부).
// 실 Postgres 없이도 실행 가능 — DDL 문자열 구조 + journal 등록 순서만 확인.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const MIGRATION_PATH = new URL(
  "../migrations/0012_password_or_magic.sql",
  import.meta.url,
);
const JOURNAL_PATH = new URL(
  "../migrations/meta/_journal.json",
  import.meta.url,
);

describe("0012_password_or_magic migration", () => {
  const sql = readFileSync(MIGRATION_PATH, "utf-8");

  it("users 에 password_hash + magic_link_salt 를 nullable 로 추가한다 (nullable-first)", () => {
    expect(sql).toMatch(
      /ALTER TABLE users[\s\S]*?ADD COLUMN password_hash TEXT/,
    );
    expect(sql).toMatch(/ADD COLUMN magic_link_salt TEXT/);
    expect(sql).not.toMatch(/password_hash TEXT NOT NULL/);
    expect(sql).not.toMatch(/magic_link_salt TEXT NOT NULL/);
  });

  it("magic_link_tokens 를 token_hash PK + email/org_id/intent 필수 컬럼으로 생성한다", () => {
    expect(sql).toMatch(/CREATE TABLE magic_link_tokens/);
    expect(sql).toMatch(/token_hash TEXT PRIMARY KEY/);
    expect(sql).toMatch(/email CITEXT NOT NULL/);
    expect(sql).toMatch(
      /org_id UUID NOT NULL REFERENCES organizations\(id\) ON DELETE CASCADE/,
    );
    expect(sql).toMatch(
      /intent TEXT NOT NULL CHECK \(intent IN \('signup','login'\)\)/,
    );
    expect(sql).toMatch(
      /user_id UUID REFERENCES users\(id\) ON DELETE CASCADE/,
    );
  });

  it("signup 흐름용 create_user_from_magic_link SECURITY DEFINER 함수를 정의한다", () => {
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION create_user_from_magic_link/,
    );
    expect(sql).toMatch(/SECURITY DEFINER/);
    expect(sql).toMatch(/RETURNS UUID/);
  });

  it("magic_link_tokens 에는 RLS 를 적용하지 않는다 (signup 흐름엔 app.user_id 없음, 06 § 0012)", () => {
    expect(sql).not.toMatch(
      /ALTER TABLE magic_link_tokens ENABLE ROW LEVEL SECURITY/,
    );
  });
});

describe("migration journal", () => {
  it("0012_password_or_magic 이 0001_identity 이후 순서로 등록돼 있다", () => {
    const journal = JSON.parse(readFileSync(JOURNAL_PATH, "utf-8")) as {
      entries: { tag: string }[];
    };
    const tags = journal.entries.map((e) => e.tag);
    expect(tags).toContain("0012_password_or_magic");
    expect(tags.indexOf("0012_password_or_magic")).toBeGreaterThan(
      tags.indexOf("0001_identity"),
    );
  });
});
