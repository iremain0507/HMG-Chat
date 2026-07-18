// connection-provider-resolver.test.ts — P22-T6-14 RED:
// orchestrator/connection-provider-resolver.ts 부재 → 저장된 ProviderConnection 의
// baseURL/키로 턴을 태울 방법이 없다(app.ts 는 env.ANTHROPIC_API_KEY 하나로만 조립).
//
// 갭 카탈로그 P22-T6-14 acceptance 3:
//   "활성 연결의 모델을 고른 채팅은 orchestrator 가 env.ANTHROPIC_API_KEY 가 아니라
//    그 연결의 baseURL/키로 라우팅한다."
//
// invoke-time 해석 패턴(T3-01 미러): registry 는 app 조립 시점 싱글톤이라 org 별 동적
// 연결을 담을 수 없으므로, 요청 시점에 org+model 로 provider 를 해석한다.
import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import type { ProviderConnection } from "@wchat/interfaces";
import { createConnectionProviderResolver } from "../connection-provider-resolver.js";
import type { ProviderConnectionDataAccess } from "../../db/provider-connection-data-access.js";

function makeDa(rows: ProviderConnection[], secrets: Record<string, string>) {
  const da = {
    providerConnections: {
      async list(filter?: { orgId?: string; enabled?: boolean }) {
        return {
          items: rows.filter(
            (r) =>
              (filter?.orgId === undefined || r.orgId === filter.orgId) &&
              (filter?.enabled === undefined || r.enabled === filter.enabled),
          ),
        };
      },
      async secretById(id: string) {
        return secrets[id] ?? null;
      },
    },
  } as unknown as ProviderConnectionDataAccess;
  return da;
}

function conn(over: Partial<ProviderConnection> = {}): ProviderConnection {
  const now = new Date();
  return {
    id: randomUUID(),
    orgId: randomUUID(),
    name: "사내 GPT",
    kind: "openai-compatible",
    baseUrl: "https://api.example.com/v1",
    keyPrefix: "sk-abc…",
    enabled: true,
    verifiedAt: now,
    models: ["gpt-5.1"],
    createdBy: randomUUID(),
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

let orgId: string;
let otherOrgId: string;

beforeEach(() => {
  orgId = randomUUID();
  otherOrgId = randomUUID();
});

describe("createConnectionProviderResolver", () => {
  it("활성 연결의 모델이면 그 연결의 baseURL/키로 만든 provider 를 돌려준다", async () => {
    const row = conn({ orgId, models: ["gpt-5.1", "gpt-5.1-mini"] });
    const built: Array<{ baseUrl: string; apiKey: string; models: string[] }> =
      [];
    const resolve = createConnectionProviderResolver({
      da: makeDa([row], { [row.id]: "sk-real-secret" }),
      createProvider: (args) => {
        built.push(args);
        return {
          name: "openai",
          models: args.models,
          chat: async function* () {},
        };
      },
    });

    const provider = await resolve(orgId, "gpt-5.1-mini");
    expect(provider).not.toBeNull();
    expect(built).toEqual([
      {
        baseUrl: "https://api.example.com/v1",
        apiKey: "sk-real-secret",
        models: ["gpt-5.1", "gpt-5.1-mini"],
      },
    ]);
  });

  it("다른 org 의 연결은 절대 해석되지 않는다(cross-org 격리)", async () => {
    const row = conn({ orgId: otherOrgId, models: ["gpt-5.1"] });
    const resolve = createConnectionProviderResolver({
      da: makeDa([row], { [row.id]: "sk-other-org" }),
      createProvider: () => {
        throw new Error("다른 org 의 연결로 provider 를 만들면 안 된다");
      },
    });

    expect(await resolve(orgId, "gpt-5.1")).toBeNull();
  });

  it("비활성(enabled=false) 연결은 해석되지 않는다", async () => {
    const row = conn({ orgId, enabled: false });
    const resolve = createConnectionProviderResolver({
      da: makeDa([row], { [row.id]: "sk-disabled" }),
      createProvider: () => {
        throw new Error("비활성 연결을 쓰면 안 된다");
      },
    });

    expect(await resolve(orgId, "gpt-5.1")).toBeNull();
  });

  it("어떤 연결도 담지 않은 모델은 null — 기존 env provider 로 폴백된다", async () => {
    const row = conn({ orgId, models: ["gpt-5.1"] });
    const resolve = createConnectionProviderResolver({
      da: makeDa([row], { [row.id]: "sk-x" }),
      createProvider: () => ({
        name: "openai",
        models: [],
        chat: async function* () {},
      }),
    });

    expect(await resolve(orgId, "claude-sonnet-5")).toBeNull();
  });

  it("키를 읽을 수 없는 연결은 null(폴백) — 조립 중 throw 하지 않는다", async () => {
    const row = conn({ orgId, models: ["gpt-5.1"] });
    const resolve = createConnectionProviderResolver({
      da: makeDa([row], {}), // secretById → null
      createProvider: () => {
        throw new Error("키 없이 provider 를 만들면 안 된다");
      },
    });

    expect(await resolve(orgId, "gpt-5.1")).toBeNull();
  });
});
