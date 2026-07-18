"use client";

// hooks/useAttachments.ts — 16-API-CONTRACT § 6 Uploads(POST /uploads multipart) 소비.
// 컴포저(ChatInput)의 첨부 칩 상태(업로드 중/완료/실패)를 관리하고, 전송 시 messages
// 라우트가 기대하는 attachments:[{uploadId}] (P10-T2-06) 형태를 readyUploadIds 로 제공한다.
import { useCallback, useState } from "react";
import { apiFetch } from "../lib/fetch-with-refresh";
import { randomUUID } from "../lib/uuid";

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

// P22-T6-04 — 멀티모달 채팅 파리티(Open WebUI 참조): 이미지 첨부는 파일명 칩이 아니라
// 실제 썸네일로 보여준다. 브라우저 objectURL 로 미리보기 URL 을 만들어 칩·전송 버블에서
// <img> 로 렌더한다(제거/클리어 시 revoke 로 누수 방지).
function isImageType(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}

// 이미지면 blob: objectURL 을 만든다. SSR/테스트(jsdom)처럼 URL.createObjectURL 이
// 없는 환경에서는 undefined 로 폴백(썸네일만 생략, 업로드/전송은 정상 동작).
function makePreviewUrl(file: File): string | undefined {
  if (!isImageType(file.type)) return undefined;
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
    return undefined;
  }
  return URL.createObjectURL(file);
}

function revokePreviewUrl(previewUrl: string | undefined): void {
  if (!previewUrl) return;
  if (typeof URL === "undefined" || typeof URL.revokeObjectURL !== "function") {
    return;
  }
  URL.revokeObjectURL(previewUrl);
}

export interface AttachmentItem {
  localId: string;
  uploadId: string | null;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  status: "uploading" | "done" | "error";
  error?: string;
  // 이미지일 때만 채워지는 클라이언트측 미리보기 objectURL(blob:). 비이미지는 undefined.
  previewUrl?: string;
}

// 전송(onSend)·낙관적 버블에서 쓰는 첨부 메타. 서버 요청 body 에는 uploadId 만 실린다.
export interface ReadyAttachment {
  uploadId: string;
  filename: string;
  mimeType: string;
  previewUrl?: string;
}

export function useAttachments(sessionId: string) {
  const [items, setItems] = useState<AttachmentItem[]>([]);

  const uploadOne = useCallback(
    async (localId: string, file: File) => {
      try {
        const form = new FormData();
        form.append("file", file);
        form.append("sessionId", sessionId);
        const res = await apiFetch("/api/v1/uploads", {
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
        const localId = randomUUID();
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
        const previewUrl = makePreviewUrl(file);
        setItems((prev) => [
          ...prev,
          {
            localId,
            uploadId: null,
            filename: file.name,
            mimeType: file.type,
            sizeBytes: file.size,
            status: "uploading",
            ...(previewUrl ? { previewUrl } : {}),
          },
        ]);
        void uploadOne(localId, file);
      }
    },
    [uploadOne],
  );

  const remove = useCallback((localId: string) => {
    setItems((prev) => {
      const target = prev.find((it) => it.localId === localId);
      revokePreviewUrl(target?.previewUrl);
      return prev.filter((it) => it.localId !== localId);
    });
  }, []);

  const clear = useCallback(() => {
    // clear 는 전송(submit) 시에만 호출된다 — 이때 이미지 previewUrl 의 소유권은 낙관적
    // 유저 버블(StreamMessage.attachments)로 넘어가므로 revoke 하지 않는다(revoke 하면
    // 방금 보낸 버블의 <img src="blob:…"> 가 깨진다). 수동 remove 만 revoke 한다.
    setItems([]);
  }, []);

  const readyUploadIds = items
    .filter((it) => it.status === "done" && it.uploadId)
    .map((it) => ({ uploadId: it.uploadId! }));

  // P22-T6-04 — 전송 시 낙관적 유저 버블에 이미지 썸네일을 그리기 위해 filename/mimeType/
  // previewUrl 까지 함께 넘긴다(서버 body 에는 useSessionStream 이 uploadId 만 추린다).
  const readyAttachments: ReadyAttachment[] = items
    .filter((it) => it.status === "done" && it.uploadId)
    .map((it) => ({
      uploadId: it.uploadId!,
      filename: it.filename,
      mimeType: it.mimeType,
      ...(it.previewUrl ? { previewUrl: it.previewUrl } : {}),
    }));

  return {
    items,
    addFiles,
    remove,
    clear,
    readyUploadIds,
    readyAttachments,
  };
}
