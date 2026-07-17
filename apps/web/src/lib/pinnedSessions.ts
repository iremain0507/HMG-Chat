// lib/pinnedSessions.ts — 세션 고정 서버 영속 클라이언트 헬퍼(P19-T1-02 PATCH /:id/pin 소비).
//   이전 버전은 localStorage 전용(기기 간 미동기화)이었으나, sessions.pinned_at 컬럼이
//   추가돼 서버가 단일 출처가 됐다 — 토글 요청 후 서버가 반환한 최신 pinned 값을 그대로 쓴다.
import { apiFetch } from "./fetch-with-refresh";

export async function toggleSessionPin(id: string): Promise<boolean | null> {
  const res = await apiFetch(`/api/v1/sessions/${id}/pin`, {
    method: "PATCH",
    credentials: "include",
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { data: { id: string; pinned: boolean } };
  return body.data.pinned;
}
