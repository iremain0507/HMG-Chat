#!/usr/bin/env bash
# feature_list.json 스키마 검증: reward hacking(항목 삭제·필드 변조) 최소 방어선.
set -euo pipefail
jq -e 'type=="array" and length>0 and all(.[];
  (.id|type=="string") and (.desc|type=="string") and
  (.acceptance|type=="string") and (.phase|type=="string") and
  (.passes|type=="boolean") and (.attempts|type=="number"))' feature_list.json >/dev/null
CNT=$(jq 'length' feature_list.json)
if [ -f .ralph/feature_count ]; then
  PREV=$(cat .ralph/feature_count)
  [ "$CNT" -lt "$PREV" ] && { echo "feature_list.json 항목 수 감소: $PREV → $CNT (삭제 금지 위반)"; exit 1; }
fi
echo "$CNT" > .ralph/feature_count
echo "state OK ($CNT items)"
