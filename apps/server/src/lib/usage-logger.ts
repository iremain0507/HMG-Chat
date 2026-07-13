// usage-logger.ts — LLM 호출 usage_logs 기록 + quota 소진을 하나의 단위로 묶는다.
//   06-DATA-MODEL.md § 0010 usage_logs / 14-INTERFACES.md § UsageLogRepo/UserQuotaRepo 단일 출처.

import type {
  UsageLogEntry,
  UsageLogRepo,
  UserQuotaRepo,
} from "@wchat/interfaces";
import { consumeQuota, type QuotaCheckResult } from "./quota-service.js";

export interface UsageLoggerDeps {
  usageLogs: Pick<UsageLogRepo, "append">;
  userQuotas: Pick<UserQuotaRepo, "byUserId" | "consume">;
}

/**
 * quota 를 먼저 소진(consumeQuota — 100% 초과 시 throw)한 뒤 usage_logs 에 append 한다.
 * 순서를 바꾸면 quota 초과 호출도 로그에 남게 되어 실제 비용과 어긋난다.
 */
export async function logUsage(
  deps: UsageLoggerDeps,
  entry: UsageLogEntry,
): Promise<QuotaCheckResult> {
  const result = await consumeQuota(
    deps.userQuotas,
    entry.userId,
    entry.costMicros,
  );
  await deps.usageLogs.append(entry);
  return result;
}
