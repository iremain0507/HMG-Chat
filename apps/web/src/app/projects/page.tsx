"use client";

// app/projects/page.tsx — 18-FRONTEND-WIREFRAMES § 18.5.2 /projects 목록.
//   design-reference F09 카드 언어(보더만·그림자 없음, radius 10)로 정렬(P13-T6-10).
import React from "react";
import Link from "next/link";
import { useProjects } from "../../hooks/useProjects";

const VISIBILITY_LABEL: Record<string, string> = {
  private: "비공개",
  team: "팀",
  org: "전사",
};

export default function ProjectsPage() {
  const { projects, loading, error } = useProjects();

  return (
    <main className="p-8">
      <h1 className="text-xl font-bold text-fg">프로젝트</h1>
      {loading && <p className="mt-3 text-sm text-fg-muted">불러오는 중…</p>}
      {error && (
        <p className="mt-3 text-sm text-accent" role="alert">
          {error}
        </p>
      )}
      <ul
        aria-label="프로젝트 목록"
        className="mt-5 grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3"
      >
        {projects.map((p) => (
          <li key={p.id}>
            <Link
              href={`/projects/${p.id}`}
              aria-label={p.name}
              className="block rounded-[10px] border border-border bg-bg p-4 outline-none hover:border-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)] focus-visible:outline-offset-2"
            >
              <div className="flex items-center gap-2">
                <span className="truncate text-[14.5px] font-semibold text-fg">
                  {p.name}
                </span>
                <span className="ml-auto flex-none rounded-full border border-primary-200 bg-primary-50 px-2 py-0.5 text-[11px] font-semibold text-primary">
                  {VISIBILITY_LABEL[p.visibility] ?? p.visibility}
                </span>
              </div>
              {p.description && (
                <p className="mt-1.5 line-clamp-2 text-[12.5px] text-fg-muted">
                  {p.description}
                </p>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
