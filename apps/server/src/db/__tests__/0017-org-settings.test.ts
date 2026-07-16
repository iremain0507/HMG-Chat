// 0017_org_settings.sql 정적 검증 (Phase 14 — Admin Settings 저장 모델 단일 출처).
// 0009/0015 와 동일 패턴 — 실 Postgres 없이도 실행 가능. 실 cross-org RLS 동작은
// src/__tests__/integration/rls-org-settings.test.ts (실 Postgres 필요) 에서 검증.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const MIGRATION_PATH = new URL(
  "../migrations/0017_org_settings.sql",
  import.meta.url,
);
const JOURNAL_PATH = new URL(
  "../migrations/meta/_journal.json",
  import.meta.url,
);

describe("0017_org_settings migration", () => {
  const sql = readFileSync(MIGRATION_PATH, "utf-8");

  it("org_settings 테이블을 org_id PK + settings JSONB DEFAULT '{}' 로 생성한다 (nullable-first)", () => {
    expect(sql).toMatch(/CREATE TABLE org_settings/);
    expect(sql).toMatch(
      /org_id UUID PRIMARY KEY REFERENCES organizations\(id\) ON DELETE CASCADE/,
    );
    expect(sql).toMatch(/settings JSONB NOT NULL DEFAULT '\{\}'::jsonb/);
    expect(sql).toMatch(
      /updated_by UUID REFERENCES users\(id\) ON DELETE SET NULL/,
    );
    expect(sql).toMatch(/updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW\(\)/);
  });

  it("기존 테이블에는 아무 변경도 가하지 않는다 (신규 테이블만 추가)", () => {
    expect(sql).not.toMatch(/ALTER TABLE (?!org_settings)/);
  });

  it("updated_at touch 트리거를 등록한다", () => {
    expect(sql).toMatch(
      /CREATE TRIGGER org_settings_touch BEFORE UPDATE ON org_settings FOR EACH ROW EXECUTE FUNCTION touch_updated_at\(\)/,
    );
  });

  it("RLS 를 ENABLE+FORCE 하고 org-scope select / org+admin modify 를 강제한다", () => {
    expect(sql).toMatch(/ALTER TABLE org_settings ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/ALTER TABLE org_settings FORCE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/CREATE POLICY org_settings_select ON org_settings/);
    expect(sql).toMatch(/FOR SELECT/);
    expect(sql).toMatch(
      /CREATE POLICY org_settings_modify_admin ON org_settings/,
    );
    expect(sql).toMatch(/current_user_is_admin\(\)/);
    // 0001~0016 과 동일 사유 — bare current_setting(...)::uuid 캐스트 금지 (P1-T1-01 버그 패턴).
    expect(sql).not.toMatch(/[^F]current_setting\('app\.\w+', true\)::uuid/);
  });
});

describe("migration journal", () => {
  it("0017_org_settings 가 0016_indexes_vacuum 이후 순서로 등록돼 있다", () => {
    const journal = JSON.parse(readFileSync(JOURNAL_PATH, "utf-8")) as {
      entries: { tag: string }[];
    };
    const tags = journal.entries.map((e) => e.tag);
    expect(tags).toContain("0017_org_settings");
    expect(tags.indexOf("0017_org_settings")).toBeGreaterThan(
      tags.indexOf("0016_indexes_vacuum"),
    );
  });
});
