"use client";

// components/projects/DocumentsPanel.tsx — design-reference F09(프로젝트 상세 — 지식(RAG))
// 문서 인덱싱 상태 테이블 핸드오프 정렬(P13-T6-10). 업로드(파일 선택 → multipart POST) +
// indexStatus 를 StatusChip 5종 공용 어휘(§3.2 상태 어휘 단일화)로 표시한다.
// P4-T3-08 라우트가 동기(dev-stub)로 최종 상태를 즉시 반환하므로 pending/parsing/chunking/
// embedding 은 이 dev-stub 환경에서 실제로 관측되진 않지만, 14-INTERFACES 의 indexStatus
// 전체 5종을 다루도록 렌더 분기는 유지한다(추후 비동기 큐 도입 시 그대로 동작).
import React, { useRef } from "react";
import { FileText, Plus, Trash2 } from "lucide-react";
import {
  useDocuments,
  type ProjectDocumentDto,
} from "../../hooks/useDocuments";
import { StatusChip, type StatusChipStatus } from "../chat/StatusChip";

const STATUS_CHIP: Record<
  ProjectDocumentDto["indexStatus"],
  { status: StatusChipStatus; label: string }
> = {
  pending: { status: "queued", label: "대기" },
  parsing: { status: "running", label: "파싱중" },
  chunking: { status: "running", label: "청킹중" },
  embedding: { status: "running", label: "임베딩중" },
  indexed: { status: "done", label: "인덱스 완료" },
  failed: { status: "error", label: "실패" },
};

const IN_PROGRESS: ProjectDocumentDto["indexStatus"][] = [
  "parsing",
  "chunking",
  "embedding",
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)}KB`;
  return `${(kb / 1024).toFixed(1)}MB`;
}

function formatUploadDate(iso: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
  }).format(new Date(iso));
}

export function DocumentsPanel({ projectId }: { projectId: string }) {
  const {
    documents,
    loading,
    uploading,
    error,
    upload,
    retryDocument,
    retryingId,
    deleteDocument,
    deletingId,
  } = useDocuments(projectId);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleDelete(doc: ProjectDocumentDto) {
    if (
      !window.confirm(
        `"${doc.filename}" 문서를 삭제할까요? 되돌릴 수 없습니다.`,
      )
    ) {
      return;
    }
    await deleteDocument(doc.id);
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    await upload(file);
  }

  return (
    <section className="mt-6 rounded-[10px] border border-border bg-bg">
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <h2 className="text-[15px] font-semibold text-fg">문서</h2>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="inline-flex h-[34px] items-center gap-1.5 rounded-md bg-primary px-3.5 text-[13px] font-semibold text-primary-fg outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)] focus-visible:outline-offset-2 disabled:opacity-60"
        >
          <Plus size={13} aria-hidden="true" />
          {uploading ? "업로드 중…" : "업로드"}
        </button>
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          data-testid="document-file-input"
          onChange={handleFileChange}
        />
      </div>

      {error && (
        <p className="px-5 pt-3 text-sm text-accent" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <p className="px-5 py-4 text-sm text-fg-muted">불러오는 중…</p>
      ) : documents.length === 0 ? (
        <p className="px-5 py-4 text-sm text-fg-muted">
          업로드된 문서가 없습니다.
        </p>
      ) : (
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr>
              <th className="border-b border-border px-5 py-2 text-left text-xs font-semibold text-fg-muted">
                문서
              </th>
              <th className="border-b border-border px-3 py-2 text-right text-xs font-semibold text-fg-muted">
                크기
              </th>
              <th className="border-b border-border px-3 py-2 text-left text-xs font-semibold text-fg-muted">
                업로드
              </th>
              <th className="w-[260px] border-b border-border px-3 py-2 text-left text-xs font-semibold text-fg-muted">
                상태
              </th>
            </tr>
          </thead>
          <tbody>
            {documents.map((doc) => {
              const chip = STATUS_CHIP[doc.indexStatus];
              const inProgress = IN_PROGRESS.includes(doc.indexStatus);
              return (
                <tr key={doc.id}>
                  <td className="flex items-center gap-2 border-b border-surface-2 px-5 py-2.5">
                    <FileText
                      size={14}
                      className="flex-none text-fg-muted"
                      aria-hidden="true"
                    />
                    <span className="font-medium text-fg">{doc.filename}</span>
                  </td>
                  <td className="border-b border-surface-2 px-3 py-2.5 text-right font-mono text-xs tabular-nums text-fg-muted">
                    {formatBytes(doc.sizeBytes)}
                  </td>
                  <td className="border-b border-surface-2 px-3 py-2.5 text-fg-muted">
                    {formatUploadDate(doc.createdAt)}
                  </td>
                  <td className="border-b border-surface-2 px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <StatusChip status={chip.status} label={chip.label} />
                      {inProgress && (
                        <span
                          data-testid={`document-progress-${doc.id}`}
                          aria-hidden="true"
                          className="h-1 w-[72px] flex-none overflow-hidden rounded-full bg-surface-2"
                        >
                          <span className="motion-safe:animate-pulse block h-full w-2/3 rounded-full bg-primary" />
                        </span>
                      )}
                      {doc.indexStatus === "failed" && (
                        <>
                          {doc.failureReason && (
                            <span className="text-[11.5px] text-danger-strong">
                              {doc.failureReason}
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => retryDocument(doc.id)}
                            disabled={retryingId === doc.id}
                            className="h-[26px] flex-none rounded-md border border-border px-2.5 text-xs text-fg outline-none hover:border-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)] focus-visible:outline-offset-2 disabled:opacity-60"
                          >
                            {retryingId === doc.id ? "재시도 중…" : "다시 시도"}
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => handleDelete(doc)}
                        disabled={deletingId === doc.id}
                        aria-label="문서 삭제"
                        title="문서 삭제"
                        className="ml-auto inline-flex h-[26px] w-[26px] flex-none items-center justify-center rounded-md border border-border text-fg-muted outline-none hover:border-accent hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)] focus-visible:outline-offset-2 disabled:opacity-60"
                      >
                        <Trash2 size={13} aria-hidden="true" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
