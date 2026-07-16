"use client";

// components/layout/ThemeToggle.tsx — 19-UIUX-UPGRADE.md § P10-T6-01
// data-theme 를 document.documentElement 에 스탬프해 prefers-color-scheme 를 양방향 override.
import React, { useEffect, useState } from "react";

type Theme = "light" | "dark";

const STORAGE_KEY = "wchat-theme";

function getSystemTheme(): Theme {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return "light";
  }
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  } catch {
    return "light";
  }
}

function readStoredTheme(): Theme | null {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : null;
  } catch {
    return null;
  }
}

function writeStoredTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // 프라이빗 브라우징 등 localStorage 미가용 환경 — 세션 내 토글만 유지.
  }
}

export function ThemeToggle({
  testId = "theme-toggle",
}: {
  testId?: string;
} = {}) {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const initial = readStoredTheme() ?? getSystemTheme();
    setTheme(initial);
    document.documentElement.setAttribute("data-theme", initial);
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    writeStoredTheme(next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="테마 전환"
      title="테마 전환"
      aria-pressed={theme === "dark"}
      data-testid={testId}
      className="rounded-md border border-border px-2 py-1 text-sm text-fg-muted hover:border-primary hover:text-fg"
    >
      {theme === "dark" ? "🌙" : "☀️"}
    </button>
  );
}
