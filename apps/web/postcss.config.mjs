// Tailwind v4 PostCSS 설정 — globals.css 의 `@import "tailwindcss"` + `@theme` 를 처리한다.
// 이 파일이 없으면 Tailwind 가 컴파일되지 않아 전 페이지가 미스타일 상태가 된다.
export default {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
