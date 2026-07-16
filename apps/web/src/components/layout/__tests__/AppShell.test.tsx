// @vitest-environment jsdom
// components/layout/AppShell.tsx — design-reference README §Screens/AppShell.
// 헤더(48px)+나비 레일(64px)+세션 사이드바(280px)+본문+우패널(400px, ⌘\ 토글·리사이즈).
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/chat/sess-1",
}));

import { AppShell } from "../AppShell";

function stubCurrentUserFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: {
          user: {
            id: "user-1",
            email: "a@b.com",
            name: "김민수",
            orgId: "org-1",
            role: "member",
            customInstructions: null,
            createdAt: "2026-01-01T00:00:00Z",
          },
          org: null,
        },
      }),
    })),
  );
}

describe("AppShell", () => {
  afterEach(() => {
    cleanup();
    document.documentElement.removeAttribute("data-theme");
    vi.unstubAllGlobals();
    try {
      window.localStorage.clear();
    } catch {
      // localStorage 미가용 테스트 환경 — data-theme 초기화만으로 충분.
    }
  });

  it("헤더/나비레일/사이드바/본문/우패널 5 region 을 렌더한다", () => {
    stubCurrentUserFetch();
    render(
      <AppShell sidebar={<div>세션 목록</div>}>
        <div>본문</div>
      </AppShell>,
    );

    expect(screen.getByTestId("app-shell-header")).toHaveTextContent("WChat");
    expect(screen.getByTestId("app-shell-nav-rail")).toBeInTheDocument();
    expect(screen.getByTestId("app-shell-sidebar")).toHaveTextContent(
      "세션 목록",
    );
    expect(screen.getByTestId("app-shell-main")).toHaveTextContent("본문");
    expect(screen.getByTestId("app-shell-right-panel")).toBeInTheDocument();
  });

  it("테마 토글 클릭 시 document.documentElement 에 data-theme 를 스탬프한다", () => {
    stubCurrentUserFetch();
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
    stubCurrentUserFetch();
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

  it("우패널 토글 버튼 클릭 시 우패널이 사라졌다 다시 나타난다", () => {
    stubCurrentUserFetch();
    render(
      <AppShell sidebar={<div>세션 목록</div>}>
        <div>본문</div>
      </AppShell>,
    );

    const toggle = screen.getByTestId("app-shell-panel-toggle");
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("app-shell-right-panel")).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(
      screen.queryByTestId("app-shell-right-panel"),
    ).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(screen.getByTestId("app-shell-right-panel")).toBeInTheDocument();
  });

  it("⌘\\ 키보드 단축키로 우패널을 토글한다", () => {
    stubCurrentUserFetch();
    render(
      <AppShell sidebar={<div>세션 목록</div>}>
        <div>본문</div>
      </AppShell>,
    );

    expect(screen.getByTestId("app-shell-right-panel")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "\\", metaKey: true });
    expect(
      screen.queryByTestId("app-shell-right-panel"),
    ).not.toBeInTheDocument();
  });

  it("⌘K 버튼 클릭 시 wchat:cmdk 이벤트를 전역에 발행한다", () => {
    stubCurrentUserFetch();
    const listener = vi.fn();
    window.addEventListener("wchat:cmdk", listener);

    render(
      <AppShell sidebar={<div>세션 목록</div>}>
        <div>본문</div>
      </AppShell>,
    );

    fireEvent.click(screen.getByTestId("app-shell-cmdk-button"));
    expect(listener).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(listener).toHaveBeenCalledTimes(2);

    window.removeEventListener("wchat:cmdk", listener);
  });

  it("우패널 드래그 핸들로 폭을 조절한다", () => {
    stubCurrentUserFetch();
    render(
      <AppShell sidebar={<div>세션 목록</div>}>
        <div>본문</div>
      </AppShell>,
    );

    const panel = screen.getByTestId("app-shell-right-panel");
    expect(panel).toHaveStyle({ width: "400px" });

    const handle = screen.getByTestId("app-shell-right-panel-resize-handle");
    fireEvent.mouseDown(handle, { clientX: 500 });
    fireEvent.mouseMove(window, { clientX: 450 });
    fireEvent.mouseUp(window);

    expect(panel).toHaveStyle({ width: "450px" });
  });

  it("헤더 아이콘 버튼(⌘K·우패널 토글·리사이즈 핸들·모바일 햄버거)에 title 툴팁이 존재한다", () => {
    stubCurrentUserFetch();
    render(
      <AppShell sidebar={<div>세션 목록</div>}>
        <div>본문</div>
      </AppShell>,
    );

    expect(screen.getByTestId("app-shell-cmdk-button")).toHaveAttribute(
      "title",
      "검색 (⌘K)",
    );
    expect(screen.getByTestId("app-shell-panel-toggle")).toHaveAttribute(
      "title",
      "우패널 토글 (⌘\\)",
    );
    expect(
      screen.getByTestId("app-shell-right-panel-resize-handle"),
    ).toHaveAttribute("title", "우패널 크기 조절");
    expect(screen.getByLabelText("사이드바 열기")).toHaveAttribute(
      "title",
      "사이드바 열기",
    );
  });

  it("나비 레일에 현재 로그인 사용자 아바타를 노출한다", async () => {
    stubCurrentUserFetch();
    render(
      <AppShell sidebar={<div>세션 목록</div>}>
        <div>본문</div>
      </AppShell>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("nav-rail-avatar")).toHaveTextContent("김");
    });
  });
});
