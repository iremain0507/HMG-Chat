// @vitest-environment jsdom
// components/settings/ApiKeysManager.tsx — P19-T6-16: API 키 발급/목록/폐기 매니저.
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
import { ApiKeysManager } from "../ApiKeysManager";

const KEY_1 = {
  id: "key-1",
  name: "CI 키",
  keyPrefix: "wchat_sk_ab12",
  scopes: [],
  lastUsedAt: null,
  revokedAt: null,
  createdAt: "2026-04-01T00:00:00Z",
};

describe("ApiKeysManager", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("발급된 키 카드를 name·keyPrefix 마스킹과 함께 표시한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ data: [KEY_1] }),
      })),
    );

    render(<ApiKeysManager />);

    await waitFor(() => {
      expect(screen.getByText("CI 키")).toBeInTheDocument();
    });
    expect(screen.getByText(/wchat_sk_ab12/)).toBeInTheDocument();
  });

  it("＋ API 키 발급 모달에서 제출하면 POST 후 평문 키를 1회 배너로 보여준다", async () => {
    const rawKey = "wchat_sk_ab12plaintextrawkey";
    const fetchMock = vi.fn(async (_url: string, opts?: RequestInit) => {
      if (opts?.method === "POST") {
        return {
          ok: true,
          json: async () => ({ data: { ...KEY_1, key: rawKey } }),
        };
      }
      return { ok: true, json: async () => ({ data: [] }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ApiKeysManager />);

    await waitFor(() => {
      expect(screen.getByText("발급된 API 키가 없습니다.")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "＋ API 키 발급" }));
    fireEvent.change(screen.getByLabelText("이름"), {
      target: { value: "CI 키" },
    });
    fireEvent.click(screen.getByRole("button", { name: "발급" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/api-keys",
        expect.objectContaining({ method: "POST" }),
      );
    });

    expect(
      await screen.findByTestId("api-key-created-banner"),
    ).toHaveTextContent(rawKey);
  });

  it("폐기 버튼 클릭 시 DELETE 요청을 보내고 카드가 사라진다", async () => {
    const fetchMock = vi.fn(async (_url: string, opts?: RequestInit) => {
      if (opts?.method === "DELETE") {
        return { ok: true, json: async () => ({}) };
      }
      return { ok: true, json: async () => ({ data: [KEY_1] }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ApiKeysManager />);

    await waitFor(() => {
      expect(screen.getByText("CI 키")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "폐기" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/api-keys/key-1",
        expect.objectContaining({ method: "DELETE" }),
      );
    });
    expect(screen.queryByText("CI 키")).not.toBeInTheDocument();
  });
});
