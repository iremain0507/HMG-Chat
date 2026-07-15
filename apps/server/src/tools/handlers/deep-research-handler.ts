// deep-research-handler.ts — deep_research AgentTool(20-MULTI-AGENT-TOOL.md §20.6.1/P12-T2-08):
//   새 파이프라인이 아니라 P12 orchestrator-worker(P12-T2-01)/dag-planner(P12-T2-02) 위의 얇은
//   파사드다. plan(하위 질문 목록, effort=maxSubQuestions 로 상한) → 각 하위 질문을 격리
//   runTurn(workerTools=[web_search,knowledge_search] 등 read-only 만) 으로 병렬(Promise.all)
//   조사 → 텍스트+citation ChatEvent 를 findings 로 압축 → 종합(synthesis runTurn) →
//   gap 반성(gapCheck runTurn, GAP 이면 추가 researcher 1회 재실행) 을 maxGapIterations
//   hard cap 까지만 반복(MAST 종료조건 가드 — cap 도달 시 gapCheck 자체를 호출하지 않고 즉시
//   종료해 무한루프를 원천 차단) → 별도 citation 패스(matchCitations 로 리포트에 있으나
//   citations 목록에 없는 [N] 마커=인용 환각을 drop). 반환은 artifact-create-handler 와 동일한
//   kind:"json" duck-typing 관례({artifact,citations,message}) — orchestrator/packages/interfaces
//   무변경. citation.source 는 "project"|"ephemeral" 로 동결이라 web 결과는 web-search-handler 와
//   동일하게 "ephemeral"+sourceUri 로 근사(§20.4). 실시간 진행 스트림/수십분 백그라운드/
//   citation.source:"web" 은 동결 계약 변경이라 이 태스크 범위 밖(격리, §20.6.1).
import { WChatError } from "@wchat/interfaces";
import type {
  AgentTool,
  AgentToolSpec,
  LLMMessage,
  LLMProvider,
  PromptBlock,
  ToolContext,
  ToolProgressTask,
} from "@wchat/interfaces";
import { runTurn } from "../../orchestrator/orchestrator.js";
import { consumeUntilAbort } from "../../orchestrator/consume-until-abort.js";
import {
  matchCitations,
  type Citation,
} from "../../knowledge/citation-helper.js";
import {
  createArtifactService,
  type ArtifactDataAccess,
} from "../../db/artifact-service.js";

export const DEFAULT_MAX_SUB_QUESTIONS = 4;
export const DEFAULT_MAX_GAP_ITERATIONS = 2;
// 외부 호출(researcher)이 응답 없이 멈추는 경우를 대비한 전체 상한 시간(hang 방지).
//   딥리서치는 planner+병렬 researcher+긴 리포트 synthesis(gap 반성 최대 2회)로 정상적으로
//   수 분 걸리므로, 정당한 느린 run 을 죽이지 않게 넉넉히 잡는다(진짜 hang 만 차단).
//   keep-alive(messages.ts) 가 그 사이 연결을 유지한다.
const DEEP_RESEARCH_TIMEOUT_MS = 300_000;

export interface DeepResearchToolDeps {
  leadProvider: LLMProvider;
  leadModel: string;
  workerProvider: LLMProvider;
  workerModel: string;
  // researcher 에게 부여할 스코프 tool 목록(read-only 만 — web_search/knowledge_search).
  workerTools: AgentTool[];
  maxTokens: number;
  da: ArtifactDataAccess;
  // 하위 질문 개수 상한(effort cap) — 무제한 fan-out 방지. 기본 4.
  maxSubQuestions?: number;
  // gap 반성/재검색 라운드 hard cap(MAST 종료조건 가드) — 기본 2.
  maxGapIterations?: number;
}

export const deepResearchToolSpec: AgentToolSpec = {
  name: "deep_research",
  description:
    "복잡한 리서치 질문을 하위 질문으로 분해해 병렬로 조사하고, 인용이 포함된 markdown 리포트 아티팩트로 종합한다.",
  inputSchema: {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
  },
  permissionTier: "tool",
  defaultPolicy: "allow",
  tags: ["read-only", "web"],
};

interface ResearchFinding {
  subQuestion: string;
  text: string;
  citations: Citation[];
}

function buildPlannerSystemBlocks(maxSubQuestions: number): PromptBlock[] {
  return [
    {
      tier: "system",
      content: `리서치 목표를 최대 ${maxSubQuestions}개의 독립적인 하위 질문으로 분해하라. 다른 설명 없이 한 줄에 하나씩 "- " 로 시작하는 하위 질문만 나열하라.`,
    },
  ];
}

