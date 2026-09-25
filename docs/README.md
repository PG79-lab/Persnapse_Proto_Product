# Documentation

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
