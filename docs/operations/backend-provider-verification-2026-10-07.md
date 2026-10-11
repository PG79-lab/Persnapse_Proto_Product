# 백엔드 연결 준비 — 실제 제공자 검증 결과

- 확인일: 2026-10-07, Asia/Seoul.
- 범위: 현재 설정 모델·production adapter의 최소 실제 입출력 검증. 합성 데이터만 사용.
- 최신 상태: 사용자 Resume 후 19:54 KST에 DB·REST·Storage 조회 복구를 확인했다. 실제 Capture/Commit/Recall의 전체 연결은 아직 검증하지 않았다.

## 결과

| 항목             | 제공자·모델            | 결과                                                                               | 단일 관측 시간 |
| ---------------- | ---------------------- | ---------------------------------------------------------------------------------- | -------------- |
| 만남 맥락 구조화 | OpenAI `gpt-5.6-luna`  | production Capture schema 통과, 이름 보존, 만남 날짜와 약속 기한 구분              | 4.350초        |
| 검색 문서 임베딩 | Voyage `voyage-4`      | 실제 1024차원 finite vector                                                        | 0.626초        |
| 관련 문서 재정렬 | Voyage `rerank-3-lite` | 합성 문서 2개 중 관련 문서를 1위로 반환                                            | 0.267초        |
| 근거 기반 답변   | OpenAI `gpt-5.6-terra` | 실제 Assistant schema와 기존 evidence 검증 통과, 해당 인물·만남 ID 연결            | 2.767초        |
| 명함 OCR         | Naver CLOVA            | extraction schema 통과, 이름·조직 감지, 이메일·전화·웹사이트 각 1개, 관측 필드 8개 | 1.673초        |

OpenAI/Voyage 4회와 CLOVA 1회, 총 5회 실제 요청을 수행했다. 자동 재시도와 대체 모델 호출은 하지 않았다. 원격 DB 쓰기·배포·환경 업로드는 없었다. 로컬 `.env.local`의 AI `mock`, OCR `live`, 원격 접근 `off` 설정은 유지했다.

## 무엇을 확인했는가

