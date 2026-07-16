"use client";
import React, { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../../../lib/fetch-with-refresh";
import {
  useAdminSettings,
  type AdminOrgSettings,
} from "../../../hooks/useAdminSettings";

interface TabDef {
  id: string;
  label: string;
}

// 개별 탭 필드 바인딩은 T6-02(Models & Generation)/T6-03(나머지 6탭)에서 추가된다.
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
  const [activeTab, setActiveTab] = useState<string>(TABS[0]!.id);
  const [draft, setDraft] = useState<AdminOrgSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (settings) setDraft(settings);
  }, [settings]);

  const isDirty =
    settings !== null &&
    draft !== null &&
    JSON.stringify(draft) !== JSON.stringify(settings);

  const handleSave = useCallback(async () => {
    if (!draft) return;
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
        return;
      }
      await reload();
    } finally {
      setSaving(false);
    }
  }, [draft, reload]);

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
            {TABS.find((tab) => tab.id === activeTab)?.label} 설정 항목은 이후
            태스크에서 추가됩니다.
          </div>
        </>
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
            disabled={saving}
            onClick={() => void handleSave()}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-fg disabled:opacity-60"
          >
            {saving ? "저장 중…" : "저장"}
          </button>
        </div>
      )}
    </section>
  );
}
