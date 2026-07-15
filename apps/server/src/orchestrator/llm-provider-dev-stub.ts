// orchestrator/llm-provider-dev-stub.ts — ANTHROPIC_API_KEY 미설정 시 app.ts 조립에 쓰는
// fail-soft LLMProvider(P2-T2-06). 실 네트워크 호출 없이 입력 마지막 user 메시지를 그대로
// text_delta 로 echo 하고 stop 한다. abort signal 관찰 구간을 두어 Stop 흐름도 그대로 재현.
//
// P11-T2-02 — 실 Anthropic 없이도 createApp() 실HTTP 통합테스트가 tool_use→tool_result
// 왕복(runTurn 의 실 tool-execution 루프, routes/messages.ts 의 실 tools/model 배선)을
// 검증할 수 있도록, 결정적 트리거 `"USE_TOOL <toolName> <jsonArgs>"` 를 인식해 tool_use 를
// emit 한다(등록된 tools 에 해당 이름이 없으면 무시하고 기존 echo 로 폴백). 재호출(마지막
// 메시지가 tool 역할)이면 tool_result 내용을 최종 텍스트로 echo 후 종료 — 무한 루프 방지.
import { randomUUID } from "node:crypto";
import type { ChatEvent, ContentPart, LLMProvider } from "@wchat/interfaces";

const ECHO_DELAY_MS = 20;

const TOOL_TRIGGER = /^USE_TOOL\s+(\S+)\s+(\{.*\})$/s;

export function createDevStubLLMProvider(): LLMProvider {
  return {
    name: "dev-stub",
    models: ["dev-stub"],
    async *chat(input, signal): AsyncIterable<ChatEvent> {
      const lastMessage = input.messages.at(-1);

      if (lastMessage?.role === "tool" && Array.isArray(lastMessage.content)) {
        const toolResultText = (lastMessage.content as ContentPart[])
          .filter((part) => part.type === "tool_result")
          .map((part) =>
            typeof part.content === "string"
              ? part.content
              : JSON.stringify(part.content),
          )
          .join("\n");
        yield {
          type: "message_start",
          messageId: randomUUID(),
          meta: { provider: "dev-stub", model: input.model },
        };
        yield { type: "text_delta", text: toolResultText };
        await new Promise((resolve) => setTimeout(resolve, ECHO_DELAY_MS));
        yield {
          type: "stop",
          reason: signal.aborted ? "aborted" : "end_turn",
          usage: {
            inputTokens: toolResultText.length,
            outputTokens: toolResultText.length,
          },
        };
        return;
      }

      const lastUserText = [...input.messages]
        .reverse()
        .find((m) => m.role === "user")?.content;
      const text = typeof lastUserText === "string" ? lastUserText : "hello";

      const trigger = TOOL_TRIGGER.exec(text);
      const triggeredToolName = trigger?.[1];
      const triggeredArgsJson = trigger?.[2];
      if (
        triggeredToolName &&
        triggeredArgsJson &&
        input.tools?.some((t) => t.name === triggeredToolName)
      ) {
        yield {
          type: "message_start",
          messageId: randomUUID(),
          meta: { provider: "dev-stub", model: input.model },
        };
        yield {
          type: "tool_use",
          toolCallId: randomUUID(),
          name: triggeredToolName,
          args: JSON.parse(triggeredArgsJson),
        };
        yield {
          type: "stop",
          reason: "tool_use",
          usage: { inputTokens: text.length, outputTokens: 0 },
        };
        return;
      }

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
