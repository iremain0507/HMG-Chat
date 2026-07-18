// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  THEME_INIT_SCRIPT,
  THEME_STORAGE_KEY,
  applyInitialTheme,
  resolveInitialTheme,
} from "../theme-init";

// 이 web 테스트 환경(Node 실험적 localStorage, 파일 경로 미지정)은 localStorage 가 비작동이라
// in-memory 로 스텁한다(다른 테스트들도 window.localStorage 접근을 try/catch 로 회피).
function stubLocalStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => store.set(k, String(v)),
    removeItem: (k: string) => store.delete(k),
    clear: () => store.clear(),
  });
}

function setSystemDark(dark: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((q: string) => ({
      matches: dark && q.includes("dark"),
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  );
}

beforeEach(() => {
  stubLocalStorage();
});

afterEach(() => {
  document.documentElement.removeAttribute("data-theme");
  vi.unstubAllGlobals();
});

describe("theme-init (pre-hydration, no FOUC)", () => {
  it("저장된 'light' 를 그대로 해석한다(시스템이 dark 여도)", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    setSystemDark(true);
    expect(resolveInitialTheme()).toBe("light");
  });

  it("저장된 'dark' 를 그대로 해석한다", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    setSystemDark(false);
    expect(resolveInitialTheme()).toBe("dark");
  });

  it("저장값 없으면 시스템 prefers-color-scheme(dark) 를 따른다", () => {
    setSystemDark(true);
    expect(resolveInitialTheme()).toBe("dark");
  });

  it("저장값 없고 시스템 light 면 light", () => {
    setSystemDark(false);
    expect(resolveInitialTheme()).toBe("light");
  });

  it("applyInitialTheme 은 <html> 에 data-theme 를 즉시 스탬프한다(저장 'dark')", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    applyInitialTheme();
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("인라인 스크립트(THEME_INIT_SCRIPT)를 실행하면 저장 테마가 data-theme 로 스탬프된다", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    setSystemDark(true); // 시스템은 dark 지만 저장이 light → light 로 스탬프(뒤집힘 방지)
     
    eval(THEME_INIT_SCRIPT);
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });
});
