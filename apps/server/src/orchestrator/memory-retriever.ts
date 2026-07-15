// orchestrator/memory-retriever.ts — 08-SPRINT-PLAN.md § Phase 7 memory-retriever.
// user_memories 를 pin 우선 + recency(생성일 내림차순) 순으로 조회해 prompt-builder 가
// 소비하는 PromptBlock(tier="user")으로 변환한다. 삭제된 메모리는 list() 결과에 없으므로
// 다음 세션 prompt 에서 자동 제외된다.
import type { DataAccess, PromptBlock, UserMemory } from "@wchat/interfaces";

export type UserMemoryReader = Pick<DataAccess, "userMemories">;

const DEFAULT_MEMORY_LIMIT = 50;

export function sortMemoriesByPinAndRecency(
  memories: UserMemory[],
): UserMemory[] {
  return [...memories].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });
}

export function formatMemoriesForPrompt(memories: UserMemory[]): string {
  return memories.map((m) => `- (${m.category}) ${m.content}`).join("\n");
}

export async function retrieveUserMemoryBlock(
  reader: UserMemoryReader,
  userId: string,
  limit: number = DEFAULT_MEMORY_LIMIT,
): Promise<PromptBlock | null> {
  const { items } = await reader.userMemories.list({ userId }, { limit });
  const sorted = sortMemoriesByPinAndRecency(items);
  if (sorted.length === 0) return null;
  return { tier: "user", content: formatMemoriesForPrompt(sorted) };
}