// 플래너 응답("- 질문" 줄 목록)을 파싱해 maxSubQuestions 로 자른다. 파싱 결과가 없으면
// (모델이 형식을 따르지 않았거나 빈 응답) 원 질문 자체를 단일 하위 질문으로 fallback —
// 항상 최소 1개의 researcher 가 실행되도록 보장한다.
export function parseSubQuestions(
  plannerText: string,
  maxSubQuestions: number,
  fallbackQuery: string,
): string[] {
  const lines = plannerText
    .split("\n")
    .map((line) => line.replace(/^[-*\d.\s]+/, "").trim())
    .filter((line) => line.length > 0);
  const subQuestions = lines.slice(0, maxSubQuestions);
  return subQuestions.length > 0 ? subQuestions : [fallbackQuery];
}

function buildResearcherSystemBlocks(): PromptBlock[] {
  return [
    {
      tier: "system",
      content:
        "주어진 하위 질문을 사용 가능한 도구로 조사해 근거 기반으로 답하라. 각 사실 주장 뒤에 [N] 형태로 출처 번호를 표기하라.",
    },
  ];
}

function buildSynthesisSystemBlocks(): PromptBlock[] {
  return [
    {
      tier: "system",
      content:
        "아래는 하위 질문별 조사 결과다. 이 내용만 근거로 하나의 markdown 리포트로 종합하라. 원문에 있는 [N] 출처 번호는 그대로 유지하고 새 번호를 만들지 마라.",
    },
  ];
}

function buildGapCheckSystemBlocks(): PromptBlock[] {
  return [
    {
      tier: "system",
      content:
        '아래 리서치 초안을 검토해 원 질문에 답하기 위해 반드시 채워야 할 결정적 공백이 있는지 판단하라. 공백이 없으면 첫 줄에 정확히 "COMPLETE" 만, 공백이 있으면 첫 줄에 정확히 "GAP: <추가로 조사할 하위 질문 하나>" 만 써라.',
    },
  ];
}

// gapCheck 응답 첫 줄을 판정. "GAP: <질문>" 형식이 아니면(COMPLETE 포함, 형식 미준수 포함)
// 안전하게 종료 쪽으로 fallback — 형식이 애매할 때 무한 재검색으로 새지 않도록 한다.
export function parseGapCheck(gapCheckText: string): {
  complete: boolean;
  gapQuestion?: string;
} {
  const firstLine = (gapCheckText.trim().split("\n")[0] ?? "").trim();
  const match = firstLine.match(/^GAP:\s*(.+)$/i);
  if (!match) return { complete: true };
  const gapQuestion = match[1]?.trim();
  return gapQuestion ? { complete: false, gapQuestion } : { complete: true };
}

// citations 목록에 없는 인덱스를 참조하는 [N] 마커를 제거 — STORM 식 "source_id 미존재 인용
// drop"(인용 환각 방지, §20.6.1 함정 방어).
export function dropUnmatchedCitationMarkers(
  text: string,
  unmatchedIndexes: number[],
): string {
  if (unmatchedIndexes.length === 0) return text;
  const unmatched = new Set(unmatchedIndexes);
  return text.replace(/\[(\d+)\]/g, (match, n: string) =>
    unmatched.has(Number(n)) ? "" : match,
  );
}

function toolContextFrom(ctx: ToolContext): Omit<ToolContext, "signal"> {
  return {
    requestId: ctx.requestId,
    userId: ctx.userId,
    orgId: ctx.orgId,
    sessionId: ctx.sessionId,
    ...(ctx.projectId !== undefined ? { projectId: ctx.projectId } : {}),
    logger: ctx.logger,
    hitl: ctx.hitl,
    budget: ctx.budget,
  };
}

// 무툴(tools 미지정) 격리 runTurn 을 돌려 최종 text_delta 누적만 반환 — planner/synthesis/
// gapCheck 3 단계가 모두 이 형태(단일 lead 모델 호출, tool 없음)를 공유한다.
async function runIsolatedText(
  content: string,
  provider: LLMProvider,
  model: string,
  systemBlocks: PromptBlock[],
  maxTokens: number,
  ctx: ToolContext,
): Promise<string> {
  const messages: LLMMessage[] = [{ role: "user", content }];
  let text = "";
  const events = runTurn({
    provider,
    model,
    systemBlocks,
    messages,
    maxTokens,
    signal: ctx.signal,
    toolContext: toolContextFrom(ctx),
  });
  await consumeUntilAbort(events, ctx.signal, (event) => {
    if (event.type === "text_delta") {
      text += event.text;
    }
  });
  return text;
}

