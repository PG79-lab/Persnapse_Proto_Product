# Persnapse MVP — 새 Codex 세션 통합 인계

> 최신 작업 순서와 미해결 장애는 [9월 25일 OCR 우선 개발 기준점](2026-09-25-ocr-priority-checkpoint.md)을 먼저 확인한다. 아래 기록은 작성 시점의 이력이다.

- 기준일: 2026-09-22
- 목적: 긴 기존 대화를 다시 읽지 않고 현재 작업물에서 안전하게 이어가기 위한 시작 문서
- 상태: 구축 이력·현재 로컬 상태·직전 Astra 검토·다음 작업 제안을 통합. 제안한 개선은 아직 미구현.
- 이번 작성에서 확인한 것: 프로젝트 지침, Git 상태, 패키지·운영 문서, 로컬 설정 파일 존재 여부.
- 이번 작성에서 하지 않은 것: 앱 기능 재검증, 유료 API 호출, DB 쓰기, 원격 설정 확인·배포, 코드 수정, commit·push.
- 작업 경로: D:\Persnapse\persnapse-mvp

## 0. 다음 세션은 여기서 시작

### 핵심 상태 8개

1. **새 프로젝트를 만드는 작업이 아니다.** 이미 작동하는 앱·Supabase 데이터 구조·실제 Clova OCR·보호된 Vercel Preview가 있다.
2. **현재 결과물은 커밋보다 앞서 있다.** 로컬 main의 HEAD는 cc17d51, 메시지는 'feat: complete phase 4 text capture'. Phase 5·OCR·비용 방어·배포·검토 문서가 미커밋으로 남아 있다. staged 변경은 없다.
3. **동일한 기존 폴더의 작업 트리를 이어가야 한다.** 커밋만 checkout한 새 worktree·clone에서는 미커밋·untracked 작업과 로컬 설정·원본 자료가 빠질 수 있다. 이동·복사·커밋을 임의로 하지 않는다.
4. **Preview는 실제 OCR + mock Context + 로컬 Recall의 조합이다.** 모델 설정·독립 API 시험 성공을 실제 제품 연결 완료로 오해하지 않는다.
5. **기술적으로는 저장·보호 기반이 있으나 원본 명세의 인터뷰용 MVP는 미완성이다.** 기본 Graph·Voice·실제 분석·행동 제안·피드백 흐름이 부족하다.
6. **직전 검토에서 실제 결함을 재현했다.** 날짜만 맞는 무관한 검색 결과, '오늘' 조건 누락, '어제'를 오늘로 처리하는 mock, 정확한 OCR 텍스트의 이름·회사 오분류다.
7. **다음 가치는 기반 추가가 아니라 한 번의 완결된 사용자 경험이다.** 기존 코드를 활용해 작게 수정하고 실제 입력으로 확인한다.
8. **이 문서는 새 권한을 부여하지 않는다.** 후속 사용자가 검토를 요청했는지 구현을 요청했는지 구분하고, 배포·유료 호출·권한 변경은 별도 범위를 확인한다.

### 짧은 읽기 순서

1. [AGENTS.md](../../AGENTS.md)와 이 문서의 0·5·6·8절.
2. [Technical Spec 검토·개선 인계](../context/03-technical-spec-review-handoff-2026-09-22.md)의 F-01~F-05 및 재현 조건.
3. 원본 [Context Business Card MVP v0 — Codex Technical Spec](<../inputs/Context Business Card MVP v0 — Codex Technical Spec.md>)의 P0·핵심 UX·성능·Acceptance·Cut·성공 상태.
4. 실제로 수정할 경로의 코드·테스트만 읽는다. 배포·DB 작업을 할 때만 해당 운영 문서를 추가로 읽는다.

전체 대화·모든 운영 문서를 다시 분석하는 것부터 시작하지 않는다. 다만 관련 코드가 이 문서 이후 변경됐다면 사실관계를 갱신한다.

## 1. 제품과 의사결정 맥락

### 제품의 본질

Persnapse는 연락처 보관 도구가 아니라 **Business Relationship Memory**다. 명함과 만남의 시간·장소·행사·주제·약속을 기억하고, 이름을 잊어도 적절한 사람과 이유를 되살려 다음 행동으로 연결한다.

```text
Capture → Context → Memory → Recall → Action
```

원본 Technical Spec은 이를 다음 인터뷰 경험으로 구체화했다.

```text
실제 명함 → 정보 수정 → 음성·텍스트 맥락 → 확인·저장
→ Graph·Profile 탐색 → 자연어 질문 → 사람·근거·분석 → 행동 제안
```

