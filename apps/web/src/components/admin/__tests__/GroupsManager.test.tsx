// @vitest-environment jsdom
// components/admin/GroupsManager.tsx — P19-T6-18: 그룹 생성/이름변경/삭제 + 멤버 추가/제거.
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
  usePathname: () => "/admin/groups",
}));

import { GroupsManager } from "../GroupsManager";

const GROUP_1 = {
  id: "group-1",
  name: "엔지니어링",
  memberUserIds: ["user-1"],
  createdAt: "2026-07-01T00:00:00Z",
  updatedAt: "2026-07-01T00:00:00Z",
};

describe("GroupsManager", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("그룹 목록과 멤버를 표시한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ data: [GROUP_1] }),
      })),
    );

    render(<GroupsManager />);

    await waitFor(() => {
      expect(screen.getByText("엔지니어링")).toBeInTheDocument();
    });
    expect(screen.getByText("user-1")).toBeInTheDocument();
  });

  it("새 그룹 생성 폼 제출 시 POST 요청을 보낸다", async () => {
    const created = {
      ...GROUP_1,
      id: "group-2",
      name: "디자인",
      memberUserIds: [],
    };
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "POST") {
          return { ok: true, json: async () => ({ data: created }) };
        }
        return { ok: true, json: async () => ({ data: [] }) };
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<GroupsManager />);
    await waitFor(() => {
      expect(screen.getByText("그룹이 없습니다.")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText("새 그룹 이름"), {
      target: { value: "디자인" },
    });
    fireEvent.click(screen.getByRole("button", { name: "＋ 그룹 생성" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/admin/groups",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ name: "디자인" }),
        }),
      );
    });
  });

  it("멤버 추가 입력 후 추가 버튼 클릭 시 POST /members 요청을 보낸다", async () => {
    const withMember = { ...GROUP_1, memberUserIds: ["user-1", "user-2"] };
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "POST" && String(input).endsWith("/members")) {
          return { ok: true, json: async () => ({}) };
        }
        return { ok: true, json: async () => ({ data: [withMember] }) };
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<GroupsManager />);
    await waitFor(() => {
      expect(screen.getByText("엔지니어링")).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText("멤버 추가 (엔지니어링)"), {
      target: { value: "user-2" },
    });
    fireEvent.click(screen.getByLabelText("멤버 추가 버튼 (엔지니어링)"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/admin/groups/group-1/members",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ userId: "user-2" }),
        }),
      );
    });
  });

  it("멤버 제거 버튼 클릭 시 DELETE /members/:userId 요청을 보낸다", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "DELETE" && String(input).includes("/members/")) {
          return { ok: true, json: async () => ({}) };
        }
        return { ok: true, json: async () => ({ data: [GROUP_1] }) };
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<GroupsManager />);
    await waitFor(() => {
      expect(screen.getByText("user-1")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText("멤버 제거 (user-1)"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/admin/groups/group-1/members/user-1",
        expect.objectContaining({ method: "DELETE" }),
      );
    });
  });

  it("삭제 버튼 클릭 시 DELETE 요청을 보낸다", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "DELETE") {
          return { ok: true, json: async () => ({}) };
        }
        return { ok: true, json: async () => ({ data: [GROUP_1] }) };
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<GroupsManager />);
    await waitFor(() => {
      expect(screen.getByText("엔지니어링")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText("삭제 (엔지니어링)"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/admin/groups/group-1",
        expect.objectContaining({ method: "DELETE" }),
      );
    });
  });

  it("서브내비를 렌더한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ data: [] }) })),
    );

    render(<GroupsManager />);

    await waitFor(() => {
      expect(screen.getByTestId("admin-sub-nav")).toBeInTheDocument();
    });
  });
});
