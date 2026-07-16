"use client";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../../lib/fetch-with-refresh";
import { showToast } from "../../../lib/toast";
import { useCurrentUser } from "../../../hooks/useCurrentUser";
import {
  useAdminSettings,
  type AdminOrgSettings,
} from "../../../hooks/useAdminSettings";
import {
  ModelsGenerationTab,
  type ModelsGenerationErrors,
} from "./ModelsGenerationTab";
import { KnowledgeRagTab, type KnowledgeRagErrors } from "./KnowledgeRagTab";
import { WebSearchTab, type WebSearchErrors } from "./WebSearchTab";
import { ConnectorsTab } from "./ConnectorsTab";
import { BrandingTab, type BrandingErrors } from "./BrandingTab";
import { PermissionsTab } from "./PermissionsTab";
import { QuotaTab, type QuotaErrors } from "./QuotaTab";

interface TabDef {
  id: string;
  label: string;
}

const MAX_TOKENS_LIMIT = 128_000;

type AllErrors = ModelsGenerationErrors &
  KnowledgeRagErrors &
  WebSearchErrors &
  BrandingErrors &
  QuotaErrors;

function validateFields(s: AdminOrgSettings): AllErrors {
  const errors: AllErrors = {};
  if (
    !Number.isInteger(s.maxTokens) ||
    s.maxTokens < 1 ||
    s.maxTokens > MAX_TOKENS_LIMIT
  ) {
    errors.maxTokens = `1~${MAX_TOKENS_LIMIT.toLocaleString()} 사이의 정수를 입력하세요.`;
  }
  if (
    !Number.isFinite(s.temperature) ||
    s.temperature < 0 ||
    s.temperature > 1
  ) {
    errors.temperature = "0~1 사이 값을 입력하세요.";
  }
  if (!Number.isFinite(s.topP) || s.topP < 0 || s.topP > 1) {
    errors.topP = "0~1 사이 값을 입력하세요.";
  }
  if (
    !Number.isInteger(s.toolMaxTokens) ||
    s.toolMaxTokens < 1 ||
    s.toolMaxTokens > MAX_TOKENS_LIMIT
  ) {
    errors.toolMaxTokens = `1~${MAX_TOKENS_LIMIT.toLocaleString()} 사이의 정수를 입력하세요.`;
  }
  if (!Number.isInteger(s.ragTopK) || s.ragTopK < 1 || s.ragTopK > 100) {
    errors.ragTopK = "1~100 사이의 정수를 입력하세요.";
  }
  if (!Number.isInteger(s.ragRrfK) || s.ragRrfK < 1 || s.ragRrfK > 1000) {
    errors.ragRrfK = "1~1,000 사이의 정수를 입력하세요.";
  }
  if (
    !Number.isInteger(s.ragChunkSizeTokens) ||
    s.ragChunkSizeTokens < 50 ||
    s.ragChunkSizeTokens > 8000
  ) {
    errors.ragChunkSizeTokens = "50~8,000 사이의 정수를 입력하세요.";
  }
  if (
    !Number.isInteger(s.ragChunkOverlapTokens) ||
    s.ragChunkOverlapTokens < 0 ||
    s.ragChunkOverlapTokens > 4000
  ) {
    errors.ragChunkOverlapTokens = "0~4,000 사이의 정수를 입력하세요.";
  }
  if (
    !Number.isFinite(s.ragRelevanceThreshold) ||
    s.ragRelevanceThreshold < 0 ||
    s.ragRelevanceThreshold > 1
  ) {
    errors.ragRelevanceThreshold = "0~1 사이 값을 입력하세요.";
  }
  if (
    !Number.isInteger(s.webSearchResultCount) ||
    s.webSearchResultCount < 1 ||
    s.webSearchResultCount > 20
  ) {
    errors.webSearchResultCount = "1~20 사이의 정수를 입력하세요.";
  }
  if (s.instanceName.trim().length < 1 || s.instanceName.length > 120) {
    errors.instanceName = "1~120자 사이로 입력하세요.";
  }
  if (
    !Number.isInteger(s.maxUploadSizeMb) ||
    s.maxUploadSizeMb < 1 ||
    s.maxUploadSizeMb > 1000
  ) {
    errors.maxUploadSizeMb = "1~1,000 사이의 정수를 입력하세요.";
  }
  if (
    !Number.isInteger(s.maxUploadCount) ||
    s.maxUploadCount < 1 ||
    s.maxUploadCount > 100
  ) {
    errors.maxUploadCount = "1~100 사이의 정수를 입력하세요.";
  }
  return errors;
}

const TABS: TabDef[] = [
  { id: "models", label: "Models & Generation" },
  { id: "rag", label: "Knowledge/RAG" },
  { id: "web-search", label: "Web Search" },
  { id: "connectors", label: "Connectors/MCP" },
  { id: "branding", label: "General/Branding" },
  { id: "permissions", label: "Users & Permissions" },
  { id: "quota", label: "Quota/Limits" },
];

