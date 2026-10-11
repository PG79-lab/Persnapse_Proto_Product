# Persnapse MVP

> **처음 읽기:** [제품·시스템 핵심 요약](docs/PROJECT_BRIEF.md) — 현재 범위, 기술 인프라, 검증 경계와 다음 작업.

> 최신 작업: [사용자 과업 루프 UX 개선·검증](docs/operations/ux-task-loop-sprint-2026-10-10.md). [프론트·백엔드 결합 현황](docs/operations/workspace-integration-2026-10-08.md)은 통합 당시의 기록으로 보존합니다.

기존 koin-contact-map 프론트와 Persnapse Canonical 백엔드를 결합한 작업공간입니다.

메인 화면은 일정/업무, 관계 지도, 인맥, 만남, 명함, 녹음의 6개 메뉴입니다. 실제 서버 저장과 검토형 Capture·OCR·Recall·업무 브리핑을 연결했습니다.

통합 전 이력은 [2026-10-08 검색·프론트 연결 전 점검](docs/operations/recall-and-integration-readiness-2026-10-08.md)을 확인합니다. 검색 준비 16/16개, 실제 AI 구조화·수정·저장·Recall·피드백 흐름을 검증했습니다. 행동 종류·호출 제한·JSON 로그 저장 오류를 수정했으며, 당시 남았던 프론트 DTO/CRUD는 통합 작업으로 연결했습니다. 엄격 Golden 근거 ID 불일치 2건은 후속 평가 대상으로 남아 있습니다. 이전 [기록·명함 저장 검증](docs/operations/capture-storage-verification-2026-10-08.md)과 [연결 복구 이력](docs/handoff/2026-10-07-backend-readiness.md)도 보존합니다.

## 시작하기

요구 환경:

- Node.js 24.x (`package.json` 기준)
- npm 11 이상 권장

```bash
npm install
cp .env.example .env.local
npm run dev
```

검증:

```bash
npm run verify
npm run eval:recall
npm run db:verify:phase4
```

기존 환경의 연결·워크스페이스·schema를 먼저 읽기 전용으로 점검할 때는 다음 명령을 사용합니다. DB 쓰기·유료 모델 호출·seed는 실행하지 않으며, 실패 시 키 대신 오류 분류만 출력합니다.

```bash
npm run db:preflight
```

기록·명함의 실제 DB·private Storage 경로를 합성 데이터로 검증할 때는 다음 명령을 사용합니다. 실행 전용 테스트 워크스페이스를 생성·정리하며 AI/OCR은 프로세스에서만 mock입니다. 환경 파일·기존 데이터·schema를 변경하지 않고 유료 제공자를 호출하지 않습니다.

```bash
npm run db:verify:capture-storage
```

AI Provider key와 지정 모델 접근을 합성 데이터로 live 검증할 때만 아래 명령을 사용합니다. 이 명령은 실제 외부 API를 호출하므로 비용이 발생할 수 있으며 일반 검증에는 포함되지 않습니다.

```bash
npm run ai:verify:live
```

자세한 안전 경계와 단일 Provider 재검증 방법은 `docs/operations/live-api-verification.md`에 기록되어 있습니다.

Phase 4의 실제 OpenAI 정보 구조화 adapter와 DB 수직 슬라이스를 합성 데이터로 live 검증할 때는 아래 명령을 명시적으로 사용합니다. 검증 데이터는 성공·실패와 관계없이 정리됩니다.

```bash
npm run db:verify:phase4 -- --live
```

Supabase 개발 프로젝트를 처음 구성할 때는 `.env.local`의 `DATABASE_URL`을 확인한 뒤 다음 명령을 실행합니다. Seed는 실제 개인정보가 없는 합성 데이터입니다.

```bash
npm run db:check
npm run db:migrate:dry
npm run db:setup
npm run db:verify
```

Migration이 이미 최신인 상태에서 합성 데이터만 다시 맞추려면 `npm run db:seed`를 사용합니다.

브라우저 E2E 테스트는 최초 한 번 Playwright 브라우저 설치가 필요합니다.

```bash
npm run test:e2e:install
npm run test:e2e
```

## 진행 단계

1. 작업공간 초기화
2. 자료 수집과 맥락 통합
3. 제품 정의
4. 기술 기반 설계
5. 설계 검토 및 승인
6. MVP 구현

## 문서 구조

- `docs/inputs`: 전달받은 원본 자료. 내용은 기본적으로 Git에 커밋하지 않습니다.
- `docs/context`: 원본 자료에서 통합·정제한 맥락
- `docs/product`: 제품 비전, 사용자 문제, 범위와 성공 기준
- `docs/architecture`: 시스템, 데이터, API와 운영 기반 설계
- `docs/decisions`: 중요한 제품·기술 의사결정 기록
- `docs/plans`: 단계별 실행 계획과 작업 단위

## 초기 구축 이력

- 독립 Git 저장소 구성 완료
- Canonical Context 및 MVP v0 분석 완료
- Foundation 구축 완료
- Phase 2 Memory Foundation과 Golden Dataset 구축 완료
- 인물 목록과 시간순 Context·Evidence Profile 실행 가능
- Phase 3 Seeded Recall Vertical Slice 구축 완료
- `/recall`에서 장소·행사·주제·시간·소속·약속 맥락으로 사람 검색 가능
- Phase 3.5 Capture·AI runtime·projection hardening 완료
- 9개 Golden Query와 확인된 Evidence 기반 평가 9/9 통과
- mock/live task router와 `vector(1024)` embedding 수명주기 준비
- Phase 4 Text Capture to Memory 수직 슬라이스 완료
- `/capture`에서 Text → Draft → Review → Identity → Commit → Profile/Recall 흐름 실행 가능
- OpenAI `gpt-5.6-luna` production adapter와 원자적·멱등 Memory Commit live 검증 완료
- 다음 단계: Business Card Capture
