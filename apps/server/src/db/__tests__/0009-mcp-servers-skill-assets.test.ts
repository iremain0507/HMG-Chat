// 0009_mcp_servers_skill_assets.sql 정적 검증 (06-DATA-MODEL.md § 0009_mcp_servers_skills.sql
// 본문 + 14-INTERFACES McpServerRecord/SkillAssetRecord 컬럼과 일치 여부).
// 0007-artifact-shares.test.ts 와 동일 패턴 — 실 Postgres 없이도 실행 가능.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const MIGRATION_PATH = new URL(
  "../migrations/0009_mcp_servers_skill_assets.sql",
  import.meta.url,
);
const JOURNAL_PATH = new URL(
  "../migrations/meta/_journal.json",
  import.meta.url,
);

describe("0009_mcp_servers_skill_assets migration", () => {
  const sql = readFileSync(MIGRATION_PATH, "utf-8");

  it("mcp_servers 테이블을 14-INTERFACES McpServerRecord 컬럼으로 생성한다", () => {
    expect(sql).toMatch(/CREATE TABLE mcp_servers/);
    expect(sql).toMatch(
      /org_id UUID NOT NULL REFERENCES organizations\(id\) ON DELETE CASCADE/,
    );
    expect(sql).toMatch(
      /project_id UUID REFERENCES projects\(id\) ON DELETE CASCADE/,
    );
    expect(sql).toMatch(
      /user_id UUID REFERENCES users\(id\) ON DELETE CASCADE/,
    );
    expect(sql).toMatch(/name TEXT NOT NULL/);
    expect(sql).toMatch(/url TEXT NOT NULL/);
    expect(sql).toMatch(
      /transport TEXT NOT NULL CHECK \(transport IN \('streamable_http','sse'\)\)/,
    );
    expect(sql).toMatch(/supported_tools JSONB NOT NULL DEFAULT '\[\]'::jsonb/);
    expect(sql).toMatch(/last_discovered_at TIMESTAMPTZ/);
    expect(sql).toMatch(
      /status TEXT NOT NULL DEFAULT 'active' CHECK \(status IN \('active','degraded','suspended'\)\)/,
    );
  });

  it("scope 조회용 인덱스를 생성한다", () => {
    expect(sql).toMatch(
      /CREATE INDEX mcp_servers_scope_idx ON mcp_servers\(org_id, project_id, user_id\)/,
    );
  });

  it("skill_assets 테이블을 composite PK (skill_id, filename) 로 생성한다", () => {
    expect(sql).toMatch(/CREATE TABLE skill_assets/);
    expect(sql).toMatch(/skill_id TEXT NOT NULL/);
    expect(sql).toMatch(/filename TEXT NOT NULL/);
    expect(sql).toMatch(/PRIMARY KEY \(skill_id, filename\)/);
  });

  it("RLS 를 활성화하고 org/project/user scope + admin 을 강제한다", () => {
    expect(sql).toMatch(/ALTER TABLE mcp_servers\s+ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/ALTER TABLE skill_assets ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/CREATE POLICY mcp_servers_scope ON mcp_servers/);
    expect(sql).toMatch(
      /CREATE POLICY mcp_servers_modify_admin ON mcp_servers/,
    );
    expect(sql).toMatch(/current_user_is_admin\(\)/);
    // 0001~0008 과 동일 사유 — bare current_setting(...)::uuid 캐스트 금지 (P1-T1-01 버그 패턴).
    expect(sql).not.toMatch(/[^F]current_setting\('app\.\w+', true\)::uuid/);
  });
});

describe("migration journal", () => {
  it("0009_mcp_servers_skill_assets 가 0008_user_memories_locks 이후 순서로 등록돼 있다", () => {
    const journal = JSON.parse(readFileSync(JOURNAL_PATH, "utf-8")) as {
      entries: { tag: string }[];
    };
    const tags = journal.entries.map((e) => e.tag);
    expect(tags).toContain("0009_mcp_servers_skill_assets");
    expect(tags.indexOf("0009_mcp_servers_skill_assets")).toBeGreaterThan(
      tags.indexOf("0008_user_memories_locks"),
    );
  });
});
