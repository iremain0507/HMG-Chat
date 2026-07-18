// @vitest-environment jsdom
// components/admin/AdminSubNav.tsx — P16-T6-02(갭1) admin 하위 내비: 라우트 링크 + 활성 탭 강조.
//   P19-T6-18 에서 그룹 관리 링크 추가.
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

let mockPathname = "/admin";
vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}));

import { AdminSubNav } from "../AdminSubNav";

describe("AdminSubNav", () => {
  afterEach(() => {
    cleanup();
    mockPathname = "/admin";
  });

  it("대시보드/사용자/그룹/접근 권한/사용량 분석/감사 로그/도구 지표/설정 8개 링크를 렌더한다", () => {
    render(<AdminSubNav />);

    expect(screen.getByTestId("admin-sub-nav-dashboard")).toHaveAttribute(
      "href",
      "/admin",
    );
    expect(screen.getByTestId("admin-sub-nav-users")).toHaveAttribute(
      "href",
      "/admin/users",
    );
    expect(screen.getByTestId("admin-sub-nav-groups")).toHaveAttribute(
      "href",
      "/admin/groups",
    );
    expect(screen.getByTestId("admin-sub-nav-grants")).toHaveAttribute(
      "href",
      "/admin/grants",
    );
    expect(screen.getByTestId("admin-sub-nav-analytics")).toHaveAttribute(
      "href",
      "/admin/analytics",
    );
    expect(screen.getByTestId("admin-sub-nav-audit-logs")).toHaveAttribute(
      "href",
      "/admin/audit-logs",
    );
    expect(screen.getByTestId("admin-sub-nav-tool-metrics")).toHaveAttribute(
      "href",
      "/admin/tool-metrics",
    );
    expect(screen.getByTestId("admin-sub-nav-settings")).toHaveAttribute(
      "href",
      "/admin/settings",
    );
  });

  // P22-T6-21 — OpenAPI 툴서버 admin 패널(/admin/tool-servers)로 갈 진입점이 없으면
  //   URL 직접 입력 외에는 도달 불가라 P16-T6-02 갭1 이 재발한다.
  it("OpenAPI 툴서버 링크를 렌더한다", () => {
    render(<AdminSubNav />);

    expect(screen.getByTestId("admin-sub-nav-tool-servers")).toHaveAttribute(
      "href",
      "/admin/tool-servers",
    );
  });

  it("현재 경로에 해당하는 항목을 aria-current=page 로 표시한다", () => {
    mockPathname = "/admin/users";
    render(<AdminSubNav />);

    expect(screen.getByTestId("admin-sub-nav-users")).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByTestId("admin-sub-nav-dashboard")).not.toHaveAttribute(
      "aria-current",
    );
  });
});
