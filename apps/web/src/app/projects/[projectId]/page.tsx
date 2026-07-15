import React from "react";
import { ProjectDetail } from "../../../components/projects/ProjectDetail";

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  return (
    <main className="p-8">
      <ProjectDetail projectId={projectId} />
    </main>
  );
}
