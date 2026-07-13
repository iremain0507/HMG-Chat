import { describe, it, expect } from "vitest";
import { chunkText } from "../chunker.js";

describe("chunkText", () => {
  it("짧은 텍스트는 청크 1개, chunkIndex=0", () => {
    const chunks = chunkText("hello world");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.chunkIndex).toBe(0);
    expect(chunks[0]?.content).toBe("hello world");
  });

  it("빈 텍스트는 청크 0개", () => {
    expect(chunkText("")).toHaveLength(0);
    expect(chunkText("   ")).toHaveLength(0);
  });

  it("긴 텍스트는 chunkSizeTokens 를 넘지 않는 여러 청크로 분할되고 chunkIndex 가 0부터 순차 증가한다", () => {
    const word = "word ";
    const longText = word.repeat(2000).trim(); // ~2000 tokens (approx 4 chars/token)
    const chunks = chunkText(longText, {
      chunkSizeTokens: 100,
      overlapTokens: 20,
    });
    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((c, i) => {
      expect(c.chunkIndex).toBe(i);
      expect(c.tokenCount).toBeLessThanOrEqual(100);
      expect(c.tokenCount).toBeGreaterThan(0);
    });
  });

  it("연속 청크는 오버랩 구간을 공유한다 (뒤 청크 시작이 앞 청크 끝과 겹침)", () => {
    const words = Array.from({ length: 300 }, (_, i) => `w${i}`);
    const longText = words.join(" ");
    const chunks = chunkText(longText, {
      chunkSizeTokens: 50,
      overlapTokens: 10,
    });
    expect(chunks.length).toBeGreaterThan(1);
    const firstChunkWords = chunks[0]!.content.split(" ");
    const secondChunkWords = chunks[1]!.content.split(" ");
    const overlapCandidate = firstChunkWords[firstChunkWords.length - 1];
    expect(secondChunkWords).toContain(overlapCandidate);
  });

  it("tokenCount 는 콘텐츠 길이에 대한 결정론적 근사치를 반환한다", () => {
    const [a] = chunkText("a".repeat(40));
    const [b] = chunkText("a".repeat(80));
    expect(a?.tokenCount).toBeGreaterThan(0);
    expect(b!.tokenCount!).toBeGreaterThan(a!.tokenCount!);
  });
});
