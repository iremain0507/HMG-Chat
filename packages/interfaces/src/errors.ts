// packages/interfaces/src/errors.ts
//
// Error model — single source of truth for the WChat error category enum,
// the `WChatError` base class, and the wire-format `SerializedError` shape.
//
// import graph: errors.ts is a ROOT file (alongside types.ts). It imports nothing
// from other interface files. Both `types.ts` and `Logger.ts` import `ErrorCategory`
// from here (§ 파일 분할 import rule 1 + 4).

export type ErrorCategory =
  | "auth"
  | "tool"
  | "db"
  | "mcp"
  | "sandbox"
  | "rate-limit"
  | "external-api"
  | "parser"
  | "orchestrator"
  | "http"
  | "system";

/**
 * Base error type for all WChat domain failures.
 *
 * `code`     — stable machine code, e.g. 'AUTH_INVALID' / 'QUOTA_EXCEEDED'.
 * `category` — coarse bucket used for logging / metric tagging.
 * `retryable`— whether a retry could plausibly succeed.
 *
 * Error class instances are NOT directly serializable to SSE/HTTP JSON
 * (stack/cause are non-serializable). Convert to {@link SerializedError} via
 * `apps/server/src/lib/errors.ts # serializeError()` before sending over the wire.
 */
export class WChatError extends Error {
  constructor(
    public code: string,
    public category: ErrorCategory,
    public retryable: boolean,
    message: string,
    // `Error` (ES2022 lib) declares `cause`, so this parameter property overrides it.
    public override cause?: unknown,
    public context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "WChatError";
  }
}

/**
 * Wire format — identical shape across SSE events, HTTP error envelopes and log JSON.
 * `ChatEvent.error`, the HTTP error envelope and the Logger all use this type.
 */
export interface SerializedError {
  code: string;
  category: ErrorCategory;
  message: string;
  retryable: boolean;
  requestId?: string;
  details?: Record<string, unknown>;
}
