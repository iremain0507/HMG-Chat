// 테마 초기화 — pre-hydration FOUC 방지.
// ThemeToggle 은 useEffect(하이드레이션 후)에서만 data-theme 를 스탬프하므로, 첫 페인트가
// CSS prefers-color-scheme 폴백으로 그려진 뒤 저장 테마로 뒤집힌다. layout.tsx <body> 최상단에
// THEME_INIT_SCRIPT 를 동기 실행해 페인트 전에 data-theme 를 확정한다(단일 출처 키 = ThemeToggle 과 동일).

export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "wchat-theme";

/** 저장 테마 우선, 없으면 시스템 prefers-color-scheme, 그것도 없으면 light. */
export function resolveInitialTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    /* localStorage 접근 불가(프라이빗 모드 등) → 시스템/기본값으로 폴백 */
  }
  try {
    if (
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
    ) {
      return "dark";
    }
  } catch {
    /* matchMedia 불가 → light */
  }
  return "light";
}

/** <html> 에 data-theme 를 즉시 스탬프(첫 페인트 전에 호출되어야 FOUC 없음). */
export function applyInitialTheme(): void {
  document.documentElement.setAttribute("data-theme", resolveInitialTheme());
}

// layout <body> 최상단에 dangerouslySetInnerHTML 로 주입되는 자기완결 IIFE(문자열).
// 번들/import 불가 컨텍스트에서 동기 실행되므로 위 함수와 로직을 중복 유지하되 키는 동일해야 한다.
// (theme-init.test.ts 가 이 문자열을 eval 해 저장 테마 스탬프를 회귀 방지.)
export const THEME_INIT_SCRIPT = `(function(){try{var k='${THEME_STORAGE_KEY}';var t=null;try{t=localStorage.getItem(k);}catch(e){}if(t!=='light'&&t!=='dark'){t='light';try{if(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches)t='dark';}catch(e){}}document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;
