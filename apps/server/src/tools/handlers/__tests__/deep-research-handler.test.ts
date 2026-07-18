import { describe, it, expect } from "vitest";
import type {
  AgentTool,
  ArtifactRecord,
  LLMProvider,
  ToolContext,
  ToolProgress,
} from "@wchat/interfaces";
import {
  createDeepResearchTool,
  parseSubQuestions,
  parseGapCheck,
  dropUnmatchedCitationMarkers,
} from "../deep-research-handler.js";
import type { ArtifactDataAccess } from "../../../db/artifact-service.js";

function fakeToolContext(): ToolContext {
  const logger: ToolContext["logger"] = {
    debug() {},
    info() {},
    warn() {},
    error() {},
    fatal() {},
    child() {
      return logger;
    },
  };
  return {
    requestId: "req-1",
    userId: "user-1",
    orgId: "org-1",
    sessionId: "session-1",
    signal: new AbortController().signal,
    logger,
    hitl: {
      async askApproval() {
        return { kind: "approved" };
      },
    },
    budget: {
      async claim() {},
      async settle() {},
      async refund() {},
      remaining: Infinity,
    },
  };
}

function fakeArtifactDa(): ArtifactDataAccess {
  const store = new Map<string, ArtifactRecord>();
  let seq = 0;
  return {
    artifacts: {
      async insert(data) {
        seq += 1;
        const record: ArtifactRecord = {
          id: `artifact-${seq}`,
          sessionId: (data.sessionId as string | null) ?? null,
          createdBy: data.createdBy as string,
          type: data.type as ArtifactRecord["type"],
          filename: data.filename as string,
          mimeType: (data.mimeType as string | null) ?? null,
          sizeBytes: data.sizeBytes as number,
          storageKind:
            (data.storageKind as ArtifactRecord["storageKind"]) ?? "inline",
          s3Key: (data.s3Key as string | null) ?? null,
          inlineContent: (data.inlineContent as Buffer | null) ?? null,
          sharedAt: null,
          createdAt: new Date("2026-07-15T00:00:00Z"),
        };
        store.set(record.id, record);
        return record;
      },
      async bulkInsert() {
        return [];
      },
      async update() {
        throw new Error("not implemented");
      },
      async delete() {},
      async byId(id) {
        return store.get(id) ?? null;
      },
      async list() {
        return { items: [...store.values()] };
      },
    },
  };
}

// 검색 결과 citation 을 담아 반환하는 fake web_search 스코프 tool — researcher 가 이 tool 을
// 호출하면 runTurn 의 duck-typing 을 거쳐 citation ChatEvent 가 방출된다(web-search-handler 와
// 동일한 kind:"json"+{citations:[...]} 관례).
function fakeWorkerTool(): AgentTool {
  return {
    spec: {
      name: "web_search",
      description: "fake web search",
      inputSchema: { type: "object", properties: {} },
      permissionTier: "tool",
      defaultPolicy: "allow",
      tags: ["read-only", "idempotent", "web"],
    },
    async invoke({ toolCallId }) {
      return {
        toolCallId,
        content: {
          kind: "json",
          data: {
            citations: [
              {
                index: 1,
                source: "ephemeral",
                filename: "example.com",
                snippet: "핵심 사실 스니펫",
                sourceUri: "https://example.com/fact",
              },
            ],
          },
        },
      };
    },
  };
}

