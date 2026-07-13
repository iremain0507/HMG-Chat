// quota-service.ts — 사용자별 LLM 비용 quota 게이트.
//   12-OPS-SECURITY.md § Quota 정책: budget 90% 시 알림, 100% 도달 시 LLM 호출 거부.
//   14-INTERFACES.md § UserQuotaRepo/UserQuotaInfo 단일 출처.

import type { UserQuotaInfo, UserQuotaRepo } from "@wchat/interfaces";
import { WChatError } from "@wchat/interfaces";

export const QUOTA_WARNING_RATIO = 0.9;

export type QuotaStatus = "ok" | "warning" | "blocked";

export interface QuotaCheckResult {
  status: QuotaStatus;
  usedMicros: number;
  budgetMicros: number;
  remainingMicros: number;
  percentUsed: number;
}

export function evaluateQuota(quota: UserQuotaInfo): QuotaCheckResult {
  const percentUsed =
    quota.budgetMicros <= 0 ? 1 : quota.usedMicros / quota.budgetMicros;
  const status: QuotaStatus =
    percentUsed >= 1
      ? "blocked"
      : percentUsed >= QUOTA_WARNING_RATIO
        ? "warning"
        : "ok";
  return {
    status,
    usedMicros: quota.usedMicros,
    budgetMicros: quota.budgetMicros,
    remainingMicros: quota.budgetMicros - quota.usedMicros,
    percentUsed,
  };
}

export async function checkQuotaForUser(
  repo: Pick<UserQuotaRepo, "byUserId">,
  userId: string,
): Promise<QuotaCheckResult | null> {
  const quota = await repo.byUserId(userId);
  return quota ? evaluateQuota(quota) : null;
}

/**
 * 이미 100% 소진된 상태면 consume 을 호출하지 않고 WChatError(rate-limit) 를 던진다
 * (12-OPS-SECURITY.md "100% 도달 시 사용자에게 LLM 호출 거부").
 */
export async function consumeQuota(
  repo: Pick<UserQuotaRepo, "byUserId" | "consume">,
  userId: string,
  micros: number,
): Promise<QuotaCheckResult> {
  const before = await checkQuotaForUser(repo, userId);
  if (!before) {
    throw new WChatError(
      "QUOTA_NOT_FOUND",
      "db",
      false,
      `user ${userId} 의 quota 레코드가 없음`,
    );
  }
  if (before.status === "blocked") {
    throw new WChatError(
      "QUOTA_EXCEEDED",
      "rate-limit",
      false,
      `user ${userId} quota 소진(${before.usedMicros}/${before.budgetMicros} micros) — LLM 호출 거부`,
    );
  }

  await repo.consume(userId, micros);
  const after = await checkQuotaForUser(repo, userId);
  if (!after) {
    throw new WChatError(
      "QUOTA_NOT_FOUND",
      "db",
      false,
      `user ${userId} 의 quota 레코드가 consume 후 존재하지 않음`,
    );
  }
  return after;
}
