// @vitest-environment jsdom
// P22-T6-22 — LDAP/Identity admin 설정 패널(서버측 P22-T1-11 완성용).
//   서버 계약: org_settings ldap* 필드(lib/org-settings-schema.ts:89~106) + POST
//   /api/v1/admin/ldap/test(routes/admin-settings.ts:94). 저장은 AdminSettingsScreen 의
//   기존 PUT /api/v1/admin/settings draft 경로를 그대로 타므로 이 탭은 onChange 만 담당하고,
//   "연결 테스트"만 자체 엔드포인트를 호출한다(ConnectorsTab 이 /admin/tools 를 직접 부르는 패턴).
import React from "react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { IdentityLdapTab, type IdentityLdapValue } from "../IdentityLdapTab";

const apiFetchMock = vi.fn();
vi.mock("../../../../lib/fetch-with-refresh", () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));
vi.mock("../../../../lib/toast", () => ({ showToast: vi.fn() }));

const VALUE: IdentityLdapValue = {
  ldapEnabled: true,
  ldapUrl: "ldaps://dc.example.com:636",
  ldapBindDn: "CN=svc,OU=Service,DC=example,DC=com",
  ldapBindPasswordRef: "LDAP_BIND_PASSWORD",
  ldapBaseDn: "OU=Users,DC=example,DC=com",
  ldapUserFilter: "(|(sAMAccountName={{username}})(mail={{username}}))",
  ldapEmailAttribute: "mail",
  ldapNameAttribute: "displayName",
  ldapGroupAttribute: "memberOf",
  ldapGroupRoleMap: { "CN=Admins,DC=example,DC=com": "admin" },
  ldapTlsRejectUnauthorized: true,
};

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("IdentityLdapTab", () => {
  beforeEach(() => apiFetchMock.mockReset());
  afterEach(() => cleanup());

  it("현재 저장된 LDAP 설정을 렌더한다", () => {
    render(<IdentityLdapTab value={VALUE} onChange={() => {}} />);

    expect(screen.getByTestId("admin-settings-ldapEnabled")).toBeChecked();
    expect(screen.getByTestId("admin-settings-ldapUrl")).toHaveValue(
      "ldaps://dc.example.com:636",
    );
    expect(screen.getByTestId("admin-settings-ldapBaseDn")).toHaveValue(
      "OU=Users,DC=example,DC=com",
    );
    expect(screen.getByTestId("admin-settings-ldapBindDn")).toHaveValue(
      "CN=svc,OU=Service,DC=example,DC=com",
    );
    // 비밀번호 자체가 아니라 env 변수 "이름"만 저장한다(서버 resolveLdapConfig 계약).
    expect(
      screen.getByTestId("admin-settings-ldapBindPasswordRef"),
    ).toHaveValue("LDAP_BIND_PASSWORD");
    expect(
      screen.getByTestId("admin-settings-ldapGroupRoleMap-list"),
    ).toHaveTextContent("CN=Admins,DC=example,DC=com");
  });

  it("필드를 변경하면 onChange 에 patch 를 전달한다", () => {
    const onChange = vi.fn();
    render(<IdentityLdapTab value={VALUE} onChange={onChange} />);

    fireEvent.change(screen.getByTestId("admin-settings-ldapBaseDn"), {
      target: { value: "OU=Staff,DC=example,DC=com" },
    });
    expect(onChange).toHaveBeenCalledWith({
      ldapBaseDn: "OU=Staff,DC=example,DC=com",
    });

    fireEvent.click(screen.getByTestId("admin-settings-ldapEnabled"));
    expect(onChange).toHaveBeenCalledWith({ ldapEnabled: false });
  });

  it("그룹→롤 매핑을 추가/제거하면 onChange 로 전체 맵을 전달한다", () => {
    const onChange = vi.fn();
    render(<IdentityLdapTab value={VALUE} onChange={onChange} />);

    fireEvent.change(screen.getByTestId("admin-settings-ldapGroupRoleMap-dn"), {
      target: { value: "CN=Staff,DC=example,DC=com" },
    });
    fireEvent.change(
      screen.getByTestId("admin-settings-ldapGroupRoleMap-role"),
      { target: { value: "member" } },
    );
    fireEvent.click(screen.getByTestId("admin-settings-ldapGroupRoleMap-add"));
    expect(onChange).toHaveBeenCalledWith({
      ldapGroupRoleMap: {
        "CN=Admins,DC=example,DC=com": "admin",
        "CN=Staff,DC=example,DC=com": "member",
      },
    });

    onChange.mockClear();
    fireEvent.click(
      screen.getByRole("button", {
        name: "CN=Admins,DC=example,DC=com 매핑 제거",
      }),
    );
    expect(onChange).toHaveBeenCalledWith({ ldapGroupRoleMap: {} });
  });

  it("연결 테스트 클릭 시 POST /api/v1/admin/ldap/test 를 호출하고 성공을 표면화한다", async () => {
    apiFetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: { ok: true } }),
    });
    render(<IdentityLdapTab value={VALUE} onChange={() => {}} />);

    fireEvent.click(screen.getByTestId("admin-settings-ldap-test"));

    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith(
        "/api/v1/admin/ldap/test",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    await waitFor(() =>
      expect(
        screen.getByTestId("admin-settings-ldap-test-result"),
      ).toHaveTextContent(/연결 성공/),
    );
  });

  it("연결 테스트 실패 시 서버 사유(502 DIRECTORY_UNAVAILABLE)를 표면화한다", async () => {
    apiFetchMock.mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({
        error: {
          code: "DIRECTORY_UNAVAILABLE",
          message: "디렉터리 서버 연결/서비스 계정 bind 에 실패했습니다.",
        },
      }),
    });
    render(<IdentityLdapTab value={VALUE} onChange={() => {}} />);

    fireEvent.click(screen.getByTestId("admin-settings-ldap-test"));

    await waitFor(() =>
      expect(
        screen.getByTestId("admin-settings-ldap-test-result"),
      ).toHaveTextContent(
        "디렉터리 서버 연결/서비스 계정 bind 에 실패했습니다.",
      ),
    );
  });

  it("테스트 진행 중에는 버튼이 비활성화되어 이중 제출되지 않는다", async () => {
    const d = deferred<{ ok: boolean; json: () => Promise<unknown> }>();
    apiFetchMock.mockReturnValue(d.promise);
    render(<IdentityLdapTab value={VALUE} onChange={() => {}} />);

    const button = screen.getByTestId("admin-settings-ldap-test");
    fireEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    fireEvent.click(button);
    expect(apiFetchMock).toHaveBeenCalledTimes(1);

    d.resolve({ ok: true, json: async () => ({ data: { ok: true } }) });
    await waitFor(() => expect(button).not.toBeDisabled());
  });

  it("ldapEnabled 가 꺼져 있으면 연결 테스트를 막는다(서버가 400 으로 거절하는 조건)", () => {
    render(
      <IdentityLdapTab
        value={{ ...VALUE, ldapEnabled: false }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByTestId("admin-settings-ldap-test")).toBeDisabled();
  });
});