- 초기 주요 사용자 맥락은 Sales/BD 등 외부 만남·후속 연락이 잦은 사람이다.
- 같은 이름이라는 이유로 사람을 자동 병합하지 않는다.
- 사용자의 확인·수정은 AI 추정보다 우선한다.
- 근거·시간·출처를 보존하고, 외부 행동은 자동 실행하지 않는다.
- 기본 Graph와 음성 입력은 원본 P0다. 3D·화려한 애니메이션·복잡한 점수는 후순위다.
- 원본의 2일은 일정 가정이지 다음 작업에 대한 완료 보장이 아니다.

### 자료를 구분해서 읽기

| 자료                             | 역할·주의                                                              |
| -------------------------------- | ---------------------------------------------------------------------- |
| 사용자 최신 지시·승인            | 현재 작업 범위와 외부 변경 권한의 기준                                 |
| P00 Canonical Context            | 제품 정체성·신뢰 원칙. OCR·Graph는 수단이며 Recall이 가치의 핵심       |
| Technical Spec                   | 이번 평가의 직접 기준. 기본 Graph·Voice를 포함한 실제 경험 요구        |
| Task별 모델 PDF 및 ADR 0001·0005 | 작업별 모델 배정. Main Agent는 후속 요청으로 Terra로 변경              |
| 후속 ADR·운영 기록               | 실제 구현 선택, 보안·비용·Preview Tradeoff                             |
| context/02                       | 제품 전체 평가. Voice·Graph를 보류하는 축소 전략을 제안한 문서         |
| context/03                       | 원본 기준 재평가. 기본 Graph·Voice 미충족과 재현된 문제를 명확히 기록  |
| 이 문서                          | 새 세션의 시작점·실행 맥락·시행착오·첫 action. 세부 재현은 03으로 연결 |

02와 03은 상충하는 확정 명령이 아니다. **축소 MVP 제안과 원본 충족도 평가의 차이**다. 기본 Graph·Voice를 제외하려면 별도의 축소 범위라고 명시해야 한다.

루트 README와 docs/plans/progress.md는 Phase 4 중심의 과거 안내다. 루트 README의 '다음 단계 Business Card Capture', Node 20.9 안내를 현재 상태로 취급하지 않는다. 현재 실행 계약은 package.json의 Node 24.x다.

## 2. 지금까지 만든 결과물

| 작업 묶음             | 결과물                                                                                                  | 남아 있는 경계                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Foundation            | 독립 저장소, Next·React·TypeScript·Tailwind, 테스트·문서 구조                                           | 새 scaffold나 전면 재설계 불필요                             |
| Phase 2 Memory        | Person·Organization·Affiliation·Interaction·Topic·Memory·Action·provenance, 합성 Golden 데이터, Profile | 사용자 가치 자체를 입증한 것은 아님                          |
| Phase 3 Recall        | 자연어 입력, 로컬 조건·유사도 검색, 인물·Evidence·약속·동명이인·결과 없음 상태                          | 실제 Voyage·Terra가 연결된 Agent가 아님                      |
| Phase 3.5·API         | Capture 상태, mock/live router, embedding 데이터 계약, provider별 독립 live 시험                        | 어댑터 준비와 제품 연결 구분                                 |
| Phase 4 Text Capture  | 메모 → Draft → 수정 → 인물 선택 → 원자적·멱등 Commit → Profile·Recall                                   | 실제 구조화 어댑터는 있으나 Preview는 mock                   |
| Phase 5 Business Card | 카메라·파일 입력, OCR, 정보 수정, 맥락·Identity 확인, private 이미지, Digital Card, 연락 링크           | 한 사진 속 다중 명함 분리·AI 초해상도 없음                   |
| Clova live            | Name Card/General 응답 처리, 실제 General OCR 경로 검증                                                 | General의 필드 분류는 규칙 기반, 실명함 품질 검증 부족       |
| OCR 비용 방어         | DB 원장·advisory lock, 중복 이미지·요청 방어, 한도·timeout·오류 처리                                    | provider Stage hard quota·비용 알림 미검증                   |
| 안전 Preview          | HTTPS 외부 접속, Vercel All Deployments 보호, 비밀 없는 Production bootstrap, Preview만 앱 자격증명     | 공유 Workspace·개발 자격증명 재사용, 실기기 전체 흐름 미검증 |
| 최근 검토             | 명세 대비 공백, 반례 재현, 성능·UX·우선순위 문서화                                                      | 발견 사항은 아직 수정되지 않음                               |

### 코드 탐색 지도