export function AdminSettingsScreen() {
  const { settings, loading, error, reload } = useAdminSettings();
  const { org } = useCurrentUser();
  const [activeTab, setActiveTab] = useState<string>(TABS[0]!.id);
  const [draft, setDraft] = useState<AdminOrgSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmDowngrade, setConfirmDowngrade] = useState(false);

  useEffect(() => {
    if (settings) setDraft(settings);
  }, [settings]);

  const isDirty =
    settings !== null &&
    draft !== null &&
    JSON.stringify(draft) !== JSON.stringify(settings);

  const errors = useMemo(() => (draft ? validateFields(draft) : {}), [draft]);
  const hasErrors = Object.keys(errors).length > 0;
  const isDowngrade =
    settings !== null && draft !== null && draft.maxTokens < settings.maxTokens;

  const performSave = useCallback(async () => {
    if (!draft) return;
    const previous = settings;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await apiFetch("/api/v1/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!res.ok) {
        setSaveError("설정을 저장하지 못했습니다.");
        showToast("error", "설정을 저장하지 못했습니다.");
        if (previous) setDraft(previous);
        return;
      }
      showToast("success", "설정을 저장했습니다.");
      await reload();
    } catch {
      setSaveError("설정을 저장하지 못했습니다.");
      showToast("error", "설정을 저장하지 못했습니다.");
      if (previous) setDraft(previous);
    } finally {
      setSaving(false);
      setConfirmDowngrade(false);
    }
  }, [draft, settings, reload]);

  const handleSaveClick = useCallback(() => {
    if (hasErrors || !draft) return;
    if (isDowngrade) {
      setConfirmDowngrade(true);
      return;
    }
    void performSave();
  }, [hasErrors, draft, isDowngrade, performSave]);

  return (
    <section>
      <div className="flex items-center gap-2.5">
        <h2 className="text-xl font-bold text-fg">관리자 설정</h2>
        <span className="font-mono text-[11px] text-fg-subtle">
          /admin/settings
        </span>
      </div>

      {error && <p className="mt-3 text-sm text-accent">{error}</p>}
      {saveError && <p className="mt-3 text-sm text-accent">{saveError}</p>}

      {loading ? (
        <p className="mt-4 text-sm text-fg-muted">불러오는 중…</p>
      ) : (
        <>
          <div
            role="tablist"
            aria-label="관리자 설정 탭"
            className="mt-4 flex flex-wrap gap-1 border-b border-border"
          >
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={tab.id === activeTab}
                data-testid={`admin-settings-tab-${tab.id}`}
                onClick={() => setActiveTab(tab.id)}
                className={`px-3 pb-2 text-sm font-medium transition-colors ${
                  tab.id === activeTab
                    ? "border-b-2 border-primary text-primary"
                    : "text-fg-muted hover:text-fg"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div
            role="tabpanel"
            data-testid={`admin-settings-panel-${activeTab}`}
            className="mt-4 min-h-[120px] rounded-lg border border-border p-4 text-sm text-fg-muted"
          >
            {draft &&
              (() => {
                const onChange = (patch: Partial<AdminOrgSettings>) =>
                  setDraft((prev) => (prev ? { ...prev, ...patch } : prev));
                switch (activeTab) {
                  case "models":
                    return (
                      <ModelsGenerationTab
                        value={draft}
                        errors={errors}
                        orgAllowedModels={org?.allowedModels ?? []}
                        onChange={onChange}
                      />
                    );
                  case "rag":
                    return (
                      <KnowledgeRagTab
                        value={draft}
                        errors={errors}
                        onChange={onChange}
                      />
                    );
                  case "web-search":
                    return (
                      <WebSearchTab
                        value={draft}
                        errors={errors}
                        onChange={onChange}
                      />
                    );
                  case "connectors":
                    return (
                      <ConnectorsTab
                        value={draft}
                        orgAllowedTools={org?.allowedTools ?? []}
                        onChange={onChange}
                      />
                    );
                  case "branding":
                    return (
                      <BrandingTab
                        value={draft}
                        errors={errors}
                        onChange={onChange}
                      />
                    );
                  case "permissions":
                    return <PermissionsTab value={draft} onChange={onChange} />;
                  case "quota":
                    return (
                      <QuotaTab
                        value={draft}
                        errors={errors}
                        orgDefaultTokenBudgetMicros={
                          org?.defaultTokenBudgetMicros ?? null
                        }
                        onChange={onChange}
                      />
                    );
                  default:
                    return null;
                }
              })()}
          </div>
        </>
      )}

      {isDirty && confirmDowngrade && (
        <div
          role="alertdialog"
          aria-label="설정 하향 확인"
          data-testid="admin-settings-downgrade-confirm"
          className="mt-4 rounded-lg border border-warning bg-warning-soft p-3"
        >
          <p className="text-sm text-fg">
            maxTokens 를 낮추면 응답이 더 짧게 잘립니다. 계속 저장하시겠습니까?
          </p>
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              data-testid="admin-settings-downgrade-cancel"
              onClick={() => setConfirmDowngrade(false)}
              className="rounded-md px-2.5 py-1 text-xs font-medium text-fg-muted hover:text-fg"
            >
              취소
            </button>
            <button
              type="button"
              data-testid="admin-settings-downgrade-confirm-accept"
              onClick={() => void performSave()}
              className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-white hover:opacity-90"
            >
              계속 저장
            </button>
          </div>
        </div>
      )}

      {isDirty && (
        <div
          data-testid="admin-settings-save-bar"
          className="sticky bottom-0 mt-6 flex items-center justify-end gap-2.5 border-t border-border bg-surface px-4 py-3"
        >
          <span className="text-sm text-fg-muted">
            저장하지 않은 변경사항이 있습니다.
          </span>
          <button
            type="button"
            data-testid="admin-settings-save-button"
            disabled={saving || hasErrors}
            title={hasErrors ? "입력 값을 확인하세요." : undefined}
            onClick={handleSaveClick}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-fg disabled:opacity-60"
          >
            {saving ? "저장 중…" : "저장"}
          </button>
        </div>
      )}
    </section>
  );
}
