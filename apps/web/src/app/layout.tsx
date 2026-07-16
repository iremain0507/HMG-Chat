import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "WChat",
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
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
