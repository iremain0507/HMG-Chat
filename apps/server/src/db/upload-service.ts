// db/upload-service.ts — 16-API-CONTRACT.md § 6 Uploads 단일 출처.
// sha256 dedup(같은 유저가 같은 바이트 재업로드 시 기존 row 재사용) + 소유자 격리(다른 유저는
// 조회/삭제 불가, existence-leak 방지)를 여기서 강제한다. 원본 바이트는 lib/object-store.ts
// ObjectStore 에 저장(실 S3 미사용, LOCAL_ONLY — dev=createLocalObjectStore/테스트=createInMemoryObjectStore).
import { createHash, randomUUID } from "node:crypto";
import type { DataAccess, UploadRecord } from "@wchat/interfaces";
import type { ObjectStore } from "../lib/object-store.js";

export type UploadDataAccess = Pick<DataAccess, "uploads">;

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
) {
  async function getUploadForActor(
    actor: UploadActor,
    id: string,
  ): Promise<UploadRecord | null> {
    const found = await da.uploads.byId(id);
    if (!found || found.userId !== actor.userId) return null;
    return found;
  }

  async function createUpload(
    actor: UploadActor,
    input: CreateUploadInput,
  ): Promise<UploadRecord> {
    const sha256 = createHash("sha256").update(input.data).digest("hex");
    const existing = await da.uploads.bySha256(actor.userId, sha256);
    if (existing) return existing;

    const s3Key = `uploads/${actor.userId}/${sha256}-${randomUUID()}`;
    await objectStore.put(s3Key, input.data);

    return da.uploads.insert({
      userId: actor.userId,
      sessionId: input.sessionId ?? null,
      filename: input.filename,
      mimeType: input.mimeType,
      sizeBytes: input.data.byteLength,
      s3Key,
      sha256,
      expiresAt: new Date(Date.now() + EXPIRES_AFTER_MS),
    });
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
