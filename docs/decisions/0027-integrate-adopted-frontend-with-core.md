# 0027. 채택 프론트엔드와 최신 핵심 기능 통합

- 결정일: 2026-10-18
- 근거: 사용자가 4316의 프론트엔드/Graph를 그대로 따르며 최신 핵심 기능을 연결하고, 검토 후 통합 착수를 승인했다.
- 기준 main: `de8d6993fa8a0e1364b1218f8f21c0bec830ff26`.
- 프론트 원본: `persnapse-frontend-graph-review`, `9ec8392` + 미커밋 변경. 원본 worktree는 수정하지 않는다.
- 통합 작업: `integration/frontend-core-20261018`, `persnapse-frontend-core`.

## 적용

1. 채택된 셸, Graph, Pretendard, CSS, 명함 진입 화면을 선택 반입한다. 원본 브랜치 전체를 병합해 최신 핵심 기능을 과거 버전으로 되돌리지 않는다.
2. 최신 main의 명함 LC100/회전/OCR/저장, 녹음/STT, 대화형 AI와 인덱싱을 유지한다. 공통 capabilities에 `assistantContext`와 격리 검토용 `preview`를 함께 보존한다.
3. Graph는 기존 `/api/workspace`의 실제 인물·만남·메모·관계를 읽는다. 새 Graph DB/API나 DB 마이그레이션은 이번 통합에 필요하지 않다. 추론 관계를 생성하지 않는다.
4. 4316은 합성 시각 검토용으로 유지한다. 통합 테스트 서버는 preview를 끄고 기존 `localhost:3510` 주소를 사용한다. 녹음 IndexedDB는 origin별이므로 기존 주소를 유지한다.
5. 추가 UI는 [Visual Design §24](../plans/frontend_docs/03-frontend-graph-visual-design-2026-10-14.md) 및 해당 상태·조회 계약을 따른다.
6. 외부 배포는 이번 로컬 통합의 완료 조건에 포함하지 않는다.

## 검증

lint/typecheck/unit/build, 합성 Graph 조작·반응형, 핵심 기능 브라우저 회귀, 실제 workspace API 연결을 구분해 검증한다. 명함 저장 후 Graph에 같은 인물이 나타나는 테스트를 포함한다. 합성 API 테스트를 실제 OCR/STT 정확도 평가로 보고하지 않는다.

상세 결과: [통합 실행 기록](../operations/frontend-core-integration-2026-10-18.md).
