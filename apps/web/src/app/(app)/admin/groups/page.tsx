import React from "react";
import { AdminGuard } from "../../../../components/admin/AdminGuard";
import { GroupsManager } from "../../../../components/admin/GroupsManager";

export default function AdminGroupsPage() {
  return (
    <main className="mx-auto max-w-5xl p-8">
      <AdminGuard>
        <GroupsManager />
      </AdminGuard>
    </main>
  );
}
