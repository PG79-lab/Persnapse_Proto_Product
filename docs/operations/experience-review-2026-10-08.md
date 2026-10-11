# UI·UX 개선 검증 — 2026-10-08

작업 경로: `D:\Persnapse\persnapse-mvp`.
판단 기준과 범위: [결정 0017](../decisions/0017-relationship-memory-experience.md).

최종 통합 공유 버전: https://persnapse-bvmsnzac8-choeseyong180-8216.vercel.app/ (로그인 없이 접속).

## 검토 방법

- 공유 통합 Preview의 6개 화면을 로그인 없이 Edge에서 조회.
- 1차 구현 후 스크린샷 재검토: 업무가 여전히 아래로 밀리는 문제, 명함 버튼 스타일 누락을 찾아 2차 수정.
- 지도 필터 빈 상태, 동명이인 소속, 모바일 AI 시작, 로딩 상태를 추가 보완.
- 배포 화면에서 모바일 AI 탭 위에 업무 요약이 남아 입력창을 밀어내는 문제를 재확인. 모바일 AI 탭에서만 요약을 숨기고 채팅 높이를 화면에 맞추며, 전송 버튼이 하단 메뉴에 가려지지 않는지 자동 검증을 추가.
- 브라우저 전용 도구 초기화 실패로 Playwright와 설치된 Edge를 사용.
- 기존 개발 서버의 Turbopack cache 오류를 확인하고 해당 서버를 중지한 뒤 webpack 개발 서버로 확인. 소스·환경 값을 삭제하지 않음.

## 변경 위치

- `src/features/workspace/experience.css`: 통합 경험의 스타일, 반응형, 로딩.
- `ui/ContactGraph.jsx`: 검색 범위, 메뉴 URL·history, 공유 공간 안내.
- `ui/components/WorkManagement.jsx`: 행동 요약, 업무 필터, 캘린더 접기, 완료 그룹.
- `assistant.tsx`: 시작 질문, 검색 실패 복구, 검색 대화 초기화.
- `PeopleManagement.jsx`, `MeetingRecords.jsx`: 전용 검색, 필터·빈 상태.
- `NetworkMap.jsx`, `RelationshipView.jsx`: 지도 이름 밀도, 초점·연결 강조, 필터 복구.
- `CardImport.jsx`, `RecordingPage.jsx`, `business-card-workspace.tsx`: 등록 과정·지원 범위 안내.
- `workspace.css`: CSS base layer로 reset 이동; Tailwind 버튼 표현 복원.

## 검증 범위

- `tests/e2e/workspace-experience.spec.ts`는 합성 workspace를 HTTP mock으로 제공하며 공유 DB에 쓰지 않는다. 검색 응답도 mock으로 처리하여 새 유료 호출을 발생시키지 않는다.
- 요약 필터, 인맥 검색/후속 업무, 만남 참석자·게스트·내용 검색, 브라우저 뒤로가기·새로고침, 명함 버튼의 실제 계산 스타일, 첫 사용, AI 결과 없음, 지도 필터 초기화, 모바일 AI 질문 입력 검증.
- 390px / 768px / 1440px에서 6개 화면의 가로 넘침 및 pageerror 검증.
- 기존 OCR·Capture·Recall E2E도 회귀 검사 대상. 실제 모델 정확도나 새 라이브 OCR 성능을 재평가하는 작업은 아님.

스크린샷은 커밋하지 않는 `test-results/ux-review/`에 저장한다. `before-*`는 공유 배포, `after-*`는 중간 구현, `final-*`는 로컬 재검토 결과이며 최종 배포 검증은 아래에 별도로 기록한다.

## 최종 결과

- ESLint 오류 0. 외부 행사 이미지의 기존 `no-img-element` 권고 2건 유지.
- TypeScript 및 프로덕션 빌드 통과.
- 단위 테스트 39파일 / 207개 통과. 처음 전체 검증에서는 무제한 worker와 브라우저 병행 실행으로 메모리 부족이 발생했고, `npm test -- --maxWorkers=2`로 제한해 재실행하여 통과했다. 기본 `npm run verify`가 한 번에 성공한 것으로 기록하지 않는다.
- 전체 Prettier 검사 통과.
- 첫 전체 E2E에서 23/24 통과: 나머지 1건은 변경 전 고정 CLOVA 안내 문구를 기대한 테스트였다. 공급자 중립적인 실제 안내로 기대값을 갱신했고, 추출 후 실제 공급자와 인식 결과 검증은 유지하여 OCR·텍스트 Capture 2개가 통과했다.
- 최종 모바일 보완 후 프로덕션 서버 기준 전체 E2E **24/24 통과**: 기존 12개 + 신규 UX 12개. `PLAYWRIGHT_CHANNEL=msedge`, `PLAYWRIGHT_PORT=3400`, `npx playwright test --workers=2`로 실행했다. 390px에서 AI 전송 버튼이 하단 메뉴보다 위에 위치하는 검증도 통과.

## 남은 제품 검증

- 이번 검토는 고객 사용자 테스트가 아니다. 정확도·검색 성공률·후속 연락 완료율·재방문 개선을 입증하지 않는다.
- 관계 분류 값이 없는 데이터는 그대로 미분류로 표시한다. 임의 분류나 관계 점수를 생성하지 않는다.
- 음성 STT, 서버 음성 보관, 실제 LLM 메일 생성은 이번 작업 범위 밖이다.
- UI 테스트는 합성 HTTP 응답을 사용했다. 공유 배포의 실제 서버 검증은 조회만 수행하며, 신규 유료 OCR/LLM 호출과 데이터 쓰기는 수행하지 않았다.

## 최종 배포 및 인계

- Deployment: `dpl_4PoSpdAWPq2LreHKjpXTD2mnNbfH`, READY Preview. 로컬·Vercel 빌드 모두 통과.
- 2026-10-08 23:07 KST 확인: 인증 없는 `/`, `/api/workspace`, `/api/recall/preparation` HTTP 200. 인맥 16명·만남 20개·업무 10개, `storage=server`, `aiMode=live`, `ocrMode=live`, 검색 준비 16/16.
- 최종 배포의 새 Edge 컨텍스트에서 6개 화면 확인, JavaScript 오류 0. 390px 모바일 가로 넘침 없음, AI 전송 버튼이 하단 메뉴 위에 보임.
- 검증 결과: `test-results/workspace-public-preview-verification.json`, `test-results/ux-review/final-deployment-browser.json`. 최종 화면은 `test-results/ux-review/final-deployed-*.png`.
- [기존 공개 예외 정책](../decisions/0016-public-team-preview.md)에 따라 최종 배포 URL에만 공개 예외를 추가. 프로젝트 기본 인증 정책 `all` 유지. 이 URL은 동일한 팀 공유 데이터와 활성 AI/OCR에 접근한다.
- 기존 OCR 공유 버전 `https://persnapse-htb5dz6hx-choeseyong180-8216.vercel.app/`는 HTTP 200 그대로 보존. 중간 시각 점검용 배포 `persnapse-14w6s0tv3-choeseyong180-8216.vercel.app`의 임시 공개 예외는 회수해 HTTP 302로 복원했다.
- 복구는 기존 배포 링크를 사용한다. 최종 배포의 공개 예외를 되돌릴 때는 결정 0016의 API에서 최종 deployment ID에 `action=revoke`를 적용한다. 소스 백업은 `tmp/backups/before-ux-review-20261008.zip`.
- 미커밋 통합 작업을 유지했다. 다른 세션에서는 이 문서와 결정 0017을 먼저 읽고, `koin-contact-map` 대신 **`persnapse-mvp`에서 계속 작업**한다.
