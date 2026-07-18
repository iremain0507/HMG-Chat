import React from "react";
import { NotesWorkspace } from "../../../components/notes/NotesWorkspace";

// app/(app)/notes/page.tsx — P22-T6-17 노트 워크스페이스 라우트(계약 승인 C7).
//   (app) 레이아웃 하위라 인증/내비게이션은 상위 layout 이 담당한다.
export default function NotesPage() {
  return (
    <main className="mx-auto h-[calc(100vh-4rem)] max-w-6xl p-8">
      <NotesWorkspace />
    </main>
  );
}
