# Frontend / Graph 설계 문서

갱신일: 2026-10-17 (Asia/Seoul)

아래 순서로 읽고 각 문서의 책임에 맞춰 참조한다. 구현 착수 승인과 범위는 [결정 0025](../../decisions/0025-frontend-graph-implementation.md), 실제 진행과 검증은 [실행 기록](../../operations/frontend-graph-runs/2026-10-16-initial.md)을 따른다.

현재 구축물: **2026-10-17 사용자 결정으로 메인 프론트엔드 기준에 채택했다.** [채택 결정 0026](../../decisions/0026-adopt-main-frontend.md), [Visual 재설계·레퍼런스 비교](../../operations/frontend-graph-runs/2026-10-17-visual-redesign.md), [합성 미리보기](http://127.0.0.1:4316/#map). 이후 개선은 이 구축물을 기준으로 진행한다. 시각적 보완, VD02/03 전체 흐름과 실데이터 연결은 남아 있다. Git main 병합·배포와는 구분하며, 미리보기는 해당 로컬 서버 실행 중에만 접속할 수 있다.

첫 구현과 비교할 때는 [10월 16일 VD01](../../operations/frontend-graph-runs/2026-10-16-visual-review.md)을 사용한다. 10월 17일 이후 구체 치수와 화면 구성은 03의 24장 및 최신 리뷰 기록을 우선한다.

| 순서 | 문서                                                                             | 책임                                         |
| ---- | -------------------------------------------------------------------------------- | -------------------------------------------- |
| 01   | [구축 실행 설계](01-frontend-graph-execution-2026-10-15.md)                      | 결정·작업 순서·검증·실시간 미리보기·인수인계 |
| 02   | [전체 작업 설계](02-frontend-graph-work-design-2026-10-14.md)                    | 제품 목표·P0/P1·보존 기능                    |
| 03   | [Visual Design 상세 설계](03-frontend-graph-visual-design-2026-10-14.md)         | 토큰·레이아웃·상호작용·핵심 세 화면          |
| 04   | [Graph 상태·조회 계약](04-frontend-graph-contracts-2026-10-15.md)                | ID·상태 전이·API·근거                        |
| 05   | [Reference Atlas·반복 개선](05-frontend-graph-reference-benchmark-2026-10-14.md) | 전체/crop 이미지·비교·시나리오·검토 기준     |

먼저 [AGENTS](../../../AGENTS.md)를 확인한다. 이후 작업별로 01의 W 항목에서 필요한 설계 절과 레퍼런스를 찾아 읽는다. 실시간 미리보기 작업 방식은 01의 5.4절이다.

- [Worktree 준비 기록](../../operations/frontend-graph-worktree-preparation-2026-10-15.md)
- [기존 변경 baseline manifest](../../operations/frontend-graph-worktree-baseline-2026-10-15.json): 준비 시점의 경로·해시를 보존한 역사 기록이다.
- [레퍼런스 이미지 manifest](../assets/graph-visual-references-2026-10-14/manifest.json): 31개 이미지의 출처·해시·crop 좌표. 기존 assets 위치를 유지한다.
