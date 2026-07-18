"use client";

// hooks/useNotes.ts — P22-T6-17 노트 워크스페이스 소비(계약 승인 C7).
//   /api/v1/notes 계약: GET 목록 · POST 생성(201) · PATCH/:id 부분 수정 ·
//   DELETE/:id(204) · POST /:id/enhance(AI 개선본 저장 후 갱신된 노트 반환).
//   useAgents 와 동일하게 변이 후 목록을 재조회해 서버 상태를 단일 출처로 유지한다.
//
//   enhance 만 반환값이 있다(개선된 본문). 편집 중인 에디터가 저장된 본문으로
//   즉시 갈아끼워야 하는데, 재조회 목록에서 찾아 쓰게 하면 호출측이 경합을 떠안기 때문.
//   실패 시 null 을 돌려주고 error 를 노출한다 — 서버(routes/notes.ts)가 fail-soft 가
//   아니라 502 를 주는 것과 같은 이유로, 조용히 삼키면 "아무 일도 안 난 것"처럼 보인다.
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../lib/fetch-with-refresh";

export interface NoteDto {
  id: string;
  orgId: string;
  userId: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface NoteInput {
  title?: string;
  content?: string;
}

export type NotePatch = NoteInput;

interface UseNotesResult {
  notes: NoteDto[];
  loading: boolean;
  error: string | null;
  create(input?: NoteInput): Promise<void>;
  update(id: string, patch: NotePatch): Promise<void>;
  remove(id: string): Promise<void>;
  /** 개선된 본문. 실패 시 null(+ error 노출). */
  enhance(id: string, instruction?: string): Promise<string | null>;
}

async function readErrorMessage(
  res: { json(): Promise<unknown> },
  fallback: string,
): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    return body.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}

export function useNotes(): UseNotesResult {
  const [notes, setNotes] = useState<NoteDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch("/api/v1/notes", { credentials: "include" });
      if (!res.ok) {
        setError("노트 목록을 불러오지 못했습니다.");
        return;
      }
      const body = (await res.json()) as { data: NoteDto[] };
      setNotes(body.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = useCallback(
    async (input: NoteInput = {}) => {
      setError(null);
      const res = await apiFetch("/api/v1/notes", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        setError(await readErrorMessage(res, "노트 생성에 실패했습니다."));
        return;
      }
      await load();
    },
    [load],
  );

  const update = useCallback(
    async (id: string, patch: NotePatch) => {
      setError(null);
      const res = await apiFetch(`/api/v1/notes/${id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        setError(await readErrorMessage(res, "노트 저장에 실패했습니다."));
        return;
      }
      await load();
    },
    [load],
  );

  const remove = useCallback(
    async (id: string) => {
      setError(null);
      const res = await apiFetch(`/api/v1/notes/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        setError(await readErrorMessage(res, "노트 삭제에 실패했습니다."));
        return;
      }
      await load();
    },
    [load],
  );

  const enhance = useCallback(
    async (id: string, instruction?: string): Promise<string | null> => {
      setError(null);
      const res = await apiFetch(`/api/v1/notes/${id}/enhance`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(instruction ? { instruction } : {}),
      });
      if (!res.ok) {
        setError(await readErrorMessage(res, "AI 개선에 실패했습니다."));
        return null;
      }
      const body = (await res.json()) as { data: NoteDto };
      // 서버가 이미 개선본을 저장했으므로 목록도 갱신해 updatedAt/미리보기를 맞춘다.
      await load();
      return body.data.content;
    },
    [load],
  );

  return { notes, loading, error, create, update, remove, enhance };
}
