// @vitest-environment jsdom
// components/layout/ThemeToggle.tsx — P16-T6-03 갭4: 아이콘 전용 버튼에 title 툴팁 부재.
import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { ThemeToggle } from "../ThemeToggle";

describe("ThemeToggle 툴팁", () => {
  afterEach(() => cleanup());

  it("aria-label 과 동일한 title 툴팁을 갖는다", () => {
    render(<ThemeToggle />);
    const toggle = screen.getByTestId("theme-toggle");
    expect(toggle).toHaveAttribute("title", "테마 전환");
  });
});