| 수정·확인 대상 | 시작 파일·디렉터리                                                                                                                                                                                             |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 화면·탐색      | [홈](../../src/app/page.tsx), [AppShell](../../src/components/app-shell.tsx), [Recall 화면](../../src/app/recall/page.tsx)                                                                                     |
| 명함 입력·검토 | [BusinessCardWorkspace](../../src/features/capture/business-card-workspace.tsx), [Camera](../../src/features/capture/business-card-camera.tsx)                                                                 |
| 명함 OCR·저장  | [Business Card 서비스](../../src/server/application/business-card-service.ts), [Clova 변환](../../src/domain/business-card/clova-name-card.ts)                                                                 |
| Context        | [mock 구조화](../../src/domain/capture/mock-structurer.ts), [OpenAI 어댑터](../../src/server/ai/openai-capture-adapter.ts)                                                                                     |
| Recall         | [서비스](../../src/server/application/recall-service.ts), [파서](../../src/domain/recall/query-parser.ts), [ranker](../../src/domain/recall/ranker.ts), [repository](../../src/server/db/recall-repository.ts) |
| 비용 보호      | [OCR guard repository](../../src/server/db/ocr-cost-guard-repository.ts), [OCR 비용 정책](../../src/server/ai/ocr-cost-policy.ts)                                                                              |
| 배포           | [환경 정책](../../scripts/deploy/vercel-preview-environment-policy.mjs), scripts/deploy의 보호·환경·배포·검증 wrapper                                                                                          |
| DB             | supabase/migrations, scripts/db                                                                                                                                                                                |

기존 명함·텍스트 서비스, Draft schema, transaction, provider adapter를 활용한다. 모듈을 새로 만드는 것부터 시작하지 않는다.

## 3. 실행·환경·배포 상태

### 로컬에서 이번에 확인한 상태

- 저장소 경로: D:\Persnapse\persnapse-mvp.
- 브랜치 main, HEAD cc17d51. Phase 5 이후 다수 수정·untracked 파일 존재, staged 파일 없음.
- .env.local이 존재하고 Git ignore됨. 이번 작성에서는 실제 값을 읽지 않았다.
- .vercel/project.json이 존재함. Vercel 로그인 유효성·원격 프로젝트 상태를 이번에 확인한 것은 아니다.
- [package.json](../../package.json): Node 24.x, Next 16.3.5, React 19.3.0, TypeScript 6.0.3, Supabase/PostgreSQL, Vitest·Playwright.
- npm 의존성이 이미 있는 환경이다. 먼저 상태를 확인하고 불필요한 재설치·브라우저 다운로드는 하지 않는다.
- docs/inputs 원본, .env.local, .vercel, 생성 캐시는 Git에서 제외된다. 새 clone에 자동으로 따라오지 않는다.

### 마지막 기록된 Preview