// 하위 질문 하나를 격리 컨텍스트(자체 messages)+스코프 workerTools 로 조사한다. worker 내부
// tool_use/tool_result 는 노출되지 않고(orchestrator-worker.ts 와 동일 불변식), text_delta 와
// citation ChatEvent 만 이 함수 밖으로 압축되어 나간다.
async function runResearcher(
  subQuestion: string,
  deps: DeepResearchToolDeps,
  ctx: ToolContext,
): Promise<ResearchFinding> {
  const messages: LLMMessage[] = [{ role: "user", content: subQuestion }];
  let text = "";
  const citations: Citation[] = [];
  const events = runTurn({
    provider: deps.workerProvider,
    model: deps.workerModel,
    systemBlocks: buildResearcherSystemBlocks(),
    messages,
    maxTokens: deps.maxTokens,
    signal: ctx.signal,
    tools: deps.workerTools,
    toolContext: toolContextFrom(ctx),
  });
  await consumeUntilAbort(events, ctx.signal, (event) => {
    if (event.type === "text_delta") {
      text += event.text;
    } else if (event.type === "citation") {
      citations.push({
        index: event.index,
        source: event.source,
        filename: event.filename,
        snippet: event.snippet,
        ...(event.documentId !== undefined
          ? { documentId: event.documentId }
          : {}),
        ...(event.uploadId !== undefined ? { uploadId: event.uploadId } : {}),
        ...(event.title !== undefined ? { title: event.title } : {}),
        ...(event.sourceUri !== undefined
          ? { sourceUri: event.sourceUri }
          : {}),
        ...(event.page !== undefined ? { page: event.page } : {}),
      });
    }
  });
  return { subQuestion, text, citations };
}

// 각 finding 의 지역(finding 내부 1..n) citation 인덱스를 전역 순번으로 재번호하고, finding.text
// 안의 [N] 마커도 같은 매핑으로 재작성한 뒤 하나의 합성 텍스트로 합친다 — sub-question 마다
// 독립적으로 1부터 시작하는 citation 인덱스 충돌을 해소한다.
function remapFindingCitations(findings: ResearchFinding[]): {
  combinedText: string;
  citations: Citation[];
} {
  const citations: Citation[] = [];
  const sections: string[] = [];
  for (const finding of findings) {
    const localToGlobal = new Map<number, number>();
    for (const citation of finding.citations) {
      const globalIndex = citations.length + 1;
      localToGlobal.set(citation.index, globalIndex);
      citations.push({ ...citation, index: globalIndex });
    }
    const remappedText = finding.text.replace(
      /\[(\d+)\]/g,
      (match, n: string) => {
        const globalIndex = localToGlobal.get(Number(n));
        return globalIndex !== undefined ? `[${globalIndex}]` : match;
      },
    );
    sections.push(`### ${finding.subQuestion}\n${remappedText}`);
  }
  return { combinedText: sections.join("\n\n"), citations };
}

