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
import type { ArtifactDataAccess } from "../../db/artifact-service.js";
import type { ResolvedOrgSettings } from "../../lib/org-settings-schema.js";

export const DEFAULT_MAX_SUB_QUESTIONS = 4;
export const DEFAULT_MAX_GAP_ITERATIONS = 2;
// 외부 호출(researcher)이 응답 없이 멈추는 경우를 대비한 전체 상한 시간(hang 방지).
//   딥리서치는 planner+병렬 researcher+긴 리포트 synthesis(gap 반성 최대 2회)로 정상적으로
//   수 분 걸리므로, 정당한 느린 run 을 죽이지 않게 넉넉히 잡는다(진짜 hang 만 차단).
//   keep-alive(messages.ts) 가 그 사이 연결을 유지한다.
const DEEP_RESEARCH_TIMEOUT_MS = 300_000;

// P15-T2-02 — org-scoped toolMaxTokens 동적 조회 포트. settings-service.ts(P14)의
// SettingsService.resolve 와 구조적으로 호환되는 최소 계약만 의존(DI, 순환 회피 — T2 는
// lib/settings-service.ts 를 직접 import 하지 않고 org-settings-schema.ts 의 ResolvedOrgSettings
// 형태만 재사용).
export interface ToolSettingsResolverPort {
  // 새 필드(deepResearch*)는 기존 fake/구현 하위호환을 위해 Partial 로 넓힌다 — 미제공 시
  // 핸들러가 deps/DEFAULT 로 폴백한다.
  resolve(
    orgId: string,
  ): Promise<
    Pick<ResolvedOrgSettings, "toolMaxTokens"> &
      Partial<
        Pick<
          ResolvedOrgSettings,
          "deepResearchMaxSubQuestions" | "deepResearchMaxGapIterations"
        >
      >
  >;
}

export interface DeepResearchToolDeps {
  leadProvider: LLMProvider;
  leadModel: string;
  workerProvider: LLMProvider;
  workerModel: string;
  // researcher 에게 부여할 스코프 tool 목록(read-only 만 — web_search/knowledge_search).
  workerTools: AgentTool[];
  // settings 미주입/조회 실패/org 미설정 시 fail-soft 폴백(항상 DEFAULT_ORG_SETTINGS.toolMaxTokens
  // 와 동일값 유지 — 21-LOOP-LESSONS.md L2).
  maxTokens: number;
  // (구) 종합 리포트를 markdown 아티팩트로 저장할 때 쓰던 포트. 이제 리포트는 본문에 렌더하고
  // 아티팩트는 만들지 않으므로(정책: 아티팩트는 HTML 등 렌더링 필요/명시 요구 시만) 미사용.
  // 조립부(assemble-builtin-tools) 하위호환을 위해 선택적으로만 남긴다.
  da?: ArtifactDataAccess;
  // 하위 질문 개수 상한(effort cap) — 무제한 fan-out 방지. 기본 4.
  maxSubQuestions?: number;
  // gap 반성/재검색 라운드 hard cap(MAST 종료조건 가드) — 기본 2.
  maxGapIterations?: number;
  // 주입 시 invoke 시점에 ctx.orgId 로 조회해 toolMaxTokens 를 동적 반영(정적 maxTokens 를
  // 조용히 쓰지 않도록 — L1). 미주입 시 기존처럼 deps.maxTokens 그대로 사용(비파괴).
  settings?: ToolSettingsResolverPort;
}

