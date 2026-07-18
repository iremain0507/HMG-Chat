"use client";

// components/InstallPwaButton.tsx — P22-T6-07 PWA install affordance.
//   Open WebUI reference flow: an "install app" control appears only when the
//   browser deems the app installable (beforeinstallprompt fired), and clicking
//   it triggers the native install prompt. Hidden after install (appinstalled).
//   시각 스타일은 apps/web/DESIGN.md 시맨틱 토큰(현대위아 CI) — 하드코딩 hex 없음.
import React, { useEffect, useState } from "react";
import { Download } from "lucide-react";

// beforeinstallprompt 는 아직 표준 타입에 없어 로컬 타입으로 좁힌다.
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function InstallPwaButton() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(
    null,
  );

  useEffect(() => {
    const onBeforeInstall = (e: Event) => {
      // 크롬 미니인포바 자동 노출을 막고, 우리 버튼 클릭 시점까지 이벤트 보관.
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setDeferred(null);

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!deferred) return null;

  const handleClick = async () => {
    await deferred.prompt();
    // 프롬프트는 1회용 — 결과와 무관하게 소진 후 버튼 숨김.
    try {
      await deferred.userChoice;
    } finally {
      setDeferred(null);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label="앱 설치"
      title="앱 설치"
      data-testid="install-pwa-button"
      className="inline-flex h-7 items-center gap-1.5 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-fg outline-none hover:bg-primary-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)] focus-visible:outline-offset-2"
    >
      <Download className="h-4 w-4" aria-hidden="true" />앱 설치
    </button>
  );
}
