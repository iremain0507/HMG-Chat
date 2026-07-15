#!/usr/bin/env bash
# AWS SSM 터널 (RDS + Redis) — rebuild_plan/10-DEV-WORKFLOW.md 부록 C 단일 출처.
# 사전 조건: 11-DEPLOYMENT § 부록 E (setup-infra.sh) 가 만든 bastion EC2 + SSM 파라미터
# (/wchat/${ENV}/bastion/instance-id, /wchat/${ENV}/rds/host, /wchat/${ENV}/redis/host) 필요.
# project.config.yaml: aws.account_*=LOCAL_ONLY_*_PENDING (미프로비저닝) — 현재는 실행 불가,
# Phase 0 default 는 docker-compose.local.yml (scenario B). 프로비저닝 후 scenario A 로 전환.
set -euo pipefail

ENV="${1:-dev}"
PROFILE="${AWS_PROFILE:-wchat-${ENV}}"

# RDS 터널 (5432 → localhost:15432)
RDS_HOST=$(aws ssm get-parameter --profile "$PROFILE" \
  --name "/wchat/${ENV}/rds/host" --query 'Parameter.Value' --output text)
RDS_BASTION=$(aws ssm get-parameter --profile "$PROFILE" \
  --name "/wchat/${ENV}/bastion/instance-id" --query 'Parameter.Value' --output text)

aws ssm start-session --profile "$PROFILE" \
  --target "$RDS_BASTION" \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters "{\"host\":[\"$RDS_HOST\"],\"portNumber\":[\"5432\"],\"localPortNumber\":[\"15432\"]}" &

# Redis 터널 (6379 → localhost:16379)
REDIS_HOST=$(aws ssm get-parameter --profile "$PROFILE" \
  --name "/wchat/${ENV}/redis/host" --query 'Parameter.Value' --output text)

aws ssm start-session --profile "$PROFILE" \
  --target "$RDS_BASTION" \
  --document-name AWS-StartPortForwardingSessionToRemoteHost \
  --parameters "{\"host\":[\"$REDIS_HOST\"],\"portNumber\":[\"6379\"],\"localPortNumber\":[\"16379\"]}" &

trap 'kill 0' EXIT
echo "✓ tunnel: postgres@localhost:15432, redis@localhost:16379 (Ctrl+C to stop)"
wait
