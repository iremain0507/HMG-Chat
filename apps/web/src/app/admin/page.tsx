import React from "react";
import { AdminGuard } from "../../components/admin/AdminGuard";
import { AdminDashboard } from "../../components/admin/AdminDashboard";

export default function AdminDashboardPage() {
  return (
    <main className="p-8">
      <h1 className="text-2xl font-semibold text-fg">운영 대시보드</h1>
      <AdminGuard>
        <AdminDashboard />
      </AdminGuard>
    </main>
  );
}
