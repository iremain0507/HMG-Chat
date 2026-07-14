// knowledge-search-handler.ts — knowledge_search AgentTool: 기존 knowledge/knowledge-search.ts
//   (P4 에 이미 구현된 순수함수) 를 호출해 candidates/embedding 을 주입받아 citation 결과로 감싼다.
//   실 DB 기반 candidates 조달(DocumentChunkRepo.hybridSearch/EphemeralChunkRepo.hybridSearchUnified,
//   14-INTERFACES.md § 3)은 아직 어떤 db/** pg 구현체도 없어(app.ts 에도 미배선) 이번 태스크
//   범위 밖 — KnowledgeRetrievalPort 로 DI, 실 구현은 후속 태스크(app.ts 조립 시점)가 주입.
import { WChatError } from "@wchat/interfaces";
import type { AgentTool, EmbeddingProvider } from "@wchat/interfaces";
import {
  knowledgeSearch,
  knowledgeSearchToolSpec,
} from "../../knowledge/knowledge-search.js";
import type { CitationSourceMeta } from "../../knowledge/citation-helper.js";
import type { HybridSearchCandidate } from "../../knowledge/search-service.js";

export interface KnowledgeRetrievalPort {
  loadCandidates(input: {
    projectId: string | undefined;
    sessionId: string;
  }): Promise<{
    candidates: HybridSearchCandidate[];
    sourceMetaByDocumentId: Map<string, CitationSourceMeta>;
  }>;
}

export interface KnowledgeSearchToolDeps {
  embeddingProvider: EmbeddingProvider;
  retrieval: KnowledgeRetrievalPort;
  topK?: number;
  rrfK?: number;
}

export function createKnowledgeSearchTool(
  deps: KnowledgeSearchToolDeps,
): AgentTool {
  return {
    spec: knowledgeSearchToolSpec,
    async invoke({ toolCallId, args, ctx }) {
      const query = typeof args.query === "string" ? args.query.trim() : "";
      if (!query) {
        return {
          toolCallId,
          content: {
            kind: "error",
            error: new WChatError(
              "INVALID_INPUT",
              "tool",
              false,
              "query 가 필요합니다.",
            ),
          },
        };
      }

      const { candidates, sourceMetaByDocumentId } =
        await deps.retrieval.loadCandidates({
          projectId: ctx.projectId,
          sessionId: ctx.sessionId,
        });
      const [queryEmbedding] = await deps.embeddingProvider.embed([query], {
        type: "query",
        signal: ctx.signal,
      });

      const result = knowledgeSearch({
        candidates,
        sourceMetaByDocumentId,
        queryEmbedding: queryEmbedding ?? [],
        queryText: query,
        topK: deps.topK ?? 10,
        rrfK: deps.rrfK ?? 60,
      });

      return {
        toolCallId,
        content: { kind: "json", data: result },
      };
    },
  };
}
