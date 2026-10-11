# ADR 0014 — Recall 행동 종류와 저장·오류 계약

- 날짜: 2026-10-08
- 상태: 구현, 로컬 실제 DB·제공자 검증 완료. 신규 배포는 하지 않았다.
- 근거: 프론트 연결 전 검색 복구와 실제 Recall 검증 중 발견한 계약 누락·JSON 저장 오류.

## 결정

1. `action_items.kind`를 Recall corpus와 `storedActions[].kind`까지 유지한다. `commitment`, `follow_up`, `suggestion`을 모두 단순 약속으로 해석하지 않는다. 사용자 확인을 거친 저장된 제안도 제안이다.
2. LLM QueryPlan의 `actionKind`는 명시적 약속/행동 종류 조건만 정규화한다. 특정 종류를 묻는 답변은 같은 종류의 실제 `action_item`을 인용해야 한다. 종류가 없는 일반 질문은 기존 행동 조회를 유지한다.
3. OpenAI와 Voyage의 HTTP 429는 `AI_PROVIDER_RATE_LIMITED`로 구분한다. `Retry-After` 숫자/HTTP 날짜를 1~3,600초로 제한해 전달하고, 없는/잘못된 헤더는 60초로 안내한다. 앱의 workspace 단기 제한은 기존 `AI_RATE_LIMITED`와 최대 60초를 유지한다. 자동 재시도·대체 제공자 호출은 추가하지 않는다. 검색 준비 배치도 제공자 제한에서 즉시 중단한다.
4. PostgreSQL JSONB 쓰기는 `sql.json`에 JSON 값을 전달한다. `parsed_query`, `response_payload`, `retrieval_trace`, AI attempt `metadata`를 문자열로 이중 직렬화하지 않는다. 기존 로그 전체를 재작성하지 않는다. 사용자가 기존 답변의 처리 시간/평가를 기록하는 경우, 객체가 아닌 과거 trace는 `legacyTrace` 안에 원래 값 그대로 보존하고 새 측정값을 객체에 기록한다.
5. Recall 입력은 엄격한 `{query, referenceTime?}` 계약이다. workspace는 서버에서 결정한다. 관측 API는 해당 workspace의 Query가 없으면 404, 입력 오류 400, 저장 장애 500을 반환한다. 성공한 Recall/관측 응답은 `private, no-store`다.
6. Playwright 산출물은 `test-results/playwright`에 격리한다. 브라우저 검증 시작 시 형제 디렉터리의 DB·유료 검증 보고서가 삭제되지 않도록 한다.

## 영향과 한계

- DB schema/migration, 전역 live 설정, 기존 UI 배포를 변경하지 않았다. UUID·날짜·원문·Identity 확인 원칙을 유지한다.
- 행동 종류 검증은 의미 전체를 증명하지 않는다. 조건 문구의 의미 판단은 여전히 LLM과 별도 평가에 의존한다.
- Golden의 필수 Evidence ID가 같은 질문에 대한 다른 유효 근거를 배제하는 사례는 엄격 실패와 의미 검토를 함께 기록한다. 기존 기대값을 수정해서 통과시키지 않는다.
- typed DTO/CRUD, 인물 없는 할 일, 그룹 만남·게스트 등은 다음 프론트 연결 계약에서 해결한다.
- 검증 범위와 실패 이력: [검색·프론트 연결 전 점검](../operations/recall-and-integration-readiness-2026-10-08.md).

## 참고

- [Postgres.js](https://github.com/porsager/postgres): parameter 직렬화와 `sql.json`, 설치된 3.4.9 타입·구현도 대조했다.
- [Voyage rate limits](https://docs.voyageai.com/docs/rate-limits): 실제 429 관측. 계정의 조직/프로젝트 한도 값은 미조회이며 앱 제한과 동일하다고 가정하지 않는다.
- [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs): Responses의 엄격한 JSON Schema 계약 유지.
