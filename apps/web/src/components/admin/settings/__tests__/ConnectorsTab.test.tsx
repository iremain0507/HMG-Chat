// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ConnectorsTab } from "../ConnectorsTab";

const VALUE = { enableDirectConnections: false };

describe("ConnectorsTab", () => {
  afterEach(() => cleanup());

  it("enableDirectConnections 필드와 allowedTools 읽기 전용 목록을 렌더한다", () => {
    render(
      <ConnectorsTab
        value={VALUE}
        orgAllowedTools={["web_search", "code_interpreter"]}
        onChange={() => {}}
      />,
    );
    expect(
      screen.getByTestId("admin-settings-enableDirectConnections"),
    ).not.toBeChecked();
    const list = screen.getByTestId("admin-settings-allowedTools-list");
    expect(list).toHaveTextContent("web_search");
    expect(list).toHaveTextContent("code_interpreter");
    expect(
      screen.getByTestId("admin-settings-allowedTools-hint"),
    ).toHaveTextContent("읽기 전용");
  });

  it("입력을 변경하면 onChange 에 patch 를 전달한다", () => {
    const onChange = vi.fn();
    render(
      <ConnectorsTab value={VALUE} orgAllowedTools={[]} onChange={onChange} />,
    );
    fireEvent.click(
      screen.getByTestId("admin-settings-enableDirectConnections"),
    );
    expect(onChange).toHaveBeenCalledWith({ enableDirectConnections: true });
  });
});
