// 홈 컴포저 → 채팅 자동전송 브릿지.
// 홈에서 질문을 입력하고 Enter 하면 새 세션 id 로 이동하는데, 그 첫 메시지를 여기에 담아두고
// ChatView 가 마운트 시 1회 소비(take)해 자동전송한다. draftKey(prefill, 빠른시작용)와 분리 —
// pending 은 "즉시 전송" 의도, draft 는 "채워만 두기" 의도.

export function pendingMessageKey(sessionId: string): string {
  return `wchat:pending:${sessionId}`;
}

/** 홈에서 첫 메시지를 예약한다(best-effort — Storage 불가 시 조용히 무시). */
export function setPendingMessage(sessionId: string, text: string): void {
  try {
    sessionStorage.setItem(pendingMessageKey(sessionId), text);
  } catch {
    /* sessionStorage 접근 불가(프라이빗 모드 등) */
  }
}

/** 예약된 첫 메시지를 제거하지 않고 읽기만 한다. 없으면 null.
 *  React strict-mode(dev) 의 mount→cleanup→mount 이중 실행에서, 첫 pass 가 곧바로 take(소비)
 *  하면 그 pass 의 자동전송 POST 가 언마운트 정리(abort)로 취소된 뒤 재-mount 때는 값이 없어
 *  재전송되지 않는다. 그래서 소비는 실제 전송 직전으로 미루고, 여기서는 존재 여부만 확인한다. */
export function peekPendingMessage(sessionId: string): string | null {
  try {
    return sessionStorage.getItem(pendingMessageKey(sessionId));
  } catch {
    return null;
  }
}

/** 예약된 첫 메시지를 꺼내며 즉시 제거한다(소비형 — 중복 자동전송 방지). 없으면 null. */
export function takePendingMessage(sessionId: string): string | null {
  try {
    const key = pendingMessageKey(sessionId);
    const value = sessionStorage.getItem(key);
    if (value != null) sessionStorage.removeItem(key);
    return value;
  } catch {
    return null;
  }
}
