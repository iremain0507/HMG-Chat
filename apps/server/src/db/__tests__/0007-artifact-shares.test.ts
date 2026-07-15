// 0007_artifact_shares.sql 정적 검증 (06-DATA-MODEL.md § 0007_artifact_shares.sql 본문과 일치 여부).
// Phase 6 에서 활성화(ArtifactShareRepo/routes/public-share) — 이 태스크는 DDL 만.
// 실 Postgres 없이도 실행 가능 — DDL 문자열 구조 + journal 등록 순서만 확인.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const MIGRATION_PATH = new URL(
  "../migrations/0007_artifact_shares.sql",
  import.meta.url,
);
const JOURNAL_PATH = new URL(
  "../migrations/meta/_journal.json",
  import.meta.url,
);

describe("0007_artifact_shares migration", () => {
  const sql = readFileSync(MIGRATION_PATH, "utf-8");

  it("artifact_shares 테이블을 14-INTERFACES ArtifactShareRecord 컬럼으로 생성한다", () => {
    expect(sql).toMatch(/CREATE TABLE artifact_shares/);
    expect(sql).toMatch(
      /artifact_id UUID NOT NULL REFERENCES artifacts\(id\) ON DELETE CASCADE/,
    );
    expect(sql).toMatch(
      /token UUID UNIQUE NOT NULL DEFAULT uuid_generate_v4\(\)/,
    );
    expect(sql).toMatch(
      /issued_by UUID NOT NULL REFERENCES users\(id\) ON DELETE RESTRICT/,
    );
    expect(sql).toMatch(/expires_at TIMESTAMPTZ NOT NULL/);
    expect(sql).toMatch(/revoked_at TIMESTAMPTZ/);
    expect(sql).toMatch(/view_count INT NOT NULL DEFAULT 0/);
  });

  it("token + 만료 조회용 인덱스를 생성한다", () => {
    expect(sql).toMatch(
      /CREATE INDEX artifact_shares_token_idx ON artifact_shares\(token\)/,
    );
    expect(sql).toMatch(
      /CREATE INDEX artifact_shares_active_idx\s+ON artifact_shares\(expires_at\)\s+WHERE revoked_at IS NULL/,
    );
  });

  it("RLS 를 활성화하고 issuer-본인 또는 same-org admin 만 허용한다 (org boundary 강제)", () => {
    expect(sql).toMatch(
      /ALTER TABLE artifact_shares ENABLE ROW LEVEL SECURITY/,
    );
    expect(sql).toMatch(
      /CREATE POLICY artifact_shares_issuer_or_admin ON artifact_shares/,
    );
    expect(sql).toMatch(
      /issued_by = NULLIF\(current_setting\('app\.user_id', true\), ''\)::uuid/,
    );
    // same-org admin branch — issuer 이외에도 admin/owner 관리 가능해야 함 (06-DATA-MODEL § 96 lint 규칙과 동일 사유).
    expect(sql).toMatch(/current_user_is_admin\(\)/);
    // 0001~0006/0012~0015 와 동일 사유 — bare current_setting(...)::uuid 캐스트 금지 (P1-T1-01 버그 패턴).
    expect(sql).not.toMatch(/[^F]current_setting\('app\.\w+', true\)::uuid/);
  });
});

describe("migration journal", () => {
  it("0007_artifact_shares 가 0006_artifacts_revisions 이후 순서로 등록돼 있다", () => {
    const journal = JSON.parse(readFileSync(JOURNAL_PATH, "utf-8")) as {
      entries: { tag: string }[];
    };
    const tags = journal.entries.map((e) => e.tag);
    expect(tags).toContain("0007_artifact_shares");
    expect(tags.indexOf("0007_artifact_shares")).toBeGreaterThan(
      tags.indexOf("0006_artifacts_revisions"),
    );
  });
});
