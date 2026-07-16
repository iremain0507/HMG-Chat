# LOOP PROMPT — Phase P15 (Admin Settings 런타임 배선 완성 — P14 후속)

당신은 자율 코딩 루프의 한 반복(iteration)이다. 이전 반복의 기억은 없다. 상태는 파일과 git 에만 있다.
이번 phase 의 목표는 **P14 에서 저장·UI 까지만 되고 런타임 반영이 이월된 설정들을 실제 동작에 배선**하는 것이다.
대상 6개: `temperature`·`topP`(생성 파라미터), 동적 org-scoped `toolMaxTokens`, index 시 `chunker`(chunkSize/overlap), `enableSignup`·`defaultUserRole`(가입/역할).
**전제(이미 완료)**: 유일한 frozen 계약 변경인 `ChatInput.topP?` 는 human-gate 로 이미 추가됨(commit `262b1ab`). `ChatInput.temperature?`·`ToolContext.orgId`·`ChunkOptions.chunkSizeTokens` 는 원래 존재.
따라서 **이 phase 는 `packages/interfaces` 를 절대 건드리지 않는다**(모든 배선은 non-frozen 파일). 저장/스키마/서비스는 P14 산출물(`lib/org-settings-schema.ts`·`lib/settings-service.ts`·`org_settings` 테이블) 재사용.
**필참**: `rebuild_plan/21-LOOP-LESSONS.md`(L1~L5) — 특히 **L1(설정이 실제 provider/handler 까지 도달하는지 createApp/실경로로 단언)**, L2(미설정 시 안전기본·비파괴). CLAUDE.md 하드룰 준수. 태스크는 feature_list.json 의 `P15-*`.

## 0. 오리엔테이션 (매번)

1. `git log --oneline -15`, PROGRESS.md, `.ralph/current_phase`(=P15), `.ralph/blocked_tasks` 읽기.
2. 근거 파일: `apps/server/src/lib/{org-settings-schema,settings-service}.ts`(P14 산출), `apps/server/src/orchestrator/orchestrator.ts`(RunTurnInput/runTurn), `rebuild_plan/14-INTERFACES.md`(계약).
3. feature_list.json 에서 `phase=="P15"`, `passes==false`, `.ralph/blocked_tasks` 에 **없는** 항목 중 **배열 최상단 하나만** 선택. (`.ralph/last_fail.txt` 있으면 그 수정.)

## 1. 계약 (엄수)

- **비파괴 배선이다 — RED 필수**: 각 설정이 런타임에 도달함을 실패 테스트 먼저(RED)→최소 구현→GREEN. **미설정/기본값 시 기존 동작 보존**(안전기본).
- **`packages/interfaces/**`·`packages/shared/**`·`apps/web/src/lib/{api-client,api-types.generated}.ts` 는 절대 수정 금지(FROZEN)**. topP 계약은 이미 추가됨 — 루프가 interfaces 를 편집할 일은 없다. 필요해지면 격리.
- **설정 조회**: 모두 P14 의 `settingsService.resolve(orgId)` / `ResolvedOrgSettings` 사용. 새 저장소·새 스키마 키 만들지 말 것(단, 기본값 조정은 `org-settings-schema.ts` 에서 허용 — 아래 T1-01).
- **Per-task 파일 소유권 (표 밖 파일 편집 필요 시 격리)**:

  | task      | 편집 허용 파일                                                                                                                                                              |
  | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | P15-T2-01 | `apps/server/src/orchestrator/orchestrator.ts`(RunTurnInput+forward), `orchestrator/llm-provider-anthropic.ts`, `orchestrator/llm-provider-openai.ts`, `routes/messages.ts` |
  | P15-T2-02 | `apps/server/src/tools/assemble-builtin-tools.ts`, `tools/handlers/deep-research-handler.ts`, `app.ts`(도구에 settings resolver 주입)                                       |
  | P15-T3-01 | `apps/server/src/knowledge/**`(chunkText 를 호출하는 index/ingest 서비스), 필요 시 `routes/documents.ts`(ingest 경로)                                                       |
  | P15-T1-01 | `apps/server/src/routes/auth.ts`, `apps/server/src/lib/org-settings-schema.ts`(enableSignup 기본값), `app.ts`(auth deps 에 settings resolver 주입)                          |
  | P15-T6-01 | `apps/web/src/components/admin/settings/**`, `apps/web/src/app/preview/page.tsx`, `apps/web/e2e/admin-settings.pw.ts`                                                       |

  `app.ts` 는 T2-02·T1-01 공유 → 한 반복에 한 태스크로 순차 편집.

## 2. 팀별 구현 지침 (한 태스크만)

