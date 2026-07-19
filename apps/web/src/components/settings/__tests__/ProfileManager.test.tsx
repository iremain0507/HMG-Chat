// @vitest-environment jsdom
// components/settings/ProfileManager.tsx — P16-T6-05(갭7): /settings/profile 이 없어
// name·customInstructions 를 사용자가 직접 수정할 표면이 없던 문제 해소. PATCH /auth/me
// (16-API-CONTRACT §1) 배선.
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
import { ProfileManager } from "../ProfileManager";
import { LocaleProvider } from "../../i18n/LocaleProvider";

// P22-T6-15(C11): 라벨이 settings.profile.* 카탈로그에서 오고 언어 선택기가
// useLocaleSetting 을 쓰므로 LocaleProvider 가 필요하다. 로케일을 ko 로 고정해
// 기존 한국어 단언을 그대로 유지하고, 초기 /auth/me 조회는 건너뛴다.
function renderProfileManager() {
  return render(
    <LocaleProvider initialLocale="ko">
      <ProfileManager />
    </LocaleProvider>,
  );
}

function stubFetch(patchSpy?: (body: unknown) => void) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (
        url.includes("/api/v1/auth/me") &&
        (!init || init.method === undefined)
      ) {
        return {
          ok: true,
          json: async () => ({
            data: {
              user: {
                id: "user-1",
                email: "a@b.com",
                name: "김민수",
                orgId: "org-1",
                role: "member",
                customInstructions: "항상 한국어로 답해줘",
                createdAt: "2026-01-01T00:00:00Z",
              },
              org: null,
            },
          }),
        };
      }
      if (url.includes("/api/v1/auth/me") && init?.method === "PATCH") {
        patchSpy?.(JSON.parse(String(init.body)));
        return {
          ok: true,
          json: async () => ({
            data: {
              id: "user-1",
              email: "a@b.com",
              name: "김민수 수정",
              orgId: "org-1",
              role: "member",
              customInstructions: "항상 한국어로 답해줘",
              createdAt: "2026-01-01T00:00:00Z",
            },
          }),
        };
      }
      return { ok: true, json: async () => ({ data: null }) };
    }),
  );
}

describe("ProfileManager", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("현재 이름과 커스텀 지침을 불러와 폼에 채운다", async () => {
    stubFetch();
    renderProfileManager();

    await waitFor(() => {
      expect(screen.getByLabelText("이름")).toHaveValue("김민수");
    });
    expect(screen.getByLabelText("커스텀 지침")).toHaveValue(
      "항상 한국어로 답해줘",
    );
  });

  it("저장 시 PATCH /auth/me 로 name·customInstructions 를 전송한다", async () => {
    const patchSpy = vi.fn();
    stubFetch(patchSpy);
    renderProfileManager();

    await waitFor(() => {
      expect(screen.getByLabelText("이름")).toHaveValue("김민수");
    });

    fireEvent.change(screen.getByLabelText("이름"), {
      target: { value: "김민수 수정" },
    });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => {
      expect(patchSpy).toHaveBeenCalledWith({
        name: "김민수 수정",
        customInstructions: "항상 한국어로 답해줘",
      });
    });
  });
});
