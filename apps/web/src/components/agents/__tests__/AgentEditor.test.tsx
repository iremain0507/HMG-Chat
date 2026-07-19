// @vitest-environment jsdom
// components/agents/AgentEditor.tsx — P22-T6-10 에이전트 편집 슬라이드오버.
//   포커스 트랩(useFocusTrap) · Escape 닫기 + 포커스 복귀 · 빈 이름 저장 차단 검증.
import React, { useRef, useState } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  waitFor,
  fireEvent,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { AgentEditor } from "../AgentEditor";
import type { AgentDto, AgentInput } from "../../../hooks/useAgents";

const AGENT: AgentDto = {
  id: "agt-1",
  orgId: "org-1",
  name: "품질 분석가",
  description: "QMS 데이터를 분석한다",
  baseModel: "claude-sonnet-4-6",
  systemPrompt: "너는 품질 분석가다.",
  toolIds: ["web_search"],
  skillIds: ["skill-a"],
  projectIds: ["prj-1"],
  visibility: "org",
  createdBy: "user-1",
  createdAt: "2026-07-18T00:00:00.000Z",
  updatedAt: "2026-07-18T00:00:00.000Z",
};

// 실제 사용처(AgentGallery)처럼 트리거 버튼 → 슬라이드오버 마운트 구조를 재현해야
// useFocusTrap 의 "트리거로 포커스 복귀" 를 검증할 수 있다.
function Harness({
  agent,
  onSave = vi.fn(),
}: {
  agent?: AgentDto | null;
  onSave?: (input: AgentInput) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <div>
      <button
        type="button"
        ref={triggerRef}
        onClick={() => setOpen(true)}
        data-testid="open-editor"
      >
        편집기 열기
      </button>
      {open && (
        <AgentEditor
          agent={agent ?? null}
          onClose={() => setOpen(false)}
          onSave={onSave}
          restoreFocusRef={triggerRef}
        />
      )}
    </div>
  );
}

describe("AgentEditor", () => {
  afterEach(() => cleanup());

  it("role=dialog + aria-modal 슬라이드오버로 렌더된다", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId("open-editor"));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleName("에이전트 만들기");
  });

  it("편집 모드는 기존 값으로 필드를 프리필한다", async () => {
    render(<Harness agent={AGENT} />);
    fireEvent.click(screen.getByTestId("open-editor"));

    await screen.findByRole("dialog");
    expect(screen.getByLabelText("이름")).toHaveValue("품질 분석가");
    expect(screen.getByLabelText("설명")).toHaveValue("QMS 데이터를 분석한다");
    expect(screen.getByLabelText("기본 모델")).toHaveValue("claude-sonnet-4-6");
    expect(screen.getByLabelText("시스템 프롬프트")).toHaveValue(
      "너는 품질 분석가다.",
    );
    expect(screen.getByLabelText("도구 IDs")).toHaveValue("web_search");
    expect(screen.getByLabelText("스킬 IDs")).toHaveValue("skill-a");
    expect(screen.getByLabelText("프로젝트 IDs")).toHaveValue("prj-1");
    expect(screen.getByRole("button", { name: "조직" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("열리면 첫 포커스 가능 요소(이름 입력)로 포커스가 이동한다", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId("open-editor"));

    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByLabelText("이름"));
    });
  });

  it("마지막 요소에서 Tab 하면 첫 요소로 순환한다(포커스 트랩)", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId("open-editor"));
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByLabelText("이름"));
    });

    fireEvent.keyDown(document.activeElement as Element, {
      key: "Tab",
      shiftKey: true,
    });

    // Shift+Tab 은 첫 요소에서 마지막 요소로 순환한다 → 다이얼로그 밖으로 나가지 않는다.
    await waitFor(() => {
      const dialog = screen.getByRole("dialog");
      expect(dialog.contains(document.activeElement)).toBe(true);
    });
    expect(document.activeElement).not.toBe(screen.getByLabelText("이름"));
  });

  it("Escape 로 닫히고 트리거로 포커스가 복귀한다", async () => {
    render(<Harness />);
    const trigger = screen.getByTestId("open-editor");
    trigger.focus();
    fireEvent.click(trigger);
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByLabelText("이름"));
    });

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(document.activeElement).toBe(trigger);
  });

  it("취소 버튼으로도 닫힌다", async () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId("open-editor"));
    await screen.findByRole("dialog");

    fireEvent.click(screen.getByRole("button", { name: "취소" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("이름이 비어 있으면 저장 버튼이 비활성화되고 onSave 가 호출되지 않는다", async () => {
    const onSave = vi.fn();
    render(<Harness onSave={onSave} />);
    fireEvent.click(screen.getByTestId("open-editor"));
    await screen.findByRole("dialog");

    const save = screen.getByRole("button", { name: "저장" });
    expect(save).toBeDisabled();

    fireEvent.click(save);
    expect(onSave).not.toHaveBeenCalled();

    // 공백만 입력해도 여전히 차단된다.
    fireEvent.change(screen.getByLabelText("이름"), {
      target: { value: "  " },
    });
    expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();
  });

  it("입력값을 계약 형태(쉼표 구분 → 배열)로 onSave 에 전달한다", async () => {
    const onSave = vi.fn();
    render(<Harness onSave={onSave} />);
    fireEvent.click(screen.getByTestId("open-editor"));
    await screen.findByRole("dialog");

    fireEvent.change(screen.getByLabelText("이름"), {
      target: { value: "설비 진단" },
    });
    fireEvent.change(screen.getByLabelText("설명"), {
      target: { value: "설비 로그 진단" },
    });
    fireEvent.change(screen.getByLabelText("시스템 프롬프트"), {
      target: { value: "너는 설비 진단 전문가다." },
    });
    fireEvent.change(screen.getByLabelText("도구 IDs"), {
      target: { value: "web_search, code_interpreter" },
    });
    fireEvent.change(screen.getByLabelText("스킬 IDs"), {
      target: { value: "skill-a" },
    });
    fireEvent.change(screen.getByLabelText("프로젝트 IDs"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "비공개" }));

    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith({
      name: "설비 진단",
      baseModel: expect.any(String),
      description: "설비 로그 진단",
      systemPrompt: "너는 설비 진단 전문가다.",
      toolIds: ["web_search", "code_interpreter"],
      skillIds: ["skill-a"],
      projectIds: [],
      visibility: "private",
    });
  });
});
