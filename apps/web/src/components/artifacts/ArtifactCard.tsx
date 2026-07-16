"use client";

// components/artifacts/ArtifactCard.tsx — P18-T6-01: 우패널에만 있던 아티팩트를
// 해당 어시스턴트 메시지 하단에서도 발견할 수 있도록 하는 인라인 클릭 카드.
import React from "react";
import type { ArtifactSummary } from "../../hooks/useSessionStream";

const KIND_ICON: Record<string, string> = {
  markdown: "📄",
  html: "🌐",
  code: "💻",
  csv: "📊",
  pdf: "📕",
  pptx: "📽️",
};

export function ArtifactCard({
  artifact,
  onOpen,
}: {
  artifact: Pick<ArtifactSummary, "artifactKind" | "filename">;
  onOpen: () => void;
}) {
  const icon = KIND_ICON[artifact.artifactKind] ?? "📄";
  return (
    <button
      type="button"
      data-testid="artifact-card"
      onClick={onOpen}
      className="mt-2 flex max-w-xs items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-left text-sm text-fg hover:border-primary"
    >
      <span aria-hidden="true">{icon}</span>
      <span className="truncate">{artifact.filename}</span>
      <span className="flex-none text-fg-muted">· 열기</span>
    </button>
  );
}
