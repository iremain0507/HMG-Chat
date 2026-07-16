import React from "react";
import { AdminGuard } from "../../../components/admin/AdminGuard";
import { AdminSettingsScreen } from "../../../components/admin/settings/AdminSettingsScreen";

export default function AdminSettingsPage() {
  return (
    <main className="mx-auto max-w-5xl p-8">
      <AdminGuard>
        <AdminSettingsScreen />
      </AdminGuard>
    </main>
  );
}
