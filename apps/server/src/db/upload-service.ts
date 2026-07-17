// db/upload-service.ts — 16-API-CONTRACT.md § 6 Uploads 단일 출처.
// sha256 dedup(같은 유저가 같은 바이트 재업로드 시 기존 row 재사용) + 소유자 격리(다른 유저는
// 조회/삭제 불가, existence-leak 방지)를 여기서 강제한다. 원본 바이트는 lib/object-store.ts
// ObjectStore 에 저장(실 S3 미사용, LOCAL_ONLY — dev=createLocalObjectStore/테스트=createInMemoryObjectStore).
import { createHash, randomUUID } from "node:crypto";
import type { DataAccess, Logger, UploadRecord } from "@wchat/interfaces";
import type { ObjectStore } from "../lib/object-store.js";
import {
  indexEphemeralUpload,
  type EphemeralChunkRow,
  type EphemeralIndexerDeps,
} from "../knowledge/ephemeral-indexer.js";

export type UploadDataAccess = Pick<DataAccess, "uploads">;

// P20-T1-01 — T3 ephemeral-indexer.ts(순수함수)의 소비측 배선. 업로드 트랜잭션과 분리된
// fail-soft 호출(21-LOOP-LESSONS L5 — 인덱싱 실패가 업로드 자체를 막아선 안 됨).
export interface UploadIndexingDeps extends EphemeralIndexerDeps {
  bulkInsert(rows: EphemeralChunkRow[]): Promise<void>;
  logger?: Logger;
}

const EXPIRES_AFTER_MS = 30 * 24 * 60 * 60 * 1000; // 30일

export interface UploadActor {
  userId: string;
}

export interface CreateUploadInput {
  filename: string;
  mimeType: string;
  data: Buffer;
  sessionId?: string | null;
}

export class UploadServiceError extends Error {
  code: "NOT_FOUND";

  constructor(code: UploadServiceError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

export function createUploadService(
  da: UploadDataAccess,
  objectStore: ObjectStore,
  indexing?: UploadIndexingDeps,
) {
  async function getUploadForActor(
    actor: UploadActor,
    id: string,
  ): Promise<UploadRecord | null> {
    const found = await da.uploads.byId(id);
    if (!found || found.userId !== actor.userId) return null;
    return found;
  }

  // sha256 dedup 은 (userId, content) 기준이라 같은 파일을 다른 세션에 첨부해도 기존
  // upload row 를 재사용한다 — 그 upload row 의 원 session 에만 ephemeral_chunks 가 있으면
  // 새 세션에선 검색이 늘 0건이 되는 L2 열화조건. 그 upload 의 원 session 과 이번 sessionId 가
  // 다를 때만(=이번 세션엔 아직 이 upload 의 chunk 가 없음) 같은 바이트로 재인덱싱한다.
  async function indexForSessionIfNeeded(
    upload: UploadRecord,
    input: CreateUploadInput,
    shouldIndex: boolean,
  ): Promise<void> {
    if (!indexing || !input.sessionId || !shouldIndex) return;
    try {
      const rows = await indexEphemeralUpload(
        {
          bytes: input.data,
          mimeType: input.mimeType,
          filename: input.filename,
          uploadId: upload.id,
          sessionId: input.sessionId,
        },
        indexing,
      );
      if (rows.length > 0) {
        await indexing.bulkInsert(rows);
      }
    } catch (err) {
      indexing.logger?.warn({
        category: "parser",
        msg: "ephemeral chunk indexing failed",
        context: { error: String(err) },
      });
    }
  }

  async function createUpload(
    actor: UploadActor,
    input: CreateUploadInput,
  ): Promise<UploadRecord> {
    const sha256 = createHash("sha256").update(input.data).digest("hex");
    const existing = await da.uploads.bySha256(actor.userId, sha256);
    if (existing) {
      await indexForSessionIfNeeded(
        existing,
        input,
        existing.sessionId !== (input.sessionId ?? null),
      );
      return existing;
    }

    const s3Key = `uploads/${actor.userId}/${sha256}-${randomUUID()}`;
    await objectStore.put(s3Key, input.data);

    const upload = await da.uploads.insert({
      userId: actor.userId,
      sessionId: input.sessionId ?? null,
      filename: input.filename,
      mimeType: input.mimeType,
      sizeBytes: input.data.byteLength,
      s3Key,
      sha256,
      expiresAt: new Date(Date.now() + EXPIRES_AFTER_MS),
    });

    await indexForSessionIfNeeded(upload, input, true);

    return upload;
  }

  async function deleteUpload(actor: UploadActor, id: string): Promise<void> {
    const found = await getUploadForActor(actor, id);
    if (!found) {
      throw new UploadServiceError("NOT_FOUND", "업로드를 찾을 수 없습니다.");
    }
    await objectStore.remove(found.s3Key);
    await da.uploads.delete(id);
  }

  return { createUpload, getUploadForActor, deleteUpload };
}
