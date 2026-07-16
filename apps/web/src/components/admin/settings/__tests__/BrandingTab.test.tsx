// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { BrandingTab } from "../BrandingTab";

const VALUE = { instanceName: "WChat", banner: "", responseWatermark: "" };

describe("BrandingTab", () => {
  afterEach(() => cleanup());

  it("instanceName/banner/responseWatermark 필드를 렌더한다", () => {
    render(<BrandingTab value={VALUE} errors={{}} onChange={() => {}} />);
    expect(screen.getByTestId("admin-settings-instanceName")).toHaveValue(
      "WChat",
    );
    expect(screen.getByTestId("admin-settings-banner")).toHaveValue("");
    expect(screen.getByTestId("admin-settings-responseWatermark")).toHaveValue(
      "",
    );
  });

  it("입력을 변경하면 onChange 에 patch 를 전달한다", () => {
    const onChange = vi.fn();
    render(<BrandingTab value={VALUE} errors={{}} onChange={onChange} />);
    fireEvent.change(screen.getByTestId("admin-settings-instanceName"), {
      target: { value: "WIA Chat" },
    });
    expect(onChange).toHaveBeenCalledWith({ instanceName: "WIA Chat" });
  });

  it("errors 에 있는 필드는 에러 메시지를 보여준다", () => {
    render(
      <BrandingTab
        value={VALUE}
        errors={{ instanceName: "1~120자 사이로 입력하세요." }}
        onChange={() => {}}
      />,
    );
    expect(
      screen.getByTestId("admin-settings-instanceName-error"),
    ).toHaveTextContent("1~120");
  });
});
