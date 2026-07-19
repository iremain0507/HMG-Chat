// @vitest-environment jsdom
// lib/importConversations.ts — P22-T6-13(계약배치 C9) 대화 가져오기 클라이언트 헬퍼.
//   파일에서 읽은 JSON 의 포맷(native/chatgpt)을 구조로 판별하고 POST /api/v1/sessions/import
//   로 넘긴다(서버가 실제 파싱/생성의 단일 출처 — 여기서는 포맷 판별과 전송만).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { apiFetch } = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("../fetch-with-refresh", () => ({ apiFetch }));

import {
  detectImportFormat,
  importConversationsFromFile,
} from "../importConversations";

function jsonFile(name: string, value: unknown): File {
  return new File([JSON.stringify(value)], name, {
    type: "application/json",
  });
}

describe("detectImportFormat (P22-T6-13)", () => {
  it("{title,messages} 는 native 로 판별한다", () => {
    expect(
      detectImportFormat({
        title: "t",
        messages: [{ role: "user", content: "x" }],
      }),
    ).toBe("native");
  });

  it("{title,messages} 배열도 native 로 판별한다", () => {
    expect(detectImportFormat([{ title: "t", messages: [] }])).toBe("native");
  });

  it("mapping 그래프를 가진 대화 배열은 chatgpt 로 판별한다", () => {
    expect(
      detectImportFormat([{ title: "t", mapping: { a: { id: "a" } } }]),
    ).toBe("chatgpt");
  });

  it("어느 쪽도 아니면 null 을 반환한다", () => {
    expect(detectImportFormat({ nope: 1 })).toBeNull();
    expect(detectImportFormat("문자열")).toBeNull();
  });
});

describe("importConversationsFromFile (P22-T6-13)", () => {
  beforeEach(() => apiFetch.mockReset());
  afterEach(() => vi.restoreAllMocks());

  it("판별한 format 과 payload 를 POST /api/v1/sessions/import 로 보내고 생성된 id 를 반환한다", async () => {
    const payload = {
      title: "가져온 대화",
      messages: [{ role: "user", content: "안녕" }],
    };
    apiFetch.mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ data: { createdSessionIds: ["s-1"] } }),
    });
    const result = await importConversationsFromFile(
      jsonFile("chat.json", payload),
    );
    expect(result).toEqual({ ok: true, createdSessionIds: ["s-1"] });
    expect(apiFetch).toHaveBeenCalledWith(
      "/api/v1/sessions/import",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ format: "native", payload }),
      }),
    );
  });

  it("JSON 이 아니면 요청하지 않고 실패를 반환한다", async () => {
    const bad = new File(["not json"], "x.json", { type: "application/json" });
    const result = await importConversationsFromFile(bad);
    expect(result.ok).toBe(false);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("포맷을 알 수 없으면 요청하지 않고 실패를 반환한다", async () => {
    const result = await importConversationsFromFile(
      jsonFile("x.json", { nope: 1 }),
    );
    expect(result.ok).toBe(false);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("서버가 400 이면 실패를 반환한다(세션 생성 없음)", async () => {
    apiFetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: { code: "INVALID_INPUT" } }),
    });
    const result = await importConversationsFromFile(
      jsonFile("x.json", {
        title: "t",
        messages: [{ role: "user", content: "a" }],
      }),
    );
    expect(result.ok).toBe(false);
  });
});
