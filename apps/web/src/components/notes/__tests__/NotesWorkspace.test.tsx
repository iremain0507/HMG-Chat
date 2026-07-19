// @vitest-environment jsdom
// components/notes/NotesWorkspace.tsx — P22-T6-17.
//   실제 DOM 이벤트로 편집→저장 / AI 개선 / 채팅 주입 / 삭제를 단언한다(21-LOOP-LESSONS L1).
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import {
  render,
  screen,
  cleanup,
  waitFor,
  fireEvent,
} from "@testing-library/react";
import { NotesWorkspace } from "../NotesWorkspace";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

const NOTE_ID = "11111111-2222-3333-4444-555555555555";
vi.mock("../../../lib/uuid", () => ({
  randomUUID: () => "11111111-2222-3333-4444-555555555555",
}));

const NOTE_1 = {
  id: "note-1",
  orgId: "org-1",
  userId: "user-1",
  title: "설비 점검 메모",
  content: "# 점검\n\n- 항목 1",
  createdAt: "2026-07-18T00:00:00.000Z",
  updatedAt: "2026-07-18T00:00:00.000Z",
};

/** GET 은 목록, 그 외 메서드는 respond 가 결정한다. */
function stubFetch(
  respond: (
    url: string,
    method: string,
  ) => { ok: boolean; body: unknown } | null = () => null,
) {
  const mock = vi.fn(async (url: string, init?: { method?: string }) => {
    const method = init?.method ?? "GET";
    const custom = respond(url, method);
    if (custom) {
      return { ok: custom.ok, json: async () => custom.body };
    }
    return { ok: true, json: async () => ({ data: [NOTE_1] }) };
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

/** 첫 노트가 자동 선택돼 에디터가 채워질 때까지 기다린다. */
async function waitForEditor() {
  await waitFor(() =>
    expect(screen.getByLabelText("노트 제목")).toHaveValue("설비 점검 메모"),
  );
}

function methodOf(init: unknown): string | undefined {
  return (init as { method?: string } | undefined)?.method;
}

describe("NotesWorkspace", () => {
  beforeEach(() => {
    push.mockClear();
    window.sessionStorage.clear();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("목록의 첫 노트를 자동 선택해 에디터에 본문을 채운다", async () => {
    stubFetch();
    render(<NotesWorkspace />);

    await waitForEditor();
    expect(screen.getByLabelText("노트 본문(마크다운)")).toHaveValue(
      "# 점검\n\n- 항목 1",
    );
  });

  it("본문을 편집하면 '저장 안 됨' 배지가 뜨고 저장하면 PATCH 가 나간다", async () => {
    const mock = stubFetch();
    render(<NotesWorkspace />);
    await waitForEditor();

    // 저장 버튼은 변경 전에는 비활성(불필요한 PATCH 방지).
    expect(screen.getByTestId("note-save")).toBeDisabled();

    fireEvent.change(screen.getByLabelText("노트 본문(마크다운)"), {
      target: { value: "# 점검\n\n- 항목 1\n- 항목 2" },
    });
    expect(screen.getByTestId("note-dirty")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("note-save"));

    await waitFor(() => {
      const patch = mock.mock.calls.find(
        ([, init]) => methodOf(init) === "PATCH",
      );
      expect(patch?.[0]).toBe("/api/v1/notes/note-1");
      expect((patch?.[1] as { body: string }).body).toContain("항목 2");
    });
    // 저장 후 dirty 해제.
    await waitFor(() =>
      expect(screen.queryByTestId("note-dirty")).not.toBeInTheDocument(),
    );
  });

  it("AI 개선을 누르면 enhance 결과가 에디터 본문을 교체한다", async () => {
    stubFetch((url, method) =>
      method === "POST" && url.endsWith("/enhance")
        ? { ok: true, body: { data: { ...NOTE_1, content: "# 개선본" } } }
        : null,
    );
    render(<NotesWorkspace />);
    await waitForEditor();

    fireEvent.click(screen.getByTestId("note-enhance"));

    await waitFor(() =>
      expect(screen.getByLabelText("노트 본문(마크다운)")).toHaveValue(
        "# 개선본",
      ),
    );
  });

  it("AI 개선이 실패하면 본문을 건드리지 않고 오류를 노출한다", async () => {
    stubFetch((url, method) =>
      method === "POST" && url.endsWith("/enhance")
        ? { ok: false, body: { error: { message: "AI 개선에 실패했습니다." } } }
        : null,
    );
    render(<NotesWorkspace />);
    await waitForEditor();

    fireEvent.click(screen.getByTestId("note-enhance"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "AI 개선에 실패했습니다.",
    );
    expect(screen.getByLabelText("노트 본문(마크다운)")).toHaveValue(
      "# 점검\n\n- 항목 1",
    );
  });

  it("채팅에 주입하면 새 세션 draft 에 본문을 심고 /chat 으로 이동한다", async () => {
    stubFetch();
    render(<NotesWorkspace />);
    await waitForEditor();

    fireEvent.click(screen.getByTestId("note-send-to-chat"));

    const draft = window.sessionStorage.getItem(`wchat:draft:${NOTE_ID}`);
    expect(draft).toContain("설비 점검 메모");
    expect(draft).toContain("# 점검");
    expect(push).toHaveBeenCalledWith(`/chat/${NOTE_ID}`);
  });

  it("삭제는 확인을 거친 뒤에만 DELETE 를 보낸다", async () => {
    const mock = stubFetch((url, method) =>
      method === "DELETE" ? { ok: true, body: {} } : null,
    );
    render(<NotesWorkspace />);
    await waitForEditor();

    fireEvent.click(screen.getByTestId("note-delete"));
    // 확인 전에는 DELETE 가 나가지 않는다.
    expect(
      mock.mock.calls.some(([, init]) => methodOf(init) === "DELETE"),
    ).toBe(false);

    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("note-delete-confirm"));

    await waitFor(() => {
      const del = mock.mock.calls.find(
        ([, init]) => methodOf(init) === "DELETE",
      );
      expect(del?.[0]).toBe("/api/v1/notes/note-1");
    });
  });
});
