// @vitest-environment jsdom
// hooks/useAutocomplete.ts — P22-T6-16 RED: 입력 자동완성(ghost text) 데이터 훅이 없다.
// 계약배치 C10 승인 조건인 "요청 취소(AbortSignal) + stale 응답 무시"를 실제 이벤트로 단언한다.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useAutocomplete } from "../useAutocomplete";

const DELAY = 300;

function stubCompletionFetch(
  handler: (
    body: { draft: string },
    signal: AbortSignal | undefined,
  ) => unknown,
) {
  const spy = vi.fn(async (_input: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { draft: string };
    return handler(body, init?.signal ?? undefined) as Response;
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

function okResponse(completion: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ data: { completion } }),
  } as unknown as Response;
}

describe("useAutocomplete", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("타이핑이 멈추면(debounce) 초안을 POST /completions 로 보내고 제안을 노출한다", async () => {
    const spy = stubCompletionFetch(() => okResponse("어떻게 설정하나요?"));
    const { result, rerender } = renderHook(
      ({ draft }: { draft: string }) =>
        useAutocomplete({ draft, enabled: true, delayMs: DELAY }),
      { initialProps: { draft: "" } },
    );

    rerender({ draft: "사내 VPN 을" });
    // debounce 경과 전에는 호출하지 않는다(타이핑 중 매 글자 호출 방지).
    expect(spy).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(DELAY + 10);
    });

    await waitFor(() =>
      expect(result.current.suggestion).toBe("어떻게 설정하나요?"),
    );
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toBe("/api/v1/completions");
  });

  it("계속 타이핑하면 진행 중이던 요청을 abort 하고 stale 응답은 무시된다", async () => {
    const signals: AbortSignal[] = [];
    let resolveFirst: ((r: Response) => void) | null = null;
    stubCompletionFetch((body, signal) => {
      if (signal) signals.push(signal);
      if (body.draft === "사내") {
        // 첫 요청은 응답을 붙잡아 둔다 — 나중에 늦게 도착시켜 stale 무시를 검증.
        return new Promise<Response>((resolve) => {
          resolveFirst = resolve;
        });
      }
      return okResponse("최신 제안");
    });

    const { result, rerender } = renderHook(
      ({ draft }: { draft: string }) =>
        useAutocomplete({ draft, enabled: true, delayMs: DELAY }),
      { initialProps: { draft: "" } },
    );

    rerender({ draft: "사내" });
    await act(async () => {
      vi.advanceTimersByTime(DELAY + 10);
    });
    expect(signals[0]?.aborted).toBe(false);

    // 사용자가 이어서 타이핑 → 이전 in-flight 요청은 취소돼야 한다.
    rerender({ draft: "사내 VPN" });
    await act(async () => {
      vi.advanceTimersByTime(DELAY + 10);
    });
    expect(signals[0]?.aborted).toBe(true);
    await waitFor(() => expect(result.current.suggestion).toBe("최신 제안"));

    // 취소된 첫 요청이 뒤늦게 도착해도 최신 제안을 덮어써서는 안 된다.
    await act(async () => {
      resolveFirst?.(okResponse("낡은 제안"));
      await Promise.resolve();
    });
    expect(result.current.suggestion).toBe("최신 제안");
  });

  it("org 가 기능을 끄면(403 FEATURE_DISABLED) 제안이 없고 이후 재요청도 하지 않는다", async () => {
    const spy = stubCompletionFetch(
      () =>
        ({
          ok: false,
          status: 403,
          json: async () => ({ error: { code: "FEATURE_DISABLED" } }),
        }) as unknown as Response,
    );
    const { result, rerender } = renderHook(
      ({ draft }: { draft: string }) =>
        useAutocomplete({ draft, enabled: true, delayMs: DELAY }),
      { initialProps: { draft: "" } },
    );

    rerender({ draft: "사내 VPN 을" });
    await act(async () => {
      vi.advanceTimersByTime(DELAY + 10);
    });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(result.current.suggestion).toBe("");

    rerender({ draft: "사내 VPN 을 어떻게" });
    await act(async () => {
      vi.advanceTimersByTime(DELAY + 10);
    });
    // 403 이후에는 같은 세션에서 더 이상 호출하지 않는다(서버 부하/무의미한 왕복 방지).
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("enabled=false 면 아무 요청도 하지 않는다(사용자 설정 off)", async () => {
    const spy = stubCompletionFetch(() => okResponse("제안"));
    const { rerender } = renderHook(
      ({ draft }: { draft: string }) =>
        useAutocomplete({ draft, enabled: false, delayMs: DELAY }),
      { initialProps: { draft: "" } },
    );
    rerender({ draft: "사내 VPN 을" });
    await act(async () => {
      vi.advanceTimersByTime(DELAY + 10);
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it("dismiss() 하면 제안이 사라지고 같은 초안으로는 다시 요청하지 않는다", async () => {
    const spy = stubCompletionFetch(() => okResponse("제안 텍스트"));
    const { result, rerender } = renderHook(
      ({ draft }: { draft: string }) =>
        useAutocomplete({ draft, enabled: true, delayMs: DELAY }),
      { initialProps: { draft: "" } },
    );
    rerender({ draft: "사내 VPN 을" });
    await act(async () => {
      vi.advanceTimersByTime(DELAY + 10);
    });
    await waitFor(() => expect(result.current.suggestion).toBe("제안 텍스트"));

    act(() => result.current.dismiss());
    expect(result.current.suggestion).toBe("");
    await act(async () => {
      vi.advanceTimersByTime(DELAY + 10);
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
