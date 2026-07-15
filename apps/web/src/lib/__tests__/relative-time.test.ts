// P13-T6-02 — 홈(F03) 최근 세션 목록의 상대시각 표기(design-reference README §Screens
//   "10분 전"/"2시간 전"/"어제"/"3일 전"). 순수 함수라 vitest 로 결정론 검증(now 주입).
import { describe, it, expect } from "vitest";
import { formatRelativeTime } from "../relative-time";

describe("formatRelativeTime", () => {
  const now = new Date("2026-07-15T12:00:00.000Z").getTime();

  it("1분 미만이면 방금 전", () => {
    expect(formatRelativeTime("2026-07-15T11:59:40.000Z", now)).toBe("방금 전");
  });

  it("60분 미만이면 N분 전", () => {
    expect(formatRelativeTime("2026-07-15T11:50:00.000Z", now)).toBe("10분 전");
  });

  it("24시간 미만이면 N시간 전", () => {
    expect(formatRelativeTime("2026-07-15T10:00:00.000Z", now)).toBe(
      "2시간 전",
    );
  });

  it("24~48시간이면 어제", () => {
    expect(formatRelativeTime("2026-07-14T06:00:00.000Z", now)).toBe("어제");
  });

  it("48시간 이상이면 N일 전", () => {
    expect(formatRelativeTime("2026-07-12T12:00:00.000Z", now)).toBe("3일 전");
  });

  it("null 이면 빈 문자열", () => {
    expect(formatRelativeTime(null, now)).toBe("");
  });
});
