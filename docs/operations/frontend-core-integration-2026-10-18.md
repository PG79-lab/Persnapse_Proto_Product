# 프론트엔드 / Graph / 핵심 기능 통합 — 2026-10-18

## 기준 및 보존

- 최신 core main `de8d699` 위에 4316 채택 프론트엔드를 선택 반입.
- 원본 미커밋 작업은 변경하지 않음. 반입 시점 사본 및 SHA-256 manifest는 통합 worktree의 ignored `output/frontend-integration/source/`, `source-manifest.json`에 보관.
- 프론트 설계/시각 검토 문서와 합성 화면 자료를 함께 반입. 이 문서 이전의 실행 문서는 당시 상태를 기록한 역사 자료.
- 핵심 서버/API/DB와 최신 assistant 코드는 main 유지. API 인증정보·실제 인물·명함·녹음 자료는 커밋하지 않음.

## 검증 진행

- 타입 검사 통과.
- lint 오류 0, 기존 경고 5.
- webpack production build 통과. 첫 병렬 검증은 시스템 메모리 부족으로 중단되어 순차 실행으로 변경.
- 단위 테스트: 61개 파일 / 334개 통과 (메모리 제한에 맞춰 4개 파일씩, worker 1개로 순차 실행).
- 핵심 브라우저 첫 완주: 40개 통과, 4개 실패, 실제 사진 fixture 부재로 회전 1개 skip. 수정 및 fixture 준비 후 관련 6개 재검증 통과. 최종 CSS 변경 이후 결과는 아래에 추가 기록.

## 통합 중 발견·수정

- production CSS 순서가 개발 서버와 달라 최신 시각 스타일이 구형 스타일에 덮였다. Next CSS chunking strict만으로 해결되지 않아 `styles.css` 한 진입점에서 여섯 CSS를 순서대로 import한다. Graph 캔버스와 상세 열의 겹침, 글꼴, 헤더 높이를 회귀 검사에 추가했다.
- 고정 높이의 어시스턴트 host 아래에 브리핑이 겹쳐 질문 전송을 가렸다. host가 실제 패널 높이를 따르도록 변경하고 390/1280px 클릭 검증을 추가했다.
- Graph에서 시각적으로 숨긴 공통 제목이 접근성 트리에 중복 노출되었다. 해당 공통 제목만 aria-hidden/inert 처리했다.
- 기존 테스트의 필터 selector와 모바일 AI 탭·예제 스크롤 동작을 채택된 UI에 맞게 수정했다. 명함 저장→같은 인물의 Graph 조회 검증을 추가했다.
- 테스트 서버 launcher는 preview=0을 명시해 합성 검토 환경을 실사용 서버로 오인하지 않도록 한다.

## 실행

최종 build가 있는 통합 worktree에서 `powershell -File scripts/core/start-local-test.ps1 -Port 3510 -WithIndexWorker`.
Graph `http://localhost:3510/#map`, 명함 `/#cards`, 녹음 `/#recordings`, AI `/?assistant=1#todos`.
기존 인덱싱 worker의 실행 여부를 확인해 중복 기동하지 않는다.

실제 휴대폰 카메라/마이크와 OCR/STT 정확도 벤치마크, 대규모 Graph 및 전체 접근성 적합성은 별도 검증 범위다.

## 최종 검증 결과

| 항목 | 결과 / 범위 |
| --- | --- |
| 단위 테스트 | 61개 파일, 334개 통과 |
| 핵심 기능 E2E | 최종 CSS 적용 후 45개 통과, 실패·skip 없음 |
| Graph E2E | 10개 통과. 선택/근거/확장/복귀/삭제, 합성 preview 쓰기 차단, 1440/1024/768/390px |
| 화면 비교 | 10월 17일 채택 화면과 비교. 폰트, 헤더 높이, 캔버스/상세 열 경계 검사 추가. [최종 캡처](../plans/assets/graph-visual-reviews/2026-10-18-integration/VD01-default-1440.png) |
| 실제 연결 | `/api/workspace` 200, preview header 없음, `assistantContext=true`, AI/OCR live, 인물 17명·만남 21건 읽기 확인 |
| 빌드/타입 | 순서 고정 CSS 진입점 적용 후 webpack production build 및 빌드 내 TypeScript 통과 |
| 런타임 | 실제 LC100/T8 WASM Worker 로딩·추론, 로컬 사진 JPEG 회전 검사 통과 |

