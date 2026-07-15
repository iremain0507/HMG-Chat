# 20 — Multi-LLM · Multi-Agent · Universal Tool Orchestration (Phase P11–P12)

> 목적: WChat 을 **여러 LLM 모델을 골라 쓰고(멀티-LLM), 모든 모델이 다양한 툴/서브에이전트를 병렬로 활용하는(멀티-툴·멀티-에이전트)** agentic 플랫폼으로. Tavily 웹검색·code interpreter 를 1급 내장 툴로, universal tool-use 를 기본 지원.
> 근거: 2024–2026 최신 논문 + 프로덕션 프레임워크 4갈래 딥리서치(§20.9 출처). 작업방식: 딥리서치 → 계획 → 구현.
> 단일 출처: P11/P12 태스크 = `feature_list.json` `P11-*`/`P12-*` + [08-SPRINT-PLAN.md](08-SPRINT-PLAN.md) § Phase 11/12. 프롬프트 = `PROMPT.P11.md`.

---

## 20.1 목표 & 성공 기준

**목표**: (1) **멀티-LLM** — Anthropic/OpenAI/Google 등 여러 모델을 org/역할별로 선택·라우팅. (2) **universal tool use** — 모든 모델이 통일 `AgentToolSpec`(JSON Schema)로 툴 호출. (3) **멀티-툴** — knowledge_search·**web_search(Tavily)**·**code_interpreter(E2B)**·artifact_create + MCP 발견 툴. (4) **병렬 tool 실행**. (5) **멀티-에이전트** — orchestrator-worker + 의존성 DAG 병렬 + handoff. (6) 신뢰성(MAST 가드)·보안(lethal-trifecta 방어).

**성공 기준(Phase Gate)**

- G1. 구동 서버에서 실제 모델이 툴을 호출한다(현재는 어떤 툴도 못 부름 — §20.2). tool_use→tool_result→재호출 왕복이 실HTTP e2e 로 검증.
- G2. `GET /config`/`org.allowedModels` 로 노출된 여러 모델 중 UI 선택이 **런타임 turn 에 실반영**(현재는 env.LLM_MODEL 고정).
- G3. web_search·code_interpreter 가 dev-stub 주입으로 테스트 green, 실 provider 는 배포 시 교체.
- G4. 병렬 독립 툴 동시 실행 + 순서보존, HITL 툴 직렬 승인.
- G5. (P12) orchestrator-worker 가 격리 컨텍스트로 병렬 fan-out, 최종 메시지만 반환, AbortSignal 전파.
- G6. `packages/interfaces` 동결 유지(신규 계약 필요 항목은 전부 격리). server ≥ 80% 커버리지, verify-gates green.

---

## 20.2 핵심 진단 — "last-mile 배선" (4갈래 리서치 공통 결론)

현재 WChat 은 tool-use 가 **두 계층에서 동시에 죽어 있다**:

1. **프로바이더 미배선**: `orchestrator/llm-provider-anthropic.ts` 의 `chat()` body 에 `tools`/`tool_choice`/`disable_parallel_tool_use` 가 **없다** → 실 Claude 호출이 툴을 절대 못 봄. (dev-stub 이 tool_use 를 위조해 테스트만 통과 = 게이트 사각지대.)
2. **라우트 미주입**: `routes/messages.ts` 의 `runTurn(...)` 호출이 `tools`/`toolContext` 를 안 넘김(`MessageRouteDeps` 에 `tools` 필드조차 없음) + body 의 `model` 을 파싱 안 함 → turn 은 항상 `env.LLM_MODEL` 고정.

**결정적 사실**: `orchestrator.runTurn` 의 tool-execution 루프(plan→tool_use→execute→tool_result→재호출, HITL 지원)와 `packages/interfaces` 의 `ChatInput{tools?,toolChoice?,parallelToolCalls?,model}`·`AgentToolSpec`·`ChatEvent(tool_use/tool_result/citation/artifact_created)` 는 **이미 완전히 provider-중립으로 존재**한다. 즉 멀티-LLM·멀티-툴·universal tool 을 얹는 데 **동결 계약 변경이 거의 필요 없다** — 전부 `apps/server` 내부 배선이다. 이것이 P11 의 출발점(R0/활성화)이다.

