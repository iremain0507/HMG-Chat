// knowledge-retrieval-pg.test.ts — P20-T3-02: knowledge/knowledge-retrieval-pg.ts 의
//   createKnowledgeRetrievalPgPort().loadCandidates 가 project_documents/document_chunks(0005)
//   시드 데이터로부터 실제 candidates + sourceMetaByDocumentId 를 반환하는지, 그리고 project 스코프
//   필터가 cross-org 청크를 새지 않는지(다른 org 의 project_id 로 조회 시 그 project 소속만 반환)를
//   실 Postgres 로 검증한다.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pgPool } from "../../db/client.js";
import { createDevStubEmbeddingProvider } from "../../knowledge/embedding-provider-dev-stub.js";
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
  // P22-T3-01: 세션 ephemeral_chunks(0014) 통합 조회 검증용 픽스처.
  const sessionEph = { id: randomUUID() }; // ownerA 소유, ephemeral 청크 보유
  const sessionEmpty = { id: randomUUID() }; // ephemeral 청크 없음 — project-only 케이스용
  const uploadA = { id: randomUUID() };

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

    // 세션 + 세션 첨부(upload) + ephemeral_chunks 시드(P22-T3-01)
    await pgPool.query(
      "INSERT INTO sessions (id, user_id) VALUES ($1,$2),($3,$4)",
      [sessionEph.id, ownerA.id, sessionEmpty.id, ownerA.id],
    );
    await pgPool.query(
      `INSERT INTO uploads (id, user_id, session_id, filename, mime_type, size_bytes, s3_key, sha256, expires_at)
       VALUES ($1,$2,$3,'attach.pdf','application/pdf',100,'s3://eph','sha-eph',NOW() + INTERVAL '30 days')`,
      [uploadA.id, ownerA.id, sessionEph.id],
    );
    const embeddingProvider = createDevStubEmbeddingProvider();
    const [ephEmbedding] = await embeddingProvider.embed(
      ["세션 첨부 widget 내용"],
      { type: "passage" },
    );
    await pgPool.query(
      `INSERT INTO ephemeral_chunks (session_id, upload_id, chunk_index, page_number, content, embedding)
       VALUES ($1,$2,0,3,'세션 첨부 widget 내용',$3::vector)`,
      [sessionEph.id, uploadA.id, `[${(ephEmbedding ?? []).join(",")}]`],
    );
  });

  afterAll(async () => {
    await pgPool.query(
      "DELETE FROM ephemeral_chunks WHERE session_id IN ($1)",
      [sessionEph.id],
    );
    await pgPool.query("DELETE FROM uploads WHERE id IN ($1)", [uploadA.id]);
    await pgPool.query("DELETE FROM sessions WHERE id IN ($1,$2)", [
      sessionEph.id,
      sessionEmpty.id,
    ]);
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
      sessionId: sessionEmpty.id,
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
      sessionId: sessionEmpty.id,
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
      sessionId: sessionEmpty.id,
    });

    expect(candidates).toEqual([]);
    expect(sourceMetaByDocumentId.size).toBe(0);
  });

  it("chunk shape 이 DocumentChunk 형태(id/documentId/chunkIndex/content/embedding/metadata/createdAt)와 일치한다", async () => {
    const { candidates } = await port.loadCandidates({
      projectId: projectA.id,
      sessionId: sessionEmpty.id,
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

  it("세션 ephemeral_chunks 를 project 후보와 병합하고 source=ephemeral 로 태깅한다(P22-T3-01)", async () => {
    const { candidates, sourceMetaByDocumentId } = await port.loadCandidates({
      projectId: projectA.id,
      sessionId: sessionEph.id,
    });

    // project 2개 + ephemeral 1개 = 3
    expect(candidates).toHaveLength(3);
    const eph = candidates.find((c) => c.chunk.documentId === uploadA.id);
    expect(eph).toBeDefined();
    expect(eph?.chunk.content).toBe("세션 첨부 widget 내용");
    expect(eph?.chunk.metadata).toMatchObject({ pageNumber: 3 });
    expect(sourceMetaByDocumentId.get(uploadA.id)).toEqual({
      source: "ephemeral",
      uploadId: uploadA.id,
      filename: "attach.pdf",
    });
    // project meta 도 그대로 공존
    expect(sourceMetaByDocumentId.get(docA.id)?.source).toBe("project");
  });

  it("projectId 없이 sessionId 만으로도 ephemeral 후보를 반환한다(계약 §513)", async () => {
    const { candidates, sourceMetaByDocumentId } = await port.loadCandidates({
      projectId: undefined,
      sessionId: sessionEph.id,
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.chunk.documentId).toBe(uploadA.id);
    expect(sourceMetaByDocumentId.get(uploadA.id)?.source).toBe("ephemeral");
  });
});
