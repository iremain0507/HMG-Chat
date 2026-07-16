"use client";
// components/admin/settings/ModelsGenerationTab.tsx — P14-T6-02 Models & Generation 탭.
//   org_settings 기반 필드(maxTokens/temperature/topP/defaultModel/systemPrompt/toolMaxTokens)만
//   저장 가능. allowedModels 는 organizations 컬럼(§14-INTERFACES Organization)이고 이를
//   admin 이 PUT 으로 편집할 라우트가 이 phase 표(routes/admin-settings.ts 는 T1-05 전용) 밖이라
//   읽기 전용 노출로 격리 — 여기서 저장하는 척 하면 L5(조용한 실패)가 된다.
import React from "react";
import type { AdminOrgSettings } from "../../../hooks/useAdminSettings";

export type ModelsGenerationErrors = Partial<
  Record<"maxTokens" | "temperature" | "topP" | "toolMaxTokens", string>
>;

export interface ModelsGenerationTabProps {
  value: AdminOrgSettings;
  errors: ModelsGenerationErrors;
  orgAllowedModels: string[];
  onChange: (patch: Partial<AdminOrgSettings>) => void;
}

const LABEL_CLASS = "block text-xs font-medium text-fg-muted";
const INPUT_CLASS =
  "mt-1 w-full rounded-md border border-border bg-bg px-2.5 py-1.5 text-sm text-fg outline-none focus-visible:border-primary-400";
const ERROR_CLASS = "mt-1 block text-xs text-accent";
const HINT_CLASS = "mt-1 block text-xs text-fg-subtle";

export function ModelsGenerationTab({
  value,
  errors,
  orgAllowedModels,
  onChange,
}: ModelsGenerationTabProps) {
  const modelOptions = orgAllowedModels.includes(value.defaultModel)
    ? orgAllowedModels
    : [value.defaultModel, ...orgAllowedModels];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <label className={LABEL_CLASS}>
        최대 응답 토큰(maxTokens)
        <input
          type="number"
          data-testid="admin-settings-maxTokens"
          className={INPUT_CLASS}
          value={value.maxTokens}
          onChange={(e) => onChange({ maxTokens: Number(e.target.value) })}
        />
        {errors.maxTokens && (
          <span
            data-testid="admin-settings-maxTokens-error"
            className={ERROR_CLASS}
          >
            {errors.maxTokens}
          </span>
        )}
      </label>

      <label className={LABEL_CLASS}>
        temperature
        <input
          type="number"
          step="0.1"
          data-testid="admin-settings-temperature"
          className={INPUT_CLASS}
          value={value.temperature}
          onChange={(e) => onChange({ temperature: Number(e.target.value) })}
        />
        {errors.temperature && (
          <span
            data-testid="admin-settings-temperature-error"
            className={ERROR_CLASS}
          >
            {errors.temperature}
          </span>
        )}
      </label>

      <label className={LABEL_CLASS}>
        topP
        <input
          type="number"
          step="0.1"
          data-testid="admin-settings-topP"
          className={INPUT_CLASS}
          value={value.topP}
          onChange={(e) => onChange({ topP: Number(e.target.value) })}
        />
        {errors.topP && (
          <span data-testid="admin-settings-topP-error" className={ERROR_CLASS}>
            {errors.topP}
          </span>
        )}
        <span data-testid="admin-settings-topP-hint" className={HINT_CLASS}>
          아직 미적용 — 저장은 되지만 응답 생성에는 반영되지 않습니다.
        </span>
      </label>

      <label className={LABEL_CLASS}>
        기본 모델(defaultModel)
        <select
          data-testid="admin-settings-defaultModel"
          className={INPUT_CLASS}
          value={value.defaultModel}
          onChange={(e) => onChange({ defaultModel: e.target.value })}
        >
          {modelOptions.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>

      <label className={LABEL_CLASS}>
        도구 응답 최대 토큰(toolMaxTokens)
        <input
          type="number"
          data-testid="admin-settings-toolMaxTokens"
          className={INPUT_CLASS}
          value={value.toolMaxTokens}
          onChange={(e) => onChange({ toolMaxTokens: Number(e.target.value) })}
        />
        {errors.toolMaxTokens && (
          <span
            data-testid="admin-settings-toolMaxTokens-error"
            className={ERROR_CLASS}
          >
            {errors.toolMaxTokens}
          </span>
        )}
      </label>

      <label className={`${LABEL_CLASS} sm:col-span-2`}>
        시스템 프롬프트(systemPrompt)
        <textarea
          data-testid="admin-settings-systemPrompt"
          rows={4}
          className={INPUT_CLASS}
          value={value.systemPrompt}
          onChange={(e) => onChange({ systemPrompt: e.target.value })}
        />
      </label>

      <div className="sm:col-span-2">
        <span className={LABEL_CLASS}>허용 모델(allowedModels)</span>
        <div
          data-testid="admin-settings-allowedModels-list"
          className="mt-1 flex flex-wrap gap-1.5"
        >
          {orgAllowedModels.length === 0 ? (
            <span className="text-xs text-fg-subtle">
              설정된 허용 모델이 없습니다.
            </span>
          ) : (
            orgAllowedModels.map((m) => (
              <span
                key={m}
                className="rounded-full border border-border bg-surface px-2 py-0.5 font-mono text-[11px] text-fg-muted"
              >
                {m}
              </span>
            ))
          )}
        </div>
        <span
          data-testid="admin-settings-allowedModels-hint"
          className={HINT_CLASS}
        >
          이 화면에서는 읽기 전용입니다. 조직 허용 모델 변경은 별도 관리 절차가
          필요합니다.
        </span>
      </div>
    </div>
  );
}