---

## 20.3 연구 요약 (핵심 기법 · 출처는 §20.9)

- **멀티에이전트 토폴로지**: supervisor / **orchestrator-worker(런타임 동적분해)** / hierarchical / **parallel·map-reduce** / debate·ensemble / blackboard / **handoff·A2A**. 프로덕션 실증: Anthropic 멀티에이전트 리서치(단일 대비 +90%, 대신 ~15x 토큰).
- **병렬 vs 순차**: 의존성 DAG → 위상정렬 → 독립노드 병렬(**LLMCompiler**: ReAct 대비 3.7x 빠름). read-heavy·독립만 병렬, **shared-state(아티팩트 편집)는 단일 스레드**(Cognition).
- **플래닝**: ReAct(현 runTurn) · plan-and-execute · **ReWOO**(관찰-추론 디커플링, 툴콜 선플래닝) · ToT/GoT · Reflexion/evaluator-optimizer.
- **실패 taxonomy(MAST, arXiv:2503.13657)**: 명세이슈 41.8%(**스텝반복 17.1%**·종료조건 9.8%) / 오정렬 36.9%(**추론-행동 불일치 14%**) / 검증부재 21.3% → 저비용 프롬프트/루프 가드로 선제 방어.
- **universal tool use**: 통일 JSON Schema + **MCP(수직: 에이전트↔툴)** + A2A(수평: 에이전트↔에이전트). 대규모 카탈로그는 **임베딩 tool-retrieval**(전부 주입은 200+ 에서 붕괴).
- **멀티-LLM 라우팅**: 게이트웨이가 `LLMProvider` 구현(LiteLLM/OpenRouter 패턴) → model→provider 레지스트리 + provider별 tool-schema 변환. tool 미지원 모델은 prompt+constrained decoding(격리 대상). **스트리밍 failover 는 first-token 이전에만**.
- **내장 툴**: **Tavily**(search/extract/crawl, agentic search) · **code interpreter**(E2B Firecracker 격리, egress 차단) · default tool belt(web·code·file·RAG).
- **보안**: **lethal trifecta**(private data + 신뢰불가 콘텐츠 + 유출경로) — 웹검색+코드실행+파일접근을 한 에이전트에 다 얹으면 성립(EchoLeak CVE-2025-32711). 완화: 샌드박스 **egress 차단**, SSRF 검증(기존 `mcp/url-validator.ts` 재사용), 부작용 툴 `defaultPolicy:"hitl"`.

---

## 20.4 아키텍처 원칙 (모든 P11/P12 태스크에 적용)

1. **동결 계약이 이미 universal 경계다**: `LLMProvider.chat(ChatInput)→AsyncIterable<ChatEvent>`, `AgentToolSpec.inputSchema: JsonSchema`, `ChatEvent(tool_use/tool_result/citation/artifact_created)` 는 provider·model·tool 중립. **새 기능은 전부 `apps/server` 내부에** — `packages/interfaces`·`packages/shared` 는 절대 수정 금지. 새 계약이 필요하면(예: `tool_progress` 이벤트, `citation.source:"web"`, `AgentToolSpec` 멱등필드) **구현 말고 `.ralph/blocked_tasks` 격리(human gate)**.
2. **포트-어댑터 + dev-stub 주입**: 외부 서비스(Tavily/E2B/OpenAI/Gemini)는 **서버-로컬 포트 인터페이스**(`WebSearchPort` 등) 뒤에 두고, 테스트는 **in-memory fake 주입**(선례: `embedding-provider-dev-stub.ts`, `createLocalObjectStore`). LOCAL_ONLY 규칙 — 실 네트워크/E2B 미사용, 실 provider 는 배포 시 교체.
3. **역량 메타는 `tags` 로 인코딩**: MCP `readOnlyHint`/`idempotentHint` 의미를 `AgentToolSpec.tags`(예: `["read-only","idempotent","web"]`)로 — 전용 필드 신설(동결 위반) 회피.
4. **병렬은 allow-툴만, HITL 은 직렬**: 독립 read 툴은 `Promise.all`, 부작용/HITL 툴은 승인 순서 보존 위해 직렬. tool_result 는 **원래 tool_use 순서·id 정합** 유지.
5. **스트리밍 안전 failover/취소**: failover 는 **첫 `text_delta`/`tool_use` 이전**에만(무음 전환 금지, 이후 오류는 `error` 이벤트). `AbortSignal`(ToolContext 필수)을 모든 worker/tool 에 fan-out.
6. **MAST 신뢰성 가드**(저비용): 명시적 종료조건·스텝반복 감지·추론-행동 일치·검증 단계.
7. **보안 우선**: code interpreter 샌드박스 **egress 기본 차단**, 대상 URL SSRF 검증, MCP tool description 변경감지·재승인, 부작용 툴 HITL, `ctx.budget` 로 호출당 비용/횟수 상한.
8. **관측**: 각 tool `invoke` 를 기존 `lib/tool-metrics.ts` + OTel `gen_ai.*` span 으로 계측(라우팅 결정은 `message_start.meta`). 실행 안 한 절감/성능 주장 금지.
9. **토큰 경제성**: 멀티에이전트는 ~15x 토큰 → **고가치 태스크(리서치 fan-out)에만**, 소비형 Q&A 는 단일 에이전트. "가장 단순한 해법부터"(Anthropic).

