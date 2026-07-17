// tools/assemble-builtin-tools.ts — messages 라우트에 주입할 "내장 도구" 단일 조립 지점.
//   artifact_create + web_search + code_interpreter + deep_research 를 한곳에서 만든다.
//   실 provider 는 키가 있으면(TAVILY_API_KEY / E2B_API_KEY) 실사용, 없으면 dev-stub 로
//   폴백한다(app.ts 의 ANTHROPIC fail-soft 와 동일 원칙 — LOCAL_ONLY 에서도 왕복 동작).
//   20-MULTI-AGENT-TOOL.md. (이전엔 app.ts 가 artifact_create 하나만 배선해 모델이 웹검색/
//   리서치 도구를 아예 못 봤다 — 이 헬퍼가 그 last-mile 배선 갭을 닫는다.)
import type {
  AgentTool,
  EmbeddingProvider,
  LLMProvider,
} from "@wchat/interfaces";
import type { ArtifactDataAccess } from "../db/artifact-service.js";
import type { ObjectStore } from "../lib/object-store.js";
import type { WebSearchPort } from "./web-search-port.js";
import {
  createWebSearchTool,
  type WebSearchSettingsResolverPort,
} from "./handlers/web-search-handler.js";
import { createArtifactCreateTool } from "./handlers/artifact-create-handler.js";
import { createCodeInterpreterTool } from "./handlers/code-interpreter-handler.js";
import {
  createDeepResearchTool,
  type ToolSettingsResolverPort,
} from "./handlers/deep-research-handler.js";
import {
  createKnowledgeSearchTool,
  type KnowledgeRetrievalPort,
  type KnowledgeSearchSettingsPort,
} from "./handlers/knowledge-search-handler.js";
import { createTavilyWebSearchProvider } from "./web-search-provider-tavily.js";
import { createDevStubWebSearchProvider } from "./web-search-provider-dev-stub.js";
import { createE2BSandboxTransport } from "./sandbox/sandbox-transport-e2b.js";
import { createDevStubSandboxTransport } from "./sandbox/sandbox-transport-dev-stub.js";

export interface AssembleBuiltinToolsDeps {
  provider: LLMProvider;
  model: string;
  maxTokens: number;
  artifactDa: ArtifactDataAccess;
  objectStore: ObjectStore;
  // 없으면 dev-stub 폴백. 실 배포/로컬 실검색 시 .env.local 로 주입.
  tavilyApiKey?: string;
  e2bApiKey?: string;
  // P15-T2-02 — 주입 시 deep_research 가 invoke 시점에 org-scoped toolMaxTokens 를 동적
  // 반영(정적 maxTokens 를 조용히 쓰지 않도록, L1). 미주입 시 비파괴(정적 maxTokens 유지).
  // P19-T1-12 — 동일 settings 객체(SettingsService.resolve 는 전체 ResolvedOrgSettings 를
  // 반환)를 web_search 의 provider 동적 선택에도 재사용(구조적으로 두 Pick 모두 만족).
  // P20-T1-02 — knowledge_search 의 ragTopK/ragRrfK/ragRelevanceThreshold invoke-time resolve 에도 재사용.
  settings?: ToolSettingsResolverPort &
    WebSearchSettingsResolverPort &
    KnowledgeSearchSettingsPort;
  // P20-T1-02 — 둘 다 주입돼야 knowledge_search 를 조립(L1 last-mile: 주입 유무로 도구
  // 목록이 갈리는 조립 테스트로 진입점 도달을 단언). 미주입 시 이전처럼 도구 자체가 생략된다.
  embeddingProvider?: EmbeddingProvider;
  retrieval?: KnowledgeRetrievalPort;
}

// P19-T1-12 — org_settings.webSearchProvider 로 invoke 시점에 실 provider 를 구성.
//   apiKeyRef 는 실제 비밀이 아니라 서버가 아는 고정 env ref 이름만 가리키므로, 임의
//   process.env 조회를 막기 위해 "TAVILY_API_KEY" 하나만 인식한다(DB-configurable 값으로
//   다른 시크릿을 읽지 못하도록, 보안). provider 가 "tavily" 가 아니거나 ref 가 다르거나
//   실 키가 없으면 undefined 를 반환해 deps.port(dev-stub) 폴백을 유도한다(L2).
function buildWebSearchProviderResolver(
  tavilyApiKey: string | undefined,
): (input: {
  provider?: string | undefined;
  endpoint?: string | undefined;
  apiKeyRef?: string | undefined;
}) => WebSearchPort | undefined {
  return (input) => {
    if (input.provider !== "tavily") return undefined;
    if (input.apiKeyRef !== "TAVILY_API_KEY" || !tavilyApiKey) return undefined;
    return createTavilyWebSearchProvider({
      apiKey: tavilyApiKey,
      ...(input.endpoint ? { baseUrl: input.endpoint } : {}),
    });
  };
}

export function assembleBuiltinTools(
  deps: AssembleBuiltinToolsDeps,
): AgentTool[] {
  const webSearchPort: WebSearchPort = deps.tavilyApiKey
    ? createTavilyWebSearchProvider({ apiKey: deps.tavilyApiKey })
    : createDevStubWebSearchProvider();
  const webSearchTool = createWebSearchTool({
    port: webSearchPort,
    ...(deps.settings ? { settings: deps.settings } : {}),
    resolveProvider: buildWebSearchProviderResolver(deps.tavilyApiKey),
  });

  const sandboxTransport = deps.e2bApiKey
    ? createE2BSandboxTransport({
        apiKey: deps.e2bApiKey,
        objectStore: deps.objectStore,
      })
    : createDevStubSandboxTransport({ objectStore: deps.objectStore });

  // P20-T1-02 — retrieval 포트 주입 시에만 조립(app.ts 에서 pg 구현체를 주입하지 않으면
  // 이전처럼 모델이 지식베이스를 아예 못 보게 생략 — L1 last-mile).
  const knowledgeSearchTool =
    deps.retrieval && deps.embeddingProvider
      ? createKnowledgeSearchTool({
          embeddingProvider: deps.embeddingProvider,
          retrieval: deps.retrieval,
          ...(deps.settings ? { settings: deps.settings } : {}),
        })
      : undefined;

  return [
    createArtifactCreateTool({ da: deps.artifactDa }),
    webSearchTool,
    createCodeInterpreterTool({
      transport: sandboxTransport,
      da: deps.artifactDa,
    }),
    createDeepResearchTool({
      leadProvider: deps.provider,
      leadModel: deps.model,
      workerProvider: deps.provider,
      workerModel: deps.model,
      // researcher 스코프 = read-only web_search/knowledge_search 만(20-MULTI-AGENT-TOOL.md §20.4-3).
      workerTools: knowledgeSearchTool
        ? [webSearchTool, knowledgeSearchTool]
        : [webSearchTool],
      maxTokens: deps.maxTokens,
      da: deps.artifactDa,
      ...(deps.settings ? { settings: deps.settings } : {}),
    }),
    ...(knowledgeSearchTool ? [knowledgeSearchTool] : []),
  ];
}
