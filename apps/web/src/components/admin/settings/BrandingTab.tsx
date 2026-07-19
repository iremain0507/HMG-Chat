"use client";
// components/admin/settings/BrandingTab.tsx — P14-T6-03 General/Branding 탭.
//   P20-T6-04: 서버(org-settings-schema.ts BannerSchema)가 지원하는 typed 다중 배너를
//   저작할 수 있도록 평문 단일 textarea 를 리스트 에디터로 교체. AppBanner 타입은
//   layout/Banner.tsx(사용자 실표시 컴포넌트)와 공유해 저작 값과 표시 값의 shape 을 일치시킨다.
import React from "react";
import {
  LABEL_CLASS,
  INPUT_CLASS,
  ERROR_CLASS,
  CHECKBOX_LABEL_CLASS,
  HINT_CLASS,
} from "./tabStyles";
import type { AppBanner } from "../../layout/Banner";

export type BrandingValue = {
  instanceName: string;
  banner: AppBanner[];
  responseWatermark: string;
};

export type BrandingErrors = Partial<Record<"instanceName", string>>;

export interface BrandingTabProps {
  value: BrandingValue;
  errors: BrandingErrors;
  onChange: (patch: Partial<BrandingValue>) => void;
}

const BANNER_TYPES: AppBanner["type"][] = [
  "info",
  "success",
  "warning",
  "error",
];

function emptyBanner(): AppBanner {
  return { type: "info", title: "", content: "", dismissible: true };
}

export function BrandingTab({ value, errors, onChange }: BrandingTabProps) {
  const banners = value.banner;

  const updateBanner = (index: number, patch: Partial<AppBanner>) => {
    onChange({
      banner: banners.map((b, i) => (i === index ? { ...b, ...patch } : b)),
    });
  };

  const addBanner = () => {
    onChange({ banner: [...banners, emptyBanner()] });
  };

  const removeBanner = (index: number) => {
    onChange({ banner: banners.filter((_, i) => i !== index) });
  };

  const moveBanner = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= banners.length) return;
    const next = [...banners];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item!);
    onChange({ banner: next });
  };

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <label className={LABEL_CLASS}>
        인스턴스 이름(instanceName)
        <input
          type="text"
          data-testid="admin-settings-instanceName"
          className={INPUT_CLASS}
          value={value.instanceName}
          onChange={(e) => onChange({ instanceName: e.target.value })}
        />
        {errors.instanceName && (
          <span
            data-testid="admin-settings-instanceName-error"
            className={ERROR_CLASS}
          >
            {errors.instanceName}
          </span>
        )}
      </label>

      <label className={`${LABEL_CLASS} sm:col-span-2`}>
        응답 워터마크(responseWatermark)
        <input
          type="text"
          data-testid="admin-settings-responseWatermark"
          className={INPUT_CLASS}
          value={value.responseWatermark}
          onChange={(e) => onChange({ responseWatermark: e.target.value })}
        />
      </label>

      <div className="sm:col-span-2">
        <div className="flex items-center justify-between">
          <span className={LABEL_CLASS}>배너(banner)</span>
          <button
            type="button"
            data-testid="admin-settings-banner-add"
            onClick={addBanner}
            className="rounded-md border border-border px-2 py-1 text-xs font-medium text-fg-muted hover:text-fg"
          >
            + 배너 추가
          </button>
        </div>

        {banners.length === 0 ? (
          <p className={HINT_CLASS}>등록된 배너가 없습니다.</p>
        ) : (
          <div className="mt-2 flex flex-col gap-3">
            {banners.map((banner, i) => (
              <div
                key={i}
                data-testid={`admin-settings-banner-${i}`}
                className="rounded-md border border-border p-3"
              >
                <div className="flex items-center gap-2">
                  <select
                    data-testid={`admin-settings-banner-${i}-type`}
                    className={INPUT_CLASS}
                    value={banner.type}
                    onChange={(e) =>
                      updateBanner(i, {
                        type: e.target.value as AppBanner["type"],
                      })
                    }
                  >
                    {BANNER_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>

                  <div className="ml-auto flex items-center gap-1">
                    <button
                      type="button"
                      data-testid={`admin-settings-banner-${i}-up`}
                      disabled={i === 0}
                      onClick={() => moveBanner(i, -1)}
                      className="rounded p-1 text-xs text-fg-muted hover:text-fg disabled:opacity-40"
                      aria-label="위로 이동"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      data-testid={`admin-settings-banner-${i}-down`}
                      disabled={i === banners.length - 1}
                      onClick={() => moveBanner(i, 1)}
                      className="rounded p-1 text-xs text-fg-muted hover:text-fg disabled:opacity-40"
                      aria-label="아래로 이동"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      data-testid={`admin-settings-banner-${i}-remove`}
                      onClick={() => removeBanner(i)}
                      className="rounded p-1 text-xs text-accent hover:opacity-80"
                      aria-label="배너 삭제"
                    >
                      삭제
                    </button>
                  </div>
                </div>

                <label className={`${LABEL_CLASS} mt-2 block`}>
                  제목(title)
                  <input
                    type="text"
                    data-testid={`admin-settings-banner-${i}-title`}
                    className={INPUT_CLASS}
                    value={banner.title ?? ""}
                    onChange={(e) => updateBanner(i, { title: e.target.value })}
                  />
                </label>

                <label className={`${LABEL_CLASS} mt-2 block`}>
                  내용(content)
                  <input
                    type="text"
                    data-testid={`admin-settings-banner-${i}-content`}
                    className={INPUT_CLASS}
                    value={banner.content}
                    onChange={(e) =>
                      updateBanner(i, { content: e.target.value })
                    }
                  />
                </label>

                <label className={`${CHECKBOX_LABEL_CLASS} mt-2`}>
                  <input
                    type="checkbox"
                    data-testid={`admin-settings-banner-${i}-dismissible`}
                    checked={banner.dismissible}
                    onChange={(e) =>
                      updateBanner(i, { dismissible: e.target.checked })
                    }
                  />
                  닫기 가능(dismissible)
                </label>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
