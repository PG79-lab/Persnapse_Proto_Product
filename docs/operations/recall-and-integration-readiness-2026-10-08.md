# 검색 복구·Recall·프론트 연결 전 점검 — 2026-10-08

## 핵심 결과

작업 대상은 `D:\Persnapse\persnapse-mvp`다. `koin-contact-map`은 읽기·test/lint/build만 수행했다. 프론트 이식과 신규 배포는 아직 하지 않았다.

| 항목              | 결과                                                                                                        |
| ----------------- | ----------------------------------------------------------------------------------------------------------- |
| Supabase          | DNS·DB·workspace·schema·RLS·migration·private 명함 bucket 정상                                              |
| 검색 문서         | 미준비 3개 복구, **16/16 ready**, 남은 문서 0                                                               |
| 실제 AI 저장→검색 | OpenAI 구조화 → 사용자 수정 → 명시적 신규 인물 → Commit → Voyage 준비 → live Recall → 관측·피드백 통과      |
| 저장 원칙         | 수정한 장소·날짜 미상 null·한국 시간의 약속 기한·약속/제안 종류 보존                                        |
| 데이터 보존       | 성공한 live 수직 검증과 무비용 로그 검증 각각 기존 workspace 24개 table count/digest 불변, 격리 fixture 0개 |
| 프론트 기준점     | 단위 테스트 55개·lint·Vite production build 통과                                                            |
| 연결 준비 판단    | Capture/Recall 핵심 경로는 연결 가능. 기존 UI를 그대로 API에 붙일 수는 없으며 아래 DTO·저장 계약 선행 필요  |

**2026-10-08 02:43 KST** 읽기 전용 `db:preflight`: 인물 16명·만남 21개·명함 2개 유지, 검색 16/16. `.env.local`은 `AI_ROUTING_MODE=mock`, OCR live, 원격 prototype 접근 off다. 실제 AI 검증은 해당 Node 프로세스에서만 live로 실행했다.

## 발견한 문제와 수정

| 문제                                           | 수정·확인                                                                                           |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Recall에서 DB의 행동 kind를 누락               | DB → corpus → 모델 → 응답까지 유지. 약속 질문에 저장된 제안을 대신 인용하는 답변 거절               |
| 제공자 429를 일반 503으로 표시                 | 별도 오류 코드·HTTP 429·대기 시간. 제공자 원문은 노출하지 않고 자동 재시도 없음                     |
| JSONB 로그가 JSON 문자열로 저장                | `sql.json`으로 객체 저장. parsed Query·답변·trace·attempt metadata 실제 DB 타입 확인                |
| 과거 trace에 처리 시간을 합치면 JSON 배열 생성 | 과거 값은 `legacyTrace`로 보존하고 객체 형태에 측정값 저장. DB 회귀 검증 통과                       |
| 없는 Query 관측을 성공으로 반환                | workspace 범위 UPDATE의 RETURNING 확인, 없는/다른 workspace Query 404, DB 장애 500                  |
| Recall이 알 수 없는 요청 필드를 무시           | strict 입력. legacy `/api/parse` payload와 client workspace는 400, AI 호출 전에 거절                |
| 브라우저 검증 시작 시 다른 보고서 삭제         | Playwright outputDir을 하위 디렉터리로 분리. 이전 원자료 소실 한계는 아래 기록                      |
| 오래된 화면 테스트 문구                        | 실제 검토 상태 문구와 일치시킴. 인물 선택 없이 Commit 불가·사용자 수정·신규 선택 검사는 그대로 유지 |

구체적 결정은 [ADR 0014](../decisions/0014-recall-action-kinds-and-persistence.md)를 참고한다.

## 실제 Recall 품질 — 연결 성공과 엄격 평가 구분

| 질문 유형 | 실제 결과                                                             | 엄격 Golden 검사                                                    |
| --------- | --------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 주제      | 정답 인물과 필수 memory 근거 확인                                     | 통과                                                                |
| 시간      | 정답 인물·8월 한국 날짜 범위·8/21 만남의 동남아 리서치 공유 기록 인용 | 지정 memory-statement ID 대신 같은 만남 interaction을 인용해 미통과 |
| 약속      | 정답 인물과 실제 pending commitment 인용                              | 지정 9/3 기록 대신 추가된 9/12 기록을 인용해 미통과                 |
| 동명이인  | 두 후보를 제시하고 명확화 요구                                        | 통과                                                                |
| 결과 없음 | 무관한 기록으로 인물을 만들어 내지 않음                               | 호출 간격을 둔 후 통과                                              |

