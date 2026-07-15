// tool-router.ts — 20-MULTI-AGENT-TOOL.md § P12-T2-07
// MCP 툴 카탈로그가 커지면(200+) 전부 runTurn 에 주입하는 것이 컨텍스트를 붕괴시킨다.
// AgentToolSpec.description 을 EmbeddingProvider(dev-stub, 배포 시 실 provider 로 교체)로
// 임베딩해 query 와의 cosine similarity 상위 top-k AgentTool subset 만 반환한다.
import type { AgentTool, EmbeddingProvider } from "@wchat/interfaces";

export interface ToolRouterInput {
  tools: AgentTool[];
  query: string;
  topK: number;
  embeddingProvider: EmbeddingProvider;
  signal?: AbortSignal;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export async function selectRelevantTools(
  input: ToolRouterInput,
): Promise<AgentTool[]> {
  const { tools, query, topK, embeddingProvider, signal } = input;
  if (topK <= 0) return [];
  // 카탈로그가 이미 topK 이하면 임베딩 호출 없이 그대로 반환(불필요한 비용 회피).
  if (tools.length <= topK) return tools;

  const [[queryEmbedding], toolEmbeddings] = await Promise.all([
    embeddingProvider.embed([query], {
      type: "query",
      ...(signal ? { signal } : {}),
    }),
    embeddingProvider.embed(
      tools.map((tool) => tool.spec.description),
      { type: "document", ...(signal ? { signal } : {}) },
    ),
  ]);

  return tools
    .map((tool, i) => ({
      tool,
      score: cosineSimilarity(queryEmbedding!, toolEmbeddings[i]!),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(({ tool }) => tool);
}
