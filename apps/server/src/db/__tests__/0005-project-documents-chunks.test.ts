// 0005_project_documents_chunks.sql 정적 검증 (06-DATA-MODEL.md § 0005_documents_chunks.sql 본문과 일치 여부).
// 실 Postgres 없이도 실행 가능 — DDL 문자열 구조 + journal 등록 순서만 확인.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const MIGRATION_PATH = new URL(
  "../migrations/0005_project_documents_chunks.sql",
  import.meta.url,
);
const JOURNAL_PATH = new URL(
  "../migrations/meta/_journal.json",
  import.meta.url,
);

describe("0005_project_documents_chunks migration", () => {
  const sql = readFileSync(MIGRATION_PATH, "utf-8");

  it("project_documents 테이블을 14-INTERFACES ProjectDocumentRecord 컬럼으로 생성한다", () => {
    expect(sql).toMatch(/CREATE TABLE project_documents/);
    expect(sql).toMatch(
      /project_id UUID NOT NULL REFERENCES projects\(id\) ON DELETE CASCADE/,
    );
    expect(sql).toMatch(/mime_type TEXT NOT NULL/);
    expect(sql).toMatch(
      /index_status TEXT NOT NULL DEFAULT 'pending'\s*\n\s*CHECK \(index_status IN \('pending','parsing','chunking','embedding','indexed','failed'\)\)/,
    );
    expect(sql).toMatch(
      /created_by UUID NOT NULL REFERENCES users\(id\) ON DELETE RESTRICT/,
    );
    expect(sql).toMatch(
      /CONSTRAINT project_documents_dedup UNIQUE \(project_id, content_hash\)/,
    );
  });

  it("document_chunks 테이블을 pgvector + generated tsvector 로 생성한다", () => {
    expect(sql).toMatch(/CREATE TABLE document_chunks/);
    expect(sql).toMatch(
      /document_id UUID NOT NULL REFERENCES project_documents\(id\) ON DELETE CASCADE/,
    );
    expect(sql).toMatch(/embedding VECTOR\(1024\)/);
    expect(sql).toMatch(
      /content_tsv TSVECTOR\s*\n\s*GENERATED ALWAYS AS \(to_tsvector\('simple', content\)\) STORED/,
    );
    expect(sql).toMatch(/UNIQUE \(document_id, chunk_index\)/);
    expect(sql).toMatch(
      /USING hnsw \(embedding vector_cosine_ops\)\s*\n\s*WITH \(m = 16, ef_construction = 64\)/,
    );
  });

  it("RLS 를 활성화하고 NULLIF 안전 패턴으로 policy 를 정의한다", () => {
    expect(sql).toMatch(
      /ALTER TABLE project_documents ENABLE ROW LEVEL SECURITY/,
    );
    expect(sql).toMatch(
      /ALTER TABLE document_chunks\s+ENABLE ROW LEVEL SECURITY/,
    );
    expect(sql).toMatch(/CREATE POLICY pd_select ON project_documents/);
    expect(sql).toMatch(/CREATE POLICY pd_insert ON project_documents/);
    expect(sql).toMatch(/CREATE POLICY pd_update ON project_documents/);
    expect(sql).toMatch(/CREATE POLICY pd_delete ON project_documents/);
    expect(sql).toMatch(/CREATE POLICY dc_select ON document_chunks/);
    expect(sql).toMatch(/CREATE POLICY dc_insert ON document_chunks/);
    expect(sql).toMatch(/CREATE POLICY dc_update ON document_chunks/);
    expect(sql).toMatch(/CREATE POLICY dc_delete ON document_chunks/);
    // 0001~0004/0015 와 동일 사유 — bare current_setting(...)::uuid 캐스트 금지 (P1-T1-01 버그 패턴).
    expect(sql).not.toMatch(/[^F]current_setting\('app\.\w+', true\)::uuid/);
  });

  it("document_chunks policy 는 project_documents 를 경유해 project 권한 함수를 사용한다", () => {
    expect(sql).toMatch(
      /EXISTS \(SELECT 1 FROM project_documents pd\s*\n\s*WHERE pd\.id = document_chunks\.document_id\s*\n\s*AND user_can_read_project\(pd\.project_id\)\)/,
    );
    expect(sql).toMatch(
      /EXISTS \(SELECT 1 FROM project_documents pd\s*\n\s*WHERE pd\.id = document_chunks\.document_id\s*\n\s*AND user_can_write_project\(pd\.project_id\)\)/,
    );
  });
});

describe("migration journal", () => {
  it("0005_project_documents_chunks 가 0015_project_team_scope_rls 이후 순서로 등록돼 있다", () => {
    const journal = JSON.parse(readFileSync(JOURNAL_PATH, "utf-8")) as {
      entries: { tag: string }[];
    };
    const tags = journal.entries.map((e) => e.tag);
    expect(tags).toContain("0005_project_documents_chunks");
    expect(tags.indexOf("0005_project_documents_chunks")).toBeGreaterThan(
      tags.indexOf("0015_project_team_scope_rls"),
    );
  });
});
