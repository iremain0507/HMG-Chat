---
name: implement-sprint-task-tdd
description: 스프린트 태스크 하나를 TDD로 구현할 때 사용. RED 증거→최소 GREEN→게이트→커밋 절차를 강제한다.
---

# 스프린트 태스크 TDD 절차

1. feature_list.json 항목의 acceptance와 team 경로 확인. attempts +1 저장.
2. rebuild_plan/09-TDD-GUIDE.md 규칙대로 실패하는 테스트 먼저 작성하고 실패를 실제 실행으로 확인 (RED 증거).
3. rebuild_plan/14-INTERFACES.md의 타입만 사용해 담당 경로 안에서 최소 구현.
4. `bash scripts/verify-gates.sh` exit 0 확인.
5. 해당 항목 "passes"만 true로 변경.
6. PROGRESS.md 갱신 + `git add -A && git commit -m "feat: <task>"`.
