// lib/i18n/index.ts — P22-T6-15(계약배치 C11): 다국어 메시지 카탈로그 단일 출처.
// Open WebUI 레퍼런스: 사용자별 언어 선택(Settings → Profile)이 즉시 UI 에 반영되고
// 계정에 저장돼 재로그인 후에도 유지된다. 우리 구현은 User.language(BCP-47, null=서버 기본)
// 를 PATCH /auth/me 로 저장하고, 렌더는 next-intl 의 NextIntlClientProvider 로 한다.
import { ko } from "./messages/ko";
import { en } from "./messages/en";

export const DEFAULT_LOCALE = "ko";

// 순서 = UI 선택기 노출 순서(기본 로케일 우선).
export const SUPPORTED_LOCALES = ["ko", "en"] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

// ko 를 키의 단일 출처로 삼는다 — en 은 같은 shape 여야 한다(i18n.test.ts 가 단언).
export type Messages = typeof ko;

const CATALOGS: Record<Locale, Messages> = {
  ko,
  // en 은 ko 와 키가 같지만 리터럴 타입이 달라 구조적으로 Messages 로 좁힌다.
  en: en as unknown as Messages,
};

export function getMessages(locale: Locale): Messages {
  return CATALOGS[locale];
}

export function isSupportedLocale(value: unknown): value is Locale {
  return (
    typeof value === "string" &&
    (SUPPORTED_LOCALES as readonly string[]).includes(value)
  );
}

/**
 * User.language(BCP-47, null 가능) → 지원 로케일.
 * - null·undefined·미지원 태그("fr") → DEFAULT_LOCALE("ko")
 * - 지역 서브태그는 기본 언어로 축약: "en-US" → "en", "ko-KR" → "ko"
 */
export function resolveLocale(tag: string | null | undefined): Locale {
  if (!tag) return DEFAULT_LOCALE;
  const base = tag.split("-")[0]?.toLowerCase() ?? "";
  return isSupportedLocale(base) ? base : DEFAULT_LOCALE;
}

// 선택기 라벨 — 각 언어는 자기 언어 이름으로 표기(Open WebUI 와 동일 관례).
export const LOCALE_LABELS: Record<Locale, string> = {
  ko: "한국어",
  en: "English",
};
