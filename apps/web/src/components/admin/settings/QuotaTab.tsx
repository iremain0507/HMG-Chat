"use client";
// components/admin/settings/QuotaTab.tsx — P14-T6-03 Quota/Limits 탭.
//   defaultTokenBudgetMicros 는 organizations 컬럼이라 allowedModels 와 동일하게 읽기 전용.
import React from "react";
import { LABEL_CLASS, INPUT_CLASS, ERROR_CLASS, HINT_CLASS } from "./tabStyles";

export type QuotaValue = { maxUploadSizeMb: number; maxUploadCount: number };

export type QuotaErrors = Partial<Record<keyof QuotaValue, string>>;

export interface QuotaTabProps {
  value: QuotaValue;
  errors: QuotaErrors;
  orgDefaultTokenBudgetMicros: number | null;
  onChange: (patch: Partial<QuotaValue>) => void;
}

export function QuotaTab({
  value,
  errors,
  orgDefaultTokenBudgetMicros,
  onChange,
}: QuotaTabProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <label className={LABEL_CLASS}>
        최대 업로드 용량(MB, maxUploadSizeMb)
        <input
          type="number"
          data-testid="admin-settings-maxUploadSizeMb"
          className={INPUT_CLASS}
          value={value.maxUploadSizeMb}
          onChange={(e) =>
            onChange({ maxUploadSizeMb: Number(e.target.value) })
          }
        />
        {errors.maxUploadSizeMb && (
          <span
            data-testid="admin-settings-maxUploadSizeMb-error"
            className={ERROR_CLASS}
          >
            {errors.maxUploadSizeMb}
          </span>
        )}
      </label>

      <label className={LABEL_CLASS}>
        최대 업로드 개수(maxUploadCount)
        <input
          type="number"
          data-testid="admin-settings-maxUploadCount"
          className={INPUT_CLASS}
          value={value.maxUploadCount}
          onChange={(e) => onChange({ maxUploadCount: Number(e.target.value) })}
        />
        {errors.maxUploadCount && (
          <span
            data-testid="admin-settings-maxUploadCount-error"
            className={ERROR_CLASS}
          >
            {errors.maxUploadCount}
          </span>
        )}
      </label>

      <div className="sm:col-span-2">
        <span className={LABEL_CLASS}>
          기본 토큰 예산(defaultTokenBudgetMicros)
        </span>
        <p
          data-testid="admin-settings-defaultTokenBudgetMicros"
          className="mt-1 font-mono text-sm text-fg"
        >
          {orgDefaultTokenBudgetMicros === null
            ? "제한 없음"
            : orgDefaultTokenBudgetMicros}
        </p>
        <span
          data-testid="admin-settings-defaultTokenBudgetMicros-hint"
          className={HINT_CLASS}
        >
          이 화면에서는 읽기 전용입니다. 조직 토큰 예산 변경은 별도 관리 절차가
          필요합니다.
        </span>
      </div>
    </div>
  );
}
