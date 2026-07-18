"use client";
// components/admin/settings/ConnectorsTab.tsx — P14-T6-03 Connectors/MCP 탭.
//   allowedTools 는 organizations 컬럼(§14-INTERFACES Organization)이라 ModelsGenerationTab
//   의 allowedModels 와 동일하게 별도 엔드포인트(P22-T6-02 GET/PUT /api/v1/admin/tools)를
//   이 컴포넌트가 직접 호출해 자체 저장한다(칩 추가/제거 + 저장, 실패 시 롤백).
import React, { useEffect, useState } from "react";
import { apiFetch } from "../../../lib/fetch-with-refresh";
import { showToast } from "../../../lib/toast";
import {
  CHECKBOX_LABEL_CLASS,
  LABEL_CLASS,
  HINT_CLASS,
  INPUT_CLASS,
} from "./tabStyles";

export type ConnectorsValue = { enableDirectConnections: boolean };

export interface ConnectorsTabProps {
  value: ConnectorsValue;
  orgAllowedTools: string[];
  onChange: (patch: Partial<ConnectorsValue>) => void;
}

export function ConnectorsTab({
  value,
  orgAllowedTools,
  onChange,
}: ConnectorsTabProps) {
  const [tools, setTools] = useState<string[]>(orgAllowedTools);
  const [newTool, setNewTool] = useState("");
  const [saving, setSaving] = useState(false);

  const orgAllowedToolsKey = JSON.stringify(orgAllowedTools);
  useEffect(() => {
    setTools(orgAllowedTools);
    // orgAllowedToolsKey(내용) 에만 의존 — 배열 참조가 매 렌더 바뀌어도 내용이 같으면
    // (다른 탭 편집으로 인한 부모 리렌더) 로컬 편집을 리셋하지 않는다.
  }, [orgAllowedToolsKey]);

  const toolsDirty = JSON.stringify(tools) !== JSON.stringify(orgAllowedTools);

  function addTool() {
    const trimmed = newTool.trim();
    if (!trimmed || tools.includes(trimmed)) return;
    setTools((prev) => [...prev, trimmed]);
    setNewTool("");
  }

  function removeTool(tool: string) {
    setTools((prev) => prev.filter((t) => t !== tool));
  }

  async function saveTools() {
    setSaving(true);
    try {
      const res = await apiFetch("/api/v1/admin/tools", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allowedTools: tools }),
      });
      if (!res.ok) {
        setTools(orgAllowedTools);
        showToast("error", "허용 도구를 저장하지 못했습니다.");
        return;
      }
      const json = (await res.json()) as { data: { allowedTools: string[] } };
      setTools(json.data.allowedTools);
      showToast("success", "허용 도구를 저장했습니다.");
    } catch {
      setTools(orgAllowedTools);
      showToast("error", "허용 도구를 저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <label className={CHECKBOX_LABEL_CLASS}>
        <input
          type="checkbox"
          data-testid="admin-settings-enableDirectConnections"
          checked={value.enableDirectConnections}
          onChange={(e) =>
            onChange({ enableDirectConnections: e.target.checked })
          }
        />
        직접 연결 허용(enableDirectConnections)
      </label>

      <div className="sm:col-span-2">
        <span className={LABEL_CLASS}>허용 도구(allowedTools)</span>
        <div
          data-testid="admin-settings-allowedTools-list"
          className="mt-1 flex flex-wrap gap-1.5"
        >
          {tools.length === 0 ? (
            <span className="text-xs text-fg-subtle">
              설정된 허용 도구가 없습니다.
            </span>
          ) : (
            tools.map((t) => (
              <span
                key={t}
                className="flex items-center gap-1 rounded-full border border-border bg-surface px-2 py-0.5 font-mono text-[11px] text-fg-muted"
              >
                {t}
                <button
                  type="button"
                  aria-label={`${t} 제거`}
                  data-testid={`admin-settings-allowedTools-remove-${t}`}
                  onClick={() => removeTool(t)}
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
            aria-label="허용 도구 추가"
            data-testid="admin-settings-allowedTools-input"
            className={`${INPUT_CLASS} mt-0 flex-1`}
            value={newTool}
            onChange={(e) => setNewTool(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addTool();
              }
            }}
          />
          <button
            type="button"
            data-testid="admin-settings-allowedTools-add"
            onClick={addTool}
            className="rounded-md border border-border px-2.5 text-xs font-medium text-fg hover:bg-surface"
          >
            추가
          </button>
        </div>
        <span
          data-testid="admin-settings-allowedTools-hint"
          className={HINT_CLASS}
        >
          도구 ID 를 입력하고 Enter 또는 추가 버튼으로 등록한 뒤 저장하세요.
        </span>
        <div className="mt-1.5">
          <button
            type="button"
            data-testid="admin-settings-allowedTools-save"
            disabled={!toolsDirty || saving}
            onClick={() => void saveTools()}
            className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-fg disabled:opacity-60"
          >
            {saving ? "저장 중…" : "허용 도구 저장"}
          </button>
        </div>
      </div>
    </div>
  );
}
