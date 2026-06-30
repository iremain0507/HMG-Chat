// packages/interfaces/src/ArtifactStore.ts
// § 4 — artifact 본문 저장/조회. 작은 건 DB (inline), 큰 건 S3.
// 라우팅: sizeBytes < 256_000 → DB (artifacts.inline_content BYTEA), 그 외 → S3.
// 본 파일은 types.ts/errors.ts 를 import 하지 않음 (자기-완결 타입만 사용).

export interface ArtifactStore {
  put(input: {
    artifactId: string;
    content: Buffer | NodeJS.ReadableStream;
    sizeBytes: number;
    mimeType: string;
  }): Promise<{ storageKind: "inline" | "s3"; locator: string }>; // locator: s3_key(s3) 또는 artifact id(inline)

  get(artifactId: string): Promise<NodeJS.ReadableStream>;

  // share 페이지에서 사용 — inline content (ADR-22)
  getInline(
    artifactId: string,
    maxBytes?: number,
  ): Promise<{ content: Buffer; mimeType: string; truncated: boolean }>;

  remove(artifactId: string): Promise<void>;
  cleanupExpired(): Promise<{ deletedCount: number }>;
}
