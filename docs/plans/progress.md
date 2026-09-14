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
