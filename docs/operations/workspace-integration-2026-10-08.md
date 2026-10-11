# 프론트·백엔드 통합 — 2026-10-08

> 최신 UI/UX 개선 통합 버전: https://persnapse-bvmsnzac8-choeseyong180-8216.vercel.app/ . 로그인 없이 접속하며, [최신 개선·검증 기록](experience-review-2026-10-08.md)을 먼저 확인한다. 아래 배포 URL은 단계별 이력이다.

작업물: `D:\Persnapse\persnapse-mvp`. 기존 UI 원본과 팀 공유용 Production은 유지했다. [구현 결정](../decisions/0015-workspace-frontend-backend-integration.md)을 먼저 참고한다.

## 단계와 결과

| 단계         | 구현                                                                               | 검증                                                    |
| ------------ | ---------------------------------------------------------------------------------- | ------------------------------------------------------- |
| 1. 계약      | UUID, unknown date, KST, 인물/게스트, 일반 할 일/관계 약속, 버전/요청 ID 분리      | 계약·클라이언트 저장 테스트                             |
| 2. 서버      | Workspace GET/POST, 원자적 CRUD, 보관/복원, 감사 기록, 프로필/초안 저장            | 실제 Supabase의 격리 workspace 13개 시나리오 통과       |
| 3. UI 연결   | 기존 6개 메뉴, 서버 저장 상태, 검토형 Capture/OCR, 근거형 Recall, 실제 업무 브리핑 | 전체 단위 테스트 197개, 실제 DB·HTTP 브라우저 12개 통과 |
| 4. 검증·배포 | 실제 모델·Storage·모바일·응답 유실·동시 접속, 보호된 Preview                       | 보호된 Preview 배포·원격 조회 검증 통과                 |

## 확인된 정합성

- 같은 이름의 다른 사람을 합치지 않는다. 게스트와 일반 업무만으로도 저장할 수 있다.
- 서버 확인 전에 성공으로 표시하지 않는다. 유실된 응답은 동일 요청으로 재확인한다.
- 다른 기기의 오래된 수정은 거절하며 여러 변경 중 하나라도 실패하면 모두 rollback한다.
- 인맥/만남 보관과 참석자 수정이 Recall·업무·embedding projection에 같이 반영된다.
- 만남 설명/날짜 수정은 예전 AI 추론을 검색에서 제외한다. 원본은 보존한다.
- 기존 24개 테이블의 원래 컬럼 값/행 수/digest가 통합 작업 전과 일치했다. 테스트 fixture 잔여 행 0개.

실제 DB 검증 결과: `test-results/workspace-integration-37c01607-9d45-429b-b6b7-22121105965b.json` (13개 통과, 외부 모델 호출 0). 일반 unit/browser의 mock 결과와 실제 AI 검증은 구분한다.

## 검증 명령

```powershell
npm run verify
npm run db:verify:workspace
npm run build
npm run test:workspace:browser
npm run ai:verify:workspace
```

DB/browser 검증은 합성 데이터 전용 workspace를 생성하고 정리한다. browser 검증은 로컬 3399 포트에서 production server를 실행하며 Chrome을 사용한다. AI/OCR은 해당 프로세스에서만 mock이다. live 검증은 최대 8회 제공자 요청으로 제한하며 같은 유료 요청을 자동 재시도하지 않는다. `.env.local`은 수정하지 않는다.

## 백업과 복구

- 통합 전 소스: `tmp/backups/before-ui-backend-integration-20261008.zip` — 환경 파일 제외.
- 기존 데이터 비교 기준: `tmp/backups/workspace-integration-baseline-20261008.json` — 값 원문 없이 컬럼·건수·digest만 저장.
- 기존 프론트 공유 백업: `D:\Persnapse\backups\koin-contact-map-team-20261007`.
- 기존 Production: https://koin-contact-map-rho.vercel.app/?mode=demo . 이번 작업의 배포 대상이 아니다.
- DB 변경은 추가 schema/함수다. 되돌릴 때 원래 테이블이나 새 사용자 기록을 삭제하지 말고, 원래 배포를 사용하고 별도로 migration 계획을 세운다.

## 현재 제한과 후속 평가

- 녹음 오디오 서버 보관·STT는 미연결, 작성한 메모는 실제 저장된다.
- 메일 초안 저장은 연결, 생성은 예시 템플릿이다. 실제 LLM 생성·메일 데이터 연동·발송은 후속 작업이다.
- AI 채팅은 질문별 기억 검색이다. 직전 대명사까지 이해하는 연속 대화로 보장하지 않는다.
- 공유 workspace 페르소나는 팀 공유 설정이다. 개인별 로그인/권한을 구현하지 않았다.
- 전체 snapshot 방식이므로 대량 기록에 대한 성능 검증은 별도 필요하다. 6개 동시 읽기 성공이 6개 물리 기기 장기 부하 테스트를 의미하지 않는다.
- 기존 엄격 Golden 근거 ID 불일치 2건은 이번 UI 연결로 해결했다고 간주하지 않는다.
- `npm audit --omit=dev` 알려진 취약점 0개. 개발용 lint 의존성의 braces 체인 경고는 남아 있으며 무리한 메이저 다운그레이드는 하지 않았다.

## 최종 검증·Preview

