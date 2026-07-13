// alert-engine.ts — 12-OPS-SECURITY.md § Alarms(SNS → Slack {{ALERT_SLACK_CHANNEL}}) 를
//   애플리케이션 계층에서 구현. 14-INTERFACES.md § AlertEvent/AlertEventRepo 단일 출처.
//   실 CloudWatch alarm/SNS 프로비저닝(infra/)은 AWS=LOCAL_ONLY(P0-T1-01, human gate 대기,
//   자격증명 없음)라 이번 태스크 범위 밖 — rule 평가 → AlertEvent 영속화 → Slack 알림 발송까지의
//   애플리케이션 동작만 구현한다(EmailSender kind-switch 패턴과 동일하게 SlackWebhookAlertNotifier
//   는 배포 시 교체).
import type { AlertEvent, AlertEventRepo } from "@wchat/interfaces";

export type AlertNotification = Pick<
  AlertEvent,
  "ruleId" | "severity" | "message" | "payload"
>;

export interface AlertNotifier {
  send(alert: AlertNotification): Promise<void>;
}

export class ConsoleAlertNotifier implements AlertNotifier {
  async send(alert: AlertNotification): Promise<void> {
    // eslint-disable-next-line no-console -- ConsoleAlertNotifier의 존재 목적 자체가 stdout 출력 (dev/test).
    console.log(
      `[alert:slack] severity=${alert.severity} rule=${alert.ruleId} ${alert.message}`,
    );
  }
}

export class InMemoryAlertNotifier implements AlertNotifier {
  readonly sent: AlertNotification[] = [];

  async send(alert: AlertNotification): Promise<void> {
    this.sent.push(alert);
  }
}

export class SlackWebhookAlertNotifier implements AlertNotifier {
  constructor(
    private readonly webhookUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(alert: AlertNotification): Promise<void> {
    await this.fetchImpl(this.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: `[${alert.severity}] ${alert.ruleId}: ${alert.message}`,
      }),
    });
  }
}

export function createAlertNotifier(
  kind: string | undefined = process.env.ALERT_NOTIFIER_KIND,
): AlertNotifier {
  switch (kind ?? "console") {
    case "console":
      return new ConsoleAlertNotifier();
    case "test":
      return new InMemoryAlertNotifier();
    case "slack": {
      const url = process.env.ALERT_SLACK_WEBHOOK_URL;
      if (!url) throw new Error("ALERT_SLACK_WEBHOOK_URL 미설정");
      return new SlackWebhookAlertNotifier(url);
    }
    default:
      throw new Error(`Unknown ALERT_NOTIFIER_KIND: ${kind}`);
  }
}

export interface TriggerAlertInput {
  ruleId: string;
  severity: AlertEvent["severity"];
  message: string;
  payload?: Record<string, unknown>;
}

export async function triggerAlert(
  repo: Pick<AlertEventRepo, "insert">,
  notifier: AlertNotifier,
  input: TriggerAlertInput,
): Promise<AlertEvent> {
  const event = await repo.insert({
    ruleId: input.ruleId,
    severity: input.severity,
    message: input.message,
    payload: input.payload ?? {},
    resolvedAt: null,
  });
  await notifier.send({
    ruleId: event.ruleId,
    severity: event.severity,
    message: event.message,
    payload: event.payload,
  });
  return event;
}

// 12-OPS-SECURITY.md § Alarms 표 "Quota near limit | user.used > 90% | 사용자 알림".
export async function evaluateQuotaAlert(
  repo: Pick<AlertEventRepo, "insert">,
  notifier: AlertNotifier,
  userId: string,
  quotaStatus: "ok" | "warning" | "blocked",
  percentUsed: number,
): Promise<AlertEvent | null> {
  if (quotaStatus === "ok") return null;
  return triggerAlert(repo, notifier, {
    ruleId: "quota-near-limit",
    severity: quotaStatus === "blocked" ? "critical" : "warn",
    message: `user ${userId} quota ${(percentUsed * 100).toFixed(0)}% 사용`,
    payload: { userId, percentUsed, quotaStatus },
  });
}
