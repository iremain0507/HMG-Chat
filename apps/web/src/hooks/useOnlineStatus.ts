"use client";

// hooks/useOnlineStatus.ts — P10-T6-17 에러/신뢰(§19.5 D4): window online/offline 이벤트를
// 구독해 오프라인 상태를 노출한다. ChatView 배너 + ChatInput 비활성화가 소비.
import { useEffect, useState } from "react";

export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );

  useEffect(() => {
    function goOnline() {
      setOnline(true);
    }
    function goOffline() {
      setOnline(false);
    }
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  return online;
}
