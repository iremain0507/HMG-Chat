// mammoth.d.ts — mammoth 는 자체 타입 선언을 제공하지 않아 이 도메인에서만 쓰는 최소 shim.
//   (packages/interfaces 는 건드리지 않음 — server-internal ambient 선언.)
declare module "mammoth" {
  export interface ConvertMessage {
    type: string;
    message: string;
  }

  export interface ConvertResult {
    value: string;
    messages: ConvertMessage[];
  }

  export function convertToMarkdown(input: {
    buffer: Buffer;
  }): Promise<ConvertResult>;
}