// settings 미주입/조회 실패는 절대 throw 하지 않고 deps.maxTokens 로 fail-soft 한다
// (messages.ts resolveSettingsSafely 와 동일 원칙, L2/L5).
// deep_research 의 org-scoped 파라미터(토큰 예산·병렬 조사 폭·반성 횟수)를 invoke 시점에 한 번에
// 해석한다. settings 미주입/조회 실패/미설정 필드는 정적 deps → 코드 DEFAULT 로 fail-soft(L2).
interface ResolvedDeepResearchSettings {
  maxTokens: number;
  maxSubQuestions: number;
  maxGapIterations: number;
}
async function resolveDeepResearchSettings(
  deps: DeepResearchToolDeps,
  orgId: string,
  logger: ToolContext["logger"] | undefined,
): Promise<ResolvedDeepResearchSettings> {
  const fallback: ResolvedDeepResearchSettings = {
    maxTokens: deps.maxTokens,
    maxSubQuestions: deps.maxSubQuestions ?? DEFAULT_MAX_SUB_QUESTIONS,
    maxGapIterations: deps.maxGapIterations ?? DEFAULT_MAX_GAP_ITERATIONS,
  };
  if (!deps.settings) return fallback;
  try {
    const resolved = await deps.settings.resolve(orgId);
    // ResolvedOrgSettings 필드는 zod `.optional()` 기반이라 `??` 로 잔여 undefined 를 보강한다.
    return {
      maxTokens: resolved.toolMaxTokens ?? fallback.maxTokens,
      maxSubQuestions:
        resolved.deepResearchMaxSubQuestions ?? fallback.maxSubQuestions,
      maxGapIterations:
        resolved.deepResearchMaxGapIterations ?? fallback.maxGapIterations,
    };
  } catch (error) {
    logger?.warn({
      category: "system",
      msg: "deep_research: org settings resolve 실패 — 정적 deps 값으로 폴백",
      orgId,
      context: { error: String(error) },
    });
    return fallback;
  }
}

export const deepResearchToolSpec: AgentToolSpec = {
  name: "deep_research",
  description:
    "복잡한 리서치 질문을 하위 질문으로 분해해 병렬로 조사하고, 인용이 포함된 markdown 리포트로 종합한다. **중요: 리포트 전문(result.report)은 이 도구 카드에 이미 그대로 렌더되어 사용자에게 보인다. 따라서 리포트 내용을 답변에 다시 옮겨 적지 말 것(중복 방지). '아티팩트'·'우측 패널'도 언급하지 말 것. 답변은 '조사를 마쳤고 아래 리포트를 참고하라'는 취지의 한두 문장으로 짧게 끝내라.**",
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
  maxTokens: number,
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
    maxTokens,
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
  // 하위질문별 출처(전역 인덱스) — 클라가 서브에이전트를 펼치면 어떤 출처를 썼는지 보여준다.
  subQuestions: { title: string; citations: Citation[] }[];
} {
  const citations: Citation[] = [];
  const sections: string[] = [];
  const subQuestions: { title: string; citations: Citation[] }[] = [];
  for (const finding of findings) {
    const localToGlobal = new Map<number, number>();
    const findingCitations: Citation[] = [];
    for (const citation of finding.citations) {
      const globalIndex = citations.length + 1;
      localToGlobal.set(citation.index, globalIndex);
      const remapped = { ...citation, index: globalIndex };
      citations.push(remapped);
      findingCitations.push(remapped);
    }
    const remappedText = finding.text.replace(
      /\[(\d+)\]/g,
      (match, n: string) => {
        const globalIndex = localToGlobal.get(Number(n));
        return globalIndex !== undefined ? `[${globalIndex}]` : match;
      },
    );
    sections.push(`### ${finding.subQuestion}\n${remappedText}`);
    subQuestions.push({
      title: finding.subQuestion,
      citations: findingCitations,
    });
  }
  return { combinedText: sections.join("\n\n"), citations, subQuestions };
}

