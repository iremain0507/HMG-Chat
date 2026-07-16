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
    </div>
  );
}
