import React from "react";
import { AdminGuard } from "../../../../components/admin/AdminGuard";
import { AnalyticsDashboard } from "../../../../components/admin/AnalyticsDashboard";

export default function AdminAnalyticsPage() {
  return (
    <main className="mx-auto max-w-5xl p-8">
      <AdminGuard>
        <AnalyticsDashboard />
      </AdminGuard>
    </main>
  );
}
