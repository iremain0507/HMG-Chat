#!/usr/bin/env bash
# push-and-pr.sh — 현재 브랜치를 게이트 검증 후 origin 에 push 하고 GitHub PR 을 생성/갱신한다.
#
# 사용법:
#   bash scripts/push-and-pr.sh                      # 게이트 통과 시 push + PR
#   BASE=main bash scripts/push-and-pr.sh            # base 브랜치 지정(기본 main)
#   SKIP_GATES=1 bash scripts/push-and-pr.sh         # 게이트 생략(비권장)
#   DRAFT=1 bash scripts/push-and-pr.sh              # draft PR 로 생성
#
# 요건: gh CLI 로그인(`gh auth status`), origin=GitHub 리모트.
# 참고: push 는 사용자 권한으로 실행되어야 한다(루프 가드 훅이 자동화 push 를 차단할 수 있음).

set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

REMOTE="${REMOTE:-origin}"
BASE="${BASE:-main}"
BRANCH="$(git branch --show-current)"

info() { printf '\033[36m▶ %s\033[0m\n' "$*"; }
ok()   { printf '\033[32m✓ %s\033[0m\n' "$*"; }
die()  { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

[ -n "$BRANCH" ] || die "detached HEAD — 브랜치에서 실행하세요."
[ "$BRANCH" != "$BASE" ] || die "현재 브랜치가 base($BASE) 입니다. feature 브랜치에서 실행하세요."
command -v gh >/dev/null || die "gh CLI 미설치 — https://cli.github.com"
gh auth status >/dev/null 2>&1 || die "gh 미인증 — 'gh auth login' 후 다시 실행하세요."

# 워킹트리 clean 확인
if [ -n "$(git status --porcelain)" ]; then
  die "워킹트리에 미커밋 변경이 있습니다. 커밋 후 다시 실행하세요.\n$(git status --short)"
fi

# 1) 게이트 검증
if [ "${SKIP_GATES:-0}" = "1" ]; then
  info "게이트 생략(SKIP_GATES=1)"
else
  info "게이트 검증(scripts/verify-gates.sh)…"
  bash scripts/verify-gates.sh || die "게이트 실패 — 수정 후 재실행하거나 SKIP_GATES=1(비권장)."
  ok "게이트 통과"
fi

# 2) push
AHEAD="$(git rev-list --count "$REMOTE/$BASE..HEAD" 2>/dev/null || echo '?')"
info "push: $BRANCH → $REMOTE ($AHEAD commits ahead of $BASE)"
git push -u "$REMOTE" "$BRANCH"
ok "push 완료"

# 3) PR 생성 또는 갱신
if gh pr view "$BRANCH" --json url >/dev/null 2>&1; then
  URL="$(gh pr view "$BRANCH" --json url -q .url)"
  ok "기존 PR 갱신됨(push 반영): $URL"
  gh pr view "$BRANCH" --json number,title,state,url \
    -q '"  #\(.number) [\(.state)] \(.title)"' || true
  exit 0
fi

TITLE="feat(P22): Open WebUI 파리티 — 미개발/미완료 기능 대규모 구현 (48/51)"

# PR 본문
BODY_FILE="$(mktemp)"
trap 'rm -f "$BODY_FILE"' EXIT
cat > "$BODY_FILE" <<'BODY'
## 개요
Open WebUI 딥리서치 + 코드베이스 감사로 도출한 미개발/미완료 기능(갭 카탈로그 `docs/P22-GAP-CATALOG.md`)을
TDD 자율 루프로 구현. **P22 48/51 passed**(남은 3 = 승인된 WON'T-BUILD). 모든 커밋 `verify-gates` green.

## 주요 기능
- **인증/거버넌스**: 비밀번호 로그인(bcrypt) · LDAP/AD · OIDC SSO · SCIM 2.0 · self-service 계정삭제 · retention 삭제 · 그룹 per-resource grant
- **AI/도구**: 이미지 생성 · web_fetch(#url) · 멀티모델 비교 · RAG 리랭킹 · knowledge_search 통합 · Agent 레지스트리 · Connections(외부 provider, 키 암호화) · OpenAPI 툴서버 · 입력 자동완성 · Redis 런타임상태
- **협업/워크스페이스**: Channels(실시간, SSE) · Notes · Skills 작성 · 대화 복제/가져오기 · i18n(ko/en) · PWA
- **미디어/UX**: STT · TTS · 이미지 썸네일 · 메시지 큐잉 · 문서삭제 UI · connectors 편집 · 알림 SSE · 비용 breakdown

## 계약/스키마
- `packages/interfaces` 편집은 전부 **additive·nullable-first**(계약배치 RFC `docs/rfc/P22-contract-batch.md` 승인 범위).
- migration 0032~0041(전부 nullable-first + 롤백 경로).

## 검증
- `verify-gates` 4-gate(typecheck/lint/test/state) green.
- 실앱 UAT(Claude-in-Chrome): Agent/Connections/Notes/admin 패널 렌더 + Notes write-path DB 실저장 확인.

## 배포 시 필요(LOCAL_ONLY)
- 실 provider 설치: `pnpm add ldapts openid-client ioredis`, E2B 계정
- 실 검증: LDAP 서버·IdP(OIDC/SCIM)·Channels 멀티유저는 스테이징에서
- KEK를 AWS KMS로 전환(현재 env `PROVIDER_KEY_ENCRYPTION_KEY`)

## 제외(WON'T-BUILD, 승인됨)
Python 인앱 플러그인 · Arena/ELO 리더보드 · 음성/영상 통화 모드

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01HDNJRkSxZoVLKNKmzW9iXS
BODY

info "PR 생성: $BRANCH → $BASE"
DRAFT_FLAG=()
[ "${DRAFT:-0}" = "1" ] && DRAFT_FLAG=(--draft)
gh pr create --base "$BASE" --head "$BRANCH" --title "$TITLE" --body-file "$BODY_FILE" "${DRAFT_FLAG[@]}"
ok "PR 생성 완료"
gh pr view "$BRANCH" --json url -q .url
