import { describe, it, expect, vi, afterEach } from "vitest";
import {
  createOfficePdfConverter,
  ConverterWorkerError,
} from "../office-pdf-converter.js";

describe("createOfficePdfConverter", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("baseUrl 미설정 시 즉시 throw", () => {
    expect(() => createOfficePdfConverter(undefined, vi.fn())).toThrow(
      /CONVERTER_WORKER_URL/,
    );
  });

  it("POST /convert/pptx-to-pdf 호출해 pages/durationMs 반환", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ pages: 7, durationMs: 123 }), {
        status: 200,
      }),
    );
    const converter = createOfficePdfConverter(
      "http://converter-worker:8000",
      fetchMock,
    );

    const result = await converter.convertPptxToPdf(
      "uploads/in.pptx",
      "artifacts/out.pdf",
    );

    expect(result).toEqual({ pages: 7, durationMs: 123 });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://converter-worker:8000/convert/pptx-to-pdf",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          s3KeyIn: "uploads/in.pptx",
          s3KeyOut: "artifacts/out.pdf",
        }),
      }),
    );
  });

  it("converter-worker 가 에러 응답이면 ConverterWorkerError throw", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("boom", { status: 500 }));
    const converter = createOfficePdfConverter(
      "http://converter-worker:8000",
      fetchMock,
    );

    await expect(
      converter.convertPptxToPdf("uploads/in.pptx", "artifacts/out.pdf"),
    ).rejects.toThrow(ConverterWorkerError);
  });
});
