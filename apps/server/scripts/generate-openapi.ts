// generate-openapi.ts 는 contract 추출만 한다 — DB/Redis/JWT 같은 runtime env 의존 금지.
// loadEnv() 호출 안 함. title/baseUrl 만 별도 가벼운 env 로 받음.
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildOpenApi } from "../src/openapi.js";

const opts = {
  title: process.env.APP_NAME ?? "WChat API",
  baseUrl: process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:4000/api/v1",
  version: process.env.npm_package_version ?? "0.0.0",
};
const spec = buildOpenApi(opts);
const outPath = resolve(import.meta.dirname, "..", "openapi.json");
// 끝에 개행 추가 — prettier 포맷과 일치시켜 재생성 시 무의미한 diff(=CI drift) 방지.
writeFileSync(outPath, JSON.stringify(spec, null, 2) + "\n");
console.warn(`[gen-openapi] wrote ${outPath}`);
