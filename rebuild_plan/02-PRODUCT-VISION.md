# 02 · Product Vision

## 한 문장 정의

> **{{PROJECT_NAME}} 는 {{ORG_FULL_NAME_KO}} 내부 직원들이 사내 데이터·도구·에이전트를 안전하게 호출하여 업무를 수행할 수 있게 하는 멀티테넌트 AI 에이전트 인프라 플랫폼이다.**

## Persona

| Persona | 누구 | 무엇을 원하나 | 어떻게 {{PROJECT_NAME}} 가 돕나 |
|---|---|---|---|
| **사원 (End-user)** | 영업/기획/엔지니어링 등 일반 직원 | 회의록 요약, 보고서 작성, 제안서 작성, 데이터 검색 | 채팅 + 도구(검색/지식/PPTX 생성) |
| **팀 매니저** | 부서장 / 프로젝트 리드 | 팀의 자료를 한 곳에 모으고, 팀 멤버가 그 자료로 작업 가능하게 | Project (지식 베이스 + 멤버) |
| **조직 관리자** | 사업부 IT/AI 담당 | 모델·도구·정책·할당량 통제 | OrgPolicy + Quota + 사용량 분석 |
| **개발자** | 사내 AI 팀 / 자회사 AI 팀 | 자기 도메인의 도구·스킬을 {{PROJECT_NAME}} 에 등록 | Skill / MCP server 등록 |
| **운영자 (SRE)** | {{PROJECT_NAME}} 운영팀 | 가용성, 보안, 비용 | Ops 대시보드 + 알림 + 헬스체크 |

## 핵심 시나리오 (대표 4가지)

### Scenario 1 — "이 PDF 요약해 줘"
1. 사용자가 채팅에 PDF 업로드 + "30 페이지 요약" 요청
2. 서버: PDF parser (knowledge pipeline) → markdown → 청크 + embedding (Voyage)
3. 모델 호출: knowledge_search 도구로 청크 검색, citation 포함 응답
4. 응답에 `[1]`, `[2]` inline reference + 하단 Reference 섹션

### Scenario 2 — "{{ORG_NAME_KO}} 양식 PPT 만들어 줘"
1. 사용자가 데이터 + 의도 입력
2. 모델이 `{{BRAND_PPTX_SKILL_NAME}}` 스킬 활성화 (SKILL.md 자동 prompt 주입)
3. E2B sandbox 에서 PptxGenJS 코드 실행 → S3 업로드
4. 클라이언트 ArtifactPanel 에 PPTX preview (LibreOffice → PDF 변환 worker)
5. "공유 링크 만들어줘" → 익명 토큰 30일 만료 URL

### Scenario 3 — "내가 영업담당인 거 기억해줘"
1. 사용자가 회사/직무/선호 명시
2. memory-extractor 가 user_memories 에 카테고리별 저장
3. 다음 세션부터 prompt-builder 가 User-level 권한으로 prompt 주입
4. 모델이 그 컨텍스트로 응답 (영업 톤, 회사 컨텍스트)

### Scenario 4 — "사내 API X 를 도구로 쓰고 싶어"
1. 개발자가 MCP server 작성 → org admin 이 {{PROJECT_NAME}} 에 등록
2. {{PROJECT_NAME}} 가 MCP 도구 schema 자동 발견 → org/project/user 단위 스코핑
3. SSRF 보호 (RFC-1918 + VPC CIDR 화이트리스트)
4. 도구 호출 시 quota 적용, usage_logs 기록

## 성공 지표 (KPI)

### 사용자 활동
- DAU / WAU / MAU
- 세션당 메시지 수 평균
- 도구 호출 수 / 세션
- 만족도 (피드백 thumbs up/down 비율)

### 시스템 품질
- p50 / p95 응답 시간 (LLM 제외 서버 round-trip)
- 에러율 (4xx / 5xx) 카테고리별
- Sandbox lifecycle 성공률
- MCP 도구 timeout 비율

### 비용
- 토큰 사용량 (provider × model × org)
- E2B 컨테이너 시간 (org 별)
- S3 storage (org 별)
- 인프라 비용 (월) / DAU

### 운영
- Mean Time To Detect (MTTD)
- Mean Time To Resolve (MTTR)
- Deploy frequency
- Change failure rate

## 비기능 요구사항 (NFR)

| NFR | 목표 |
|---|---|
| **가용성** | 99.5% (월 ~3.6h 다운타임 허용) |
| **응답 시간** | p95 < 500ms (LLM/도구 외) |
| **동시 사용자** | 100명 (v1.0), 1000명 (v1.5) |
| **데이터 보존** | 메시지 90일 / 메모리 영구 / 업로드 30일 (org 정책 가능) |
| **보안** | TLS 1.3, HttpOnly cookie + JWT, RLS, audit log |
| **컴플라이언스** | 사내 도메인만 (`*@{{ORG_DOMAIN}}`), MCP SSRF 보호 |
| **백업** | RDS 일일 자동 백업 + 7일 보관 |
| **재해 복구** | RTO 4시간 / RPO 24시간 (v1.0), v2 에서 단축 |
| **국제화** | 한국어 우선, 영어 차후 |

## v2 로드맵 (v1.0 이후)

본 plan 은 v1.0 (원본 source project 와 기능 동등) 까지를 다룸. v1.0 이후 로드맵:

- **v1.1**: Audit log v2 (모든 도구 호출 + LLM 호출 immutable 로그), 비용 budget alert
- **v1.2**: 다중 모델 라우팅 자동화 (cost-aware routing)
- **v1.3**: 시각화 도구 (mermaid / plotly artifact)
- **v2.0**: Agent2Agent (A2A) protocol — 자회사 에이전트 간 호출

## 본 plan 의 deliverable

v1.0 완성 시 다음을 모두 만족:
- 30 MR 의 기능 동등 ✓
- 27 ADR 의 결정 반영 ✓
- 18개 lessons 의 anti-pattern 모두 회피 ✓
- v1.0 production 배포 가능
- 1000+ 테스트 통과 + coverage ≥ 80% (server), 60% (web)
- README quickstart 3줄로 개발자 onboarding 완료
