// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import Home from "../page";
import { QUICK_STARTS } from "../../components/home/HomeContent";
import { draftKey } from "../../components/chat/ChatInput";

afterEach(() => {
  cleanup();
});

const replace = vi.fn();
const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push }),
}));

const state = vi.fn();
vi.mock("../../hooks/useCurrentUser", () => ({
  useCurrentUser: () => state(),
}));

let mockSessions: unknown[] = [];
vi.mock("../../hooks/useSessions", () => ({
  useSessions: () => ({
    sessions: mockSessions,
    loading: false,
    error: null,
    createSession: vi.fn(),
    renameSession: vi.fn(),
    deleteSession: vi.fn(),
    reload: vi.fn(),
  }),
}));

let mockServers: unknown[] = [];
vi.mock("../../hooks/useMcpServers", () => ({
  useMcpServers: () => ({
    servers: mockServers,
    loading: false,
    error: null,
    create: vi.fn(),
    remove: vi.fn(),
  }),
}));

let mockSkills: unknown[] = [];
vi.mock("../../hooks/useSkills", () => ({
  useSkills: () => ({ skills: mockSkills, loading: false, error: null }),
}));

const authedUser = {
  id: "u1",
  email: "me@wchat.dev",
  name: "미",
  orgId: "o1",
  role: "member" as const,
  customInstructions: null,
  createdAt: "",
};

describe("Home 랜딩", () => {
  beforeEach(() => {
    replace.mockClear();
    push.mockClear();
    mockSessions = [];
    mockServers = [];
    mockSkills = [];
  });

  it("로딩 중이면 안내 문구", () => {
    state.mockReturnValue({ user: null, loading: true });
    render(<Home />);
    expect(screen.getByText(/불러오는 중/)).toBeTruthy();
  });

  it("미인증이면 /login 으로 replace", () => {
    state.mockReturnValue({ user: null, loading: false });
    render(<Home />);
    expect(replace).toHaveBeenCalledWith("/login");
  });

  it("인증이면 이름 환영 + 새 채팅 진입", () => {
    state.mockReturnValue({ user: authedUser, loading: false });
    render(<Home />);
    expect(screen.getByText(/안녕하세요, 미님/)).toBeTruthy();
    expect(screen.getByText(/새 채팅 시작/)).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
  });

  it("일반 멤버에겐 관리자 링크 미노출", () => {
    state.mockReturnValue({ user: authedUser, loading: false });
    render(<Home />);
    expect(screen.queryByText("관리자")).toBeNull();
  });

  it("능력 스트립이 실 커넥터/스킬 개수를 반영한다", () => {
    mockServers = [{ id: "m1" }, { id: "m2" }];
    mockSkills = [{ id: "sk1" }];
    state.mockReturnValue({ user: authedUser, loading: false });
    render(<Home />);
    expect(screen.getByTestId("capability-connectors")).toHaveTextContent("2");
    expect(screen.getByTestId("capability-skills")).toHaveTextContent("1");
  });

  it("빠른 시작 카드를 클릭하면 draft 를 sessionStorage 에 저장하고 새 세션으로 이동한다", () => {
    state.mockReturnValue({ user: authedUser, loading: false });
    render(<Home />);
    const first = QUICK_STARTS[0]!;
    fireEvent.click(screen.getByText(first.title));
    expect(push).toHaveBeenCalledTimes(1);
    const [to] = push.mock.calls[0] as [string];
    const newId = to.replace("/chat/", "");
    expect(window.sessionStorage.getItem(draftKey(newId))).toBe(first.prompt);
  });

  it("최근 세션 클릭 시 해당 세션으로 이동한다", () => {
    mockSessions = [
      {
        id: "s1",
        title: "세션 1",
        lastMessageAt: new Date().toISOString(),
        projectId: null,
        archived: false,
      },
    ];
    state.mockReturnValue({ user: authedUser, loading: false });
    render(<Home />);
    fireEvent.click(screen.getByText("세션 1"));
    expect(push).toHaveBeenCalledWith("/chat/s1");
  });
});
