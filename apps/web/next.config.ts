import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone", // Docker multi-stage 최적화
  // SSE 필수: Next 가 프록시(/api/*)한 text/event-stream 을 gzip 압축하면 스트림 전체를
  //   버퍼링해 "다 받은 뒤 한 번에" 렌더된다(토큰 순차 표시 깨짐). 압축은 원 서버 SSE 를
  //   버퍼링하므로 Next origin 에선 끈다. 프로덕션 정적자원 압축은 CDN/edge(CloudFront 등)
  //   에서 처리하고, 거기서도 text/event-stream 은 압축 제외해야 한다.
  compress: false,
  reactStrictMode: true,
  experimental: {
    serverActions: { bodySizeLimit: "10mb" },
  },
  // SSE proxy — /api/v1 은 server 로 전달
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.NEXT_PUBLIC_API_BASE?.replace("/api/v1", "") ?? "http://localhost:4000"}/api/:path*`,
      },
    ];
  },
  headers: async () => [
    {
      source: "/(.*)",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      ],
    },
  ],
};

export default config;
