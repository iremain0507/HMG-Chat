"use client";

// components/ServiceWorkerRegister.tsx — P22-T6-07 PWA service-worker registrar.
//   Registers /sw.js (app-shell/offline cache) once on mount. Feature-detects
//   navigator.serviceWorker so SSR/jsdom/unsupported browsers are a silent no-op.
import { useEffect } from "react";

export function ServiceWorkerRegister(): null {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }
    // 등록 실패는 앱 동작에 치명적이지 않으므로 조용히 무시(콘솔 경고만).
    navigator.serviceWorker.register("/sw.js").catch((err: unknown) => {
       
      console.warn("[pwa] service worker 등록 실패", err);
    });
  }, []);

  return null;
}
