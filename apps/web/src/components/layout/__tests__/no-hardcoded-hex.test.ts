// P13 회귀 가드(T6-01 도입, 이후 태스크가 대상 파일을 추가) — 핸드오프 정렬 대상 파일에
//   하드코딩 hex(#rgb/#rrggbb) 0 개. 시맨틱 토큰(bg-primary 등)만 사용해야 하며 임의 hex
//   값은 globals.css 토큰으로만 등록한다.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const HEX_PATTERN = /#[0-9a-fA-F]{3,8}\b/g;

const FILES = [
  "../AppShell.tsx",
  "../NavRail.tsx",
  "../ThemeToggle.tsx",
  "../ToastContainer.tsx",
  "../../sessions/SessionList.tsx",
  "../../sessions/SessionCard.tsx",
  "../../../lib/pinnedSessions.ts",
  "../../home/HomeContent.tsx",
  "../../../app/page.tsx",
  "../../chat/ChatView.tsx",
  "../../chat/RunRail.tsx",
  "../../chat/ChatInput.tsx",
  "../../chat/ComposerPopover.tsx",
  "../../chat/ModelModePicker.tsx",
  "../../chat/ProjectPicker.tsx",
  "../../chat/HitlPrompt.tsx",
  "../../chat/ActivityPanel.tsx",
  "../../chat/ToolCallRenderer.tsx",
  "../../artifacts/ArtifactCanvas.tsx",
  "../../projects/ProjectDetail.tsx",
  "../../projects/DocumentsPanel.tsx",
  "../../../app/projects/page.tsx",
  "../../settings/McpServersManager.tsx",
  "../../settings/SkillsManager.tsx",
  "../../settings/MemoryManager.tsx",
  "../../chat/MemoryPanel.tsx",
  "../../settings/QuotaPanel.tsx",
  "../../admin/AdminDashboard.tsx",
  "../../admin/ToolMetricsTable.tsx",
  "../../admin/AdminUsersManager.tsx",
];

describe("P13 하드코딩 hex 제로 회귀 가드", () => {
  for (const relPath of FILES) {
    it(`${relPath} 에 하드코딩 hex 색상이 없다`, () => {
      const absPath = join(__dirname, relPath);
      const source = readFileSync(absPath, "utf-8");
      const matches = source.match(HEX_PATTERN) ?? [];
      expect(matches).toEqual([]);
    });
  }
});
