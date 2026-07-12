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
