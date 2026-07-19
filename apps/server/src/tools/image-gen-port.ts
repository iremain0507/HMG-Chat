// image-gen-port.ts — 서버-로컬 이미지 생성 포트(web-search-port.ts 와 동일한 포트-어댑터 원칙,
//   20-MULTI-AGENT-TOOL.md §20.4-2). packages/interfaces 에 두지 않는다(동결 계약 아님, image_generate
//   는 apps/server 내부 기능). 실 구현 = 배포 시 실 provider(예: OpenAI images / Gemini) 주입,
//   테스트/LOCAL_ONLY 는 image-gen-provider-dev-stub.ts(결정론적 PNG) 주입 — web_search 와 동일 패턴.

export interface GeneratedImage {
  data: Buffer;
  mimeType: string;
}

export interface ImageGenPort {
  generate(
    prompt: string,
    opts?: { size?: string; n?: number; signal?: AbortSignal },
  ): Promise<GeneratedImage[]>;
}
