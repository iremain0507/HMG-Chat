---
name: wchat-pptx
version: 1.0.0
description: WChat 브랜드 서식으로 PPTX 발표자료를 자동 생성하는 스킬입니다. PptxGenJS 기반.
triggers: pptx 만들어줘, PPT 만들어줘, 발표자료 만들어줘, 슬라이드 만들어줘, wchat 양식 PPT
entryPoint: skills/wchat-pptx/scripts/build.mjs
permissions: user
scope: global
---

# wchat-pptx

이 스킬이 활성화되면 다음 turn 의 system prompt 에 이 본문이 추가됩니다.
WChat 브랜드 서식(색상/레이아웃)을 따르는 PPTX 파일을 생성할 때 아래 절차를 따르세요.

## 사용 시점

- 사용자가 "PPT/발표자료/슬라이드 만들어줘" 등으로 요청하고, `triggers` 키워드와 매칭될 때 활성화합니다.
- 이미 존재하는 PPTX 문서 파싱(knowledge_search 대상)은 이 스킬 범위가 아닙니다 — 신규 생성만 담당합니다.

## 절차

1. 사용자에게 슬라이드에 담을 데이터와 의도(제목, 섹션 구성, 강조할 내용)를 확인합니다.
2. `scripts/build.mjs` (PptxGenJS 기반)를 sandbox 에서 실행할 인자를 구성합니다 — 슬라이드 배열(JSON)을 stdin 또는 인자로 전달합니다.
3. bash tool 로 sandbox 안에서 `node scripts/build.mjs`를 실행해 `.pptx` 파일을 생성합니다.
4. 생성된 파일을 ArtifactStore 에 업로드하고, 아티팩트로 사용자에게 반환합니다.
5. 사용자가 미리보기를 요청하면 LibreOffice → PDF 변환 worker 결과를 ArtifactPanel 에 표시합니다.

## 참고

- 실행 스크립트: `scripts/build.mjs` (bash tool 을 통해 sandbox 에서 실행)
- 브랜드 자산(로고 등): `assets/` — 회사가 제공한 원본 자산만 사용, 임의 재현·변형 금지(`apps/web/DESIGN.md` 동일 원칙). 미보유 시 텍스트 워드마크로 대체.
- 색상은 Hyundai WIA CI 시맨틱 톤(`primary` 청색 계열, `accent` 레드는 강조용 소량)을 따릅니다.
