"use client";

// components/i18n/LocaleProvider.tsx — P22-T6-15(계약배치 C11): 사용자별 UI 언어.
// Open WebUI 레퍼런스 플로우: Settings → 언어 선택 → 전체 UI 가 리로드 없이 즉시 그 언어로
// 다시 그려지고, 선택은 계정(User.language)에 저장돼 재로그인/다른 기기에서도 유지된다.
//   - 초기값: GET /auth/me 의 user.language(BCP-47, null = 서버 기본 ko)
//   - 변경  : 낙관적으로 즉시 재렌더 → PATCH /auth/me {language} → 실패 시 롤백(useSessions 패턴)
// 렌더는 next-intl 의 NextIntlClientProvider 로 하고, 소비자는 useTranslations 를 쓴다.
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { NextIntlClientProvider } from "next-intl";
import {
  DEFAULT_LOCALE,
  getMessages,
  resolveLocale,
  type Locale,
} from "../../lib/i18n";
import { apiFetch } from "../../lib/fetch-with-refresh";
import { showToast } from "../../lib/toast";

interface LocaleSetting {
  locale: Locale;
  /** 낙관적 즉시 반영 + 서버 저장. 실패하면 이전 언어로 되돌린다. */
  setLocale: (next: Locale) => Promise<void>;
  /** /auth/me 로 초기 언어를 불러오는 중인지 (선택기 disable 용) */
  loading: boolean;
}

const LocaleContext = createContext<LocaleSetting | null>(null);

export function useLocaleSetting(): LocaleSetting {
  const ctx = useContext(LocaleContext);
  if (!ctx) {
    throw new Error("useLocaleSetting 은 LocaleProvider 안에서만 쓸 수 있다.");
  }
  return ctx;
}

interface LocaleProviderProps {
  children: React.ReactNode;
  /** 테스트·/preview 용 초기 로케일 고정(주면 /auth/me 조회를 건너뛴다). */
  initialLocale?: Locale;
}

export function LocaleProvider({
  children,
  initialLocale,
}: LocaleProviderProps) {
  const [locale, setLocaleState] = useState<Locale>(
    initialLocale ?? DEFAULT_LOCALE,
  );
  const [loading, setLoading] = useState(initialLocale === undefined);

  // 초기 언어 = 서버에 저장된 User.language. 실패해도 기본 ko 로 계속 동작(비차단).
  useEffect(() => {
    if (initialLocale !== undefined) return;
    let cancelled = false;
    async function load() {
      try {
        const res = await apiFetch("/api/v1/auth/me");
        if (!res.ok) return;
        const body = (await res.json()) as {
          data: { user: { language?: string | null } | null };
        };
        if (!cancelled) {
          setLocaleState(resolveLocale(body.data.user?.language));
        }
      } catch {
        // 네트워크 오류 시 기본 로케일 유지.
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [initialLocale]);

  // <html lang> 을 실제 로케일과 맞춘다(스크린리더 발음·번역기 오작동 방지).
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback(
    async (next: Locale) => {
      const prev = locale;
      if (next === prev) return;
      setLocaleState(next); // 낙관적 — 리로드 없이 트리 전체가 즉시 재렌더된다.
      try {
        const res = await apiFetch("/api/v1/auth/me", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ language: next }),
        });
        if (!res.ok) throw new Error("patch failed");
      } catch {
        setLocaleState(prev); // 롤백
        showToast("error", "언어 설정을 저장하지 못했습니다.");
      }
    },
    [locale],
  );

  return (
    <LocaleContext.Provider value={{ locale, setLocale, loading }}>
      <NextIntlClientProvider
        locale={locale}
        messages={getMessages(locale)}
        // 카탈로그는 순수 문자열이라 시간대 의존 포맷이 없다. 명시해 SSR 경고만 억제.
        timeZone="Asia/Seoul"
      >
        {children}
      </NextIntlClientProvider>
    </LocaleContext.Provider>
  );
}
