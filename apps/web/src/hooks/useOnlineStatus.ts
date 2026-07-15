"use client";

// hooks/useOnlineStatus.ts — P10-T6-17 에러/신뢰(§19.5 D4): window online/offline 이벤트를
// 구독해 오프라인 상태를 노출한다. ChatView 배너 + ChatInput 비활성화가 소비.
import { useEffect, useState } from "react";

export function useOnlineStatus(): boolean {
  // SSR + 초기 렌더는 항상 online 으로 시작해 hydration mismatch 방지.
  // (Node 21+ 는 navigator 전역이 존재하나 navigator.onLine 은 undefined → 서버가 offline 으로
  //  오판해 배너를 SSR 하면 클라이언트와 불일치. 실제 상태는 마운트 후 useEffect 에서 반영.)
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setOnline(navigator.onLine);
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
