// @vitest-environment jsdom
// components/settings/SkillsManager.tsx — 18-FRONTEND-WIREFRAMES § 18.5.6 /settings/skills.
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { SkillsManager } from "../SkillsManager";

const SKILL_1 = {
  id: "wchat-pptx@1.0.0",
  name: "wchat-pptx",
  version: "1.0.0",
  description: "브랜드 PPTX 생성 스킬입니다.",
  triggers: ["ppt"],
  entryPoint: "skills/wchat-pptx/scripts/build.py",
  permissions: "user" as const,
};

describe("SkillsManager", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("스킬 카드 목록을 표시한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ data: [SKILL_1] }),
      })),
    );

    render(<SkillsManager />);

    await waitFor(() => {
      expect(screen.getByText("wchat-pptx")).toBeInTheDocument();
    });
    expect(
      screen.getByText("브랜드 PPTX 생성 스킬입니다."),
    ).toBeInTheDocument();
    expect(screen.getByText("v1.0.0")).toBeInTheDocument();
  });

  it("스킬이 없으면 빈 상태 문구를 표시한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ data: [] }) })),
    );

    render(<SkillsManager />);

    await waitFor(() => {
      expect(
        screen.getByText("사용 가능한 스킬이 없습니다."),
      ).toBeInTheDocument();
    });
  });
});
