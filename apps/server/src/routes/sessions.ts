// routes/sessions.ts — 16-API-CONTRACT.md § DELETE /sessions/:id/active-run 단일 출처.
// (세션 CRUD 는 이 태스크 acceptance 밖 — P2-T2-04 PROGRESS.md 기록과 동일 사유, 후속 phase 에서 추가)
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { abortRun } from "../orchestrator/run-registry.js";

export function createSessionRoutes(): Hono {
  const app = new Hono();

  app.delete("/:id/active-run", (c) => {
    const sessionId = c.req.param("id");
    const cancelled = abortRun(sessionId);
    return c.json({ data: { cancelled }, meta: { requestId: randomUUID() } });
  });

  return app;
}
