// packages/interfaces/src/EmailSender.ts
// § 12 — auth flow 의존 (Phase 1 부터 필수).
// apps/server/src/lib/email-sender.ts 가 EMAIL_SENDER_KIND env 에 따라
// console/SES/SMTP 중 하나 instantiate.
// 본 파일은 types.ts/errors.ts 를 import 하지 않음 (자기-완결 타입만 사용).

export interface EmailSendInput {
  to: string;
  subject: string;
  html: string; // 본문 (HTML)
  text?: string; // plain-text fallback (없으면 html → text 자동 변환)
  category: "auth" | "notification"; // logger / metric tagging
  idempotencyKey?: string; // 같은 key 의 재전송 차단 (24h)
}

export interface EmailSendResult {
  messageId: string; // provider 발급
  acceptedAt: Date;
}

export interface EmailSender {
  send(input: EmailSendInput, signal?: AbortSignal): Promise<EmailSendResult>;
}

// 구현 3종:
// - ConsoleEmailSender: stdout 출력 (dev/test). NODE_ENV !== "production" 일 때만.
// - SesEmailSender: AWS SDK SES v2 (prod default).
// - SmtpEmailSender: nodemailer (사내 SMTP 사용 시).
