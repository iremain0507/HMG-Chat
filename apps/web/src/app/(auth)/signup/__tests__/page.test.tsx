// @vitest-environment jsdom
import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import SignupPage from "../page";

describe("SignupPage", () => {
  it("가입 폼을 렌더링한다", () => {
    render(<SignupPage />);
    expect(
      screen.getByRole("button", { name: "가입하기" }),
    ).toBeInTheDocument();
  });
});
