import React from "react";
import { AdminGuard } from "../../../components/admin/AdminGuard";
import { AdminUsersManager } from "../../../components/admin/AdminUsersManager";

export default function AdminUsersPage() {
  return (
    <main className="p-8">
      <h1 className="text-2xl font-semibold text-fg">사용자 관리</h1>
      <AdminGuard>
        <AdminUsersManager />
      </AdminGuard>
    </main>
  );
}
