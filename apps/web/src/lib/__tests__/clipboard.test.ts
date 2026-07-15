import { describe, it, expect, vi, afterEach } from "vitest";
import { copyText } from "../clipboard";

describe("lib/clipboard.copyText", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("보안 컨텍스트: navigator.clipboard.writeText 로 복사하고 true 를 반환한다", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const ok = await copyText("hello");
    expect(ok).toBe(true);
    expect(writeText).toHaveBeenCalledWith("hello");
  });

  it("비보안 컨텍스트(navigator.clipboard undefined): execCommand 폴백으로 복사하고 true 를 반환한다", async () => {
    vi.stubGlobal("navigator", {}); // clipboard 미지원(http Tailscale 모사)
    const exec = vi.fn().mockReturnValue(true);
    vi.stubGlobal("document", {
      createElement: () => ({
        style: {},
        setAttribute: vi.fn(),
        select: vi.fn(),
      }),
      body: { appendChild: vi.fn(), removeChild: vi.fn() },
      execCommand: exec,
    });
    const ok = await copyText("fallback");
    expect(ok).toBe(true);
    expect(exec).toHaveBeenCalledWith("copy");
  });

  it("clipboard 도 execCommand 도 실패하면 false 를 반환한다(크래시 없음)", async () => {
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText: vi.fn().mockRejectedValue(new Error("denied")),
      },
    });
    vi.stubGlobal("document", {
      createElement: () => ({
        style: {},
        setAttribute: vi.fn(),
        select: vi.fn(),
      }),
      body: { appendChild: vi.fn(), removeChild: vi.fn() },
      execCommand: vi.fn().mockReturnValue(false),
    });
    const ok = await copyText("x");
    expect(ok).toBe(false);
  });
});
