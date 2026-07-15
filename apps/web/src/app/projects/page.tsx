"use client";

// app/projects/page.tsx — 18-FRONTEND-WIREFRAMES § 18.5.2 /projects 목록.
import React from "react";
import Link from "next/link";
import { useProjects } from "../../hooks/useProjects";

export default function ProjectsPage() {
  const { projects, loading, error } = useProjects();

  return (
    <main className="p-8">
      <h1 className="text-2xl font-semibold text-fg">프로젝트</h1>
      {loading && <p>불러오는 중…</p>}
      {error && <p className="text-accent">{error}</p>}
      <ul aria-label="프로젝트 목록">
        {projects.map((p) => (
          <li key={p.id}>
            <Link href={`/projects/${p.id}`} className="text-primary">
              {p.name}
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
