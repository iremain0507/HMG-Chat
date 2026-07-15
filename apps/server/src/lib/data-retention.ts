// data-retention.ts — 12-OPS-SECURITY.md § 부록 H 데이터 retention job.
//   14-INTERFACES.md 단일 출처 기준으로 실제 delete 가 가능한 자원만 정리한다:
//     - uploads: UploadRepo.expiredOlderThan(cutoff) 후 delete (Repo<T,F> 기본 제공)
//     - artifacts: ArtifactStore.cleanupExpired() (§ 4, 이미 구현체 존재)
//     - artifact_shares: 만료분 revoke (logical delete, ArtifactShareRepo.revoke)
//   error_logs/health_history 삭제(부록 H 3/5번)는 ErrorLogRepo(append/list)·HealthHistoryRepo
//   (append/recent) 에 delete 계열 메서드가 없어 범위 밖 — 추가하려면 packages/interfaces 변경이
//   필요해 CLAUDE.md 격리 규칙상 이번 태스크에서 임의 추가 불가(후속 태스크 필요). messages retention
//   (부록 H 4번)은 문서 자체가 "org.retention_days 컬럼 추가 필요 — v1.1" 로 명시적으로 이연.
//   cron 등록(node-cron 등, 매일 03:00 KST)은 서버 부트스트랩의 몫이라 여기서는 1회 실행 함수만
//   제공한다. 실패 시 alert-engine 을 통해 Slack 알림(partial 실패 허용, 각 단계 try/catch).
import type {
  AlertEventRepo,
  ArtifactStore,
  DataAccess,
} from "@wchat/interfaces";
import type { AlertNotifier } from "./alert-engine.js";
import { triggerAlert } from "./alert-engine.js";

const DAY_MS = 24 * 60 * 60 * 1000;
export const UPLOAD_RETENTION_DAYS = 30;

export interface RetentionStepResult {
  step: string;
  ok: boolean;
  detail?: unknown;
  error?: string;
}

export type RetentionDataAccess = Pick<
  DataAccess,
  "uploads" | "artifactShares"
>;

async function runStep(
  step: string,
  fn: () => Promise<unknown>,
): Promise<RetentionStepResult> {
  try {
    const detail = await fn();
    return { step, ok: true, detail };
  } catch (err) {
    return {
      step,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function runRetention(
  da: RetentionDataAccess,
  artifactStore: Pick<ArtifactStore, "cleanupExpired">,
  alerting?: { repo: Pick<AlertEventRepo, "insert">; notifier: AlertNotifier },
): Promise<RetentionStepResult[]> {
  const results: RetentionStepResult[] = [
    await runStep("expired-uploads", async () => {
      const cutoff = new Date(Date.now() - UPLOAD_RETENTION_DAYS * DAY_MS);
      const expired = await da.uploads.expiredOlderThan(cutoff);
      for (const upload of expired) await da.uploads.delete(upload.id);
      return { deletedCount: expired.length };
    }),
    await runStep("artifact-store-cleanup", () =>
      artifactStore.cleanupExpired(),
    ),
    await runStep("expired-artifact-shares", async () => {
      const now = Date.now();
      let revokedCount = 0;
      let cursor: string | undefined;
      do {
        const page = await da.artifactShares.list(undefined, {
          ...(cursor ? { cursor } : {}),
          limit: 100,
        });
        for (const share of page.items) {
          if (!share.revokedAt && share.expiresAt.getTime() <= now) {
            await da.artifactShares.revoke(share.id);
            revokedCount++;
          }
        }
        cursor = page.nextCursor;
      } while (cursor);
      return { revokedCount };
    }),
  ];

  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0 && alerting) {
    await triggerAlert(alerting.repo, alerting.notifier, {
      ruleId: "data-retention-failure",
      severity: "warn",
      message: `data retention job partial 실패: ${failed.map((f) => f.step).join(", ")}`,
      payload: { failed },
    });
  }

  return results;
}