- 기존 `createOpenAiCaptureAdapter`, `AssistantProvider`, Zod schema와 `validateAssistantAnswer`를 사용했다.
- 구조화 입력은 고정된 합성 인물·만남·약속이다. 사용자나 DB의 원문을 제공자에게 전송하지 않았다.
- 답변 입력은 합성 확인 근거다. 두 조건의 근거가 같은 만남에 속하며 응답의 인물·근거 ID가 주어진 corpus 안에 있는지 검사했다.
- 임베딩·재정렬·답변은 독립 adapter 호출이다. DB 후보 검색 결과를 실제로 전달한 end-to-end 실행은 아니다.
- 이 독립 검증은 DB 호출 예약·telemetry 대신 검증기 자체의 최대 4회 요청 제한을 사용했다. 애플리케이션 경로의 DB 기반 단기 호출 방어를 변경하거나 검증한 것으로 취급하지 않는다.
- OpenAI 응답의 JSON schema 설정은 [공식 Structured Outputs 문서](https://developers.openai.com/api/docs/guides/structured-outputs)를 대조했다. 형식 검증과 근거 ID 검사는 자연어 의미 정확성 전체를 보증하지 않는다.

## 성능·품질 해석

각 시간은 합성 입력 1건에서 얻은 단일 관측값이다. p50/p95, 동시 사용자 성능, 실기기 성능이나 일반 정확도 수치가 아니다.

CLOVA의 1.673초는 생성된 합성 명함을 adapter에 제출한 이후의 시간이다. 카메라·전처리·Storage 업로드·DB·검토 화면 표시가 포함되지 않는다. 이름/조직 존재와 연락처 필드 감지를 확인했으며, 모든 필드의 정확한 값 비교나 실제 명함 품질 평가는 하지 않았다.

## DB 차단 원인 확인 — 재개 전 이력

- 읽기 전용 `db:preflight` 재실행: 프로젝트 DNS 실패, pooler DNS 조회 가능, DB `tenant not found`.
- Supabase CLI `projects list`는 관리 인증 부재로 실패했다. 환경 관리 토큰과 기존 CLI 토큰 파일도 확인되지 않았다.
- 관리 화면 도구는 초기화의 경로 오류로 사용할 수 없었다. 사용자에게 대시보드 확인을 요청했다.
- 연결된 Vercel 프로젝트·팀을 검증한 뒤 Preview 환경의 Supabase 주소만 비교했다. 로컬과 동일한 프로젝트 주소이며 해당 주소도 DNS 조회에 실패했다. 원격 값·키는 출력하지 않았고 환경은 변경하지 않았다.
- 기존 Vercel 프로젝트의 All Deployments 보호가 활성인 것을 확인했다.

일시 정지 여부는 아직 미확인이다. [Supabase 공식 재개 절차](https://supabase.com/docs/guides/platform/free-project-pausing)에 따라 대시보드에서 상태를 확인하고, Paused인 경우 Resume한다. 관리 API/CLI 인증은 별도의 [Supabase 관리 토큰](https://supabase.com/docs/guides/platform/personal-access-tokens)이 필요하며 애플리케이션 DB 키가 그 권한을 대신하지 않는다.

## 검증 산출물

- `test-results/provider-readiness-20261007.json`: OpenAI/Voyage의 정제된 결과·HTTP 상태·토큰·지연. 키와 원문 응답 없음.
- `test-results/verify-provider-readiness-20261007.mjs`: 이번 합성 검증에 사용한 임시 실행기. 기존 보고서가 있으면 유료 재실행을 차단한다.
- `npm run ai:verify:clova`: 기존 합성 명함 OCR 검증기 사용. 설치된 Chrome을 선택할 수 있도록 fixture 생성기도 `PLAYWRIGHT_CHANNEL=chrome`을 지원한다. 기본 Chromium 동작은 유지한다.
- 기존 OCR 후속 문서의 내용·항목을 보존하고 표 정렬만 수정했다. 수정 전후 표 내용과 나머지 본문을 비교해 동일함을 확인했다.

## 로컬 전체 검증

최종 `npm run verify` exit code 0. lint, TypeScript, 단위 테스트 31파일·124개, 저장소 전체 Prettier 검사와 프로덕션 빌드가 모두 통과했다. 이전 실행의 문서 서식 차단은 해소되었다. 기존 브라우저 회귀 5개 통과 기록도 유지한다. 이번 후속 변경은 검증 fixture의 브라우저 선택과 문서 서식·검증 기록이다.

검증 산출물은 Git에서 제외한다. 접속 복구 후 [검증 기준점의 재개 순서](../handoff/2026-10-07-backend-readiness.md)에 따라 DB 저장·identity·명함 Storage·검색 준비·실제 Recall을 먼저 검증한다.

## 후속 백엔드 점검 — 2026-10-07 19:18 KST

사용자의 백엔드 점검 요청으로 연결 상태와 HTTP 입력 계약을 재확인했다. 이번 점검은 유료 호출·환경 변경·DB 쓰기·배포 없이 진행했다.

| 점검 항목                    | 결과                                               | 검증 범위                                                                                               |
| ---------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| DB 읽기 전용 preflight       | 실패: `DNS_NOT_FOUND`, `SUPABASE_TENANT_NOT_FOUND` | 19:13 KST 재확인. schema·RLS·Storage·실제 저장/검색은 미검증                                            |
| 잘못된 JSON·명함 업로드 입력 | 수정 완료                                          | 입력 오류를 `500` 대신 `400`과 정제된 오류 코드로 반환                                                  |
| 전체 로컬 검증               | `npm run verify` exit 0                            | lint·typecheck·32파일 153테스트·전체 format·production build 통과                                       |
| 실제 production 서버 HTTP    | 16개 기대 응답 통과                                | localhost의 JSON 10경로, multipart 오류/이미지 누락, 미지원 메서드, DB 장애 `503`, 원격 접근 차단 `404` |
| OpenAI·Voyage·CLOVA          | 이번 재호출 없음                                   | 앞선 합성 실제 호출 검증 이력은 유지. DB를 포함한 live 실행 성공으로 해석하지 않음                      |

`src/server/http/request-body.ts`에서 HTTP body 읽기 실패만 `RequestInputError`로 구분한다. 서비스 안에서 발생하는 `SyntaxError`까지 입력 오류로 취급하지 않는다. JSON body를 읽는 10개 API 경로와 명함 multipart 입력에 적용했고, 정상 Capture/Recall/명함 요청 계약을 유지했다. 기존 schema validation, 이미지 크기 제한, 접근 정책, identity/commit 동작과 모델 라우팅은 변경하지 않았다.

새 `tests/backend/api-input-contract.test.ts` 29개 중 수정 전에는 23개가 실패했다. 잘못된 JSON·누락 이미지·읽을 수 없는 multipart의 서버 오류를 재현했으며, 수정 후 29개 전부 통과했다. 잘못된 입력에 DB·제공자 작업이 시작되지 않는 것과 정상 요청의 서버 workspace 사용, 서비스 오류의 `500` 유지·원문 미노출을 검사했다. 저장/제공자 대역을 사용한 계약 검증으로 실제 PostgreSQL 저장을 증명하지 않는다.

실제 HTTP 점검은 프로덕션 빌드를 `127.0.0.1:3199`에서 임시 실행해 수행한 뒤 서버를 종료했다. 성공하는 생성/commit/검색 준비 POST는 보내지 않았고, DB 요청은 검색 상태의 읽기 전용 GET뿐이다. DB 장애 `503`의 기대 응답 통과는 DB 연결 성공을 의미하지 않는다.

- `test-results/backend-http-check-20261007.mjs`: 로컬 HTTP 확인 실행기.
- `test-results/backend-http-check-20261007.json`: 19:18 KST의 16개 HTTP 응답 기록. 비밀값·인물 원문 없음.
- 다음 필수 단계: Supabase 대시보드에서 기존 프로젝트 상태 및 현재 연결 정보 확인 → 연결 복구 후 preflight → Capture/Commit/명함 Storage/실제 Recall 순서로 검증. 아직 통합 앱이나 새 배포는 만들지 않았다.

## Supabase 연결 장애 심층 진단 — 2026-10-07 19:48 KST

사용자의 장애 진단·직접 해결 요청에 따라 기본 연결 검사 외에 독립 DNS resolver, TCP와 관리 인증을 확인했다. 읽기 전용이며 `.env.local`, 원격 DB, 배포 환경은 변경하지 않았다.

| 확인 대상                          | 관측 사실                                                                                                         | 해석·한계                                                                                 |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 프로젝트 API 주소·직접 DB 주소     | OS, Google DNS, Cloudflare DNS의 A/AAAA 조회 모두 실패. 공용 resolver의 응답은 `NXDOMAIN`                         | 이 프로젝트 hostname의 공개 DNS가 확인되지 않음. PC DNS 캐시만의 문제로 설명되지 않음     |
| 공용 pooler·Supabase 관리 API 주소 | OS·Google·Cloudflare 조회 성공                                                                                    | 전체 Supabase 도메인 접근 실패가 아님                                                     |
| DB pooler port 6543                | TCP 연결 성공, PostgreSQL `XX000`/`TENANT_NOT_FOUND`                                                              | 포트 차단보다 프로젝트 식별·pooler 매핑·프로젝트 가동 상태를 먼저 확인                    |
| 로컬 설정                          | URL/계정 형식, API·DB 프로젝트 ref 일치, `/postgres`, port 6543, 비밀번호 placeholder 없음, 실행 환경과 파일 일치 | 형식과 내부 일관성만 검증. Dashboard의 실제 ref·pooler host·비밀번호가 맞다는 보증은 아님 |
| 키 연결성                          | 두 키는 project ref를 읽을 수 없는 opaque 형식                                                                    | 이 프로젝트의 유효한 키인지 실제 API에서 아직 검증할 수 없음                              |
| 관리 인증                          | 관리 token 환경 변수 없음, CLI `projects list` 인증 실패                                                          | 기존 앱 secret/DB 비밀번호로 프로젝트 상태 조회·재개를 대신할 수 없음                     |
| 관리 UI                            | native pipe 없음, 브라우저 목록 비어 있고 IAB 사용 불가                                                           | 대시보드를 직접 읽거나 Resume를 실행하지 못함. 로그인된 브라우저가 있다고 가정하지 않음   |
| 공식 status                        | 조회 당시 All Systems Operational                                                                                 | 전역 장애 공지는 없었음. 개별 프로젝트 문제는 제외하지 못함                               |

근거 파일은 Git 제외 경로 `test-results/supabase-diagnosis-20261007.json`과 동일 이름의 `.mjs` 실행기다. 출력은 판정·상태 코드만 포함하고 DB 주소·계정·비밀번호·키·실제 인물 내용은 기록하지 않는다. DNS 조회에는 프로젝트 hostname이 resolver에 전달되며 원본 자료는 전달되지 않았다. `.env.local`은 2026-09-29 이후 수정되지 않았다.

### 원인 우선순위와 복구

1. **Paused 확인:** Dashboard에서 현재 설정이 가리키는 기존 프로젝트를 확인한다. Paused이면 `Resume project`를 실행한다. Free 프로젝트는 낮은 사용량이 7일 이어지면 자동 중지될 수 있고, 중지된 프로젝트는 hostname이 사라질 수 있다. 실제 중지 여부는 관리 화면 미확인 상태이므로 추정이다. 기존 데이터·설정을 유지하는 재개를 우선한다.
2. **Active이면 주소 대조:** Dashboard의 ref와 Project URL을 로컬 설정과 비교한다. `Connect → Transaction pooler`의 연결 문자열 전체를 다시 복사해 `DATABASE_URL`과 대조한다. host의 cluster index/region을 추측하지 않는다. API 주소와 DB 사용자 ref가 서로 일치해도 둘 다 이전 프로젝트를 가리킬 수 있다.
3. **Active·ref 일치인데 공개 DNS가 계속 없음:** 개별 프로젝트 DNS/provisioning 문제 가능성이 남는다. Supabase 공식 지원 경로에 Dashboard 상태, DNS 판정, pooler 오류를 전달해야 한다. 근거 없는 Pause/Resume 반복·비밀번호 변경·프로젝트 새로 만들기를 직접 실행하지 않았다.
4. **프로젝트가 목록에 없음:** 조직·계정 선택, 이전 프로젝트 주소 사용, 삭제 여부를 확인한다. 삭제 여부를 DNS만으로 확정하지 않는다. 새 프로젝트로 교체하면 schema·워크스페이스·기존 데이터·키·배포 환경까지 별도 복구 계획이 필요하다.

재개나 설정 수정이 확인되면 `npm run db:preflight`를 실행한다. DNS/DB 연결 성공 후에만 schema·workspace·RLS·migration·private Storage를 평가한다. 그 다음 실제 Capture/Commit/Recall 검증으로 진행한다. 이번 진단에서는 로컬에서 직접 수정할 확정 원인을 찾지 못했고, 사용자에게 Dashboard 상태 확인을 요청했다.

공식 근거:

- [NXDOMAIN 진단](https://supabase.com/docs/guides/troubleshooting/nxdomain-error-connecting-to-a-supabase-project): project ref, Paused, 삭제, 네트워크 문제 구분.
- [Tenant/user not found 진단](https://supabase.com/docs/guides/troubleshooting/tenant-or-user-not-found): host·username 매핑과 Connect 문자열 복사.
- [프로젝트 중지·재개](https://supabase.com/docs/guides/platform/free-project-pausing): 기존 프로젝트 재개와 데이터·설정 보존.
- [DB 연결 방식](https://supabase.com/docs/guides/database/connecting-to-postgres): Vercel의 transaction pooler, port 6543, prepared statement 비활성화. 현재 클라이언트의 `prepare: false`는 유지한다.
- [CLI 관리 인증](https://supabase.com/docs/reference/cli/supabase-login): CLI는 별도의 관리 인증을 사용한다.
- [서비스 상태](https://status.supabase.com): 조회 당시 전역 서비스 정상. 프로젝트 자체 상태 검증은 아님.

## Resume 후 연결 복구 확인 — 2026-10-07 19:54 KST

사용자가 기존 프로젝트의 장기간 비활성화와 Resume 실행을 확인했다. 이후 DNS가 먼저 복구되고 DB/API가 순차 정상화됐다. 로컬 `.env.local`, 연결 문자열·키·클라이언트 코드를 수정하지 않고 기존 설정으로 재접속했다. 이 경과는 중지 상태가 이번 장애 원인이었음을 뒷받침하며, 이전 절의 원인 미확인·접속 실패는 재개 전 이력이다.

| 시점(KST) | 관측                                                                                                  |
| --------- | ----------------------------------------------------------------------------------------------------- |
| 19:48     | OS·Google·Cloudflare에서 프로젝트 DNS `NXDOMAIN`, pooler TCP 연결 가능하나 tenant 없음                |
| 19:51     | 사용자 Resume 확인 후 프로젝트 DNS 정상. DB tenant 없음, REST `502/521` 지속                          |
| 19:53:50  | 서버 secret key로 workspace·인맥 REST 조회 `200`, private 명함 bucket 조회 성공                       |
| 19:53:52  | 읽기 전용 `db:preflight` exit 0, `ready: true`                                                        |
| 19:54:27  | 실제 PostgreSQL을 사용하는 `/api/recall/preparation` GET handler 직접 호출 `200`, `private, no-store` |

최종 preflight 확인:

- 지정 workspace 존재. 인맥 16명·만남 21개·명함 2개.
- 필수 table 누락 없음, 조사한 public table의 RLS 비활성 없음, 미적용 migration 없음.
- `business-card-assets` bucket 존재·private.
- 현재 모델로 준비된 검색 문서 13/16개. 3개 미준비·재시도 가능, 활성 처리 0개.
- AI 모드는 기존 `mock`, OCR은 `live` 유지. 연결 복구·schema 준비 통과와 live Recall 준비 완료를 구분한다.

REST 확인은 원본 행·인물 정보를 출력하지 않는 count/head 조회와 bucket metadata 조회다. GET handler 직접 호출은 실제 DB SQL을 사용했지만 HTTP listener를 통한 요청이나 전체 Recall 실행은 아니다. 이번에는 DB 쓰기·검색 문서 임베딩·유료 모델 호출·배포를 수행하지 않았다.

재개 직후의 일시 오류는 [Supabase 공식 서비스 상태 문서](https://supabase.com/docs/guides/troubleshooting/project-status-reports-unhealthy-services)의 복원 후 수분간 서비스 정상화 설명과 일치한다. 비밀번호나 pooler host를 임의 교체할 필요는 발견되지 않았다.

다음 작업은 기존 검증기의 쓰기·정리 경계 확인 후 Capture/Commit/Identity/명함 Storage 수직 검증이다. 검색 문서 3개 복구와 live Recall은 실제 제공자에게 기억 내용이 전송되는 별도 실행 단계로 진행한다. 프론트 통합과 기존 공유 배포 변경은 아직 수행하지 않았다.
