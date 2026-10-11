# 사용자 과업 루프 UX 스프린트 — 2026-10-10

작업 경로: `D:\Persnapse\persnapse-mvp`. 제품 판단: [결정 0018](../decisions/0018-user-task-loop-frontend-sprint.md).

## 적용

- 관계 지도: 비어 있는 용도별 카드 제거, 미분류 안내, 인맥 8명씩 보기와 전체 보기, 밀집 만남 표시 선택. 17명·21건의 실제 조회 데이터로 시각 재검토.
- 명함 등록: 빈 큐의 중복 촬영·업로드 버튼 제거, 검토 단계 강조, 저장 후 인맥 프로필/AI 기억 질문으로 연결. 파일 입력은 빈 화면에서도 활성 상태로 유지.
- AI: 결과 첫 근거를 바로 제시하고 해당 인물의 미완료 할 일로 이동. 모바일 예시·입력·전송 배치 정리. 명함에서 넘어온 질문은 자동 유료 호출 없이 입력창에 초안으로 넣음.
- 녹음: 파일·메타데이터를 IndexedDB에 보관하여 새로고침 후 복원하고 삭제 시 로컬 파일도 제거. 서버 음성 동기화나 STT를 추가한 것은 아님.
- 서버 API·모델 라우팅·DB 스키마는 이 스프린트에서 변경하지 않음.

## 검증

- `npm run typecheck`, `npm run build` 통과.
- `npm run lint` 오류 0; 기존 외부 이미지 관련 `no-img-element` 권고 2건.
- `npm test -- --maxWorkers=2`: 39파일 / 207테스트 통과. 기본 무제한 worker에서 메모리 부족이 있어 worker를 제한함.
- 프로덕션 빌드 + Edge Playwright E2E: **28/28 통과**. 합성 workspace/AI 응답을 사용하며 공유 DB에 쓰거나 유료 AI 호출을 하지 않음. 390px/768px/1440px의 6개 화면도 포함.
- `test-results/ux-review/after-ux-sprint-*.png`에 실제 workspace를 조회한 화면 보관. 화면 조회는 읽기 전용. 지도 17명·만남 21건, 명함 빈 화면, 업무 화면, 모바일 AI를 확인함.

## 아직 확인되지 않은 것

실사용자 6명의 과업 성공률, 인식 필드 수정량, AI 인물 검색 성공률, 실제 작업 시간 절감, 반복 사용 의도는 측정하지 않았다. 따라서 ‘매우 높음’은 목표이지 현재 평가가 아니다. 실제 사용자 테스트 후 실패가 몰리는 한두 단계를 다시 고치고, 그 뒤 백엔드·모델 성능 개선의 우선순위를 결정한다.

## 팀 미리보기 배포

- 새 통합 Preview: https://persnapse-qep1dj74i-choeseyong180-8216.vercel.app/
- Deployment `dpl_3N7ptKNSs9uBWeZJPYsstjX5BFFe`, READY. 로컬·Vercel 프로덕션 빌드 통과.
- 기존 [결정 0016](../decisions/0016-public-team-preview.md)의 공개 예외 방식을 이 deployment에만 적용. 프로젝트 기본 Vercel 인증 `all` 유지. 이전 공유 링크는 그대로 보존.
- 새 브라우저에서 `/`, `/api/workspace`, `/api/recall/preparation` 인증 없이 HTTP 200. 인맥 17명·만남 21건·업무 10건, 서버 저장·live AI/OCR, 검색 준비 17/17.
- 새 Edge 브라우저 컨텍스트로 관계 지도·명함 등록·업무 화면·390px 모바일 AI를 조회: 페이지 JavaScript 오류 0건. 스크린샷은 `test-results/ux-review/deployed-ux-sprint-*.png`.
- 이 URL을 아는 사람은 같은 공유 데이터와 활성 AI/OCR을 사용할 수 있다. 테스트는 조회만 수행했고, 새로운 실사용 데이터나 유료 호출을 만들지 않았다.
