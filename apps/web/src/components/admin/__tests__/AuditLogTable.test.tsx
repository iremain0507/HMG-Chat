// @vitest-environment jsdom
// components/admin/AuditLogTable.tsx — P20-T1-16: 감사 로그 읽기 전용 조회 테이블.
// GET /api/v1/admin/audit-logs 소비, 시맨틱 토큰만 사용.
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/audit-logs",
}));

import { AuditLogTable } from "../AuditLogTable";

const ENTRIES = [
  {
    id: "log-1",
    actorUserId: "user-1",
    action: "admin.settings.updated",
    resourceType: "org_settings",
    resourceId: "org-1",
    metadata: { maxTokens: 9000 },
    createdAt: "2026-07-01T00:00:00.000Z",
  },
];

describe("AuditLogTable", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("감사 로그 행을 표시한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ data: ENTRIES }),
      })),
    );

    render(<AuditLogTable />);

    await waitFor(() => {
      expect(screen.getByText("admin.settings.updated")).toBeInTheDocument();
    });
    expect(screen.getByText("org_settings:org-1")).toBeInTheDocument();
  });

  it("데이터가 비어있으면 무데이터 안내를 표시한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ data: [] }),
      })),
    );

    render(<AuditLogTable />);

    await waitFor(() => {
      expect(
        screen.getByText(/표시할 감사 로그가 없습니다/),
      ).toBeInTheDocument();
    });
  });

  it("action 필터 입력 변경 시 쿼리스트링에 반영해 재조회한다", async () => {
    const fetchMock = vi.fn(async (..._args: unknown[]) => ({
      ok: true,
      json: async () => ({ data: ENTRIES }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(<AuditLogTable />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    const input = screen.getByLabelText("action 필터");
    input.dispatchEvent(new Event("focus"));
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.change(input, { target: { value: "admin.grant.created" } });

    await waitFor(() => {
      const calls = fetchMock.mock.calls;
      const lastCall = calls[calls.length - 1];
      expect(lastCall).toBeDefined();
      expect(String(lastCall?.[0])).toContain("action=admin.grant.created");
    });
  });

  it("서브내비를 렌더한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ data: ENTRIES }),
      })),
    );

    render(<AuditLogTable />);

    await waitFor(() => {
      expect(screen.getByTestId("admin-sub-nav")).toBeInTheDocument();
    });
  });
});
