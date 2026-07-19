import React from "react";
import { AdminGuard } from "../../../../components/admin/AdminGuard";
import { AdminSubNav } from "../../../../components/admin/AdminSubNav";
import { OpenApiToolServersManager } from "../../../../components/admin/OpenApiToolServersManager";

// P22-T6-21 — OpenAPI 툴서버 admin 패널 라우트. AdminSubNav 는 다른 admin 화면들이 컴포넌트
//   내부에서 렌더하는 것과 달리 여기서 렌더한다 — OpenApiToolServersManager 는 /preview 갤러리와
//   e2e 에서 라우터 없이 마운트되므로 usePathname 의존을 컴포넌트 밖에 둔다.
export default function AdminToolServersPage() {
  return (
    <main className="mx-auto max-w-5xl p-8">
      <AdminGuard>
        <AdminSubNav />
        <div className="mt-6">
          <OpenApiToolServersManager />
        </div>
      </AdminGuard>
    </main>
  );
}
