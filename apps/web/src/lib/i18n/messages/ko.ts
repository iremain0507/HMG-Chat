// lib/i18n/messages/ko.ts — P22-T6-15(계약배치 C11) 기본 로케일 카탈로그.
// ko 가 키의 단일 출처다. 여기 키를 추가하면 en.ts 에도 같은 키를 추가해야 하며,
// 누락은 i18n.test.ts 의 "키 집합 동일" 단언이 잡는다.
export const ko = {
  nav: {
    home: "홈",
    projects: "프로젝트",
    agents: "에이전트",
    connectors: "커넥터",
    settings: "설정",
    admin: "관리",
    primary: "주 내비게이션",
  },
  settings: {
    title: "설정",
    profile: {
      title: "프로필",
      name: "이름",
      customInstructions: "커스텀 지침",
      language: "언어",
      languageHint: "선택한 언어는 계정에 저장되어 다시 로그인해도 유지됩니다.",
      save: "저장",
      saving: "저장 중…",
      saved: "프로필을 저장했습니다.",
      saveFailed: "프로필 저장에 실패했습니다.",
    },
    sections: {
      memories: {
        label: "메모리",
        description: "모든 대화에 자동 적용되는 저장된 메모리를 관리합니다.",
      },
      skills: {
        label: "스킬",
        description: "사용 가능한 스킬과 허용 도구·정책을 확인합니다.",
      },
      mcp: {
        label: "커넥터",
        description: "MCP 커넥터 연결 상태와 도구를 관리합니다.",
      },
      connections: {
        label: "연결",
        description: "외부 OpenAI 호환 provider 엔드포인트를 등록·검증합니다.",
      },
      prompts: {
        label: "프롬프트",
        description: "자주 쓰는 프롬프트를 저장하고 /명령으로 불러옵니다.",
      },
      "api-keys": {
        label: "API 키",
        description: "API 키를 발급·폐기해 외부 클라이언트 인증에 사용합니다.",
      },
      quota: {
        label: "사용량",
        description: "이번 달 예산 사용량과 일별 추이를 확인합니다.",
      },
      profile: {
        label: "프로필",
        description: "이름·커스텀 지침·언어를 관리합니다.",
      },
    },
  },
  chat: {
    send: "보내기",
    stop: "중지",
    regenerate: "다시 생성",
    newChat: "새 대화",
    placeholder: "무엇이든 물어보세요",
  },
  common: {
    loading: "불러오는 중…",
    cancel: "취소",
    close: "닫기",
  },
} as const;
