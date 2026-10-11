# 백엔드 연결 전 검증 기준점 — 2026-10-07

> 최신 후속: [2026-10-08 검색·연결 전 점검](../operations/recall-and-integration-readiness-2026-10-08.md). 검색 16/16 ready, 실제 Capture→수정→Commit→Recall→관측·피드백 통과. 행동 kind·제공자 429·JSONB 로그 저장과 관측 오류를 수정했다. 격리 fixture 0, 기존 24개 table 보존. 다음은 typed DTO/CRUD와 UI 연결이며, 아래 미준비 3개/검색 미완료 표기는 이전 이력이다. Golden 근거 ID 2건의 엄격 실패와 의미 검토는 새 보고에서 구분한다.

> 후속: [2026-10-08 기록·명함 실제 저장 검증](../operations/capture-storage-verification-2026-10-08.md) 17개 시나리오와 전체 `verify`(167테스트·lint·타입·서식·빌드) 통과. 격리된 DB·Storage에서 저장·Identity·중복·오류 복구를 확인했고 명함 동시 업로드·검토 상태 오류를 수정했다. 아래 Capture/Commit 미완료 표기는 10월 7일의 이력이다. 다음은 검색 준비 3개와 live Recall 검증이다.

## 제품·작업 범위

제품의 기준은 명함/만남 맥락을 확인된 관계 기억으로 저장하고, 사람과 근거를 회상해 후속 행동을 판단하는 개인용 Business Relationship Memory다. 제품 정의, 시스템 설계, 원본 맥락 분석, 구현 계획, OCR 우선 기준점, 9월 30일 OCR 후속 목록과 ADR을 대조했다.

이번 단계는 연결 준비 검증과 검색 복구다. `koin-contact-map`의 1차 프론트와 기존 공유 배포는 유지한다. 확정된 방향과 데이터 원칙은 [ADR 0013](../decisions/0013-backend-readiness-and-search-recovery.md)에 기록했다.

| 프론트 작업 영역   | 연결할 제품 역할                                                                 |
| ------------------ | -------------------------------------------------------------------------------- |
| 일정/업무관리와 AI | 저장된 약속·행동, 근거 기반 Recall. 브리핑은 사실과 새 제안을 구분               |
| 관계 지도          | 확인된 사람·조직·행사·주제의 projection. 추론된 지인 관계를 사실로 표시하지 않음 |
| 인맥 관리          | 보수적인 Identity, 인물 Profile과 시간순 근거                                    |
| 만남 기록          | 행사·만남 Context와 참가자·출처                                                  |
| 명함 등록          | OCR → 수정 가능한 Draft → 명시적 인물 선택 → Commit                              |
| 녹음               | Voice → 전사 검토 → 기존 Text Context 흐름. 자동 확정 저장하지 않음              |

메일 초안은 근거를 활용하는 미실행 제안으로 연결한다. 행사 이미지의 웹 수집은 기존 제품 문서의 비범위였으나 이후 사용자 요청에 포함되었다. 핵심 저장/검색 연결 이후 출처·실패 상태를 포함하는 별도 확장으로 다룬다.

## 실제 확인한 상태

**최신: 2026-10-07 19:54 KST, Supabase 접속 복구 완료.** 사용자가 비활성화된 기존 프로젝트를 Resume했고 설정 변경 없이 DB·REST·private Storage 조회가 정상화됐다. `db:preflight` exit 0: 필수 table/RLS/migration/workspace/bucket 준비 통과, 인맥 16명·만남 21개·명함 2개. 실제 DB를 사용하는 검색 준비 GET handler도 `200`을 반환했다. 검색 문서는 13/16개 준비되어 3개 복구가 남았다. Capture/Commit/전체 live Recall·프론트 통합·신규 배포는 여전히 미완료다. 아래 접속 실패 기록은 재개 전 이력이다.

재개 전 코드 점검은 2026-10-07 19:18 KST 기준이다. 전체 `npm run verify`는 32파일·153테스트와 lint/typecheck/format/build를 포함해 통과했고, 실제 로컬 production 서버의 HTTP 기대 응답 16개를 확인했다. JSON 및 명함 업로드 입력 오류의 `500` 반환을 `400`으로 수정했다. 이 시점에는 DB 연결 실패로 프론트 통합·원격 저장 검증·신규 배포가 미완료였다. 상세 근거와 한계는 [후속 검증 보고](../operations/backend-provider-verification-2026-10-07.md)를 참고한다.

