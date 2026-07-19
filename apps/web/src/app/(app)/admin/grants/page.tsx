import React from "react";
import { AdminGuard } from "../../../../components/admin/AdminGuard";
import { GrantsManager } from "../../../../components/admin/GrantsManager";

export default function AdminGrantsPage() {
  return (
    <main className="mx-auto max-w-5xl p-8">
      <AdminGuard>
        <GrantsManager />
      </AdminGuard>
    </main>
  );
}
