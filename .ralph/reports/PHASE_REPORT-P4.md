# PHASE REPORT — P4 (Knowledge / RAG)

검증 방식: 자동 phase-verifier 결과 미산출(빈 리포트, jq/제어문자 이슈) → integration owner 직접 실행검증.

## acceptance별 판정 (직접 실행 근거)

| task                 | 판정 | 근거                                                                                                                                  |
| -------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------- |
| P4-T1-01/02          | ✅   | 0005 project_documents/document_chunks, 0014 uploads/ephemeral_chunks + RLS(rls-uploads 7, rls-project-documents-chunks 7 통합테스트) |
| P4-T3-01 (uploads)   | ✅   | routes/uploads.ts + ObjectStore(dev 로컬FS) 주입 + app.ts 마운트 + uploads-composition 4 통합테스트                                   |
| P4-T3-07 (documents) | ✅   | routes/documents.ts CRUD + documents-composition 통합테스트                                                                           |
| P4-T3-02 (parsers)   | ✅   | parser-pipeline + pdf/docx/xlsx/pptx 파서(parser-types 계약, TS네이티브 dev-stub) 단위테스트                                          |
| P4-T3-08 (indexing)  | ✅   | POST /documents multipart→파싱→청킹→embedding dev-stub→document_chunks. documents-composition 실HTTP 통합테스트                       |
| P4-T3-03 (chunker)   | ✅   | chunker.ts 오버랩 청킹 단위테스트                                                                                                     |
| P4-T3-04 (embedding) | ✅   | embedding-provider dev-stub + usage tracking                                                                                          |
| P4-T3-05 (search)    | ✅   | search-service hybridSearch(vector+bm25+RRF) 단위테스트                                                                               |
| P4-T3-06 (citation)  | ✅   | citation-helper + knowledge-search 도구                                                                                               |
| P4-T6-01 (web)       | ✅   | projects/[id] 문서 업로드 UI + indexStatus, Hyundai WIA CI 토큰                                                                       |

## 게이트 (직접 실행)

- `bash scripts/verify-gates.sh` → exit 0 (typecheck/lint/test/state). **route-mount 가드 포함** — uploads/documents 마운트 확인.
- `test:integration` → **11 files / 58 tests 통과**(globalSetup DB 리셋+재마이그레이션).

## 아키텍처 결정 (integration owner, 사용자 승인 2026-07-13)

- 외부 서비스 LOCAL_ONLY dev-stub: 임베딩=결정론 stub(실 Voyage 대체), 업로드저장=로컬FS ObjectStore(실 S3 대체),
  파서=TS 네이티브(mammoth/xlsx/pdf-parse/jszip; 실 converter-worker/Gemini VLM 은 배포 시 교체).
- parser-types.ts 를 server-internal 계약으로 정의(packages/interfaces P0.5 frozen 회피).

## 격리

- P0-T1-01 (AWS) 만.

## 다음 phase 리스크 (P5 Artifacts)

- P5 에 **converter-worker(Python+LibreOffice)** 와 ArtifactStore(inline/s3) 포함 — S3/Python 은 LOCAL_ONLY 라
  P4 와 동일하게 dev-stub(inline ArtifactStore, converter-worker 배포 시) 필요할 수 있음. 진행 중 판단.

PHASE_VERDICT: PASS
