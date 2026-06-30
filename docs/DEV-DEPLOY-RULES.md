# 개발/배포 규칙 (dev = 맥 미니 로컬, deploy = AWS)

이 저장소의 개발과 배포는 다음 토폴로지를 따른다. 이 규칙은 **커밋 전 git hook 으로 자동 강제**된다.

## 원칙

| 단계              | 위치                                                 | 핵심                                                                                                                                                                                                          |
| ----------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **개발 (dev)**    | 맥 미니 **로컬 (macOS)**                             | 코딩·테스트·커밋은 로컬 Mac 에서. AWS RDS/Redis 가 필요하면 SSM 터널(`pnpm tunnel`)로 접근하되, 미설정 시 InMemory fallback 으로 로컬 개발 ([10-DEV-WORKFLOW.md](../rebuild_plan/10-DEV-WORKFLOW.md)).        |
| **배포 (deploy)** | **AWS** (ECS Fargate / RDS / ElastiCache / S3 / ALB) | 배포는 CI 가 수행. 비밀정보는 **AWS Secrets Manager** 에만 저장 — 저장소에는 절대 커밋하지 않음 ([04-TECH-STACK.md](../rebuild_plan/04-TECH-STACK.md), [11-DEPLOYMENT.md](../rebuild_plan/11-DEPLOYMENT.md)). |

## 커밋 전 자동 검사 (git hook)

`pre-commit` 훅이 매 커밋마다 [scripts/check-dev-deploy-rules.sh](../scripts/check-dev-deploy-rules.sh) 를 실행한다.

1. **맥 미니 로컬 개발** — 커밋 환경이 macOS(Darwin) 인지 확인. 아니면 차단.
   - 의도된 예외: `ALLOW_NON_MAC_COMMIT=1 git commit ...`
2. **비밀 파일 차단** — `.env`(예: `.env.local`), `*.pem`, `*.pfx`, `id_rsa`, `.aws/credentials`, `*.tfstate`, `*.tfvars` 등이 스테이징되면 차단. (`*.env.example` 등 템플릿은 허용)
3. **자격증명 문자열 차단** — 스테이징된 파일 본문에서 `AKIA…`(AWS Access Key), `aws_secret_access_key=…`, `PRIVATE KEY` 블록 발견 시 차단.
4. **gitleaks** — 설치되어 있으면 추가 비밀 스캔(`gitleaks protect --staged`).

## 활성화 (클론 직후 1회)

```bash
bash scripts/setup-hooks.sh        # git config core.hooksPath .githooks
```

> 추후 프로젝트가 pnpm + Husky 로 스캐폴딩되면, 계획([10-DEV-WORKFLOW.md](../rebuild_plan/10-DEV-WORKFLOW.md) 부록 A)의 `.husky/pre-commit`(작성자 이메일 도메인·sprint key·gitleaks)에 이 규칙 스크립트를 흡수시켜 한 곳에서 관리한다.