// worker runTurn 은 매 sub-question 마다 새로 호출된다. 각 호출은 (1) tool_use 요청 →
// (2) tool_result 반영 후 재호출 시 text_delta[1] 로 마무리되는 2-round 흐름을 시뮬레이션한다.
function fakeWorkerProvider(): LLMProvider {
  let callCount = 0;
  return {
    name: "fake-worker",
    models: ["fake-worker-model"],
    async *chat(input) {
      callCount += 1;
      const hasToolResult = input.messages.some((m) => m.role === "tool");
      yield {
        type: "message_start",
        messageId: `msg-${callCount}`,
        meta: { provider: "fake-worker", model: "fake-worker-model" },
      };
      if (!hasToolResult) {
        yield {
          type: "tool_use",
          toolCallId: `call-${callCount}`,
          name: "web_search",
          args: { query: "x" },
        };
        yield {
          type: "stop",
          reason: "tool_use",
          usage: { inputTokens: 1, outputTokens: 1 },
        };
      } else {
        yield { type: "text_delta", text: "핵심 사실 확인됨 [1]" };
        yield {
          type: "stop",
          reason: "end_turn",
          usage: { inputTokens: 1, outputTokens: 1 },
        };
      }
    },
  };
}

function fakeLeadProvider(opts: {
  plannerResponse: string;
  synthesisResponse: (call: number) => string;
  gapCheckResponse: (call: number) => string;
}): LLMProvider {
  let synthesisCall = 0;
  let gapCheckCall = 0;
  return {
    name: "fake-lead",
    models: ["fake-lead-model"],
    async *chat(input) {
      const sys = input.systemBlocks.map((b) => b.content).join(" ");
      yield {
        type: "message_start",
        messageId: "msg-lead",
        meta: { provider: "fake-lead", model: "fake-lead-model" },
      };
      // 판정 순서 주의: gapCheck 프롬프트의 예시 문구("GAP: <...하위 질문 하나>")가 "하위 질문"
      // 을 포함하므로, 가장 구체적인 마커("공백"/"종합하라")부터 먼저 검사하고 "하위 질문"
      // (planner)은 마지막 fallback 으로 둔다.
      if (sys.includes("공백")) {
        gapCheckCall += 1;
        yield { type: "text_delta", text: opts.gapCheckResponse(gapCheckCall) };
      } else if (sys.includes("종합하라")) {
        synthesisCall += 1;
        yield {
          type: "text_delta",
          text: opts.synthesisResponse(synthesisCall),
        };
      } else if (sys.includes("하위 질문")) {
        yield { type: "text_delta", text: opts.plannerResponse };
      } else {
        yield { type: "text_delta", text: "" };
      }
      yield {
        type: "stop",
        reason: "end_turn",
        usage: { inputTokens: 1, outputTokens: 1 },
      };
    },
  };
}

describe("deep-research-handler — parseSubQuestions", () => {
  it("'- ' 접두 줄들을 하위 질문 배열로 파싱하고 maxSubQuestions 로 자른다", () => {
    const text = "- 질문 A\n- 질문 B\n- 질문 C";
    expect(parseSubQuestions(text, 2, "원 질문")).toEqual(["질문 A", "질문 B"]);
  });

  it("파싱 결과가 비어 있으면 원 질문을 단일 하위 질문으로 fallback 한다", () => {
    expect(parseSubQuestions("   \n  ", 4, "원 질문")).toEqual(["원 질문"]);
  });
});

describe("deep-research-handler — parseGapCheck", () => {
  it("COMPLETE 응답은 complete:true 로 판정한다", () => {
    expect(parseGapCheck("COMPLETE")).toEqual({ complete: true });
  });

  it("GAP: <질문> 응답은 complete:false + gapQuestion 을 반환한다", () => {
    expect(parseGapCheck("GAP: 추가로 조사할 질문")).toEqual({
      complete: false,
      gapQuestion: "추가로 조사할 질문",
    });
  });

  it("GAP: 뒤에 질문이 없으면 안전하게 complete:true 로 처리한다", () => {
    expect(parseGapCheck("GAP:   ")).toEqual({ complete: true });
  });
});

