"use client";

// hooks/useConversationShare.ts — P20-T1-08 대화 스냅샷 공유.
// GET /api/v1/conversation-shares/:token 소비. 익명 접근(authMiddleware 전 mount)이므로
// credentials 를 첨부하지 않는다. useShare.ts(아티팩트 공유) 와 동일한 loading/notFound/gone
// 상태 패턴을 따른다.
import { useCallback, useEffect, useState } from "react";

export interface ConversationShareMessageDto {
  id: string;
  role: string;
  content: unknown;
  createdAt: string;
}

export interface ConversationShareDto {
  token: string;
  sessionId: string;
  title: string | null;
  capturedAt: string;
  messages: ConversationShareMessageDto[];
  revokedAt: string | null;
}

export type ConversationShareGoneReason = "expired" | "revoked";

interface UseConversationShareResult {
  share: ConversationShareDto | null;
  loading: boolean;
  notFound: boolean;
  gone: boolean;
  // 410 응답의 원인(만료 vs 취소). 구버전 서버는 null(구분 불가).
  goneReason: ConversationShareGoneReason | null;
  error: string | null;
}

export function useConversationShare(
  token: string,
): UseConversationShareResult {
  const [share, setShare] = useState<ConversationShareDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [gone, setGone] = useState(false);
  const [goneReason, setGoneReason] =
    useState<ConversationShareGoneReason | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setNotFound(false);
    setGone(false);
    setGoneReason(null);
    setError(null);
    try {
      const res = await fetch(`/api/v1/conversation-shares/${token}`);
      if (res.status === 404) {
        setNotFound(true);
        return;
      }
      if (res.status === 410) {
        setGone(true);
        const body = (await res.json().catch(() => ({}))) as {
          error?: { reason?: string };
        };
        setGoneReason(
          body.error?.reason === "expired" || body.error?.reason === "revoked"
            ? body.error.reason
            : null,
        );
        return;
      }
      if (!res.ok) {
        const body = (await res.json()) as { error?: { message?: string } };
        setError(body.error?.message ?? "공유 링크를 불러오지 못했습니다.");
        return;
      }
      const body = (await res.json()) as { data: ConversationShareDto };
      setShare(body.data);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  return { share, loading, notFound, gone, goneReason, error };
}
