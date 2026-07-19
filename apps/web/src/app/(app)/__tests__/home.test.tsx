// @vitest-environment jsdom
import React from "react";
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import Home from "../page";
import { QUICK_STARTS } from "../../../components/home/HomeContent";
import { draftKey } from "../../../components/chat/ChatInput";

afterEach(() => {
  cleanup();
});

const replace = vi.fn();
const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push }),
}));

const state = vi.fn();
vi.mock("../../../hooks/useCurrentUser", () => ({
  useCurrentUser: () => state(),
}));

let mockSessions: unknown[] = [];
vi.mock("../../../hooks/useSessions", () => ({
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
vi.mock("../../../hooks/useMcpServers", () => ({
  useMcpServers: () => ({
    servers: mockServers,
    loading: false,
    error: null,
    create: vi.fn(),
    remove: vi.fn(),
  }),
}));

let mockSkills: unknown[] = [];
vi.mock("../../../hooks/useSkills", () => ({
  useSkills: () => ({ skills: mockSkills, loading: false, error: null }),
}));

let mockAgents: unknown[] = [];
let mockAgentsLoading = false;
vi.mock("../../../hooks/useAgents", () => ({
  useAgents: () => ({
    agents: mockAgents,
    loading: mockAgentsLoading,
    error: null,
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  }),
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
    mockAgents = [];
    mockAgentsLoading = false;
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

  it("인증이면 이름 환영 + 편집가능 컴포저 노출(클릭 즉시 전환 아님)", () => {
    state.mockReturnValue({ user: authedUser, loading: false });
    render(<Home />);
    expect(screen.getByText(/안녕하세요, 미님/)).toBeTruthy();
    // 옛 클릭-트리거 버튼이 아니라 실제 입력 가능한 컴포저.
    const box = screen.getByLabelText("메시지 입력");
    fireEvent.click(box);
    fireEvent.focus(box);
    expect(push).not.toHaveBeenCalled(); // 클릭/포커스만으로는 채팅 화면으로 전환하지 않는다.
    expect(replace).not.toHaveBeenCalled();
  });

  it("홈 컴포저에 입력하고 Enter 하면 pending 메시지를 예약하고 새 세션으로 이동한다", () => {
    state.mockReturnValue({ user: authedUser, loading: false });
    render(<Home />);
    const box = screen.getByLabelText("메시지 입력");
    fireEvent.change(box, { target: { value: "홈에서 바로 질문" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(push).toHaveBeenCalledTimes(1);
    const [to] = push.mock.calls[0] as [string];
    const newId = to.replace("/chat/", "");
    // 첫 메시지는 pending 으로 예약 → ChatView 마운트 시 자동전송된다.
    expect(window.sessionStorage.getItem(`wchat:pending:${newId}`)).toBe(
      "홈에서 바로 질문",
    );
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

  it("능력 스트립의 에이전트 개수는 useAgents 로 실제 조회한 길이를 반영한다(P22-T6-10)", () => {
    mockAgents = [{ id: "a1" }, { id: "a2" }, { id: "a3" }];
    state.mockReturnValue({ user: authedUser, loading: false });
    render(<Home />);
    expect(screen.getByTestId("capability-agents")).toHaveTextContent("3");
  });

  it("에이전트 목록 로딩 중에는 0 을 표시한다(하드코딩 상수 미사용)", () => {
    mockAgents = [];
    mockAgentsLoading = true;
    state.mockReturnValue({ user: authedUser, loading: false });
    render(<Home />);
    expect(screen.getByTestId("capability-agents")).toHaveTextContent("0");
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
