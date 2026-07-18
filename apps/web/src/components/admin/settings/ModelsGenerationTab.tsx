"use client";
// components/admin/settings/ModelsGenerationTab.tsx — P14-T6-02 Models & Generation 탭.
//   org_settings 기반 필드(maxTokens/temperature/topP/defaultModel/systemPrompt/toolMaxTokens)는
//   부모(AdminSettingsScreen)의 draft/저장 흐름을 따른다. allowedModels 는 organizations
//   컬럼(§14-INTERFACES Organization)이라 별도 엔드포인트(P19-T1-09 GET/PUT
//   /api/v1/admin/models)를 이 컴포넌트가 직접 호출해 자체 저장한다(칩 추가/제거 + 저장,
//   실패 시 롤백).
import React, { useEffect, useState } from "react";
import type { AdminOrgSettings } from "../../../hooks/useAdminSettings";
import { apiFetch } from "../../../lib/fetch-with-refresh";
import { showToast } from "../../../lib/toast";

export type ModelsGenerationErrors = Partial<
  Record<"maxTokens" | "temperature" | "topP" | "toolMaxTokens", string>
>;

export interface ModelsGenerationTabProps {
  value: AdminOrgSettings;
  errors: ModelsGenerationErrors;
  orgAllowedModels: string[];
  onChange: (patch: Partial<AdminOrgSettings>) => void;
}

// 빈 입력을 Number("")=0 으로 무음 강제하지 않기 위해 NaN 을 대신 전달한다 —
// 상위 validateFields 의 !Number.isInteger/!Number.isFinite 가 NaN 을 이미 걸러내
// 필드 에러로 표시한다(UX-23).
function parseNumberField(raw: string): number {
  return raw.trim() === "" ? NaN : Number(raw);
}

const LABEL_CLASS = "block text-xs font-medium text-fg-muted";
const INPUT_CLASS =
  "mt-1 w-full rounded-md border border-border bg-bg px-2.5 py-1.5 text-sm text-fg outline-none focus-visible:border-primary-400";
const ERROR_CLASS = "mt-1 block text-xs text-accent";
const HINT_CLASS = "mt-1 block text-xs text-fg-subtle";
const CHECKBOX_LABEL_CLASS =
  "flex items-center gap-2 text-xs font-medium text-fg-muted";

export function ModelsGenerationTab({
  value,
  errors,
  orgAllowedModels,
  onChange,
}: ModelsGenerationTabProps) {
  const [models, setModels] = useState<string[]>(orgAllowedModels);
  const [newModel, setNewModel] = useState("");
  const [saving, setSaving] = useState(false);

  const orgAllowedModelsKey = JSON.stringify(orgAllowedModels);
  useEffect(() => {
    setModels(orgAllowedModels);
    // orgAllowedModelsKey(내용) 에만 의존 — orgAllowedModels 배열 참조가 매 렌더 바뀌어도
    // 내용이 같으면(다른 탭 편집으로 인한 부모 리렌더) 로컬 편집을 리셋하지 않는다.
  }, [orgAllowedModelsKey]);

  const modelsDirty =
    JSON.stringify(models) !== JSON.stringify(orgAllowedModels);

  function addModel() {
    const trimmed = newModel.trim();
    if (!trimmed || models.includes(trimmed)) return;
    setModels((prev) => [...prev, trimmed]);
    setNewModel("");
  }

  function removeModel(model: string) {
    setModels((prev) => prev.filter((m) => m !== model));
  }

  async function saveModels() {
    setSaving(true);
    try {
      const res = await apiFetch("/api/v1/admin/models", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allowedModels: models }),
      });
      if (!res.ok) {
        setModels(orgAllowedModels);
        showToast("error", "허용 모델을 저장하지 못했습니다.");
        return;
      }
      const json = (await res.json()) as { data: { allowedModels: string[] } };
      setModels(json.data.allowedModels);
      showToast("success", "허용 모델을 저장했습니다.");
    } catch {
      setModels(orgAllowedModels);
      showToast("error", "허용 모델을 저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  const modelOptions = models.includes(value.defaultModel)
    ? models
    : [value.defaultModel, ...models];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <label className={LABEL_CLASS}>
        최대 응답 토큰(maxTokens)
        <input
          type="number"
          data-testid="admin-settings-maxTokens"
          className={INPUT_CLASS}
          value={value.maxTokens}
          onChange={(e) =>
            onChange({ maxTokens: parseNumberField(e.target.value) })
          }
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
          onChange={(e) =>
            onChange({ temperature: parseNumberField(e.target.value) })
          }
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
          onChange={(e) => onChange({ topP: parseNumberField(e.target.value) })}
        />
        {errors.topP && (
          <span data-testid="admin-settings-topP-error" className={ERROR_CLASS}>
            {errors.topP}
          </span>
        )}
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
          onChange={(e) =>
            onChange({ toolMaxTokens: parseNumberField(e.target.value) })
          }
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

      {/* P22-T1-08 — 이미지 생성(image_generate) org 게이트. 켜면 채팅에서 모델이 이미지를
          생성해 인라인 표시한다(끄면 도구 자체가 조립되지 않음). webSearchEnabled 와 동일 토글 패턴. */}
      <label className={`${CHECKBOX_LABEL_CLASS} sm:col-span-2`}>
        <input
          type="checkbox"
          data-testid="admin-settings-imageGenEnabled"
          checked={value.imageGenEnabled ?? false}
          onChange={(e) => onChange({ imageGenEnabled: e.target.checked })}
        />
        이미지 생성 사용(imageGenEnabled)
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
          {models.length === 0 ? (
            <span className="text-xs text-fg-subtle">
              설정된 허용 모델이 없습니다.
            </span>
          ) : (
            models.map((m) => (
              <span
                key={m}
                className="flex items-center gap-1 rounded-full border border-border bg-surface px-2 py-0.5 font-mono text-[11px] text-fg-muted"
              >
                {m}
                <button
                  type="button"
                  aria-label={`${m} 제거`}
                  data-testid={`admin-settings-allowedModels-remove-${m}`}
                  onClick={() => removeModel(m)}
                  className="text-fg-subtle hover:text-accent"
                >
                  ×
                </button>
              </span>
            ))
          )}
        </div>
        <div className="mt-1.5 flex gap-1.5">
          <input
            type="text"
            aria-label="허용 모델 추가"
            data-testid="admin-settings-allowedModels-input"
            className={`${INPUT_CLASS} mt-0 flex-1`}
            value={newModel}
            onChange={(e) => setNewModel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addModel();
              }
            }}
          />
          <button
            type="button"
            data-testid="admin-settings-allowedModels-add"
            onClick={addModel}
            className="rounded-md border border-border px-2.5 text-xs font-medium text-fg hover:bg-surface"
          >
            추가
          </button>
        </div>
        <span
          data-testid="admin-settings-allowedModels-hint"
          className={HINT_CLASS}
        >
          모델 ID 를 입력하고 Enter 또는 추가 버튼으로 등록한 뒤 저장하세요.
        </span>
        <div className="mt-1.5">
          <button
            type="button"
            data-testid="admin-settings-allowedModels-save"
            disabled={!modelsDirty || saving}
            onClick={() => void saveModels()}
            className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-fg disabled:opacity-60"
          >
            {saving ? "저장 중…" : "허용 모델 저장"}
          </button>
        </div>
      </div>
    </div>
  );
}
