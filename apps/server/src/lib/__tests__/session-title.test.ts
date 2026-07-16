import { describe, it, expect } from "vitest";
import { deriveSessionTitle } from "../session-title.js";

describe("deriveSessionTitle", () => {
  it("짧은 내용은 그대로 제목이 된다", () => {
    expect(deriveSessionTitle("데이터레이크 전략")).toBe("데이터레이크 전략");
  });

  it("40자 초과는 40자 + …", () => {
    const t = deriveSessionTitle("가".repeat(60));
    expect(t).toBe("가".repeat(40) + "…");
    expect(t).toHaveLength(41);
  });

  it("여러 줄/연속 공백은 한 줄로 정규화한다", () => {
    expect(deriveSessionTitle("현대위아  전략을\n구성해줘 ")).toBe(
      "현대위아 전략을 구성해줘",
    );
  });

  it("빈 값/공백/undefined 는 null(제목 없음)", () => {
    expect(deriveSessionTitle("")).toBeNull();
    expect(deriveSessionTitle("   \n  ")).toBeNull();
    expect(deriveSessionTitle(undefined)).toBeNull();
    expect(deriveSessionTitle(null)).toBeNull();
  });
});
