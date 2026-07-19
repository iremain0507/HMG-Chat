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

  it("폐기 버튼 연속 클릭(더블클릭) 시 DELETE 요청은 한 번만 전송된다(UX-17)", async () => {
    let resolveDelete: (() => void) | undefined;
    const fetchMock = vi.fn(async (_url: string, opts?: RequestInit) => {
      if (opts?.method === "DELETE") {
        await new Promise<void>((res) => {
          resolveDelete = res;
        });
        return { ok: true, json: async () => ({}) };
      }
      return { ok: true, json: async () => ({ data: [KEY_1] }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ApiKeysManager />);

    await waitFor(() => {
      expect(screen.getByText("CI 키")).toBeInTheDocument();
    });

    const revokeButton = screen.getByRole("button", { name: "폐기" });
    fireEvent.click(revokeButton);

    await waitFor(() => {
      expect(revokeButton).toBeDisabled();
    });

    fireEvent.click(revokeButton);

    const deleteCalls = fetchMock.mock.calls.filter(
      ([, opts]) => (opts as RequestInit | undefined)?.method === "DELETE",
    );
    expect(deleteCalls).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/api-keys/key-1",
      expect.objectContaining({ method: "DELETE" }),
    );

    resolveDelete!();

    await waitFor(() => {
      expect(screen.queryByText("CI 키")).not.toBeInTheDocument();
    });
  });

  describe("포커스 트랩(useFocusTrap)", () => {
    function stubEmptyList() {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({
          ok: true,
          json: async () => ({ data: [] }),
        })),
      );
    }

    async function openModal() {
      render(<ApiKeysManager />);
      await waitFor(() => {
        expect(
          screen.getByText("발급된 API 키가 없습니다."),
        ).toBeInTheDocument();
      });
      const trigger = screen.getByRole("button", { name: "＋ API 키 발급" });
      trigger.focus();
      fireEvent.click(trigger);
      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeInTheDocument();
      });
      return trigger;
    }

    it("모달을 열면 포커스가 다이얼로그 내부(이름 입력)로 이동한다", async () => {
      stubEmptyList();
      await openModal();

      await waitFor(() => {
        expect(document.activeElement).toBe(screen.getByLabelText("이름"));
      });
    });

    it("Escape 를 누르면 모달이 닫힌다", async () => {
      stubEmptyList();
      await openModal();

      fireEvent.keyDown(document, { key: "Escape" });

      await waitFor(() => {
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      });
    });

    it("Shift+Tab 은 다이얼로그 첫 요소에서 마지막 요소로 순환한다(트랩 밖으로 탈출하지 않음)", async () => {
      stubEmptyList();
      await openModal();

      const nameInput = screen.getByLabelText("이름");
      const cancelButton = screen.getByRole("button", { name: "취소" });

      await waitFor(() => {
        expect(document.activeElement).toBe(nameInput);
      });

      fireEvent.keyDown(document, { key: "Tab", shiftKey: true });

      await waitFor(() => {
        expect(document.activeElement).toBe(cancelButton);
      });
    });

    it("취소 버튼으로 모달을 닫으면 포커스가 트리거 버튼으로 복귀한다", async () => {
      stubEmptyList();
      const trigger = await openModal();

      fireEvent.click(screen.getByRole("button", { name: "취소" }));

      await waitFor(() => {
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      });
      await waitFor(() => {
        expect(document.activeElement).toBe(trigger);
      });
    });

    it("Escape 로 모달을 닫으면 포커스가 트리거 버튼으로 복귀한다", async () => {
      stubEmptyList();
      const trigger = await openModal();

      fireEvent.keyDown(document, { key: "Escape" });

      await waitFor(() => {
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      });
      await waitFor(() => {
        expect(document.activeElement).toBe(trigger);
      });
    });
  });
});