### 신규 의존성 (본 계획이 명시 → 추가 허용)

사용자 지시로 **Tavily·code interpreter 기본 지원 + 멀티-LLM** 이 요구됨. 따라서 다음은 계획-명시 의존성이다(각 태스크에서 필요 시 추가): Tavily(직접 REST 또는 `tavily` SDK), **E2B**(`@e2b/code-interpreter` 등 — stack 에 이미 e2b 언급), **`openai`**, **`@google/generative-ai`**. 그 외 미명시 의존성(Outlines/XGrammar/GPTCache 등)은 **격리**.

---

## 20.5 Phase P11 — 활성화 + 멀티-LLM + Universal 툴 (단일 에이전트)

목표: 단일 에이전트가 **여러 모델 중 선택**되고 **여러 툴(내장+Tavily+code+MCP)을 병렬로** 실제 호출. path: T2 = `orchestrator/**`·`tools/handlers/**`·`routes/{sessions,messages}.ts`, T1 = `tools/sandbox/**`·`mcp/**`·`lib/**`, T3 = `knowledge/**`.

### 활성화 (R0 — 최우선, 이것부터)

- **P11-T2-01 · Anthropic provider tool 배선** — `llm-provider-anthropic.ts chat()` 에 `input.tools`→`tools`(`AgentToolSpec.inputSchema`→`input_schema`), `input.toolChoice`→`tool_choice`, `parallelToolCalls===false`→`disable_parallel_tool_use`. partial_json `JSON.parse` try/catch 견고화(잘린 JSON 이 turn 을 안 죽임). _계약 불변._
- **P11-T2-02 · 라우트 tool/model 주입** — `routes/messages.ts` 가 내장 핸들러+MCP 툴을 `AgentTool[]` 로 조립해 `runTurn` 에 `tools`+`toolContext`(userId/orgId/sessionId/projectId/signal/logger/hitl/budget) 주입 + body `model` 파싱→`org.allowedModels` 화이트리스트 검증→turn model 로. `MessageRouteDeps` 에 `tools`/`toolContext` 필드 추가. **실HTTP 통합테스트(createApp): tool_use↔tool_result 왕복 + HITL 툴 승인 전 미실행.** _신규 prefix 없음._

### 멀티-LLM (§20.3 라우팅)

