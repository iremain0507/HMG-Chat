// @vitest-environment jsdom
// components/admin/GrantsManager.tsx — P20-T6-11: 리소스별 접근 부여(grant) 관리 UI.
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

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/grants",
}));

import { GrantsManager } from "../GrantsManager";

const GRANT_1 = {
  subjectType: "user",
  subjectId: "user-1",
  access: "read",
};

describe("GrantsManager", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("리소스 조회 폼 제출 시 GET /api/v1/admin/grants 요청을 보내고 목록을 표시한다", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [GRANT_1] }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(<GrantsManager />);

    fireEvent.change(screen.getByLabelText("리소스 종류"), {
      target: { value: "knowledge" },
    });
    fireEvent.change(screen.getByLabelText("리소스 ID"), {
      target: { value: "doc-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "조회" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/admin/grants?resourceType=knowledge&resourceId=doc-1",
        expect.objectContaining({ credentials: "include" }),
      );
    });
    expect(screen.getByText("user-1")).toBeInTheDocument();
  });

  it("group 에 read grant 부여 버튼 클릭 시 POST /api/v1/admin/grants 요청을 보낸다", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "POST") {
          return { ok: true, json: async () => ({ data: {} }) };
        }
        return { ok: true, json: async () => ({ data: [] }) };
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<GrantsManager />);

    fireEvent.change(screen.getByLabelText("리소스 종류"), {
      target: { value: "knowledge" },
    });
    fireEvent.change(screen.getByLabelText("리소스 ID"), {
      target: { value: "doc-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "조회" }));

    await waitFor(() => {
      expect(screen.getByText("권한이 없습니다.")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText("대상 종류"), {
      target: { value: "group" },
    });
    fireEvent.change(screen.getByLabelText("대상 ID"), {
      target: { value: "group-1" },
    });
    fireEvent.change(screen.getByLabelText("접근 레벨"), {
      target: { value: "read" },
    });
    fireEvent.click(screen.getByRole("button", { name: "부여" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/admin/grants",
        expect.objectContaining({
          method: "POST",
          credentials: "include",
          body: JSON.stringify({
            resourceType: "knowledge",
            resourceId: "doc-1",
            subjectType: "group",
            subjectId: "group-1",
            access: "read",
          }),
        }),
      );
    });
  });

  it("회수 버튼 클릭 시 DELETE /api/v1/admin/grants 요청을 보낸다", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "DELETE") {
          return { ok: true, json: async () => ({}) };
        }
        return { ok: true, json: async () => ({ data: [GRANT_1] }) };
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<GrantsManager />);

    fireEvent.change(screen.getByLabelText("리소스 종류"), {
      target: { value: "knowledge" },
    });
    fireEvent.change(screen.getByLabelText("리소스 ID"), {
      target: { value: "doc-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "조회" }));

    await waitFor(() => {
      expect(screen.getByText("user-1")).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByRole("button", { name: "회수 (user-1, read)" }),
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/admin/grants?resourceType=knowledge&resourceId=doc-1&subjectType=user&subjectId=user-1&access=read",
        expect.objectContaining({ method: "DELETE", credentials: "include" }),
      );
    });
  });
});
