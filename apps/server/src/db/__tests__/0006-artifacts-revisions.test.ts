// 0006_artifacts_revisions.sql 정적 검증 (06-DATA-MODEL.md § 0006_artifacts.sql 본문과 일치 여부).
// 실 Postgres 없이도 실행 가능 — DDL 문자열 구조 + journal 등록 순서만 확인.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const MIGRATION_PATH = new URL(
  "../migrations/0006_artifacts_revisions.sql",
  import.meta.url,
);
const JOURNAL_PATH = new URL(
  "../migrations/meta/_journal.json",
  import.meta.url,
);

describe("0006_artifacts_revisions migration", () => {
  const sql = readFileSync(MIGRATION_PATH, "utf-8");

  it("artifacts 테이블을 14-INTERFACES ArtifactRecord 컬럼 + storage_kind CHECK 로 생성한다", () => {
    expect(sql).toMatch(/CREATE TABLE artifacts/);
    expect(sql).toMatch(
      /session_id UUID REFERENCES sessions\(id\) ON DELETE SET NULL/,
    );
    expect(sql).toMatch(
      /created_by UUID NOT NULL REFERENCES users\(id\) ON DELETE RESTRICT/,
    );
    expect(sql).toMatch(
      /type TEXT NOT NULL CHECK \(type IN \('pptx','pdf','docx','xlsx','markdown','html','image','other'\)\)/,
    );
    expect(sql).toMatch(/size_bytes BIGINT NOT NULL/);
    expect(sql).toMatch(
      /storage_kind TEXT NOT NULL CHECK \(storage_kind IN \('inline','s3'\)\)/,
    );
    expect(sql).toMatch(
      /storage_kind = 'inline' AND inline_content IS NOT NULL AND s3_key IS NULL/,
    );
    expect(sql).toMatch(
      /storage_kind = 's3'\s+AND s3_key IS NOT NULL AND inline_content IS NULL/,
    );
  });

  it("artifact_revisions 테이블을 artifact cascade + composite PK 로 생성한다", () => {
    expect(sql).toMatch(/CREATE TABLE artifact_revisions/);
    expect(sql).toMatch(
      /artifact_id UUID NOT NULL REFERENCES artifacts\(id\) ON DELETE CASCADE/,
    );
    expect(sql).toMatch(/PRIMARY KEY \(artifact_id, version\)/);
  });

  it("RLS 를 활성화하고 NULLIF 안전 패턴으로 policy 를 정의한다", () => {
    expect(sql).toMatch(/ALTER TABLE artifacts +ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(
      /ALTER TABLE artifact_revisions ENABLE ROW LEVEL SECURITY/,
    );
    expect(sql).toMatch(
      /CREATE POLICY artifacts_owner_or_session ON artifacts/,
    );
    expect(sql).toMatch(
      /CREATE POLICY artifact_revisions_via_artifact ON artifact_revisions/,
    );
    // 0001~0005/0014/0015 와 동일 사유 — bare current_setting(...)::uuid 캐스트 금지 (P1-T1-01 버그 패턴).
    expect(sql).not.toMatch(/[^F]current_setting\('app\.\w+', true\)::uuid/);
  });
});

describe("migration journal", () => {
  it("0006_artifacts_revisions 가 0005_project_documents_chunks 이후 순서로 등록돼 있다", () => {
    const journal = JSON.parse(readFileSync(JOURNAL_PATH, "utf-8")) as {
      entries: { tag: string }[];
    };
    const tags = journal.entries.map((e) => e.tag);
    expect(tags).toContain("0006_artifacts_revisions");
    expect(tags.indexOf("0006_artifacts_revisions")).toBeGreaterThan(
      tags.indexOf("0005_project_documents_chunks"),
    );
  });
});
