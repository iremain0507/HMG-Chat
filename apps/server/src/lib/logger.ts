// logger.ts — 12-OPS-SECURITY.md § 관측(Observability) > Logs > 구조화(L07) +
//   01-LESSONS-LEARNED.md § 에러 로그 노이즈 95% 사건(레벨/카테고리 분리로 노이즈 필터링 가능해야 함).
//   14-INTERFACES.md § 11 Logger/LogPayload 단일 출처 — Pino wrapper. 문자열 단독 호출은 인터페이스
//   시그니처상 불가능(typed object 만 허용), ESLint no-console 로 console.log/error 사용도 차단.
import pino from "pino";
import type { Logger as PinoInstance } from "pino";
import type { Logger, LogPayload } from "@wchat/interfaces";

export interface CreateLoggerOptions {
  level?: string;
  destination?: NodeJS.WritableStream;
}

function toBindings(payload: LogPayload & { error?: unknown }) {
  const { category, requestId, userId, orgId, durationMs, context, error } =
    payload;
  return {
    category,
    requestId,
    userId,
    orgId,
    durationMs,
    context,
    ...(error === undefined ? {} : { err: error }),
  };
}

class PinoLogger implements Logger {
  constructor(private readonly instance: PinoInstance) {}

  debug(p: LogPayload): void {
    this.instance.debug(toBindings(p), p.msg);
  }

  info(p: LogPayload): void {
    this.instance.info(toBindings(p), p.msg);
  }

  warn(p: LogPayload): void {
    this.instance.warn(toBindings(p), p.msg);
  }

  error(p: LogPayload & { error?: unknown }): void {
    this.instance.error(toBindings(p), p.msg);
  }

  fatal(p: LogPayload & { error?: unknown }): void {
    this.instance.fatal(toBindings(p), p.msg);
  }

  child(ctx: { requestId?: string; userId?: string; orgId?: string }): Logger {
    return new PinoLogger(this.instance.child(ctx));
  }
}

export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const instance = pino(
    {
      level: options.level ?? "info",
      formatters: {
        level(label) {
          return { level: label };
        },
      },
      serializers: {
        err: pino.stdSerializers.err,
      },
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    options.destination,
  );
  return new PinoLogger(instance);
}
