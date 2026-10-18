# 0025 — Frontend / Graph 구현 착수

- 날짜: 2026-10-16 (Asia/Seoul)
- 상태: 승인, 구현 진행
- 작업 공간: `D:/Persnapse/worktrees/persnapse-frontend-graph-review`
- 사용자 근거: “frontend_docs의 프론트엔드 설계 문서를 중점적인 기반으로, 작업 착수해줘.”

사용자가 최종 검토 후 구축 착수를 요청했다. [실행 설계](../plans/frontend_docs/01-frontend-graph-execution-2026-10-15.md)의 D01~D04를 이 worktree의 구현 범위로 채택한다.

| 결정 | 승인 범위                                                                          |
| ---- | ---------------------------------------------------------------------------------- |
| D01  | 통합 앱의 기본 진입을 Graph로 변경. 여섯 hash 화면과 호환 리다이렉트 보존          |
| D02  | 전역 검색과 Graph Recall 연결. 기존 업무 어시스턴트·엔진·입력 접근 보존            |
| D03  | 기존 데이터 모델의 Graph GET 조회·근거 API. DB migration·쓰기 변경은 포함하지 않음 |
| D04  | P0 인물·만남·근거·확장·복귀·Recall 제한·기존 입력 보존. P1/P2는 별도 후속          |

AGENTS의 진입·검색 규칙을 함께 갱신했다. 원본 저장소와 다른 worktree는 변경하지 않는다. 공개 배포·실데이터 쓰기·외부 유료 호출은 이번 로컬 구축에 포함하지 않는다.

W00부터 합성 데이터 미리보기와 기준 캡처를 준비하고, W03/05의 핵심 화면 비교 후 데이터 계약을 연결한다. W10은 세 핵심 화면 Gate 이후 진행한다. 승인과 검증 통과는 구분하며 진행·증거는 [run 기록](../operations/frontend-graph-runs/2026-10-16-initial.md)에 남긴다.
