// lib/session-title.ts — 세션 제목을 첫 사용자 메시지에서 파생한다(히스토리 목록 표시용).
//   제목이 없으면 사이드바가 전부 "(제목 없음)" 으로만 보여 "히스토리가 안 쌓인다" 는 오인을 준다.
export function deriveSessionTitle(content?: string | null): string | null {
  const oneLine = (content ?? "").replace(/\s+/g, " ").trim();
  if (!oneLine) return null;
  return oneLine.length > 40 ? oneLine.slice(0, 40) + "…" : oneLine;
}
