"use client";

// hooks/useDocuments.ts — 16-API-CONTRACT § 5 Project Documents 소비.
// P4-T3-08 라우트가 업로드→파싱→청킹→임베딩을 동기(dev-stub)로 처리해 POST 응답에
// 이미 최종 indexStatus 가 담겨 있으므로, 별도 폴링/SSE 없이 업로드 후 목록만 재조회한다.
import { useCallback, useEffect, useState } from "react";

export interface ProjectDocumentDto {
  id: string;
  projectId: string;
  filename: string;
  contentHash: string;
  mimeType: string;
  sizeBytes: number;
  indexStatus:
    "pending" | "parsing" | "chunking" | "embedding" | "indexed" | "failed";
  chunkCount: number;
  indexedAt: string | null;
  failureReason: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

interface UseDocumentsResult {
  documents: ProjectDocumentDto[];
  loading: boolean;
  uploading: boolean;
  error: string | null;
  upload(file: File): Promise<void>;
}

export function useDocuments(projectId: string): UseDocumentsResult {
  const [documents, setDocuments] = useState<ProjectDocumentDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/documents?projectId=${projectId}`, {
        credentials: "include",
      });
      if (!res.ok) {
        setError("문서 목록을 불러오지 못했습니다.");
        return;
      }
      const body = (await res.json()) as { data: ProjectDocumentDto[] };
      setDocuments(body.data);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const upload = useCallback(
    async (file: File) => {
      setUploading(true);
      setError(null);
      try {
        const form = new FormData();
        form.append("projectId", projectId);
        form.append("file", file);
        const res = await fetch("/api/v1/documents", {
          method: "POST",
          credentials: "include",
          body: form,
        });
        if (!res.ok) {
          const body = (await res.json()) as {
            error?: { message?: string };
          };
          setError(body.error?.message ?? "업로드에 실패했습니다.");
          return;
        }
        await load();
      } finally {
        setUploading(false);
      }
    },
    [projectId, load],
  );

  return { documents, loading, uploading, error, upload };
}
