// EmailSender 구현체 — packages/interfaces/src/EmailSender.ts 단일 출처.
// EMAIL_SENDER_KIND env 로 backend 선택 (16-API-CONTRACT.md § EmailSender 인터페이스).
import { randomUUID } from "node:crypto";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import nodemailer from "nodemailer";
import type {
  EmailSendInput,
  EmailSendResult,
  EmailSender,
} from "@wchat/interfaces";

export class ConsoleEmailSender implements EmailSender {
  async send(input: EmailSendInput): Promise<EmailSendResult> {
    // eslint-disable-next-line no-console -- ConsoleEmailSender의 존재 목적 자체가 stdout 출력 (dev/test).
    console.log(
      `[email:console] to=${input.to} subject="${input.subject}" category=${input.category}\n${
        input.text ?? input.html
      }`,
    );
    return { messageId: randomUUID(), acceptedAt: new Date() };
  }
}

export class InMemoryEmailSender implements EmailSender {
  readonly sent: Array<EmailSendInput & EmailSendResult> = [];

  async send(input: EmailSendInput): Promise<EmailSendResult> {
    const result = { messageId: randomUUID(), acceptedAt: new Date() };
    this.sent.push({ ...input, ...result });
    return result;
  }
}

export class NoopEmailSender implements EmailSender {
  async send(): Promise<EmailSendResult> {
    return { messageId: "noop", acceptedAt: new Date() };
  }
}

export class SesEmailSender implements EmailSender {
  constructor(
    private readonly client: Pick<SESv2Client, "send"> = new SESv2Client({}),
    private readonly from: string = process.env.EMAIL_FROM ?? "",
  ) {}

  async send(
    input: EmailSendInput,
    signal?: AbortSignal,
  ): Promise<EmailSendResult> {
    const result = await this.client.send(
      new SendEmailCommand({
        FromEmailAddress: this.from,
        Destination: { ToAddresses: [input.to] },
        Content: {
          Simple: {
            Subject: { Data: input.subject },
            Body: {
              Html: { Data: input.html },
              ...(input.text ? { Text: { Data: input.text } } : {}),
            },
          },
        },
      }),
      signal ? { abortSignal: signal } : {},
    );
    return {
      messageId: result.MessageId ?? randomUUID(),
      acceptedAt: new Date(),
    };
  }
}

export class SmtpEmailSender implements EmailSender {
  constructor(
    private readonly transport: Pick<
      nodemailer.Transporter,
      "sendMail"
    > = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    }),
    private readonly from: string = process.env.EMAIL_FROM ?? "",
  ) {}

  async send(input: EmailSendInput): Promise<EmailSendResult> {
    const info = await this.transport.sendMail({
      to: input.to,
      from: this.from,
      subject: input.subject,
      html: input.html,
      text: input.text,
    });
    return { messageId: String(info.messageId), acceptedAt: new Date() };
  }
}

export function createEmailSender(
  kind: string | undefined = process.env.EMAIL_SENDER_KIND,
): EmailSender {
  switch (kind ?? "console") {
    case "console":
      return new ConsoleEmailSender();
    case "test":
      return new InMemoryEmailSender();
    case "noop":
      return new NoopEmailSender();
    case "ses":
      return new SesEmailSender();
    case "smtp":
      return new SmtpEmailSender();
    default:
      throw new Error(`Unknown EMAIL_SENDER_KIND: ${kind}`);
  }
}
