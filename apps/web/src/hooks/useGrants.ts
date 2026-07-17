"use client";

// hooks/useGrants.ts — P20-T6-11: /api/v1/admin/grants(P20-T1-04) 소비.
import { useCallback, useState } from "react";
import { apiFetch } from "../lib/fetch-with-refresh";

export type GrantResourceType = "model" | "knowledge" | "tool" | "prompt";
export type GrantSubjectType = "user" | "group";
export type GrantAccessLevel = "read" | "write";

export interface GrantDto {
  subjectType: GrantSubjectType;
  subjectId: string;
  access: GrantAccessLevel;
}

interface UseGrantsResult {
  grants: GrantDto[];
  loading: boolean;
  error: string | null;
  loadGrants(
    resourceType: GrantResourceType,
    resourceId: string,
  ): Promise<void>;
  createGrant(
    resourceType: GrantResourceType,
    resourceId: string,
    subjectType: GrantSubjectType,
    subjectId: string,
    access: GrantAccessLevel,
  ): Promise<void>;
  revokeGrant(
    resourceType: GrantResourceType,
    resourceId: string,
    subjectType: GrantSubjectType,
    subjectId: string,
    access: GrantAccessLevel,
  ): Promise<void>;
}

export function useGrants(): UseGrantsResult {
  const [grants, setGrants] = useState<GrantDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadGrants = useCallback(
    async (resourceType: GrantResourceType, resourceId: string) => {
      setLoading(true);
      setError(null);
      try {
        const qs = new URLSearchParams({ resourceType, resourceId });
        const res = await apiFetch(`/api/v1/admin/grants?${qs.toString()}`, {
          credentials: "include",
        });
        if (!res.ok) {
          setError("접근 권한 목록을 불러오지 못했습니다.");
          return;
        }
        const body = (await res.json()) as { data: GrantDto[] };
        setGrants(body.data);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const createGrant = useCallback(
    async (
      resourceType: GrantResourceType,
      resourceId: string,
      subjectType: GrantSubjectType,
      subjectId: string,
      access: GrantAccessLevel,
    ) => {
      setError(null);
      const res = await apiFetch("/api/v1/admin/grants", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resourceType,
          resourceId,
          subjectType,
          subjectId,
          access,
        }),
      });
      if (!res.ok) {
        setError("접근 권한 부여에 실패했습니다.");
        return;
      }
      await loadGrants(resourceType, resourceId);
    },
    [loadGrants],
  );

  const revokeGrant = useCallback(
    async (
      resourceType: GrantResourceType,
      resourceId: string,
      subjectType: GrantSubjectType,
      subjectId: string,
      access: GrantAccessLevel,
    ) => {
      setError(null);
      const qs = new URLSearchParams({
        resourceType,
        resourceId,
        subjectType,
        subjectId,
        access,
      });
      const res = await apiFetch(`/api/v1/admin/grants?${qs.toString()}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        setError("접근 권한 회수에 실패했습니다.");
        return;
      }
      await loadGrants(resourceType, resourceId);
    },
    [loadGrants],
  );

  return { grants, loading, error, loadGrants, createGrant, revokeGrant };
}
