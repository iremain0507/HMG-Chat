---
name: skill-name
version: 0.1.0
description: 이 스킬이 무엇을 하는지 20자 이상으로 설명합니다. LLM system prompt 에 그대로 주입됩니다.
triggers: 트리거 키워드1, 트리거 키워드2
entryPoint: skills/skill-name/scripts/build.py
permissions: user
scope: global
---

# skill-name

이 스킬이 활성화되면 다음 turn 의 system prompt 에 이 본문이 추가됩니다.
LLM 이 따라야 할 절차를 여기에 단계별로 작성하세요.

## 사용 시점

- 어떤 사용자 요청에 이 스킬을 활성화해야 하는지 설명합니다 (`triggers` 키워드와 연결).

## 절차

1. ...
2. ...

## 참고

- 실행 스크립트: `scripts/` (bash tool 을 통해 sandbox 에서 실행)
- 첨부 자산: `assets/`
