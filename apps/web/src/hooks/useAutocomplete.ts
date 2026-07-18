"use client";

// hooks/useAutocomplete.ts — P22-T6-16 / 계약배치 C10: 입력 자동완성(ghost text) 데이터 훅.
// 컴포저 draft 를 debounce 해 POST /api/v1/completions 를 호출하고, 커서 뒤에 그릴
// 이어쓰기 조각을 돌려준다. Open WebUI 의 prompt-autocomplete 플로우를 레퍼런스로 삼되
// 취소/stale 규칙은 계약배치 C10 승인 조건을 그대로 따른다:
//   - 사용자가 계속 타이핑하면 in-flight 요청을 AbortController 로 끊는다.
//   - 취소된 요청이 뒤늦게 도착해도 최신 제안을 덮어쓰지 않는다(stale 무시).
//   - org 가 기능을 끄면(403 FEATURE_DISABLED) 같은 세션에서 재요청하지 않는다.
import { useCallback, useEffect, useRef, useState } from "react";

const DEFAULT_DELAY_MS = 400;

export interface UseAutocompleteOptions {
  /** 컴포저의 현재 초안 */
  draft: string;
  /** org+사용자 설정이 모두 켜졌을 때만 true */
  enabled: boolean;
  /** 타이핑이 멈춘 것으로 볼 시간 */
  delayMs?: number;
  /** 직전 대화 맥락(선택) */
  context?: string;
}

export interface UseAutocompleteResult {
  /** 커서 뒤에 회색으로 그릴 이어쓰기 조각. 없으면 "" */
  suggestion: string;
  /** Escape/수락 후 제안을 감춘다. 같은 초안으로는 다시 요청하지 않는다. */
  dismiss: () => void;
}

export function useAutocomplete({
  draft,
  enabled,
  delayMs = DEFAULT_DELAY_MS,
  context,
}: UseAutocompleteOptions): UseAutocompleteResult {
  const [suggestion, setSuggestion] = useState("");
  // 403 이후 영구 off — 서버가 거절하는 기능에 계속 왕복하지 않는다.
  const disabledRef = useRef(false);
  // dismiss 한 초안. 사용자가 명시적으로 닫았으므로 같은 초안으로는 재요청하지 않는다.
  const dismissedDraftRef = useRef<string | null>(null);

  const dismiss = useCallback(() => {
    dismissedDraftRef.current = draft;
    setSuggestion("");
  }, [draft]);

  useEffect(() => {
    const trimmed = draft.trim();
    if (
      !enabled ||
      disabledRef.current ||
      trimmed.length === 0 ||
      dismissedDraftRef.current === draft
    ) {
      setSuggestion("");
      return;
    }

    // 초안이 바뀌면 이전 제안은 즉시 무효 — 낡은 ghost text 가 남아 보이지 않게 한다.
    setSuggestion("");

    const ac = new AbortController();
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch("/api/v1/completions", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ draft, ...(context ? { context } : {}) }),
            signal: ac.signal,
          });
          if (ac.signal.aborted) return;
          if (!res.ok) {
            if (res.status === 403) disabledRef.current = true;
            return;
          }
          const body = (await res.json()) as {
            data?: { completion?: string };
          };
          // 응답 대기 중 사용자가 계속 타이핑했다면 이 응답은 stale — 버린다.
          if (ac.signal.aborted) return;
          setSuggestion(body.data?.completion ?? "");
        } catch {
          // abort 및 네트워크 오류는 조용히 무시(자동완성은 보조 기능, 입력을 막지 않는다).
        }
      })();
    }, delayMs);

    return () => {
      clearTimeout(timer);
      ac.abort();
    };
  }, [draft, enabled, delayMs, context]);

  return { suggestion, dismiss };
}
