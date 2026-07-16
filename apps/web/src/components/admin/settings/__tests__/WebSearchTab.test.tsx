// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { WebSearchTab } from "../WebSearchTab";

const VALUE = { webSearchEnabled: false, webSearchResultCount: 3 };

describe("WebSearchTab", () => {
  afterEach(() => cleanup());

  it("webSearchEnabled/webSearchResultCount 필드를 렌더한다", () => {
    render(<WebSearchTab value={VALUE} errors={{}} onChange={() => {}} />);
    expect(
      screen.getByTestId("admin-settings-webSearchEnabled"),
    ).not.toBeChecked();
    expect(
      screen.getByTestId("admin-settings-webSearchResultCount"),
    ).toHaveValue(3);
  });

  it("입력을 변경하면 onChange 에 patch 를 전달한다", () => {
    const onChange = vi.fn();
    render(<WebSearchTab value={VALUE} errors={{}} onChange={onChange} />);
    fireEvent.click(screen.getByTestId("admin-settings-webSearchEnabled"));
    expect(onChange).toHaveBeenCalledWith({ webSearchEnabled: true });

    fireEvent.change(
      screen.getByTestId("admin-settings-webSearchResultCount"),
      { target: { value: "5" } },
    );
    expect(onChange).toHaveBeenCalledWith({ webSearchResultCount: 5 });
  });

  it("errors 에 있는 필드는 에러 메시지를 보여준다", () => {
    render(
      <WebSearchTab
        value={VALUE}
        errors={{ webSearchResultCount: "1~20 사이의 정수를 입력하세요." }}
        onChange={() => {}}
      />,
    );
    expect(
      screen.getByTestId("admin-settings-webSearchResultCount-error"),
    ).toHaveTextContent("1~20");
  });
});
