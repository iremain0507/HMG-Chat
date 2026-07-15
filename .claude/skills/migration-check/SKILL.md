---
name: migration-check
description: DB 마이그레이션 SQL 추가·수정 시 사용. 순서 충돌·nullable-first·롤백 경로를 검증한다.
---

# 마이그레이션 검증 절차

1. rebuild_plan의 데이터 모델 문서(예: 06-DATA-MODEL.md)를 읽는다.
2. 새 마이그레이션 번호가 최대 번호+1인지, 기존 스키마와 충돌 없는지, nullable-first인지 확인.
3. 롤백 경로가 없으면 구현하지 말고 finding으로 보고.
