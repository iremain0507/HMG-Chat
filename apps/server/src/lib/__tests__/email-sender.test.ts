import { describe, it, expect, vi, afterEach } from "vitest";
import {
  ConsoleEmailSender,
  InMemoryEmailSender,
  createEmailSender,
} from "../email-sender.js";

describe("ConsoleEmailSender", () => {
  it("EMAIL_SENDER_KIND=console 로 magic-link URL 이 stdout 에 출력된다", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const sender = new ConsoleEmailSender();

    const result = await sender.send({
      to: "user@example.com",
      subject: "로그인 링크",
      html: '<a href="https://wchat.example.com/auth/magic-link/verify?token=abc123">로그인</a>',
      text: "https://wchat.example.com/auth/magic-link/verify?token=abc123",
      category: "auth",
    });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const [loggedLine] = logSpy.mock.calls[0]!;
    expect(loggedLine).toContain(
      "https://wchat.example.com/auth/magic-link/verify?token=abc123",
    );
    expect(loggedLine).toContain("user@example.com");
    expect(result.messageId).toBeTruthy();
    expect(result.acceptedAt).toBeInstanceOf(Date);

    logSpy.mockRestore();
  });
});

describe("InMemoryEmailSender", () => {
  it("발송된 이메일을 in-memory 큐에 쌓아 테스트에서 조회할 수 있다", async () => {
    const sender = new InMemoryEmailSender();

    await sender.send({
      to: "user@example.com",
      subject: "제목",
      html: "<p>본문</p>",
      category: "notification",
    });

    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0]!.to).toBe("user@example.com");
  });
});

describe("createEmailSender", () => {
  const originalEnv = process.env.EMAIL_SENDER_KIND;

  afterEach(() => {
    process.env.EMAIL_SENDER_KIND = originalEnv;
  });

  it("EMAIL_SENDER_KIND=console → ConsoleEmailSender 를 반환한다", () => {
    expect(createEmailSender("console")).toBeInstanceOf(ConsoleEmailSender);
  });

  it("EMAIL_SENDER_KIND=test → InMemoryEmailSender 를 반환한다", () => {
    expect(createEmailSender("test")).toBeInstanceOf(InMemoryEmailSender);
  });

  it("인자 없으면 process.env.EMAIL_SENDER_KIND 를 사용한다 (default console)", () => {
    delete process.env.EMAIL_SENDER_KIND;
    expect(createEmailSender()).toBeInstanceOf(ConsoleEmailSender);
  });

  it("알 수 없는 kind 는 에러를 던진다", () => {
    expect(() => createEmailSender("unknown-kind")).toThrow(
      /EMAIL_SENDER_KIND/,
    );
  });
});
