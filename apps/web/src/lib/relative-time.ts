// lib/relative-time.ts — 홈(F03) 최근 세션 상대시각. now 를 인자로 받아 순수함수로 유지
// (호출부가 Date.now() 를 넘겨 결정론적 테스트 가능).
export function formatRelativeTime(iso: string | null, now: number): string {
  if (!iso) return "";
  const diffMs = now - new Date(iso).getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "방금 전";
  if (diffMin < 60) return `${diffMin}분 전`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}시간 전`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 2) return "어제";
  return `${diffDay}일 전`;
}
