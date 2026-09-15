# Build Progress

## 2026-09-13 — Foundation 완료

### 구축

- Next.js, React와 TypeScript 기반 단일 애플리케이션
- Tailwind CSS 기반 기본 화면
- 환경변수 runtime validation
- lint, typecheck, unit test, format, production build 명령
- Playwright Chromium E2E 기반
- domain, feature, server와 Supabase migration/seed 경계
- loading, error와 not-found 기본 상태

### 검증

- `npm run verify` 통과
- unit test 2개 통과
- production build 통과
- Chromium E2E 1개 통과
- 설치 의존성 audit 취약점 0건

### 환경 검토

- C: 용량 부족으로 실패했던 npm 캐시는 삭제 완료
- 임시 `.npm-cache`, `.tmp`, `.playwright-browsers` 경로와 `cross-env` 제거 완료
- Playwright 표준 사용자 캐시 사용
- E2E 서버 종료에는 샌드박스 밖의 테스트 프로세스 정리 권한 필요
- Docker, Supabase CLI와 로컬 PostgreSQL은 현재 환경에 없음

### 다음 단계

Memory Foundation과 합성 Golden Dataset. PostgreSQL migration의 실제 실행 검증을 위해 Supabase 개발 프로젝트 연결 또는 로컬 PostgreSQL 실행 환경이 필요하다.

## 2026-09-14 — AI Task Model Routing 확정

### 결정

- 전달받은 `Task별_모델스택 및 비용_GPT.pdf` 전체 10페이지와 최종 권장 조합 검토
- 원본 PDF를 변경 없이 `docs/inputs`에 보관하고 SHA-256 일치 확인
- OCR, STT, 구조화, embedding, reranking, Main·Quality·Complex Agent의 primary API 확정
- 최고급 모델 상시 호출을 금지하고 task 기반 escalation router 채택
- OpenAI 모델 ID를 공식 OpenAI 문서에서 교차 확인

### 구축

- `docs/decisions/0001-ai-task-model-routing.md` 추가
- task별 기본 모델과 fallback·benchmark route를 코드로 정의
- 단일 `AI_PROVIDER` 설정을 task별 Provider credential과 model 설정으로 교체
- 실제 유료 호출 없이 검증할 수 있도록 기본 `AI_ROUTING_MODE=mock` 유지

### 검증

- `npm run verify` 통과
- 단위 테스트 6개 통과
- production build 통과

### 남은 작업

- 각 기능 phase에서 필요한 Provider SDK와 adapter 구현
- 실제 API credential 연결과 계정별 모델 접근 확인
- Golden Dataset 기반 Main·Quality Agent benchmark 및 escalation 기준 측정

## 2026-09-15 — Phase 2 Memory Foundation 완료

### 구축

- Supabase CLI와 `postgres.js` 기반 migration, seed, 연결 및 무결성 검증 명령
- Workspace, Person, Organization, Affiliation, Event, Interaction, Topic, Memory, Action 도메인 스키마
- Capture, Source Asset, Provenance, Query, Evidence, Feedback, AI Run 경계
- public table 20개 RLS와 Workspace 복합 외래키 격리
- PostgreSQL vector 기반 `memory_documents` 파생 projection과 재생성 함수
- 실제 개인정보가 없는 14명 규모 합성 Golden Dataset
- 동명이인, 유사 회사명, 반복 Interaction, 미완료 약속, Draft 추론 케이스
- DB를 직접 읽는 Person 목록과 시간순 Context·Evidence Profile

### 검증

- 원격 Supabase migration과 seed 적용 성공
- `npm run db:verify` 통과: 인물 14, 조직 7, Interaction 18, Memory 20, Action 10, 파생 문서 14
- 파생 문서 삭제·재생성 및 Workspace 보존 외래키 동작 확인
- `npm run verify` 통과: unit test 7개 및 production build
- `/people`와 동명이인 Person Profile Chromium E2E 2개 통과

### 다음 단계

