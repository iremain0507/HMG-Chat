// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ModelsGenerationTab } from "../ModelsGenerationTab";

vi.mock("../../../../lib/fetch-with-refresh", () => ({ apiFetch: vi.fn() }));
import { apiFetch } from "../../../../lib/fetch-with-refresh";

const VALUE = {
  maxTokens: 4096,
  temperature: 0.7,
  topP: 0.9,
  defaultModel: "claude-sonnet-5",
  systemPrompt: "",
  toolMaxTokens: 4096,
  deepResearchMaxSubQuestions: 4,
  deepResearchMaxGapIterations: 2,
  ragTopK: 10,
  ragRrfK: 60,
  ragChunkSizeTokens: 800,
  ragChunkOverlapTokens: 100,
  ragHybridEnabled: true,
  ragRelevanceThreshold: 0,
  webSearchEnabled: false,
  webSearchResultCount: 3,
  webSearchProvider: "dev-stub" as const,
  webSearchEndpoint: "",
  webSearchApiKeyRef: "",
  enableDirectConnections: false,
  instanceName: "WChat",
  banner: [],
  responseWatermark: "",
  defaultUserRole: "member" as const,
  enableSignup: false,
  maxUploadSizeMb: 25,
  maxUploadCount: 10,
};

describe("ModelsGenerationTab", () => {
  afterEach(() => {
    cleanup();
    vi.mocked(apiFetch).mockReset();
  });

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

  it("allowedModels 를 칩 목록으로 노출하고 입력값을 추가하면 새 칩이 생긴다", () => {
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

    fireEvent.change(screen.getByTestId("admin-settings-allowedModels-input"), {
      target: { value: "claude-haiku-4-5" },
    });
    fireEvent.click(screen.getByTestId("admin-settings-allowedModels-add"));

    expect(list).toHaveTextContent("claude-haiku-4-5");
  });

  it("칩의 제거 버튼을 누르면 목록에서 빠진다", () => {
    render(
      <ModelsGenerationTab
        value={VALUE}
        errors={{}}
        orgAllowedModels={["claude-sonnet-5", "claude-opus-4-8"]}
        onChange={() => {}}
      />,
    );
    fireEvent.click(
      screen.getByTestId("admin-settings-allowedModels-remove-claude-opus-4-8"),
    );
    const list = screen.getByTestId("admin-settings-allowedModels-list");
    expect(list).not.toHaveTextContent("claude-opus-4-8");
    expect(list).toHaveTextContent("claude-sonnet-5");
  });

  it("저장 버튼 클릭 시 PUT /api/v1/admin/models 로 편집된 목록을 전송한다", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: { allowedModels: ["claude-sonnet-5"] },
        }),
    } as unknown as Response);

    render(
      <ModelsGenerationTab
        value={VALUE}
        errors={{}}
        orgAllowedModels={["claude-sonnet-5", "claude-opus-4-8"]}
        onChange={() => {}}
      />,
    );
    fireEvent.click(
      screen.getByTestId("admin-settings-allowedModels-remove-claude-opus-4-8"),
    );
    fireEvent.click(screen.getByTestId("admin-settings-allowedModels-save"));

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
    expect(apiFetch).toHaveBeenCalledWith(
      "/api/v1/admin/models",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ allowedModels: ["claude-sonnet-5"] }),
      }),
    );
  });

  it("저장 실패 시 편집을 롤백한다", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({}),
    } as unknown as Response);

    render(
      <ModelsGenerationTab
        value={VALUE}
        errors={{}}
        orgAllowedModels={["claude-sonnet-5", "claude-opus-4-8"]}
        onChange={() => {}}
      />,
    );
    fireEvent.click(
      screen.getByTestId("admin-settings-allowedModels-remove-claude-opus-4-8"),
    );
    fireEvent.click(screen.getByTestId("admin-settings-allowedModels-save"));

    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
    const list = screen.getByTestId("admin-settings-allowedModels-list");
    await waitFor(() => expect(list).toHaveTextContent("claude-opus-4-8"));
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

  it("숫자 필드를 비우면 0 으로 무음 강제하지 않고 NaN 을 전달한다(UX-23)", () => {
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
      target: { value: "" },
    });
    expect(onChange).toHaveBeenCalledWith({ maxTokens: NaN });

    fireEvent.change(screen.getByTestId("admin-settings-temperature"), {
      target: { value: "" },
    });
    expect(onChange).toHaveBeenCalledWith({ temperature: NaN });

    fireEvent.change(screen.getByTestId("admin-settings-topP"), {
      target: { value: "" },
    });
    expect(onChange).toHaveBeenCalledWith({ topP: NaN });

    fireEvent.change(screen.getByTestId("admin-settings-toolMaxTokens"), {
      target: { value: "" },
    });
    expect(onChange).toHaveBeenCalledWith({ toolMaxTokens: NaN });
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

  it("딥리서치 설정(하위 질문 수·반성 횟수)을 설명과 함께 렌더하고 onChange 로 전달한다", () => {
    const onChange = vi.fn();
    render(
      <ModelsGenerationTab
        value={VALUE}
        errors={{}}
        orgAllowedModels={[]}
        onChange={onChange}
      />,
    );

    const subQ = screen.getByTestId(
      "admin-settings-deepResearchMaxSubQuestions",
    );
    expect(subQ).toHaveValue(4);
    fireEvent.change(subQ, { target: { value: "6" } });
    expect(onChange).toHaveBeenCalledWith({ deepResearchMaxSubQuestions: 6 });

    const gap = screen.getByTestId(
      "admin-settings-deepResearchMaxGapIterations",
    );
    expect(gap).toHaveValue(2);
    fireEvent.change(gap, { target: { value: "3" } });
    expect(onChange).toHaveBeenCalledWith({ deepResearchMaxGapIterations: 3 });

    // 각 설정의 역할 설명(HINT)이 포함된다.
    expect(
      screen.getByText(/하위 질문으로 나눠 병렬 조사/),
    ).toBeInTheDocument();
    expect(screen.getByText(/반성\(reflection\) 루프/)).toBeInTheDocument();
  });

  it("이미지 생성 토글(imageGenEnabled)을 렌더하고 클릭 시 onChange 로 반전 값을 전달한다(P22-T1-08)", () => {
    const onChange = vi.fn();
    render(
      <ModelsGenerationTab
        value={{ ...VALUE, imageGenEnabled: false }}
        errors={{}}
        orgAllowedModels={[]}
        onChange={onChange}
      />,
    );
    const box = screen.getByTestId("admin-settings-imageGenEnabled");
    expect(box).not.toBeChecked();
    fireEvent.click(box);
    expect(onChange).toHaveBeenCalledWith({ imageGenEnabled: true });
  });
});
