# ADR 0006 — Phase 4 Text Capture와 Memory Commit

- 상태: Accepted
- 결정일: 2026-09-15
- 적용 범위: Text Context Capture → Review → Identity → Memory → Recall

## 맥락

Phase 3.5에서 Capture 상태와 versioned Draft 기반은 준비됐지만, 실제 사용자 흐름에는 세 경계가 남아 있었다.

1. 사용자 확인 전 AI 구조화 결과가 canonical Memory를 오염시키지 않아야 한다.
2. 동명이인과 유사 소속이 있어도 Person을 자동 병합하면 안 된다.
3. 네트워크 재시도나 중복 클릭으로 Person·Interaction이 중복 생성되면 안 된다.

## 결정

### Draft와 구조화

- Text 입력은 먼저 `capture_sessions`의 `note` Capture로 저장한다.
- OpenAI live와 deterministic mock은 동일한 `capture-draft-v1` strict schema를 사용한다.
- live 정보 구조화는 OpenAI Responses API의 `gpt-5.6-luna`, `store=false`와 strict JSON schema를 사용한다.
- 최초 결과는 `model_draft`, 사용자가 최종 확인하는 값은 `structured_draft`에 분리한다.
- Provider 또는 schema 실패는 Capture를 `failed`로 남기고 같은 Capture에서 재시도한다.
- 원문·Provider 원문 응답·비밀값은 telemetry에 기록하지 않는다.

### Identity

- 이름과 현재 소속의 정규화 일치를 후보 신호로 사용한다.
- 후보 수와 관계없이 기존 Person 연결 또는 신규 Person 생성을 사용자가 직접 선택한다.
- 이름·소속을 수정한 뒤 후보를 다시 검색할 수 있다.
- 단일 강한 후보도 자동 선택하거나 병합하지 않는다.

### Commit

- Capture row를 `for update`로 잠근 transaction 안에서 다음을 수행한다.
  1. 기존 Person 검증 또는 신규 Person 생성
  2. Organization·Affiliation과 Event·Topic resolve
  3. Interaction과 Participant 생성
  4. Memory Statement와 Action Item 생성
  5. provenance와 `confirmed` verification 기록
  6. Capture를 terminal `committed`로 전환하고 typed `commit_result` 저장
- 이미 committed인 Capture는 기존 strict-validated `commit_result`를 반환한다.
- 사용자 수정 Draft 저장과 canonical entity 생성은 같은 transaction에 포함한다.

### Projection

- canonical commit이 끝난 뒤 별도 호출로 Person Memory Document를 content-hash upsert한다.
- projection 실패는 canonical commit을 rollback하지 않고 사용자에게 부분 성공으로 표시한다.
- 실제 vector embedding 생성은 `pending` 상태로 남으며 local Recall은 갱신된 projection을 즉시 사용한다.

## 검증

- deterministic mock DB 수직 슬라이스 통과
- OpenAI `gpt-5.6-luna` production adapter live 수직 슬라이스 통과
- Draft 격리, 명시적 Identity, 원자적 commit, 중복 commit 0건, correction 보존 확인
- commit 직후 이름 없는 Context query로 새 Person과 Evidence Recall 확인
- 검증 데이터 정리 후 기존 Golden Dataset 수량과 Draft 유출 0건 유지
- Chromium Capture Review E2E 통과

공식 OpenAI 확인 자료:

- GPT-5.6 모델: <https://developers.openai.com/api/docs/models>
- Responses API: <https://developers.openai.com/api/reference/cli/resources/responses/methods/create>

## 영향과 한계

- 현재 빌드는 인터뷰용 단일 Workspace 모드이며 공개 Production Auth를 제공하지 않는다.
- Organization과 Event resolve는 설명 가능한 정확 일치 기준선이며 자동 entity merge 기능이 아니다.
- async job queue, 운영 retry, vector 검색 최적화는 Pilot Hardening 범위다.