describe("deep-research-handler — dropUnmatchedCitationMarkers", () => {
  it("citations 에 없는 인덱스의 [N] 마커를 제거한다", () => {
    const text = "사실 A [1]. 존재하지 않는 출처 [99].";
    expect(dropUnmatchedCitationMarkers(text, [99])).toBe(
      "사실 A [1]. 존재하지 않는 출처 .",
    );
  });

  it("unmatchedIndexes 가 비어있으면 원문 그대로 반환한다", () => {
    const text = "사실 A [1].";
    expect(dropUnmatchedCitationMarkers(text, [])).toBe(text);
  });
});

describe("createDeepResearchTool", () => {
  it("spec 은 deep_research 계약을 만족한다", () => {
    const tool = createDeepResearchTool({
      leadProvider: fakeLeadProvider({
        plannerResponse: "- 질문 A",
        synthesisResponse: () => "리포트",
        gapCheckResponse: () => "COMPLETE",
      }),
      leadModel: "fake-lead-model",
      workerProvider: fakeWorkerProvider(),
      workerModel: "fake-worker-model",
      workerTools: [fakeWorkerTool()],
      maxTokens: 512,
      da: fakeArtifactDa(),
    });

    expect(tool.spec.name).toBe("deep_research");
    expect(tool.spec.permissionTier).toBe("tool");
    expect(tool.spec.defaultPolicy).toBe("allow");
    expect(tool.spec.tags).toContain("web");
  });

  it("query 가 없으면 INVALID_INPUT 에러를 반환한다", async () => {
    const tool = createDeepResearchTool({
      leadProvider: fakeLeadProvider({
        plannerResponse: "- 질문 A",
        synthesisResponse: () => "리포트",
        gapCheckResponse: () => "COMPLETE",
      }),
      leadModel: "fake-lead-model",
      workerProvider: fakeWorkerProvider(),
      workerModel: "fake-worker-model",
      workerTools: [fakeWorkerTool()],
      maxTokens: 512,
      da: fakeArtifactDa(),
    });

    const result = await tool.invoke({
      toolCallId: "call-1",
      args: { query: "   " },
      ctx: fakeToolContext(),
    });

    expect(result.content.kind).toBe("error");
    if (result.content.kind === "error") {
      expect(result.content.error.code).toBe("INVALID_INPUT");
    }
  });

  it("실행 중 emitProgress 로 planning→researching(하위질문 tasks)→synthesizing→done 진행을 방출한다", async () => {
    const tool = createDeepResearchTool({
      leadProvider: fakeLeadProvider({
        plannerResponse: "- 질문 A\n- 질문 B",
        synthesisResponse: () => "## 리포트 [1][2].",
        gapCheckResponse: () => "COMPLETE",
      }),
      leadModel: "fake-lead-model",
      workerProvider: fakeWorkerProvider(),
      workerModel: "fake-worker-model",
      workerTools: [fakeWorkerTool()],
      maxTokens: 512,
      da: fakeArtifactDa(),
    });
    const emitted: ToolProgress[] = [];
    await tool.invoke({
      toolCallId: "call-p",
      args: { query: "리서치 목표" },
      ctx: { ...fakeToolContext(), emitProgress: (p) => emitted.push(p) },
    });
    const stages = emitted.map((e) => e.stage);
    expect(stages[0]).toBe("planning");
    expect(stages).toContain("researching");
    expect(stages).toContain("synthesizing");
    expect(stages.at(-1)).toBe("done");
    const research = emitted.find((e) => e.stage === "researching");
    expect(research?.tasks?.map((t) => t.title)).toEqual(["질문 A", "질문 B"]);
  });

  it("상위 취소/타임아웃 시 응답 없이 멈춘 sub-call 도 hang 하지 않고 예외로 종단한다", async () => {
    const controller = new AbortController();
    const hangingProvider: LLMProvider = {
      name: "hang",
      models: ["m"],
      // eslint-disable-next-line require-yield
      async *chat() {
        await new Promise(() => {}); // 응답 없이 영원히 대기(실 네트워크 hang 모사)
      },
    };
    const tool = createDeepResearchTool({
      leadProvider: hangingProvider,
      leadModel: "m",
      workerProvider: hangingProvider,
      workerModel: "m",
      workerTools: [],
      maxTokens: 128,
      da: fakeArtifactDa(),
    });
    const invokePromise = tool.invoke({
      toolCallId: "c-hang",
      args: { query: "x" },
      ctx: { ...fakeToolContext(), signal: controller.signal },
    });
    // 타임아웃과 동일 경로(linked signal abort) — hang 이 즉시 풀려 예외로 종단되어야 한다.
    controller.abort();
    await expect(invokePromise).rejects.toThrow();
  });

  it("plan→병렬 researcher→종합 후 인용이 포함된 markdown 아티팩트를 생성하고, 존재하지 않는 인용 마커[99]는 drop 한다(gapCheck COMPLETE 로 1회 종합에 종료)", async () => {
    const da = fakeArtifactDa();
    const tool = createDeepResearchTool({
      leadProvider: fakeLeadProvider({
        plannerResponse: "- 질문 A\n- 질문 B",
        synthesisResponse: () =>
          "## 종합 리포트\n확인된 사실 [1][2]. 근거 없는 주장 [99].",
        gapCheckResponse: () => "COMPLETE",
      }),
      leadModel: "fake-lead-model",
      workerProvider: fakeWorkerProvider(),
      workerModel: "fake-worker-model",
      workerTools: [fakeWorkerTool()],
      maxTokens: 512,
      da,
    });

    const result = await tool.invoke({
      toolCallId: "call-2",
      args: { query: "리서치 목표" },
      ctx: fakeToolContext(),
    });

    if (result.content.kind !== "json") {
      throw new Error("json content 를 기대함");
    }
    const data = result.content.data as {
      artifact: {
        artifactId: string;
        artifactKind: string;
        filename: string;
        sizeBytes: number;
        downloadUrl: string;
      };
      citations: unknown[];
      message: string;
      subQuestions: { title: string; citations: { index: number }[] }[];
    };

    expect(data.artifact.artifactKind).toBe("markdown");
    expect(data.artifact.sizeBytes).toBeGreaterThan(0);
    // 2개 sub-question 각각 researcher 가 citation 1개씩 반환 → 전역 재번호 2개.
    expect(data.citations).toHaveLength(2);
    // #3 — 하위질문별 출처(전역 인덱스)를 결과에 포함해 서브에이전트 펼침에서 표시.
    expect(data.subQuestions).toHaveLength(2);
    expect(data.subQuestions[0]!.citations.map((c) => c.index)).toEqual([1]);
    expect(data.subQuestions[1]!.citations.map((c) => c.index)).toEqual([2]);

    const stored = await da.artifacts.byId(data.artifact.artifactId);
    const storedText = stored?.inlineContent?.toString("utf-8") ?? "";
    expect(storedText).toContain("[1]");
    expect(storedText).toContain("[2]");
    expect(storedText).not.toContain("[99]");
  });

  it("P15-T2-02: org settings.resolve 의 toolMaxTokens 가 설정되면 sub-turn 이 정적 deps.maxTokens 대신 그 값을 사용한다", async () => {
    const capturedMaxTokens: number[] = [];
    const capturingWorkerProvider: LLMProvider = {
      name: "fake-worker",
      models: ["fake-worker-model"],
      async *chat(input) {
        capturedMaxTokens.push(input.maxTokens);
        yield {
          type: "message_start",
          messageId: "msg-w",
          meta: { provider: "fake-worker", model: "fake-worker-model" },
        };
        yield { type: "text_delta", text: "핵심 사실 확인됨" };
        yield {
          type: "stop",
          reason: "end_turn",
          usage: { inputTokens: 1, outputTokens: 1 },
        };
      },
    };
    const tool = createDeepResearchTool({
      leadProvider: fakeLeadProvider({
        plannerResponse: "- 질문 A",
        synthesisResponse: () => "리포트",
        gapCheckResponse: () => "COMPLETE",
      }),
      leadModel: "fake-lead-model",
      workerProvider: capturingWorkerProvider,
      workerModel: "fake-worker-model",
      workerTools: [],
      maxTokens: 4096,
      da: fakeArtifactDa(),
      settings: {
        async resolve(orgId: string) {
          expect(orgId).toBe("org-1");
          return { toolMaxTokens: 8000 };
        },
      },
    });

    await tool.invoke({
      toolCallId: "call-tokens",
      args: { query: "리서치 목표" },
      ctx: fakeToolContext(),
    });

    expect(capturedMaxTokens.length).toBeGreaterThan(0);
    for (const mt of capturedMaxTokens) {
      expect(mt).toBe(8000);
    }
  });

  it("P15-T2-02: org settings 에 toolMaxTokens 가 없으면(미설정) 정적 deps.maxTokens(4096)를 그대로 사용한다(비파괴)", async () => {
    const capturedMaxTokens: number[] = [];
    const capturingWorkerProvider: LLMProvider = {
      name: "fake-worker",
      models: ["fake-worker-model"],
      async *chat(input) {
        capturedMaxTokens.push(input.maxTokens);
        yield {
          type: "message_start",
          messageId: "msg-w",
          meta: { provider: "fake-worker", model: "fake-worker-model" },
        };
        yield { type: "text_delta", text: "핵심 사실 확인됨" };
        yield {
          type: "stop",
          reason: "end_turn",
          usage: { inputTokens: 1, outputTokens: 1 },
        };
      },
    };
    const tool = createDeepResearchTool({
      leadProvider: fakeLeadProvider({
        plannerResponse: "- 질문 A",
        synthesisResponse: () => "리포트",
        gapCheckResponse: () => "COMPLETE",
      }),
      leadModel: "fake-lead-model",
      workerProvider: capturingWorkerProvider,
      workerModel: "fake-worker-model",
      workerTools: [],
      maxTokens: 4096,
      da: fakeArtifactDa(),
      settings: {
        async resolve() {
          return { toolMaxTokens: 4096 };
        },
      },
    });

    await tool.invoke({
      toolCallId: "call-tokens-default",
      args: { query: "리서치 목표" },
      ctx: fakeToolContext(),
    });

    expect(capturedMaxTokens.length).toBeGreaterThan(0);
    for (const mt of capturedMaxTokens) {
      expect(mt).toBe(4096);
    }
  });

  it("gapCheck 가 계속 GAP 을 반환해도 maxGapIterations hard cap 에서 무한루프 없이 종료한다(MAST 종료조건)", async () => {
    const da = fakeArtifactDa();
    let gapCheckCalls = 0;
    const tool = createDeepResearchTool({
      leadProvider: fakeLeadProvider({
        plannerResponse: "- 질문 A",
        synthesisResponse: (call) => `리포트 v${call} [1]`,
        gapCheckResponse: () => {
          gapCheckCalls += 1;
          return "GAP: 추가 조사가 필요한 하위 질문";
        },
      }),
      leadModel: "fake-lead-model",
      workerProvider: fakeWorkerProvider(),
      workerModel: "fake-worker-model",
      workerTools: [fakeWorkerTool()],
      maxTokens: 512,
      da,
      maxGapIterations: 2,
    });

    const result = await tool.invoke({
      toolCallId: "call-3",
      args: { query: "리서치 목표" },
      ctx: fakeToolContext(),
    });

    if (result.content.kind !== "json") {
      throw new Error("json content 를 기대함");
    }
    // maxGapIterations=2 → gapCheck 는 최대 1회만 호출되고(마지막 라운드는 gapCheck 생략) 종료.
    expect(gapCheckCalls).toBe(1);
    const data = result.content.data as {
      artifact: { sizeBytes: number };
    };
    expect(data.artifact.sizeBytes).toBeGreaterThan(0);
  });
});