| 항목                 | 2026-09-20 기록                                                           |
| -------------------- | ------------------------------------------------------------------------- |
| 실제 MVP             | [Preview 열기](https://persnapse-ljx0awm9n-choeseyong180-8216.vercel.app) |
| 최신 검토 Preview ID | dpl_XBrGpygtN1t2xz8A9CnJ95tqypaD                                          |
| 유료 OCR smoke 대상  | 이전 Preview dpl_EMnBPpY4LqQa6qzFA4yDSAMAeXRg                             |
| Production           | 앱·자격증명 없는 정적 bootstrap만 존재. 실제 MVP Production 배포 아님     |
| 보호                 | All Deployments, 허용된 Vercel 계정으로 접근                              |
| 테스트 데이터        | 하나의 Workspace 공유, 개발 Supabase·Clova 자격증명 재사용                |
| 리전                 | iad1. icn1 전환은 검증 후 검토할 후보이며 확정 아님                       |

유료 smoke는 해당 배포 작업에서 합성 명함 1회였으며, 관련 Draft·asset·Storage·AI-run 데이터는 정리됐다. 비개인 OCR 호출 원장은 비용 기록을 위해 유지했다. **최신 Preview에서 전체 저장→Recall을 새로 검증했다는 뜻이 아니다.**

원격 상태는 변경될 수 있으므로 배포·접근 작업 직전에 다시 확인한다. bootstrap은 이미 끝났으며 초기 프로젝트용 절차를 반복하지 않는다.

### 실제 모델 연결 범위

| 기능                | 실행 구성·기록                                       |
| ------------------- | ---------------------------------------------------- |
| OCR                 | BUSINESS_CARD_OCR_MODE=live, Naver Clova             |
| Preview Context     | AI_ROUTING_MODE=mock                                 |
| 실제 Context 어댑터 | OpenAI Luna, 이전 독립 live 저장 흐름 검증 있음      |
| Recall              | structured_local_semantic / local-hash-v1            |
| Embedding·reranking | Voyage 모델 배정·독립 시험 있음, Recall에 미연결     |
| Main Agent          | Terra 배정·독립 시험 있음, Recall 답변 생성에 미연결 |

Preview에 올린 변수는 허용 목록 11개이며 다른 모델 API 키는 제외한 기록이다. AI_ROUTING_MODE만 바꿔 전체 모델 연결을 완료할 수 없다. 실제 모델 연결에는 코드 경로와 비용 방어, 필요한 자격증명 업로드 권한을 따로 확인한다.

근거: [Preview Tradeoff](../decisions/0010-vercel-preview-deployment-tradeoffs.md), [모델 배정](../decisions/0001-ai-task-model-routing.md), [Terra 변경](../decisions/0005-main-agent-gpt-56-terra.md).

## 4. 시행착오 — 반복하지 말 것

| 상황                       | 확인된 교훈                                                                                  | 다음 세션의 대응                                                                                             |
| -------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| C: 용량 부족               | 설치·빌드가 막혔고 우회용 캐시·임시 경로 정리가 필요했음                                     | 현재 용량부터 확인. 오래된 여유 공간 수치 재사용 금지. 부족하면 중단·보고                                    |
| Supabase 5432 접속 실패    | CLI 검증 당시 DNS·443·인증은 정상, TCP 5432 차단, 6543 성공                                  | 기존 Transaction Pooler 6543과 prepare:false 유지. 비밀번호·DNS를 원인 없이 바꾸지 않음                      |
| DB 마이그레이션            | Phase 5 및 OCR guard 적용·검증 기록 있음                                                     | 실제 ledger·dry-run 확인 후 필요한 변경만 적용. SQL 수동 재실행·reset·seed 재주입 금지                       |
| Phase 5 검증 초기 실패     | fixture topic 가정이 mock 사전과 맞지 않았음                                                 | 실패 원인과 fixture를 구분. 생성물 정확히 추적·정리하고 기존 데이터는 보존                                   |
| 검증 cleanup 누락 위험     | idempotency key, 모든 asset, 전용 org/topic, 잔여 DB·Storage 0 검사 보강                     | 기존 검증 스크립트 재사용. 임시 데이터와 비용 원장 잔여를 구분                                               |
| Google Main Agent 반복 503 | 유효한 요청에서도 provider 병목이 있었음                                                     | 사용자 요청으로 Terra로 변경한 결정 유지. 무한 retry·임의 provider 회귀 금지                                 |
| Clova Document OCR 오류    | 당시 domain은 General 경로 사용, 전용 Name Card 경로가 맞지 않았음                           | 현재 연동을 먼저 확인. 인증·상품·API Key를 추측으로 바꾸지 않음                                              |
| 패스키 접근 요청           | 당시 조사상 API 키 열람 요청이 아니라 패스키 열거 권한. 거부 상태였고 외부 키 노출 증거 없음 | 독립 브라우저에서 사용자 인증. Codex 패스키 권한을 새로 허용하지 않음                                        |
| 로컬 Secret 캐시           | .next의 생성 캐시에 서버 Secret 사본이 발견된 이력                                           | 캐시를 공유·배포하지 않음. 기존 secret audit·정확한 캐시 정리 절차 사용. 환경파일 dump 금지                  |
| 첫 Vercel 배포             | Preview 의도만으로 첫 Production 동작을 피할 수 없었음                                       | 이미 승인·완료된 무비밀 bootstrap 재실행 금지. 기존 보호 wrapper로 Preview만 배포                            |
| Vercel 환경 동기화         | 순차 쓰기라 중간 실패 시 부분 상태 가능                                                      | 이름·scope·type allowlist 검사 완료 전 배포 금지. 모르는 변수 임의 삭제 금지                                 |
| 유료 OCR 응답 불확실       | timeout이 provider 미호출을 뜻하지 않음                                                      | 동일 요청 재발행보다 operation key·원장 상태 대조. 자동 재시도 금지                                          |
| npm 실행 경로              | npm exec -- node 사용 중 원치 않는 Node 패키지가 받아진 이력                                 | Node 24 실행 계약 확인, 기존 직접 node/npm script 사용. 도구 재설치로 우회하지 않음                          |
| Windows sandbox ACL        | 기본 exec/apply_patch 및 브라우저 초기화에 apply deny-read ACLs 오류 반복                    | 현재 도구 상태만 제한적으로 확인. 정당한 승인 경로 사용, 권한 광역 변경·무한 복구 금지                       |
| 오래된 운영 문서           | 9월 16일 보안 문서의 '미로그인·미배포'는 당시 상태                                           | 9월 20일 배포 기록과 구분. telemetry는 최신 wrapper의 비활성화 정책을 따르며 과거 debug 안내를 복사하지 않음 |

과거 기본 apply_patch가 막혔을 때는 승인된 실행으로 공식 Codex apply-patch 진입점을 사용했다. 실행 파일의 버전별 경로는 고정 가정하지 않는다. 파일 편집을 이유로 상위 폴더나 시스템 ACL을 변경하지 않는다.

정확한 절차: [보호 Preview 운영](../operations/protected-preview-deployment.md), [Clova 운영](../operations/clova-business-card-ocr.md), [비용 방어](../operations/clova-ocr-cost-controls.md), [당시 패스키 조사](../security/2026-09-16-vercel-passkey-audit.md).

## 5. 마지막 Astra 검토의 핵심·메타 피드백

### 5.1 제품 판단

**안전한 저장 기반과 일부 기능은 있으나 원본이 요구한 '설명 없이 돌아가는 관계 기억 경험'은 아직 완성되지 않았다.** 기반을 버리는 것이 아니라, 추가 기반 작업의 우선순위를 낮추고 연결된 사용자 경험을 먼저 완성해야 한다.

| 이전 진행에서 드러난 문제                    | 바꿔야 할 방식                                             |
| -------------------------------------------- | ---------------------------------------------------------- |
| Phase·테스트·어댑터 완료를 중심으로 보고     | 사용자에게 실제로 가능한 행동과 live/mock 경계를 먼저 보고 |
| 기반 준비가 핵심 경험보다 앞섬               | 사용자 문제 하나를 입력→저장→사용까지 작게 완결            |
| API 시험 성공을 실제 기능 연결과 혼동        | 연결 시험 / 제품 경로 / 사용자 품질을 분리                 |
| Golden 통과를 자유 질의 품질로 확대 해석     | 정답 없음·조건 충돌·새 표현 등 반례 포함                   |
| 근거가 있다는 이유로 답을 신뢰               | 질문의 조건과 해당 근거가 일치하는지 확인                  |
| UI polish를 외형 개선으로만 봄               | 입력 부담·정보 순서·언어·상태 전환부터 개선                |
| Graph·Voice 보류를 원본 충족처럼 해석할 위험 | 원본 필수와 축소 전략을 명시적으로 구분                    |
| 지연을 해결하려다 우회 구조 증가             | 병목을 짧게 진단·보고하고 사용자 확인 후 재개              |

초기 원본도 범위가 넓고 2일 가정은 낙관적이었다. 보안·비용 대응은 사용자 요청으로 수행한 것이므로 무조건 불필요한 기반 작업으로 취급하지 않는다. 작업별 지연 기여도를 정량 분석한 것은 아니다.

### 5.2 현재 미수정인 중요 발견

| ID   | 발견                                                             | 증거 수준                      | 다음 행동                                                      |
| ---- | ---------------------------------------------------------------- | ------------------------------ | -------------------------------------------------------------- |
| F-01 | 날짜·행동 가산점으로 무관한 사람이 resolved. '오늘' 조건 미해석  | 합성 domain 실행 재현          | 반례를 테스트로 고정하고 조건 검증·빈 결과 처리 보정           |
| F-02 | '어제 대전…양자컴퓨팅…'을 오늘 날짜·장소 null·topics=[]로 구조화 | mock 함수 재현                 | 날짜 오류·추정 표시 보정, 실제 구조화 연결 후 같은 사례 재검증 |
| F-03 | 정확한 General OCR 텍스트에서 회사 '가온빛'을 이름으로 선택      | 합성 provider 응답 후처리 재현 | 모호한 필드 확인·수정 UX, 분류 평가·보정                       |
| F-04 | 고정 문구를 AI 제안으로 표시, Live·mock 표시 혼재                | 코드 확인                      | 실제 능력에 맞게 표시                                          |
| F-05 | Golden 판정과 E2E가 사용자 품질 전체를 다루지 않음               | 평가 코드·반례 대조            | 조건 충족·무관 후보·실기기·feedback 보강                       |

세부 입력·기준 날짜·fixture 구조는 [03 문서](../context/03-technical-spec-review-handoff-2026-09-22.md)의 4·7절에 있다. 반례는 아직 영구 테스트 파일로 추가되지 않았다.

### 5.3 UX에 남은 주요 위험

- 많은 입력·검토 필드, 내부 개발 용어, 분산된 화면 흐름.
- 명함 Review에서 필드별 추정 표시 부족.
- 카메라 창이 OCR 완료까지 대기하여 진행 안내가 뒤에 가려질 가능성.
- 명함/텍스트 탭 전환 시 입력 상태를 잃을 위험.
- 결과마다 여러 근거·행동 패널이 반복돼 핵심 이유 파악이 어려움.
- 기본 Graph·Voice·피드백 흐름 부재.

브라우저 초기화 실패로 실제 렌더링·모바일 사용성을 관찰하지 못했다. 코드 기반 위험과 실기기에서 재현한 결함을 혼동하지 않는다.

### 5.4 마지막 검증의 정확한 의미

| 검증                 | 기록                                                       | 한계                                          |
| -------------------- | ---------------------------------------------------------- | --------------------------------------------- |
| 9월 22일 단위 테스트 | 18파일·60개 통과                                           | 새 반례를 포함한 시험 아님                    |
| 9월 22일 Golden      | DB 읽기 전용 9/9, persist:false                            | 좁은 기존 판정 기준                           |
| 검색 시간            | 로컬 서비스+원격 DB 읽기 39~297ms                          | Vercel·브라우저·질의 로그 저장 제외           |
| 9월 20일 원격 OCR    | 합성 1회, 8.27초                                           | 3~5초 목표 미달, 평균·p95 아님                |
| 이전 전체 검증       | lint·typecheck·단위 테스트·포맷·production build 통과 기록 | 9월 22일 검토·문서 작성에서 전체 재실행 안 함 |
| 9월 22일 diff 검사   | 통과                                                       | 기능 품질을 보장하지 않음                     |
| 최근 검토·문서화     | 유료 호출 0, DB 변경·배포 없음                             | 프로젝트 전체 누적 호출 0이라는 뜻 아님       |

현재 OCR/Recall 표시 latency는 사용자의 전체 대기 시간을 포괄하지 않는다. '사진 확정→수정 가능', '질문 제출→근거 표시'를 앞으로의 체감 계측으로 삼는다.

## 6. 바로 이어갈 핵심 action

### A. 시작 직후 — 새로 설계하지 말고 변경점 확인

- 작업 폴더·Git 상태·기존 미커밋 파일을 확인한다.
- 03의 F-01~F-05와 관련 코드가 아직 같은지 대조한다.
- 요청이 검토·계획이면 첫 수정 묶음만 짧게 제시한다. 구현 지시가 있으면 B로 진행한다.
- 첫 작업에 DB 마이그레이션·배포·새 API 키가 필요하다고 가정하지 않는다.

### B. 권장 첫 수정 묶음 — '잘못된 답과 오해부터 줄이기'

**목표:** 실제 기능이 무엇인지 명확히 하고, 재현된 잘못된 기억·검색을 막는다. 외부 호출 없이 시작 가능한 범위다.

1. 03의 R1~R3, 상대 날짜, OCR 분류 반례를 기존 테스트 구조 안에 추가한다.
2. 단어가 일치하지 않아도 날짜·행동 가산점만으로 답이 되는 문제를 보정한다. 근거 없는 확정 대신 결과 없음·조건 확인을 허용한다.
3. '오늘/어제' 처리와 모르는 날짜의 상태를 명시한다. 만남 시각을 작성 시각으로 무조건 확정하지 않는다.
4. 고정 문구의 'AI 제안', 혼재된 Live·mock 표현을 실제 구현에 맞게 정리한다.
5. 기존 정상 검색·동명이인·명함 수정·저장 경계에 회귀가 없는지 검증한다.

첫 묶음의 완료 기준:

- 무관한 장소·분야의 사람을 정답처럼 반환하지 않는다.
- 날짜 해석과 화면 표시가 일치하고, 모르는 값을 사실처럼 확정하지 않는다.
- 기존 정상 사례를 유지하면서 새 반례가 통과한다. Golden 기대값을 바꿔 통과만 만드는 방식은 피한다.
- OCR 분류 반례는 개선 여부 또는 남은 실패를 명시한다. 빠른 첫 수정이 어렵다면 실패 테스트·명확한 후속 작업으로 남기되 해결됐다고 보고하지 않는다.
- 코드 변경에 맞는 검사와 비용·데이터 부작용 여부를 보고한다.

이는 권장 작업안이지 이 문서 작성으로 승인된 구현이 아니다. 실제 변경 범위는 다음 세션의 사용자 요청을 따른다.

### C. 이어질 제품 묶음

| 순서 | 사용자에게 완성할 경험                      | 범위 제한                                                                 |
| ---- | ------------------------------------------- | ------------------------------------------------------------------------- |
| 1    | 실제 Context 구조화 + 간결한 명함·메모 등록 | 기존 Luna 어댑터 재사용, 추정 표시·수정 보존·호출 제한                    |
| 2    | 실제 Recall·분석·행동 제안                  | 근거·조건 검증 유지, 기존 모델 배정 활용, 무한 loop 금지                  |
| 3    | 기본 Graph와 연결된 작업 화면               | 기존 관계 데이터에서 생성, Person·Company·Event·Topic·Place, 선택→Profile |
| 4    | 음성 10~60초 → STT → 같은 Context 흐름      | 텍스트 단독·음성 병행, 새 녹음 플랫폼 구축 불필요                         |
| 5    | 실기기 완주·인터뷰                          | 새 입력·다른 질문·빈 결과·연락까지 확인                                   |

피드백 버튼·최소 계측은 실제 Context/Recall 작업부터 함께 넣는다. 음성·Graph를 계속 제외하려면 원본과 다른 축소 범위임을 사용자와 명시한다.

새 범용 Agent framework, Graph DB, 복잡한 queue, 3D, 고급 관계 점수, 인증 전면 재설계, 대규모 최적화를 선행하지 않는다. 기존 신뢰·비용·보호 기반도 제거하지 않는다.

## 7. 실행 명령 — 이름보다 부작용을 먼저 확인

아래는 명령 안내이며 일괄 실행 목록이 아니다. 실행 전 최신 package.json과 해당 script를 읽는다. 모든 명령의 작업 디렉터리는 프로젝트 폴더다.

| 목적              | 명령·경로                                                                          | 부작용·주의                                                                   |
| ----------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Git 상태          | git -c safe.directory=D:/Persnapse/persnapse-mvp status --short                    | 읽기 전용. 이 환경의 소유권 경고를 피하는 명령별 옵션                         |
| 표준 품질 검사    | npm run verify                                                                     | lint·typecheck·test·format check·build. 로컬 생성물·캐시 생성                 |
| 단위 테스트       | npm test                                                                           | 기존 suite 기준 외부 유료 호출·DB 쓰기 없이 실행                              |
| 개발 서버         | npm run dev                                                                        | .env.local을 사용. 실제 OCR 동작을 누르면 과금 가능                           |
| 브라우저 E2E      | npm run test:e2e                                                                   | build와 서버·브라우저 실행. 기존 테스트 일부 mock, Recall 접근은 DB 기록 가능 |
| DB 연결 확인      | npm run db:check                                                                   | 원격 연결. Secret 출력하지 않음                                               |
| 마이그레이션 점검 | npm run db:migrate:dry                                                             | 원격 상태 조회. dry-run을 실제 적용으로 혼동하지 않음                         |
| DB 통합 시험      | npm run db:verify:phase4 / phase5 / ocr-guard                                      | 합성 데이터를 쓰고 정리함. 읽기 전용 시험 아님                                |
| Golden 평가       | npm run eval:recall                                                                | 기본은 query·ai_run 기록. 읽기 전용이면 executeRecall의 persist:false 사용    |
| OCR 사용량        | npm run db:report:ocr-usage                                                        | 원격 읽기, provider 최종 청구액을 직접 증명하지 않음                          |
| Secret 검사       | npm run security:audit:secret-residue                                              | 로컬 키 기반 검사. 원문 Secret·OCR 데이터 출력 금지                           |
| 배포 준비 조회    | npm run deploy:verify:readiness                                                    | 기존 인증으로 원격 보호·허용 목록 점검. 인증 상태는 재확인                    |
| 유료 검증         | ai:verify:live, ai:verify:clova, db:verify:phase5:live, deploy:verify:preview:live | 비용·데이터 생성 가능. 승인 범위와 실제 호출 횟수 확인 후 최소 실행           |
| 배포·환경 변경    | scripts/deploy의 wrapper                                                           | 프로젝트·환경·보호 상태를 확인하고 승인된 범위에서만 실행                     |

초기화용 db:setup·db:seed·마이그레이션 실제 적용을 인계 직후 자동 실행하지 않는다. 기존 .env.local이 있으므로 .env.example을 복사해 덮어쓰지 않는다. 코드 수정에는 apply_patch를 사용하고, 단순 인계를 이유로 npm install·대규모 format·생성물 일괄 삭제를 하지 않는다.

## 8. 절대 잃으면 안 되는 작업 경계

### 사용자 지시

- 생성·수정·개발 명령은 D:\Persnapse\persnapse-mvp 내부에서만 수행한다.
- 상위 폴더와 다른 프로젝트는 필요한 경우 읽기만 하며 명시적 승인 없이 수정하지 않는다.
- 기존 미커밋 변경을 보존한다. commit·push는 별도 요청 전 하지 않는다.
- 중대사항 외에는 승인된 작업 범위 안에서 자율 판단한다. 사소한 선택마다 확인을 반복하지 않는다.
- 큰 단계마다 분석·검토·피드백하고, 실제 사용자에게 달라진 점을 결과 중심으로 보고한다.
- 과도한 지연·용량·권한·네트워크 문제는 복잡한 우회보다 현황과 필요한 조치를 보고한다.

### 비밀정보·외부 변경

- 환경변수의 이름·설정 여부만 확인한다. Secret, 전체 Invoke URL, DATABASE_URL, Supabase 서버 키, 모델 키, Vercel 토큰을 출력하지 않는다.
- 원본 명함·OCR 텍스트·provider 응답 원문을 로그·문서에 남기지 않는다.
- All Deployments 보호를 유지하고 Shareable Link·보호 우회 토큰을 만들지 않는다.
- 개발 자격증명의 Preview 재사용은 기존 승인 Tradeoff이며, 임의의 외부 서비스로 재전송할 권한이 아니다.
- 기존 테스트용 공유 Workspace를 다중 사용자 격리 제품으로 설명하지 않는다.
- 실제 앱 Production 승격·커스텀 도메인·외부 테스트 인원 확대·인증 방식·과금 플랜 변경은 범위 확인 없이 수행하지 않는다.
- API 키 교체는 노출 증거가 있거나 사용자 요청이 있을 때 검토한다. 무조건 교체하거나 유출이 없다고 절대 보장하지 않는다.

### 비용의 미완료 경계

앱 OCR 제한은 서버리스 여러 인스턴스에서 PostgreSQL 원장·lock으로 1 req/s, 100/day, 1,000/month를 적용한다. 동일 요청·이미지, 장애 시 호출 차단, 12초 provider timeout, 자동 provider retry 금지 등이 구현됐다.

**Naver의 실제 OCR Stage hard quota와 Cost Explorer 예산·알림은 미검증이다.** 비용 알림은 실시간 차단 장치가 아니다. 기본 인증을 바꾸거나 API Key를 새로 만들어 quota를 억지로 적용하지 않는다. 접근 범위 확대 전 실제 Stage 적용을 확인해야 한다.

OCR 방어가 Luna·Terra·Voyage의 신규 live 경로를 자동 보호하는 것도 아니다. 모델 연결 작업에서는 해당 호출량·timeout·재시도·비용 경계를 함께 확인한다.

## 9. 새 세션에 전달하는 가장 간단한 방법

### 권장 방식

- 동일 프로젝트의 **현재 D:\Persnapse\persnapse-mvp 작업 트리를 그대로 사용하는 세션**에서 시작한다.
- 이 문서 하나를 시작점으로 지정한다. 03 문서는 재현·상세 평가용으로 연결되어 있다.
- .env.local·원본 명함·생성 캐시를 채팅에 첨부하지 않는다. 새 세션은 로컬 파일을 필요한 범위에서 읽는다.
- 인계 완료를 위해 현재 세션을 복제하거나 자동으로 새 작업을 만들 필요는 없다. 이 문서 작성 작업에서는 새 Codex 세션을 생성하지 않았다.

### 붙여 넣을 시작 프롬프트

```text
Persnapse MVP의 기존 작업을 이 세션에서 이어가려 한다.
작업 폴더는 D:\Persnapse\persnapse-mvp이며, 기존 미커밋·untracked 변경을 그대로 보존해라.

먼저 다음 문서를 시작점으로 읽어라.
D:\Persnapse\persnapse-mvp\docs\handoff\2026-09-22-session-handoff.md

관련 AGENTS.md와 문서에서 연결한 Technical Spec 검토 문서를 읽고,
현재 Git 상태 및 첫 작업에 필요한 코드가 인계 시점과 달라졌는지만 확인해라.
전체 프로젝트 분석·설계부터 다시 시작하지 마라.

핵심은 기반 추가가 아니라 실제 명함·맥락 입력 → 정확한 기억 → 관계 탐색·회상 → 근거·행동 경험의 완성이다.
live/mock/미연결, 원본 필수 기능과 축소 제안, 재현된 결함과 UX 가설을 구분해라.

우선 인계받은 현재 상태와 첫 수정 묶음 B의 범위를 짧게 보고해라.
이 메시지만으로 유료 API 호출, DB 변경, 배포, 자격증명 업로드, 권한 변경, commit·push는 하지 마라.
병목이 생기면 우회 구조를 늘리지 말고 현황과 필요한 사용자 조치를 보고해라.
```

구현까지 바로 맡기려면, 사용자가 위 프롬프트 끝에 다음 문장을 추가할 수 있다. 이 선택 문구는 현재 세션에서 이미 승인됐다는 의미가 아니다.

```text
상태 확인 후 인계 문서의 첫 수정 묶음 B를 코드·테스트 범위에서 진행해라.
외부 유료 호출·DB 변경·배포가 필요해지면 그 작업 전에 범위와 이유를 보고해라.
```

## 10. 문서 검토·인계 완료 기준

- 현재 로컬 상태와 과거 원격 검증 기록을 분리했다.
- 결과물과 미구현·미수정 항목, 실제 모델 연결 범위를 구분했다.
- 재현 세부를 03 문서로 연결하여 같은 긴 보고서를 다시 복제하지 않았다.
- 과거 시행착오를 '무엇을 반복하지 않을지'로 정리했다.
- Astra의 메타 피드백을 다음 작업 단위·완료 보고 방식에 연결했다.
- 첫 action은 외부 변경 없이 시작 가능한 범위로 제한하고, 개발 착수 승인과 구분했다.
- 원본 자료·Secret·DB 개인정보를 복사하지 않았다.
- 다음 세션이 알아야 할 변경이 발생하면 이 문서의 상태·첫 action을 갱신하고, 과거 측정값의 날짜·범위는 보존한다.

**최종 인계 문장: 지금 있는 기반을 보존한 채, 이미 재현한 잘못된 답부터 줄이고 실제 입력이 다시 쓰이는 한 사이클을 작게 완성한다. 기술 단계의 완료가 아니라 사용자가 성공한 경험으로 다음 단계를 판단한다.**
