import { describe, it, expect } from "vitest";
import { hello } from "../skills-engine.js";

describe("skills-engine.hello", () => {
  it("도메인 진입점이 hello-world 문자열을 반환한다", () => {
    expect(hello()).toBe("skills-engine: hello-world");
  });
});
