// db/artifact-service.ts — 06-DATA-MODEL § 0006_artifacts.sql + 14-INTERFACES § ArtifactRecord/ArtifactStore
// 단일 출처. storageKind 라우팅 결정(sizeBytes 임계치) + 생성자 격리(다른 유저 조회/삭제 불가,
// existence-leak 방지)를 여기서 강제한다. 실 S3 업로드(lib/artifact-store.{inline,s3}.ts)는
// routes/artifacts.ts(T4, P5-T4-01) 소관 — storageKind='s3' 케이스는 caller 가 이미 업로드한
// s3Key 를 넘겨받아 DB row 만 생성한다.
import type { ArtifactRecord, DataAccess } from "@wchat/interfaces";

export type ArtifactDataAccess = Pick<DataAccess, "artifacts">;

// 14-INTERFACES § 4 ArtifactStore — sizeBytes < 256_000 → inline(DB BYTEA), 그 외 → s3.
export const INLINE_STORAGE_THRESHOLD_BYTES = 256_000;

export function decideStorageKind(sizeBytes: number): "inline" | "s3" {
  return sizeBytes < INLINE_STORAGE_THRESHOLD_BYTES ? "inline" : "s3";
}

export interface ArtifactActor {
  userId: string;
}

export interface CreateArtifactInput {
  sessionId?: string | null;
  type: ArtifactRecord["type"];
  filename: string;
  mimeType?: string | null;
  data: Buffer;
  s3Key?: string; // storageKind='s3' 로 라우팅될 때 필수 (caller 가 ArtifactStore.put() 으로 이미 업로드한 결과)
}

export class ArtifactServiceError extends Error {
  code: "NOT_FOUND" | "INVALID_INPUT";

  constructor(code: ArtifactServiceError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

export function createArtifactService(da: ArtifactDataAccess) {
  async function getArtifactForActor(
    actor: ArtifactActor,
    id: string,
  ): Promise<ArtifactRecord | null> {
    const found = await da.artifacts.byId(id);
    if (!found || found.createdBy !== actor.userId) return null;
    return found;
  }

  async function createArtifact(
    actor: ArtifactActor,
    input: CreateArtifactInput,
  ): Promise<ArtifactRecord> {
    const sizeBytes = input.data.byteLength;
    const storageKind = decideStorageKind(sizeBytes);
    if (storageKind === "s3" && !input.s3Key) {
      throw new ArtifactServiceError(
        "INVALID_INPUT",
        "storageKind=s3 라우팅에는 s3Key 가 필요합니다.",
      );
    }

    return da.artifacts.insert({
      sessionId: input.sessionId ?? null,
      createdBy: actor.userId,
      type: input.type,
      filename: input.filename,
      mimeType: input.mimeType ?? null,
      sizeBytes,
      storageKind,
      s3Key: storageKind === "s3" ? (input.s3Key as string) : null,
      inlineContent: storageKind === "inline" ? input.data : null,
      sharedAt: null,
    });
  }

  async function deleteArtifact(
    actor: ArtifactActor,
    id: string,
  ): Promise<void> {
    const found = await getArtifactForActor(actor, id);
    if (!found) {
      throw new ArtifactServiceError(
        "NOT_FOUND",
        "artifact 를 찾을 수 없습니다.",
      );
    }
    await da.artifacts.delete(id);
  }

  return { createArtifact, getArtifactForActor, deleteArtifact };
}