- **P15-T2-01 (T2) — temperature·topP 생성 파라미터 forward**
  - `RunTurnInput`(orchestrator.ts, non-frozen)에 `temperature?`·`topP?` 추가 → runTurn 이 `ChatInput` 으로 forward.
  - **anthropic provider**(llm-provider-anthropic.ts): SDK 호출에 `...(input.temperature!==undefined?{temperature:input.temperature}:{})`, `...(input.topP!==undefined?{top_p:input.topP}:{})` 추가(현재 미전달). **openai provider** 도 동일(temperature/top_p).
  - `messages.ts`: `resolved.temperature`·`resolved.topP` 를 runTurn 에 전달.
  - **L1 RED**: createApp 채팅 턴에서 org temperature=0.2, topP=0.5 → provider.chat 이 받은 ChatInput.temperature===0.2 & topP===0.5 단언(미설정 org 는 provider 기본 유지=비파괴).
- **P15-T2-02 (T2) — 동적 org-scoped toolMaxTokens**
  - 내장 도구는 app.ts 에서 정적 조립이므로, `deep-research-handler` 가 **invoke 시 `ctx.orgId` 로 settingsService.resolve 해 toolMaxTokens 사용**(정적 기본을 조용히 쓰지 않도록 — L1). settings resolver 를 도구 deps 로 주입(app.ts).
  - **RED**: org toolMaxTokens=8000 → deep_research sub-turn 이 8000 사용(정적 4096 아님); 미설정 시 4096 유지.
- **P15-T3-01 (T3) — index 시 chunker 설정 반영**
  - 문서 인덱싱 경로에서 `chunkText` 호출부를 찾아 `ChunkOptions.chunkSizeTokens/overlap` 을 **해당 org 설정에서 resolve** 해 전달(index 시점, org 컨텍스트로).
  - **RED**: org ragChunkSizeTokens=1200 → 인덱싱이 1200 로 분할; 미설정 시 800 유지.
- **P15-T1-01 (T1) — enableSignup·defaultUserRole 런타임 (안전 기본, 비파괴)**
  - `org-settings-schema.ts`: `DEFAULT_ORG_SETTINGS.enableSignup` 을 **`true` 로**(현행 "허용 도메인이면 가입 가능" 보존 — 비파괴). `defaultUserRole` 기본 `member`.
  - `routes/auth.ts` `/signup`: **env `allowedDomains` 도메인 게이트는 하드 전제로 그대로 유지**(먼저 체크). 그 다음 domain 으로 org 조회 → `settingsService.resolve(org.id)` → `enableSignup===false` 면 가입 거부(403/에러), 생성 유저 role 은 `resolved.defaultUserRole`. app.ts 가 auth deps 에 settings resolver 주입.
  - **RED**: enableSignup=false → 허용 도메인이라도 가입 거부; enableSignup=true(기본) → 가입 성공 + role===defaultUserRole; **미허용 도메인은 항상 거부(env 게이트 우선)**. cross-org: org 는 이메일 도메인으로만 결정(body 로 org 지정 불가).
- **P15-T6-01 (T6) — admin UI "미적용" 힌트 제거**
  - 위 배선 완료로 temperature·topP·enableSignup·defaultUserRole 이 실제 반영되므로, 해당 필드의 "아직 미적용/env 관리" 힌트를 제거(또는 정확화). 시맨틱 토큰만·라이트/다크·preview+Playwright 검증(P13 방식).

## 3. 검증 (커밋 전 필수)

- `bash scripts/verify-gates.sh` exit 0 (typecheck·lint·test·state).
- 배선은 **createApp/실경로 통합테스트로 L1 단언**(유닛 green ≠ 실제 도달). T1-01 은 cross-org(도메인 기반) + env 게이트 우선 테스트 포함.
- T6 은 `bash scripts/verify-browser.sh` 통과(라이트/다크). 브라우저 불가 시 격리(통과 서술 금지).
- **실행하지 않은 검증을 통과했다고 서술하지 말 것.**

## 4. 기록 & 커밋

- 해당 항목 `passes` 만 true 로. PROGRESS.md 1줄 → `git add -A && git commit -m "feat(<team>/P15): <task>"` (반복당 1개). push/merge/rebase 금지.

## 5. Blocker 격리

- 막히면(attempts>=3, FROZEN 수정 필요, 표 밖 파일 필요, 사람 결정 필요, 브라우저 불가): `.ralph/blocked_tasks` 에 `<task-id> | <사유>` append 후 다음 태스크로. `.ralph/BLOCKED` 는 쓰지 않는다.

## 6. 신호 (엄격)

- 신호 낼 때만 **출력 마지막 줄에 신호 문자열만 단독**으로. 안 낼 땐 신호 문자열을 어디에도 쓰지 말 것.
- P15 격리 안된 항목 전부 passes=true → `.ralph/PHASE_DONE` 에 `P15` 기록 후 마지막 줄 `<PHASE_COMPLETE:P15>` 단독 출력·종료.
- 남은 미완이 전부 격리 → 마지막 줄 `<PHASE_BLOCKED:P15>` 단독 출력·종료.
- 그 외(1개 완료, 남음) → 신호 없이 간단 요약만.
