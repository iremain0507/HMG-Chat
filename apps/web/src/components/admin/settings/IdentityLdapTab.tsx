"use client";
// components/admin/settings/IdentityLdapTab.tsx — P22-T6-22 Identity/LDAP 탭.
//   서버측 P22-T1-11(계약배치 C14)이 만든 org_settings ldap* 필드를 admin 이 실제로 설정할 수
//   있게 하는 패널. 저장은 AdminSettingsScreen 의 기존 PUT /api/v1/admin/settings draft 경로를
//   그대로 타므로 여기서는 onChange 로 draft 만 갱신하고, "연결 테스트"만 전용 엔드포인트
//   (POST /api/v1/admin/ldap/test, routes/admin-settings.ts:94)를 직접 호출한다
//   — ConnectorsTab 이 /admin/tools 를 자체 호출하는 것과 같은 패턴.
//   비밀번호는 값이 아니라 **env 변수 이름**만 저장한다(webSearchApiKeyRef 와 동일한
//   "비밀은 DB 밖" 원칙, lib/ldap-client.ts resolveLdapConfig 참조).
import React, { useState } from "react";
import { apiFetch } from "../../../lib/fetch-with-refresh";
import {
  LABEL_CLASS,
  INPUT_CLASS,
  HINT_CLASS,
  CHECKBOX_LABEL_CLASS,
} from "./tabStyles";

export type LdapRole = "member" | "admin" | "owner";

export type IdentityLdapValue = {
  ldapEnabled: boolean;
  ldapUrl: string;
  ldapBindDn: string;
  ldapBindPasswordRef: string;
  ldapBaseDn: string;
  ldapUserFilter: string;
  ldapEmailAttribute: string;
  ldapNameAttribute: string;
  ldapGroupAttribute: string;
  ldapGroupRoleMap: Record<string, LdapRole>;
  ldapTlsRejectUnauthorized: boolean;
};

export interface IdentityLdapTabProps {
  value: IdentityLdapValue;
  onChange: (patch: Partial<IdentityLdapValue>) => void;
}

type TestResult = { ok: boolean; message: string } | null;

const ROLES: LdapRole[] = ["member", "admin", "owner"];

