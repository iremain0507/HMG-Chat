// embedding-provider-dev-stub.ts — 로컬 dev/테스트용 결정론적 EmbeddingProvider.
//   LOCAL_ONLY 환경엔 실 Voyage API 키가 없으므로(ANTHROPIC/VOYAGE=dev stub), 외부 호출 없이
//   텍스트에서 결정론적 1024-dim 단위벡터를 생성한다. 같은 입력 → 같은 벡터(재현성),
//   다른 입력 → 다른 벡터(검색/RRF 로직 검증 가능). 실제 의미적 품질은 배포 시 실 Voyage 로 교체.
//   14-INTERFACES § 5 EmbeddingProvider 계약(name/dim/embed) 준수.
import type { EmbeddingProvider } from "@wchat/interfaces";

const DIM = 1024;

// FNV-1a 32bit — 문자열 → 시드.
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// mulberry32 — 시드 기반 결정론적 PRNG.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function embedOne(text: string): number[] {
  // 토큰 단위 시드를 섞어 유사 텍스트가 유사 벡터를 갖도록(간이 semantic 근사).
  const tokens = text.toLowerCase().split(/\s+/).filter(Boolean);
  const v = new Array<number>(DIM).fill(0);
  const seedTokens = tokens.length ? tokens : [text];
  for (const tok of seedTokens) {
    const rnd = mulberry32(fnv1a(tok));
    for (let i = 0; i < DIM; i++) v[i] += rnd() - 0.5;
  }
  // L2 정규화 (cosine/inner-product 검색과 일관).
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

/**
 * 결정론적 dev EmbeddingProvider. 외부 API/키 불필요.
 * @param name 리포트/로그용 식별자 (기본 'dev-stub-1024')
 */
export function createDevStubEmbeddingProvider(
  name = "dev-stub-1024",
): EmbeddingProvider {
  return {
    name,
    dim: DIM,
    async embed(input, opts) {
      opts?.signal?.throwIfAborted?.();
      return input.map(embedOne);
    },
  };
}
