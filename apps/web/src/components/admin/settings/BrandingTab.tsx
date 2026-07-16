"use client";
// components/admin/settings/BrandingTab.tsx — P14-T6-03 General/Branding 탭.
import React from "react";
import { LABEL_CLASS, INPUT_CLASS, ERROR_CLASS } from "./tabStyles";

export type BrandingValue = {
  instanceName: string;
  banner: string;
  responseWatermark: string;
};

export type BrandingErrors = Partial<Record<"instanceName", string>>;

export interface BrandingTabProps {
  value: BrandingValue;
  errors: BrandingErrors;
  onChange: (patch: Partial<BrandingValue>) => void;
}

export function BrandingTab({ value, errors, onChange }: BrandingTabProps) {
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

      <label className={LABEL_CLASS}>
        배너(banner)
        <input
          type="text"
          data-testid="admin-settings-banner"
          className={INPUT_CLASS}
          value={value.banner}
          onChange={(e) => onChange({ banner: e.target.value })}
        />
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
    </div>
  );
}
