# ADR 0003 — Seeded Recall Retrieval and Evidence Contract

- 상태: Accepted
- 결정일: 2026-09-15
- 적용 범위: Phase 3 Recall과 이후 Capture·AI adapter 단계

## 맥락

Persnapse의 핵심 가설은 이름을 몰라도 관계 맥락으로 사람을 찾고, 그 결과를 실제 근거로 확인할 수 있다는 것이다. 초기 단계부터 외부 embedding·reranking·answer 모델을 모두 연결하면 retrieval 품질, Provider 변동, 비용과 UI 문제를 분리해서 판단하기 어렵다. 또한 Phase 2의 Draft Memory와 재생성 가능한 검색 projection이 답변 근거로 섞이지 않도록 명시적인 계약이 필요하다.

## 결정

1. Phase 3의 검색 corpus는 `confirmed` Person, Affiliation, Interaction, Memory Statement와 Action Item만 사용한다.
2. Query는 한국어 정규화 후 intent, 검색 term과 시간 범위로 파싱하며 상대 시간은 저장된 `reference_time`을 기준으로 해석한다.
3. 초기 semantic retrieval은 96차원 deterministic feature hashing인 `local-hash-v1`으로 구현한다. 구조화 term 일치와 함께 `hybrid-v1` ranking에 사용하지만 vector를 Canonical DB에 저장하지 않는다.
4. 응답 Answer는 선택된 Evidence만으로 결정적으로 생성한다. 결과마다 선택 이유와 확인된 Evidence를 반환한다.
5. 정확한 동명이인 이름만 입력되면 후보를 합치거나 임의 선택하지 않고 `ambiguous`로 반환한다.
6. 저장된 Action은 `stored`, 새 후속 제안은 `ai_suggestion` 타입으로 구분하고 둘 다 `executes: false`로 반환한다.
7. Query, parser·retrieval version, AI Run, latency, response payload, retrieval trace와 대표 Evidence snapshot을 PostgreSQL에 기록한다.
8. Golden Query는 범주, reference time, 기대 상태, Person과 Evidence를 데이터로 관리하며 baseline 미달 시 평가 명령이 실패한다.

## 이유

- 고정된 합성 데이터와 결정적 ranking은 알고리즘 변경의 영향을 반복 측정할 수 있게 한다.
- 확정 데이터만 사용하면 사용자 확인 전 추론이 사실처럼 Recall되는 것을 막는다.
- Evidence snapshot은 파생 projection이 재생성되거나 원본 표시 방식이 바뀌어도 과거 답변을 설명할 수 있게 한다.
- adapter 경계 뒤에서 실제 embedding, reranking과 answer generation을 교체할 수 있어 초기 제품 검증과 이후 모델 품질 개선을 분리한다.

## 영향

- 현재 semantic 품질은 Golden Dataset 기준선이며 실제 사용자 언어 다양성을 대표하지 않는다.
- live mode에서는 ADR 0001의 Voyage embedding·reranking과 Main Agent를 연결하고 같은 Golden Query 회귀 평가를 통과해야 한다.
- 실제 embedding 차원과 vector index는 Provider 응답을 검증한 뒤 migration으로 고정한다.
- 전체 선택 Evidence는 Query response payload에, 결과 Person별 대표 Evidence는 `query_evidence`에 저장한다.
- Recall은 읽기 경험이며 외부 메시지 발송이나 Action 실행 권한을 갖지 않는다.
