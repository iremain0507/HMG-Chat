// org-settings-schema.ts — org_settings.settings(JSONB) 검증/기본값 단일 출처.
//   rebuild_plan/21-LOOP-LESSONS.md L2: 손상/부재 시 반드시 이 DEFAULT 로 fail-soft(throw·1024 폴백 금지).
//   packages/interfaces·shared 미사용(frozen 회피) — 이 phase 전용 LOCAL Zod.
//   allowedModels·allowedTools·defaultTokenBudgetMicros 는 기존 organizations 컬럼을 재사용하므로 여기 없음.

import { z } from "zod";

// P19-T1-10: 배너 typed 스키마. 기존 저장값이 평문 문자열(구 버전)일 수 있어
// safeParse 단계에서 typed 배너 1건(또는 빈 배열)으로 폴백 변환한다(L2, 마이그레이션 불필요).
export const BannerSchema = z.object({
  type: z.enum(["info", "success", "warning", "error"]).default("info"),
  title: z.string().max(200).optional(),
  content: z.string().min(1).max(2000),
  dismissible: z.boolean().default(true),
});

export type Banner = z.infer<typeof BannerSchema>;

const BannerListInput = z.union([
  z.string().max(2000),
  z.array(BannerSchema).max(20),
]);

export const OrgSettingsSchema = z.object({
  // Models & Generation
  maxTokens: z.number().int().min(1).max(128_000).optional(),
  temperature: z.number().min(0).max(1).optional(),
  topP: z.number().min(0).max(1).optional(), // 런타임 미배선(ISOLATE) — 저장/UI 만 in-scope
  defaultModel: z.string().min(1).max(200).optional(),
  systemPrompt: z.string().max(20_000).optional(),
  toolMaxTokens: z.number().int().min(1).max(128_000).optional(),

  // Knowledge/RAG
  ragTopK: z.number().int().min(1).max(100).optional(),
  ragRrfK: z.number().int().min(1).max(1000).optional(),
  ragChunkSizeTokens: z.number().int().min(50).max(8000).optional(),
  ragChunkOverlapTokens: z.number().int().min(0).max(4000).optional(),
  ragHybridEnabled: z.boolean().optional(),
  ragRelevanceThreshold: z.number().min(0).max(1).optional(),

  // Web Search
  webSearchEnabled: z.boolean().optional(),
  webSearchResultCount: z.number().int().min(1).max(20).optional(),
  // P19-T1-12: web_search 핸들러가 invoke 시점에 이 값으로 실 provider 를 선택한다
  // (미설정/"dev-stub"→dev-stub 폴백). webSearchApiKeyRef 는 실제 비밀이 아니라 서버가
  // 아는 고정 env ref 이름(예: "TAVILY_API_KEY")만 가리킨다 — 임의 값은 조회 거부(보안).
  webSearchProvider: z.enum(["dev-stub", "tavily"]).optional(),
  webSearchEndpoint: z.string().max(500).optional(),
  webSearchApiKeyRef: z.string().max(200).optional(),

  // Media — P22-T1-08: image_generate 도구 org 게이트. false 면 핸들러가 invoke 시점에
  // IMAGE_GEN_DISABLED 로 거절한다(admin 설정에서 토글, webSearchEnabled 와 동일 패턴).
  imageGenEnabled: z.boolean().optional(),

  // Chat — P22-T6-16: 입력 자동완성(ghost text). off 면 POST /completions 가 invoke 시점에
  // FEATURE_DISABLED 로 거절한다(webSearchEnabled/imageGenEnabled 와 동일한 org 게이트 패턴).
  autocompleteEnabled: z.boolean().optional(),

  // Connectors/MCP
  enableDirectConnections: z.boolean().optional(),

  // General/Branding
  instanceName: z.string().min(1).max(120).optional(),
  banner: BannerListInput.optional().transform((val) => {
    if (val === undefined) return undefined;
    if (typeof val === "string") {
      return val.length === 0
        ? []
        : [{ type: "info" as const, content: val, dismissible: true }];
    }
    return val;
  }),
  responseWatermark: z.string().max(200).optional(),

  // Users & Permissions — env/ALLOWED_DOMAINS 도메인 게이트와 결합해 routes/auth.ts 가 반영(P15-T1-01)
  defaultUserRole: z.enum(["member", "admin", "owner"]).optional(),
  enableSignup: z.boolean().optional(),

  // Quota/Limits
  maxUploadSizeMb: z.number().int().min(1).max(1000).optional(),
  maxUploadCount: z.number().int().min(1).max(100).optional(),
  // P20-T1-17: 업로드 허용 확장자 화이트리스트(소문자, 점 없이). routes/uploads.ts 가
  // 업로드 시점에 filename 확장자를 이 목록과 대조해 강제한다.
  allowedUploadExtensions: z
    .array(z.string().min(1).max(20))
    .max(50)
    .optional(),

  // Identity/LDAP — P22-T1-11(계약배치 C14): LDAP/AD 디렉터리 로그인.
  // ldapEnabled=false 가 기본이라 미설정 org 는 기존 매직링크/비밀번호 경로 그대로(비파괴).
  ldapEnabled: z.boolean().optional(),
  ldapUrl: z.string().max(500).optional(), // ldap:// | ldaps://host:port
  ldapBindDn: z.string().max(500).optional(), // 검색용 서비스 계정 DN(빈 값=익명 bind)
  // 비밀번호 자체가 아니라 서버가 읽을 env 변수 **이름**만 저장한다(LDAP_ 접두만 허용).
  // webSearchApiKeyRef 와 동일한 "비밀은 DB 밖" 원칙 — lib/ldap-client.ts resolveLdapConfig 참조.
  ldapBindPasswordRef: z.string().max(200).optional(),
  ldapBaseDn: z.string().max(500).optional(), // 이 서브트리 밖 사용자는 로그인 불가
  ldapUserFilter: z.string().max(500).optional(), // {{username}} 자리표시자(RFC 4515 이스케이프됨)
  ldapEmailAttribute: z.string().max(100).optional(),
  ldapNameAttribute: z.string().max(100).optional(),
  ldapGroupAttribute: z.string().max(100).optional(),
  // 그룹 DN → org 롤. 비어 있으면 그룹 게이트 미적용(디렉터리 인증만으로 허용).
  ldapGroupRoleMap: z
    .record(z.string().max(500), z.enum(["member", "admin", "owner"]))
    .optional(),
  ldapTlsRejectUnauthorized: z.boolean().optional(),

  // Identity/SSO — P22-T1-17(계약배치 C16): OAuth2/OIDC SSO + 역프록시 trusted-header.
  // 둘 다 기본 false 라 미설정 org 는 기존 매직링크/비밀번호/LDAP 경로 그대로(비파괴).
  oidcEnabled: z.boolean().optional(),
  oidcIssuer: z.string().max(500).optional(),
  oidcAuthorizationEndpoint: z.string().max(500).optional(),
  oidcTokenEndpoint: z.string().max(500).optional(),
  // 선택 — id_token 에 email/groups 를 싣지 않는 IdP 보강용.
  oidcUserinfoEndpoint: z.string().max(500).optional(),
  oidcClientId: z.string().max(200).optional(),
  // client_secret 자체가 아니라 서버가 읽을 env 변수 **이름**만 저장한다(OIDC_ 접두만 허용).
  oidcClientSecretRef: z.string().max(200).optional(),
  oidcRedirectUri: z.string().max(500).optional(),
  oidcScopes: z.string().max(300).optional(), // 공백 구분("openid email profile")
  oidcEmailClaim: z.string().max(100).optional(),
  oidcNameClaim: z.string().max(100).optional(),
  oidcGroupsClaim: z.string().max(100).optional(),
  // 그룹/롤 클레임 값 → org 롤. 비어 있으면 그룹 게이트 미적용(IdP 인증만으로 허용).
  oidcGroupRoleMap: z
    .record(z.string().max(500), z.enum(["member", "admin", "owner"]))
    .optional(),

  // 앞단 프록시(oauth2-proxy·Cloudflare Access 등)가 인증을 끝내고 신원을 헤더로 넘기는 배포.
  trustedHeaderEnabled: z.boolean().optional(),
  trustedHeaderEmail: z.string().max(100).optional(),
  trustedHeaderName: z.string().max(100).optional(),
  trustedHeaderGroups: z.string().max(100).optional(),
  // 프록시 공유비밀의 env 변수 **이름**(TRUSTED_HEADER_ 접두만 허용). 설정 시 헤더 위조 차단.
  trustedHeaderSecretRef: z.string().max(200).optional(),
  trustedHeaderGroupRoleMap: z
    .record(z.string().max(500), z.enum(["member", "admin", "owner"]))
    .optional(),

  // API Keys — P20-T1-12: 전역 마스터 토글(off 면 신규 발급 거부, 기존 키는 영향 없음).
  enableApiKeys: z.boolean().optional(),

  // Admin Notifications — P20-T1-14: 설정 시 신규가입 완료마다 new_user 페이로드를 이
  // URL 로 POST(dev-stub, 실 네트워크 미발송). 미설정(빈 문자열)이면 미발송.
  adminWebhookUrl: z.string().max(500).optional(),
});

