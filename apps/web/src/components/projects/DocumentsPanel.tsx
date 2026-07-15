"use client";

// components/projects/DocumentsPanel.tsx — 18-FRONTEND-WIREFRAMES § 18.5.3 "## 문서" 섹션의
// Phase 4 최소 구현: 목록 + 업로드(파일 선택 → multipart POST) + indexStatus 표시.
// P4-T3-08 라우트가 동기(dev-stub)로 최종 상태를 즉시 반환하므로 progress bar/폴링은 범위 밖.
import React, { useRef } from "react";
import { useDocuments } from "../../hooks/useDocuments";

const STATUS_LABEL: Record<string, string> = {
  pending: "대기",
  parsing: "파싱중",
  chunking: "청킹중",
  embedding: "임베딩중",
  indexed: "indexed",
  failed: "failed",
};

export function DocumentsPanel({ projectId }: { projectId: string }) {
  const { documents, loading, uploading, error, upload } =
    useDocuments(projectId);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    await upload(file);
  }

  return (
    <section>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-fg">문서</h2>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="text-primary"
        >
          {uploading ? "업로드 중…" : "+ 업로드"}
        </button>
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          data-testid="document-file-input"
          onChange={handleFileChange}
        />
      </div>
      {error && <p className="text-accent">{error}</p>}
      {loading ? (
        <p>불러오는 중…</p>
      ) : documents.length === 0 ? (
        <p className="text-fg-muted">업로드된 문서가 없습니다.</p>
      ) : (
        <ul>
          {documents.map((doc) => (
            <li key={doc.id} className="flex items-center justify-between">
              <span className="text-fg">{doc.filename}</span>
              <span className="text-fg-muted">
                {STATUS_LABEL[doc.indexStatus] ?? doc.indexStatus}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
