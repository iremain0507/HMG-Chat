// 0015_project_team_scope_rls.sql 정적 검증 (06-DATA-MODEL.md § 0015_project_team_scope_rls.sql 본문과 일치 여부).
// 실 Postgres 없이도 실행 가능 — DDL 문자열 구조 + journal 등록 순서만 확인.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const MIGRATION_PATH = new URL(
  "../migrations/0015_project_team_scope_rls.sql",
  import.meta.url,
);
const JOURNAL_PATH = new URL(
  "../migrations/meta/_journal.json",
  import.meta.url,
);

describe("0015_project_team_scope_rls migration", () => {
  const sql = readFileSync(MIGRATION_PATH, "utf-8");

  it("projects_select 를 DROP 후 visibility 매트릭스(org/team org_unit 매칭/member) 로 재정의한다", () => {
    expect(sql).toMatch(/DROP POLICY IF EXISTS projects_select ON projects/);
    expect(sql).toMatch(
      /CREATE POLICY projects_select ON projects\s*\n\s*FOR SELECT/,
    );
    expect(sql).toMatch(/visibility = 'org'/);
    expect(sql).toMatch(
      /visibility = 'team' AND EXISTS \(\s*\n\s*SELECT 1 FROM user_org_units uou/,
    );
    expect(sql).toMatch(/uou\.org_unit_id = projects\.org_unit_id/);
  });

  it("projects_insert 를 DROP 후 재정의한다 (0004 와의 policy 이름 충돌 방지)", () => {
    expect(sql).toMatch(/DROP POLICY IF EXISTS projects_insert ON projects/);
    expect(sql).toMatch(
      /CREATE POLICY projects_insert ON projects\s*\n\s*FOR INSERT/,
    );
  });

  it("UPDATE/DELETE 를 4-policy 로 분리한다 (projects_update_owner_editor / projects_delete_owner)", () => {
    expect(sql).toMatch(
      /DROP POLICY IF EXISTS projects_modify_member ON projects/,
    );
    expect(sql).toMatch(
      /DROP POLICY IF EXISTS projects_delete_owner ON projects/,
    );
    expect(sql).toMatch(
      /CREATE POLICY projects_update_owner_editor ON projects\s*\n\s*FOR UPDATE/,
    );
    expect(sql).toMatch(
      /CREATE POLICY projects_delete_owner ON projects\s*\n\s*FOR DELETE/,
    );
  });

  it("projects_team_requires_unit CHECK 제약을 idempotent 하게 재정의한다", () => {
    expect(sql).toMatch(
      /ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_team_requires_unit/,
    );
    expect(sql).toMatch(
      /ADD CONSTRAINT projects_team_requires_unit\s*\n\s*CHECK \(visibility <> 'team' OR org_unit_id IS NOT NULL\)/,
    );
  });

  it("user_can_read_project / user_can_write_project SECURITY DEFINER 함수를 정의한다", () => {
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION user_can_read_project\(p_project_id UUID\)/,
    );
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION user_can_write_project\(p_project_id UUID\)/,
    );
    expect(sql).toMatch(
      /GRANT {2}EXECUTE ON FUNCTION user_can_read_project\(UUID\) {2}TO PUBLIC/,
    );
    expect(sql).toMatch(
      /GRANT {2}EXECUTE ON FUNCTION user_can_write_project\(UUID\) TO PUBLIC/,
    );
  });

  it("project_members 를 pm_select/pm_modify 로 재정의한다", () => {
    expect(sql).toMatch(
      /DROP POLICY IF EXISTS project_members_select ON project_members/,
    );
    expect(sql).toMatch(
      /DROP POLICY IF EXISTS project_members_modify_owner ON project_members/,
    );
    expect(sql).toMatch(/CREATE POLICY pm_select ON project_members/);
    expect(sql).toMatch(/CREATE POLICY pm_modify ON project_members/);
  });

  it("project_documents / document_chunks 정책은 to_regclass guard 로 테이블 존재 시에만 생성한다", () => {
    expect(sql).toMatch(/to_regclass\('public\.project_documents'\) IS NULL/);
    expect(sql).toMatch(/to_regclass\('public\.document_chunks'\) IS NULL/);
  });

  it("bare current_setting(...)::uuid 캐스트 대신 NULLIF 안전 패턴을 사용한다", () => {
    // 0001~0004 와 동일 사유 — P1-T1-01 에서 발견된 SET LOCAL 잔존 버그 회피.
    expect(sql).not.toMatch(/[^F]current_setting\('app\.\w+', true\)::uuid/);
  });
});

describe("migration journal", () => {
  it("0015_project_team_scope_rls 가 0004_projects_members 이후 순서로 등록돼 있다", () => {
    const journal = JSON.parse(readFileSync(JOURNAL_PATH, "utf-8")) as {
      entries: { tag: string }[];
    };
    const tags = journal.entries.map((e) => e.tag);
    expect(tags).toContain("0015_project_team_scope_rls");
    expect(tags.indexOf("0015_project_team_scope_rls")).toBeGreaterThan(
      tags.indexOf("0004_projects_members"),
    );
  });
});
