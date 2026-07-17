// @vitest-environment jsdom
// components/chat/ProjectPicker.tsx — P10-T6-14 채팅 헤더 [Project ▾] 스코프 전환 드롭다운.
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  within,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ProjectPicker } from "../ProjectPicker";
import type { ProjectDto } from "../../../hooks/useProject";

const PROJECTS: ProjectDto[] = [
  {
    id: "proj-1",
    name: "영업 RFP 분석",
    description: null,
    visibility: "private",
    orgUnitId: null,
    ownerId: "user-1",
    createdAt: "2026-04-01T00:00:00Z",
  },
  {
    id: "proj-2",
    name: "사내 정책",
    description: null,
    visibility: "org",
    orgUnitId: null,
    ownerId: "user-2",
    createdAt: "2026-04-02T00:00:00Z",
  },
];

describe("ProjectPicker", () => {
  afterEach(() => cleanup());

  it("projectId 가 없으면 '프로젝트 없음'을 트리거에 표시한다", () => {
    render(
      <ProjectPicker
        projects={PROJECTS}
        projectId={null}
        onSelect={() => {}}
      />,
    );
    expect(
      screen.getByRole("button", { name: /프로젝트 없음/ }),
    ).toBeInTheDocument();
  });

  it("현재 projectId 에 해당하는 프로젝트 이름을 트리거에 표시한다", () => {
    render(
      <ProjectPicker
        projects={PROJECTS}
        projectId="proj-1"
        onSelect={() => {}}
      />,
    );
    expect(
      screen.getByRole("button", { name: /영업 RFP 분석/ }),
    ).toBeInTheDocument();
  });

  it("트리거 클릭 시 메뉴가 열리고 프로젝트를 선택하면 onSelect(id) 가 호출되고 메뉴가 닫힌다", () => {
    const onSelect = vi.fn();
    render(
      <ProjectPicker
        projects={PROJECTS}
        projectId={null}
        onSelect={onSelect}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /프로젝트 없음/ }));
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    fireEvent.click(screen.getByText("사내 정책"));

    expect(onSelect).toHaveBeenCalledWith("proj-2");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("'프로젝트 없음' 항목을 선택하면 onSelect(null) 이 호출된다", () => {
    const onSelect = vi.fn();
    render(
      <ProjectPicker
        projects={PROJECTS}
        projectId="proj-1"
        onSelect={onSelect}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /영업 RFP 분석/ }));
    fireEvent.click(
      within(screen.getByTestId("project-picker-menu")).getByText(
        "프로젝트 없음",
      ),
    );

    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("UX-07: trigger 는 aria-haspopup=listbox 이며 열림/닫힘에 따라 aria-expanded 가 토글된다", () => {
    render(
      <ProjectPicker
        projects={PROJECTS}
        projectId={null}
        onSelect={() => {}}
      />,
    );
    const trigger = screen.getByTestId("project-picker-trigger");
    expect(trigger).toHaveAttribute("aria-haspopup", "listbox");
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("UX-01: 메뉴와 트리거 밖을 pointerdown 하면 메뉴가 닫힌다", () => {
    render(
      <div>
        <ProjectPicker
          projects={PROJECTS}
          projectId={null}
          onSelect={() => {}}
        />
        <button type="button">바깥</button>
      </div>,
    );
    fireEvent.click(screen.getByTestId("project-picker-trigger"));
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    fireEvent.pointerDown(screen.getByText("바깥"));

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("UX-03: Escape 시 메뉴가 닫히고 포커스가 트리거로 복귀한다", () => {
    render(
      <ProjectPicker
        projects={PROJECTS}
        projectId={null}
        onSelect={() => {}}
      />,
    );
    const trigger = screen.getByTestId("project-picker-trigger");
    fireEvent.click(trigger);
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });

  it("UX-06: 트리거에서 ArrowDown 으로 메뉴가 열리고 첫 옵션이 활성화되며, ArrowDown/Up/Home/End 로 옵션 사이를 이동한다", () => {
    render(
      <ProjectPicker
        projects={PROJECTS}
        projectId={null}
        onSelect={() => {}}
      />,
    );
    const trigger = screen.getByTestId("project-picker-trigger");
    fireEvent.keyDown(trigger, { key: "ArrowDown" });

    const listbox = screen.getByRole("listbox");
    const noneOption = screen.getByTestId("project-picker-item-none");
    const opt1 = screen.getByTestId("project-picker-item-proj-1");
    const opt2 = screen.getByTestId("project-picker-item-proj-2");

    expect(listbox).toHaveAttribute("aria-activedescendant", noneOption.id);

    fireEvent.keyDown(listbox, { key: "ArrowDown" });
    expect(listbox).toHaveAttribute("aria-activedescendant", opt1.id);

    fireEvent.keyDown(listbox, { key: "End" });
    expect(listbox).toHaveAttribute("aria-activedescendant", opt2.id);

    fireEvent.keyDown(listbox, { key: "ArrowUp" });
    expect(listbox).toHaveAttribute("aria-activedescendant", opt1.id);

    fireEvent.keyDown(listbox, { key: "Home" });
    expect(listbox).toHaveAttribute("aria-activedescendant", noneOption.id);
  });
});
