// lib/i18n — P22-T6-15(계약배치 C11): 다국어 메시지 카탈로그 단일 출처.
// ko(기본) + en 2개 로케일, User.language(BCP-47) → 지원 로케일 해석.
import { describe, it, expect } from "vitest";
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  getMessages,
  resolveLocale,
} from "../index";

function flatKeys(obj: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === "object"
      ? flatKeys(v as Record<string, unknown>, `${prefix}${k}.`)
      : [`${prefix}${k}`],
  );
}

describe("lib/i18n", () => {
  it("ko 를 기본으로 ko·en 2개 로케일을 지원한다", () => {
    expect(DEFAULT_LOCALE).toBe("ko");
    expect([...SUPPORTED_LOCALES]).toEqual(["ko", "en"]);
  });

  it("각 로케일 카탈로그가 로드되고 키 집합이 동일하다(누락 번역 방지)", () => {
    const ko = flatKeys(getMessages("ko")).sort();
    const en = flatKeys(getMessages("en")).sort();
    expect(ko.length).toBeGreaterThan(0);
    expect(en).toEqual(ko);
    expect(getMessages("ko").settings.profile.title).toBe("프로필");
    expect(getMessages("en").settings.profile.title).toBe("Profile");
  });

  it("resolveLocale: null(미설정)·미지원 태그는 기본 ko, 지역 서브태그는 기본 언어로 축약", () => {
    expect(resolveLocale(null)).toBe("ko");
    expect(resolveLocale(undefined)).toBe("ko");
    expect(resolveLocale("fr")).toBe("ko");
    expect(resolveLocale("en")).toBe("en");
    expect(resolveLocale("en-US")).toBe("en");
    expect(resolveLocale("ko-KR")).toBe("ko");
  });
});
