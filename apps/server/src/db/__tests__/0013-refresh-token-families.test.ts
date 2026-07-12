// 0013_refresh_token_families.sql 정적 검증 (06-DATA-MODEL.md § 0013 본문과 일치 여부).
// 실 Postgres 없이도 실행 가능 — DDL 문자열 구조 + journal 등록 순서만 확인.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const MIGRATION_PATH = new URL(
  "../migrations/0013_refresh_token_families.sql",
  import.meta.url,
);
const JOURNAL_PATH = new URL(
  "../migrations/meta/_journal.json",
  import.meta.url,
);

describe("0013_refresh_token_families migration", () => {
  const sql = readFileSync(MIGRATION_PATH, "utf-8");

  it("refresh_token_families 를 family_id PK + user_id FK 로 생성한다", () => {
    expect(sql).toMatch(/CREATE TABLE refresh_token_families/);
    expect(sql).toMatch(/family_id UUID PRIMARY KEY/);
    expect(sql).toMatch(
      /user_id UUID NOT NULL REFERENCES users\(id\) ON DELETE CASCADE/,
    );
  });

  it("rotation 추적용 current_generation/current_jti/last_used_at 컬럼을 갖는다", () => {
    expect(sql).toMatch(/current_generation INT NOT NULL DEFAULT 1/);
    expect(sql).toMatch(
      /current_jti UUID NOT NULL DEFAULT uuid_generate_v4\(\)/,
    );
    expect(sql).toMatch(/last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW\(\)/);
  });

  it("도난 감지용 revoked_at/revoke_reason 컬럼을 갖는다 (revoke_reason 은 CHECK 제약)", () => {
    expect(sql).toMatch(/revoked_at TIMESTAMPTZ/);
    expect(sql).toMatch(
      /revoke_reason TEXT CHECK \(revoke_reason IN \('theft_suspected','logout','admin','expired'\)\)/,
    );
  });

  it("active family 조회용 partial index 를 갖는다", () => {
    expect(sql).toMatch(
      /CREATE INDEX refresh_token_families_user_active_idx\s*\n\s*ON refresh_token_families\(user_id\) WHERE revoked_at IS NULL/,
    );
  });

  it("RLS 를 강제하고 소유자만 접근 가능한 rtf_owner policy 를 정의한다", () => {
    expect(sql).toMatch(
      /ALTER TABLE refresh_token_families ENABLE ROW LEVEL SECURITY/,
    );
    expect(sql).toMatch(/CREATE POLICY rtf_owner ON refresh_token_families/);
    expect(sql).toMatch(
      /USING \(user_id = current_setting\('app\.user_id', true\)::uuid\)/,
    );
  });
});

describe("migration journal", () => {
  it("0013_refresh_token_families 가 0012_password_or_magic 이후 순서로 등록돼 있다", () => {
    const journal = JSON.parse(readFileSync(JOURNAL_PATH, "utf-8")) as {
      entries: { tag: string }[];
    };
    const tags = journal.entries.map((e) => e.tag);
    expect(tags).toContain("0013_refresh_token_families");
    expect(tags.indexOf("0013_refresh_token_families")).toBeGreaterThan(
      tags.indexOf("0012_password_or_magic"),
    );
  });
});
