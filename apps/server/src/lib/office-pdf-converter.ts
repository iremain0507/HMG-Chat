// office-pdf-converter.ts — converter-worker(HTTP) 클라이언트.
//   01-LESSONS-LEARNED.md § L17: 무거운 LibreOffice 의존성은 server 에 내장하지 않고
//   별도 Fargate worker(apps/converter-worker, Python/FastAPI) 로 분리, server 는 HTTP 로만 호출.
//   contract: 05-REPO-STRUCTURE.md § converter-worker API — POST /convert/pptx-to-pdf.

export interface OfficePdfConvertResult {
  pages: number;
  durationMs: number;
}

export interface OfficePdfConverter {
  convertPptxToPdf(
    s3KeyIn: string,
    s3KeyOut: string,
  ): Promise<OfficePdfConvertResult>;
}

export class ConverterWorkerError extends Error {}

/** converter-worker HTTP client. baseUrl 기본 = $CONVERTER_WORKER_URL. */
export function createOfficePdfConverter(
  baseUrl: string | undefined = process.env.CONVERTER_WORKER_URL,
  fetchImpl: typeof fetch = fetch,
): OfficePdfConverter {
  if (!baseUrl) {
    throw new Error("office-pdf-converter: CONVERTER_WORKER_URL 미설정");
  }
  const url = baseUrl;

  return {
    async convertPptxToPdf(s3KeyIn, s3KeyOut) {
      const response = await fetchImpl(`${url}/convert/pptx-to-pdf`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ s3KeyIn, s3KeyOut }),
      });

      if (!response.ok) {
        const body = await response.text();
        throw new ConverterWorkerError(
          `converter-worker ${response.status}: ${body}`,
        );
      }

      const data = (await response.json()) as OfficePdfConvertResult;
      return { pages: data.pages, durationMs: data.durationMs };
    },
  };
}
