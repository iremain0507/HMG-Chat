// @vitest-environment jsdom
// components/sessions/SessionCard.tsx — P16-T6-03 갭4: 아이콘 전용 액션 버튼(고정/이름변경/삭제)에
// aria-label 만 있고 title 이 없어 마우스 사용자에게 툴팁이 뜨지 않던 문제.
// P21-T6-15: 보관/삭제는 비동기·비낙관적 mutation이라 응답 전 재클릭하면 중복 요청이 발생한다(UX-17).
import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
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
        onArchive={vi.fn()}
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
        onArchive={vi.fn()}
      />,
    );

    const unpinButton = screen.getByLabelText("고정 해제: 테스트 세션");
    expect(unpinButton).toHaveAttribute("title", "고정 해제: 테스트 세션");
  });
});

describe("SessionCard 아카이브", () => {
  afterEach(() => cleanup());

  it("보관되지 않은 세션은 '보관' 버튼을 렌더하고 클릭 시 onArchive 를 호출한다", () => {
    const onArchive = vi.fn();
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
        onArchive={onArchive}
      />,
    );

    const archiveButton = screen.getByLabelText("보관: 테스트 세션");
    fireEvent.click(archiveButton);
    expect(onArchive).toHaveBeenCalledWith("sess-1");
  });

  it("보관된 세션은 '복원' 버튼을 렌더하고 클릭 시 onArchive 를 호출한다", () => {
    const onArchive = vi.fn();
    render(
      <SessionCard
        session={{ ...session, archived: true }}
        pinned={false}
        folders={[]}
        onOpen={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
        onTogglePin={vi.fn()}
        onAssignFolder={vi.fn()}
        onAddTag={vi.fn()}
        onRemoveTag={vi.fn()}
        onArchive={onArchive}
      />,
    );

    const restoreButton = screen.getByLabelText("복원: 테스트 세션");
    fireEvent.click(restoreButton);
    expect(onArchive).toHaveBeenCalledWith("sess-1");
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
        onArchive={vi.fn()}
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
        onArchive={vi.fn()}
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
        onArchive={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByLabelText("태그 지정: 테스트 세션"));
    const input = screen.getByPlaceholderText("새 태그");
    fireEvent.change(input, { target: { value: "신규태그" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);

    expect(onAddTag).toHaveBeenCalledWith("sess-1", "신규태그");
  });
});

describe("SessionCard 태그 폼 검증 (P21-T6-17, UX-24)", () => {
  afterEach(() => cleanup());

  it("이미 있는 태그를 다시 추가하면 인라인 힌트를 보여주고 onAddTag 를 호출하지 않는다", () => {
    const onAddTag = vi.fn();
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
        onAddTag={onAddTag}
        onRemoveTag={vi.fn()}
        onArchive={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByLabelText("태그 지정: 테스트 세션"));
    const input = screen.getByPlaceholderText("새 태그");
    fireEvent.change(input, { target: { value: "업무" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);

    expect(screen.getByText("이미 있는 태그입니다.")).toBeInTheDocument();
    expect(onAddTag).not.toHaveBeenCalled();
  });
});

describe("SessionCard 드래그앤드롭", () => {
  afterEach(() => cleanup());

  it("카드는 draggable=true 이고 dragstart 시 dataTransfer 에 세션 id 를 싣는다", () => {
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
        onArchive={vi.fn()}
      />,
    );

    const card = screen.getByTestId("session-card-sess-1");
    expect(card).toHaveAttribute("draggable", "true");

    const setData = vi.fn();
    fireEvent.dragStart(card, { dataTransfer: { setData } });
    expect(setData).toHaveBeenCalledWith(
      "application/x-wchat-session-id",
      "sess-1",
    );
  });
});

describe("SessionCard 우클릭 컨텍스트 메뉴", () => {
  afterEach(() => cleanup());

  it("우클릭 시 이동/고정/보관/삭제 액션이 있는 컨텍스트 메뉴가 열린다", () => {
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
        onArchive={vi.fn()}
      />,
    );

    const card = screen.getByTestId("session-card-sess-1");
    fireEvent.contextMenu(card);

    const menu = screen.getByTestId("context-menu-sess-1");
    expect(within(menu).getByText("이동")).toBeInTheDocument();
    expect(within(menu).getByText("고정")).toBeInTheDocument();
    expect(within(menu).getByText("보관")).toBeInTheDocument();
    expect(within(menu).getByText("삭제")).toBeInTheDocument();
  });

  it("컨텍스트 메뉴의 고정/보관/삭제 클릭 시 각 핸들러를 호출하고 메뉴를 닫는다", () => {
    const onTogglePin = vi.fn();
    const onArchive = vi.fn();
    const onDelete = vi.fn();
    render(
      <SessionCard
        session={session}
        pinned={false}
        folders={[]}
        onOpen={vi.fn()}
        onRename={vi.fn()}
        onDelete={onDelete}
        onTogglePin={onTogglePin}
        onAssignFolder={vi.fn()}
        onAddTag={vi.fn()}
        onRemoveTag={vi.fn()}
        onArchive={onArchive}
      />,
    );

    const card = screen.getByTestId("session-card-sess-1");
    fireEvent.contextMenu(card);
    fireEvent.click(
      within(screen.getByTestId("context-menu-sess-1")).getByText("고정"),
    );
    expect(onTogglePin).toHaveBeenCalledWith("sess-1");
    expect(screen.queryByTestId("context-menu-sess-1")).not.toBeInTheDocument();

    fireEvent.contextMenu(card);
    fireEvent.click(
      within(screen.getByTestId("context-menu-sess-1")).getByText("보관"),
    );
    expect(onArchive).toHaveBeenCalledWith("sess-1");

    fireEvent.contextMenu(card);
    fireEvent.click(
      within(screen.getByTestId("context-menu-sess-1")).getByText("삭제"),
    );
    expect(onDelete).toHaveBeenCalledWith("sess-1");
  });

  it("컨텍스트 메뉴의 '이동' 클릭 시 폴더 지정 메뉴가 열려 onAssignFolder 를 호출할 수 있다", () => {
    const onAssignFolder = vi.fn();
    render(
      <SessionCard
        session={session}
        pinned={false}
        folders={[
          {
            id: "folder-1",
            name: "업무",
            createdAt: "2026-07-14T00:00:00Z",
            systemPrompt: null,
            parentFolderId: null,
          },
        ]}
        onOpen={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
        onTogglePin={vi.fn()}
        onAssignFolder={onAssignFolder}
        onAddTag={vi.fn()}
        onRemoveTag={vi.fn()}
        onArchive={vi.fn()}
      />,
    );

    const card = screen.getByTestId("session-card-sess-1");
    fireEvent.contextMenu(card);
    fireEvent.click(
      within(screen.getByTestId("context-menu-sess-1")).getByText("이동"),
    );

    const folderMenu = screen.getByTestId("folder-menu-sess-1");
    fireEvent.click(within(folderMenu).getByText("업무"));
    expect(onAssignFolder).toHaveBeenCalledWith("sess-1", "folder-1");
  });
});

describe("SessionCard 컨텍스트 메뉴 dismiss 계약 (P21-T6-03, UX-01~05)", () => {
  afterEach(() => cleanup());

  const baseProps = {
    pinned: false,
    folders: [],
    onOpen: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    onTogglePin: vi.fn(),
    onAssignFolder: vi.fn(),
    onAddTag: vi.fn(),
    onRemoveTag: vi.fn(),
    onArchive: vi.fn(),
  };

  it("UX-02: 카드A 우클릭 후 카드B 우클릭하면 A 의 메뉴는 unmount 된다(동시 1개만)", () => {
    const sessionA: SessionListItemDto = { ...session, id: "sess-a" };
    const sessionB: SessionListItemDto = { ...session, id: "sess-b" };
    render(
      <>
        <SessionCard {...baseProps} session={sessionA} />
        <SessionCard {...baseProps} session={sessionB} />
      </>,
    );

    fireEvent.contextMenu(screen.getByTestId("session-card-sess-a"));
    expect(screen.getByTestId("context-menu-sess-a")).toBeInTheDocument();

    fireEvent.contextMenu(screen.getByTestId("session-card-sess-b"));
    expect(screen.queryByTestId("context-menu-sess-a")).not.toBeInTheDocument();
    expect(screen.getByTestId("context-menu-sess-b")).toBeInTheDocument();
  });

  it("UX-01: 메뉴 밖 pointerdown 시 메뉴가 unmount 된다", () => {
    render(
      <>
        <button data-testid="outside">밖</button>
        <SessionCard {...baseProps} session={session} />
      </>,
    );

    fireEvent.contextMenu(screen.getByTestId("session-card-sess-1"));
    expect(screen.getByTestId("context-menu-sess-1")).toBeInTheDocument();

    fireEvent.pointerDown(screen.getByTestId("outside"));
    expect(screen.queryByTestId("context-menu-sess-1")).not.toBeInTheDocument();
  });

  it("UX-03: Escape 시 메뉴가 닫히고 포커스가 트리거(카드)로 복귀한다", () => {
    render(<SessionCard {...baseProps} session={session} />);

    const card = screen.getByTestId("session-card-sess-1");
    fireEvent.contextMenu(card);
    expect(screen.getByTestId("context-menu-sess-1")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("context-menu-sess-1")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(card);
  });

  it("컨텍스트 메뉴는 role=menu, 항목은 role=menuitem 이다", () => {
    render(<SessionCard {...baseProps} session={session} />);
    fireEvent.contextMenu(screen.getByTestId("session-card-sess-1"));
    const menu = screen.getByTestId("context-menu-sess-1");
    expect(menu).toHaveAttribute("role", "menu");
    const items = within(menu).getAllByRole("menuitem");
    expect(items.length).toBeGreaterThan(0);
  });

  it("메뉴 오픈 시 첫 항목에 포커스가 이동하고 ↓/↑/Home/End 로 roving 한다", () => {
    render(<SessionCard {...baseProps} session={session} />);
    fireEvent.contextMenu(screen.getByTestId("session-card-sess-1"));
    const menu = screen.getByTestId("context-menu-sess-1");
    const items = within(menu).getAllByRole("menuitem");

    expect(document.activeElement).toBe(items[0]);

    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1]);

    fireEvent.keyDown(menu, { key: "End" });
    expect(document.activeElement).toBe(items[items.length - 1]);

    fireEvent.keyDown(menu, { key: "Home" });
    expect(document.activeElement).toBe(items[0]);

    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(document.activeElement).toBe(items[items.length - 1]);
  });

  it("Tab 시 메뉴가 닫힌다", () => {
    render(<SessionCard {...baseProps} session={session} />);
    fireEvent.contextMenu(screen.getByTestId("session-card-sess-1"));
    const menu = screen.getByTestId("context-menu-sess-1");
    fireEvent.keyDown(menu, { key: "Tab" });
    expect(screen.queryByTestId("context-menu-sess-1")).not.toBeInTheDocument();
  });
});

describe("SessionCard 이중 제출 가드 (P21-T6-15, UX-17)", () => {
  afterEach(() => cleanup());

  const baseProps = {
    pinned: false,
    folders: [],
    onOpen: vi.fn(),
    onRename: vi.fn(),
    onTogglePin: vi.fn(),
    onAssignFolder: vi.fn(),
    onAddTag: vi.fn(),
    onRemoveTag: vi.fn(),
  };

  it("삭제 버튼은 onDelete 응답 대기 중 disabled 상태이며 재클릭해도 한 번만 호출된다", async () => {
    let resolveDelete: (() => void) | undefined;
    const onDelete = vi.fn(
      () =>
        new Promise<void>((res) => {
          resolveDelete = res;
        }),
    );
    render(
      <SessionCard
        {...baseProps}
        session={session}
        onDelete={onDelete}
        onArchive={vi.fn()}
      />,
    );

    const deleteButton = screen.getByLabelText("삭제: 테스트 세션");
    fireEvent.click(deleteButton);
    expect(deleteButton).toBeDisabled();

    fireEvent.click(deleteButton);
    expect(onDelete).toHaveBeenCalledTimes(1);

    resolveDelete!();
    await waitFor(() => expect(deleteButton).not.toBeDisabled());
  });

  it("보관 버튼은 onArchive 응답 대기 중 disabled 상태이며 재클릭해도 한 번만 호출된다", async () => {
    let resolveArchive: (() => void) | undefined;
    const onArchive = vi.fn(
      () =>
        new Promise<void>((res) => {
          resolveArchive = res;
        }),
    );
    render(
      <SessionCard
        {...baseProps}
        session={session}
        onDelete={vi.fn()}
        onArchive={onArchive}
      />,
    );

    const archiveButton = screen.getByLabelText("보관: 테스트 세션");
    fireEvent.click(archiveButton);
    expect(archiveButton).toBeDisabled();

    fireEvent.click(archiveButton);
    expect(onArchive).toHaveBeenCalledTimes(1);

    resolveArchive!();
    await waitFor(() => expect(archiveButton).not.toBeDisabled());
  });
});
