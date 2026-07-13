import { describe, it, expect } from "vitest";
import { percentile, summarize } from "./load-test.mjs";

describe("load-test percentile", () => {
  it("nearest-rank 방식으로 p95 를 계산한다", () => {
    const sorted = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100
    expect(percentile(sorted, 95)).toBe(95);
    expect(percentile(sorted, 50)).toBe(50);
    expect(percentile(sorted, 99)).toBe(99);
  });

  it("빈 배열은 NaN 을 반환한다", () => {
    expect(percentile([], 95)).toBeNaN();
  });
});

describe("load-test summarize", () => {
  it("min/mean/p50/p95/p99/max 를 계산한다", () => {
    const stats = summarize([100, 200, 300, 400, 500]);
    expect(stats.count).toBe(5);
    expect(stats.min).toBe(100);
    expect(stats.max).toBe(500);
    expect(stats.mean).toBe(300);
    expect(stats.p50).toBe(300);
  });

  it("정렬되지 않은 입력도 정렬 후 계산한다", () => {
    const stats = summarize([500, 100, 300]);
    expect(stats.min).toBe(100);
    expect(stats.max).toBe(500);
  });
});
