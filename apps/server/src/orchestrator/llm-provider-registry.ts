// orchestrator/llm-provider-registry.ts — P11-T2-03
//
// 멀티-LLM 라우팅 게이트웨이. concrete LLMProvider(anthropic/gemini/...) 들을 model 이름
// 기준으로 모아 단일 LLMProvider 로 노출한다. app.ts 는 이 레지스트리 하나만 provider 로
// 주입하면 되고, routes/messages.ts 의 ChatInput.model(사용자가 고른 모델)로 실제 위임 대상이
// 결정된다. models 는 하위 provider.models 의 union(순서 보존, 등록 순서 우선 provider 승리).
//
// fallback: model 이 어떤 provider 의 models 목록에도 없을 때 위임할 provider(optional).
// app.ts 가 concrete provider 하나만 등록하는 현 단계(dev-stub 은 모델명 무시·실 Anthropic 은
// 임의 model ID 문자열을 그대로 API 로 전달)에서, provider.models 는 GET /config 용 카탈로그일
// 뿐 runtime 검증 게이트가 아니었다 — org.allowedModels(DB 로 관리되는 동적 화이트리스트)가
// provider.models 와 항상 일치하진 않는다. fallback 을 그 provider 로 지정하면 기존 동작을
// 그대로 보존하면서, provider 가 여러 개(P11-T2-05/06 이후) 등록된 진짜 멀티-LLM 상황에서는
// fallback 을 생략해 미등록 model 을 엄격히 거부할 수 있다.
import type { ChatEvent, ChatInput, LLMProvider } from "@wchat/interfaces";
import { WChatError } from "@wchat/interfaces";

export interface CreateLLMProviderRegistryDeps {
  providers: LLMProvider[];
  fallback?: LLMProvider;
}

export function createLLMProviderRegistry(
  deps: CreateLLMProviderRegistryDeps,
): LLMProvider {
  const { providers, fallback } = deps;
  const providerByModel = new Map<string, LLMProvider>();
  for (const provider of providers) {
    for (const model of provider.models) {
      if (!providerByModel.has(model)) {
        providerByModel.set(model, provider);
      }
    }
  }

  return {
    name: "registry",
    models: [...providerByModel.keys()],
    async *chat(
      input: ChatInput,
      signal: AbortSignal,
    ): AsyncIterable<ChatEvent> {
      const provider = providerByModel.get(input.model) ?? fallback;
      if (!provider) {
        throw new WChatError(
          "LLM_MODEL_NOT_FOUND",
          "orchestrator",
          false,
          `등록되지 않은 model: ${input.model}`,
        );
      }
      yield* provider.chat(input, signal);
    },
  };
}
