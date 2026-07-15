# 21-LOOP-LESSONS.md — Loop Engineering Lessons Learned

**목적**: 자율 빌드 루프(Ralph)가 만든 "유닛 테스트는 초록인데 실사용에서 깨지는" 케이스를
반복하지 않기 위한 원인 분석 + 재발 방지 가드. **향후 loop 프롬프트/게이트 설계 시 필독·반영.**

**왜 루프가 놓쳤나 (메타 원인)**: verify-gates 오라클 = typecheck + lint + **유닛 테스트(fake
provider·localhost·fresh token·무프록시 전제)**. 즉 _조립 루트까지의 배선_, _저하 조건_, _실
스트리밍/외부호출_, *참조 무결성*을 검증하는 게이트가 없었다. → 아래 5개를 phase 프롬프트의
"완료 정의"와 게이트에 인코딩할 것.

---

## 재발 방지 원칙 (loop 프롬프트/게이트에 인코딩)

**L1. Unit green ≠ feature works — 마지막 배선(last-mile)까지 검증.**
핸들러/컴포넌트/이벤트가 구현+유닛테스트 통과여도 조립 루트(app.ts)·실 진입점에 미배선이면
실사용 시 없는 기능. → _새 도구/핸들러/이벤트/라우트는 "조립 루트→실 진입점 도달"을 assert하는
통합 테스트 필수_(routes-mounted.test 패턴을 도구/SSE 이벤트로 확장: 레지스트리 등록·실
스트림 방출 확인).
· 사례: deep_research/web_search/code_interpreter 핸들러가 app.ts 미배선(artifact_create만);
tool_progress 이벤트 미구현.

**L2. Happy-path만 테스트 금지 — 저하 조건(degraded)을 exercise.**
fake·localhost·fresh·무프록시 전제로만 테스트하면 실환경에서 깨짐. → _스트리밍/인증/외부호출
기능은 저하-조건 테스트 의무_: 만료 토큰, 비보안(http) 컨텍스트, 프록시 경유, 느린/멈춘 외부호출,
긴 idle 갭, 다중-leg 툴 턴.
· 사례: 만료 401 무응답; http에서 crypto.randomUUID/clipboard 크래시; 프록시 gzip이 SSE 버퍼링;
외부호출 hang; 중간 stop을 종단 오인해 최종답변 미렌더.

**L3. 참조 무결성 — ID로 참조하면 그 엔티티 존재를 보장.**
클라 생성 ID를 그대로 쓰면 대상 행이 없어 FK 위반(의존 write 시점에 뒤늦게 표면화). →
_클라 제공 ID write 경로는 ensure/upsert + FK-의존 경로(아티팩트/업로드/active-run) 통합 테스트._
· 사례: 클라 생성 세션 UUID 미persist → artifacts.session_id FK 위반.

**L4. 환경 결합 금지 — origin/context/proxy 하드코딩·전제 금지.**
localhost/APP_ORIGIN 하드코딩, https 전제, 무압축·무버퍼 프록시 전제 → 외부/역프록시 배포서 깨짐.
→ _리다이렉트·링크는 host-상대; 보안-컨텍스트 API는 폴백; 프록시 버퍼링/압축 가정 금지
(SSE엔 compress off·X-Accel-Buffering·keep-alive)._
· 사례: 인증 302가 APP_ORIGIN(localhost) 절대 리다이렉트 → Tailscale 접속 튕김.

**L5. 조용한 실패 금지 — 근본 원인을 가리지 마라.**
무응답 401·예외 시 종료이벤트 없는 스트림 드롭 → "연결 끊김"으로만 보여 진단 지연·오귀인. →
_모든 async/스트림 경로에 명시적 에러 방출(retryable 포함) + 장시간 작업엔 타임아웃(무한 hang
차단). 침묵 return/catch 금지._
· 사례: 만료 401 침묵; streamSSE catch 부재; deep_research 외부호출 타임아웃 부재.

---

## 이번 세션: 지적 → 근본원인 → 패턴

| 회원 지적                | 근본원인                              | 패턴  |
| ------------------------ | ------------------------------------- | ----- |
| 만료 시 메시지 무응답    | raw fetch 자동 refresh 없음           | L2·L5 |
| Tailscale localhost 튕김 | APP_ORIGIN 하드코딩 302               | L4    |
| 새 채팅 크래시·복사 실패 | secure-context 전용 API(http)         | L2·L4 |
| 토큰이 한 번에 렌더      | Next 프록시 gzip이 SSE 버퍼링         | L2·L4 |
| "도구가 없다" 응답       | 핸들러 미배선(last-mile)              | L1    |
| 답변 안 뜸·칩 멈춤       | 중간 stop(reason=tool_use) 종단 오인  | L2    |
| 진행상황 안 보임         | tool_progress 미구현/격리             | L1    |
| 연결이 끊어졌습니다      | keep-alive·타임아웃·SSE 에러처리 부재 | L2·L5 |
| 아티팩트 FK 위반         | 세션 행 미persist                     | L3    |

---

## 루프 게이트에 추가할 것(구체)

1. **통합 스모크 게이트**: createApp 기반 실HTTP로 (a) 새 도구가 실 SSE 스트림에 tool_use/결과로
   나오는지, (b) 스트림이 stop으로 정상 종단하는지 assert (L1·L5).
2. **저하-조건 테스트 체크리스트**를 phase 프롬프트 "완료 정의"에 포함: 만료토큰/비보안컨텍스트/
   프록시/느린 외부호출/긴 idle/다중-leg (L2).
3. **FK-의존 경로**(아티팩트·업로드) 는 세션 ensure 통합 테스트 없이는 완료 처리 금지 (L3).
4. **금지 목록**: 절대 origin 하드코딩, 보안-컨텍스트 API 무폴백, SSE 압축/무keep-alive,
   침묵 catch, 타임아웃 없는 외부호출 (L4·L5).
