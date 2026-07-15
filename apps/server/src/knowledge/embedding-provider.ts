// embedding-provider.ts — EmbeddingProvider 사용처: 임의의 EmbeddingProvider(dev-stub 또는
//   배포 시 실 Voyage 구현체)를 감싸 embed 호출수/입력 토큰(비용 근사) 카운트를 노출한다.
//   14-INTERFACES § 5 EmbeddingProvider 계약은 그대로 위임(name/dim/embed 동작 불변).
import type { EmbeddingProvider } from "@wchat/interfaces";
import { estimateTokenCount } from "./chunker.js";

export interface EmbeddingUsage {
  callCount: number;
  inputTokenCount: number;
}

export interface InstrumentedEmbeddingProvider extends EmbeddingProvider {
  getUsage(): EmbeddingUsage;
}

export function withUsageTracking(
  provider: EmbeddingProvider,
): InstrumentedEmbeddingProvider {
  let callCount = 0;
  let inputTokenCount = 0;

  return {
    name: provider.name,
    dim: provider.dim,
    async embed(input, opts) {
      callCount += 1;
      inputTokenCount += input.reduce(
        (sum, text) => sum + estimateTokenCount(text),
        0,
      );
      return provider.embed(input, opts);
    },
    getUsage(): EmbeddingUsage {
      return { callCount, inputTokenCount };
    },
  };
}
