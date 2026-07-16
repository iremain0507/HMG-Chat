// @vitest-environment jsdom
// app/(app)/layout.tsx — P16-T6-01 (갭2·3): 전역 인증 shell. 이전엔 AppShell 이
// app/(chat)/layout.tsx 에만 마운트돼 홈·projects·settings·admin 에 NavRail·히스토리
// 사이드바가 없었다. 이 그룹으로 이동한 라우트가 실제로 존재하는지(구조 단언) +
// 레이아웃이 NavRail+SessionList 를 포함하는지(렌더 단언)를 검증한다.
import React from "react";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

import AppLayout from "../layout";

function stubApiFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/v1/auth/me")) {
        return {
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
        };
      }
      if (url.includes("/api/v1/sessions")) {
        return { ok: true, json: async () => ({ data: [] }) };
      }
      return { ok: true, json: async () => ({ data: null }) };
    }),
  );
}

describe("(app)/layout — 전역 인증 shell", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("NavRail 과 SessionList(세션 검색 입력) 를 함께 렌더한다", () => {
    stubApiFetch();
    render(
      <AppLayout>
        <div>본문</div>
      </AppLayout>,
    );

    expect(screen.getByTestId("app-shell-nav-rail")).toBeInTheDocument();
    expect(screen.getByTestId("session-search-input")).toBeInTheDocument();
    expect(screen.getByText("본문")).toBeInTheDocument();
  });

  it("홈·projects·settings·admin 라우트가 (app) 그룹 하위에 위치한다(구조 단언)", () => {
    const appDir = join(__dirname, "..");
    const routesInsideAppGroup = [
      "page.tsx",
      "chat/[sessionId]/page.tsx",
      "projects/page.tsx",
      "settings/memories/page.tsx",
      "settings/profile/page.tsx",
      "admin/page.tsx",
    ];
    for (const rel of routesInsideAppGroup) {
      expect(existsSync(join(appDir, rel))).toBe(true);
    }

    const legacyChatGroup = join(appDir, "..", "(chat)");
    expect(existsSync(legacyChatGroup)).toBe(false);

    const legacyTopLevel = [
      join(appDir, "..", "page.tsx"),
      join(appDir, "..", "projects", "page.tsx"),
      join(appDir, "..", "settings", "memories", "page.tsx"),
      join(appDir, "..", "admin", "page.tsx"),
    ];
    for (const legacyPath of legacyTopLevel) {
      expect(existsSync(legacyPath)).toBe(false);
    }
  });
});
