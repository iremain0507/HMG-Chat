// health-history-query.test.ts — P22-T1-10 RED: health_check_history 조회가 from/to 범위
// 술어를 못 만들고(SQL 에 created_at BETWEEN 없음), row → HealthCheckResult 매핑이 ts 를
// 채우지 않는다. pgPool 없이 검증하기 위해 순수 헬퍼(buildRecentQuery/toHealthCheckResult)를 단언.
import { describe, it, expect } from "vitest";
import {
  buildRecentQuery,
  toHealthCheckResult,
} from "../health-history-data-access.js";

describe("buildRecentQuery", () => {
  it("range 없으면 기존 SQL(target + LIMIT)을 유지한다", () => {
    const q = buildRecentQuery("db", 50);
    expect(q.text).not.toContain("created_at >=");
    expect(q.text).not.toContain("created_at <=");
    expect(q.values).toEqual(["db", 50]);
  });

  it("from 이 있으면 created_at >= 술어와 파라미터를 추가한다", () => {
    const from = new Date("2026-07-14T00:00:00Z");
    const q = buildRecentQuery("db", 50, { from });
    expect(q.text).toContain("created_at >= $2");
    expect(q.values).toEqual(["db", from, 50]);
  });

  it("from+to 가 있으면 두 술어를 순서대로 바인딩한다", () => {
    const from = new Date("2026-07-14T00:00:00Z");
    const to = new Date("2026-07-16T00:00:00Z");
    const q = buildRecentQuery("db", 10, { from, to });
    expect(q.text).toContain("created_at >= $2");
    expect(q.text).toContain("created_at <= $3");
    expect(q.text).toContain("LIMIT $4");
    expect(q.values).toEqual(["db", from, to, 10]);
  });

  it("to 만 있으면 created_at <= 술어만 추가한다", () => {
    const to = new Date("2026-07-16T00:00:00Z");
    const q = buildRecentQuery("db", 10, { to });
    expect(q.text).toContain("created_at <= $2");
    expect(q.text).not.toContain("created_at >=");
    expect(q.values).toEqual(["db", to, 10]);
  });
});

describe("toHealthCheckResult", () => {
  it("created_at 을 ts 로 매핑한다", () => {
    const createdAt = new Date("2026-07-15T00:00:00Z");
    const r = toHealthCheckResult({
      target: "db",
      status: "healthy",
      latency_ms: 12,
      context: null,
      created_at: createdAt,
    });
    expect(r.ts).toEqual(createdAt);
    expect(r.latencyMs).toBe(12);
  });

  it("created_at 이 없으면 ts 를 생략한다(기존 행 호환)", () => {
    const r = toHealthCheckResult({
      target: "db",
      status: "down",
      latency_ms: null,
      context: null,
      created_at: null,
    });
    expect(r.ts).toBeUndefined();
    expect(r.latencyMs).toBeNull();
  });
});
