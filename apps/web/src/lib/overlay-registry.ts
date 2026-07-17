// lib/overlay-registry.ts — P21-T6-02: 단일-오픈 오버레이 조정자.
// 모듈 store: 한 번에 하나의 오버레이만 open 상태를 유지한다. 새 오버레이가 open 되면
// 이전에 열려있던 오버레이의 close 콜백을 호출한다(세션 우클릭 메뉴 동시-오픈 시드버그 근본원인).
interface OpenOverlay {
  id: string;
  close: () => void;
}

let current: OpenOverlay | null = null;

export function openOverlay(id: string, close: () => void): void {
  if (current && current.id !== id) {
    current.close();
  }
  current = { id, close };
}

export function closeOverlay(id: string): void {
  if (current?.id === id) {
    current = null;
  }
}

export function resetOverlayRegistry(): void {
  current = null;
}
