// @vitest-environment jsdom
// app/projects/page.tsx — 18-FRONTEND-WIREFRAMES § 18.5.2 /projects 목록.
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import ProjectsPage from "../page";

describe("ProjectsPage", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("접근 가능한 프로젝트 목록을 표시한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          data: [
            {
              id: "proj-1",
              name: "영업 RFP 분석",
              description: null,
              visibility: "private",
              orgUnitId: null,
              ownerId: "user-1",
              createdAt: "2026-04-01T00:00:00Z",
            },
          ],
        }),
      })),
    );

    render(<ProjectsPage />);

    await waitFor(() => {
      expect(screen.getByText("영업 RFP 분석")).toBeInTheDocument();
    });
    expect(screen.getByRole("link", { name: "영업 RFP 분석" })).toHaveAttribute(
      "href",
      "/projects/proj-1",
    );
  });
});
