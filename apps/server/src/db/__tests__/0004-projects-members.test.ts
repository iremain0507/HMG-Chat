// 0004_projects_members.sql 정적 검증 (06-DATA-MODEL.md § 부록 A 0004 본문과 일치 여부).
// 실 Postgres 없이도 실행 가능 — DDL 문자열 구조 + journal 등록 순서만 확인.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const MIGRATION_PATH = new URL(
  "../migrations/0004_projects_members.sql",
  import.meta.url,
);
const JOURNAL_PATH = new URL(
  "../migrations/meta/_journal.json",
  import.meta.url,
);

describe("0004_projects_members migration", () => {
  const sql = readFileSync(MIGRATION_PATH, "utf-8");

  it("projects 테이블을 org_id/owner_id/visibility/org_unit_id 로 생성한다", () => {
    expect(sql).toMatch(/CREATE TABLE projects/);
    expect(sql).toMatch(
      /org_id UUID NOT NULL REFERENCES organizations\(id\) ON DELETE CASCADE/,
    );
    expect(sql).toMatch(
      /owner_id UUID NOT NULL REFERENCES users\(id\) ON DELETE RESTRICT/,
    );
    expect(sql).toMatch(
      /visibility TEXT NOT NULL CHECK \(visibility IN \('private','team','org'\)\)/,
    );
    expect(sql).toMatch(
      /org_unit_id UUID REFERENCES org_units\(id\) ON DELETE SET NULL/,
    );
    expect(sql).toMatch(
      /CONSTRAINT projects_team_orgunit_required\s*\n\s*CHECK \(visibility <> 'team' OR org_unit_id IS NOT NULL\)/,
    );
  });

  it("project_members 테이블을 composite PK 로 생성한다", () => {
    expect(sql).toMatch(/CREATE TABLE project_members/);
    expect(sql).toMatch(
      /project_id UUID NOT NULL REFERENCES projects\(id\) ON DELETE CASCADE/,
    );
    expect(sql).toMatch(
      /user_id UUID NOT NULL REFERENCES users\(id\) ON DELETE CASCADE/,
    );
    expect(sql).toMatch(
      /role TEXT NOT NULL CHECK \(role IN \('owner','editor','viewer'\)\)/,
    );
    expect(sql).toMatch(/PRIMARY KEY \(project_id, user_id\)/);
  });

  it("sessions.project_id 에 FK constraint 를 추가한다", () => {
    expect(sql).toMatch(
      /ALTER TABLE sessions ADD CONSTRAINT sessions_project_fk\s*\n\s*FOREIGN KEY \(project_id\) REFERENCES projects\(id\) ON DELETE SET NULL/,
    );
  });

  it("RLS 를 활성화하고 NULLIF 안전 패턴으로 policy 를 정의한다", () => {
    expect(sql).toMatch(/ALTER TABLE projects\s+ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(
      /ALTER TABLE project_members ENABLE ROW LEVEL SECURITY/,
    );
    expect(sql).toMatch(/CREATE POLICY projects_select ON projects/);
    expect(sql).toMatch(/CREATE POLICY projects_insert ON projects/);
    expect(sql).toMatch(/CREATE POLICY projects_modify_member ON projects/);
    expect(sql).toMatch(/CREATE POLICY projects_delete_owner ON projects/);
    expect(sql).toMatch(
      /CREATE POLICY project_members_select ON project_members/,
    );
    expect(sql).toMatch(
      /CREATE POLICY project_members_modify_owner ON project_members/,
    );
    // 0002/0003 과 동일 사유 — bare current_setting(...)::uuid 캐스트 금지 (P1-T1-01 버그 패턴).
    expect(sql).not.toMatch(/[^F]current_setting\('app\.\w+', true\)::uuid/);
  });

  it("project_members_modify_owner 는 재귀 회피를 위해 user_is_project_owner 를 사용한다", () => {
    expect(sql).toMatch(/USING \(user_is_project_owner\(project_id\)\)/);
    expect(sql).toMatch(/WITH CHECK \(user_is_project_owner\(project_id\)\)/);
  });

  it("bootstrap_project_owner SECURITY DEFINER 함수를 정의한다 (최초 owner row bootstrap)", () => {
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION bootstrap_project_owner\(p_project_id UUID, p_user_id UUID\)/,
    );
    expect(sql).toMatch(/SECURITY DEFINER/);
    expect(sql).toMatch(
      /RAISE EXCEPTION 'bootstrap_project_owner: user_id mismatch with app\.user_id'/,
    );
    expect(sql).toMatch(
      /RAISE EXCEPTION 'bootstrap_project_owner: project % already has owner', p_project_id/,
    );
    expect(sql).toMatch(
      /INSERT INTO project_members \(project_id, user_id, role\)\s*\n\s*VALUES \(p_project_id, p_user_id, 'owner'\)/,
    );
  });
});

describe("migration journal", () => {
  it("0004_projects_members 가 0003_sessions_active_runs 이후 순서로 등록돼 있다", () => {
    const journal = JSON.parse(readFileSync(JOURNAL_PATH, "utf-8")) as {
      entries: { tag: string }[];
    };
    const tags = journal.entries.map((e) => e.tag);
    expect(tags).toContain("0004_projects_members");
    expect(tags.indexOf("0004_projects_members")).toBeGreaterThan(
      tags.indexOf("0003_sessions_active_runs"),
    );
  });
});
