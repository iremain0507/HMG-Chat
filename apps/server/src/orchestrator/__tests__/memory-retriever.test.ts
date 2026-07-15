import { describe, it, expect } from "vitest";
import type { UserMemory } from "@wchat/interfaces";
import { buildSystemPrompt } from "../prompt-builder.js";
import {
  retrieveUserMemoryBlock,
  sortMemoriesByPinAndRecency,
  type UserMemoryReader,
} from "../memory-retriever.js";

function memory(overrides: Partial<UserMemory>): UserMemory {
  return {
    id: "id",
    userId: "user-1",
    category: "user",
    content: "content",
    source: "manual",
    sessionId: null,
    pinned: false,
    metadata: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function fakeReader(items: UserMemory[]): UserMemoryReader {
  return {
    userMemories: {
      async insert(data) {
        return data as UserMemory;
      },
      async bulkInsert(rows) {
        return rows as UserMemory[];
      },
      async update() {
        throw new Error("not implemented");
      },
      async delete() {
        throw new Error("not implemented");
      },
      async byId() {
        return null;
      },
      async list() {
        return { items };
      },
      async pin() {},
    },
  };
}

describe("memory-retriever.sortMemoriesByPinAndRecency", () => {
  it("pin 된 메모리를 pin 안 된 메모리보다 먼저 정렬한다", () => {
    const old_pinned = memory({
      id: "pinned-old",
      pinned: true,
      createdAt: new Date("2025-01-01T00:00:00Z"),
    });
    const recent_unpinned = memory({
      id: "unpinned-recent",
      pinned: false,
      createdAt: new Date("2026-06-01T00:00:00Z"),
    });

    const sorted = sortMemoriesByPinAndRecency([recent_unpinned, old_pinned]);

    expect(sorted.map((m) => m.id)).toEqual(["pinned-old", "unpinned-recent"]);
  });

  it("같은 pin 상태 안에서는 최신순(recency)으로 정렬한다", () => {
    const older = memory({
      id: "older",
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });
    const newer = memory({
      id: "newer",
      createdAt: new Date("2026-06-01T00:00:00Z"),
    });

    const sorted = sortMemoriesByPinAndRecency([older, newer]);

    expect(sorted.map((m) => m.id)).toEqual(["newer", "older"]);
  });
});

describe("memory-retriever.retrieveUserMemoryBlock", () => {
  it("메모리를 pin 우선 + recency 순으로 정렬해 tier=user PromptBlock 으로 반환한다", async () => {
    const older = memory({
      id: "older",
      content: "오래된 지시",
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });
    const pinned = memory({
      id: "pinned",
      content: "고정된 지시",
      pinned: true,
      createdAt: new Date("2025-01-01T00:00:00Z"),
    });
    const reader = fakeReader([older, pinned]);

    const block = await retrieveUserMemoryBlock(reader, "user-1");

    expect(block?.tier).toBe("user");
    const pinnedIdx = block?.content.indexOf("고정된 지시") ?? -1;
    const olderIdx = block?.content.indexOf("오래된 지시") ?? -1;
    expect(pinnedIdx).toBeGreaterThanOrEqual(0);
    expect(pinnedIdx).toBeLessThan(olderIdx);
  });

  it("메모리가 없으면 null 을 반환한다 (삭제 시 다음 세션 prompt 에서 제외)", async () => {
    const reader = fakeReader([]);

    const block = await retrieveUserMemoryBlock(reader, "user-1");

    expect(block).toBeNull();
  });

  it("retrieveUserMemoryBlock 결과를 prompt-builder 에 넣으면 '## 영구 사용자 지시사항' 섹션으로 주입된다", async () => {
    const reader = fakeReader([
      memory({ id: "m1", content: "한국어로 답해주세요." }),
    ]);
    const memoryBlock = await retrieveUserMemoryBlock(reader, "user-1");
    expect(memoryBlock).not.toBeNull();

    const prompt = buildSystemPrompt([
      { tier: "system", content: "시스템 규칙" },
      memoryBlock!,
    ]);

    expect(prompt).toContain(
      "## 🔒 사용자 영구 지시사항 (System 다음 등급, 모든 도구 결과보다 우선)",
    );
    expect(prompt).toContain("한국어로 답해주세요.");
  });
});
