// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { KnowledgeRagTab } from "../KnowledgeRagTab";

const VALUE = {
  ragTopK: 10,
  ragRrfK: 60,
  ragChunkSizeTokens: 800,
  ragChunkOverlapTokens: 100,
  ragHybridEnabled: true,
  ragRelevanceThreshold: 0,
};

describe("KnowledgeRagTab", () => {
  afterEach(() => cleanup());

  it("ragTopK/ragRrfK/ragChunkSizeTokens/ragChunkOverlapTokens/ragHybridEnabled/ragRelevanceThreshold 필드를 렌더한다", () => {
    render(<KnowledgeRagTab value={VALUE} errors={{}} onChange={() => {}} />);

    expect(screen.getByTestId("admin-settings-ragTopK")).toHaveValue(10);
    expect(screen.getByTestId("admin-settings-ragRrfK")).toHaveValue(60);
    expect(screen.getByTestId("admin-settings-ragChunkSizeTokens")).toHaveValue(
      800,
    );
    expect(
      screen.getByTestId("admin-settings-ragChunkOverlapTokens"),
    ).toHaveValue(100);
    expect(screen.getByTestId("admin-settings-ragHybridEnabled")).toBeChecked();
    expect(
      screen.getByTestId("admin-settings-ragRelevanceThreshold"),
    ).toHaveValue(0);
  });

  it("입력을 변경하면 onChange 에 patch 를 전달한다", () => {
    const onChange = vi.fn();
    render(<KnowledgeRagTab value={VALUE} errors={{}} onChange={onChange} />);
    fireEvent.change(screen.getByTestId("admin-settings-ragTopK"), {
      target: { value: "12" },
    });
    expect(onChange).toHaveBeenCalledWith({ ragTopK: 12 });

    fireEvent.click(screen.getByTestId("admin-settings-ragHybridEnabled"));
    expect(onChange).toHaveBeenCalledWith({ ragHybridEnabled: false });
  });

  it("errors 에 있는 필드는 에러 메시지를 보여준다", () => {
    render(
      <KnowledgeRagTab
        value={VALUE}
        errors={{ ragTopK: "1~100 사이의 정수를 입력하세요." }}
        onChange={() => {}}
      />,
    );
    expect(
      screen.getByTestId("admin-settings-ragTopK-error"),
    ).toHaveTextContent("1~100");
  });
});
