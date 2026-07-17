"use client";

// hooks/useAdminAuditLogs.ts — P20-T1-16 소비: GET /api/v1/admin/audit-logs.
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../lib/fetch-with-refresh";

export interface AuditLogEntryDto {
  id: string;
  actorUserId: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

interface UseAdminAuditLogsResult {
  entries: AuditLogEntryDto[];
  loading: boolean;
  error: string | null;
  actionFilter: string;
  setActionFilter: (action: string) => void;
}

export function useAdminAuditLogs(): UseAdminAuditLogsResult {
  const [entries, setEntries] = useState<AuditLogEntryDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionFilter, setActionFilter] = useState("");

  const load = useCallback(async (action: string) => {
    setLoading(true);
    setError(null);
    try {
      const qs = action ? `?action=${encodeURIComponent(action)}` : "";
      const res = await apiFetch(`/api/v1/admin/audit-logs${qs}`, {
        credentials: "include",
      });
      if (!res.ok) {
        setError("감사 로그를 불러오지 못했습니다.");
        return;
      }
      const body = (await res.json()) as { data: AuditLogEntryDto[] };
      setEntries(body.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(actionFilter);
  }, [load, actionFilter]);

  return { entries, loading, error, actionFilter, setActionFilter };
}
