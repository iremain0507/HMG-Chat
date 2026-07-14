# LOOP PROMPT — Phase P11/P12 (Multi-LLM · Multi-Agent · Universal Tool)

당신은 자율 코딩 루프의 한 반복이다. 이전 반복 기억 없음. 상태는 파일·git 에만.
목표: WChat 을 멀티-LLM(여러 모델 선택) · universal tool-use(모든 모델이 툴 호출) · 멀티-툴(web_search/code_interpreter/knowledge/MCP) · 병렬 tool · 멀티-에이전트로.
단일 출처: **rebuild_plan/20-MULTI-AGENT-TOOL.md**(읽어라 — §20.2 핵심진단, §20.4 원칙, §20.5 P11, §20.6 P12). 태스크 = feature_list.json 의 `P11-*`/`P12-*`.

## 0. 오리엔테이션 (매번)

1. `git log --oneline -15`, PROGRESS.md, `.ralph/current_phase`, `.ralph/blocked_tasks` 읽기.
2. **20-MULTI-AGENT-TOOL.md** 정독(§20.4 원칙 필수).
3. feature_list 에서 `phase==current_phase`, `passes==false`, blocked 아닌 항목 중 **배열 최상단 하나** 선택. `.ralph/last_fail.txt` 있으면 그 수정이 이번 태스크.

## 1. 계약 (엄수 — 이 phase 의 핵심)

- **동결 계약이 이미 universal 경계다**: `LLMProvider.chat(ChatInput)→AsyncIterable<ChatEvent>`, `AgentToolSpec.inputSchema: JsonSchema`, `ChatEvent(tool_use/tool_result/citation/artifact_created)` 는 provider·model·tool 중립. **새 기능은 전부 `apps/server` 내부에 구현.**
- **`packages/interfaces`·`packages/shared` 절대 수정 금지.** 새 계약이 필요하면(tool_progress 이벤트, citation.source "web", AgentToolSpec 멱등필드, subagent 진행 SSE 등) **구현 말고 `.ralph/blocked_tasks` 격리**(사유·대안 기록).
- **역량 메타는 `AgentToolSpec.tags`** 로 인코딩(read-only/idempotent/web/code-exec 등) — 전용 필드 신설 금지.
- **포트-어댑터 + dev-stub**: 외부 서비스(Tavily/E2B/OpenAI/Gemini)는 **서버-로컬 포트 인터페이스** 뒤에 두고, 테스트는 **in-memory fake 주입**(선례 `embedding-provider-dev-stub.ts`·`createLocalObjectStore`). 실 네트워크/E2B 미사용. 실 provider 는 배포 시 교체.
- **계획-명시 의존성만**: Tavily·E2B(`@e2b/*`)·`openai`·`@google/generative-ai` 는 본 계획이 명시(추가 허용). 그 외 미명시(Outlines/XGrammar/GPTCache 등)는 **격리**.
- path ownership: T2=`orchestrator/**`·`tools/handlers/**`·`routes/{sessions,messages}.ts`, T1=`tools/sandbox/**`·`mcp/**`·`lib/**`·config route, T3=`knowledge/**`, T6=`apps/web/src/**`. 타 팀 소유 파일 편집 필요 시 격리.
- 새 HTTP route **prefix** 추가 시 `app.ts` 마운트 + `routes-mounted.test.ts` EXPECTED_ROUTES 갱신.

## 2. TDD (한 태스크만) — RED 필수

- `attempts`+1 → 실패 테스트 먼저, **실제 실행으로 RED 확인**(처음부터 통과하면 재검토) → 최소구현 → GREEN. 스코프 확장 금지.
- 외부 서비스는 **fake 주입**으로 테스트(실 API 금지). LLM tool 배선은 fake LLMProvider/fake client 로.
- server vitest: **SSE/스트리밍 스텁은 반드시 스트림을 종료**시켜라(무한 async iterable → vitest hang → watchdog kill). 5초 내 끝나는지 확인.

## 3. P11/P12 엔지니어링 원칙 (§20.4)

- **활성화 먼저(P11-T2-01/02)**: provider 가 tools/tool_choice 를 forward + route 가 tools/toolContext/model 주입 — 이 둘이 tool-use 를 런타임에 살린다(현재 둘 다 죽어 있음).
- **병렬은 allow-툴만, HITL 은 직렬**. tool_result 는 tool_use 순서·id 정합.
- **스트리밍 안전**: failover 는 첫 토큰 이전에만(무음 전환 금지). AbortSignal 을 모든 worker/tool 에 fan-out.
- **MAST 가드**: 스텝반복 감지·명시적 종료조건·추론-행동 일치·검증. (P12-T2-06)
- **보안(lethal-trifecta)**: code interpreter 샌드박스 **egress 차단**, URL 은 `mcp/url-validator.ts`(SSRF) 재사용, 부작용 툴 `defaultPolicy:"hitl"`, `ctx.budget` 로 상한.
- **멀티에이전트(P12)**: worker=격리 runTurn, **최종 메시지만 부모 tool_result 로 반환**. 부모 스트림은 기존 ChatEvent 만. 독립·read-heavy 만 병렬, shared-state 는 단일 스레드. 고가치 태스크에만(토큰 ~15x).

## 4. 검증 (커밋 전)

- `bash scripts/verify-gates.sh` exit 0 (typecheck·lint·test·validate-state·lint-plan). server ≥ 80% 커버리지.
- **실HTTP 통합테스트**(createApp 기반)로 tool_use↔tool_result 왕복·HITL 게이트·모델 선택 반영 검증.
- 실행 안 한 검증/성능·절감을 통과했다고 서술 금지.

## 5. 기록 & 커밋

- 해당 항목 `passes` 만 true. PROGRESS.md 1줄 → `git add -A && git commit -m "feat({team}/{phase}): <task>"`. 원격 push/merge 금지.

## 6. Blocker 격리 (멈추지 않는다)

- 막히면(attempts>=3, packages/interfaces 수정 필요, 타 팀 소유 파일, 미명시 의존성, 사람 결정): `.ralph/blocked_tasks` 에 `<task-id> | <사유>` append 후 **다음 태스크로 진행**. `.ralph/BLOCKED` 금지.

## 7. 신호 (엄격 — 오탐 방지)

- 신호를 낼 때만 **마지막 줄에 신호 문자열만 단독**(백틱·따옴표·다른 텍스트 없이). 안 낼 때는 `<PHASE_COMPLETE:...>`·`<PHASE_BLOCKED:...>`·`<ALL_TASKS_COMPLETE>` 토큰을 **출력 어디에도 쓰지 말 것**(설명/부정문도 금지).
- 격리 안된 현재 phase 항목 전부 passes=true → `.ralph/PHASE_DONE` 기록 후 마지막 줄 `<PHASE_COMPLETE:{phase}>` 단독.
- 남은 미완이 전부 격리 → 마지막 줄 `<PHASE_BLOCKED:{phase}>` 단독.
- 그 외(1개 완료·다음 남음) → 신호 없이 간단 요약만.
