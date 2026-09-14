# ADR 0001 — AI Task Model Routing

- 상태: Accepted
- 결정일: 2026-09-14
- 범위: Persnapse MVP의 외부 AI API 배정과 호출 경계
- 원본: `docs/inputs/Task별_모델스택 및 비용_GPT.pdf`
- 원본 SHA-256: `2E7E329DE8BBDA5D5D21E89570B340C214E0FAF4994BE3A60EB633ED2334D0C3`

## 결정

Persnapse MVP는 하나의 범용 모델을 모든 작업에 사용하지 않는다. API 기반 Model Router가 task별 primary API를 선택하며, 고급 모델은 명시적인 escalation에서만 호출한다.

| Task                     | Primary API                 | Secondary / benchmark            | MVP 적용 시점         |
| ------------------------ | --------------------------- | -------------------------------- | --------------------- |
| 명함 OCR                 | NAVER CLOVA OCR             | Google Cloud Vision OCR          | Business Card Capture |
| STT                      | OpenAI `gpt-transcribe`     | Voxtral Mini Transcribe 2        | Voice Module          |
| 정보 구조화              | OpenAI `gpt-5.6-luna`       | Mistral Small 4                  | Text Capture          |
| Tagging / Classification | OpenAI `gpt-5.6-luna`       | GPT-OSS 20B via Together AI      | Text Capture          |
| Embedding                | Voyage `voyage-4`           | OpenAI `text-embedding-3-small`  | Memory Foundation     |
| Reranking                | Voyage `rerank-3-lite`      | Voyage `rerank-3`                | Seeded Recall         |
| Main Agent               | Google `gemini-3.8-flash`   | OpenAI `gpt-5.6-terra` benchmark | Seeded Recall         |
| Quality Agent            | Anthropic `claude-sonnet-5` | OpenAI `gpt-5.6-terra` benchmark | 품질 escalation       |
| Complex Reasoning        | OpenAI `gpt-5.6-sol`        | Anthropic `claude-sonnet-5`      | 최고난도 선택 호출    |
| Open-model 실험          | Together AI                 | Fireworks AI                     | 검증 이후 비용 최적화 |

OpenAI 모델 ID는 결정일 기준 공식 모델 카탈로그와 일치함을 확인했다. 실제 adapter 활성화 시 각 Provider 계정에서의 모델 접근 권한과 endpoint 계약을 다시 확인한다.

OpenAI 확인 자료:

- Models: <https://developers.openai.com/api/docs/models>
- GPT-Transcribe: <https://developers.openai.com/api/docs/models/gpt-transcribe>
- text-embedding-3-small: <https://developers.openai.com/api/docs/models/text-embedding-3-small>

## Routing 원칙

1. OCR과 LLM 구조화를 분리한다.
2. 대량 전처리와 schema 생성은 `gpt-5.6-luna`가 담당한다.
3. 검색은 PostgreSQL 구조화 조건, `pgvector`, `voyage-4`, `rerank-3-lite`를 조합한다.
4. 일반 Recall은 `gemini-3.8-flash`를 우선 benchmark하고 Evidence 밖의 내용을 단정하지 못하게 한다.
5. Quality Agent와 Complex Reasoning은 기본 경로가 아니다. 다수 인물·회사 관계 분석이나 복잡한 다음 행동 판단처럼 router가 분류한 일부 요청에서만 호출한다.
6. `gpt-5.6-sol`을 단순 추출, 요약 또는 일반 검색 결과 생성에 사용하지 않는다.
7. 각 task의 prompt, input/output schema, timeout, retry와 fallback을 adapter 단위로 격리한다.
8. 모델 변경은 환경변수와 router 설정으로 수행하고 도메인·데이터베이스 계약을 변경하지 않는다.

## 운영 및 신뢰 경계

- 로컬과 자동화 테스트는 기본적으로 `AI_ROUTING_MODE=mock`을 사용한다.
- 실제 API 호출은 해당 task adapter가 활성화되고 필요한 Provider credential이 있을 때만 수행한다.
- 모든 구조화 출력은 Zod validation을 통과한 Draft로만 사용한다.
- 사용자 확인 전 AI 결과를 canonical Memory에 기록하지 않는다.
- Provider, model, latency, token·오디오 사용량, schema version, 오류와 retry를 `AI Run`에 기록한다.
- embedding과 reranking 실패는 확정 Memory를 rollback하지 않는다.
- 개인정보를 사용하는 production traffic은 Provider별 데이터 보존·지역·처리 조건을 검토하고 Provider를 고정한 뒤 허용한다.

## 현재 구현 범위

이 ADR은 모델 배정과 환경설정 계약을 확정한다. Provider SDK, 실제 adapter, API key와 유료 호출은 각 기능 phase에서 추가한다. API key는 저장소에 커밋하지 않는다.
