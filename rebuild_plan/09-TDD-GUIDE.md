# 09 · TDD Guide — Test-Driven Development 가이드

> v2 의 **모든 코드는 TDD 로 만든다**. RED → GREEN → REFACTOR. 테스트 없이 머지 불가. 이 문서는 패턴/예시/규약을 정리.

## TDD 의 v2 강제 룰

1. 새 production 코드는 **테스트가 먼저 머지** 되어야 한다 (또는 같은 PR 안에서 함께).
2. PR 의 diff 가 production code 만 추가/수정하고 test 없으면 CI 가 reject.
3. Coverage gate: server ≥ 80%, web ≥ 60%, shared ≥ 90%.
4. Coverage 가 떨어지는 PR 은 자동 차단 (`coverage-delta` job).
5. 모든 버그 수정은 **버그를 재현하는 테스트 먼저** (regression test).

## 테스트 피라미드

```
              /\
             /  \  E2E (Playwright)         — 핵심 user flow 만 (5~10건)
            /----\
           /      \  Integration             — route + DB + external (mock)
          /--------\  (vitest + supertest)
         /          \  Unit                   — pure logic, service, util
        /------------\  (vitest + mock impl)
```

각 레벨 대표 도구:
- **Unit**: vitest (server, web, shared), pure function, mock 구현체
- **Integration**: vitest + hono test client + InMemory DataAccess + Mock Sandbox/LLM
- **E2E**: Playwright (web 만), staging 환경에 대해 핵심 flow 5~10개

## RED → GREEN → REFACTOR 사이클 (예시)

### 사례: artifact-share-service 의 createShare()

#### 1. RED — 테스트 먼저 작성 (실패)
```typescript
// apps/server/src/db/__tests__/artifact-share-service.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { createShareService } from "../artifact-share-service.js";
import { mockDataAccess } from "../../__tests__/mocks/data-access.mock.js";

describe("artifact-share-service.createShare", () => {
  let svc: ReturnType<typeof createShareService>;
  let mock: ReturnType<typeof mockDataAccess>;

  beforeEach(() => {
    mock = mockDataAccess();
    svc = createShareService(mock);
  });

  it("발급된 토큰은 122-bit UUID v4 이어야 한다", async () => {
    const share = await svc.createShare({
      artifactId: "art-1",
      issuedBy: "user-1",
      ttlDays: 30,
    });
    expect(share.token).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("expires_at 가 now + ttlDays 와 일치", async () => {
    const t0 = Date.now();
    const share = await svc.createShare({
      artifactId: "art-1",
      issuedBy: "user-1",
      ttlDays: 30,
    });
    const elapsed = share.expiresAt.getTime() - t0;
    expect(elapsed).toBeGreaterThan(29 * 86_400_000);
    expect(elapsed).toBeLessThan(31 * 86_400_000);
  });
});
```

→ `pnpm --filter @{{PROJECT_SLUG}}/server test artifact-share-service` 실행 → **RED** (모듈 없음).

#### 2. GREEN — 최소 구현 (테스트만 통과)
```typescript
// apps/server/src/db/artifact-share-service.ts
import { randomUUID } from "node:crypto";
import type { DataAccess } from "@{{PROJECT_SLUG}}/interfaces";

export function createShareService(da: DataAccess) {
  return {
    async createShare(input: {
      artifactId: string;
      issuedBy: string;
      ttlDays: number;
    }) {
      const token = randomUUID();
      const expiresAt = new Date(Date.now() + input.ttlDays * 86_400_000);
      const share = await da.artifactShares.insert({
        artifactId: input.artifactId,
        issuedBy: input.issuedBy,
        token,
        expiresAt,
      });
      return share;
    },
  };
}
```

→ 다시 테스트 → **GREEN**.

#### 3. REFACTOR — 가독성/구조 개선 (테스트 유지)
- ttlDays 검증 (1 ≤ ttlDays ≤ 365)
- 에러 메시지 한국어
- log 추가 (category="artifact-share")

