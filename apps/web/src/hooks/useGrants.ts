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

// P22-T1-07: subject(group) 관점 grant — 그룹 카드의 '이 그룹의 접근 권한' 목록용.
export interface SubjectGrantDto {
  resourceType: GrantResourceType;
  resourceId: string;
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

interface UseGroupGrantsResult {
  grants: SubjectGrantDto[];
  loading: boolean;
  error: string | null;
  load(): Promise<void>;
  grant(
    resourceType: GrantResourceType,
    resourceId: string,
    access: GrantAccessLevel,
  ): Promise<void>;
  revoke(
    resourceType: GrantResourceType,
    resourceId: string,
    access: GrantAccessLevel,
  ): Promise<void>;
}

// P22-T1-07: 단일 그룹이 보유한 grant 를 subject-scoped GET 으로 조회하고 부여/회수한다.
// 그룹 카드마다 독립 인스턴스로 사용(카드 간 상태 격리).
export function useGroupGrants(groupId: string): UseGroupGrantsResult {
  const [grants, setGrants] = useState<SubjectGrantDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        subjectType: "group",
        subjectId: groupId,
      });
      const res = await apiFetch(`/api/v1/admin/grants?${qs.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) {
        setError("접근 권한 목록을 불러오지 못했습니다.");
        return;
      }
      const body = (await res.json()) as { data: SubjectGrantDto[] };
      setGrants(body.data);
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  const grant = useCallback(
    async (
      resourceType: GrantResourceType,
      resourceId: string,
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
          subjectType: "group",
          subjectId: groupId,
          access,
        }),
      });
      if (!res.ok) {
        setError("접근 권한 부여에 실패했습니다.");
        return;
      }
      await load();
    },
    [groupId, load],
  );

  const revoke = useCallback(
    async (
      resourceType: GrantResourceType,
      resourceId: string,
      access: GrantAccessLevel,
    ) => {
      setError(null);
      const qs = new URLSearchParams({
        resourceType,
        resourceId,
        subjectType: "group",
        subjectId: groupId,
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
      await load();
    },
    [groupId, load],
  );

  return { grants, loading, error, load, grant, revoke };
}
