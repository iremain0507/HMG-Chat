// @vitest-environment node
// app/manifest.ts — P22-T6-07 PWA installable manifest.
//   Next.js MetadataRoute.Manifest served at /manifest.webmanifest.
//   Acceptance: valid manifest with display:standalone, name/short_name, start_url,
//   theme_color = Hyundai WIA primary #00287A (apps/web/DESIGN.md), 192px+512px icons.
import { describe, it, expect } from "vitest";
import manifest from "../manifest";

describe("PWA manifest (app/manifest.ts)", () => {
  const m = manifest();

  it("declares an installable standalone app with name/short_name/start_url", () => {
    expect(m.name).toBe("WChat");
    expect(m.short_name).toBeTruthy();
    expect(m.start_url).toBe("/");
    expect(m.display).toBe("standalone");
  });

  it("uses the Hyundai WIA primary #00287A as theme/background color", () => {
    expect(m.theme_color?.toLowerCase()).toBe("#00287a");
    expect(m.background_color).toBeTruthy();
  });

  it("provides 192px and 512px icons plus a maskable variant", () => {
    const sizes = (m.icons ?? []).map((i) => i.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
    const hasMaskable = (m.icons ?? []).some((i) =>
      (i.purpose ?? "").includes("maskable"),
    );
    expect(hasMaskable).toBe(true);
  });
});
