# P22 브라우저 검증 부채 (Tier2/Tier3 ★needsBrowser)

기능(server+web+RTL) 은 green 커밋됨. 아래 항목은 (B) Playwright /preview 스펙 및/또는
(C) 실앱 Claude-in-Chrome UAT 를 **계약게이트 도달 후 스택 기동 일괄 패스**에서 완료한다.
(A) RTL 단위는 커밋에 포함. 근거: 실앱/admin 흐름은 루프 headless 에서 구동 불가(L1 정직 원칙).

| task                       | (A)RTL | (B)Playwright/preview  | (C)실앱 UAT | 비고                                  |
| -------------------------- | ------ | ---------------------- | ----------- | ------------------------------------- |
| P22-T1-07 groups grant     | ✅     | ✅ group-grants.pw.ts  | ⏳          | admin 그룹 grant 토글 실반영          |
| P22-T1-08 image-generation | ✅     | ⏳                     | ⏳          | 채팅 내 이미지 생성 + admin 설정      |
| P22-T6-01 session-clone    | ✅     | ✅ session-clone.pw.ts | ⏳          | 컨텍스트메뉴 복제→목록 최상단 prepend |
| P22-T6-05 message-queue    | ✅     | ✅ message-queue.pw.ts | ⏳          | 응답 생성 중 메시지 큐잉              |
