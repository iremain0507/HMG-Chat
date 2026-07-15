// db/project-document-data-access.ts — db/document-service.ts 의 DocumentDataAccess pg 구현체
// (db/project-data-access.ts 와 동일 패턴). projects/projectMembers/orgUnitIdsForUser 는
// createPgProjectDataAccess() 를 재사용 — 중복 구현 없이 project-service.ts 의 접근 제어와
// 동일한 데이터 소스를 공유한다. dev/test DATABASE_URL role 은 superuser 라 RLS(0005) 를
// 우회한다 — document-service.ts 가 application 레벨에서 권한을 재현/강제한다.
import type { DocumentChunk, ProjectDocumentRecord } from "@wchat/interfaces";
import type { DocumentDataAccess } from "./document-service.js";
import { createPgProjectDataAccess } from "./project-data-access.js";
import { pgPool } from "./client.js";

function toChunk(row: Record<string, unknown>): DocumentChunk {
  return {
    id: row.id as string,
    documentId: row.document_id as string,
    chunkIndex: row.chunk_index as number,
    content: row.content as string,
    tokenCount: (row.token_count as number | null) ?? null,
    embedding: (row.embedding as number[] | null) ?? null,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: row.created_at as Date,
  };
}

// pgvector 는 `[0.1,0.2,...]` 텍스트 리터럴을 ::vector 로 캐스트해 받는다.
function toVectorLiteral(
  embedding: number[] | null | undefined,
): string | null {
  return embedding ? `[${embedding.join(",")}]` : null;
}

function toDocument(row: Record<string, unknown>): ProjectDocumentRecord {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    filename: row.filename as string,
    contentHash: row.content_hash as string,
    mimeType: row.mime_type as string,
    sizeBytes: Number(row.size_bytes),
    indexStatus: row.index_status as ProjectDocumentRecord["indexStatus"],
    chunkCount: Number(row.chunk_count),
    s3Key: row.s3_key as string,
    indexedAt: (row.indexed_at as Date | null) ?? null,
    failureReason: (row.failure_reason as string | null) ?? null,
    createdBy: row.created_by as string,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
}

export function createPgDocumentDataAccess(): DocumentDataAccess {
  return {
    ...createPgProjectDataAccess(),
    projectDocuments: {
      async insert(data) {
        const res = await pgPool.query(
          `INSERT INTO project_documents (project_id, filename, content_hash, mime_type, size_bytes, s3_key, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING *`,
          [
            data.projectId,
            data.filename,
            data.contentHash,
            data.mimeType,
            data.sizeBytes,
            data.s3Key,
            data.createdBy,
          ],
        );
        return toDocument(res.rows[0]);
      },
      async bulkInsert(rows) {
        const results: ProjectDocumentRecord[] = [];
        for (const row of rows) {
          results.push(await this.insert(row));
        }
        return results;
      },
      async update(id, data) {
        const fields: string[] = [];
        const values: unknown[] = [];
        let i = 1;
        for (const [key, col] of [
          ["filename", "filename"],
          ["indexStatus", "index_status"],
          ["chunkCount", "chunk_count"],
          ["indexedAt", "indexed_at"],
          ["failureReason", "failure_reason"],
        ] as const) {
          if (key in data) {
            fields.push(`${col} = $${i}`);
            values.push((data as Record<string, unknown>)[key]);
            i++;
          }
        }
        values.push(id);
        const res = await pgPool.query(
          `UPDATE project_documents SET ${fields.join(", ")} WHERE id = $${i} RETURNING *`,
          values,
        );
        return toDocument(res.rows[0]);
      },
      async delete(id) {
        await pgPool.query("DELETE FROM project_documents WHERE id = $1", [id]);
      },
      async byId(id) {
        const res = await pgPool.query(
          "SELECT * FROM project_documents WHERE id = $1",
          [id],
        );
        return res.rows[0] ? toDocument(res.rows[0]) : null;
      },
      async list(filter, pagination) {
        const conditions: string[] = [];
        const values: unknown[] = [];
        let i = 1;
        if (filter?.projectId) {
          conditions.push(`project_id = $${i}`);
          values.push(filter.projectId);
          i++;
        }
        if (filter?.indexStatus) {
          conditions.push(`index_status = $${i}`);
          values.push(filter.indexStatus);
          i++;
        }
        const where = conditions.length
          ? `WHERE ${conditions.join(" AND ")}`
          : "";
        const limit = pagination?.limit ?? 50;
        values.push(limit);
        const res = await pgPool.query(
          `SELECT * FROM project_documents ${where} ORDER BY created_at DESC LIMIT $${i}`,
          values,
        );
        return { items: res.rows.map(toDocument) };
      },
      async byContentHash(projectId, hash) {
        const res = await pgPool.query(
          "SELECT * FROM project_documents WHERE project_id = $1 AND content_hash = $2",
          [projectId, hash],
        );
        return res.rows[0] ? toDocument(res.rows[0]) : null;
      },
      async updateIndexStatus(id, status, chunkCount) {
        if (chunkCount !== undefined) {
          await pgPool.query(
            "UPDATE project_documents SET index_status = $1, chunk_count = $2 WHERE id = $3",
            [status, chunkCount, id],
          );
        } else {
          await pgPool.query(
            "UPDATE project_documents SET index_status = $1 WHERE id = $2",
            [status, id],
          );
        }
      },
    },
    documentChunks: {
      async insert(data) {
        const res = await pgPool.query(
          `INSERT INTO document_chunks (document_id, chunk_index, content, token_count, embedding, metadata)
           VALUES ($1, $2, $3, $4, $5::vector, $6)
           RETURNING *`,
          [
            data.documentId,
            data.chunkIndex,
            data.content,
            data.tokenCount ?? null,
            toVectorLiteral(data.embedding),
            JSON.stringify(data.metadata ?? {}),
          ],
        );
        return toChunk(res.rows[0]);
      },
      async bulkInsert(rows) {
        const results: DocumentChunk[] = [];
        for (const row of rows) {
          results.push(await this.insert(row));
        }
        return results;
      },
    },
  };
}
