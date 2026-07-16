// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ModelsGenerationTab } from "../ModelsGenerationTab";

const VALUE = {
  maxTokens: 4096,
  temperature: 0.7,
  topP: 0.9,
  defaultModel: "claude-sonnet-5",
  systemPrompt: "",
  toolMaxTokens: 4096,
  ragTopK: 10,
  ragRrfK: 60,
  ragChunkSizeTokens: 800,
  ragChunkOverlapTokens: 100,
  ragHybridEnabled: true,
  ragRelevanceThreshold: 0,
  webSearchEnabled: false,
  webSearchResultCount: 3,
  enableDirectConnections: false,
  instanceName: "WChat",
  banner: "",
  responseWatermark: "",
  defaultUserRole: "member" as const,
  enableSignup: false,
  maxUploadSizeMb: 25,
  maxUploadCount: 10,
};

describe("ModelsGenerationTab", () => {
  afterEach(() => cleanup());

  it("maxTokens/temperature/topP/defaultModel/systemPrompt/toolMaxTokens 필드를 렌더한다", () => {
    render(
      <ModelsGenerationTab
        value={VALUE}
        errors={{}}
        orgAllowedModels={["claude-sonnet-5", "claude-opus-4-8"]}
        onChange={() => {}}
      />,
    );

    expect(screen.getByTestId("admin-settings-maxTokens")).toHaveValue(4096);
    expect(screen.getByTestId("admin-settings-temperature")).toHaveValue(0.7);
    expect(screen.getByTestId("admin-settings-topP")).toHaveValue(0.9);
    expect(screen.getByTestId("admin-settings-defaultModel")).toHaveValue(
      "claude-sonnet-5",
    );
    expect(screen.getByTestId("admin-settings-systemPrompt")).toHaveValue("");
    expect(screen.getByTestId("admin-settings-toolMaxTokens")).toHaveValue(
      4096,
    );
  });

  it("topP 는 '아직 미적용' 힌트를 노출하지 않는다(런타임 배선 완료)", () => {
    render(
      <ModelsGenerationTab
        value={VALUE}
        errors={{}}
        orgAllowedModels={[]}
        onChange={() => {}}
      />,
    );
    expect(
      screen.queryByTestId("admin-settings-topP-hint"),
    ).not.toBeInTheDocument();
  });

  it("allowedModels 는 읽기 전용 칩 목록 + 별도 관리 힌트로 노출한다(편집 저장 엔드포인트 부재)", () => {
    render(
      <ModelsGenerationTab
        value={VALUE}
        errors={{}}
        orgAllowedModels={["claude-sonnet-5", "claude-opus-4-8"]}
        onChange={() => {}}
      />,
    );
    const list = screen.getByTestId("admin-settings-allowedModels-list");
    expect(list).toHaveTextContent("claude-sonnet-5");
    expect(list).toHaveTextContent("claude-opus-4-8");
    expect(
      screen.queryByRole("checkbox", { name: /claude/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("admin-settings-allowedModels-hint"),
    ).toHaveTextContent("읽기 전용");
  });

  it("입력을 변경하면 onChange 에 patch 를 전달한다", () => {
    const onChange = vi.fn();
    render(
      <ModelsGenerationTab
        value={VALUE}
        errors={{}}
        orgAllowedModels={[]}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByTestId("admin-settings-maxTokens"), {
      target: { value: "8192" },
    });
    expect(onChange).toHaveBeenCalledWith({ maxTokens: 8192 });

    fireEvent.change(screen.getByTestId("admin-settings-systemPrompt"), {
      target: { value: "너는 친절한 비서다." },
    });
    expect(onChange).toHaveBeenCalledWith({
      systemPrompt: "너는 친절한 비서다.",
    });
  });

  it("errors 에 있는 필드는 에러 메시지를 보여준다", () => {
    render(
      <ModelsGenerationTab
        value={VALUE}
        errors={{ maxTokens: "1~128,000 사이의 정수를 입력하세요." }}
        orgAllowedModels={[]}
        onChange={() => {}}
      />,
    );
    expect(
      screen.getByTestId("admin-settings-maxTokens-error"),
    ).toHaveTextContent("1~128,000");
  });
});
