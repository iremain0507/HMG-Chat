# WChat 프론트엔드 디자인 시스템 — Hyundai WIA CI 기반

> 대상 앱은 HMG(현대차그룹) 계열 **현대위아(Hyundai WIA)** 사내 LLM 챗 플랫폼이다.
> 모든 `apps/web` UI 는 아래 Hyundai WIA CI(Corporate Identity)를 단일 출처로 따른다.
> 출처: [현대위아 공식 CI](https://www.hyundai-wia.com/about/ci.asp) (2026-07 조사).

## 1. 브랜드 색상 (공식 값)

| 역할               | 이름             | Pantone | RGB                | HEX         |
| ------------------ | ---------------- | ------- | ------------------ | ----------- |
| **메인**           | Hyundai WIA Blue | 288C    | 0, 40, 122         | `#00287A`   |
| **포인트(모티프)** | Hyundai WIA Red  | 186C    | (공식표기 255,0,0) | `#C8102E` * |
| 보조               | Light Gray       | 420C    | 217,217,217        | `#D9D9D9`   |
| 보조               | Gray             | 421C    | 179,179,179        | `#B3B3B3`   |
| 보조               | Dark Gray        | 425C    | 102,102,102        | `#666666`   |
| 보조               | Gold             | 872C    | —                  | `#85714D`   |
| 보조               | Silver           | 877C    | —                  | `#8A8D8F`   |
| 보조               | Yellow           | 109C    | —                  | `#FFD100`   |

\* 공식 문서는 Red 를 RGB 255,0,0 으로 단순 표기하지만, 순수 `#FF0000` 은 UI 대면적에 부적합.
Pantone 186C 실제값 `#C8102E` 를 브랜드 레드로 사용. 레드는 **포인트/모티프 전용**(소량)이다.

### 상징 의미 (적용 톤)

- **청색** = 사회적 책임 · 고객 우선 → 신뢰/안정. UI의 **주조색**(헤더, 1차 액션, 링크, 포커스).
- **적색 모티프** = 열정 · 창의 · 미래 성장 → **강조/경고/실시간 상태**에 소량. 넓은 배경 금지.

## 2. 시맨틱 토큰 매핑 (light/dark)

| 시맨틱       | Light     | Dark      | 용도                        |
| ------------ | --------- | --------- | --------------------------- |
| `primary`    | `#00287A` | `#3D6FD4` | 1차 버튼/링크/활성/포커스링 |
| `primary-fg` | `#FFFFFF` | `#0B1220` | primary 위 텍스트           |
| `accent`     | `#C8102E` | `#F0576E` | 강조·에러·중단(Stop)·실시간 |
| `bg`         | `#FFFFFF` | `#0F141A` | 페이지 배경                 |
| `surface`    | `#F5F7FA` | `#161C24` | 카드/패널                   |
| `border`     | `#D9D9D9` | `#2A3340` | 경계선                      |
| `fg`         | `#1A1D21` | `#E6E9ED` | 본문 텍스트                 |
| `fg-muted`   | `#666666` | `#B3B3B3` | 보조 텍스트                 |

> 접근성: primary(#00287A) on white 대비 ≈ 11:1 (AAA). accent(#C8102E) on white ≈ 6.3:1 (AA).
> 다크 모드는 원색을 그대로 쓰면 대비 부족 → 위 밝은 파생값 사용.

## 3. 타이포그래피

- 현대위아 전용 서체는 라이선스 자산(명칭 비공개) → 웹은 **Pretendard**(한글+라틴 코퍼릿, 무료, self-host) 사용.
  fallback: `-apple-system, "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif`.
- 숫자/코드: `ui-monospace, "SF Mono", monospace`.
- 스케일(rem): 12/14/16(base)/20/24/32/40. 본문 16, 줄간격 1.6. 제목 semibold~bold.

## 4. 로고 규칙 (중요)

- **공식 로고를 임의로 재현/변형하지 않는다.** 심벌은 회사가 제공하는 공식 자산 파일만 사용.
- 자산 미보유 시엔 **텍스트 워드마크**("HYUNDAI WIA" + 제품명 "WChat")로 대체하고, 색은 primary 사용.
- 로고 최소 여백·비율은 공식 CI 매뉴얼 준수(재현 금지).

## 5. 컴포넌트 원칙

- 1차 버튼 = primary 배경 / 2차 = surface+border / 위험(삭제·중단) = accent.
- 링크·포커스 링 = primary. 실시간 SSE 스트리밍 인디케이터·Stop 버튼 = accent.
- 넓은 면(배경/사이드바)은 bg/surface(중립) 위주, 브랜드 컬러는 액션·강조에 절제 사용.
- 라운드: 8px 기본, 카드 12px. 그림자는 약하게(코퍼릿 정돈된 느낌).

## 6. Tailwind v4 적용 (globals.css `@theme`)

아래 블록을 `apps/web/src/app/globals.css` 의 `@theme` 로 반영(단일 출처). 컴포넌트는
`bg-primary text-primary-fg`, `text-accent`, `border-border` 등 시맨틱 유틸만 사용.

```css
@import "tailwindcss";
@theme {
  --color-primary: #00287a;
  --color-primary-fg: #ffffff;
  --color-accent: #c8102e;
  --color-bg: #ffffff;
  --color-surface: #f5f7fa;
  --color-border: #d9d9d9;
  --color-fg: #1a1d21;
  --color-fg-muted: #666666;
  --font-sans:
    "Pretendard", -apple-system, "Apple SD Gothic Neo", system-ui, sans-serif;
  --radius: 0.5rem;
}
@media (prefers-color-scheme: dark) {
  @theme {
    --color-primary: #3d6fd4;
    --color-primary-fg: #0b1220;
    --color-accent: #f0576e;
    --color-bg: #0f141a;
    --color-surface: #161c24;
    --color-border: #2a3340;
    --color-fg: #e6e9ed;
    --color-fg-muted: #b3b3b3;
  }
}
```
