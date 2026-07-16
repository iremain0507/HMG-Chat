// @vitest-environment jsdom
// components/artifacts/ShareDialog.tsx — 19-UIUX-UPGRADE.md § P10-T6-10,
// 16-API-CONTRACT § 8 POST/DELETE /artifacts/:id/share 소비. 공유 링크 발급/복사/해제 검증.
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { ShareDialog } from "../ShareDialog";

describe("ShareDialog", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("공유 링크 생성 버튼을 누르면 POST 후 URL 을 표시한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          data: {
            token: "tok-1",
            url: "https://app.example.com/share/tok-1",
            expiresAt: "2026-08-14T00:00:00.000Z",
          },
        }),
      })),
    );

    render(<ShareDialog artifactId="artifact-1" onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "공유 링크 생성" }));

    await waitFor(() => {
      expect(
        screen.getByDisplayValue("https://app.example.com/share/tok-1"),
      ).toBeInTheDocument();
    });
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/artifacts/artifact-1/share",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("링크 해제 버튼을 누르면 DELETE 후 생성 버튼으로 되돌아간다", async () => {
    const fetchMock = vi.fn(async (url: string, opts?: RequestInit) => {
      if (opts?.method === "DELETE") {
        return { ok: true };
      }
      return {
        ok: true,
        json: async () => ({
          data: {
            token: "tok-1",
            url: "https://app.example.com/share/tok-1",
            expiresAt: "2026-08-14T00:00:00.000Z",
          },
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ShareDialog artifactId="artifact-1" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "공유 링크 생성" }));
    await waitFor(() => {
      expect(
        screen.getByDisplayValue("https://app.example.com/share/tok-1"),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "링크 해제" }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "공유 링크 생성" }),
      ).toBeInTheDocument();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/artifacts/artifact-1/share/tok-1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("닫기 버튼을 누르면 onClose 가 호출된다", () => {
    const onClose = vi.fn();
    render(<ShareDialog artifactId="artifact-1" onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("열리면 첫 포커스 가능 요소(닫기 버튼)로 포커스가 이동한다", () => {
    render(<ShareDialog artifactId="artifact-1" onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: "닫기" })).toHaveFocus();
  });

  it("Esc 를 누르면 onClose 가 호출된다", () => {
    const onClose = vi.fn();
    render(<ShareDialog artifactId="artifact-1" onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("닫힐 때 트리거 요소로 포커스가 복귀한다", () => {
    function Wrapper() {
      const [open, setOpen] = React.useState(false);
      return (
        <div>
          <button data-testid="trigger" onClick={() => setOpen(true)}>
            열기
          </button>
          {open && (
            <ShareDialog
              artifactId="artifact-1"
              onClose={() => setOpen(false)}
            />
          )}
        </div>
      );
    }
    render(<Wrapper />);
    const trigger = screen.getByTestId("trigger");
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(trigger).toHaveFocus();
  });
});
