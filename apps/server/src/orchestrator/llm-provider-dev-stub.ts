// orchestrator/llm-provider-dev-stub.ts — ANTHROPIC_API_KEY 미설정 시 app.ts 조립에 쓰는
// fail-soft LLMProvider(P2-T2-06). 실 네트워크 호출 없이 입력 마지막 user 메시지를 그대로
// text_delta 로 echo 하고 stop 한다. abort signal 관찰 구간을 두어 Stop 흐름도 그대로 재현.
import { randomUUID } from "node:crypto";
import type { ChatEvent, LLMProvider } from "@wchat/interfaces";

const ECHO_DELAY_MS = 20;

export function createDevStubLLMProvider(): LLMProvider {
  return {
    name: "dev-stub",
    models: ["dev-stub"],
    async *chat(input, signal): AsyncIterable<ChatEvent> {
      const lastUserText = [...input.messages]
        .reverse()
        .find((m) => m.role === "user")?.content;
      const text = typeof lastUserText === "string" ? lastUserText : "hello";

      yield {
        type: "message_start",
        messageId: randomUUID(),
        meta: { provider: "dev-stub", model: input.model },
      };
      yield { type: "text_delta", text };

      await new Promise((resolve) => setTimeout(resolve, ECHO_DELAY_MS));

      yield {
        type: "stop",
        reason: signal.aborted ? "aborted" : "end_turn",
        usage: { inputTokens: text.length, outputTokens: text.length },
      };
    },
  };
}