export function IdentityLdapTab({ value, onChange }: IdentityLdapTabProps) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestResult>(null);
  const [newDn, setNewDn] = useState("");
  const [newRole, setNewRole] = useState<LdapRole>("member");

  const groupEntries = Object.entries(value.ldapGroupRoleMap ?? {});

  function addMapping() {
    const dn = newDn.trim();
    if (!dn) return;
    onChange({
      ldapGroupRoleMap: { ...(value.ldapGroupRoleMap ?? {}), [dn]: newRole },
    });
    setNewDn("");
  }

  function removeMapping(dn: string) {
    const next = { ...(value.ldapGroupRoleMap ?? {}) };
    delete next[dn];
    onChange({ ldapGroupRoleMap: next });
  }

  async function runTest() {
    // 이중 제출 가드 — 서버 bind 는 네트워크 왕복이라 연타 시 중복 요청이 쉽게 난다.
    if (testing) return;
    setTesting(true);
    setResult(null);
    try {
      const res = await apiFetch("/api/v1/admin/ldap/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        setResult({
          ok: false,
          message: body?.error?.message ?? "연결 테스트에 실패했습니다.",
        });
        return;
      }
      setResult({ ok: true, message: "연결 성공 — 서비스 계정 bind 확인됨." });
    } catch {
      setResult({ ok: false, message: "연결 테스트에 실패했습니다." });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <label className={CHECKBOX_LABEL_CLASS}>
        <input
          type="checkbox"
          data-testid="admin-settings-ldapEnabled"
          checked={value.ldapEnabled}
          onChange={(e) => onChange({ ldapEnabled: e.target.checked })}
        />
        LDAP/AD 로그인 사용(ldapEnabled)
      </label>

      <label className={CHECKBOX_LABEL_CLASS}>
        <input
          type="checkbox"
          data-testid="admin-settings-ldapTlsRejectUnauthorized"
          checked={value.ldapTlsRejectUnauthorized}
          onChange={(e) =>
            onChange({ ldapTlsRejectUnauthorized: e.target.checked })
          }
        />
        TLS 인증서 검증(ldapTlsRejectUnauthorized)
      </label>

      <label className={LABEL_CLASS}>
        디렉터리 서버 URL(ldapUrl)
        <input
          type="text"
          data-testid="admin-settings-ldapUrl"
          className={INPUT_CLASS}
          placeholder="ldaps://dc.example.com:636"
          value={value.ldapUrl}
          onChange={(e) => onChange({ ldapUrl: e.target.value })}
        />
      </label>

      <label className={LABEL_CLASS}>
        검색 기준 DN(ldapBaseDn)
        <input
          type="text"
          data-testid="admin-settings-ldapBaseDn"
          className={INPUT_CLASS}
          placeholder="OU=Users,DC=example,DC=com"
          value={value.ldapBaseDn}
          onChange={(e) => onChange({ ldapBaseDn: e.target.value })}
        />
        <span className={HINT_CLASS}>
          이 서브트리 밖의 사용자는 로그인할 수 없습니다.
        </span>
      </label>

      <label className={LABEL_CLASS}>
        서비스 계정 DN(ldapBindDn)
        <input
          type="text"
          data-testid="admin-settings-ldapBindDn"
          className={INPUT_CLASS}
          placeholder="CN=svc,OU=Service,DC=example,DC=com"
          value={value.ldapBindDn}
          onChange={(e) => onChange({ ldapBindDn: e.target.value })}
        />
        <span className={HINT_CLASS}>비워두면 익명 bind 로 검색합니다.</span>
      </label>

      <label className={LABEL_CLASS}>
        서비스 계정 비밀번호 참조(ldapBindPasswordRef)
        <input
          type="text"
          data-testid="admin-settings-ldapBindPasswordRef"
          className={INPUT_CLASS}
          placeholder="LDAP_BIND_PASSWORD"
          value={value.ldapBindPasswordRef}
          onChange={(e) => onChange({ ldapBindPasswordRef: e.target.value })}
        />
        <span className={HINT_CLASS}>
          비밀번호 자체가 아니라 서버가 읽을 환경변수 이름(LDAP_ 접두)을
          입력하세요.
        </span>
      </label>

      <label className={`${LABEL_CLASS} sm:col-span-2`}>
        사용자 검색 필터(ldapUserFilter)
        <input
          type="text"
          data-testid="admin-settings-ldapUserFilter"
          className={INPUT_CLASS}
          value={value.ldapUserFilter}
          onChange={(e) => onChange({ ldapUserFilter: e.target.value })}
        />
        <span className={HINT_CLASS}>
          {"{{username}}"} 자리표시자는 RFC 4515 로 이스케이프되어 치환됩니다.
        </span>
      </label>

      <label className={LABEL_CLASS}>
        이메일 속성(ldapEmailAttribute)
        <input
          type="text"
          data-testid="admin-settings-ldapEmailAttribute"
          className={INPUT_CLASS}
          value={value.ldapEmailAttribute}
          onChange={(e) => onChange({ ldapEmailAttribute: e.target.value })}
        />
      </label>

      <label className={LABEL_CLASS}>
        이름 속성(ldapNameAttribute)
        <input
          type="text"
          data-testid="admin-settings-ldapNameAttribute"
          className={INPUT_CLASS}
          value={value.ldapNameAttribute}
          onChange={(e) => onChange({ ldapNameAttribute: e.target.value })}
        />
      </label>

      <label className={LABEL_CLASS}>
        그룹 속성(ldapGroupAttribute)
        <input
          type="text"
          data-testid="admin-settings-ldapGroupAttribute"
          className={INPUT_CLASS}
          value={value.ldapGroupAttribute}
          onChange={(e) => onChange({ ldapGroupAttribute: e.target.value })}
        />
      </label>

      <div className="sm:col-span-2">
        <span className={LABEL_CLASS}>그룹 → 역할 매핑(ldapGroupRoleMap)</span>
        <div
          data-testid="admin-settings-ldapGroupRoleMap-list"
          className="mt-1 flex flex-wrap gap-1.5"
        >
          {groupEntries.length === 0 ? (
            <span className="text-xs text-fg-subtle">
              매핑이 없으면 그룹 게이트 없이 디렉터리 인증만으로 허용합니다.
            </span>
          ) : (
            groupEntries.map(([dn, role]) => (
              <span
                key={dn}
                className="flex items-center gap-1 rounded-full border border-border bg-surface px-2 py-0.5 font-mono text-[11px] text-fg-muted"
              >
                {dn} → {role}
                <button
                  type="button"
                  aria-label={`${dn} 매핑 제거`}
                  onClick={() => removeMapping(dn)}
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
            aria-label="그룹 DN"
            data-testid="admin-settings-ldapGroupRoleMap-dn"
            className={`${INPUT_CLASS} mt-0 flex-1`}
            placeholder="CN=Admins,DC=example,DC=com"
            value={newDn}
            onChange={(e) => setNewDn(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addMapping();
              }
            }}
          />
          <select
            aria-label="매핑할 역할"
            data-testid="admin-settings-ldapGroupRoleMap-role"
            className={`${INPUT_CLASS} mt-0 w-28`}
            value={newRole}
            onChange={(e) => setNewRole(e.target.value as LdapRole)}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <button
            type="button"
            data-testid="admin-settings-ldapGroupRoleMap-add"
            onClick={addMapping}
            className="rounded-md border border-border px-2.5 text-xs font-medium text-fg hover:bg-surface"
          >
            추가
          </button>
        </div>
      </div>

      <div className="sm:col-span-2">
        <button
          type="button"
          data-testid="admin-settings-ldap-test"
          // 서버는 ldapEnabled=false 면 400(설정 미완료)으로 거절하므로 UI 에서 먼저 막는다.
          disabled={testing || !value.ldapEnabled}
          onClick={() => void runTest()}
          className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-fg hover:bg-surface disabled:opacity-60"
        >
          {testing ? "테스트 중…" : "연결 테스트"}
        </button>
        {result && (
          <p
            role="status"
            data-testid="admin-settings-ldap-test-result"
            className={`mt-1.5 text-xs ${result.ok ? "text-fg-muted" : "text-accent"}`}
          >
            {result.message}
          </p>
        )}
        <span className={HINT_CLASS}>
          저장된 설정으로 서비스 계정 bind 만 시도합니다(사용자 자격증명
          미사용). 변경한 값을 테스트하려면 먼저 저장하세요.
        </span>
      </div>
    </div>
  );
}
