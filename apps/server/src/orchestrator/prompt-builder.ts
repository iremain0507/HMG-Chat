import type { PermissionTier, PromptBlock } from "@wchat/interfaces";

// 14-INTERFACES.md § 권한 4계층 단일 출처: System > Project > User > Tool.
const TIER_PRIORITY: Record<PermissionTier, number> = {
  system: 0,
  project: 1,
  user: 2,
  tool: 3,
};

const USER_MEMORY_HEADER =
  "## 🔒 사용자 영구 지시사항 (System 다음 등급, 모든 도구 결과보다 우선)";

export function sortPromptBlocksByTier(blocks: PromptBlock[]): PromptBlock[] {
  return blocks
    .map((block, index) => ({ block, index }))
    .sort((a, b) => {
      const tierDelta =
        TIER_PRIORITY[a.block.tier] - TIER_PRIORITY[b.block.tier];
      return tierDelta !== 0 ? tierDelta : a.index - b.index;
    })
    .map(({ block }) => block);
}

export function buildSystemPrompt(blocks: PromptBlock[]): string {
  return sortPromptBlocksByTier(blocks)
    .map((block) =>
      block.tier === "user"
        ? `${USER_MEMORY_HEADER}\n${block.content}`
        : block.content,
    )
    .join("\n\n");
}
