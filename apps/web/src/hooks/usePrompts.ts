"use client";

// hooks/usePrompts.ts — P19-T6-13: 프롬프트 라이브러리 CRUD 상태(설정 매니저 + 컴포저
//   '/' 자동완성이 공용). 목록 조회 실패는 안전 기본값(빈 배열)로 흡수(L2).
import { useCallback, useEffect, useState } from "react";
import {
  createPrompt,
  deletePrompt,
  listPrompts,
  updatePrompt,
  type PromptDto,
  type PromptInput,
} from "../lib/prompts";

interface UsePromptsResult {
  prompts: PromptDto[];
  loading: boolean;
  error: string | null;
  create(input: PromptInput): Promise<boolean>;
  update(id: string, input: Partial<PromptInput>): Promise<boolean>;
  remove(id: string): Promise<boolean>;
}

export function usePrompts(): UsePromptsResult {
  const [prompts, setPrompts] = useState<PromptDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listPrompts();
      setPrompts(list);
    } catch {
      setPrompts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = useCallback(
    async (input: PromptInput) => {
      setError(null);
      const created = await createPrompt(input);
      if (!created) {
        setError("프롬프트를 저장하지 못했습니다.");
        return false;
      }
      await load();
      return true;
    },
    [load],
  );

  const update = useCallback(
    async (id: string, input: Partial<PromptInput>) => {
      setError(null);
      const updated = await updatePrompt(id, input);
      if (!updated) {
        setError("프롬프트를 수정하지 못했습니다.");
        return false;
      }
      await load();
      return true;
    },
    [load],
  );

  const remove = useCallback(
    async (id: string) => {
      setError(null);
      const prev = prompts;
      setPrompts((cur) => cur.filter((p) => p.id !== id));
      const ok = await deletePrompt(id);
      if (!ok) {
        setError("프롬프트를 삭제하지 못했습니다.");
        setPrompts(prev);
      }
      return ok;
    },
    [prompts],
  );

  return { prompts, loading, error, create, update, remove };
}
