"use client";

// lib/fetch-with-refresh.ts — access token(15분) 만료로 401 이 오면 refresh token(30일)으로
//   /api/v1/auth/refresh 를 한 번 호출해 새 access 쿠키를 받고 원 요청을 1회 재시도한다.
//   모든 인증 API 호출은 이 래퍼(apiFetch)를 써서 만료 시 조용한 실패(무응답)를 방지.
//   동시 401 다발은 refresh 를 1회로 dedup(경합 방지).

let refreshing: Promise<boolean> | null = null;

async function refreshOnce(): Promise<boolean> {
  if (!refreshing) {
    refreshing = fetch("/api/v1/auth/refresh", {
      method: "POST",
      credentials: "include",
    })
      .then((r) => r.ok)
      .catch(() => false)
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
}

export async function apiFetch(
  input: string,
  init?: RequestInit,
): Promise<Response> {
  const opts: RequestInit = { credentials: "include", ...init };
  const res = await fetch(input, opts);
  // refresh 엔드포인트 자신은 재시도하지 않는다(무한루프 방지). /me 등 다른 authed 경로는 재시도 대상.
  if (res.status !== 401 || input.includes("/api/v1/auth/refresh")) {
    return res;
  }
  const refreshed = await refreshOnce();
  if (!refreshed) {
    // refresh 실패(refresh 토큰도 만료/무효) → 원 401 을 그대로 반환해 호출측이 /login 처리.
    return res;
  }
  return fetch(input, opts);
}
