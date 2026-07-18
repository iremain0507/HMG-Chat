import "./globals.css";
import type { Metadata, Viewport } from "next";
import { ServiceWorkerRegister } from "../components/ServiceWorkerRegister";
import { THEME_INIT_SCRIPT } from "../lib/theme-init";

// P22-T6-07: PWA 설치 가능 메타데이터 — manifest(route: /manifest.webmanifest),
//   홈스크린 아이콘, iOS standalone(appleWebApp). 색상은 현대위아 CI primary #00287A
//   (apps/web/DESIGN.md, viewport.themeColor 단일 지정).
export const metadata: Metadata = {
  title: "WChat",
  applicationName: "WChat",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "WChat",
  },
};

export const viewport: Viewport = {
  themeColor: "#00287a",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // suppressHydrationWarning: 브라우저 확장(번역/문법기·다크모드 등)이나 테마 토글이
  //   React 하이드레이션 전에 html/body 에 속성을 주입해 생기는 위양성 mismatch 방어(1-depth).
  //   Next.js 권장 패턴 — 앱 렌더 자체는 SSR/클라 동일.
  return (
    <html lang="ko" suppressHydrationWarning>
      <body suppressHydrationWarning>
        {/* pre-hydration 테마 스탬프 — 첫 페인트 전에 저장 테마(wchat-theme)로 data-theme 확정(FOUC 방지). */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <ServiceWorkerRegister />
        {children}
      </body>
    </html>
  );
}
