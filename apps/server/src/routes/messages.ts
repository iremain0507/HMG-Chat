// routes/messages.ts — 16-API-CONTRACT.md § 3 Messages (`POST /sessions/:id/messages`, SSE) 단일 출처.
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type {
  ActiveRunStatus,
  LLMMessage,
  LLMProvider,
  PromptBlock,
} from "@wchat/interfaces";
import { runTurn } from "../orchestrator/orchestrator.js";
import { registerRun, unregisterRun } from "../orchestrator/run-registry.js";

// abort flow (L06) — Stop 클릭(routes/sessions.ts DELETE /:id/active-run) 이 run-registry 를 통해
// 이 run 의 signal 을 abort() 시킨 뒤, 여기서 sessions_active_runs.status 를 갱신한다.
// 실제 DB 구현(db/active-runs-service.ts) 연결은 app.ts 조립 시점 소관 — P2-T2-04 와 동일 사유로 이번 태스크 범위 밖.
export interface ActiveRunsPort {
  setActiveRun(
    sessionId: string,
    jobId: string,
    status: ActiveRunStatus,
  ): Promise<void>;
}

const noopActiveRuns: ActiveRunsPort = {
  async setActiveRun() {
    // 기본값 — deps.activeRuns 미주입 시 아무 것도 하지 않는다.
  },
};

export interface MessageRouteDeps {
  provider: LLMProvider;
  model: string;
  systemBlocks?: PromptBlock[];
  maxTokens?: number;
  activeRuns?: ActiveRunsPort;
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

    const sessionId = c.req.param("id");
    const jobId = randomUUID();
    const activeRuns = deps.activeRuns ?? noopActiveRuns;
    const handle = registerRun(sessionId, jobId);
    const requestSignal = c.req.raw.signal;
    if (requestSignal.aborted) {
      handle.controller.abort();
    } else {
      requestSignal.addEventListener("abort", () => handle.controller.abort(), {
        once: true,
      });
    }

    return streamSSE(c, async (stream) => {
      try {
        const events = runTurn({
          provider: deps.provider,
          model: deps.model,
          systemBlocks: deps.systemBlocks ?? [],
          messages,
          maxTokens: deps.maxTokens ?? 1024,
          signal: handle.controller.signal,
        });
        for await (const event of events) {
          const { type, ...payload } = event;
          await stream.writeSSE({ event: type, data: JSON.stringify(payload) });
        }
        await activeRuns.setActiveRun(
          sessionId,
          jobId,
          handle.controller.signal.aborted ? "cancelled" : "completed",
        );
      } finally {
        unregisterRun(sessionId, jobId);
      }
    });
  });

  return app;
}
