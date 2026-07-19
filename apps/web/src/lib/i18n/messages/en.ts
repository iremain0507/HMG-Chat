// lib/i18n/messages/en.ts — P22-T6-15(계약배치 C11) 영어 카탈로그.
// ko.ts 와 키 집합이 정확히 같아야 한다(i18n.test.ts 가 단언).
export const en = {
  nav: {
    home: "Home",
    projects: "Projects",
    agents: "Agents",
    connectors: "Connectors",
    settings: "Settings",
    admin: "Admin",
    primary: "Primary navigation",
  },
  settings: {
    title: "Settings",
    profile: {
      title: "Profile",
      name: "Name",
      customInstructions: "Custom instructions",
      language: "Language",
      languageHint:
        "Your language is saved to your account and persists across sign-ins.",
      save: "Save",
      saving: "Saving…",
      saved: "Profile saved.",
      saveFailed: "Failed to save profile.",
    },
    sections: {
      memories: {
        label: "Memories",
        description: "Manage saved memories applied to every conversation.",
      },
      skills: {
        label: "Skills",
        description:
          "Review available skills and their allowed tools/policies.",
      },
      mcp: {
        label: "Connectors",
        description: "Manage MCP connector status and tools.",
      },
      connections: {
        label: "Connections",
        description:
          "Register and verify external OpenAI-compatible endpoints.",
      },
      prompts: {
        label: "Prompts",
        description: "Save frequently used prompts and recall them with /.",
      },
      "api-keys": {
        label: "API keys",
        description: "Issue and revoke API keys for external clients.",
      },
      quota: {
        label: "Usage",
        description: "Review this month's budget usage and daily trend.",
      },
      profile: {
        label: "Profile",
        description: "Manage your name, custom instructions, and language.",
      },
    },
  },
  chat: {
    send: "Send",
    stop: "Stop",
    regenerate: "Regenerate",
    newChat: "New chat",
    placeholder: "Ask anything",
  },
  common: {
    loading: "Loading…",
    cancel: "Cancel",
    close: "Close",
  },
} as const;
