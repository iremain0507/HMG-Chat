// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { QuotaTab } from "../QuotaTab";

const VALUE = { maxUploadSizeMb: 25, maxUploadCount: 10 };

describe("QuotaTab", () => {
  afterEach(() => cleanup());

  it("maxUploadSizeMb/maxUploadCount 필드와 defaultTokenBudgetMicros 읽기 전용 값을 렌더한다", () => {
    render(
      <QuotaTab
        value={VALUE}
        errors={{}}
        orgDefaultTokenBudgetMicros={null}
        onChange={() => {}}
      />,
    );
    expect(screen.getByTestId("admin-settings-maxUploadSizeMb")).toHaveValue(
      25,
    );
    expect(screen.getByTestId("admin-settings-maxUploadCount")).toHaveValue(10);
    expect(
      screen.getByTestId("admin-settings-defaultTokenBudgetMicros"),
    ).toHaveTextContent("제한 없음");
    expect(
      screen.getByTestId("admin-settings-defaultTokenBudgetMicros-hint"),
    ).toHaveTextContent("읽기 전용");
  });

  it("defaultTokenBudgetMicros 가 있으면 값을 그대로 보여준다", () => {
    render(
      <QuotaTab
        value={VALUE}
        errors={{}}
        orgDefaultTokenBudgetMicros={5_000_000}
        onChange={() => {}}
      />,
    );
    expect(
      screen.getByTestId("admin-settings-defaultTokenBudgetMicros"),
    ).toHaveTextContent("5000000");
  });

  it("입력을 변경하면 onChange 에 patch 를 전달한다", () => {
    const onChange = vi.fn();
    render(
      <QuotaTab
        value={VALUE}
        errors={{}}
        orgDefaultTokenBudgetMicros={null}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByTestId("admin-settings-maxUploadSizeMb"), {
      target: { value: "50" },
    });
    expect(onChange).toHaveBeenCalledWith({ maxUploadSizeMb: 50 });
  });

  it("errors 에 있는 필드는 에러 메시지를 보여준다", () => {
    render(
      <QuotaTab
        value={VALUE}
        errors={{ maxUploadCount: "1~100 사이의 정수를 입력하세요." }}
        orgDefaultTokenBudgetMicros={null}
        onChange={() => {}}
      />,
    );
    expect(
      screen.getByTestId("admin-settings-maxUploadCount-error"),
    ).toHaveTextContent("1~100");
  });
});
