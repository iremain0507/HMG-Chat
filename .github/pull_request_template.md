## Context (배경)

> 왜 이 변경이 필요한가? 어떤 문제를 해결하나? (3~5줄)

## Decision (결정)

> 무엇을 어떻게 했는가? 핵심 선택지와 이유. (대안도 짧게)

## Validation (검증)

> 어떤 테스트가 추가됐나? 어떻게 검증했나?

- [ ] Unit test
- [ ] Integration test
- [ ] Manual test (스크린샷)

## Migration (마이그레이션, 해당 시)

> DB 마이그레이션 / breaking change / 데이터 백필 / 배포 순서

## Notes (참고)

> 후속 작업, 알려진 이슈, related ADR

## Self-review Checklist

- [ ] 새 production 코드에 테스트 추가
- [ ] 새 컬럼은 nullable (또는 NOT NULL 이유 명시)
- [ ] AbortSignal 처리 (외부 호출 시)
- [ ] 로그 카테고리/레벨 명시
- [ ] 도메인 외 import 없음
- [ ] Secrets 노출 없음 (비밀정보는 AWS Secrets Manager, 저장소 커밋 금지)
- [ ] Breaking change 없거나 명시
- [ ] 변경된 인터페이스 문서 업데이트