각 refactor 사이 테스트 유지 → 안전.

## 테스트 디렉토리 구조

```
apps/server/src/
├── __tests__/
│   ├── fixtures/
│   │   ├── users.ts                # 표준 user 픽스처
│   │   ├── sessions.ts
│   │   └── artifacts.ts
│   ├── mocks/
│   │   ├── data-access.mock.ts     # InMemory DataAccess
│   │   ├── sandbox.mock.ts         # MockTransport
│   │   ├── llm.mock.ts             # MockLLMProvider
│   │   ├── embedding.mock.ts
│   │   └── s3.mock.ts
│   ├── helpers/
│   │   ├── make-server.ts          # Hono app 생성
│   │   ├── make-request.ts         # auth helper
│   │   └── wait-for.ts
│   ├── unit/                       # 도메인별 unit test
│   ├── integration/                # route + DB(InMemory)
│   │   ├── auth.integration.test.ts
│   │   ├── sessions.integration.test.ts
│   │   └── ...
│   └── e2e/                        # vitest 도 가능 (외부 호출 없이)
│
└── <each-module>/
    └── <module>.ts
    └── <module>.test.ts            # co-located unit test
```

## Mock vs Real 정책

### Mock 으로 처리하는 것 (테스트에서 항상)
- 외부 API: Anthropic, OpenAI, Tavily, Voyage, E2B, Gemini
- 시계: `Date.now`, timers (`vi.useFakeTimers()`)
- 랜덤: 결정적 seed
- S3: `s3.mock.ts` (in-memory bucket)
- LLM streaming: 미리 정의된 chunk 시퀀스
- Sandbox: MockTransport

### Real 로 쓰는 것 (integration test)
- Hono router (실제 라우트 정의)
- Zod validation (실제 스키마)
- Drizzle ORM 의 query builder (실제 SQL)
- DB: **InMemory DataAccess impl** (PostgreSQL 안 띄움, 또는 testcontainers)

### Production-only (test 에서 절대 사용 금지)
- 실제 LLM API (cost + 비결정)
- 실제 E2B (network 의존)
- 실제 production DB
- 실제 git/GitLab push

## Coverage 가이드

### 커버 해야 하는 것
- **Domain service 함수**: 100% line + 90% branch
- **Route handler**: 80% (happy + 핵심 error 경로)
- **Util**: 90%
- **React hook**: state 변화 모두

### 커버 안 해도 되는 것
- Generated 코드 (drizzle migration)
- 타입 정의 only 파일
- React component 의 시각적 렌더 (a11y는 a11y test 로)

## TDD 안티패턴 (금지)

### ❌ 구현 후 테스트 작성
- "코드 먼저 짜고 테스트는 나중에" → 테스트가 구현 디테일에 종속됨.

### ❌ Mock 만 검증
- `expect(spy).toHaveBeenCalledWith(...)` 만 있고 동작 검증 없으면 의미 없음.

### ❌ 큰 통합 테스트만 가지기
- 한 테스트가 너무 많은 것을 검증 → 실패 시 원인 추적 어려움. 작은 단위로 분할.

### ❌ 테스트 안의 condition
- `if (process.env.NODE_ENV === "production")` 같은 분기 → 환경 의존 테스트.

### ❌ Sleep 으로 race 해결
- `await sleep(100)` 같은 코드 → CI flaky. `waitFor`, `vi.useFakeTimers()` 사용.

## TDD 실전 패턴