검증 로그는 ignored `output/frontend-integration/`의 `unit-*.log`, `core-e2e-final.log`, `graph-ordered-entry.log`, `build-ordered-entry.log`, `lint-final.log`에 보존한다. 브라우저 핵심 흐름은 합성 API 응답을 사용하며 실제 유료 OCR/STT/LLM 품질 평가를 이번에 새로 수행했다는 의미가 아니다. 실제 연결 확인은 공유 데이터 읽기이며, 테스트로 실제 공유 인물을 생성하지 않았다.

원본 4316 worktree의 반입 파일은 종료 전 SHA-256 비교에서 시작 시점과 동일함을 확인했다. main에 있던 기존 계획 assets도 반입 자료와 같은 내용인지 확인하고 별도 보존한다. 외부 push/deploy는 수행하지 않는다.

## 인계 상태

- 기능 통합 커밋 `e0acf52`를 로컬 main에 fast-forward 반영했다.
- 실행 위치는 `D:/Persnapse/worktrees/persnapse-frontend-core`. 이전 core-integration의 3510 서버와 worker를 종료하고 이 worktree의 production 서버와 worker로 교체했다. 원본 4316 서버는 유지했다.
- 실제 3510 브라우저에서 명함→녹음→AI 업무→Graph 이동, workspace 200/live 모드, 채택 폰트 적용, pageerror 0을 확인했다. 증거: ignored `output/frontend-integration/live-smoke.json`.
- main의 기존 미추적 assets 원본은 `D:/Persnapse/persnapse-mvp/output/frontend-integration/preexisting-plan-assets`에 보존했다. 같은 내용이 버전 관리되는 assets로 반영됐다. 기존 루트 계획 문서 3개는 미추적 상태 그대로 유지했다.
- `npm run lint` 최종 재실행도 오류 0, 기존 경고 5. 라이선스 원문의 trailing whitespace는 원문 보존을 위해 변경하지 않았다.

## 2026-10-18 팀 공유 배포

- 사용자 요청: 전체 회귀 검증을 최소화하고 팀 테스트/시연 링크를 우선 제공.
- 배포: https://persnapse-3ghto67wx-choeseyong180-8216.vercel.app/#map
- Deployment: `dpl_24afZfvuc3mHav3MrwjGceV53yMB` (READY, Preview).
- 소스: main `3558692` + 배포 패키징 수정 `d44cf36`. CLI 업로드 후 패키징 변경을 커밋했으므로 Vercel Git 메타데이터와 커밋 시점은 다를 수 있다.
- 포함: 채택된 프론트/Graph, LC100 명함 복원/OCR, 녹음/STT, AI 어시스턴트.
- 배포 보완: 검증된 public 모델 파일을 클라우드 빌드 입력으로 재사용하고 SHA/크기를 재검증. prebuild 스크립트 업로드 허용, 테스트/로컬 사진 제외, webpack 빌드 사용.
- 첫 배포는 테스트 setup 제외에 따른 테스트 파일 타입 오류로 중단. 테스트 파일도 배포에서 제외한 두 번째 빌드는 컴파일/TypeScript 통과.
- 기존 ADR0016에 따라 프로젝트 보호 all을 유지하고 이 배포에만 공개 접속 예외 적용(최초 API 응답 200).
- 최소 확인: 인증 없는 /, /api/workspace, /api/recall/preparation 및 LC100/T8 모델 URL 모두 HTTP 200. 실제 서버 저장, live AI/OCR, assistantContext=true 확인.
- 이번 배포에서 실물 명함/마이크/유료 AI 호출과 전체 E2E는 재실행하지 않음. 팀 테스트로 후속 확인.
- 로컬 증거: output/rapid-deploy.log, output/rapid-deploy-verification.json (비커밋).
