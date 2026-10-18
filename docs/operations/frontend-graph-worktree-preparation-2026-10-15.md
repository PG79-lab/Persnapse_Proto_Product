# Frontend / Graph 테스트 구축 공간 준비

- 준비일: 2026-10-15 (Asia/Seoul)
- 작업 공간: `D:/Persnapse/worktrees/persnapse-frontend-graph-review`
- 브랜치: `feat/frontend-graph-review-20261015`
- 기준 커밋: `9ec83921b5b423625b41472598b167acce8a2535`
- 상태: 작업 공간 확보 완료 / 최종 설계 검토 및 사용자 OK 대기

## 기준 상태

원본 main 작업 트리의 현재 미커밋 변경 및 미추적 파일을 복사했다. 기존 삭제 상태도 새 worktree에 반영했다. 이는 기존 제품 상태의 스냅샷이며, 이번 작업의 신규 구현 변경이 아니다. 스냅샷 파일별 해시와 삭제 목록은 [baseline manifest](frontend-graph-worktree-baseline-2026-10-15.json)에 기록했다. 원본 및 기존 worktree는 수정하지 않았다.

기존 `persnapse-frontend-graph` worktree에는 별도 구현 변경이 있어 보존했다. 이번 공간의 기준에는 해당 구현을 포함하지 않았다.

## 최종 검토 문서

- [작업 설계](../plans/frontend_docs/02-frontend-graph-work-design-2026-10-14.md)
- [Visual Design 상세 설계](../plans/frontend_docs/03-frontend-graph-visual-design-2026-10-14.md)
- [Reference Atlas / 벤치마킹](../plans/frontend_docs/05-frontend-graph-reference-benchmark-2026-10-14.md)

## 구축 착수 전 경계

최종 설계 검토와 사용자 OK 이후 구현을 시작한다. 이번 준비에서는 제품 코드 변경, 의존성 설치, 서버 실행, 테스트, 빌드, DB 연결/변경, 배포, 커밋을 진행하지 않았다. `.env.local`, `node_modules`, `.next` 등 비추적 실행 환경은 복사하지 않았다. 따라서 현재 공간은 소스와 설계 기준을 확보한 상태이며 실행 검증된 환경은 아니다.

검토 시 Graph와 검색/회상 진입점, P0/P1 범위, 첫 구현 단계의 통과 기준을 확인한다. 이후 변경은 baseline manifest를 기준으로 기존 스냅샷과 구분한다.