- **P11-T2-03 · llm-provider-registry.ts** — `LLMProvider` 구현(`name:"registry"`, models=하위 union), `input.model`로 concrete provider 위임, 미등록→`WChatError`. `app.ts` 가 이 레지스트리를 provider 로 주입.
- **P11-T2-04 · tool-schema-codec.ts** — `AgentToolSpec`→{anthropic `input_schema` / openai `function.parameters` / gemini `functionDeclarations`} 순수변환 + toolChoice(`any↔required↔ANY`) 매핑. 골든테스트.
- **P11-T2-05 · llm-provider-openai.ts** — OpenAI 어댑터(스키마 변환 + args JSON-string parse→`tool_use` + 스트림→ChatEvent 정규화). fake client RED. dep: `openai`.
- **P11-T2-06 · llm-provider-google.ts** — Gemini 어댑터(functionDeclarations, mode ANY). dep: `@google/generative-ai`.
- **P11-T2-07 · model-router.ts** — 정적 role→model 맵(오케스트레이터=상위, memory/titling=경량) + org/plan 상한. `selectModel` 이 `ChatInput.model` 설정, `message_start.meta` 관측.
- **P11-T2-08 · llm-failover.ts** — first-token 이전 failover + context-window fallback + backoff + cooldown, AbortSignal-safe. RED: 첫토큰 후 오류→무음전환 안 함.
- **P11-T1-03 · GET /config 라우트** — `availableModels`(레지스트리 models ∩ org.allowedModels) 반환. app.ts 마운트 + `routes-mounted.test.ts` EXPECTED_ROUTES 추가. (org.allowedModels 시드도 포함.)

### 병렬 + universal 툴

- **P11-T2-09 · runTurn 병렬 tool 실행** — allow 정책 툴 `Promise.all` 병렬, hitl 툴 직렬, tool_result 순서·id 보존. provider.chat 에 `parallelToolCalls` 전달. [LLMCompiler 축소판]
- **P11-T2-10 · arg-validator** — `tools/arg-validator.ts` 순수함수 `validateArgs(args, spec.inputSchema)` → `runTurn` 이 invoke 직전 호출, 실패=`tool_result`(kind error, `WChatError("SCHEMA_INVALID")`). tool 환각 side-effect 차단.
- **P11-T2-11 · web_search 툴(Tavily)** — 서버-로컬 `WebSearchPort` + Tavily 어댑터 + **dev-stub(in-memory fake)** + `createWebSearchTool`. `defaultPolicy:"allow"`, `tags:["read-only","idempotent","web"]`. dep: Tavily.
- **P11-T1-01 · SandboxTransport E2B 구현** — `tools/sandbox/**` 에 frozen `SandboxTransport`(start/runCommand:AsyncIterable/writeFile/readFile/uploadToS3/stop) E2B 구현 + **in-memory fake**(runCommand chunk 시뮬). **egress 기본 차단.** dep: E2B.
- **P11-T2-12 · code_interpreter 툴** — `SandboxTransport` DI, stdout 버퍼→`text`, 생성파일→artifact-store→`kind:"file"`→`artifact_created` emit, `ctx.signal` 취소 관통. `defaultPolicy` allow(순수계산)/hitl(부작용) 정책.
- **P11-T2-13 · web-result citation emit** — tool_result json→`citation` ChatEvent(`source:"ephemeral"`+`sourceUri`, 기존 orchestrator unpack 재사용). (`source:"web"` 추가는 격리.)
- **P11-T1-02 · MCP 보안 하드닝** — `url-validator.ts`(SSRF)를 discover 뿐 아니라 **매 invoke 에도** 적용 + tool description 변경감지/재승인(HITL). 첫-등장 MCP 툴 `defaultPolicy:"hitl"`.
- **P11-T2-14 · 툴 관측** — 각 invoke 를 `lib/tool-metrics.ts` + OTel `gen_ai.*` child span 으로 계측.

---

## 20.6 Phase P12 — 멀티에이전트 오케스트레이션 (P11 위에)

목표: 고가치 태스크에서 orchestrator-worker 병렬 fan-out. **P11(단일 에이전트 활성화) 검증 후 착수**(Anthropic "단순 먼저"). path: T2 `orchestrator/**`.

