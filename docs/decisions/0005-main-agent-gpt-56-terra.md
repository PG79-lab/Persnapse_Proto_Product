# ADR 0005 — Main Agent GPT-5.6 Terra 전환

- 상태: Accepted
- 결정일: 2026-09-15
- 적용 범위: 일반 사용자 질의의 Evidence 기반 답변 생성
- 대체 결정: ADR 0001의 Main Agent 항목

## 맥락

최초 Main Agent primary인 Google `gemini-3.8-flash`는 live 구조화 출력 검증에서 유효한 요청 형식까지 통과했지만 `HTTP 503 high demand`를 반복 반환했다. Main Agent는 사용자 질의의 기본 경로이므로 모델 호출 병목이 반복되면 Recall 경험 전체가 중단된다.

OpenAI `gpt-5.6-terra`는 기존 모델 스택에서 Main Agent benchmark로 이미 지정되어 있었고, 현재 공식 API에서 Responses와 Structured Outputs를 지원한다. 사용자는 병목 감소를 우선하여 이 모델을 Main Agent primary로 전환하기로 했다.

## 결정

- `mainAgent.primary`는 OpenAI `gpt-5.6-terra`를 사용한다.
- 전용 override는 `OPENAI_MAIN_AGENT_MODEL`로 관리한다.
- Main Agent의 기존 Terra benchmark route는 primary와 중복되므로 제거한다.
- `OPENAI_QUALITY_BENCHMARK_MODEL`은 Quality Agent benchmark 용도로 유지한다.
- Main Agent 요청은 기본적으로 `store=false`와 strict JSON schema를 사용한다.
- 짧은 Evidence 기반 일반 질의는 `reasoning.effort=none`을 시작점으로 사용해 지연과 reasoning token을 억제한다.
- `gpt-5.6-sol`은 기존처럼 복잡 추론의 선택적 escalation에만 사용한다.
- 현재 Main Agent에는 다른 Provider fallback을 자동 지정하지 않는다. 오류를 숨긴 품질 변경보다 제한 재시도와 명시적 실패를 우선한다.

## 병목 검증 기준

초기 live smoke 기준은 다음과 같다.

1. 고정 합성 Evidence만 사용한 strict 구조화 응답 5회 성공
2. 워밍업 1회 이후 4개 동시 호출 성공
3. HTTP 429, 5xx와 timeout 없음
4. 전체 검증 suite 재시도 없음
5. 개별 호출 최대 15초 이하

이 수치는 운영 SLO가 아니라 Phase 4 진입 전의 초기 병목 탐지선이다. 실제 사용 데이터가 쌓이면 p50, p95, 오류율과 token 비용을 `ai_runs`에서 다시 정한다.

## Live 검증 결과

2026-09-15에 OpenAI Responses API의 기본 service tier로 합성 Evidence 기반 검증을 실행했다.

| 항목             | 결과              |
| ---------------- | ----------------- |
| 전체 호출        | 5/5 성공          |
| 실행 형태        | 워밍업 1 + 동시 4 |
| suite 재시도     | 0회               |
| 429/5xx/timeout  | 0건               |
| 평균 지연        | 2,038ms           |
| p50 지연         | 1,798ms           |
| p95·최대 지연    | 3,223ms           |
| 총 token         | 1,775             |
| 구조화 응답 계약 | 5/5 통과          |

개별 최대 지연이 초기 탐지선 15초의 약 21%였고 동시 burst에서도 오류나 재시도가 없었다. 이 결과로 Phase 4 진입 전 Main Agent live gate를 통과한 것으로 판정한다.

공식 확인 자료:

- GPT-5.6 Terra: <https://developers.openai.com/api/docs/models/gpt-5.6-terra>
- Responses API: <https://developers.openai.com/api/reference/cli/resources/responses/methods/create>

## 영향

- Main Agent와 정보 구조화가 모두 OpenAI credential을 사용하지만 모델과 task 설정은 분리된다.
- Google Generative AI key는 Main Agent 필수 credential이 아니며 다른 기능 결정 전까지 비활성 상태로 둔다.
- Terra는 Luna보다 token 단가가 높으므로 구조화·분류 대량 처리는 계속 Luna가 담당한다.
- Provider 집중 위험은 남지만 현재 확인된 Google의 반복 503 병목은 기본 사용자 경로에서 제거된다.
