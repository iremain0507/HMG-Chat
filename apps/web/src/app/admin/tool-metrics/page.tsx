import React from "react";
import { AdminGuard } from "../../../components/admin/AdminGuard";
import { ToolMetricsTable } from "../../../components/admin/ToolMetricsTable";

export default function AdminToolMetricsPage() {
  return (
    <main className="p-8">
      <h1 className="text-2xl font-semibold text-fg">도구 사용 통계</h1>
      <AdminGuard>
        <ToolMetricsTable />
      </AdminGuard>
    </main>
  );
}
