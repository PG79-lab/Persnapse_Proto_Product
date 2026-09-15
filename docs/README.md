# Documentation

이 디렉터리는 Persnapse MVP의 근거와 결정을 단계별로 보존합니다.

| 디렉터리       | 역할                      | 상태                     |
| -------------- | ------------------------- | ------------------------ |
| `inputs`       | 전달받은 원본 자료        | 원본 보존, 기본 Git 제외 |
| `context`      | 자료에서 통합·정제한 맥락 | 분석 단계에서 작성       |
| `product`      | 제품 정의와 MVP 범위      | 합의 과정에서 작성       |
| `architecture` | 기술 기반과 시스템 설계   | 제품 정의 후 작성        |
| `decisions`    | 주요 의사결정 기록        | 결정 시마다 작성         |
| `plans`        | 구현 계획과 작업 순서     | 설계 승인 후 작성        |
| `operations`   | 실행·검증 운영 절차       | 기능 연결 시 작성        |

문서에는 가능한 한 근거 자료, 작성 또는 결정 시점, 상태를 함께 표시합니다.

현재 구현 기준의 주요 결정:

- `decisions/0001-ai-task-model-routing.md`: task별 AI Provider와 모델
- `decisions/0002-memory-data-foundation.md`: Canonical 관계 데이터와 검색 projection
- `decisions/0003-seeded-recall-contract.md`: Recall retrieval, Evidence와 Action 계약
- `decisions/0004-phase35-runtime-and-projection-hardening.md`: Capture 상태, AI runtime과 embedding projection 계약
- `decisions/0005-main-agent-gpt-56-terra.md`: Main Agent의 OpenAI Terra 전환과 초기 병목 기준
- `decisions/0006-phase4-text-capture-commit.md`: Text Capture의 Draft·Identity·원자적 Commit 계약
- `operations/live-api-verification.md`: 합성 데이터 기반 Provider live 검증 절차
