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

  /**
   * 보존정책 cron 이 열거한 만료 artifact 의 **바이트**를 지운다. 어떤 artifact 가 만료인지는
   * DataAccess 를 가진 호출자(lib/data-retention.ts)가 판단하고 id 목록만 넘긴다 —
   * 이 포트는 Repo 의존 없는 바이트 저장소로 남는다. (P22-C-01 / C3)
   * 인자 없이 호출하면 지울 대상이 없다는 뜻이라 {deletedCount:0} 이다.
   */
  cleanupExpired(input?: {
    artifactIds: string[];
  }): Promise<{ deletedCount: number }>;
}
