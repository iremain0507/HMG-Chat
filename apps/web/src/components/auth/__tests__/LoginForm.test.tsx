// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { LoginForm } from "../LoginForm";

describe("LoginForm", () => {
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

  it("POST /api/v1/auth/magic-link 로 이메일을 전송하고 성공 상태를 표시한다", async () => {
    render(<LoginForm />);

    fireEvent.change(screen.getByLabelText("이메일"), {
      target: { value: "user@wchat.dev" },
    });
    fireEvent.click(screen.getByRole("button", { name: "매직 링크 받기" }));

    await waitFor(() => {
      expect(screen.getByText(/이메일을 확인하세요/)).toBeInTheDocument();
    });

    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/auth/magic-link",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({ email: "user@wchat.dev" }),
      }),
    );
  });

  it("errorCode prop 이 있으면 만료/무효/사용됨 에러 메시지를 표시한다", () => {
    render(<LoginForm errorCode="expired" />);
    expect(screen.getByText(/링크가 만료되었습니다/)).toBeInTheDocument();
  });
});
