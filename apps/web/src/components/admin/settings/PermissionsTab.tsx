"use client";
// components/admin/settings/PermissionsTab.tsx — P14-T6-03 Users & Permissions 탭.
//   defaultUserRole/enableSignup 은 P15-T1-01 에서 routes/auth.ts /signup 에 배선 완료.
import React from "react";
import { LABEL_CLASS, INPUT_CLASS, CHECKBOX_LABEL_CLASS } from "./tabStyles";

export type PermissionsValue = {
  defaultUserRole: "member" | "admin" | "owner";
  enableSignup: boolean;
};

export interface PermissionsTabProps {
  value: PermissionsValue;
  onChange: (patch: Partial<PermissionsValue>) => void;
}

const ROLE_OPTIONS: PermissionsValue["defaultUserRole"][] = [
  "member",
  "admin",
  "owner",
];

export function PermissionsTab({ value, onChange }: PermissionsTabProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <label className={LABEL_CLASS}>
        기본 사용자 역할(defaultUserRole)
        <select
          data-testid="admin-settings-defaultUserRole"
          className={INPUT_CLASS}
          value={value.defaultUserRole}
          onChange={(e) =>
            onChange({
              defaultUserRole: e.target
                .value as PermissionsValue["defaultUserRole"],
            })
          }
        >
          {ROLE_OPTIONS.map((role) => (
            <option key={role} value={role}>
              {role}
            </option>
          ))}
        </select>
      </label>

      <label className={CHECKBOX_LABEL_CLASS}>
        <input
          type="checkbox"
          data-testid="admin-settings-enableSignup"
          checked={value.enableSignup}
          onChange={(e) => onChange({ enableSignup: e.target.checked })}
        />
        가입 허용(enableSignup)
      </label>
    </div>
  );
}
