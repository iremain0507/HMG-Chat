import React from "react";
import { AdminGuard } from "../../../../components/admin/AdminGuard";
import { AuditLogTable } from "../../../../components/admin/AuditLogTable";

export default function AdminAuditLogsPage() {
  return (
    <main className="mx-auto max-w-5xl p-8">
      <AdminGuard>
        <AuditLogTable />
      </AdminGuard>
    </main>
  );
}
