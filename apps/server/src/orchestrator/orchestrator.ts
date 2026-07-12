import type {
  ChatEvent,
  LLMMessage,
  LLMProvider,
  PromptBlock,
} from "@wchat/interfaces";

export function hello(): string {
  return "orchestrator: hello-world";
}

export interface RunTurnInput {
  provider: LLMProvider;
  model: string;
  systemBlocks: PromptBlock[];
  messages: LLMMessage[];
  maxTokens: number;
  signal: AbortSignal;
}

// 메시지 → LLM → SSE 루프 skeleton (14-INTERFACES.md § 6 ChatEvent 는 16-API-CONTRACT
// SSE 이벤트와 1:1 이므로, 이 async generator 를 그대로 SSE 로 relay 하면 된다 — 실제
// route/SSE 연결은 P2-T2-04 소관.
export async function* runTurn(input: RunTurnInput): AsyncIterable<ChatEvent> {
  const chatEvents = input.provider.chat(
    {
      model: input.model,
      systemBlocks: input.systemBlocks,
      messages: input.messages,
      maxTokens: input.maxTokens,
    },
    input.signal,
  );
  for await (const event of chatEvents) {
    yield event;
  }
}
