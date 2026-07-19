// @vitest-environment jsdom
// hooks/useAttachments.ts — P10-T6-11 컴포저 첨부. 16-API-CONTRACT § 6 Uploads
// POST /uploads(multipart) 소비 — 파일 추가 시 즉시 업로드해 uploadId 를 얻고,
// 제거가능한 칩 목록(items)과 전송용 attachments(readyUploadIds)를 관리한다.
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useAttachments } from "../useAttachments";

describe("useAttachments", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("파일을 추가하면 multipart POST /uploads 후 done 상태로 전이하고 uploadId 를 갖는다", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.body).toBeInstanceOf(FormData);
      return {
        ok: true,
        status: 201,
        json: async () => ({
          data: {
            id: "upload-1",
            filename: "notes.md",
            mimeType: "text/markdown",
            sizeBytes: 10,
          },
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useAttachments("session-1"));

    const file = new File(["hello"], "notes.md", { type: "text/markdown" });
    act(() => {
      result.current.addFiles([file]);
    });

    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0]?.status).toBe("uploading");

    await waitFor(() => {
      expect(result.current.items[0]?.status).toBe("done");
    });
    expect(result.current.items[0]?.uploadId).toBe("upload-1");
    expect(result.current.readyUploadIds).toEqual([{ uploadId: "upload-1" }]);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/uploads",
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
  });

  it("허용 크기를 초과한 파일은 업로드 요청 없이 error 상태로 추가된다", () => {
    vi.stubGlobal("fetch", vi.fn());
    const { result } = renderHook(() => useAttachments("session-1"));

    const big = new File([new Uint8Array(21 * 1024 * 1024)], "big.pdf", {
      type: "application/pdf",
    });
    act(() => {
      result.current.addFiles([big]);
    });

    expect(result.current.items[0]?.status).toBe("error");
    expect(result.current.items[0]?.error).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
    expect(result.current.readyUploadIds).toEqual([]);
  });

  it("허용되지 않는 타입의 파일은 업로드 요청 없이 error 상태로 추가된다", () => {
    vi.stubGlobal("fetch", vi.fn());
    const { result } = renderHook(() => useAttachments("session-1"));

    const exe = new File(["x"], "run.exe", {
      type: "application/octet-stream",
    });
    act(() => {
      result.current.addFiles([exe]);
    });

    expect(result.current.items[0]?.status).toBe("error");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("remove 로 칩을 제거하면 목록에서 사라진다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 201,
        json: async () => ({
          data: {
            id: "upload-1",
            filename: "notes.md",
            mimeType: "text/markdown",
            sizeBytes: 10,
          },
        }),
      })),
    );
    const { result } = renderHook(() => useAttachments("session-1"));

    const file = new File(["hello"], "notes.md", { type: "text/markdown" });
    act(() => {
      result.current.addFiles([file]);
    });
    await waitFor(() => {
      expect(result.current.items[0]?.status).toBe("done");
    });

    const localId = result.current.items[0]!.localId;
    act(() => {
      result.current.remove(localId);
    });

    expect(result.current.items).toHaveLength(0);
  });

  it("이미지 파일을 추가하면 미리보기 previewUrl(objectURL)을 갖고, 비이미지는 갖지 않는다", async () => {
    const createObjectURL = vi.fn(() => "blob:preview-1");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", {
      createObjectURL,
      revokeObjectURL,
    } as unknown as typeof URL);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 201,
        json: async () => ({
          data: { id: "upload-1", filename: "pic.png" },
        }),
      })),
    );
    const { result } = renderHook(() => useAttachments("session-1"));

    const img = new File([new Uint8Array([1, 2, 3])], "pic.png", {
      type: "image/png",
    });
    const doc = new File(["hello"], "notes.md", { type: "text/markdown" });
    act(() => {
      result.current.addFiles([img, doc]);
    });

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const imgItem = result.current.items.find(
      (it) => it.filename === "pic.png",
    );
    const docItem = result.current.items.find(
      (it) => it.filename === "notes.md",
    );
    expect(imgItem?.previewUrl).toBe("blob:preview-1");
    expect(docItem?.previewUrl).toBeUndefined();
  });

  it("이미지 칩을 remove 하면 previewUrl objectURL 을 revoke 한다", () => {
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:preview-1"),
      revokeObjectURL,
    } as unknown as typeof URL);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 201,
        json: async () => ({ data: { id: "u1", filename: "pic.png" } }),
      })),
    );
    const { result } = renderHook(() => useAttachments("session-1"));

    const img = new File([new Uint8Array([1])], "pic.png", {
      type: "image/png",
    });
    act(() => {
      result.current.addFiles([img]);
    });
    const localId = result.current.items[0]!.localId;
    act(() => {
      result.current.remove(localId);
    });

    expect(revokeObjectURL).toHaveBeenCalledWith("blob:preview-1");
  });

  it("업로드 실패 응답이면 error 상태로 전이한다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 415,
        json: async () => ({
          error: { message: "지원하지 않는 형식입니다." },
        }),
      })),
    );
    const { result } = renderHook(() => useAttachments("session-1"));

    const file = new File(["hello"], "notes.md", { type: "text/markdown" });
    act(() => {
      result.current.addFiles([file]);
    });

    await waitFor(() => {
      expect(result.current.items[0]?.status).toBe("error");
    });
    expect(result.current.items[0]?.error).toBe("지원하지 않는 형식입니다.");
  });
});