export function createDeepResearchTool(deps: DeepResearchToolDeps): AgentTool {
  const maxSubQuestions = deps.maxSubQuestions ?? DEFAULT_MAX_SUB_QUESTIONS;
  const maxGapIterations = deps.maxGapIterations ?? DEFAULT_MAX_GAP_ITERATIONS;
  const service = createArtifactService(deps.da);

  return {
    spec: deepResearchToolSpec,
    async invoke({ toolCallId, args, ctx: baseCtx }) {
      const query = typeof args.query === "string" ? args.query.trim() : "";
      if (!query) {
        return {
          toolCallId,
          content: {
            kind: "error",
            error: new WChatError(
              "INVALID_INPUT",
              "tool",
              false,
              "query 가 필요합니다.",
            ),
          },
        };
      }

      // researcher 등 외부 호출이 응답 없이 멈춰도 무한 대기하지 않도록 전체 상한 시간.
      //   초과 시 linked signal 을 abort → consumeUntilAbort 가 매 .next() 를 abort 와 race
      //   하므로 hang 이 즉시 풀리고, 예외가 상위(messages route catch)로 전파돼 client 는
      //   무한 "조사 중" 대신 재시도 가능한 error 로 종단된다. 아래 본문 전체가 이 ctx(=linked
      //   signal) 를 쓰므로 sub-call(runResearcher/runIsolatedText)에 그대로 전파된다.
      const timeoutController = new AbortController();
      setTimeout(() => timeoutController.abort(), DEEP_RESEARCH_TIMEOUT_MS);
      const ctx: ToolContext = {
        ...baseCtx,
        signal: AbortSignal.any([baseCtx.signal, timeoutController.signal]),
      };

      ctx.emitProgress?.({ stage: "planning", label: "조사 계획 수립 중" });
      const plannerText = await runIsolatedText(
        query,
        deps.leadProvider,
        deps.leadModel,
        buildPlannerSystemBlocks(maxSubQuestions),
        deps.maxTokens,
        ctx,
      );
      const subQuestions = parseSubQuestions(
        plannerText,
        maxSubQuestions,
        query,
      );

      // 하위질문별 라이브 작업 상태(스윔레인). Promise.all 은 순서 보존이라 findings 순번은
      //   안전하고, 각 researcher 가 끝나는 대로 해당 task 를 done + sourceCount 로 갱신해
      //   snapshot(전체 tasks 복사본)을 방출한다.
      const tasks: ToolProgressTask[] = subQuestions.map((q, i) => ({
        id: `sq-${i}`,
        title: q,
        status: "running",
        sourceCount: 0,
      }));
      const emitResearch = () => {
        const done = tasks.filter((t) => t.status === "done").length;
        ctx.emitProgress?.({
          stage: "researching",
          label: `${done}/${tasks.length} 하위질문 조사 완료`,
          tasks: tasks.map((t) => ({ ...t })),
        });
      };
      emitResearch();
      let findings = await Promise.all(
        subQuestions.map(async (subQuestion, i) => {
          const finding = await runResearcher(subQuestion, deps, ctx);
          const task = tasks[i];
          if (task) {
            task.status = "done";
            task.sourceCount = finding.citations.length;
          }
          emitResearch();
          return finding;
        }),
      );

      ctx.emitProgress?.({
        stage: "synthesizing",
        label: "결과 종합 중",
        tasks: tasks.map((t) => ({ ...t })),
      });
      let reportText = "";
      let citations: Citation[] = [];
      for (let iteration = 1; iteration <= maxGapIterations; iteration += 1) {
        const merged = remapFindingCitations(findings);
        citations = merged.citations;
        reportText = await runIsolatedText(
          merged.combinedText,
          deps.leadProvider,
          deps.leadModel,
          buildSynthesisSystemBlocks(),
          deps.maxTokens,
          ctx,
        );

        // hard cap 도달 — gapCheck 자체를 호출하지 않고 즉시 종료(MAST 종료조건 가드,
        // 응답 내용과 무관하게 무한루프를 원천 차단).
        if (iteration === maxGapIterations) break;

        const gapCheckText = await runIsolatedText(
          reportText,
          deps.leadProvider,
          deps.leadModel,
          buildGapCheckSystemBlocks(),
          deps.maxTokens,
          ctx,
        );
        const gap = parseGapCheck(gapCheckText);
        if (gap.complete || !gap.gapQuestion) break;

        const extra = await runResearcher(gap.gapQuestion, deps, ctx);
        findings = [...findings, extra];
        tasks.push({
          id: `gap-${iteration}`,
          title: gap.gapQuestion,
          status: "done",
          sourceCount: extra.citations.length,
        });
        ctx.emitProgress?.({
          stage: "synthesizing",
          label: "추가 조사 반영 중",
          tasks: tasks.map((t) => ({ ...t })),
        });
      }

      const { unmatchedIndexes } = matchCitations(reportText, citations);
      const finalText = dropUnmatchedCitationMarkers(
        reportText,
        unmatchedIndexes,
      );

      const record = await service.createArtifact(
        { userId: ctx.userId },
        {
          sessionId: ctx.sessionId,
          type: "markdown",
          filename: `deep-research-${toolCallId}.md`,
          data: Buffer.from(finalText, "utf-8"),
        },
      );

      ctx.emitProgress?.({
        stage: "done",
        label: "완료",
        tasks: tasks.map((t) => ({ ...t })),
      });
      return {
        toolCallId,
        content: {
          kind: "json",
          data: {
            artifact: {
              artifactId: record.id,
              artifactKind: record.type,
              filename: record.filename,
              sizeBytes: record.sizeBytes,
              downloadUrl: `/api/v1/artifacts/${record.id}/content`,
            },
            citations,
            message: `${subQuestions.length}개 하위 질문을 조사해 리포트로 종합했습니다.`,
          },
        },
      };
    },
  };
}
