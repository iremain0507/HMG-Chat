// knowledge-retrieval-pg.test.ts — P20-T3-02: knowledge/knowledge-retrieval-pg.ts 의
//   createKnowledgeRetrievalPgPort().loadCandidates 가 project_documents/document_chunks(0005)
//   시드 데이터로부터 실제 candidates + sourceMetaByDocumentId 를 반환하는지, 그리고 project 스코프
//   필터가 cross-org 청크를 새지 않는지(다른 org 의 project_id 로 조회 시 그 project 소속만 반환)를
//   실 Postgres 로 검증한다.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pgPool } from "../../db/client.js";
import { createKnowledgeRetrievalPgPort } from "../../knowledge/knowledge-retrieval-pg.js";

describe("knowledge-retrieval-pg (KnowledgeRetrievalPort)", () => {
  const orgA = {
    id: randomUUID(),
    domain: `org-krp-a-${randomUUID()}.example.com`,
  };
  const orgB = {
    id: randomUUID(),
    domain: `org-krp-b-${randomUUID()}.example.com`,
  };
  const ownerA = {
    id: randomUUID(),
    email: `owner-a-${randomUUID()}@x.example.com`,
  };
  const ownerB = {
    id: randomUUID(),
    email: `owner-b-${randomUUID()}@x.example.com`,
  };
  const projectA = { id: randomUUID() };
  const projectB = { id: randomUUID() };
  const docA = { id: randomUUID() };
  const docB = { id: randomUUID() };

  const port = createKnowledgeRetrievalPgPort();

  beforeAll(async () => {
    await pgPool.query(
      "INSERT INTO organizations (id, name, domain) VALUES ($1,'Org KRP A',$2),($3,'Org KRP B',$4)",
      [orgA.id, orgA.domain, orgB.id, orgB.domain],
    );
    await pgPool.query(
      "INSERT INTO users (id, org_id, email) VALUES ($1,$2,$3),($4,$5,$6)",
      [ownerA.id, orgA.id, ownerA.email, ownerB.id, orgB.id, ownerB.email],
    );
    await pgPool.query(
      "INSERT INTO projects (id, org_id, owner_id, name, visibility) VALUES ($1,$2,$3,'Project A','org'),($4,$5,$6,'Project B','org')",
      [projectA.id, orgA.id, ownerA.id, projectB.id, orgB.id, ownerB.id],
    );
    await pgPool.query(
      `INSERT INTO project_documents (id, project_id, filename, content_hash, mime_type, size_bytes, s3_key, created_by)
       VALUES ($1,$2,'widget-guide.pdf','hash-a','application/pdf',100,'s3://a',$3),
              ($4,$5,'other-guide.pdf','hash-b','application/pdf',100,'s3://b',$6)`,
      [docA.id, projectA.id, ownerA.id, docB.id, projectB.id, ownerB.id],
    );
    await pgPool.query(
      `INSERT INTO document_chunks (id, document_id, chunk_index, content)
       VALUES ($1,$2,0,'widget 사용법 첫 번째 청크'),
              ($3,$2,1,'widget 사용법 두 번째 청크'),
              ($4,$5,0,'org b 전용 내용')`,
      [randomUUID(), docA.id, randomUUID(), randomUUID(), docB.id],
    );
  });

  afterAll(async () => {
    await pgPool.query(
      "DELETE FROM document_chunks WHERE document_id IN ($1,$2)",
      [docA.id, docB.id],
    );
    await pgPool.query("DELETE FROM project_documents WHERE id IN ($1,$2)", [
      docA.id,
      docB.id,
    ]);
    await pgPool.query("DELETE FROM projects WHERE id IN ($1,$2)", [
      projectA.id,
      projectB.id,
    ]);
    await pgPool.query("DELETE FROM users WHERE id IN ($1,$2)", [
      ownerA.id,
      ownerB.id,
    ]);
    await pgPool.query("DELETE FROM organizations WHERE id IN ($1,$2)", [
      orgA.id,
      orgB.id,
    ]);
  });

  it("projectId 로 스코프된 candidates + sourceMetaByDocumentId(filename 채워짐) 를 반환한다", async () => {
    const { candidates, sourceMetaByDocumentId } = await port.loadCandidates({
      projectId: projectA.id,
      sessionId: "session-irrelevant",
    });

    expect(candidates).toHaveLength(2);
    expect(candidates.every((c) => c.chunk.documentId === docA.id)).toBe(true);
    expect(sourceMetaByDocumentId.get(docA.id)).toMatchObject({
      source: "project",
      documentId: docA.id,
      filename: "widget-guide.pdf",
    });
  });

  it("다른 org 의 projectId 로 조회하면 그 org 의 chunk 만 반환한다(cross-org 미유입)", async () => {
    const { candidates, sourceMetaByDocumentId } = await port.loadCandidates({
      projectId: projectB.id,
      sessionId: "session-irrelevant",
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.chunk.documentId).toBe(docB.id);
    expect(candidates.some((c) => c.chunk.documentId === docA.id)).toBe(false);
    expect(sourceMetaByDocumentId.has(docA.id)).toBe(false);
    expect(sourceMetaByDocumentId.get(docB.id)?.filename).toBe(
      "other-guide.pdf",
    );
  });

  it("projectId 가 없으면(undefined) 빈 candidates 를 반환한다", async () => {
    const { candidates, sourceMetaByDocumentId } = await port.loadCandidates({
      projectId: undefined,
      sessionId: "session-irrelevant",
    });

    expect(candidates).toEqual([]);
    expect(sourceMetaByDocumentId.size).toBe(0);
  });

  it("chunk shape 이 DocumentChunk 형태(id/documentId/chunkIndex/content/embedding/metadata/createdAt)와 일치한다", async () => {
    const { candidates } = await port.loadCandidates({
      projectId: projectA.id,
      sessionId: "session-irrelevant",
    });
    const first = candidates.find((c) => c.chunk.chunkIndex === 0);
    expect(first?.chunk).toMatchObject({
      documentId: docA.id,
      chunkIndex: 0,
      content: "widget 사용법 첫 번째 청크",
      tokenCount: null,
      embedding: null,
    });
    expect(first?.chunk.createdAt).toBeInstanceOf(Date);
  });
});
