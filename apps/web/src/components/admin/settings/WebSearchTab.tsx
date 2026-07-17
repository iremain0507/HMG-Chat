"use client";
// components/admin/settings/WebSearchTab.tsx — P14-T6-03 Web Search 탭.
import React from "react";
import {
  LABEL_CLASS,
  INPUT_CLASS,
  ERROR_CLASS,
  CHECKBOX_LABEL_CLASS,
} from "./tabStyles";

export type WebSearchValue = {
  webSearchEnabled: boolean;
  webSearchResultCount: number;
  webSearchProvider: "dev-stub" | "tavily";
  webSearchEndpoint: string;
  webSearchApiKeyRef: string;
};

export type WebSearchErrors = Partial<Record<"webSearchResultCount", string>>;

export interface WebSearchTabProps {
  value: WebSearchValue;
  errors: WebSearchErrors;
  onChange: (patch: Partial<WebSearchValue>) => void;
}

export function WebSearchTab({ value, errors, onChange }: WebSearchTabProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <label className={CHECKBOX_LABEL_CLASS}>
        <input
          type="checkbox"
          data-testid="admin-settings-webSearchEnabled"
          checked={value.webSearchEnabled}
          onChange={(e) => onChange({ webSearchEnabled: e.target.checked })}
        />
        웹 검색 사용(webSearchEnabled)
      </label>

      <label className={LABEL_CLASS}>
        검색 결과 수(webSearchResultCount)
        <input
          type="number"
          data-testid="admin-settings-webSearchResultCount"
          className={INPUT_CLASS}
          value={value.webSearchResultCount}
          onChange={(e) =>
            onChange({ webSearchResultCount: Number(e.target.value) })
          }
        />
        {errors.webSearchResultCount && (
          <span
            data-testid="admin-settings-webSearchResultCount-error"
            className={ERROR_CLASS}
          >
            {errors.webSearchResultCount}
          </span>
        )}
      </label>

      <label className={LABEL_CLASS}>
        검색 제공자(webSearchProvider)
        <select
          data-testid="admin-settings-webSearchProvider"
          className={INPUT_CLASS}
          value={value.webSearchProvider}
          onChange={(e) =>
            onChange({
              webSearchProvider: e.target.value as "dev-stub" | "tavily",
            })
          }
        >
          <option value="dev-stub">dev-stub</option>
          <option value="tavily">tavily</option>
        </select>
      </label>

      <label className={LABEL_CLASS}>
        검색 엔드포인트(webSearchEndpoint)
        <input
          type="text"
          data-testid="admin-settings-webSearchEndpoint"
          className={INPUT_CLASS}
          value={value.webSearchEndpoint}
          onChange={(e) => onChange({ webSearchEndpoint: e.target.value })}
        />
      </label>

      <label className={LABEL_CLASS}>
        API 키 참조(webSearchApiKeyRef)
        <input
          type="text"
          data-testid="admin-settings-webSearchApiKeyRef"
          className={INPUT_CLASS}
          value={value.webSearchApiKeyRef}
          onChange={(e) => onChange({ webSearchApiKeyRef: e.target.value })}
        />
      </label>
    </div>
  );
}
