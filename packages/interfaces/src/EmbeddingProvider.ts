// packages/interfaces/src/EmbeddingProvider.ts
// § 5 — 문서/쿼리 임베딩.
// 결정: v1.0 은 'voyage-multilingual-2' 단일, dim=1024. 모델 변경 시 재임베딩 cron.
// 본 파일은 types.ts/errors.ts 를 import 하지 않음 (자기-완결 타입만 사용).

export interface EmbeddingProvider {
  name: string; // 'voyage-multilingual-2'
  dim: number; // 1024 (v1.0 결정)
  embed(
    input: string[],
    opts?: { type: "document" | "query"; signal?: AbortSignal },
  ): Promise<number[][]>;
}
