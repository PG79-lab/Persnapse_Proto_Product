# AI 어시스턴트 맥락 기반 구축 결정

날짜: 2026-10-13. 사용자 설계 승인 후 핵심 구축.

- Git worktree/전용 브랜치로 다른 세션의 작업 파일과 빌드 산출물을 분리한다. 기준은 `9ec8392`이며 원본의 미커밋 변경을 가져오지 않는다.
- 대화 맥락은 canonical 사실과 분리한 session/turn에 저장한다. 버전·lease·request ID로 충돌과 중복 실행을 관리하며, 결과가 불명확한 요청을 자동 재실행하지 않는다.
- 검색 준비의 전역 차단 대신 현재 관계형 근거/키워드와 준비된 벡터를 사용한다. 제한된 검색을 전체 사실 부재나 전체 최우선으로 표현하지 않는다.
- 새 검색 unit/job 테이블은 기존 인물 projection과 분리한다. 확정 테이블의 statement trigger로 같은 transaction에서 갱신해 공통 저장 함수의 직접 변경을 줄인다.
- MVP의 projection refresh는 workspace 단위다. 변경 없는 hash는 유지하고, 원본별 증분 갱신은 후속으로 둔다. chunk는 결정론적 4,000자 단위이며 문단 기반 분할은 후속이다.
- 사용자 업무는 `workspace_task`, 저장된 약속 등은 `action_item` 근거로 구분한다. 일반 업무를 약속으로 승격하지 않으며, 시각 없는 기한은 날짜만 알려진 것으로 취급한다.
- 준비·판단 목적을 기록 검색의 날짜/조건과 구분한다. 사실·해석·제안·준비 초안을 구분하며 외부 실행은 하지 않는다.
- 자동 인덱스 복구는 durable queue와 별도 worker로 실행한다. 요청 종료 이후의 메모리 timer에 의존하지 않는다. 원격 scheduler 연결은 별도 운영 단계다.
- feature flag는 기본 off다. 원본 통합·DB 적용·활성화를 코드 구현과 분리해 진행한다.

근거 및 검증: [구축·통합 인계](../operations/ai-assistant-implementation-2026-10-13.md), [후속 개선 목록](../plans/ai-assistant-follow-up-2026-10-13.md).
