"use client";
// components/admin/settings/ConnectorsTab.tsx — P14-T6-03 Connectors/MCP 탭.
//   allowedTools 는 organizations 컬럼(§14-INTERFACES Organization)이라 ModelsGenerationTab
//   의 allowedModels 와 동일하게 읽기 전용 노출로 격리(PUT 저장은 admin-settings.ts 표 밖).
import React from "react";
import { CHECKBOX_LABEL_CLASS, LABEL_CLASS, HINT_CLASS } from "./tabStyles";

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
          {orgAllowedTools.length === 0 ? (
            <span className="text-xs text-fg-subtle">
              설정된 허용 도구가 없습니다.
            </span>
          ) : (
            orgAllowedTools.map((t) => (
              <span
                key={t}
                className="rounded-full border border-border bg-surface px-2 py-0.5 font-mono text-[11px] text-fg-muted"
              >
                {t}
              </span>
            ))
          )}
        </div>
        <span
          data-testid="admin-settings-allowedTools-hint"
          className={HINT_CLASS}
        >
          이 화면에서는 읽기 전용입니다. 조직 허용 도구 변경은 별도 관리 절차가
          필요합니다.
        </span>
      </div>
    </div>
  );
}
