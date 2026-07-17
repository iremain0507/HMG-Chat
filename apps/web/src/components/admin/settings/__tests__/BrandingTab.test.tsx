// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { BrandingTab } from "../BrandingTab";

const VALUE = { instanceName: "WChat", banner: [], responseWatermark: "" };

describe("BrandingTab", () => {
  afterEach(() => cleanup());

  it("instanceName/responseWatermark 필드를 렌더한다", () => {
    render(<BrandingTab value={VALUE} errors={{}} onChange={() => {}} />);
    expect(screen.getByTestId("admin-settings-instanceName")).toHaveValue(
      "WChat",
    );
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

  it("배너가 없으면 안내 문구를 보여준다", () => {
    render(<BrandingTab value={VALUE} errors={{}} onChange={() => {}} />);
    expect(screen.getByText("등록된 배너가 없습니다.")).toBeInTheDocument();
  });

  it("배너 추가 클릭 시 onChange 가 배너 1건이 추가된 배열로 호출된다", () => {
    const onChange = vi.fn();
    render(<BrandingTab value={VALUE} errors={{}} onChange={onChange} />);
    fireEvent.click(screen.getByTestId("admin-settings-banner-add"));
    expect(onChange).toHaveBeenCalledWith({
      banner: [{ type: "info", title: "", content: "", dismissible: true }],
    });
  });

  it("두 번째 배너 추가 + type=warning 선택 → onChange 가 length2 배열/type warning 로 호출된다", () => {
    const existing = [
      { type: "info" as const, title: "", content: "공지", dismissible: true },
    ];
    const onChange = vi.fn();
    const { rerender } = render(
      <BrandingTab
        value={{ ...VALUE, banner: existing }}
        errors={{}}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByTestId("admin-settings-banner-add"));
    expect(onChange).toHaveBeenLastCalledWith({
      banner: [
        existing[0],
        { type: "info", title: "", content: "", dismissible: true },
      ],
    });

    const updatedBanners = onChange.mock.calls[0]![0].banner;
    rerender(
      <BrandingTab
        value={{ ...VALUE, banner: updatedBanners }}
        errors={{}}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByTestId("admin-settings-banner-1-type"), {
      target: { value: "warning" },
    });

    const lastPatch = onChange.mock.calls[onChange.mock.calls.length - 1]![0];
    expect(lastPatch.banner).toHaveLength(2);
    expect(lastPatch.banner[1].type).toBe("warning");
  });

  it("배너 삭제 클릭 시 onChange 가 해당 배너를 제외한 배열로 호출된다", () => {
    const existing = [
      { type: "info" as const, title: "", content: "A", dismissible: true },
      { type: "warning" as const, title: "", content: "B", dismissible: true },
    ];
    const onChange = vi.fn();
    render(
      <BrandingTab
        value={{ ...VALUE, banner: existing }}
        errors={{}}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByTestId("admin-settings-banner-0-remove"));
    expect(onChange).toHaveBeenCalledWith({ banner: [existing[1]] });
  });
});
