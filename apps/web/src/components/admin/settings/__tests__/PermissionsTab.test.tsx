// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { PermissionsTab } from "../PermissionsTab";

const VALUE: {
  defaultUserRole: "member" | "admin" | "owner";
  enableSignup: boolean;
} = {
  defaultUserRole: "member",
  enableSignup: false,
};

describe("PermissionsTab", () => {
  afterEach(() => cleanup());

  it("defaultUserRole/enableSignup 필드를 렌더하고 '아직 미적용' 힌트는 노출하지 않는다(런타임 배선 완료)", () => {
    render(<PermissionsTab value={VALUE} onChange={() => {}} />);
    expect(screen.getByTestId("admin-settings-defaultUserRole")).toHaveValue(
      "member",
    );
    expect(screen.getByTestId("admin-settings-enableSignup")).not.toBeChecked();
    expect(
      screen.queryByTestId("admin-settings-defaultUserRole-hint"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("admin-settings-enableSignup-hint"),
    ).not.toBeInTheDocument();
  });

  it("입력을 변경하면 onChange 에 patch 를 전달한다", () => {
    const onChange = vi.fn();
    render(<PermissionsTab value={VALUE} onChange={onChange} />);
    fireEvent.change(screen.getByTestId("admin-settings-defaultUserRole"), {
      target: { value: "admin" },
    });
    expect(onChange).toHaveBeenCalledWith({ defaultUserRole: "admin" });

    fireEvent.click(screen.getByTestId("admin-settings-enableSignup"));
    expect(onChange).toHaveBeenCalledWith({ enableSignup: true });
  });
});
