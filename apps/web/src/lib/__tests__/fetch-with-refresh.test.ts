import { describe, it, expect, vi, afterEach } from "vitest";
import { apiFetch } from "../fetch-with-refresh";

function resp(status: number, body = ""): Response {
  return new Response(body, { status });
}

describe("lib/fetch-with-refresh.apiFetch", () => {
  afterEach(() => vi.restoreAllMocks());

  it("200 응답은 그대로 반환하고 refresh 를 호출하지 않는다", async () => {
    const fetchMock = vi.fn().mockResolvedValue(resp(200, "ok"));
    vi.stubGlobal("fetch", fetchMock);
    const res = await apiFetch("/api/v1/sessions/x/messages", {
      method: "POST",
    });
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("401 → /refresh 성공 시 원 요청을 1회 재시도해 성공한다", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(resp(401)) // 원 요청 401
      .mockResolvedValueOnce(resp(200, "refreshed")) // /refresh 200
      .mockResolvedValueOnce(resp(200, "retried")); // 재시도 200
    vi.stubGlobal("fetch", fetchMock);
    const res = await apiFetch("/api/v1/sessions/x/messages", {
      method: "POST",
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("retried");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/v1/auth/refresh");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("401 + refresh 실패 시 원 401 을 반환하고 재시도하지 않는다(무한루프 없음)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(resp(401)) // 원 요청
      .mockResolvedValueOnce(resp(401)); // /refresh 도 401
    vi.stubGlobal("fetch", fetchMock);
    const res = await apiFetch("/api/v1/sessions/x/messages");
    expect(res.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("refresh 엔드포인트 401 은 재시도하지 않는다(무한루프 방지)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(resp(401));
    vi.stubGlobal("fetch", fetchMock);
    const res = await apiFetch("/api/v1/auth/refresh", { method: "POST" });
    expect(res.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("/me(authed) 401 은 refresh 후 재시도한다", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(resp(401)) // /me 401
      .mockResolvedValueOnce(resp(200)) // /refresh 200
      .mockResolvedValueOnce(resp(200, "me")); // /me 재시도 200
    vi.stubGlobal("fetch", fetchMock);
    const res = await apiFetch("/api/v1/auth/me");
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