- **P12-T2-01 · Orchestrator-Worker 조합** — worker = 격리 컨텍스트 + 스코프 `AgentToolSpec[]` 로 호출되는 `runTurn` 인스턴스. 중간 tool_use/result 는 내부에 머물고 **압축 최종 텍스트만 부모 tool_result 로 반환**(Claude subagent 모델). 부모 스트림은 **기존 ChatEvent 변형만** 방출(동결 준수). [Anthropic orchestrator-workers]
- **P12-T2-02 · 의존성 DAG 플래너 + 병렬** — 목표→서브태스크+의존그래프(placeholder 변수). 독립노드 `Promise.all`(다수 runTurn AsyncIterable 동시소비), 의존노드 순차. read-heavy·독립만 병렬, shared-state 는 단일. [LLMCompiler/ReWOO]
- **P12-T2-03 · AbortSignal fan-out** — 부모 취소→진행중 전 worker 즉시 중단 테스트(CLAUDE.md orchestrator 게이트).
- **P12-T2-04 · Routing/Handoff 노드** — 분류→specialist worker 위임, handoff payload = orchestrator 내부 타입(ChatEvent 승격 금지). [OpenAI Swarm]
- **P12-T2-05 · Evaluator-Optimizer 래퍼** — artifact worker 생성기+평가기 닫힌 루프(평가=무툴 runTurn), 명확 기준일 때만. [Reflexion/Anthropic]
- **P12-T2-06 · MAST 신뢰성 가드 4종** — 스텝반복 감지·명시적 종료조건·추론-행동 일치·검증 worker. 각 실패재현 RED. [MAST]
- **P12-T2-07 · tool-router.ts (대규모 카탈로그)** — MCP 툴 200+ 시 `AgentToolSpec.description` 임베딩(dev-stub) + pgvector top-k 선택 후 subset 만 주입. [tool-retrieval]
- **P12-T2-08 · deep_research 툴** — §20.6.1.
- **P12-T6-01 · 멀티에이전트 활동 UI** — 서브에이전트 진행/플랜을 우패널에 표시. **단 새 ChatEvent 변형이 필요하면 격리**(동결) — 기존 tool_use 카드로 근사 가능한 범위만 T6, 그 이상은 blocked.

### 20.6.1 deep_research 툴 (딥리서치 확정 설계)

근거: OpenAI/Gemini/Perplexity/Anthropic + OSS(GPT-Researcher·LangChain open_deep_research·smolagents·STORM·dzhng) 딥리서치. 공통 골격 = **Plan → 병렬 검색(격리 researcher) → 압축 → gap 반성/재검색(hard cap) → 종합 → 별도 인용 패스**.

**설계 = P12 orchestrator-worker 위의 얇은 AgentTool 파사드**(새 파이프라인 아님 — reuse 원칙):

- `tools/handlers/deep-research-handler.ts`(T2). `deep_research.invoke(query, ctx)` 가 내부에서 **P12-T2-01 orchestrator-worker 엔진**을 호출: 목표→서브질문 DAG(P12-T2-02) → 각 서브질문 = 격리 컨텍스트 runTurn(병렬 Promise.all, `workerTools=[web_search, knowledge_search]` read-only만) → 중간 tool_use/result 는 worker 내부에만 → 압축 findings + 집계 citations 회수 → 아웃라인 합성(STORM식, 모든 claim 에 source_id) → **별도 citation 패스**(sources 에 없는 인용 claim drop = 환각 필터).
- **반환형식(핵심): `kind:"json"` + `{ artifact:{artifactId,artifactKind:"markdown",…}, citations:[…], message }`** — `kind:"file"` 아님. 현 `runTurn` 은 `kind:"json"` 의 `data.artifact`/`data.citations` 만 duck-typing 해 `artifact_created`+`citation` ChatEvent 로 펼침(artifact-create-handler 와 동일 관례). **orchestrator·packages/interfaces 무변경.**
- 웹 인용은 `citation.source:"ephemeral"` + `sourceUri`(source `"web"` 는 동결 → 격리). effort 스케일(단순 1 agent / 비교 2–4 / 복잡 10+), lead=강모델·worker=중간모델(model-router P11-T2-07).
- **함정 방어**(리서치): `max_iterations`/`max_tool_calls`/`ctx.budget` hard cap(무한루프·토큰폭주 — 툴콜↑이 인용정확도↑ 아님, 오히려 ~42%↓), 압축 노드(컨텍스트 절단), source_id 필수+미존재 인용 drop(인용 환각 11–57%), broad→narrow + 다관점(shallow 방지), dedup+rerank. HITL/취소(AbortSignal)/budget 은 ToolContext 상속, org 노출은 `Organization.allowedTools`.
- **장기실행**: v1 = **동기 buffered invoke(수분 상한)** + messages.ts streamSSE 에 **keep-alive 코멘트 라인(`:\n\n`, ChatEvent 아님 → 동결 무위반)** 으로 idle-timeout 방어. **수십분 백그라운드 + 완료알림은 격리**(NotificationEvent 완료변형 + pending tool_result 재개 = 동결 계약 변경).
- **평가**(후속): DeepResearch Bench(RACE 품질 4차원 + FACT 인용정확도), LLM-as-judge 루브릭(사실·인용·완결·소스품질·툴효율) + 인간 감독.
- **격리(deep_research 관련)**: 실시간 진행 스트림(`tool_progress` ChatEvent), 수십분 백그라운드(NotificationEvent), `citation.source:"web"` — 전부 동결 변경 → blocked.