약속 질문의 대체 기록도 부산·물류·실증·제안서 조건을 포함한 확인된 만남과 pending 약속임을 DB에서 별도로 확인했다. 인물을 맞췄다는 이유만으로 처음부터 정상이라고 판단하지 않았고, 해당 원천 기록을 확인한 후 의미상 유효한 대체 근거로 분류했다. 원래 Golden 기대값은 변경하지 않았다. 엄격 검사는 **3/5 유형 통과, 2/5 근거 ID 불일치**이며 일반 사용자 품질이 완성됐다는 뜻은 아니다. 다음 평가 개선은 격리·고정된 Golden fixture와 허용되는 대체 근거의 명시적 판정이다.

실제 작은 표본의 Recall 서비스 지연은 약 **5.3~8.9초**, 마지막 합성 수직 검증은 **7.781초**다. 6초 목표를 안정적으로 달성하지 못했다. 22초의 검증 간격은 측정에서 제외했다. 현재 답변은 독립 Recall 요청이며 프론트 채팅의 이전 메시지를 모델이 기억하는 multi-turn 계약은 없다.

## 프론트 연결 전 계약과 통과 조건

| 영역               | 현재 차이·점검 결과                                                                                 | 연결 전에 할 일                                                                                                              |
| ------------------ | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 실행·원본 저장소   | UI React 18/Vite, 백엔드 React 19/Next. UI는 localStorage, 백엔드는 Supabase                        | Next 안에 Client Component로 단계적 이식. Supabase를 유일한 실제 원본으로 사용하고 데모는 분리                               |
| 인물 ID·Identity   | `person_UUID`·`demo_person_*` vs 서버 UUID. 이름 자동 병합 금지                                     | 타입 DTO와 API adapter, 명시적 기존 인물/신규 선택. 자동 일괄 이관·가짜 인물 생성 금지                                       |
| AI 어시스턴트      | 기존 `/api/parse`의 result/mode와 `/api/recall`의 answer/results/evidence/queryId 계약 상이         | Capture 입력·Review/Commit과 Recall 검색을 분리. 검색 답변을 저장 명령으로 자동 실행하지 않음                                |
| 명함               | 프론트 base64 JSON·여러 장·WebP 입력 vs 단일 multipart 원본/표시 이미지                             | 기존 두 단계 검토 보존. JPEG/PNG, 원본 ≤2.3MB·표시 ≤1.5MB·합계 4MiB 미만에 맞춰 준비. 게이트웨이 전체 요청 제한 4.4MB도 준수 |
| 캘린더·할 일       | UI의 인물 없는 업무, date/time·done vs 필수 person_id, due_at·status·kind                           | 독립 업무 모델을 먼저 결정. null 날짜를 오늘로 바꾸지 않음. KST 입력→UTC 저장→KST 표시, 완료/취소 ID 유지                    |
| 만남·게스트        | UI 여러 참석자/게스트·이미지/출처 vs 한 인물 Capture 흐름                                           | 그룹 Interaction/참석자 계약과 게스트 처리 설계. 게스트를 확정 Person으로 자동 생성하지 않음                                 |
| 관계 지도·용도     | UI 수동 categories/personLinks, 백엔드 확인된 관계 projection                                       | 읽기 DTO·필터·사용자 분류 저장·관계 종류/출처 명시. AI 유사도를 지인 관계로 표시하지 않음                                    |
| 목록·수정·삭제 API | 서버 내부 Profile/조회 및 Capture 서비스는 있으나 UI용 인맥·만남·업무·그래프 JSON CRUD는 없음       | 필요한 DTO/CRUD와 서버 검증부터 구현. 편집·새로고침·실패·중복 요청·여러 기기 조회를 실제 DB로 검증                           |
| 입력·오류          | JSON 입력·상태 오류·검색 미준비·429는 검증. 일부 동적 경로의 잘못된 UUID가 DB 오류로 이어질 수 있음 | adapter는 서버 UUID만 전송. 동적 ID validation도 연결 전 보완하여 잘못된 ID를 4xx로 통일                                     |
| 저장·재시도        | 로컬 저장됨은 기기 저장을 뜻함. Commit 후 embedding만 실패할 수 있음                                | 서버 응답 후 저장 성공 표시. 실패 시 초안 유지. confirmed 저장과 검색 준비를 구분하고 준비 완료 후 명시적으로 재검색         |
| 접근·키            | 서버 전용 제공자/DB/Storage 키, 공유 workspace. localhost/보호된 Vercel Preview 정책                | 동일 origin API와 Vercel 접근 보호 유지. 개인 계정별 인증·데이터 분리 완료로 소개하지 않음                                   |
| 부가 기능          | 녹음 UI는 로컬, STT 파이프라인 미연결. 브리핑·persona 메일·행사 이미지의 신규 백엔드 미구현         | 핵심 Capture/Recall 연결 후 별도 task 구현. 전사/메일은 사용자 검토, 외부 발송 자동 실행 없음                                |

