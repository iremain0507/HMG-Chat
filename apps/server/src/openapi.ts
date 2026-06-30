// buildOpenApi 는 순수 함수 — Env 가 아니라 metadata 만 받음.
// runtime 의 GET /openapi.json endpoint 도 같은 함수 호출 (env 불요).
export interface OpenApiOpts {
  title: string;
  baseUrl: string;
  version?: string;
}

export function buildOpenApi(opts: OpenApiOpts) {
  return {
    openapi: "3.1.0",
    info: { title: opts.title, version: opts.version ?? "0.0.0" },
    paths: {
      "/health": {
        get: { responses: { "200": { description: "ok" } } }
      }
    },
  };
}
