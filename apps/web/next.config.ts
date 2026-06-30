import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",                 // Docker multi-stage 최적화
  reactStrictMode: true,
  experimental: {
    serverActions: { bodySizeLimit: "10mb" },
  },
  // SSE proxy — /api/v1 은 server 로 전달
  async rewrites() {
    return [{
      source: "/api/:path*",
      destination: `${process.env.NEXT_PUBLIC_API_BASE?.replace("/api/v1", "") ?? "http://localhost:4000"}/api/:path*`,
    }];
  },
  headers: async () => [{
    source: "/(.*)",
    headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    ],
  }],
};

export default config;