통합 순서: **typed DTO/adapter 및 인맥 읽기 → Capture/Recall 연결 → 인맥·만남 편집 → 독립 할 일 계약·캘린더 → 그래프 → 녹음/STT·브리핑·메일**. 각 단계에서 실제 저장 결과와 다시 읽은 값을 대조하고, 기존 공유 배포는 별도로 유지한다.

## 검증 실행·한계

- 최종 `npm run verify` 통과: lint/type/unit **33파일·183테스트**/format/Next production build.
- 백엔드 UI: 설치된 Chrome의 격리된 headless Playwright 세션에서 오프라인 테스트 7개를 확인했다. 최초 6/7 후 오래된 문구의 1개를 수정해 단독 재통과. 실제 제공자 응답을 대체한 UI 검증이며 live 브라우저 검증은 아니다.
- 최초 기본 Playwright 실행은 관리형 Chromium 실행 파일 미설치로 12개 모두 launch 전에 실패했다. 설치된 Chrome channel로 필요한 오프라인 범위를 검증했고 원격 API는 차단했다. 기본 `npm run test:e2e` 전체 12개 통과로 보고하지 않는다.
- 새 수직 verifier: 실제 Route Handler를 직접 호출해 원격 DB와 live 제공자를 사용했다. HTTP listener/proxy·Vercel·모바일 기기의 전체 흐름 검증을 대신하지 않는다. 6회 HTTP 200, 처리 단계 5개 통과, fixture 0, 기존 24개 table 불변.
- 새 무비용 저장 verifier: JSON 객체 쓰기, attempt metadata, 다른 workspace Query 접근 차단, 과거 trace 보존·관측/평가 기록의 5개 검증 통과. 외부 호출 0.
- 실제 Voyage 429를 한 번 관측했다. 조직/프로젝트 RPM·TPM과 팀원 6명 동시 사용 수용량은 미확인이다. 필요 시 보호된 Preview에서 동시 사용 부하를 다음 단계로 검증한다. 이 결과가 무제한 호출 가능성을 뜻하지 않는다.
- 최종 secret residue 검사: `.next/cache/turbopack`에서 로컬 환경값 복사본을 발견해 기존 정리 도구로 생성 캐시만 삭제했다. 재검사 8개 비밀값 기준 `.env.local` 밖 일치 0개. 클라이언트 유출이나 원격 배포 유출로 확인된 것은 아니며 캐시는 다음 빌드 때 재생성될 수 있다. 기존 `.vercelignore`는 `.next`·환경 파일·보고서·백업을 제외한다.

최종 성공 원자료는 Git/배포 제외 `test-results/capture-recall-readiness-20261008-fixed.json`, `test-results/recall-storage-*.json`이다. 최초 수직 검증은 저장/Recall까지 통과했지만 JSON trace 검사에서 실패했고, fixture 비용 예약 FK 때문에 정리가 실패했다. 원래 실패 보고는 유지했다. 이후 정확한 테스트 workspace UUID·이름을 대조해 예약/fixture를 수동 정리했고 잔여 0을 확인했다. 개선된 verifier는 해당 fixture 예약만 제거하며 기존 workspace의 비용 이력은 건드리지 않는다.

처음 실행한 Playwright의 기본 출력 폴더 정리로 초기 검색 복구/Golden 원자료 JSON과 이전 생성 산출물 일부가 소실됐다. 위 초기 수치와 실패 이력은 세션의 명령 출력에서 확인한 요약이며 원자료가 남아 있다고 주장하지 않는다. 이후 출력 폴더 분리로 신규 보고서가 보존되는 것을 확인했다. 유료 검증을 보고서 재생성만을 위해 반복하지 않았다.

## 검증 도구

```powershell
npm run db:preflight
npm run db:verify:recall-storage
# 아래는 별도 live 승인 범위에서만. 자동 재시도 없음, report 존재 시 중단.
npm run ai:verify:recall-readiness -- --confirm-live --cases=topic,ambiguity --report-tag=review
npm run ai:verify:capture-recall-readiness -- --confirm-live --confirm-test-writes --report-tag=review
```

검색 복구 3개는 이미 완료했다. `ai:verify:search-recovery`를 재실행할 이유가 없다. 일부 이전 유료 verifier는 과거 일/월 한도·보고 형식을 사용하므로 현재 검증에 그대로 사용하지 않는다. 변경 전 코드 백업: `tmp/backups/before-recall-readiness-fixes-20261008.zip`.
