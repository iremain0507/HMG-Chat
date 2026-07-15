// 0014_uploads.sql 정적 검증 (06-DATA-MODEL.md § 0014_uploads.sql 본문과 일치 여부).
// 실 Postgres 없이도 실행 가능 — DDL 문자열 구조 + journal 등록 순서만 확인.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const MIGRATION_PATH = new URL(
  "../migrations/0014_uploads.sql",
  import.meta.url,
);
const JOURNAL_PATH = new URL(
  "../migrations/meta/_journal.json",
  import.meta.url,
);

describe("0014_uploads migration", () => {
  const sql = readFileSync(MIGRATION_PATH, "utf-8");

  it("uploads 테이블을 14-INTERFACES UploadRecord 컬럼으로 생성한다", () => {
    expect(sql).toMatch(/CREATE TABLE uploads/);
    expect(sql).toMatch(
      /user_id UUID NOT NULL REFERENCES users\(id\) ON DELETE CASCADE/,
    );
    expect(sql).toMatch(
      /session_id UUID REFERENCES sessions\(id\) ON DELETE SET NULL/,
    );
    expect(sql).toMatch(/mime_type TEXT NOT NULL/);
    expect(sql).toMatch(/sha256 TEXT NOT NULL/);
    expect(sql).toMatch(/expires_at TIMESTAMPTZ NOT NULL/);
    expect(sql).toMatch(
      /CONSTRAINT uploads_user_sha_unique UNIQUE \(user_id, sha256\)/,
    );
  });

  it("ephemeral_chunks 테이블을 pgvector + session cascade 로 생성한다", () => {
    expect(sql).toMatch(/CREATE TABLE ephemeral_chunks/);
    expect(sql).toMatch(
      /session_id UUID NOT NULL REFERENCES sessions\(id\) ON DELETE CASCADE/,
    );
    expect(sql).toMatch(
      /upload_id UUID NOT NULL REFERENCES uploads\(id\) ON DELETE CASCADE/,
    );
    expect(sql).toMatch(/embedding vector\(1024\) NOT NULL/);
    expect(sql).toMatch(
      /USING hnsw \(embedding vector_cosine_ops\) WITH \(m=16, ef_construction=64\)/,
    );
  });

  it("RLS 를 활성화하고 NULLIF 안전 패턴으로 policy 를 정의한다", () => {
    expect(sql).toMatch(/ALTER TABLE uploads ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(
      /ALTER TABLE ephemeral_chunks ENABLE ROW LEVEL SECURITY/,
    );
    expect(sql).toMatch(/CREATE POLICY uploads_owner_select ON uploads/);
    expect(sql).toMatch(/CREATE POLICY uploads_owner_modify ON uploads/);
    expect(sql).toMatch(
      /CREATE POLICY ephemeral_chunks_session_owner ON ephemeral_chunks/,
    );
    // 0001~0005/0015 와 동일 사유 — bare current_setting(...)::uuid 캐스트 금지 (P1-T1-01 버그 패턴).
    expect(sql).not.toMatch(/[^F]current_setting\('app\.\w+', true\)::uuid/);
  });
});

describe("migration journal", () => {
  it("0014_uploads 가 0005_project_documents_chunks 이후 순서로 등록돼 있다", () => {
    const journal = JSON.parse(readFileSync(JOURNAL_PATH, "utf-8")) as {
      entries: { tag: string }[];
    };
    const tags = journal.entries.map((e) => e.tag);
    expect(tags).toContain("0014_uploads");
    expect(tags.indexOf("0014_uploads")).toBeGreaterThan(
      tags.indexOf("0005_project_documents_chunks"),
    );
  });
});
