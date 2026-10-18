# 0026. 현재 구축물을 메인 프론트엔드로 채택

- 결정일: 2026-10-17 (Asia/Seoul)
- 상태: 사용자 승인·채택
- 근거: “부족한 부분이 있지만, 일단 현재 프론트엔드 구축물을 메인 프론트엔드로 채택할게.”

현재 `persnapse-frontend-graph-review` worktree의 프론트엔드를 Persnapse의 메인 프론트엔드 기준으로 채택한다. 이후 프론트엔드·Graph 개선은 이 구축물을 기준으로 이어간다.

- 대상: 공통 셸·시각 체계, Graph Network·인물 상세·기록 읽기, 검색·기록 추가 메뉴 및 기존 명함/기억 검색 진입 화면.
- 작업 공간: `D:/Persnapse/worktrees/persnapse-frontend-graph-review`
- 브랜치: `feat/frontend-graph-review-20261015`
- 식별: HEAD `9ec83921b5b423625b41472598b167acce8a2535`에 미커밋 변경이 포함된 현재 작업 트리. [최신 시각 리뷰](../operations/frontend-graph-runs/2026-10-17-visual-redesign.md)와 [주요 소스 해시](../plans/assets/graph-visual-reviews/2026-10-17-redesign/final-source-and-entries.json)를 참조한다. 기록 시 주요 파일 10개가 해당 해시와 일치함을 확인했다.

시각적 부족과 미완료 기능은 후속 개선 사항으로 유지한다. 채택은 모든 Visual Gate·실데이터 연결·전체 기능 검증이 완료됐다는 의미가 아니다.

이번 요청에서는 결정 기록과 문서 상태만 갱신했다. Git main 병합, 원본 저장소 반영, 커밋 및 배포는 수행하지 않았다.
