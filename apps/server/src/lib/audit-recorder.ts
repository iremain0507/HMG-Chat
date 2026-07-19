// lib/audit-recorder.ts — audit_log(migration 0031) 기록 래퍼. admin mutation 라우트가
// 공통으로 소비. fail-soft(21-LOOP-LESSONS L5): 감사 기록 실패가 admin mutation 자체(설정 변경,
// 사용자 삭제 등)를 막아선 안 된다 — db/upload-service.ts 의 ephemeral indexing fail-soft 패턴과
// 동일하게 try/catch + logger.warn 으로 흡수한다.
import type { Logger } from "@wchat/interfaces";
import type {
  AuditLogDataAccess,
  AuditLogRecordInput,
} from "../db/audit-log-data-access.js";

export interface AuditRecorder {
  record(input: AuditLogRecordInput): Promise<void>;
}

export function createAuditRecorder(
  da: AuditLogDataAccess,
  logger?: Logger,
): AuditRecorder {
  return {
    async record(input) {
      try {
        await da.record(input);
      } catch (err) {
        logger?.warn({
          category: "db",
          msg: "audit log record failed",
          context: { action: input.action, error: String(err) },
        });
      }
    },
  };
}
