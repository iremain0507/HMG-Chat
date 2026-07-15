import { describe, it, expect } from "vitest";
import { createDevStubEmbeddingProvider } from "../embedding-provider-dev-stub.js";

describe("createDevStubEmbeddingProvider", () => {
  const p = createDevStubEmbeddingProvider();

  it("EmbeddingProvider 계약: name/dim=1024", () => {
    expect(p.dim).toBe(1024);
    expect(typeof p.name).toBe("string");
  });

  it("결정론적 — 같은 입력은 같은 벡터", async () => {
    const [a] = await p.embed(["hello world"]);
    const [b] = await p.embed(["hello world"]);
    expect(a).toEqual(b);
    expect(a).toHaveLength(1024);
  });

  it("다른 입력은 다른 벡터", async () => {
    const [a, b] = await p.embed([
      "retrieval augmented generation",
      "완전히 다른 문장",
    ]);
    expect(a).not.toEqual(b);
  });

  it("L2 정규화 — norm ≈ 1", async () => {
    const [v] = await p.embed(["normalize me"]);
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it("배치 입력 개수만큼 반환", async () => {
    const out = await p.embed(["a", "b", "c"]);
    expect(out).toHaveLength(3);
  });

  it("aborted signal 시 throw", async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(
      p.embed(["x"], { type: "query", signal: ac.signal }),
    ).rejects.toThrow();
  });
});
