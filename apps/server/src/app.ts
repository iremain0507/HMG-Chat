import { Hono } from "hono";
import type { Env } from "./env.js";

export function createApp(env: Env) {
  const app = new Hono();

  app.get("/health", (c) => c.json({
    status: "ok",
    deps: { db: "unknown", redis: "unknown", e2b: "unknown", llm: "unknown" },
    ts: new Date().toISOString(),
  }));

  // Phase 1 부터 routes 추가 (auth, sessions, ...)
  app.get("/api/v1/_ping", (c) => c.json({
    data: { ok: true, env: env.NODE_ENV },
    meta: { requestId: crypto.randomUUID() },
  }));

  return app;
}
