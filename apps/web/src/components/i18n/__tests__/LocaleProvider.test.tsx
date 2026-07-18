// @vitest-environment jsdom
// components/i18n/LocaleProvider — P22-T6-15(계약배치 C11): 사용자별 UI 언어.
// Open WebUI 레퍼런스: 언어 선택이 즉시(리로드 없이) 반영되고 계정에 저장돼 재로그인 후에도 유지.
// 우리 배선: 초기 locale = GET /auth/me 의 user.language(BCP-47, null=ko),
//            변경 = PATCH /auth/me {language} + 낙관적 재렌더(실패 시 롤백).
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
import { LocaleProvider, useLocaleSetting } from "../LocaleProvider";
import { useTranslations } from "next-intl";

function stubMe(language: string | null, patchSpy?: (b: unknown) => void) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/auth/me") && init?.method === "PATCH") {
        patchSpy?.(JSON.parse(String(init.body)));
        return { ok: true, json: async () => ({ data: { language } }) };
      }
      if (url.includes("/auth/me")) {
        return {
          ok: true,
          json: async () => ({
            data: { user: { id: "u1", language }, org: null },
          }),
        };
      }
      return { ok: true, json: async () => ({ data: null }) };
    }),
  );
}

// 실제 소비 패턴 그대로: next-intl useTranslations 로 nav 라벨을 렌더하고
// useLocaleSetting 으로 언어를 바꾼다.
function Probe() {
  const t = useTranslations("nav");
  const { locale, setLocale } = useLocaleSetting();
  return (
    <div>
      <span data-testid="home-label">{t("home")}</span>
      <span data-testid="locale">{locale}</span>
      <button onClick={() => void setLocale("en")}>to-en</button>
    </div>
  );
}

describe("LocaleProvider", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("user.language 가 null 이면 기본 ko 카탈로그로 렌더한다", async () => {
    stubMe(null);
    render(
      <LocaleProvider>
        <Probe />
      </LocaleProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("locale")).toHaveTextContent("ko");
    });
    expect(screen.getByTestId("home-label")).toHaveTextContent("홈");
  });

  it("user.language='en' 이면 영어 카탈로그로 렌더하고 html lang 을 맞춘다(재로그인 후 유지)", async () => {
    stubMe("en");
    render(
      <LocaleProvider>
        <Probe />
      </LocaleProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("home-label")).toHaveTextContent("Home");
    });
    expect(document.documentElement.lang).toBe("en");
  });

  it("setLocale('en') 은 리로드 없이 즉시 재렌더하고 PATCH /auth/me 로 저장한다", async () => {
    const patchSpy = vi.fn();
    stubMe(null, patchSpy);
    render(
      <LocaleProvider>
        <Probe />
      </LocaleProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("home-label")).toHaveTextContent("홈");
    });

    fireEvent.click(screen.getByRole("button", { name: "to-en" }));

    // 리로드 없이 같은 React 트리가 영어로 다시 그려진다.
    await waitFor(() => {
      expect(screen.getByTestId("home-label")).toHaveTextContent("Home");
    });
    expect(patchSpy).toHaveBeenCalledWith({ language: "en" });
  });

  it("PATCH 실패 시 이전 언어로 롤백한다(낙관적 업데이트)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/auth/me") && init?.method === "PATCH") {
          return { ok: false, json: async () => ({ error: {} }) };
        }
        return {
          ok: true,
          json: async () => ({
            data: { user: { id: "u1", language: null }, org: null },
          }),
        };
      }),
    );
    render(
      <LocaleProvider>
        <Probe />
      </LocaleProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("home-label")).toHaveTextContent("홈");
    });

    fireEvent.click(screen.getByRole("button", { name: "to-en" }));

    await waitFor(() => {
      expect(screen.getByTestId("home-label")).toHaveTextContent("홈");
    });
    expect(screen.getByTestId("locale")).toHaveTextContent("ko");
  });
});
