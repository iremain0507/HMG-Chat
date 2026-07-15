import { describe, it, expect } from "vitest";
import { withUsageTracking } from "../embedding-provider.js";
import { createDevStubEmbeddingProvider } from "../embedding-provider-dev-stub.js";
import { estimateTokenCount } from "../chunker.js";

describe("withUsageTracking", () => {
  it("EmbeddingProvider 계약 위임 — name/dim 은 원본과 동일", () => {
    const inner = createDevStubEmbeddingProvider();
    const p = withUsageTracking(inner);
    expect(p.name).toBe(inner.name);
    expect(p.dim).toBe(1024);
  });

  it("초기 usage 는 0", () => {
    const p = withUsageTracking(createDevStubEmbeddingProvider());
    expect(p.getUsage()).toEqual({ callCount: 0, inputTokenCount: 0 });
  });

  it("embed 호출마다 callCount 증가, 외부 API 미호출(dev-stub 결과 그대로 위임)", async () => {
    const p = withUsageTracking(createDevStubEmbeddingProvider());
    const [vec] = await p.embed(["hello world"]);
    expect(p.getUsage().callCount).toBe(1);
    expect(vec).toHaveLength(1024);

    await p.embed(["another batch", "of two"]);
    expect(p.getUsage().callCount).toBe(2);
  });

  it("inputTokenCount 는 입력 텍스트 토큰 추정치 누적", async () => {
    const p = withUsageTracking(createDevStubEmbeddingProvider());
    const texts = ["hello world", "a much longer sentence to embed"];
    await p.embed(texts);
    const expected = texts.reduce((sum, t) => sum + estimateTokenCount(t), 0);
    expect(p.getUsage().inputTokenCount).toBe(expected);

    await p.embed(["x"]);
    expect(p.getUsage().inputTokenCount).toBe(
      expected + estimateTokenCount("x"),
    );
  });

  it("aborted signal 은 그대로 전파(원본 provider 로 위임)", async () => {
    const p = withUsageTracking(createDevStubEmbeddingProvider());
    const ac = new AbortController();
    ac.abort();
    await expect(
      p.embed(["x"], { type: "query", signal: ac.signal }),
    ).rejects.toThrow();
  });
});
