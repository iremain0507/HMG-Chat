// @vitest-environment jsdom
// components/settings/SettingsIndex.tsx — P16-T6-04(갭6·9) 설정 인덱스: memories/skills/mcp/
// quota/profile 전 섹션 링크를 한 곳에 나열해 NavRail '설정' 하드코딩(/settings/memories)과
// 고아 라우트(/settings/quota)를 해소한다.
import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";

import { SettingsIndex } from "../SettingsIndex";

describe("SettingsIndex", () => {
  afterEach(() => {
    cleanup();
  });

  it("memories/skills/mcp/quota/profile 5개 섹션 링크를 렌더한다", () => {
    render(<SettingsIndex />);

    expect(screen.getByTestId("settings-index-memories")).toHaveAttribute(
      "href",
      "/settings/memories",
    );
    expect(screen.getByTestId("settings-index-skills")).toHaveAttribute(
      "href",
      "/settings/skills",
    );
    expect(screen.getByTestId("settings-index-mcp")).toHaveAttribute(
      "href",
      "/settings/mcp",
    );
    expect(screen.getByTestId("settings-index-quota")).toHaveAttribute(
      "href",
      "/settings/quota",
    );
    expect(screen.getByTestId("settings-index-profile")).toHaveAttribute(
      "href",
      "/settings/profile",
    );
  });

  it("프롬프트 섹션 링크를 렌더한다 (P19-T6-13)", () => {
    render(<SettingsIndex />);

    expect(screen.getByTestId("settings-index-prompts")).toHaveAttribute(
      "href",
      "/settings/prompts",
    );
  });

  it("API 키 섹션 링크를 렌더한다 (P19-T6-16)", () => {
    render(<SettingsIndex />);

    expect(screen.getByTestId("settings-index-api-keys")).toHaveAttribute(
      "href",
      "/settings/api-keys",
    );
  });
});
