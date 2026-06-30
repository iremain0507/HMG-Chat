# 13 · Glossary — 용어 정의 & Open Questions

## 약어

| 약어 | 풀이 |
|---|---|
| ADR | Architectural Decision Record |
| ALB | AWS Application Load Balancer |
| AZ | Availability Zone |
| BM25 | Best Match 25 (full-text 랭킹 알고리즘) |
| CMS | Content Management System (여기선 사내 콘텐츠 시스템) |
| CSP | Content Security Policy |
| DAG | Directed Acyclic Graph |
| ECS | AWS Elastic Container Service |
| ECR | AWS Elastic Container Registry |
| HITL | Human-in-the-Loop (사용자 승인 단계) |
| IAM | AWS Identity and Access Management |
| LLM | Large Language Model |
| MCP | Model Context Protocol (Anthropic 표준) |
| OIDC | OpenID Connect |
| ORM | Object-Relational Mapper |
| PII | Personally Identifiable Information |
| RAG | Retrieval-Augmented Generation |
| RBAC | Role-Based Access Control |
| RLS | Row-Level Security (PostgreSQL) |
| RPO | Recovery Point Objective |
| RRF | Reciprocal Rank Fusion (검색 결과 결합) |
| RTO | Recovery Time Objective |
| SAML | Security Assertion Markup Language |
| SaaS | Software as a Service |
| SBOM | Software Bill Of Materials |
| SLA | Service Level Agreement |
| SLO | Service Level Objective |
| SRE | Site Reliability Engineering |
| SSE | Server-Sent Events |
| SSO | Single Sign-On |
| SSM | AWS Systems Manager (특히 SSM tunnel) |
| SSRF | Server-Side Request Forgery |
| TDD | Test-Driven Development |
| VPC | Virtual Private Cloud |

## 프로젝트 고유 용어

| 용어 | 정의 |
|---|---|
| **Artifact** | 모델이 생성한 파일 (PPTX/PDF/Markdown/HTML 등). DB 또는 S3 에 저장, 세션과 약 결합 (nullable). |
| **Artifact Share** | Artifact 의 익명 공유 토큰 (122-bit UUID v4), 만료/revoke 가능. |
| **Choice (도구)** | 사용자에게 다중선택지 제시하는 in-conversation 메커니즘. |
| **Citation Helper** | knowledge_search 결과의 `[1]`, `[2]` 번호와 source 매칭 + Reference 섹션 생성. |
| **Context Compactor** | 긴 대화 history 를 LLM 으로 요약해 토큰 절감. |
| **{{BRAND_PPTX_SKILL_NAME}}** | {{ORG_NAME_KO}} 브랜드 PPT 양식 자동 생성 스킬. PptxGenJS 기반. |
| **E2B** | 외부 sandbox 런타임 (서버리스 컨테이너 API). |
| **HITL** | 도구가 실행 전에 사용자 승인 받는 단계. |
| **Knowledge Base** | Project 의 문서 (PDF/PPTX/DOCX/XLSX) 를 청크 + 임베딩한 검색 가능한 저장소. |
| **Memory Extractor** | 메시지에서 사용자 메모리를 자동 추출하는 백그라운드 잡. |
| **Memory Retriever** | 세션 시작 시 user_memories 에서 관련 메모리를 prompt 에 주입. |
| **Orchestrator** | 메시지 처리 메인 루프 (prompt build → LLM → tool → result → loop). |
| **Permission Tier** | System / Project / User / Tool 의 4계층 권한 등급. |
| **Policy Engine** | 도구별 허용/HITL/거부 정책을 org/project/user 단위로 평가. |
| **Prompt Builder** | 4계층 권한을 조합해 최종 prompt 생성. |
| **Reference (Reference 섹션)** | citation 의 출처 목록 (논문 스타일). |
| **RLS Context** | request 마다 SET LOCAL `app.user_id`, `app.org_id` 로 PostgreSQL RLS 활성화. |
| **Sandbox Transport** | sandbox interface — E2B/Mock 구현 분리. |
| **Skill** | SKILL.md frontmatter + 스크립트로 정의된 사용자 기능. 모델이 자동 활성화. |
| **Skill Marketplace** | 사내에 등록된 스킬 목록 UI (v1.0 에서는 단순 list). |
| **Spike Branch** | 시간 박스 탐색용 브랜치 (`spike/*`), main 머지 금지. |
| **Sprint Key** | `v<X.Y>-S<NN>-<kebab-name>` 형식의 스프린트 식별자. |
| **Warm Pool** | E2B sandbox 사전 할당 풀 (지연 최소화). |

