// routes/sessions.ts — 16-API-CONTRACT.md § DELETE /sessions/:id/active-run,
// POST /sessions/:id/messages/hitl, GET /sessions/:id/hitl/pending 단일 출처.
// (세션 CRUD 는 이 태스크 acceptance 밖 — P2-T2-04 PROGRESS.md 기록과 동일 사유, 후속 phase 에서 추가)
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { abortRun } from "../orchestrator/run-registry.js";
import { resolveHitl, listPendingHitl } from "../tools/hitl-manager.js";

function errorJson(code: string, message: string) {
  return {
    error: { code, category: "http" as const, message, retryable: false },
  };
}

export function createSessionRoutes(): Hono {
  const app = new Hono();

  app.delete("/:id/active-run", (c) => {
    const sessionId = c.req.param("id");
    const cancelled = abortRun(sessionId);
    return c.json({ data: { cancelled }, meta: { requestId: randomUUID() } });
  });

  // 14-INTERFACES.md § 9 HitlBridge — client 가 hitl_request 에 대한 사용자 응답을 전달.
  app.post("/:id/messages/hitl", async (c) => {
    const sessionId = c.req.param("id");
    const body = await c.req
      .json<{
        toolCallId?: string;
        decision?: "approved" | "denied";
        modifiedArgs?: Record<string, unknown>;
        reason?: string;
      }>()
      .catch(() => ({}) as { toolCallId?: string; decision?: never });
    if (
      !body.toolCallId ||
      (body.decision !== "approved" && body.decision !== "denied")
    ) {
      return c.json(
        errorJson("INVALID_INPUT", "toolCallId/decision 이 필요합니다."),
        400,
      );
    }

    const result = resolveHitl(sessionId, body.toolCallId, {
      decision: body.decision,
      ...(body.modifiedArgs ? { modifiedArgs: body.modifiedArgs } : {}),
      ...(body.reason ? { reason: body.reason } : {}),
    });

    if (result === "not_found") {
      return c.json(
        errorJson("NOT_FOUND", "해당 toolCallId 의 HITL 요청이 없습니다."),
        404,
      );
    }
    if (result === "gone") {
      return c.json(errorJson("GONE", "이미 처리된 HITL 요청입니다."), 410);
    }
    return c.json({
      data: { delivered: true },
      meta: { requestId: randomUUID() },
    });
  });

  app.get("/:id/hitl/pending", (c) => {
    const sessionId = c.req.param("id");
    return c.json({
      data: listPendingHitl(sessionId),
      meta: { requestId: randomUUID() },
    });
  });

  return app;
}
