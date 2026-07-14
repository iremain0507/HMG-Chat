"use client";

// hooks/useAttachments.ts — 16-API-CONTRACT § 6 Uploads(POST /uploads multipart) 소비.
// 컴포저(ChatInput)의 첨부 칩 상태(업로드 중/완료/실패)를 관리하고, 전송 시 messages
// 라우트가 기대하는 attachments:[{uploadId}] (P10-T2-06) 형태를 readyUploadIds 로 제공한다.
import { useCallback, useState } from "react";

const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20MB
const ACCEPTED_MIME_PREFIXES = ["image/"];
const ACCEPTED_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/markdown",
  "text/plain",
]);

function isAcceptedType(mimeType: string): boolean {
  if (ACCEPTED_MIME_PREFIXES.some((prefix) => mimeType.startsWith(prefix))) {
    return true;
  }
  return ACCEPTED_MIME_TYPES.has(mimeType);
}

export interface AttachmentItem {
  localId: string;
  uploadId: string | null;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  status: "uploading" | "done" | "error";
  error?: string;
}

export function useAttachments(sessionId: string) {
  const [items, setItems] = useState<AttachmentItem[]>([]);

  const uploadOne = useCallback(
    async (localId: string, file: File) => {
      try {
        const form = new FormData();
        form.append("file", file);
        form.append("sessionId", sessionId);
        const res = await fetch("/api/v1/uploads", {
          method: "POST",
          credentials: "include",
          body: form,
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: { message?: string };
          };
          setItems((prev) =>
            prev.map((it) =>
              it.localId === localId
                ? {
                    ...it,
                    status: "error",
                    error: body.error?.message ?? "업로드에 실패했습니다.",
                  }
                : it,
            ),
          );
          return;
        }
        const body = (await res.json()) as {
          data: { id: string; filename: string };
        };
        setItems((prev) =>
          prev.map((it) =>
            it.localId === localId
              ? {
                  ...it,
                  status: "done",
                  uploadId: body.data.id,
                  filename: body.data.filename,
                }
              : it,
          ),
        );
      } catch {
        setItems((prev) =>
          prev.map((it) =>
            it.localId === localId
              ? { ...it, status: "error", error: "업로드에 실패했습니다." }
              : it,
          ),
        );
      }
    },
    [sessionId],
  );

  const addFiles = useCallback(
    (files: File[]) => {
      for (const file of files) {
        const localId = crypto.randomUUID();
        if (file.size > MAX_FILE_BYTES) {
          setItems((prev) => [
            ...prev,
            {
              localId,
              uploadId: null,
              filename: file.name,
              mimeType: file.type,
              sizeBytes: file.size,
              status: "error",
              error: "파일이 너무 큽니다 (최대 20MB).",
            },
          ]);
          continue;
        }
        if (!isAcceptedType(file.type)) {
          setItems((prev) => [
            ...prev,
            {
              localId,
              uploadId: null,
              filename: file.name,
              mimeType: file.type,
              sizeBytes: file.size,
              status: "error",
              error: "지원하지 않는 파일 형식입니다.",
            },
          ]);
          continue;
        }
        setItems((prev) => [
          ...prev,
          {
            localId,
            uploadId: null,
            filename: file.name,
            mimeType: file.type,
            sizeBytes: file.size,
            status: "uploading",
          },
        ]);
        void uploadOne(localId, file);
      }
    },
    [uploadOne],
  );

  const remove = useCallback((localId: string) => {
    setItems((prev) => prev.filter((it) => it.localId !== localId));
  }, []);

  const clear = useCallback(() => {
    setItems([]);
  }, []);

  const readyUploadIds = items
    .filter((it) => it.status === "done" && it.uploadId)
    .map((it) => ({ uploadId: it.uploadId! }));

  return { items, addFiles, remove, clear, readyUploadIds };
}
