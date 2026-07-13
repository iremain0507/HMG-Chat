// routes/errors.ts — 16-API-CONTRACT.md § 15 POST /errors 단일 출처 (client error 리포팅).
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import type { ErrorCategory, ErrorLogEntry } from "@wchat/interfaces";
import type { AuthedVariables } from "../middleware/auth-middleware.js";
import type { ErrorLogDataAccess } from "../db/error-log-data-access.js";

const LEVELS = ["debug", "info", "warn", "error", "fatal"] as const;
const CATEGORIES: readonly ErrorCategory[] = [
  "auth",
  "tool",
  "db",
  "mcp",
  "sandbox",
  "rate-limit",
  "external-api",
  "parser",
  "orchestrator",
  "http",
  "system",
];

function isLevel(v: unknown): v is ErrorLogEntry["level"] {
  return typeof v === "string" && (LEVELS as readonly string[]).includes(v);
}

function isCategory(v: unknown): v is ErrorCategory {
  return typeof v === "string" && (CATEGORIES as readonly string[]).includes(v);
}

function errorJson(code: string, message: string) {
  return {
    error: { code, category: "http" as const, message, retryable: false },
  };
}

export function createErrorRoutes(deps: {
  da: ErrorLogDataAccess;
}): Hono<{ Variables: AuthedVariables }> {
  const app = new Hono<{ Variables: AuthedVariables }>();

  app.post("/", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || !isLevel(body.level)) {
      return c.json(
        errorJson("INVALID_INPUT", "level 이 올바르지 않습니다."),
        400,
      );
    }
    if (!isCategory(body.category)) {
      return c.json(
        errorJson("INVALID_INPUT", "category 가 올바르지 않습니다."),
        400,
      );
    }
    if (typeof body.message !== "string" || body.message.trim() === "") {
      return c.json(errorJson("INVALID_INPUT", "message 가 필요합니다."), 400);
    }
    const auth = c.get("auth");
    await deps.da.errorLogs.append({
      level: body.level,
      category: body.category,
      message: body.message,
      ...(body.context && typeof body.context === "object"
        ? { context: body.context as Record<string, unknown> }
        : {}),
      ...(typeof body.requestId === "string"
        ? { requestId: body.requestId }
        : {}),
      userId: auth.sub,
      orgId: auth.org,
    });
    return c.json(
      { data: { received: true }, meta: { requestId: randomUUID() } },
      202,
    );
  });

  return app;
}
