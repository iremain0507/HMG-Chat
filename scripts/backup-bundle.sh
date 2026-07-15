#!/usr/bin/env bash
# backup-bundle.sh — WChat 저장소 전체 히스토리를 git bundle 로 저장소와 분리된 위치에 스냅샷.
#   목적: LOCAL_ONLY 자율 루프의 코드 보존(원격 push 없이 전체 복원 가능). 루프와 분리된 "신뢰된 보존" 단계.
#   복원:  git clone <bundle> <dir>   또는   기존 repo 에서  git fetch <bundle> 'refs/*:refs/backup/*'
#   위치:  $BACKUP_DIR (기본 ~/wchat-backups). ⚠️ 진짜 decoupled(디스크 장애 대비) 하려면
#          BACKUP_DIR 를 iCloud/Dropbox/Google Drive 동기폴더 또는 외장/NAS 마운트로 지정할 것.
#   보관:  최신 $KEEP 개만 유지(rotate).
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && git rev-parse --show-toplevel)"
BACKUP_DIR="${BACKUP_DIR:-$HOME/wchat-backups}"
KEEP="${KEEP:-10}"

mkdir -p "$BACKUP_DIR"
TS="$(date +%Y%m%d-%H%M%S)"
DEST="$BACKUP_DIR/wchat-$TS.bundle"

git -C "$REPO" bundle create "$DEST" --all >/dev/null 2>&1
if git -C "$REPO" bundle verify "$DEST" >/dev/null 2>&1; then
  cp -f "$DEST" "$BACKUP_DIR/wchat-latest.bundle"
  # rotate — 최신 KEEP 개(latest 제외)만 남기고 삭제
  ls -1t "$BACKUP_DIR"/wchat-2*.bundle 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r old; do rm -f "$old"; done
  COMMITS="$(git -C "$REPO" rev-list --count HEAD)"
  SIZE="$(du -h "$DEST" | cut -f1)"
  echo "$(date '+%F %T') ✓ backup $DEST — ${COMMITS} commits, ${SIZE} → $BACKUP_DIR"
else
  echo "$(date '+%F %T') ✗ bundle 검증 실패, 삭제: $DEST" >&2
  rm -f "$DEST"
  exit 1
fi
