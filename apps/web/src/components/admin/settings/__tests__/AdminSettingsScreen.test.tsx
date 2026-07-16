// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  waitFor,
  fireEvent,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { AdminSettingsScreen } from "../AdminSettingsScreen";
import { subscribeToasts, __resetToastsForTest } from "../../../../lib/toast";

const ORG = {
  id: "org-1",
  name: "Acme",
  domain: "acme.test",
  plan: "pro",
  allowedModels: ["claude-sonnet-5", "claude-opus-4-8"],
  allowedTools: [],
  defaultTokenBudgetMicros: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

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

function stubFetch(opts: { putOk?: boolean } = {}) {
  const putOk = opts.putOk ?? true;
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("/auth/me")) {
      return {
        ok: true,
        json: async () => ({ data: { user: {}, org: ORG } }),
      };
    }
    if (init?.method === "PUT") {
      if (!putOk) {
        return { ok: false, json: async () => ({ error: {} }) };
      }
      const patch = JSON.parse(init.body as string);
      return {
        ok: true,
        json: async () => ({ data: { ...SETTINGS, ...patch } }),
      };
    }
    return { ok: true, json: async () => ({ data: SETTINGS }) };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("AdminSettingsScreen", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    __resetToastsForTest();
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

  it("maxTokens 를 범위 밖으로 바꾸면 저장 버튼이 비활성화되고 오류가 표시된다", async () => {
    stubFetch();
    render(<AdminSettingsScreen />);
    await waitFor(() => {
      expect(screen.getByRole("tablist")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId("admin-settings-maxTokens"), {
      target: { value: "999999" },
    });

    expect(
      await screen.findByTestId("admin-settings-maxTokens-error"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("admin-settings-save-button")).toBeDisabled();
  });

  it("유효한 변경을 저장하면 PUT 패치 전송 후 성공 토스트를 띄운다", async () => {
    const fetchMock = stubFetch();
    render(<AdminSettingsScreen />);
    await waitFor(() => {
      expect(screen.getByRole("tablist")).toBeInTheDocument();
    });

    const received: unknown[][] = [];
    subscribeToasts((toasts) => received.push(toasts));

    fireEvent.change(screen.getByTestId("admin-settings-temperature"), {
      target: { value: "0.4" },
    });
    fireEvent.click(screen.getByTestId("admin-settings-save-button"));

    await waitFor(() => {
      expect(
        received.some((snapshot) =>
          snapshot.some((t) => (t as { kind: string }).kind === "success"),
        ),
      ).toBe(true);
    });

    const putCall = fetchMock.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === "PUT",
    );
    expect(putCall).toBeDefined();
    const body = JSON.parse((putCall![1] as RequestInit).body as string);
    expect(body.temperature).toBe(0.4);
  });

  it("저장이 실패하면 draft 를 이전 값으로 롤백하고 오류 토스트를 띄운다", async () => {
    stubFetch({ putOk: false });
    render(<AdminSettingsScreen />);
    await waitFor(() => {
      expect(screen.getByRole("tablist")).toBeInTheDocument();
    });

    const received: unknown[][] = [];
    subscribeToasts((toasts) => received.push(toasts));

    fireEvent.change(screen.getByTestId("admin-settings-temperature"), {
      target: { value: "0.4" },
    });
    fireEvent.click(screen.getByTestId("admin-settings-save-button"));

    await waitFor(() => {
      expect(
        received.some((snapshot) =>
          snapshot.some((t) => (t as { kind: string }).kind === "error"),
        ),
      ).toBe(true);
    });

    await waitFor(() => {
      expect(screen.getByTestId("admin-settings-temperature")).toHaveValue(0.7);
    });
  });

  it("maxTokens 를 낮추면(하향) 저장 전 확인 다이얼로그를 띄운다", async () => {
    const fetchMock = stubFetch();
    render(<AdminSettingsScreen />);
    await waitFor(() => {
      expect(screen.getByRole("tablist")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId("admin-settings-maxTokens"), {
      target: { value: "1000" },
    });
    fireEvent.click(screen.getByTestId("admin-settings-save-button"));

    const confirmDialog = await screen.findByTestId(
      "admin-settings-downgrade-confirm",
    );
    expect(confirmDialog).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(
        ([, init]) => (init as RequestInit | undefined)?.method === "PUT",
      ),
    ).toBe(false);

    fireEvent.click(
      screen.getByTestId("admin-settings-downgrade-confirm-accept"),
    );

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([, init]) => (init as RequestInit | undefined)?.method === "PUT",
        ),
      ).toBe(true);
    });
  });

  it("defaultModel select 는 org.allowedModels 를 옵션으로 보여준다", async () => {
    stubFetch();
    render(<AdminSettingsScreen />);
    await waitFor(() => {
      expect(screen.getByRole("tablist")).toBeInTheDocument();
    });

    const select = await screen.findByTestId("admin-settings-defaultModel");
    await waitFor(() => {
      expect(select.querySelectorAll("option")).toHaveLength(2);
    });
  });

  it("나머지 6개 탭은 실제 필드를 렌더한다(플레이스홀더 텍스트 없음)", async () => {
    stubFetch();
    render(<AdminSettingsScreen />);
    await waitFor(() => {
      expect(screen.getByRole("tablist")).toBeInTheDocument();
    });

    const casesById: Record<string, string> = {
      rag: "admin-settings-ragTopK",
      "web-search": "admin-settings-webSearchResultCount",
      connectors: "admin-settings-enableDirectConnections",
      branding: "admin-settings-instanceName",
      permissions: "admin-settings-defaultUserRole",
      quota: "admin-settings-maxUploadSizeMb",
    };

    for (const [tabId, fieldTestId] of Object.entries(casesById)) {
      fireEvent.click(screen.getByTestId(`admin-settings-tab-${tabId}`));
      expect(await screen.findByTestId(fieldTestId)).toBeInTheDocument();
      expect(screen.queryByText(/이후 태스크에서 추가됩니다/)).toBeNull();
    }
  });

  it("defaultUserRole/enableSignup 은 '아직 미적용' 힌트를 노출한다", async () => {
    stubFetch();
    render(<AdminSettingsScreen />);
    await waitFor(() => {
      expect(screen.getByRole("tablist")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("admin-settings-tab-permissions"));
    expect(
      await screen.findByTestId("admin-settings-defaultUserRole-hint"),
    ).toHaveTextContent("아직 미적용");
    expect(
      screen.getByTestId("admin-settings-enableSignup-hint"),
    ).toHaveTextContent("아직 미적용");
  });

  it("RAG 탭 필드를 변경하고 저장하면 PUT patch 에 반영된다", async () => {
    const fetchMock = stubFetch();
    render(<AdminSettingsScreen />);
    await waitFor(() => {
      expect(screen.getByRole("tablist")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("admin-settings-tab-rag"));
    fireEvent.change(await screen.findByTestId("admin-settings-ragTopK"), {
      target: { value: "12" },
    });
    fireEvent.click(screen.getByTestId("admin-settings-save-button"));

    await waitFor(() => {
      const putCall = fetchMock.mock.calls.find(
        ([, init]) => (init as RequestInit | undefined)?.method === "PUT",
      );
      expect(putCall).toBeDefined();
      const body = JSON.parse((putCall![1] as RequestInit).body as string);
      expect(body.ragTopK).toBe(12);
    });
  });
});
