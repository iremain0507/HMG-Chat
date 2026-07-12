// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { SignupForm } from "../SignupForm";

describe("SignupForm", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ data: { sent: true }, meta: { requestId: "r1" } }),
      })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POST /api/v1/auth/signup 으로 email/name 을 전송하고 이메일 확인 상태를 표시한다", async () => {
    render(<SignupForm />);

    fireEvent.change(screen.getByLabelText("이메일"), {
      target: { value: "new@wchat.dev" },
    });
    fireEvent.change(screen.getByLabelText("이름"), {
      target: { value: "새사용자" },
    });
    fireEvent.click(screen.getByRole("button", { name: "가입하기" }));

    await waitFor(() => {
      expect(screen.getByText(/이메일을 확인하세요/)).toBeInTheDocument();
    });

    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/auth/signup",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({ email: "new@wchat.dev", name: "새사용자" }),
      }),
    );
  });

  it("서버가 EMAIL_DOMAIN_FORBIDDEN 을 반환하면 에러 메시지를 표시한다", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      json: async () => ({
        error: {
          code: "EMAIL_DOMAIN_FORBIDDEN",
          category: "auth",
          message: "wchat.dev 도메인만 가입 가능합니다.",
          retryable: false,
        },
      }),
    });

    render(<SignupForm />);
    fireEvent.change(screen.getByLabelText("이메일"), {
      target: { value: "new@gmail.com" },
    });
    fireEvent.change(screen.getByLabelText("이름"), {
      target: { value: "새사용자" },
    });
    fireEvent.click(screen.getByRole("button", { name: "가입하기" }));

    await waitFor(() => {
      expect(
        screen.getByText("wchat.dev 도메인만 가입 가능합니다."),
      ).toBeInTheDocument();
    });
  });
});
