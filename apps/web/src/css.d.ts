// 전역 CSS side-effect import ( import "./globals.css" ) 의 타입 선언.
// Next 는 빌드 시 처리하지만 tsc --noEmit 통과를 위해 ambient 선언 추가.
declare module "*.css";
