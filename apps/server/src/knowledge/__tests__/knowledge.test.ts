import { describe, it, expect } from "vitest";
import { hello } from "../knowledge.js";

describe("knowledge.hello", () => {
  it("도메인 진입점이 hello-world 문자열을 반환한다", () => {
    expect(hello()).toBe("knowledge: hello-world");
  });
});
