import { describe, it, expect, vi, afterEach } from "vitest";
import { randomUUID } from "../uuid";

const V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("lib/uuid.randomUUID", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("보안 컨텍스트: crypto.randomUUID 가 있으면 그대로 위임한다", () => {
    const native = vi.fn(() => "11111111-1111-4111-8111-111111111111");
    vi.stubGlobal("crypto", { randomUUID: native, getRandomValues: vi.fn() });
    expect(randomUUID()).toBe("11111111-1111-4111-8111-111111111111");
    expect(native).toHaveBeenCalledTimes(1);
  });

  it("비보안 컨텍스트(http Tailscale 등, randomUUID undefined): getRandomValues 폴백으로 유효한 v4 를 만든다", () => {
    // crypto.randomUUID 미정의 → 폴백 경로. getRandomValues 는 비보안에서도 사용 가능.
    vi.stubGlobal("crypto", {
      getRandomValues: (arr: Uint8Array) => {
        for (let i = 0; i < arr.length; i++) arr[i] = (i * 37 + 5) & 0xff;
        return arr;
      },
    });
    const id = randomUUID();
    expect(id).toMatch(V4);
    // version(13번째 문자)=4, variant(17번째)∈{8,9,a,b} 확인
    expect(id[14]).toBe("4");
    expect(["8", "9", "a", "b"]).toContain(id[19]);
  });

  it("폴백은 매 호출 서로 다른 값을 만든다(실 getRandomValues)", () => {
    const real = globalThis.crypto;
    vi.stubGlobal("crypto", {
      getRandomValues: real.getRandomValues.bind(real),
    });
    expect(randomUUID()).not.toBe(randomUUID());
  });
});