## 외부 서비스

| 서비스 | 역할 |
|---|---|
| **Anthropic Claude** | Primary LLM (Opus, Sonnet, Haiku). tool use + prompt caching. |
| **OpenAI** | Fallback LLM (GPT-4o, o-series). |
| **Google Gemini** | 이미지 캡션 (PDF/PPTX 의 이미지 → 텍스트). |
| **Voyage AI** | 한국어 임베딩 (voyage-3 / voyage-multilingual-2). |
| **Tavily** | 웹 검색 API. citation 친화. |
| **E2B** | 코드 실행 sandbox API. |
| **AWS Secrets Manager** | 비밀 관리. |
| **AWS Bedrock** | (옵션) AWS 내 LLM access. |

## 사내 시스템 (예시 — 실제는 인터뷰 필요)

| 시스템 | 역할 |
|---|---|
| **{{ORG_NAME}} IdP** | 사내 SSO 제공 (OIDC/SAML). v1.1 통합. |
| **{{ORG_NAME}} GitLab** | `{{GITLAB_HOST}}` — 코드 저장소. |
| **{{ORG_NAME}} Slack** | `#{{PROJECT_SLUG}}-*` 채널, 알림 수신. |
| **사내 BI** | 사용 통계 시각화 (v2+). |

---

## Open Questions (인터뷰 필요)

본 plan 의 범위 밖이지만, 실제 v1.0 빌드 전에 답을 받아야 하는 항목:

### 비즈니스 / 정책
1. **계정 정책**: 사번 ↔ email 매핑이 IdP 어디에 있나? 신규 사용자 자동 생성 vs 사전 등록?
2. **데이터 정책**: 메시지/메모리의 사내 보관 의무 기간? 법무 review 받았나?
3. **LLM provider 정책**: Anthropic + OpenAI 모두 가능? 한 곳만 허용?
4. **비용 책임**: org 단위 chargeback? 중앙 budget?
5. **법적 책임**: 모델 응답에 대한 disclaimer?

### 기술 / 인프라
6. **AWS account 구조**: 단일 account / 환경별 분리?
7. **VPC peering**: 사내 시스템과 어떤 네트워크 통합?
8. **사내 SSO**: OIDC? SAML? endpoint?
9. **이메일 발송**: 사내 SMTP gateway vs SES?
10. **로그 보관**: CloudWatch 만? SIEM 연동?
11. **사내 DNS**: 어떤 zone? TLS 인증서?
12. **AI 가드레일**: prompt injection 방지 정책? content filter?

### 운영
13. **on-call 정책**: 24/7? 영업시간만? 회사 정책에 맞는 응답 시간?
14. **인시던트 escalation**: 누구에게? Slack? 전화?
15. **SLA**: 사용자에게 약속하는 가용성? 99% / 99.5% / 99.9%?
16. **Beta program**: 누가 가장 먼저 사용? 피드백 채널?
17. **사내 PR/HR 의 공지 정책**: launch 시점에 어떻게 알리나?

### 제품
18. **MVP 범위 확정**: v1.0 에서 정말 필요한 기능 vs v1.1+ 으로 미룰 것?
19. **MCP 정책**: 사내 MCP 서버를 누가 운영? 각 자회사? 중앙?
20. **권한 위임**: 부서장이 자기 팀의 도구 정책을 직접 관리하나?

각 질문은 별도 미팅에서 답을 받고, 답이 결정되면 해당 plan 문서 (특히 02, 11, 12) 를 업데이트.

---

## 본 plan 외 참고 자료

- 원본 source project 의 `docs/`, `CLAUDE.md`, `AGENTS.md`
- analysis/REPORT.md, REPORT_SPRINTS.md, REPORT_DECISIONS.md, CHANGELOG.md
- Anthropic Tool Use 가이드, MCP 스펙
- AWS Well-Architected Framework

---

생성: 2026-05-13 (v2 rebuild plan 의 일부)
