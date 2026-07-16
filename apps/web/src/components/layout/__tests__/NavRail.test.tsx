// @vitest-environment jsdom
// components/layout/NavRail.tsx — design-reference README § AppShell 나비 레일.
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/projects",
}));

import { NavRail } from "../NavRail";

function stubCurrentUser(role: "member" | "admin" | "owner") {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: {
          user: {
            id: "user-1",
            email: "a@b.com",
            name: "관리자",
            orgId: "org-1",
            role,
            customInstructions: null,
            createdAt: "2026-01-01T00:00:00Z",
          },
          org: null,
        },
      }),
    })),
  );
}

describe("NavRail", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("핵심 5개 항목을 렌더하고 현재 경로를 활성 표시한다", () => {
    stubCurrentUser("member");
    render(<NavRail />);

    expect(screen.getByTestId("nav-rail-home")).toBeInTheDocument();
    expect(screen.getByTestId("nav-rail-projects")).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByTestId("nav-rail-home")).not.toHaveAttribute(
      "aria-current",
    );
    expect(screen.getByTestId("nav-rail-agents")).toBeInTheDocument();
    expect(screen.getByTestId("nav-rail-connectors")).toBeInTheDocument();
    expect(screen.getByTestId("nav-rail-settings")).toBeInTheDocument();
  });

  it("설정 항목은 인덱스(/settings)를 가리킨다(갭9: /settings/memories 하드코딩 제거)", () => {
    stubCurrentUser("member");
    render(<NavRail />);

    expect(screen.getByTestId("nav-rail-settings")).toHaveAttribute(
      "href",
      "/settings",
    );
  });

  it("일반 멤버에게는 관리 항목을 숨긴다", async () => {
    stubCurrentUser("member");
    render(<NavRail />);

    await waitFor(() => {
      expect(screen.getByTestId("nav-rail-avatar")).toHaveTextContent("관");
    });
    expect(screen.queryByTestId("nav-rail-admin")).not.toBeInTheDocument();
  });

  it("admin 에게는 관리 항목을 노출한다", async () => {
    stubCurrentUser("admin");
    render(<NavRail />);

    await waitFor(() => {
      expect(screen.getByTestId("nav-rail-admin")).toBeInTheDocument();
    });
  });
});
