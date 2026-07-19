// orchestrator/connection-provider-resolver.ts — P22-T6-14 (계약 승인 C6).
//
// 왜 registry 가 아니라 별도 resolver 인가: createLLMProviderRegistry 는 app.ts 조립 시점의
// 싱글톤이라 "org 마다 다른 연결"을 담을 수 없다(P14-T2-02 toolMaxTokens 가 같은 이유로 격리된
// 전례). 그래서 요청 시점에 org+model 로 provider 를 해석하는 invoke-time 패턴(T3-01 미러)을 쓴다.
// routes/messages.ts 는 이 resolver 가 null 을 주면 기존 registry provider 로 폴백하므로,
// 연결을 하나도 등록하지 않은 org 의 동작은 정확히 종전과 같다(비파괴).
//
// 격리: list({orgId, enabled:true}) 로만 후보를 찾는다 — 다른 org·비활성 연결은 구조적으로 제외.
// fail-soft: 키를 읽지 못하면 throw 하지 않고 null 을 돌려 폴백시킨다(채팅이 통째로 죽지 않게).
import type { LLMProvider } from "@wchat/interfaces";
import type { ProviderConnectionDataAccess } from "../db/provider-connection-data-access.js";

export interface ConnectionProviderArgs {
  baseUrl: string;
  apiKey: string;
  models: string[];
}

export type ConnectionProviderResolver = (
  orgId: string,
  model: string,
) => Promise<LLMProvider | null>;

export function createConnectionProviderResolver(deps: {
  da: ProviderConnectionDataAccess;
  /** 연결 1건 → LLMProvider. app.ts 가 OpenAI SDK(baseURL 주입) 조립을 넘긴다. */
  createProvider: (args: ConnectionProviderArgs) => LLMProvider;
}): ConnectionProviderResolver {
  return async (orgId, model) => {
    const page = await deps.da.providerConnections.list({
      orgId,
      enabled: true,
    });
    // 등록 순서가 아니라 목록 순서(updated_at DESC)의 첫 매칭 — 최근 손댄 연결이 이긴다.
    const match = page.items.find((row) => row.models.includes(model));
    if (!match) return null;

    const apiKey = await deps.da.providerConnections.secretById(match.id);
    if (!apiKey) return null;

    return deps.createProvider({
      baseUrl: match.baseUrl,
      apiKey,
      models: match.models,
    });
  };
}
