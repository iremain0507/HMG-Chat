"use client";

// components/settings/ProfileManager.tsx — P16-T6-05(갭7): /settings/profile 이 없어
// name·customInstructions 를 수정할 표면이 없던 문제 해소. PATCH /auth/me
// (16-API-CONTRACT §1 `PATCH /auth/me`) 배선 — name 1~100자, customInstructions max 2000자.
import React, { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { apiFetch } from "../../lib/fetch-with-refresh";
import { showToast } from "../../lib/toast";
import { useLocaleSetting } from "../i18n/LocaleProvider";
import {
  LOCALE_LABELS,
  SUPPORTED_LOCALES,
  isSupportedLocale,
} from "../../lib/i18n";

const FOCUS_RING =
  "outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)] focus-visible:outline-offset-2";

export function ProfileManager() {
  const t = useTranslations("settings.profile");
  const tCommon = useTranslations("common");
  // P22-T6-15(C11): 언어는 저장 버튼과 무관하게 선택 즉시 적용·저장한다(Open WebUI 와 동일).
  const { locale, setLocale, loading: localeLoading } = useLocaleSetting();
  const [name, setName] = useState("");
  const [customInstructions, setCustomInstructions] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await apiFetch("/api/v1/auth/me");
        if (!res.ok) return;
        const body = (await res.json()) as {
          data: { user: { name: string; customInstructions: string | null } };
        };
        if (!cancelled) {
          setName(body.data.user.name ?? "");
          setCustomInstructions(body.data.user.customInstructions ?? "");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await apiFetch("/api/v1/auth/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          customInstructions: customInstructions || null,
        }),
      });
      if (!res.ok) {
        showToast("error", t("saveFailed"));
        return;
      }
      showToast("success", t("saved"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section>
      <div className="flex items-center gap-2.5">
        <h2 className="text-xl font-bold text-fg">{t("title")}</h2>
        <span className="font-mono text-[11px] text-fg-subtle">
          /settings/profile
        </span>
      </div>

      {loading ? (
        <p className="mt-4 text-sm text-fg-muted">{tCommon("loading")}</p>
      ) : (
        <form onSubmit={handleSave} className="mt-4 max-w-[480px] space-y-4">
          <div>
            <label
              htmlFor="profile-name"
              className="block text-xs font-semibold text-fg-muted"
            >
              {t("name")}
            </label>
            <input
              id="profile-name"
              type="text"
              value={name}
              maxLength={100}
              onChange={(e) => setName(e.target.value)}
              className={`mt-1.5 h-9 w-full rounded-md border border-border px-2.5 text-[13.5px] text-fg ${FOCUS_RING}`}
            />
          </div>

          <div>
            <label
              htmlFor="profile-instructions"
              className="block text-xs font-semibold text-fg-muted"
            >
              {t("customInstructions")}
            </label>
            <textarea
              id="profile-instructions"
              value={customInstructions}
              maxLength={2000}
              onChange={(e) => setCustomInstructions(e.target.value)}
              rows={5}
              className={`mt-1.5 w-full rounded-md border border-border p-2.5 text-[13.5px] leading-relaxed text-fg ${FOCUS_RING}`}
            />
          </div>

          {/* P22-T6-15(C11) 언어 — 저장 버튼과 독립. 선택 즉시 UI 가 리로드 없이 재렌더되고
              PATCH /auth/me 로 계정에 저장돼 재로그인 후에도 유지된다. */}
          <div>
            <label
              htmlFor="profile-language"
              className="block text-xs font-semibold text-fg-muted"
            >
              {t("language")}
            </label>
            <select
              id="profile-language"
              value={locale}
              disabled={localeLoading}
              onChange={(e) => {
                const next = e.target.value;
                if (isSupportedLocale(next)) void setLocale(next);
              }}
              className={`mt-1.5 h-9 w-full rounded-md border border-border bg-bg px-2.5 text-[13.5px] text-fg disabled:opacity-60 ${FOCUS_RING}`}
            >
              {SUPPORTED_LOCALES.map((loc) => (
                <option key={loc} value={loc}>
                  {LOCALE_LABELS[loc]}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-xs text-fg-subtle">{t("languageHint")}</p>
          </div>

          <button
            type="submit"
            disabled={saving}
            className={`h-9 rounded-md bg-primary px-4 text-[13px] font-semibold text-primary-fg disabled:opacity-60 ${FOCUS_RING}`}
          >
            {saving ? t("saving") : t("save")}
          </button>
        </form>
      )}
    </section>
  );
}
