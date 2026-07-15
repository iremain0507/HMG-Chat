import React from "react";
import { AdminGuard } from "../../../components/admin/AdminGuard";
import { AdminUsersManager } from "../../../components/admin/AdminUsersManager";

export default function AdminUsersPage() {
  return (
    <main className="mx-auto max-w-5xl p-8">
      <AdminGuard>
        <AdminUsersManager />
      </AdminGuard>
    </main>
  );
}
