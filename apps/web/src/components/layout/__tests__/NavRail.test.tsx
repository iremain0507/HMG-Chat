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
import { LocaleProvider } from "../../i18n/LocaleProvider";

// P22-T6-15(C11): NavRail 라벨은 nav.<key> 카탈로그에서 오므로 next-intl 컨텍스트가 필요하다.
// 실앱에서는 AppShell 이 LocaleProvider 를 씌운다. 테스트는 로케일을 ko 로 고정해
// (기존 한국어 단언 유지) /auth/me 초기 조회를 건너뛴다.
function renderNavRail() {
  return render(
    <LocaleProvider initialLocale="ko">
      <NavRail />
    </LocaleProvider>,
  );
}

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
    renderNavRail();

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
    renderNavRail();

    expect(screen.getByTestId("nav-rail-settings")).toHaveAttribute(
      "href",
      "/settings",
    );
  });

  // 갭5 당시엔 전용 에이전트 표면이 없어 /settings/skills 로 임시 대체했으나,
  // P22-T6-10 에서 Agent registry 화면(/settings/agents)이 생겨 본래 목적지로 되돌린다.
  it("에이전트 항목은 에이전트 갤러리(/settings/agents)를 가리킨다(P22-T6-10)", () => {
    stubCurrentUser("member");
    renderNavRail();

    expect(screen.getByTestId("nav-rail-agents")).toHaveAttribute(
      "href",
      "/settings/agents",
    );
  });

  it("일반 멤버에게는 관리 항목을 숨긴다", async () => {
    stubCurrentUser("member");
    renderNavRail();

    await waitFor(() => {
      expect(screen.getByTestId("nav-rail-avatar")).toHaveTextContent("관");
    });
    expect(screen.queryByTestId("nav-rail-admin")).not.toBeInTheDocument();
  });

  it("admin 에게는 관리 항목을 노출한다", async () => {
    stubCurrentUser("admin");
    renderNavRail();

    await waitFor(() => {
      expect(screen.getByTestId("nav-rail-admin")).toBeInTheDocument();
    });
  });
});
