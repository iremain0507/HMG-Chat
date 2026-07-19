// data-retention.ts — 12-OPS-SECURITY.md § 부록 H 데이터 retention job.
//   14-INTERFACES.md 단일 출처 기준으로 실제 delete 가 가능한 자원만 정리한다:
//     - uploads: UploadRepo.expiredOlderThan(cutoff) 후 delete (Repo<T,F> 기본 제공)
//     - artifacts: ArtifactStore.cleanupExpired() (§ 4, 이미 구현체 존재)
//     - artifact_shares: 만료분 revoke (logical delete, ArtifactShareRepo.revoke)
//     - error_logs: ErrorLogRepo.deleteOlderThan(cutoff) — 90일 (부록 H 4번)
//     - health_history: HealthHistoryRepo.deleteOlderThan(cutoff) — 30일 (부록 H 5번)
//     - messages: org.retentionDays 가 설정된 org 만 MessageRepo.deleteOlderThan(cutoff, orgId)
//       (부록 H 3번). retentionDays=null 은 무기한 보존이라 절대 건드리지 않는다.
//   위 3종은 P22-T1-15 / 계약배치 C2(packages/interfaces + migration 0033) 승인 후 배선됐다.
//   cron 등록(node-cron 등, 매일 03:00 KST)은 서버 부트스트랩의 몫이라 여기서는 1회 실행 함수만
//   제공한다. 실패 시 alert-engine 을 통해 Slack 알림(partial 실패 허용, 각 단계 try/catch).
import type {
  AlertEventRepo,
  ArtifactStore,
  DataAccess,
} from "@wchat/interfaces";
import type { AlertNotifier } from "./alert-engine.js";
import { triggerAlert } from "./alert-engine.js";
import type { AuditRecorder } from "./audit-recorder.js";

const DAY_MS = 24 * 60 * 60 * 1000;
export const UPLOAD_RETENTION_DAYS = 30;
/** 부록 H 2번 / 12-OPS-SECURITY.md:187 — artifact 보존기간(활성 share 는 예외). */
export const ARTIFACT_RETENTION_DAYS = 90;
/** 부록 H 4번 — error_logs 보존기간. */
export const ERROR_LOG_RETENTION_DAYS = 90;
/** 부록 H 5번 — health_history 보존기간. */
export const HEALTH_HISTORY_RETENTION_DAYS = 30;

export interface RetentionStepResult {
  step: string;
  ok: boolean;
  detail?: unknown;
  error?: string;
}

export type RetentionDataAccess = Pick<
  DataAccess,
  | "uploads"
  | "artifacts"
  | "artifactShares"
  | "errorLogs"
  | "healthHistory"
  | "messages"
  | "organizations"
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
  audit?: AuditRecorder,
): Promise<RetentionStepResult[]> {
  const results: RetentionStepResult[] = [
    await runStep("expired-uploads", async () => {
      const cutoff = new Date(Date.now() - UPLOAD_RETENTION_DAYS * DAY_MS);
      const expired = await da.uploads.expiredOlderThan(cutoff);
      for (const upload of expired) await da.uploads.delete(upload.id);
      return { deletedCount: expired.length };
    }),
    // 부록 H 2번 — 90일 지난 artifact. 12-OPS-SECURITY.md:187 에 따라 **활성(미만료·미취소)
    // share 가 붙은 건은 남긴다**(share 의 expires_at 까지 공유 링크가 살아 있어야 하므로).
    // 열거는 DataAccess 를 가진 여기서 시스템 스코프(expiredOlderThan)로 하고, store 는 바이트만
    // 지운다 — DB row(및 inline_content) 삭제는 여기서 수행한다.
    await runStep("artifact-store-cleanup", async () => {
      const cutoff = new Date(Date.now() - ARTIFACT_RETENTION_DAYS * DAY_MS);
      const expired = await da.artifacts.expiredOlderThan(cutoff);
      const now = Date.now();
      const targets: string[] = [];
      for (const a of expired) {
        const { items } = await da.artifactShares.list({ artifactId: a.id });
        const hasActiveShare = items.some(
          (s) => !s.revokedAt && s.expiresAt.getTime() > now,
        );
        if (!hasActiveShare) targets.push(a.id);
      }
      const result = await artifactStore.cleanupExpired({
        artifactIds: targets,
      });
      for (const id of targets) await da.artifacts.delete(id);
      return result;
    }),
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
    // 부록 H 4번 — 90일 지난 error_logs.
    await runStep("expired-error-logs", async () => {
      const cutoff = new Date(Date.now() - ERROR_LOG_RETENTION_DAYS * DAY_MS);
      return { deletedCount: await da.errorLogs.deleteOlderThan(cutoff) };
    }),
    // 부록 H 5번 — 30일 지난 health_history.
    await runStep("expired-health-history", async () => {
      const cutoff = new Date(
        Date.now() - HEALTH_HISTORY_RETENTION_DAYS * DAY_MS,
      );
      return { deletedCount: await da.healthHistory.deleteOlderThan(cutoff) };
    }),
    // 부록 H 3번 — org.retentionDays 가 설정된 org 의 messages 만 org 별 cutoff 로.
    // retentionDays=null 은 무기한 보존이라 deleteOlderThan 을 아예 호출하지 않는다.
    await runStep("org-message-retention", async () => {
      const { items: orgs } = await da.organizations.list();
      const perOrg: Array<{ orgId: string; deletedCount: number }> = [];
      for (const o of orgs) {
        if (o.retentionDays === null) continue;
        const cutoff = new Date(Date.now() - o.retentionDays * DAY_MS);
        const deletedCount = await da.messages.deleteOlderThan(cutoff, o.id);
        perOrg.push({ orgId: o.id, deletedCount });
        // 실제로 지운 org 만 감사기록(0건 삭제까지 남기면 매일 noise 가 쌓인다).
        if (deletedCount > 0) {
          await audit?.record({
            orgId: o.id,
            action: "data_retention.messages_purged",
            resourceType: "message",
            metadata: {
              deletedCount,
              retentionDays: o.retentionDays,
              cutoff: cutoff.toISOString(),
            },
          });
        }
      }
      return {
        deletedCount: perOrg.reduce((sum, p) => sum + p.deletedCount, 0),
        orgs: perOrg,
      };
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