export function createDeepResearchTool(deps: DeepResearchToolDeps): AgentTool {
  // maxSubQuestions/maxGapIterations 는 이제 invoke 시점에 org-scoped 로 해석한다(아래).

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
      const overallTimeoutId = setTimeout(
        () => timeoutController.abort(),
        DEEP_RESEARCH_TIMEOUT_MS,
      );
      const ctx: ToolContext = {
        ...baseCtx,
        signal: AbortSignal.any([baseCtx.signal, timeoutController.signal]),
      };

      // P15-T2-02 + deep_research org 설정 — invoke 시점에 ctx.orgId 로 org-scoped 파라미터
      // (토큰 예산·하위질문 수·반성 횟수)를 한 번에 조회(L1). 미주입/실패/미설정은 deps→DEFAULT 폴백.
      const { maxTokens, maxSubQuestions, maxGapIterations } =
        await resolveDeepResearchSettings(deps, ctx.orgId, ctx.logger);

      ctx.emitProgress?.({ stage: "planning", label: "조사 계획 수립 중" });
      const plannerText = await runIsolatedText(
        query,
        deps.leadProvider,
        deps.leadModel,
        buildPlannerSystemBlocks(maxSubQuestions),
        maxTokens,
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
          const finding = await runResearcher(
            subQuestion,
            deps,
            maxTokens,
            ctx,
          );
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
      let subQuestionBreakdown: { title: string; citations: Citation[] }[] = [];
      // 종합 실패 시 폴백용 — 이미 remap 된 findings 원문(하위질문별 텍스트+[N] 인용).
      let combinedFindings = "";
      let synthesisDegraded = false;
      // 종합은 이 루프 안에서 이뤄지므로 최소 1라운드는 돌아야 한다(반성 0회여도 1회 종합).
      // gapRounds=1 이면 종합 1회 후 gapCheck 없이 종료(반성 없음). org 설정 0 → 반성 없이 1회 종합.
      const gapRounds = Math.max(1, maxGapIterations);
      try {
        for (let iteration = 1; iteration <= gapRounds; iteration += 1) {
          const merged = remapFindingCitations(findings);
          citations = merged.citations;
          subQuestionBreakdown = merged.subQuestions;
          combinedFindings = merged.combinedText;
          reportText = await runIsolatedText(
            merged.combinedText,
            deps.leadProvider,
            deps.leadModel,
            buildSynthesisSystemBlocks(),
            maxTokens,
            ctx,
          );

          // hard cap 도달 — gapCheck 자체를 호출하지 않고 즉시 종료(MAST 종료조건 가드,
          // 응답 내용과 무관하게 무한루프를 원천 차단).
          if (iteration === gapRounds) break;

          const gapCheckText = await runIsolatedText(
            reportText,
            deps.leadProvider,
            deps.leadModel,
            buildGapCheckSystemBlocks(),
            maxTokens,
            ctx,
          );
          const gap = parseGapCheck(gapCheckText);
          if (gap.complete || !gap.gapQuestion) break;

          const extra = await runResearcher(
            gap.gapQuestion,
            deps,
            maxTokens,
            ctx,
          );
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
      } catch (error) {
        // 종합/gap 단계가 응답 없이 멈추거나(전체 상한 타임아웃 abort) 실패해도, 이미 모은
        // findings 를 리포트로 폴백한다 — "결과 종합 중" 무한 hang·무결과 방지. 단, 사용자
        // 취소(baseCtx.signal)는 중단 의사이므로 그대로 전파한다.
        if (baseCtx.signal.aborted) throw error;
        reportText = reportText || combinedFindings;
        synthesisDegraded = true;
      } finally {
        clearTimeout(overallTimeoutId);
      }

      const { unmatchedIndexes } = matchCitations(reportText, citations);
      const finalText = dropUnmatchedCitationMarkers(
        reportText,
        unmatchedIndexes,
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
            // 종합 리포트(markdown) 를 본문에 그대로 렌더한다 — 아티팩트로 밀어넣지 않는다(정책:
            // 아티팩트는 HTML 등 렌더링 필요/명시 요구 시만). 클라 ToolCallRenderer 가 <Markdown> 렌더.
            report: finalText,
            citations,
            // 하위질문별 출처(전역 인덱스) — 클라 WorkerCard 펼침에서 사용(duck-typed json 추가 필드).
            subQuestions: subQuestionBreakdown,
            message: synthesisDegraded
              ? `${subQuestions.length}개 하위 질문 조사 결과입니다(최종 종합이 시간 내 완료되지 않아 조사 원문을 제공).`
              : `${subQuestions.length}개 하위 질문을 조사해 리포트로 종합했습니다.`,
          },
        },
      };
    },
  };
}