### 1. 새 feature 의 첫 PR 은 항상 test 만
- PR title: `test: artifact-share-service (RED, will GREEN in next PR)`
- 테스트가 fail 하지만 머지. CI 의 `red-test-allowed` 라벨 필요.
- 다음 PR 이 구현 + 같은 테스트 통과.
- **build_prompt 의 "test 한 번이라도 실패 → 즉시 보고" 와 충돌 안 함**: 라벨이 붙은 RED PR 은 의도된 실패. 라벨 없는 PR 의 test 실패는 build_prompt 정책 적용 (즉시 보고). lint/typecheck 실패는 라벨 무관 항상 즉시 보고.
- **GREEN 의무**: RED 머지 후 7일 안에 GREEN PR 머지 — CI bot 이 라벨 + 미해결 일수 추적 ([15-CI-PIPELINE § red-allowed 감시 job](15-CI-PIPELINE.md)).

### 2. 버그 수정의 첫 commit 은 regression test
- PR 의 첫 commit: 버그 재현 테스트 (RED)
- 두 번째 commit: 수정 (GREEN)
- diff 가 명확.

### 3. 큰 refactor 는 테스트 lock 먼저
- 기존 행동을 모두 캡처하는 characterization test 작성 → refactor 안전 가능.

### 4. snapshot test 는 신중히
- markdown 렌더, SQL query 출력 등은 OK
- 큰 JSON snapshot 은 deprecated — 명시 assertion 사용

## TDD 자동화 (Claude Code 서브에이전트)

`.claude/agents/shared/tdd-pair.md` 서브에이전트가 사용자와 TDD pair 수행:
- 사용자: "artifact 공유 만들고 싶어"
- 에이전트: 먼저 acceptance criteria 확인 → 첫 RED 테스트 작성 → fail 확인 → 최소 구현 → GREEN → refactor 제안.

## CI 의 TDD 게이트

`.gitlab-ci.yml` 의 PR pipeline job:

| Job | 의미 | 게이트 |
|---|---|---|
| `lint` | ESLint + prettier | fail → reject |
| `typecheck` | `tsc --noEmit` (all packages) | fail → reject |
| `test:unit` | vitest unit | fail → reject |
| `test:integration` | vitest integration | fail → reject |
| `coverage` | server ≥ 80%, web ≥ 60%, shared ≥ 90% | 떨어지면 reject |
| `test-without-prod-code` | 새 production 코드가 test 없이 추가됐는지 검출 | fail → reject |
| `migration-dry-run` | 마이그레이션을 InMemory DB 에 적용 | fail → reject |
| `flaky-detect` | 같은 테스트 5번 실행, 결과 일관성 | flaky 의심 → 경고 |

`test-without-prod-code` 구현 idea:
- PR diff 에서 `apps/server/src/**/*.ts` 추가 라인 ↔ `apps/server/src/**/*.test.ts` 추가 라인 비율
- production line 추가됐는데 test line 0이면 reject (단순화)

## 테스트 명명 규약

```typescript
// 한국어 가능 (사용자 의도 우선)
describe("artifact-share-service.createShare", () => {
  it("발급된 토큰은 122-bit UUID v4 이어야 한다", ...);
  it("ttlDays=0 이면 InvalidArgument 에러", ...);
  it("동일 artifact 에 대해 여러 토큰 발급 가능", ...);
});
```

규약:
- describe: `<file>.<function>` 또는 도메인명
- it: 검증할 동작/제약 (한 줄), 결과/제약 동사 명확하게
- given/when/then 구조 권장 (한국어로): "<given>일 때 <when>하면 <then> 한다"

## 운영 환경 / 인터페이스 (Phase 0 시작)

T1 Platform 이 Phase 0 첫 주에 만들어야 할 인프라:
- `packages/test-utils/` — 모든 팀이 import 하는 fixture/mock 베이스
- `vitest.config.ts` (root) — 공통 옵션
- CI 의 모든 test job
- coverage report → CI artifacts

다음: [10-DEV-WORKFLOW.md](10-DEV-WORKFLOW.md) — 커밋/MR/CI 규칙.

---

## 부록 A · Mock contract spec

각 mock 구현체는 production 구현체와 같은 contract 를 통과해야 함 (`packages/test-utils/contract/`).

