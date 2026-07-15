// @vitest-environment jsdom
// components/layout/AppShell.tsx — 19-UIUX-UPGRADE.md § P10-T6-01
// 3분할 앱 셸(사이드바+본문+우패널) + 모바일 슬라이드오버 + 테마 토글(data-theme).
import React from "react";
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { AppShell } from "../AppShell";

describe("AppShell", () => {
  afterEach(() => {
    cleanup();
    document.documentElement.removeAttribute("data-theme");
    try {
      window.localStorage.clear();
    } catch {
      // localStorage 미가용 테스트 환경 — data-theme 초기화만으로 충분.
    }
  });

  it("사이드바/본문/우패널 3 region 을 렌더한다", () => {
    render(
      <AppShell sidebar={<div>세션 목록</div>}>
        <div>본문</div>
      </AppShell>,
    );

    expect(screen.getByTestId("app-shell-sidebar")).toHaveTextContent(
      "세션 목록",
    );
    expect(screen.getByTestId("app-shell-main")).toHaveTextContent("본문");
    expect(screen.getByTestId("app-shell-right-panel")).toBeInTheDocument();
  });

  it("테마 토글 클릭 시 document.documentElement 에 data-theme 를 스탬프한다", () => {
    render(
      <AppShell sidebar={<div>세션 목록</div>}>
        <div>본문</div>
      </AppShell>,
    );

    const toggle = screen.getByTestId("theme-toggle");
    fireEvent.click(toggle);
    const first = document.documentElement.getAttribute("data-theme");
    expect(first === "light" || first === "dark").toBe(true);

    fireEvent.click(toggle);
    const second = document.documentElement.getAttribute("data-theme");
    expect(second).not.toBe(first);
  });

  it("모바일 폭에서 사이드바가 슬라이드오버로 접힌다(기본 숨김 → 토글로 노출)", () => {
    render(
      <AppShell sidebar={<div>세션 목록</div>}>
        <div>본문</div>
      </AppShell>,
    );

    const sidebar = screen.getByTestId("app-shell-sidebar");
    expect(sidebar).toHaveAttribute("data-mobile-open", "false");
    expect(sidebar.className).toContain("-translate-x-full");

    fireEvent.click(screen.getByLabelText("사이드바 열기"));
    expect(sidebar).toHaveAttribute("data-mobile-open", "true");
    expect(sidebar.className).toContain("translate-x-0");

    fireEvent.click(screen.getByLabelText("사이드바 닫기"));
    expect(sidebar).toHaveAttribute("data-mobile-open", "false");
  });
});
