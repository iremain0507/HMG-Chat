// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import LoginPage from "../page";

describe("LoginPage", () => {
  it("magic-link 로그인 폼을 렌더링한다", async () => {
    render(await LoginPage({ searchParams: Promise.resolve({}) }));
    expect(
      screen.getByRole("button", { name: "매직 링크 받기" }),
    ).toBeInTheDocument();
  });

  it("?error=expired 쿼리를 LoginForm 에 전달해 에러 메시지를 표시한다", async () => {
    render(
      await LoginPage({ searchParams: Promise.resolve({ error: "expired" }) }),
    );
    expect(screen.getByText(/링크가 만료되었습니다/)).toBeInTheDocument();
  });
});
