import { z } from "zod";

const Env = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  ALLOWED_DOMAINS: z.string(),
  EMAIL_SENDER_KIND: z
    .enum(["console", "ses", "smtp", "test", "noop"])
    .default("console"),
  // 16-API-CONTRACT § EmailSender 와 단일 출처: console (dev) / ses (prod) / smtp / test (unit) / noop (smoke).
  EMAIL_FROM: z.string().email().optional(),
  // magic-link 이메일 본문 + 302 redirect 대상 origin. 미설정 시 app.ts 가 로컬 web dev 기본값으로 fail-soft.
  APP_ORIGIN: z.string().optional(),
  // 미설정 시 app.ts 가 llm-provider-dev-stub 으로 fail-soft (P2-T2-06 acceptance).
  ANTHROPIC_API_KEY: z.string().optional(),
  // 실 Anthropic 사용 시 모델 ID. 기본 Sonnet 5. .env.local 로 override 가능.
  LLM_MODEL: z.string().default("claude-sonnet-5"),
  // 내장 도구 실 provider 키(미설정 시 dev-stub 폴백). .env.local 로 주입.
  //   TAVILY_API_KEY → web_search/deep_research 실 웹검색. E2B_API_KEY → code_interpreter 실 샌드박스.
  TAVILY_API_KEY: z.string().optional(),
  E2B_API_KEY: z.string().optional(),
  // P22-T1-08 — image_generate 전역 feature 게이트(배포시 끌 수 있음). LOCAL_ONLY 는 dev-stub
  // provider 로 왕복 동작하도록 기본 활성. org 별 on/off 는 org_settings.imageGenEnabled(invoke-time).
  IMAGE_GEN_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
});
export type Env = z.infer<typeof Env>;

export function loadEnv(): Env {
  const parsed = Env.safeParse(process.env);
  if (!parsed.success) {
    console.error("ENV validation failed:", parsed.error.format());
    process.exit(1);
  }
  return parsed.data;
}
