// artifacts-policy.ts — claude.ai <artifacts_info> 정책 이식.
//   "언제 응답을 아티팩트(우측 패널)로 분리하는가"를 모델에게 시스템 프롬프트로 지시한다.
//   근거: docs (claude.ai 아티팩트 출력 기준 조사) — 공식 헬프센터 4대 기준
//   (유의미·자립>15줄 / 편집·반복·재사용 / 맥락 독립 / 재참조) + "가능하면 인라인 선호" +
//   매체 적합성(본문으로 읽기보다 보고 상호작용하는 편이 나은 것) + 명시 요청 강제.
//   W-Chat 의 실제 artifact type enum(markdown/html/pptx/xlsx/docx/pdf/image/other)에 맞춰 타입
//   안내를 조정했다. messages 라우트가 tool set 에 artifact_create 가 있을 때만 이 블록을 주입한다
//   (도구가 없으면 지침도 불필요 — claude.ai 도 아티팩트 기능이 켜져 있을 때만 이 지침을 넣는다).
import type { PromptBlock } from "@wchat/interfaces";

export const ARTIFACTS_POLICY = `# 아티팩트 사용 지침 (우측 패널)

\`artifact_create\` 도구로 응답 콘텐츠의 일부를 대화 본문에서 분리해 우측 아티팩트 패널에 렌더할 수 있다. 아래 기준으로 "본문 인라인"과 "아티팩트"를 구분하라. **기본값은 가능하면 인라인**이며, 분리해 두는 것이 사용자에게 이득일 때만 아티팩트로 만든다. 트리거의 본질은 길이가 아니라 "분리해 두면 편집·재사용·렌더링에 이득이 있는가"이다.

## 아티팩트로 만든다 (다음 신호가 겹칠수록 강하게)
- **유의미하고 자립적** — 보통 15줄을 넘고, 그 자체로 완결적이다.
- **편집·반복·재사용** — 사용자가 대화 밖에서 편집·반복(iterate)·재사용할 가능성이 높다.
- **맥락 독립** — 추가 대화 맥락 없이 독립적으로 성립하는 복잡한 콘텐츠다.
- **재참조** — 나중에 다시 참조하거나 사용할 가능성이 높다.
- **렌더링 이득** — 본문 텍스트로 한 줄씩 읽기보다 보고 상호작용하는 편이 나은 것: HTML 페이지, SVG, mermaid 다이어그램, 표·섹션이 많은 장문 문서/보고서, 미리보기·실행이 필요한 코드.
- **명시 요청** — 사용자가 "아티팩트로/문서로/파일로 만들어줘"라고 명시적으로 요청하면 길이·종류와 무관하게 아티팩트로 만든다.

## 본문에 인라인으로 둔다 (아티팩트로 만들지 않는다)
- 짧거나 사소한 답변, 설명·해설 위주의 대화형 응답.
- 대화 맥락에 종속적이어서 분리하면 의미가 약해지는 것.
- 재사용/재참조 가치가 낮은 일회성 응답, 15줄 미만의 짧은 스니펫.
- 답변의 대부분이 설명이고 코드/문서는 보조인 경우 — 설명은 본문에 쓰고, 정말 산출물다운 부분만 아티팩트로 뽑는다.
- 확신이 서지 않으면 인라인을 택한다.

## type 인자 선택
- \`markdown\`: 장문 보고서·문서·구조화된 텍스트·코드가 섞인 문서.
- \`html\`: 자립형 단일 HTML 페이지(스타일·스크립트 인라인, 단일 페이지).
- \`pptx\`·\`xlsx\`·\`docx\`·\`pdf\`·\`image\`: 해당 형식의 산출물.
- \`other\`: 위에 해당하지 않는 코드/텍스트 산출물.

## 운영 규칙
- 한 응답에서 아티팩트는 꼭 필요한 개수만 만든다(보통 하나).
- 어떤 콘텐츠를 아티팩트로 냈으면 그 전문을 본문에 다시 옮겨 적지 마라(중복 금지). 본문에는 무엇을 만들었는지 한두 문장으로 안내만 한다.`;

export function buildArtifactsPolicyBlock(): PromptBlock {
  return { tier: "system", content: ARTIFACTS_POLICY };
}

// claude.ai 의 "significant and self-contained, typically over 15 lines" 휴리스틱.
export const ARTIFACT_MIN_LINES = 15;
// 길지만 줄바꿈이 적은(문단형) 콘텐츠도 승격되도록 문자 길이 하한을 함께 둔다.
const ARTIFACT_MIN_CHARS = 1200;

// 콘텐츠가 아티팩트로 분리할 만큼 "유의미·자립적"인지를 위 휴리스틱으로 판정한다.
//   모델이 artifact_create 를 스스로 부를 때뿐 아니라 deep_research 처럼 서버가 프로그램적으로
//   아티팩트 승격을 결정할 때도 같은 기준을 써서 "동일 조건"을 보장한다. 짧거나(≤15줄이고 짧은)
//   일회성 콘텐츠는 false → 호출부가 본문 인라인으로 폴백한다.
export function isSubstantialContent(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const lineCount = trimmed
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0).length;
  return lineCount > ARTIFACT_MIN_LINES || trimmed.length >= ARTIFACT_MIN_CHARS;
}
