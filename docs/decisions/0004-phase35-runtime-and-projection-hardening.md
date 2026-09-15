# ADR 0004 — Phase 3.5 Runtime and Projection Hardening

- 상태: Accepted
- 결정일: 2026-09-15
- 적용 범위: Phase 4 Capture 및 이후 live AI·embedding 연결

## 맥락

Phase 3의 deterministic Recall은 안정적으로 동작했지만 실제 Capture와 외부 AI를 연결하기 전에 세 가지 경계를 보강할 필요가 있었다.

1. Capture Session의 재시도와 사용자 수정 결과를 보존할 계약
2. 환경설정이 실제 실행 route에 반영되는 mock/live AI runtime
3. Memory Document 갱신이 기존 embedding을 불필요하게 삭제하지 않는 수명주기

또한 기존 8개 Golden Query에는 `no_result` 회귀 사례가 없어 feature hash 충돌에 의한 false positive를 탐지하지 못했다.

## 결정

### Capture

- 영속 상태는 `draft`, `review`, `failed`, `committed` 네 단계로 유지한다.
- 허용 상태 전이는 domain과 PostgreSQL trigger에서 함께 검증한다.
- `committed`는 terminal 상태이며 `commit_result`를 반드시 가진다.
- 단일 Person Capture는 `committed_person_id`, `committed_interaction_id`를 저장한다.
- 과거 import처럼 여러 entity를 만든 Capture는 typed JSON `commit_result`로 호환한다.
- AI 최초 구조는 `model_draft`, 사용자가 수정하는 현재 구조는 `structured_draft`로 분리한다.
- Draft schema는 `capture-draft-v1`로 versioning하고 Zod strict validation을 통과해야 한다.

### AI runtime

- `AI_ROUTING_MODE=mock`은 외부 네트워크를 사용하지 않고 deterministic adapter만 실행한다.
- `live`는 task별 credential과 adapter가 없을 때 mock으로 조용히 대체하지 않는다.
- 모델 환경변수 override를 실행 route에 반영한다.
- primary 실패 시 credential과 adapter가 준비된 fallback만 사용한다.
- timeout, retry, schema validation과 오류 분류를 Provider 밖의 공통 runtime에서 수행한다.
- attempt telemetry에는 input과 output 원문을 넣지 않고 task, route, model, latency와 오류 코드만 전달한다.
- telemetry 저장 실패는 같은 Provider 요청을 중복 실행시키지 않는다.
- Capture별 AI attempt는 `ai_runs.capture_session_id`, `attempt`, `retry_of_ai_run_id`로 연결한다.

### Memory projection과 embedding

- MVP embedding 차원은 Voyage `voyage-4`와 OpenAI fallback이 함께 사용할 수 있는 1024로 고정한다.
- `memory_documents.embedding`은 `vector(1024)`로 제한한다.
- embedding은 `pending`, `processing`, `ready`, `failed` 상태를 가진다.
- Person Profile projection은 전체 삭제·재삽입 대신 deterministic ID 기반 upsert를 사용한다.
- content hash와 metadata가 같으면 기존 row와 embedding 상태를 유지한다.
- 내용이 달라진 Person만 embedding을 제거하고 `pending`으로 되돌린다.
- projection은 확인된 소속, 기억, 상호작용, 행사, 장소, 주제와 행동만 포함한다.

### Recall no-result

- hash bucket 충돌만으로 후보를 만들지 않는다.
- 실제 token 또는 task concept이 공유될 때만 local semantic 점수를 사용한다.
- `no_result` Golden Query를 추가하고 unit 및 browser E2E로 고정한다.

## 영향

- Phase 4는 API key 없이 mock Context Structurer로 전체 Capture 흐름을 구축할 수 있다.
- 실제 live 검증 시 Provider key를 추가하면 같은 runtime·schema·telemetry 계약을 사용한다.
- embedding 생성 실패는 canonical Memory Commit을 rollback하지 않는다.
- 실제 원자적 Memory Commit과 commit retry 반환은 Phase 4 application service가 이 계약 위에서 구현한다.
- Auth, 대규모 job queue와 vector 검색 성능 최적화는 이번 결정 범위가 아니다.
