// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ConnectorsTab } from "../ConnectorsTab";

const VALUE = { enableDirectConnections: false };

const apiFetchMock = vi.fn();
vi.mock("../../../../lib/fetch-with-refresh", () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));
vi.mock("../../../../lib/toast", () => ({ showToast: vi.fn() }));

describe("ConnectorsTab", () => {
  beforeEach(() => {
    apiFetchMock.mockReset();
  });
  afterEach(() => cleanup());

  it("enableDirectConnections 필드와 편집 가능한 allowedTools 목록을 렌더한다 (읽기전용 힌트 없음)", () => {
    render(
      <ConnectorsTab
        value={VALUE}
        orgAllowedTools={["web_search", "code_interpreter"]}
        onChange={() => {}}
      />,
    );
    expect(
      screen.getByTestId("admin-settings-enableDirectConnections"),
    ).not.toBeChecked();
    const list = screen.getByTestId("admin-settings-allowedTools-list");
    expect(list).toHaveTextContent("web_search");
    expect(list).toHaveTextContent("code_interpreter");
    // 읽기전용 힌트는 제거되고, 편집 입력과 per-chip 제거 버튼이 있어야 한다.
    expect(
      screen.queryByTestId("admin-settings-allowedTools-hint"),
    ).not.toHaveTextContent("읽기 전용");
    expect(
      screen.getByTestId("admin-settings-allowedTools-input"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("admin-settings-allowedTools-remove-web_search"),
    ).toBeInTheDocument();
  });

  it("입력을 변경하면 onChange 에 patch 를 전달한다", () => {
    const onChange = vi.fn();
    render(
      <ConnectorsTab value={VALUE} orgAllowedTools={[]} onChange={onChange} />,
    );
    fireEvent.click(
      screen.getByTestId("admin-settings-enableDirectConnections"),
    );
    expect(onChange).toHaveBeenCalledWith({ enableDirectConnections: true });
  });

  it("도구를 추가하고 저장하면 PUT /api/v1/admin/tools 를 갱신된 allowedTools 로 호출한다", async () => {
    apiFetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: { allowedTools: ["web_search", "image_generate"] },
      }),
    });
    render(
      <ConnectorsTab
        value={VALUE}
        orgAllowedTools={["web_search"]}
        onChange={() => {}}
      />,
    );
    const input = screen.getByTestId("admin-settings-allowedTools-input");
    fireEvent.change(input, { target: { value: "image_generate" } });
    fireEvent.click(screen.getByTestId("admin-settings-allowedTools-add"));
    fireEvent.click(screen.getByTestId("admin-settings-allowedTools-save"));

    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = apiFetchMock.mock.calls[0]!;
    expect(url).toBe("/api/v1/admin/tools");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual({
      allowedTools: ["web_search", "image_generate"],
    });
  });

  it("도구를 제거하고 저장하면 제거된 배열로 PUT 을 호출한다", async () => {
    apiFetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: { allowedTools: [] } }),
    });
    render(
      <ConnectorsTab
        value={VALUE}
        orgAllowedTools={["web_search"]}
        onChange={() => {}}
      />,
    );
    fireEvent.click(
      screen.getByTestId("admin-settings-allowedTools-remove-web_search"),
    );
    fireEvent.click(screen.getByTestId("admin-settings-allowedTools-save"));

    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledTimes(1));
    const [, init] = apiFetchMock.mock.calls[0]!;
    expect(JSON.parse(init.body)).toEqual({ allowedTools: [] });
  });
});
