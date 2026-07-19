// app/manifest.ts — P22-T6-07 PWA installable web app manifest.
//   Next.js MetadataRoute.Manifest is served at /manifest.webmanifest.
//   Colors follow the Hyundai WIA CI (apps/web/DESIGN.md): primary #00287A.
//   Hand-rolled (no next-pwa/serwist dependency) so this stays fully T6.
import type { MetadataRoute } from "next";

// 단일 출처: apps/web/DESIGN.md — primary(WIA Blue) = #00287A, bg(라이트) = #ffffff.
const WIA_PRIMARY = "#00287a";
const APP_BG = "#ffffff";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "WChat",
    short_name: "WChat",
    description: "Hyundai WIA WChat — 사내 에이전틱 AI 어시스턴트",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: APP_BG,
    theme_color: WIA_PRIMARY,
    lang: "ko",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
