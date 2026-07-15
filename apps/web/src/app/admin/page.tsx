import React from "react";
import { AdminGuard } from "../../components/admin/AdminGuard";
import { AdminDashboard } from "../../components/admin/AdminDashboard";

export default function AdminDashboardPage() {
  return (
    <main className="mx-auto max-w-5xl p-8">
      <AdminGuard>
        <AdminDashboard />
      </AdminGuard>
    </main>
  );
}
