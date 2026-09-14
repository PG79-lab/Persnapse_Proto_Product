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
