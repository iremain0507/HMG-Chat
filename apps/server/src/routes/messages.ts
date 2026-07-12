// routes/messages.ts — 16-API-CONTRACT.md § 3 Messages (`POST /sessions/:id/messages`, SSE) 단일 출처.
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { LLMMessage, LLMProvider, PromptBlock } from "@wchat/interfaces";
import { runTurn } from "../orchestrator/orchestrator.js";

export interface MessageRouteDeps {
  provider: LLMProvider;
  model: string;
  systemBlocks?: PromptBlock[];
  maxTokens?: number;
}

function errorJson(code: string, message: string) {
  return {
    error: { code, category: "http" as const, message, retryable: false },
  };
}

export function createMessageRoutes(deps: MessageRouteDeps): Hono {
  const app = new Hono();

  app.post("/:id/messages", async (c) => {
    const body = await c.req
      .json<{
        content?: string;
        attachments?: Array<{ uploadId: string }>;
      }>()
      .catch(() => ({}) as { content?: string; attachments?: unknown[] });
    const content = body.content?.trim();
    if (!content) {
      return c.json(errorJson("INVALID_INPUT", "content 가 필요합니다."), 400);
    }
    // Phase 2/4 boundary — 16-API-CONTRACT § POST /sessions/:id/messages:
    // attachments 는 Phase 4(knowledge 인덱싱) 전까지 미지원, 빈 배열일 때만 통과.
    if (body.attachments && body.attachments.length > 0) {
      return c.json(
        errorJson(
          "ATTACHMENTS_NOT_SUPPORTED",
          "첨부파일은 아직 지원하지 않습니다 (Phase 4 예정).",
        ),
        400,
      );
    }

    const messages: LLMMessage[] = [{ role: "user", content }];

    return streamSSE(c, async (stream) => {
      const events = runTurn({
        provider: deps.provider,
        model: deps.model,
        systemBlocks: deps.systemBlocks ?? [],
        messages,
        maxTokens: deps.maxTokens ?? 1024,
        signal: c.req.raw.signal,
      });
      for await (const event of events) {
        const { type, ...payload } = event;
        await stream.writeSSE({ event: type, data: JSON.stringify(payload) });
      }
    });
  });

  return app;
}
