// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import Home from "../page";

const replace = vi.fn();
const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push }),
}));

const state = vi.fn();
vi.mock("../../hooks/useCurrentUser", () => ({
  useCurrentUser: () => state(),
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
});