---

## 20.7 격리 (blocked_tasks — human gate / 미지정 의존성)

동결 계약 변경 또는 미지정 의존성이라 **구현 말고 격리**(근거·대안 기록):

- `packages/interfaces` 변경 필요: `tool_progress` ChatEvent(코드 stdout 실시간 스트림), `citation.source:"web"`, `AgentToolSpec` 멱등/파괴성 전용필드, subagent 진행 SSE 변형.
- **A2A(외부 에이전트 상호운용)** — 단일 배포·미지정 의존성, 향후 외부 에이전트 시점에 재검토.
- **OSS tool 미지원 모델 에뮬레이션** — Outlines/XGrammar/vLLM guided_json 등 미지정 의존성.
- **semantic cache**(GPTCache/redis-vector) — 새 dep + RLS/결정성 리스크, 결정적 서브콜 한정 재검토.
- **학습형 라우터(RouteLLM/Hybrid-LLM)** — 데이터·의존성 필요, 정적 맵(P11-T2-07)으로 선행.

---

## 20.8 실행 방법

1. 계획 문서 추가 → `rm .ralph/spec.md5`(spec-drift 해제).
2. `.ralph/current_phase` = `P11`.
3. `MAX_ITERS=40 MAX_TURNS=130 BUDGET_USD=20 MODEL=sonnet bash scripts/loop.sh` (P11 전용 `PROMPT.P11.md` 자동선택). P11 완료·검증 후 P12 승급.
4. 실 provider(Tavily/E2B/OpenAI/Google) API 키는 배포 시 `.env` 로 주입 — 테스트는 dev-stub.

> 워커 hang 방지: hung-vitest 워치독은 `pgrep -f vitest` 가 아니라 **claude 워커 제외**(ps -o command 필터)로 만들 것. SSE-스텁 테스트는 스트림 `controller.close()` 필수.

---

## 20.9 출처 (딥리서치 실검증)

**멀티에이전트/플래닝**: MAST arXiv:2503.13657 · Magentic-One 2411.04468 · ReAct 2210.03629 · ReWOO 2305.18323 · LLMCompiler 2312.04511 · Plan-and-Solve 2305.04091 · ToT 2305.10601 · GoT 2308.09687 · Reflexion 2303.11366 · Multiagent Debate 2305.14325 · MetaGPT 2308.00352 · AutoGen 2308.08155 · Blackboard MAS 2510.01285 · MAS 서베이 2501.06322. Anthropic _Building Effective Agents_·멀티에이전트 리서치·컨텍스트 엔지니어링 · Cognition _Don't Build Multi-Agents_ · OpenAI Swarm/Agents SDK · Claude Agent SDK subagents · LangGraph supervisor · Google A2A.
**툴 use**: Toolformer 2302.04761 · Gorilla 2305.15334 · ToolLLM 2307.16789 · (LLMCompiler/ReWOO 상동) · MCP spec · Anthropic tool use docs · Natural Language Tools 2510.14453.
**멀티-LLM 라우팅**: RouteLLM 2406.18665 · FrugalGPT 2305.05176 · Hybrid LLM 2404.14618 · AutoMix 2310.12963 · Unified Routing 2410.10347 · Universal Model Routing 2502.08773 · XGrammar 2411.15100 · JSONSchemaBench 2501.10868 · Let Me Speak Freely 2408.02442 · LiteLLM/OpenRouter/Vercel AI SDK/Semantic Router.
**통합/보안**: Tavily·Exa·Serper·Brave docs · E2B/Riza/Daytona/Modal · lethal trifecta(simonwillison.net) · EchoLeak CVE-2025-32711 · OWASP MCP Top10.
