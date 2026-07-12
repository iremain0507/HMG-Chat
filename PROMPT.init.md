# INITIALIZER PROMPT (최초 1회)

코드를 구현하지 말고 다음만 수행하라.

1. rebuild_plan/08-SPRINT-PLAN.md를 읽고 전 스프린트 태스크를 한 반복 크기로 세분화해 feature_list.json 생성.
   형식: [{"id":"P0-T1-01","desc":"...","acceptance":"...","phase":"P0","team":"T1","passes":false,"attempts":0}, ...]
   - acceptance는 명세 원문에서 추출한 관찰 가능한 문장으로. 명세에 없는 business logic 창작 금지.
   - phase는 P0, P0.5, P1 ... P9. P0.5(Contract Bootstrap)는 hard human gate — desc에
     "[HUMAN GATE] integration owner 단일 PR" 명시.
   - team은 rebuild_plan/07-AGENT-TEAMS.md의 T1~T6 경로 소유권에 맞게 배정.
2. `.ralph/current_phase`에 "P0" 기록.
3. PROGRESS.md에 "# Progress log" 헤더 + 초기화 1줄.
4. `git add -A && git commit -m "chore: initialize loop state"`.
5. phase별 항목 수 요약 출력 후 종료.
   주의: feature_list.json은 이후 "passes"/"attempts" 값 변경만 허용된다.
