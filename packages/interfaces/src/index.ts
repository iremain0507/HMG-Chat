// packages/interfaces/src/index.ts
//
// Barrel — re-export every contract. External packages (apps/server, apps/web)
// MUST import from this barrel: `import { X } from "@wchat/interfaces"` —
// never from an individual file (§ 파일 분할 import rule 5).
//
// verbatimModuleSyntax: type-only modules use `export type *`. errors.ts also
// exports the runtime `WChatError` class, so it uses a plain `export *`
// (value + type) split below.

// ─── roots ───
// errors.ts exports a runtime class (WChatError) + types (ErrorCategory,
// SerializedError). A plain `export *` preserves each binding's value/type-ness.
export * from "./errors.js";
export type * from "./types.js";

// ─── core contracts (§ 1–8) ───
export type * from "./AgentTool.js";
export type * from "./SandboxTransport.js";
export type * from "./DataAccess.js";
export type * from "./ArtifactStore.js";
export type * from "./EmbeddingProvider.js";
export type * from "./LLMProvider.js";
export type * from "./SkillRegistry.js";
export type * from "./McpClientPool.js";

// ─── ToolContext 보조 contracts (§ 9–11) ───
export type * from "./HitlBridge.js";
export type * from "./BudgetClaim.js";
export type * from "./Logger.js";

// ─── § 12 ───
export type * from "./EmailSender.js";
