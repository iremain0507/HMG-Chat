# WChat 프론트엔드 디자인 시스템 — Hyundai WIA CI 기반

> **시각 정본(단일 출처) = `apps/web/design-reference/`** (하이파이 디자인 핸드오프).
> 읽기 순서: `README.md` → `WChat Frames.dc.html`(F04 에이전틱 라이브 = 히어로) →
> `WChat App.dc.html`(인터랙티브 프로토타입) → `claude-design-prompt_wchat_hyundai-wia.md`
> (§2.3 토큰 표 · §5 프레임 스펙 · §6 컴포넌트 해부가 최종 정본).
> **새 UI/UX 요소 생성·수정 시 항상 이 핸드오프 디자인을 따른다**(색·타이포·간격·상태·상호작용).
> 색은 전부 `globals.css` 시맨틱 토큰만 사용 — 하드코딩 hex 금지. `globals.css @theme` 는
> 핸드오프 토큰 표(primary 50–900 스케일·시맨틱·navy 다크·mono)를 이미 반영한 상태다.
>
> 대상 앱은 HMG(현대차그룹) 계열 **현대위아(Hyundai WIA)** 사내 LLM 챗 플랫폼이다.
> 아래 CI 근거·토큰 규율은 그 핸드오프와 정합한다. 출처: [현대위아 공식 CI](https://www.hyundai-wia.com/about/ci.asp).

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

> **전체 토큰(정본)은 핸드오프 §2.3 및 `globals.css @theme`.** 아래는 핵심 시맨틱 요약.
> 추가로 `primary-50…900` 스케일, `surface-2`, `fg-subtle`/`placeholder`, `success/warning`
> (soft 포함), `--font-mono`(JetBrains Mono) 가 토큰으로 등록돼 있다.

| 시맨틱       | Light     | Dark(navy) | 용도                                |
| ------------ | --------- | ---------- | ----------------------------------- |
| `primary`    | `#00287A` | `#8AA0DB`  | CTA/링크/활성 (라이트=600 앵커)     |
| `primary-fg` | `#FFFFFF` | `#0B1020`  | primary 위 텍스트                   |
| `primary-50` | `#EEF2FA` | `#1A2547`  | 선택·인용 배경                      |
| `accent`     | `#C8102E` | `#F0564F`  | danger·중단(Stop)·실시간 (소량)     |
| `bg`         | `#FFFFFF` | `#0B1020`  | 페이지 배경                         |
| `surface`    | `#F5F5F5` | `#121A33`  | 카드/패널 (surface-2=100/`#1A2547`) |
| `border`     | `#D9D9D9` | `#26325C`  | 경계선                              |
| `fg`         | `#1A1A1A` | `#EAEEF7`  | 본문 텍스트                         |
| `fg-muted`   | `#666666` | `#B7C0D8`  | 보조 텍스트 (fg-subtle=300 비활성)  |

> 접근성: primary(#00287A) on white ≈ 11:1 (AAA). accent(#C8102E) on white ≈ 6.3:1 (AA).
> 다크는 navy-tinted 표면 + 밝은 인터랙티브(#8AA0DB)로 대비 확보.

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

**단일 출처 = `apps/web/src/app/globals.css`** (핸드오프 §2.3 토큰 표를 반영: primary 50–900
스케일 · neutral(bg/surface/surface-2/border/fg-subtle/placeholder/fg-muted/fg) · 시맨틱
(accent=danger, success/warning + soft) · navy 다크 · Pretendard/JetBrains Mono). 문서에
값을 중복하지 말고 globals.css 를 정본으로 참조.

컴포넌트는 `bg-primary text-primary-fg`, `bg-primary-50`, `text-accent`, `text-success`,
`border-border`, `text-fg-muted`, `font-mono tabular-nums` 등 **시맨틱 유틸만** 사용
(하드코딩 hex 금지). 라이트/다크는 `data-theme` 클래스로 양방향 override.
