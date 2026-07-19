// public/sw.js — P22-T6-07 minimal PWA service worker (hand-rolled, no workbox).
//   Goal: satisfy installability + serve an app shell offline. Kept intentionally
//   small; API/SSE traffic is always network-first (never cached) to avoid staleness.
//   v2: 셸/스크립트를 cache-first 로 서빙하던 게 배포/HMR 후에도 옛 JS 청크를 계속 내줘
//   업데이트가 사용자에게 안 닿는 staleness 를 유발했다 → **network-first**(온라인이면 항상 최신,
//   캐시는 오프라인 폴백용)로 전환. 캐시 버전 bump 로 구 SW/캐시를 교체한다.
/* eslint-disable no-restricted-globals */
const CACHE = "wchat-shell-v2";
const SHELL = ["/", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .catch(() => undefined),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // API / auth / SSE 는 절대 캐시하지 않는다(항상 네트워크).
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/auth/") ||
    request.headers.get("accept") === "text/event-stream"
  ) {
    return;
  }

  // 앱 셸/정적 자원: **네트워크 우선** — 온라인이면 항상 최신을 받고(캐시도 갱신), 실패(오프라인)
  // 시에만 캐시로 폴백한다. cache-first 였을 때 배포/HMR 후에도 옛 청크를 계속 서빙하던 staleness 해소.
  event.respondWith(
    fetch(request)
      .then((res) => {
        if (res && res.ok && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return res;
      })
      .catch(() => caches.match(request)),
  );
});
