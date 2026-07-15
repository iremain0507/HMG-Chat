"use client";

// hooks/useShare.ts — 16-API-CONTRACT § 8 GET /api/v1/share/:token 소비.
// 익명 접근(authMiddleware 전 mount)이므로 credentials 를 첨부하지 않는다.
import { useCallback, useEffect, useState } from "react";

export interface ShareDto {
  token: string;
  artifactId: string;
  filename: string;
  type:
    "pptx" | "pdf" | "docx" | "xlsx" | "markdown" | "html" | "image" | "other";
  sizeBytes: number;
  mimeType: string;
  expiresAt: string;
  viewCount: number;
  revokedAt: string | null;
}

interface UseShareResult {
  share: ShareDto | null;
  loading: boolean;
  notFound: boolean;
  gone: boolean;
  error: string | null;
}

export function useShare(token: string): UseShareResult {
  const [share, setShare] = useState<ShareDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [gone, setGone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setNotFound(false);
    setGone(false);
    setError(null);
    try {
      const res = await fetch(`/api/v1/share/${token}`);
      if (res.status === 404) {
        setNotFound(true);
        return;
      }
      if (res.status === 410) {
        setGone(true);
        return;
      }
      if (!res.ok) {
        const body = (await res.json()) as { error?: { message?: string } };
        setError(body.error?.message ?? "공유 링크를 불러오지 못했습니다.");
        return;
      }
      const body = (await res.json()) as { data: ShareDto };
      setShare(body.data);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  return { share, loading, notFound, gone, error };
}
