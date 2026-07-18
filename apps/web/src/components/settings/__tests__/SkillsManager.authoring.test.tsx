// @vitest-environment jsdom
// SkillsManager 작성/활성화/삭제 (P22-T6-18 · 계약배치 C12).
// Open WebUI Workspace > Tools/Functions 파리티 — 사용자가 SKILL.md 를 작성/업로드하고
// 활성화 토글·삭제까지 수행한다. 빌트인(파일시스템) 스킬은 불변이라 토글/삭제 UI 가 없다.
// 실 DOM 이벤트(fireEvent 클릭/입력)로 단언 — L1(유닛 green ≠ 실사용) 대응.
import React from "react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  waitFor,
  fireEvent,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { SkillsManager } from "../SkillsManager";

const BUILTIN = {
  id: "wchat-pptx@1.0.0",
  name: "wchat-pptx",
  version: "1.0.0",
  description: "브랜드 PPTX 생성 스킬입니다.",
  triggers: ["ppt"],
  entryPoint: "skills/wchat-pptx/scripts/build.py",
  permissions: "user" as const,
  source: "builtin" as const,
  enabled: true,
};

const MINE = {
  id: "my-report@1.0.0",
  name: "my-report",
  version: "1.0.0",
  description: "분기 실적 보고서를 자동 작성하는 사용자 스킬입니다.",
  triggers: ["보고서"],
  entryPoint: "scripts/build.py",
  permissions: "user" as const,
  source: "user" as const,
  enabled: true,
  skillId: "11111111-1111-1111-1111-111111111111",
};

const VALID_MD = `---
name: my-report
version: 1.0.0
description: 분기 실적 보고서를 자동 작성하는 사용자 스킬입니다.
entryPoint: scripts/build.py
---

# my-report
`;

/** 목록 GET 은 항상 rows 를, 변이(POST/PATCH/DELETE)는 ok 를 돌려주는 fetch 스텁. */
function stubFetch(rows: unknown[]) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const method = init?.method ?? "GET";
    if (method === "GET") {
      return { ok: true, status: 200, json: async () => ({ data: rows }) };
    }
    if (method === "DELETE") {
      return { ok: true, status: 204, json: async () => ({}) };
    }
    return {
      ok: true,
      status: method === "POST" ? 201 : 200,
      json: async () => ({ data: MINE }),
    };
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

describe("SkillsManager — 작성/활성화/삭제 (C12)", () => {
  beforeEach(() => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("＋ 스킬 작성 버튼으로 모달을 열고 SKILL.md 를 제출하면 POST /skills 를 호출한다", async () => {
    const calls = stubFetch([]);
    render(<SkillsManager />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /스킬 작성/ })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: /스킬 작성/ }));

    const dialog = await screen.findByRole("dialog", { name: "스킬 작성" });
    expect(dialog).toBeInTheDocument();

    const textarea = screen.getByLabelText("SKILL.md 내용");
    // 실제 change 이벤트로 입력(제어 컴포넌트 상태가 갱신되는지까지 단언).
    fireEvent.change(textarea, { target: { value: VALID_MD } });
    expect(textarea).toHaveValue(VALID_MD);

    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => {
      const post = calls.find((c) => c.init?.method === "POST");
      expect(post).toBeDefined();
      expect(post?.url).toContain("/api/v1/skills");
      expect(JSON.parse(String(post?.init?.body))).toEqual({
        skillMd: VALID_MD,
      });
    });
  });

  it("사용자 스킬만 활성화 토글을 갖고, 토글하면 PATCH 로 enabled 를 보낸다", async () => {
    const calls = stubFetch([BUILTIN, MINE]);
    render(<SkillsManager />);

    await waitFor(() => expect(screen.getByText("my-report")).toBeVisible());

    // 빌트인은 불변 — 토글이 없다.
    expect(
      screen.queryByRole("switch", { name: /wchat-pptx 활성화/ }),
    ).not.toBeInTheDocument();

    const toggle = screen.getByRole("switch", { name: /my-report 활성화/ });
    expect(toggle).toHaveAttribute("aria-checked", "true");

    fireEvent.click(toggle);

    await waitFor(() => {
      const patch = calls.find((c) => c.init?.method === "PATCH");
      expect(patch).toBeDefined();
      expect(patch?.url).toContain(`/api/v1/skills/${MINE.skillId}`);
      expect(JSON.parse(String(patch?.init?.body))).toEqual({ enabled: false });
    });
  });

  it("사용자 스킬 삭제 버튼은 확인 후 DELETE /skills/:id 를 호출한다", async () => {
    const calls = stubFetch([MINE]);
    render(<SkillsManager />);

    await waitFor(() => expect(screen.getByText("my-report")).toBeVisible());
    fireEvent.click(screen.getByRole("button", { name: /my-report 삭제/ }));

    await waitFor(() => {
      const del = calls.find((c) => c.init?.method === "DELETE");
      expect(del).toBeDefined();
      expect(del?.url).toContain(`/api/v1/skills/${MINE.skillId}`);
    });
  });

  it("빌트인 스킬에는 삭제 버튼이 없다(파일시스템 불변)", async () => {
    stubFetch([BUILTIN]);
    render(<SkillsManager />);

    await waitFor(() => expect(screen.getByText("wchat-pptx")).toBeVisible());
    expect(
      screen.queryByRole("button", { name: /wchat-pptx 삭제/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("기본 제공")).toBeInTheDocument();
  });

  it("비활성 스킬은 목록에 '비활성' 표시와 함께 남는다(관리 화면은 includeDisabled)", async () => {
    const calls = stubFetch([{ ...MINE, enabled: false }]);
    render(<SkillsManager />);

    await waitFor(() => expect(screen.getByText("my-report")).toBeVisible());
    expect(
      screen.getByRole("switch", { name: /my-report 활성화/ }),
    ).toHaveAttribute("aria-checked", "false");
    // 관리 화면은 비활성 항목까지 받아야 토글을 되돌릴 수 있다.
    expect(calls[0]?.url).toContain("includeDisabled=true");
  });

  it("서버가 400 을 주면 에러 메시지를 보여준다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if ((init?.method ?? "GET") === "GET") {
          return { ok: true, status: 200, json: async () => ({ data: [] }) };
        }
        return {
          ok: false,
          status: 400,
          json: async () => ({
            error: {
              message: "entryPoint 는 샌드박스 내부 상대경로여야 합니다",
            },
          }),
        };
      }),
    );
    render(<SkillsManager />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /스킬 작성/ })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: /스킬 작성/ }));
    const textarea = await screen.findByLabelText("SKILL.md 내용");
    fireEvent.change(textarea, { target: { value: VALID_MD } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() =>
      expect(
        screen.getByText(/샌드박스 내부 상대경로여야 합니다/),
      ).toBeInTheDocument(),
    );
  });
});
