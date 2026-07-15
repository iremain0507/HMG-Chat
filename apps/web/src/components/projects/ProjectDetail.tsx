"use client";

// components/projects/ProjectDetail.tsx — 18-FRONTEND-WIREFRAMES § 18.5.3 /projects/[projectId]
// 의 최소 구현: 프로젝트 기본 정보 표시 + existence-leak 방지(404) + 문서(P4-T6-01).
// 멤버/세션 목록(§ 18.5.3 와이어프레임 나머지)은 Phase 5 소관이라 범위 밖.
import React from "react";
import { notFound } from "next/navigation";
import { useProject } from "../../hooks/useProject";
import { DocumentsPanel } from "./DocumentsPanel";

const VISIBILITY_LABEL: Record<string, string> = {
  private: "비공개",
  team: "팀",
  org: "전사",
};

export function ProjectDetail({ projectId }: { projectId: string }) {
  const {
    project,
    loading,
    notFound: projectNotFound,
    error,
  } = useProject(projectId);

  if (loading) return <p>불러오는 중…</p>;
  if (projectNotFound) notFound();
  if (error) return <p className="text-accent">{error}</p>;
  if (!project) return null;

  return (
    <article className="rounded-[10px] border border-border bg-bg px-10 py-7">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-bold text-fg">{project.name}</h1>
        <span className="rounded-full border border-primary-200 bg-primary-50 px-2.5 py-0.5 text-[11px] font-semibold text-primary">
          {VISIBILITY_LABEL[project.visibility] ?? project.visibility}
        </span>
      </div>
      {project.description && (
        <p className="mt-2 text-sm text-fg-muted">{project.description}</p>
      )}
      <DocumentsPanel projectId={projectId} />
    </article>
  );
}