19:48 KST의 Supabase 심층 진단에서도 프로젝트 API/직접 DB 주소는 Google·Cloudflare 공개 DNS의 A/AAAA 모두 `NXDOMAIN`이었다. 공용 pooler의 DNS와 port 6543 TCP는 정상이며 PostgreSQL은 `TENANT_NOT_FOUND`를 반환했다. 로컬 DNS 캐시나 단순 포트 차단보다 Paused/이전 ref/프로젝트 DNS 등록 상태를 우선 확인한다. 관리 인증과 연결된 브라우저가 없어 실제 프로젝트 상태는 미확인이다. 이번에는 원격·환경·앱 코드를 수정하지 않았다.

| 항목                   | 결과                                        | 해석                                              |
| ---------------------- | ------------------------------------------- | ------------------------------------------------- |
| 로컬 설정              | env schema 통과, 필수 키 존재               | 키의 실제 사용 가능성은 별도 검증 필요            |
| 실행 모드              | AI `mock`, OCR `live`, 원격 접근 `off`      | live Recall 활성화 여부와 구분                    |
| Supabase 프로젝트 주소 | DNS 조회 실패                               | 프로젝트 상태는 관리 화면에서 확인 필요           |
| DB pooler              | DNS 조회 가능, `tenant not found` 연결 실패 | 현재 DB의 테이블·행 수·검색 상태를 확인할 수 없음 |
| 프로젝트 참조          | Supabase URL과 DB 접속 참조 일치            | 단순 참조 불일치는 발견되지 않음                  |
| 관리 화면 자동 확인    | 브라우저 도구 초기화 오류                   | 사용자에게 대시보드 확인을 요청한 상태            |

프로젝트가 일시 정지·삭제되었다고 단정하지 않는다. 과거 live 검증 보고의 행 수와 검색 준비 완료 수를 현재 상태로 인용하지 않는다. 비밀값과 인물 내용은 점검 로그에 출력하지 않는다.

## 추가한 복구 기능

- 검색 준비 상태 조회와 사용자 요청당 최대 2명의 검색 준비 재시도.
- 준비 완료 조건의 실제 vector 존재 검사, 중단된 처리와 실패 문서 복구.
- DB 연결/검색 준비 오류의 안전한 API 응답과 입력·진행 상태 보존.
- 읽기 전용 `npm run db:preflight`: DNS, 지정 워크스페이스 존재, 필수 table, RLS, migration, 검색 준비 개수, private 명함 bucket 확인. 실제 DB 연결이 실패하면 이후 항목을 검증했다고 보고하지 않는다.

## 검증

최초 검색 복구 구현 단계의 검증 이력. 이후 제공자 호출·서식 정리·HTTP 계약 수정의 최신 결과는 위 요약과 후속 보고를 기준으로 한다:

- lint 경고·오류 0, TypeScript 검사 통과.
- 단위 테스트 31파일·124개 통과. 추가한 검색 복구 관련 18개 포함. 실제 PostgreSQL/제공자를 대역으로 바꾼 검증이며 실제 DB SQL 실행을 증명하지 않는다.
- 프로덕션 빌드 통과. 새 `/api/recall/preparation` 경로 포함.
- 설치된 Chrome의 격리된 Playwright 세션에서 오프라인 E2E 5개 통과: 근거·피드백·초안 보존, 검색 복구의 명시적 배치·중복 차단·자동 검색 없음, 상태 조회 실패 복구, 호출 제한 후 수동 재시도. 합성 응답 사용, 원격 API 차단.
- 390px 검색 복구 화면의 가로 넘침 없음과 캡처 확인. 실제 모바일 기기 검증은 아님. `test-results/search-recovery-mobile.png`는 생성 산출물로 Git 제외.
- 전체 `npm run verify`는 기존 미추적 `docs/plans/ocr-follow-up-backlog-2026-09-30.md`의 Prettier 서식 문제로 중단. 사용자 문서는 수정하지 않았다. 변경 파일의 서식 검사와 별도 최종 lint/build는 통과했다.
- 최초 브라우저 실행의 새 테스트 2개는 Next.js의 빈 페이지 안내 `alert`까지 오류로 집계해 실패했다. 실제 화면 오류는 이미 해제되었음을 snapshot으로 확인하고, 검사를 `main` 내부로 한정한 뒤 5개 전부 재통과했다.
- OpenAI [공식 모델 조회 API](https://developers.openai.com/api/reference/resources/models/methods/list)로 로컬 설정 모델 `gpt-5.6-luna`, `gpt-5.6-terra`, `gpt-transcribe`의 목록 포함 여부를 HTTP 200 응답에서 확인했다. 생성 요청은 하지 않았으며, 목록에 있다는 사실은 Responses/STT 계약·잔액·속도 검증을 대신하지 않는다.
- `npm run db:preflight` 재실행 실패: `DNS_NOT_FOUND`와 `SUPABASE_TENANT_NOT_FOUND`. 현재 테이블·워크스페이스·RLS·migration·bucket·검색 준비 개수는 미검증이다.

실제 Capture/Commit/OCR/Recall 통합 검증과 프론트 연결은 이 최초 단계에서 미완료였다. 이후 접속 복구는 위 최신 상태를 기준으로 한다.

- 유료 제공자 호출 0회, 원격 DB 변경 0회, 배포 0회.
- 초기 변경 전 소스·문서·설정 백업: `tmp/backups/before-backend-readiness-20261007-180544.zip`. 비밀값·인증 파일·빌드 산출물 제외.
- 기존 사용자 수정 `docs/README.md`와 미추적 OCR 후속 목록을 보존했다.

## 재개 순서

### 최신 다음 단계 — DB 복구 후

접속 복구와 읽기 전용 preflight는 완료했다. 기존 프로젝트 재생성·reset·seed는 필요하지 않다. 다음은 아래 4번의 검증 스크립트 쓰기/정리 경계를 먼저 검토한 뒤 Capture 저장과 identity를 검증하는 단계다. 검색 준비 3개와 live Recall 검증, 이후 프론트 연결 순서를 유지한다.

### 후속 확인 — 실제 제공자 검증 완료

이번 후속 실행에서는 OpenAI 구조화·답변, Voyage 임베딩·재정렬, CLOVA OCR을 합성 데이터로 실제 호출해 모두 통과했다. 총 5회 호출이며 DB와 독립적으로 수행했다. 이전 절의 유료 호출 0회·생성 미검증 기록은 최초 준비 단계의 이력이다. 현재도 원격 DB 통합 검증은 미완료다.

기존 OCR 후속 문서의 표 서식만 정리했으며 내용·항목은 수정 전후 비교로 보존을 확인했다. 전체 검증의 최종 결과와 제공자별 관측·해석 범위는 [후속 검증 보고](../operations/backend-provider-verification-2026-10-07.md)를 참고한다.

1. Supabase 대시보드에서 기존 프로젝트 상태 확인. 필요하면 Resume 또는 `.env.local`의 Supabase/DB 설정 갱신. 비밀값을 채팅에 붙이지 않는다.
2. `npm run db:preflight` 재실행. 현재 DB와 지정 워크스페이스의 실제 상태를 확인한다. 실패 상태에서 reset/seed/migration을 실행하지 않는다.
3. 미적용 migration이 있다면 현재 DB와 차이를 검토한 뒤 필요한 것만 적용한다. 기존 데이터의 전체 덮어쓰기나 초기화를 하지 않는다.
4. 기존 DB 검증 스크립트의 쓰기·rollback 경계를 확인하고 Capture 저장과 identity 계약을 검증한다.
5. live 모드·모델 접근·검색 준비를 제한된 실제 요청으로 검증하고, 실패가 해결된 결과를 보고한다.
6. 이후에 프론트 데이터 계약과 화면 연결을 진행한다. DB 원본 없이 로컬 데이터와 서버 데이터의 이중 저장 구조를 먼저 만들지 않는다.