- `npm run verify` 통과: lint 오류 0(외부 행사 이미지의 기본 img 사용 권고 2건), TypeScript, 36파일/197 unit tests, format, Next 16.3.8 production build.
- 배포 CLI 인자·인증 전달 회귀 3개 추가 후 전체 unit 36파일/197개 통과, 배포 스크립트 lint와 TypeScript 재검사 통과.
- 전체 Playwright 회귀 12/12 통과(Chrome, 2 workers). 이전 화면 이름과 자동 검색을 전제로 했던 테스트를 현재 명시적 검색 UX로 갱신했다. Recall UI 회귀는 합성 corpus로 실행해 공유 DB에 검색 로그를 남기거나 유료 호출을 하지 않는다.
- 실제 DB/HTTP 브라우저 12개 통과. 저장 응답 유실을 실제 HTTP write 이후에 주입하고, 초안 유지·동일 요청 복구·할 일 1개만 저장되는 것을 확인했다. OCR은 mock으로 업로드→검토→확정→private 이미지 조회까지 통과했다. 실제 OpenAI/CLOVA 결과 품질을 검증한 것으로 간주하지 않는다.
- 모바일 390×844에서 가로 넘침 없음, 브라우저 실행 오류 0. 6개 동시 GET이 같은 기록을 반환했으며 이번 배치 301ms. 장기 부하 수치가 아니다.
- 실제 제공자 합성 검증: 브리핑 4,796ms, Recall 5,920ms. 제공자 HTTP 요청 6회(OpenAI·Voyage); 응답이 실제 저장한 업무·기억 ID를 인용했다. 가짜 업무/근거 ID를 허용하지 않았다. fixture 잔여 행 0.
- AI/OCR이 기존 인맥에 사실을 추가하는 경우에도 인물 행을 잠그고 UI 버전을 올린다. 반복 commit은 버전을 추가로 올리지 않는다. 프로필 인라인 편집은 입력을 시작한 버전을 고정하며, 다른 컨트롤에서 최신 DTO를 읽었더라도 타인의 변경을 덮어쓰지 않는다. 실제 브라우저에서 409와 초안 유지를 재현·검증했다.
- 기존 Capture/명함 DB·Storage 17개 회귀도 재실행해 모두 통과했다. 테스트의 DB 행과 Storage 객체 잔여물 0, 원래 workspace의 29개 테이블 보존을 확인했다.
- 최종 기준 데이터 재확인: 원래 24개 테이블 건수·digest 일치, 임시 workspace 0개. 환경 파일은 보존했고 로컬 기본 모드는 기존 설정을 따른다. Preview는 live AI/OCR 설정을 별도 동기화했다.
- 업로드 전 비밀값 8종 잔류 검사: `.env.local` 밖 일치 0건. 생성된 Turbopack cache만 정리했다.

재현 결과:

- `test-results/integration-browser/result-9304b3b5-9bec-4b3f-a410-b7db05be063d.json`
- `test-results/workspace-live-3877e06e-e807-4f5d-8a42-3d757e5d1ea4.json`
- `test-results/workspace-final-baseline.json`
- `test-results/integration-browser/desktop-work.png`, `desktop-map.png`, `mobile-work.png`

Preview: https://persnapse-lm5uhrinz-choeseyong180-8216.vercel.app

후속 OCR 개선을 반영한 최신 통합 Preview는 https://persnapse-htb5dz6hx-choeseyong180-8216.vercel.app/ 이다. 아래는 최초 통합 배포 기록이며, 최신 검증은 [OCR 스프린트 검증](business-card-recognition-validation-2026-10-08.md)의 통합 버전 배포 반영 항목을 따른다.

이후 사용자 요청에 따라 최신 Preview 주소만 로그인 없이 접속하도록 공개 예외를 적용했다. 비인증 웹·API HTTP 200 및 새 브라우저 접속을 확인했다. 이전 배포는 보호를 유지한다. 상세 범위와 복구 방법은 [팀 Preview 공개 결정](../decisions/0016-public-team-preview.md)을 따른다.

- Vercel deployment `dpl_2dediPatkGezqj83uZmKSmTUWMiA`, READY, Preview 대상. Production 승격 없음.
- 인증된 `/`, `/api/workspace`, `/api/recall/preparation` 모두 HTTP 200. 비인증 접근은 HTTP 302로 보호됨. 팀원이 열려면 이 Vercel 프로젝트 접근 권한이 있는 계정으로 로그인해야 한다.
- 원격 snapshot: 인맥 16명, 확정된 만남 20개, 업무/행동 10개. `storage=server`, `aiMode=live`, `ocrMode=live` 확인. 검색 준비 16/16명.
- 원격 검증은 조회만 수행했다. 원격 live OCR·유료 모델 호출까지 새로 실행한 것으로 표현하지 않는다. 실제 모델 검증은 위의 격리된 live 합성 검증 결과다.
- 보고서: `test-results/workspace-preview-verification.json`.
- CLI 59.17의 curl 파서가 `--global-config`를 native curl로 전달하는 문제를 재현했다. [공식 파서 구현](https://github.com/vercel/vercel/blob/main/packages/cli/src/commands/curl/shared.ts)을 대조하고, curl만 기존 명시적 CLI 인증을 자식 프로세스 환경으로 전달하도록 수정했다. 인증 정보를 복사·로그 출력하거나 애플리케이션에 업로드하지 않았다. 접근 보호 해제도 하지 않았다.
