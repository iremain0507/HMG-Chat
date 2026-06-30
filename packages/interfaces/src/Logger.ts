// packages/interfaces/src/Logger.ts
// § 11 — apps/server/src/lib/logger.ts 의 Pino wrapper.
// 명시 예외: errors.ts 의 ErrorCategory 를 직접 import (Logger 시그니처가 category 받음).

import type { ErrorCategory } from "./errors.js";

export interface LogPayload {
  category: ErrorCategory;
  msg: string;
  requestId?: string;
  userId?: string;
  orgId?: string;
  durationMs?: number;
  context?: Record<string, unknown>;
}

export interface Logger {
  debug(p: LogPayload): void;
  info(p: LogPayload): void;
  warn(p: LogPayload): void;
  error(p: LogPayload & { error?: unknown }): void;
  fatal(p: LogPayload & { error?: unknown }): void;
  child(ctx: { requestId?: string; userId?: string; orgId?: string }): Logger;
}