Phase 3 Seeded Recall Vertical Slice. 합성 Query와 기대 Evidence를 기준으로 구조화 검색부터 구현하고 semantic retrieval과 AI answer generation은 adapter 경계를 따라 순차 연결한다.

## 2026-09-15 — Phase 3 Seeded Recall 완료

### 구축

- 한국어 Query 정규화와 사람·행사·주제·장소·시간·소속·상호작용·행동 intent 파싱
- 명시적인 reference time을 사용하는 상대 월 범위 파싱
- 구조화 term matching과 96차원 deterministic local semantic feature hashing을 결합한 Recall ranking
- 확정된 Memory·Interaction·Action만 사용하는 검색 corpus와 재생성 가능한 Person projection
- Evidence로 제한된 응답, 결과 없음과 동명이인 ambiguity 상태
- 저장된 Action과 자동 실행하지 않는 AI 제안의 분리
- `POST /api/recall`, `/recall` 검색·결과·근거 UI
- Golden Query case와 Query·AI Run·Evidence snapshot 저장 schema
- action, event, identity ambiguity, interaction, organization, place, time, topic의 8개 Golden Query

### 검증

- `npm run eval:recall`: Golden Query 8/8 통과
- `npm run db:verify`: public table 21개 RLS, Recall 결과 9건, Evidence snapshot 35건 확인
- Draft Memory의 검색 projection 유출 0건
- `npm run lint`, `npm run typecheck` 통과
- Vitest 5개 파일, 단위 테스트 11개 통과
- Next.js production build 통과
- Chromium E2E 4개 통과: 기존 Profile 회귀, Context Recall, 근거·Action 구분, 동명이인 ambiguity
- 설치 의존성 audit 취약점 0건

### 다음 단계

Phase 4 Text Capture to Memory. 텍스트 입력을 검토 가능한 Draft로 구조화하고, 사용자 확인 후 transaction으로 Memory를 확정하여 같은 Recall 경로에 즉시 반영한다. 실제 유료 AI Provider 연결은 해당 adapter 구현 시 credential과 공식 endpoint를 확인한 뒤 활성화한다.

## 2026-09-15 — Phase 3.5 Foundation Hardening 완료

### 구축

- `capture-draft-v1` Zod schema와 허용 상태 전이 domain contract
- DB Capture 상태 전이 trigger, `commit_result`, committed entity 참조
- `model_draft`와 사용자 수정 `structured_draft` 분리 기반
- Capture별 AI Run attempt와 retry 연결
- 환경 model override와 task별 credential을 실제로 해석하는 mock/live AI runtime
- 공통 timeout, retry, fallback, schema validation과 attempt telemetry
- Voyage/OpenAI fallback 공통 `vector(1024)` embedding 계약
- `pending`, `processing`, `ready`, `failed` embedding 상태
- content hash 기반 Person 단위 projection upsert와 projection v3
- hash 충돌만으로 Recall 후보가 생기지 않는 보수적 의미 신호 조건
- 기억에 없는 주제를 검증하는 `no_result` Golden Query

### 검증

- 단위 테스트 8개 파일, 23개 통과
- Golden Query 9/9 통과
- DB schema 21개 table RLS 유지
- `vector(1024)`, Capture guard, commit result와 Person projection 함수 확인
- Person projection 14개, Draft Memory 유출 0건
- 변경 없는 projection rebuild가 row를 재작성하지 않음

### 적용 과정 메모

- 첫 migration 시 기존 합성 `committed` Capture가 단일 Person 참조를 갖지 않아 rollback됨
- 기존 import Capture를 삭제하지 않고 typed `legacy_committed` 결과로 보존하도록 계약을 일반화
- 기존 자동 생성 embedding constraint 이름 충돌도 transaction rollback 후 명시적인 제약 교체로 해결
- 두 실패 모두 transaction 안에서 발생하여 부분 schema나 데이터 손상 없음

### 다음 단계

Phase 4 Text Capture to Memory. API key 없이 mock 구조화를 사용해 Draft → Review → Identity 선택 → atomic Commit → Profile/Recall 반영 수직 슬라이스를 완성한다.
