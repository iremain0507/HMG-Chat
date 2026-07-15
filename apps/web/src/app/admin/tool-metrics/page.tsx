import React from "react";
import { AdminGuard } from "../../../components/admin/AdminGuard";
import { ToolMetricsTable } from "../../../components/admin/ToolMetricsTable";

export default function AdminToolMetricsPage() {
  return (
    <main className="mx-auto max-w-5xl p-8">
      <AdminGuard>
        <ToolMetricsTable />
      </AdminGuard>
    </main>
  );
}
