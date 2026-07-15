// tools/assemble-builtin-tools.ts — messages 라우트에 주입할 "내장 도구" 단일 조립 지점.
//   artifact_create + web_search + code_interpreter + deep_research 를 한곳에서 만든다.
//   실 provider 는 키가 있으면(TAVILY_API_KEY / E2B_API_KEY) 실사용, 없으면 dev-stub 로
//   폴백한다(app.ts 의 ANTHROPIC fail-soft 와 동일 원칙 — LOCAL_ONLY 에서도 왕복 동작).
//   20-MULTI-AGENT-TOOL.md. (이전엔 app.ts 가 artifact_create 하나만 배선해 모델이 웹검색/
//   리서치 도구를 아예 못 봤다 — 이 헬퍼가 그 last-mile 배선 갭을 닫는다.)
import type { AgentTool, LLMProvider } from "@wchat/interfaces";
import type { ArtifactDataAccess } from "../db/artifact-service.js";
import type { ObjectStore } from "../lib/object-store.js";
import type { WebSearchPort } from "./web-search-port.js";
import { createArtifactCreateTool } from "./handlers/artifact-create-handler.js";
import { createWebSearchTool } from "./handlers/web-search-handler.js";
import { createCodeInterpreterTool } from "./handlers/code-interpreter-handler.js";
import { createDeepResearchTool } from "./handlers/deep-research-handler.js";
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
}

export function assembleBuiltinTools(
  deps: AssembleBuiltinToolsDeps,
): AgentTool[] {
  const webSearchPort: WebSearchPort = deps.tavilyApiKey
    ? createTavilyWebSearchProvider({ apiKey: deps.tavilyApiKey })
    : createDevStubWebSearchProvider();
  const webSearchTool = createWebSearchTool({ port: webSearchPort });

  const sandboxTransport = deps.e2bApiKey
    ? createE2BSandboxTransport({
        apiKey: deps.e2bApiKey,
        objectStore: deps.objectStore,
      })
    : createDevStubSandboxTransport({ objectStore: deps.objectStore });

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
      // researcher 스코프 = read-only web_search 만(20-MULTI-AGENT-TOOL.md §20.4-3).
      workerTools: [webSearchTool],
      maxTokens: deps.maxTokens,
      da: deps.artifactDa,
    }),
  ];
}
