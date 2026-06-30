#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# 개발/배포 토폴로지 규칙 검사 — 커밋 전 자동 실행
#
#   • 개발(dev)  : 맥 미니 로컬(macOS) 에서 진행
#   • 배포(deploy): AWS (ECS/RDS/ElastiCache/S3). 비밀정보는 AWS Secrets Manager —
#                   저장소(git)에는 절대 커밋하지 않는다.
#
# 본 스크립트는 "단일 출처" 다. .githooks/pre-commit 가 호출하며,
# 추후 프로젝트가 pnpm + Husky 로 스캐폴딩되면 .husky/pre-commit 도 이 파일을 호출한다.
#   참고: rebuild_plan/10-DEV-WORKFLOW.md 부록 A, rebuild_plan/04-TECH-STACK.md(인프라/AWS),
#         rebuild_plan/12-OPS-SECURITY.md(Secrets)
#
# 우회(의도된 예외)가 필요하면:  ALLOW_NON_MAC_COMMIT=1 git commit ...
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

FAIL=0
err()  { printf '  \033[31m❌ %s\033[0m\n' "$*" >&2; FAIL=1; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m⚠️  %s\033[0m\n' "$*" >&2; }

echo "▶ 개발/배포 규칙 검사  (dev = 맥 미니 로컬,  deploy = AWS)"

# ── 규칙 1 · 개발은 맥 미니 로컬(macOS) 에서 ──────────────────────────────────
OS="$(uname -s)"
if [ "$OS" != "Darwin" ]; then
  if [ "${ALLOW_NON_MAC_COMMIT:-0}" = "1" ]; then
    warn "현재 OS=$OS (macOS 아님) — ALLOW_NON_MAC_COMMIT=1 로 우회함"
  else
    err "개발/커밋은 맥 미니 로컬(macOS) 에서 진행해야 합니다 (현재: $OS)."
    err "  의도된 예외라면: ALLOW_NON_MAC_COMMIT=1 git commit ..."
  fi
else
  ok "로컬 개발 환경(macOS) 확인"
fi

# ── 스테이징된 파일 목록 (추가/수정/복사된 것만) ─────────────────────────────
STAGED="$(git diff --cached --name-only --diff-filter=ACM || true)"

# ── 규칙 2 · 비밀/환경설정 파일 커밋 금지 (AWS Secrets Manager 사용) ──────────
#   배포는 AWS 이지만 자격증명/시크릿은 저장소가 아니라 Secrets Manager 에 둔다.
SECRET_FILE_RE='(^|/)\.env($|\.)|\.pem$|\.p12$|\.pfx$|(^|/)id_rsa($|\.)|(^|/)\.aws/credentials$|\.tfstate$|\.tfvars$|\.keystore$|\.jks$'
SECRET_FILE_ALLOW='\.(example|sample|template|dist)$'
if [ -n "$STAGED" ]; then
  BAD_FILES="$(echo "$STAGED" | grep -Ei "$SECRET_FILE_RE" | grep -Eiv "$SECRET_FILE_ALLOW" || true)"
  if [ -n "$BAD_FILES" ]; then
    err "비밀/환경설정 파일이 스테이징됨 — 저장소 커밋 금지 (AWS Secrets Manager 사용):"
    echo "$BAD_FILES" | sed 's/^/        - /' >&2
    err "  해제: git restore --staged <파일>   (그리고 .gitignore 에 추가 권장)"
  fi
fi

# ── 규칙 3 · 코드/설정 본문 내 자격증명 문자열 금지 ───────────────────────────
if [ -n "$STAGED" ]; then
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    BLOB="$(git show ":$f" 2>/dev/null || true)"
    [ -n "$BLOB" ] || continue
    if printf '%s' "$BLOB" | grep -nE 'AKIA[0-9A-Z]{16}' >/dev/null 2>&1; then
      err "AWS Access Key ID 패턴 발견: $f"
    fi
    # 실제 값처럼 보이는 20자 이상 토큰이 뒤따를 때만 (문서의 설명용 언급은 통과)
    if printf '%s' "$BLOB" | grep -niE 'aws_secret_access_key[[:space:]]*[:=].{0,3}[A-Za-z0-9/+=]{20,}' >/dev/null 2>&1; then
      err "aws_secret_access_key 값 발견: $f"
    fi
    if printf '%s' "$BLOB" | grep -nE 'BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY' >/dev/null 2>&1; then
      err "PRIVATE KEY 블록 발견: $f"
    fi
  done <<< "$STAGED"
fi

# ── (옵션) gitleaks — 설치되어 있으면 추가 스캔 ──────────────────────────────
if command -v gitleaks >/dev/null 2>&1; then
  if gitleaks protect --staged --redact --no-banner >/dev/null 2>&1; then
    ok "gitleaks 통과"
  else
    err "gitleaks 가 비밀정보 가능성을 감지했습니다 — 검토 후 제거하세요."
  fi
else
  warn "gitleaks 미설치 — 권장: brew install gitleaks"
fi

# ── 결과 ─────────────────────────────────────────────────────────────────────
if [ "$FAIL" -ne 0 ]; then
  echo "" >&2
  printf '\033[31m✋ 커밋 차단 — 위 규칙 위반을 해결한 뒤 다시 커밋하세요.\033[0m\n' >&2
  exit 1
fi
echo "✓ 모든 개발/배포 규칙 통과"
exit 0
