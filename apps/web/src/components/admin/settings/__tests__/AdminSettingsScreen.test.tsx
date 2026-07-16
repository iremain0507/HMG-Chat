// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { AdminSettingsScreen } from "../AdminSettingsScreen";

const SETTINGS = {
  maxTokens: 4096,
  temperature: 0.7,
  topP: 0.9,
  defaultModel: "claude-sonnet-5",
  systemPrompt: "",
  toolMaxTokens: 4096,
  ragTopK: 10,
  ragRrfK: 60,
  ragChunkSizeTokens: 800,
  ragChunkOverlapTokens: 100,
  ragHybridEnabled: true,
  ragRelevanceThreshold: 0,
  webSearchEnabled: false,
  webSearchResultCount: 3,
  enableDirectConnections: false,
  instanceName: "WChat",
  banner: "",
  responseWatermark: "",
  defaultUserRole: "member",
  enableSignup: false,
  maxUploadSizeMb: 25,
  maxUploadCount: 10,
};

function stubFetchOnce() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: SETTINGS }),
    })),
  );
}

describe("AdminSettingsScreen", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("GET 로 불러온 뒤 7개 탭을 렌더한다", async () => {
    stubFetchOnce();
    render(<AdminSettingsScreen />);

    await waitFor(() => {
      expect(screen.getByRole("tablist")).toBeInTheDocument();
    });
    expect(screen.getAllByRole("tab")).toHaveLength(7);
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/admin/settings",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("탭을 클릭하면 활성 탭과 패널이 전환된다", async () => {
    stubFetchOnce();
    render(<AdminSettingsScreen />);

    await waitFor(() => {
      expect(screen.getByRole("tablist")).toBeInTheDocument();
    });

    const modelsTab = screen.getByTestId("admin-settings-tab-models");
    expect(modelsTab).toHaveAttribute("aria-selected", "true");
    expect(
      screen.getByTestId("admin-settings-panel-models"),
    ).toBeInTheDocument();

    const ragTab = screen.getByTestId("admin-settings-tab-rag");
    ragTab.click();

    await waitFor(() => {
      expect(ragTab).toHaveAttribute("aria-selected", "true");
    });
    expect(modelsTab).toHaveAttribute("aria-selected", "false");
    expect(screen.getByTestId("admin-settings-panel-rag")).toBeInTheDocument();
    expect(
      screen.queryByTestId("admin-settings-panel-models"),
    ).not.toBeInTheDocument();
  });

  it("변경사항이 없으면 저장 바가 보이지 않는다", async () => {
    stubFetchOnce();
    render(<AdminSettingsScreen />);

    await waitFor(() => {
      expect(screen.getByRole("tablist")).toBeInTheDocument();
    });
    expect(
      screen.queryByTestId("admin-settings-save-bar"),
    ).not.toBeInTheDocument();
  });
});
