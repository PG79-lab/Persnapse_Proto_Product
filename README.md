# Persnapse MVP

Persnapse MVP를 0에서 1로 구축하기 위한 독립 작업공간입니다.

현재 Canonical Context와 초기 MVP 설계를 바탕으로 실행 가능한 수직 슬라이스를 단계적으로 구축하고 있습니다.

## 시작하기

요구 환경:

- Node.js 20.9 이상
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
```

AI Provider key와 지정 모델 접근을 합성 데이터로 live 검증할 때만 아래 명령을 사용합니다. 이 명령은 실제 외부 API를 호출하므로 비용이 발생할 수 있으며 일반 검증에는 포함되지 않습니다.

```bash
npm run ai:verify:live
```

자세한 안전 경계와 단일 Provider 재검증 방법은 `docs/operations/live-api-verification.md`에 기록되어 있습니다.

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

## 현재 상태

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
- 다음 단계: Text Capture to Memory
