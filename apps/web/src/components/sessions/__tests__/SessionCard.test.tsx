// @vitest-environment jsdom
// components/sessions/SessionCard.tsx — P16-T6-03 갭4: 아이콘 전용 액션 버튼(고정/이름변경/삭제)에
// aria-label 만 있고 title 이 없어 마우스 사용자에게 툴팁이 뜨지 않던 문제.
import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { SessionCard } from "../SessionCard";
import type { SessionListItemDto } from "../../../hooks/useSessions";

const session: SessionListItemDto = {
  id: "sess-1",
  title: "테스트 세션",
  lastMessageAt: "2026-07-14T12:00:00Z",
  projectId: null,
  archived: false,
  pinned: false,
  folderId: null,
  tags: [],
};

describe("SessionCard 툴팁", () => {
  afterEach(() => cleanup());

  it("고정/이름변경/삭제 아이콘 버튼에 title 툴팁이 aria-label 과 동일하게 존재한다", () => {
    render(
      <SessionCard
        session={session}
        pinned={false}
        folders={[]}
        onOpen={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
        onTogglePin={vi.fn()}
        onAssignFolder={vi.fn()}
        onAddTag={vi.fn()}
        onRemoveTag={vi.fn()}
      />,
    );

    const pinButton = screen.getByLabelText("고정: 테스트 세션");
    const renameButton = screen.getByLabelText("이름변경: 테스트 세션");
    const deleteButton = screen.getByLabelText("삭제: 테스트 세션");

    expect(pinButton).toHaveAttribute("title", "고정: 테스트 세션");
    expect(renameButton).toHaveAttribute("title", "이름변경: 테스트 세션");
    expect(deleteButton).toHaveAttribute("title", "삭제: 테스트 세션");
  });

  it("고정 해제 버튼도 title 툴팁을 갖는다", () => {
    render(
      <SessionCard
        session={session}
        pinned
        folders={[]}
        onOpen={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
        onTogglePin={vi.fn()}
        onAssignFolder={vi.fn()}
        onAddTag={vi.fn()}
        onRemoveTag={vi.fn()}
      />,
    );

    const unpinButton = screen.getByLabelText("고정 해제: 테스트 세션");
    expect(unpinButton).toHaveAttribute("title", "고정 해제: 테스트 세션");
  });
});

describe("SessionCard 태그", () => {
  afterEach(() => cleanup());

  it("세션에 태그가 있으면 칩으로 렌더한다", () => {
    render(
      <SessionCard
        session={{ ...session, tags: ["업무", "긴급"] }}
        pinned={false}
        folders={[]}
        onOpen={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
        onTogglePin={vi.fn()}
        onAssignFolder={vi.fn()}
        onAddTag={vi.fn()}
        onRemoveTag={vi.fn()}
      />,
    );

    expect(screen.getByText("업무")).toBeInTheDocument();
    expect(screen.getByText("긴급")).toBeInTheDocument();
  });

  it("태그 칩의 제거 버튼 클릭 시 onRemoveTag 를 호출한다", () => {
    const onRemoveTag = vi.fn();
    render(
      <SessionCard
        session={{ ...session, tags: ["업무"] }}
        pinned={false}
        folders={[]}
        onOpen={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
        onTogglePin={vi.fn()}
        onAssignFolder={vi.fn()}
        onAddTag={vi.fn()}
        onRemoveTag={onRemoveTag}
      />,
    );

    fireEvent.click(screen.getByLabelText("태그 제거: 업무"));
    expect(onRemoveTag).toHaveBeenCalledWith("sess-1", "업무");
  });

  it("태그 버튼으로 메뉴를 열고 새 태그를 추가하면 onAddTag 를 호출한다", () => {
    const onAddTag = vi.fn();
    render(
      <SessionCard
        session={session}
        pinned={false}
        folders={[]}
        onOpen={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
        onTogglePin={vi.fn()}
        onAssignFolder={vi.fn()}
        onAddTag={onAddTag}
        onRemoveTag={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByLabelText("태그 지정: 테스트 세션"));
    const input = screen.getByPlaceholderText("새 태그");
    fireEvent.change(input, { target: { value: "신규태그" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);

    expect(onAddTag).toHaveBeenCalledWith("sess-1", "신규태그");
  });
});
