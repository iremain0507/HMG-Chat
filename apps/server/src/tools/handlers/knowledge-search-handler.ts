// knowledge-search-handler.ts — knowledge_search AgentTool: 기존 knowledge/knowledge-search.ts
//   (P4 에 이미 구현된 순수함수) 를 호출해 candidates/embedding 을 주입받아 citation 결과로 감싼다.
//   실 DB 기반 candidates 조달(DocumentChunkRepo.hybridSearch/EphemeralChunkRepo.hybridSearchUnified,
//   14-INTERFACES.md § 3)은 아직 어떤 db/** pg 구현체도 없어(app.ts 에도 미배선) 이번 태스크
//   범위 밖 — KnowledgeRetrievalPort 로 DI, 실 구현은 후속 태스크(app.ts 조립 시점)가 주입.
import { WChatError } from "@wchat/interfaces";
import type {
  AgentTool,
  EmbeddingProvider,
  HybridSearchResult,
  Logger,
} from "@wchat/interfaces";
import { knowledgeSearchToolSpec } from "../../knowledge/knowledge-search.js";
import {
  buildCitations,
  NO_RESULTS_MESSAGE,
  type CitationSourceMeta,
} from "../../knowledge/citation-helper.js";
import {
  hybridSearch,
  type HybridSearchCandidate,
} from "../../knowledge/search-service.js";
import {
  applyRerank,
  type RerankProvider,
} from "../../knowledge/rerank-provider.js";
import {
  DEFAULT_ORG_SETTINGS,
  type ResolvedOrgSettings,
} from "../../lib/org-settings-schema.js";

export interface KnowledgeRetrievalPort {
  loadCandidates(input: {
    projectId: string | undefined;
    sessionId: string;
  }): Promise<{
    candidates: HybridSearchCandidate[];
    sourceMetaByDocumentId: Map<string, CitationSourceMeta>;
  }>;
}

// P14-T3-01 — ragTopK/ragRrfK/ragRelevanceThreshold 를 org_settings 에서 조회하는 포트.
// knowledge_search 툴은 app.ts 정적 조립 시점에 org 를 알 수 없어(21-LOOP-LESSONS.md L1),
// 매 invoke 마다 ctx.orgId 로 resolve — settings-service.ts(T1)와 동일 계약(resolve)만
// 의존해 순환을 피한다(messages.ts의 SettingsResolverPort 와 동일 패턴).
export interface KnowledgeSearchSettingsPort {
  resolve(orgId: string): Promise<ResolvedOrgSettings>;
}

export interface KnowledgeSearchToolDeps {
  embeddingProvider: EmbeddingProvider;
  retrieval: KnowledgeRetrievalPort;
  settings?: KnowledgeSearchSettingsPort;
  // P22-T3-05 — OPTIONAL cross-encoder reranker. 미주입 시 hybridSearch(RRF) 순서 그대로(회귀 없음).
  reranker?: RerankProvider;
}

// ResolvedOrgSettings(=Required<OrgSettingsPatch>) 도 zod `.optional()` 유래 `| undefined`
// union 은 남기므로(messages.ts SAFE_DEFAULT_MAX_TOKENS 와 동일 사유), 최종 non-null 보강.
// DEFAULT_ORG_SETTINGS 의 ragTopK/ragRrfK/ragRelevanceThreshold 와 항상 같은 값 유지.
const SAFE_DEFAULT_RAG_TOP_K = 10;
const SAFE_DEFAULT_RAG_RRF_K = 60;
const SAFE_DEFAULT_RAG_RELEVANCE_THRESHOLD = 0.0;

// resolve 미주입/실패(reject) 시 절대 throw 하지 않고 DEFAULT_ORG_SETTINGS(topK=10/rrfK=60)
// 로 fail-soft (L2/L5).
async function resolveRagSettingsSafely(
  settings: KnowledgeSearchSettingsPort | undefined,
  orgId: string,
  logger: Logger,
): Promise<ResolvedOrgSettings> {
  if (!settings) return DEFAULT_ORG_SETTINGS;
  try {
    return await settings.resolve(orgId);
  } catch (error) {
    logger.warn({
      category: "system",
      msg: "org RAG 설정 resolve 실패 — DEFAULT_ORG_SETTINGS 로 폴백",
      orgId,
      context: { error: String(error) },
    });
    return DEFAULT_ORG_SETTINGS;
  }
}

// reranker 가 throw/reject 해도 검색 자체를 실패시키지 않고 RRF 순서(원본 hits)로 fail-soft (L2/L5).
async function applyRerankSafely(
  reranker: RerankProvider,
  query: string,
  hits: HybridSearchResult[],
  topK: number,
  signal: AbortSignal,
  logger: Logger,
): Promise<HybridSearchResult[]> {
  try {
    return await applyRerank({ query, hits, reranker, topK, signal });
  } catch (error) {
    logger.warn({
      category: "tool",
      msg: "rerank 실패 — RRF 순서로 폴백",
      context: { error: String(error) },
    });
    return hits;
  }
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

      const resolved = await resolveRagSettingsSafely(
        deps.settings,
        ctx.orgId,
        ctx.logger,
      );

      const topK = resolved.ragTopK ?? SAFE_DEFAULT_RAG_TOP_K;
      const hits = hybridSearch({
        candidates,
        queryEmbedding: queryEmbedding ?? [],
        queryText: query,
        topK,
        rrfK: resolved.ragRrfK ?? SAFE_DEFAULT_RAG_RRF_K,
        relevanceThreshold:
          resolved.ragRelevanceThreshold ??
          SAFE_DEFAULT_RAG_RELEVANCE_THRESHOLD,
      });

      // P22-T3-05 — reranker 주입 시 RRF 순서를 query-문서 relevance 로 재정렬/prune(fail-soft:
      // reranker 실패 시 RRF 순서 유지). 미주입 시 hits 그대로(byte-identical, 회귀 없음).
      const finalHits = deps.reranker
        ? await applyRerankSafely(
            deps.reranker,
            query,
            hits,
            topK,
            ctx.signal,
            ctx.logger,
          )
        : hits;

      const result =
        finalHits.length === 0
          ? { citations: [], message: NO_RESULTS_MESSAGE }
          : {
              citations: buildCitations(finalHits, sourceMetaByDocumentId),
              message: null,
            };

      return {
        toolCallId,
        content: { kind: "json", data: result },
      };
    },
  };
}
