# Documentation

> 최신 UX 스프린트: [사용자 과업 루프 개선 결정](decisions/0018-user-task-loop-frontend-sprint.md), [구현·검증 기록](operations/ux-task-loop-sprint-2026-10-10.md). 사용자 평가 결과는 아직 수집 전입니다.

> 최신 작업: [사용자·VC 관점 UI/UX 개선과 검증](operations/experience-review-2026-10-08.md), [제품 판단과 개선 결정](decisions/0017-relationship-memory-experience.md). 작업 경로는 `D:\Persnapse\persnapse-mvp`입니다.

> 통합 기반: [프론트·백엔드 결합 현황](operations/workspace-integration-2026-10-08.md). 아래 이전 보고서는 작성 시점의 이력으로 보존합니다.

> 통합 전 검증 이력: [10월 8일 기록·명함 실제 저장 검증](operations/capture-storage-verification-2026-10-08.md)의 17개 시나리오가 통과했습니다. 동시 명함 업로드와 잘못된 검토 상태 오류를 수정했습니다. 해당 보고서의 AI/OCR은 검증 프로세스에서 mock입니다. 이후 live 검색·프론트 통합·배포 현황은 상단의 최신 통합 보고서를 참고합니다. 연결 복구 이력은 [10월 7일 기준점](handoff/2026-10-07-backend-readiness.md)을 참고합니다.

> OCR 고도화의 현재 집중 범위와 보류 항목은 [9월 30일 OCR 범위·후속 개선 목록](plans/ocr-follow-up-backlog-2026-09-30.md)을 참고합니다.

> 최신 작업 순서와 미해결 장애는 [9월 25일 OCR 우선 개발 기준점](handoff/2026-09-25-ocr-priority-checkpoint.md)을 먼저 확인한다. 아래 기록은 작성 시점의 이력이다.

이 디렉터리는 Persnapse MVP의 근거와 결정을 단계별로 보존합니다.

현재 구현·실제 AI 연결·검증 결과를 팀에 전달할 때는 [MVP 기술 구현·검증 현황](context/04-mvp-technical-inventory-2026-09-22.md)을 먼저 읽습니다. 2026-09-22의 현재 코드와 최신 live 운영 기록을 대조했으며, 이전 인계문의 mock·로컬 Recall 상태와 이후 실제 AI 연결·단기 호출 제한 변경을 구분합니다. 이번 재실행은 28파일·106테스트와 타입 검사 통과이며, 원격 상태는 기존 검증 기록 기준입니다.

새 Codex 세션에서 이어갈 때는 [통합 세션 인계](handoff/2026-09-22-session-handoff.md)를 시작점으로 읽습니다. 현재 작업물·미커밋 상태·실행 경계·시행착오·Astra 검토의 핵심 피드백·첫 action과 새 세션용 프롬프트를 연결합니다.

| 디렉터리       | 역할                      | 상태                      |
| -------------- | ------------------------- | ------------------------- |
| `inputs`       | 전달받은 원본 자료        | 원본 보존, 기본 Git 제외  |
| `context`      | 자료에서 통합·정제한 맥락 | 분석 단계에서 작성        |
| `product`      | 제품 정의와 MVP 범위      | 합의 과정에서 작성        |
| `architecture` | 기술 기반과 시스템 설계   | 제품 정의 후 작성         |
| `decisions`    | 주요 의사결정 기록        | 결정 시마다 작성          |
| `plans`        | 구현 계획과 작업 순서     | 설계 승인 후 작성         |
| `operations`   | 실행·검증 운영 절차       | 기능 연결 시 작성         |
| `handoff`      | 세션 이월·재개 시작점     | 기준일의 상태와 다음 행동 |

문서에는 가능한 한 근거 자료, 작성 또는 결정 시점, 상태를 함께 표시합니다.

전반적인 현황과 제품 판단은 [MVP 현황·제품 검토 및 개선 방향](context/02-mvp-status-and-product-review-2026-09-22.md)을 참조합니다. 기존 검증 기록과 개선 제안을 구분한 2026-09-22 작성 문서입니다.

원본 명세 대비 상세 평가와 결함 재현 조건은 [Technical Spec 기준 검토·개선 인계](context/03-technical-spec-review-handoff-2026-09-22.md)에 있습니다. 기본 Graph·Voice의 원본 필수 범위, 재현된 검색·날짜·OCR 분류 문제, 최신 읽기 전용 검증과 후속 작업 경계를 정리했습니다. 개선 순서는 제안이며 신규 개발·배포 승인을 뜻하지 않습니다.

현재 구현 기준의 주요 결정:

- `decisions/0001-ai-task-model-routing.md`: task별 AI Provider와 모델
- `decisions/0002-memory-data-foundation.md`: Canonical 관계 데이터와 검색 projection
- `decisions/0003-seeded-recall-contract.md`: Recall retrieval, Evidence와 Action 계약
- `decisions/0004-phase35-runtime-and-projection-hardening.md`: Capture 상태, AI runtime과 embedding projection 계약
- `decisions/0005-main-agent-gpt-56-terra.md`: Main Agent의 OpenAI Terra 전환과 초기 병목 기준
- `decisions/0006-phase4-text-capture-commit.md`: Text Capture의 Draft·Identity·원자적 Commit 계약
- `operations/live-api-verification.md`: 합성 데이터 기반 Provider live 검증 절차

## 실제 AI 기억 흐름 — 2026-09-22

- [구현 결정과 경계](decisions/0011-live-memory-assistant.md)
- [활성화·검증 절차](operations/live-memory-assistant.md)

## 프론트 연결 준비 — 2026-10-07

- 최신: [검색 복구·Recall·연결 전 점검](operations/recall-and-integration-readiness-2026-10-08.md): 16/16 준비, 실제 AI 저장→검색→피드백, 로그·오류 수정, UI 데이터 계약 점검과 남은 연결 조건
- [Recall 행동 종류·저장·오류 계약](decisions/0014-recall-action-kinds-and-persistence.md)

- [제품 기준과 검색 복구 결정](decisions/0013-backend-readiness-and-search-recovery.md)
- [현재 검증 상태와 재개 순서](handoff/2026-10-07-backend-readiness.md)
- [실제 제공자·백엔드 후속 검증](operations/backend-provider-verification-2026-10-07.md): 제공자 합성 검증, API 입력 오류 수정, 153테스트·HTTP 16개 확인. 19:54 KST DB·REST·Storage 연결 복구 완료, 검색 문서 3개 복구·전체 수직 검증은 미완료
- [기록·명함 실제 저장 검증](operations/capture-storage-verification-2026-10-08.md): 격리된 원격 DB·Storage의 17개 시나리오 통과, 동시 업로드·검토 상태 오류 수정, 기존 DB 보존·테스트 잔여물 0개