export type OrgSettingsPatch = z.infer<typeof OrgSettingsSchema>;
// Required<> 만으로는 zod .optional() 필드의 값 타입(`X | undefined`)이 그대로 남아
// DEFAULT_ORG_SETTINGS 병합으로 실제론 항상 채워지는 필드도 TS18048 을 유발한다 — 값 타입에서도
// undefined 를 제거해 "resolve() 는 모든 필드가 채워짐을 보장" 이라는 실제 계약과 타입을 일치시킨다.
export type ResolvedOrgSettings = {
  [K in keyof Required<OrgSettingsPatch>]: Exclude<
    Required<OrgSettingsPatch>[K],
    undefined
  >;
};

export const DEFAULT_ORG_SETTINGS: ResolvedOrgSettings = {
  maxTokens: 4096,
  temperature: 0.7,
  topP: 0.9,
  defaultModel: "claude-sonnet-5",
  systemPrompt: "",
  toolMaxTokens: 4096,

  ragTopK: 10,
  ragRrfK: 60,
  ragChunkSizeTokens: 800,
  ragChunkOverlapTokens: 100,
  ragHybridEnabled: true,
  ragRelevanceThreshold: 0.0,

  webSearchEnabled: false,
  webSearchResultCount: 3,
  webSearchProvider: "dev-stub",
  webSearchEndpoint: "",
  webSearchApiKeyRef: "",

  imageGenEnabled: false,

  // 현행(자동완성 기능 자체가 없었음) 동작 보존 — org 관리자가 명시적으로 켜야 활성(비파괴).
  autocompleteEnabled: false,

  enableDirectConnections: false,

  instanceName: "WChat",
  banner: [],
  responseWatermark: "",

  defaultUserRole: "member",
  // 현행 "허용 도메인이면 가입 가능"(routes/auth.ts 의 env allowedDomains 게이트) 동작을
  // 미조정 org 에서 그대로 보존하기 위한 기본값(P15-T1-01, 비파괴).
  enableSignup: true,

  maxUploadSizeMb: 25,
  maxUploadCount: 10,
  // 일반 문서/이미지 셋(현행 parser-pipeline 지원 문서 포맷 + 텍스트/이미지) — 비파괴 기본값.
  allowedUploadExtensions: [
    "pdf",
    "doc",
    "docx",
    "ppt",
    "pptx",
    "xls",
    "xlsx",
    "txt",
    "md",
    "csv",
    "json",
    "png",
    "jpg",
    "jpeg",
    "gif",
    "webp",
  ],

  // P22-T1-11(C14) — 디렉터리 로그인은 명시적으로 켜야 활성(기존 인증 경로 무변경).
  // 속성 기본값은 Active Directory 관례를 따른다.
  ldapEnabled: false,
  ldapUrl: "",
  ldapBindDn: "",
  ldapBindPasswordRef: "",
  ldapBaseDn: "",
  ldapUserFilter: "(|(sAMAccountName={{username}})(mail={{username}}))",
  ldapEmailAttribute: "mail",
  ldapNameAttribute: "displayName",
  ldapGroupAttribute: "memberOf",
  ldapGroupRoleMap: {},
  ldapTlsRejectUnauthorized: true,

  // P22-T1-17(C16) — SSO 는 명시적으로 켜야 활성(기존 인증 경로 무변경).
  // 클레임 이름 기본값은 OIDC Core 표준 클레임을 따른다.
  oidcEnabled: false,
  oidcIssuer: "",
  oidcAuthorizationEndpoint: "",
  oidcTokenEndpoint: "",
  oidcUserinfoEndpoint: "",
  oidcClientId: "",
  oidcClientSecretRef: "",
  oidcRedirectUri: "",
  oidcScopes: "openid email profile",
  oidcEmailClaim: "email",
  oidcNameClaim: "name",
  oidcGroupsClaim: "groups",
  oidcGroupRoleMap: {},

  // 헤더 인증은 위조가 쉬워 기본 비활성. 헤더 이름 기본값은 oauth2-proxy 관례를 따른다.
  trustedHeaderEnabled: false,
  trustedHeaderEmail: "X-Forwarded-Email",
  trustedHeaderName: "X-Forwarded-User",
  trustedHeaderGroups: "X-Forwarded-Groups",
  trustedHeaderSecretRef: "",
  trustedHeaderGroupRoleMap: {},

  // 현행(마스터 토글 없음=누구나 발급 가능) 동작을 미조정 org 에서 보존(비파괴).
  enableApiKeys: true,

  adminWebhookUrl: "",
};
