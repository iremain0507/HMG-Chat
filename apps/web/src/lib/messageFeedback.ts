// lib/messageFeedback.ts — 메시지 평가(👍/👎) 클라이언트 헬퍼(P19-T1-07
//   POST /api/v1/sessions/:id/messages/:messageId/feedback 소비). 같은 rating 을
//   다시 보내면 서버가 토글 취소(rating:null)하므로 응답 값을 그대로 신뢰한다.
import { apiFetch } from "./fetch-with-refresh";

export async function sendMessageFeedback(
  sessionId: string,
  messageId: string,
  rating: 1 | -1,
): Promise<number | null | undefined> {
  const res = await apiFetch(
    `/api/v1/sessions/${sessionId}/messages/${messageId}/feedback`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rating }),
    },
  );
  if (!res.ok) return undefined;
  const body = (await res.json()) as { data: { rating: number | null } };
  return body.data.rating;
}