### `data-access.mock.ts` 행동 명세

| 메서드 | InMemory 행동 |
|---|---|
| `insert(data)` | data 의 id 없으면 uuid v4 자동 생성. timestamps `created_at=now()` 주입. 동일 PK 재삽입 시 `{{PROJECT_NAME_PASCAL}}Error("DB_DUPLICATE_KEY", "db", false)` |
| `update(id, data)` | id 없으면 throw `NOT_FOUND`. `updated_at=now()` 자동. partial update. |
| `delete(id)` | 없으면 throw `NOT_FOUND`. soft delete 아님 (실제 메모리에서 제거) |
| `byId(id)` | 없으면 null (throw 안 함) |
| `list(filter, pagination)` | 메모리에서 filter 적용 → sort by created_at desc → cursor pagination |
| `withTx(fn)` | 메모리 snapshot 보관 → fn() 실행 → throw 시 snapshot 복원 (rollback 시뮬레이션) |
| `withRlsContext(ctx, fn)` | AsyncLocalStorage 로 ctx 전달. fn() 안의 모든 query 가 자동으로 user_id/org_id filter 적용 |
| `documentChunks.hybridSearch(...)` | 벡터 검색은 cosine similarity 계산, bm25 는 단순 keyword count, RRF 결합 |

테스트 helper:
```ts
export function createInMemoryDataAccess(opts?: {
  injectErrorOn?: { method: string; afterCalls: number };
  failProbability?: number;   // chaos test
}): DataAccess;
```

### `llm.mock.ts` 행동 명세

```ts
export function createMockLLM(opts: {
  responses: ChatEvent[][];  // 호출 순서대로 응답
  delay?: number;            // 각 chunk 사이 ms
  failAfter?: number;        // n 번째 호출에서 throw
}): LLMProvider;
```

- 한 번 `chat()` 호출하면 `responses[0]` 를 yield 한 뒤 stop. 다음 호출은 `responses[1]`.
- abort signal 검출 시 즉시 `{type: "stop", reason: "aborted"}` 발행.
- `responses` 소진 시 default response (`"mock response"` + `stop end_turn`).

### `sandbox.mock.ts` 행동 명세

```ts
export function createMockSandbox(opts?: {
  files?: Record<string, string>;  // 초기 파일 시스템
  commandHandlers?: Record<string, (cmd: string) => Chunk[]>;
}): SandboxTransport;
```

- `start()`: 즉시 SandboxHandle 반환 (cold start 시뮬레이션 없음).
- `runCommand(handle, cmd, ...)`: `commandHandlers[<첫단어>]` 가 있으면 그 결과, 없으면 빈 stdout + exit 0.
- `writeFile/readFile`: in-memory 파일시스템.
- abort 즉시 `{type: "exit", reason: "killed"}`.

### `embedding.mock.ts` 행동 명세

```ts
export function createMockEmbedding(opts?: { dim?: number /* default 1024 */ }): EmbeddingProvider;
```

- `embed(["text1","text2",...])`: 각 text 의 sha256 → 1024-byte → number[1024] (0~1 정규화).
- 같은 text 는 같은 embedding (결정적).

### `s3.mock.ts` 행동 명세

- in-memory Map<bucket+key, Buffer>.
- presigned URL 발급: 임의 token (`s3://mock/<bucket>/<key>?signature=...`).
- `getSignedUrl()` 는 즉시 반환.

### Contract test

`packages/test-utils/contract/data-access.contract.test.ts` — production drizzle + InMemory 두 impl 모두 통과:

```ts
import { contractTests } from "./data-access.contract.js";

describe("Drizzle DataAccess", () => contractTests(() => createDrizzleDataAccess(...)));
describe("InMemory DataAccess", () => contractTests(() => createInMemoryDataAccess()));
```

contract 가 30+ 테스트 케이스로 양쪽 호환성 보장.
