// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  pendingMessageKey,
  setPendingMessage,
  takePendingMessage,
} from "../pending-message";

// web 테스트 환경은 Storage 가 비작동일 수 있어 in-memory 로 스텁.
function stubSessionStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => store.set(k, String(v)),
    removeItem: (k: string) => store.delete(k),
    clear: () => store.clear(),
  });
}

beforeEach(() => stubSessionStorage());
afterEach(() => vi.unstubAllGlobals());

describe("pending-message (홈 컴포저 → 채팅 자동전송 브릿지)", () => {
  it("set 후 take 하면 메시지를 돌려주고 즉시 제거한다(1회성)", () => {
    setPendingMessage("s1", "안녕?");
    expect(takePendingMessage("s1")).toBe("안녕?");
    // 두 번째 take 는 null — 자동전송이 중복되지 않도록 소비형이어야 한다.
    expect(takePendingMessage("s1")).toBeNull();
  });

  it("세션별로 격리된다(다른 id 는 영향 없음)", () => {
    setPendingMessage("s1", "질문A");
    expect(takePendingMessage("s2")).toBeNull();
    expect(takePendingMessage("s1")).toBe("질문A");
  });

  it("미설정이면 null", () => {
    expect(takePendingMessage("nope")).toBeNull();
  });

  it("key 는 세션 id 로 네임스페이스된다", () => {
    expect(pendingMessageKey("abc")).toBe("wchat:pending:abc");
  });

  it("sessionStorage 접근 불가여도 throw 하지 않는다(best-effort)", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    });
    expect(() => setPendingMessage("s1", "x")).not.toThrow();
    expect(takePendingMessage("s1")).toBeNull();
  });
});
