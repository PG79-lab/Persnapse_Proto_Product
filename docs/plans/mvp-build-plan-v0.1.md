# Persnapse MVP Build Plan v0.1

- 상태: 진행 중
- 작성일: 2026-09-13
- 기준 문서:
  - `docs/context/00-initial-canonical-context-analysis.md`
  - `docs/context/01-business-card-mvp-v0-spec-analysis.md`
  - `docs/product/mvp-definition-v0.1.md`
  - `docs/architecture/mvp-architecture-v0.1.md`

## 1. 구축 전략

Persnapse의 가장 큰 불확실성은 명함 OCR 구현 가능성이 아니라 관계 기억을 정확한 근거와 함께 회상하는 경험의 가치다. 따라서 구축 순서는 화면이나 입력 기능 수가 아니라 **위험이 큰 가설을 빠르게 검증하는 수직 슬라이스**를 기준으로 한다.

```text
Foundation
→ Seeded Recall
→ Text Capture to Memory
→ Business Card Capture
→ Voice Module
→ Graph Module
→ Interview Validation
```

각 단계는 독립적으로 실행·검증 가능해야 하며 종료 조건을 통과하기 전 다음 복잡도를 추가하지 않는다.

## 2. 작업 트랙

### Product Track

- 사용자와 최초 시나리오 확정
- Golden Dataset과 질문 정의
- 인터뷰 관찰 항목과 성공 신호 정의
- Voice와 Graph의 독립 가치 판단

### Foundation Track

- 프로젝트 scaffold와 환경 관리
- migration, seed와 test 기반
- Workspace 데이터 경계
- 개인정보 및 오류 처리 원칙

### Core Loop Track

- Capture Draft
- Identity 확인
- Memory Commit
- Recall + Evidence
- Action distinction

### Experience Track

- Voice Context
- Archive / Profile
- Relationship Graph
- Interview UI와 telemetry

## 3. Gate 0 — 제품 및 기술 결정

### 작업

- `mvp-definition-v0.1`의 7개 Product Decision 검토
- Supabase, Auth mode와 데이터 보관 결정
- ADR 0001의 task별 AI Model Router를 기능 phase에 맞춰 활성화
- 지원 언어와 명함 범위 결정
- Golden Dataset에 실데이터를 사용할 경우 동의·비식별화 정책 결정
- 2일 데모가 실제 제약인지 목표 표현인지 확인

### 산출물

- 승인된 MVP Definition
- 필요한 ADR 초안
- 환경과 외부 서비스 목록
- 명시적인 MVP 범위와 Cut list

### 종료 조건

- Core 필수 범위와 Voice·Graph의 release 위치에 합의
- 개인정보 처리와 외부 AI 전송 범위를 설명 가능
- 구현에 필요한 외부 계정과 비밀정보 준비 방식 확정

## 4. Phase 1 — Foundation Skeleton

### 목표

빈 프로젝트를 반복 가능한 개발·검증 환경으로 만든다.

### 작업

- Next.js / TypeScript 단일 앱 scaffold
- lint, format, typecheck, unit test 명령 구성
- 환경변수 schema와 `.env.example`
- PostgreSQL / Supabase 로컬 또는 개발 환경 연결
- migration과 seed 실행 경로
- 기본 route, error boundary, loading 및 empty-state primitives
- feature/domain/server 디렉터리 경계
- 최소 CI 또는 동일한 로컬 verification command

### 종료 조건

- 새 환경에서 문서화된 명령으로 설치·실행 가능
- 빈 DB에서 migration과 seed를 반복 실행 가능
- lint, typecheck와 test가 하나의 verification 흐름으로 통과
- secret이 Git 추적 대상에 포함되지 않음

## 5. Phase 2 — Memory Foundation + Seed Dataset

**상태: 완료 (2026-09-15)**

### 목표

실제 Capture 없이도 Persnapse의 관계 기억을 표현하고 검증할 수 있게 한다.

### 작업

- Workspace, Person, Organization, Affiliation schema
- Event, Interaction, Topic, Memory Statement, Action Item schema
- provenance와 verification 상태
- Query, Evidence, Feedback 및 AI Run schema
- Memory Document와 embedding projection
- 12~20명 규모 합성 Golden Dataset
- 동명이인, 유사 회사, 반복 Interaction과 미완료 약속 포함
- Profile timeline read model

### 종료 조건

- 빈 DB migration 후 Golden Dataset 생성 가능
- 동일 seed를 중복 없이 재현 가능
- Person Profile에서 시간순 Context와 provenance 확인 가능
- 검색 파생 데이터를 삭제 후 재생성 가능

### 완료 근거

- Supabase 원격 개발 DB에 migration 2건 적용
- Workspace 격리 복합 외래키와 public table 20개의 RLS 활성화
- 고정 UUID 기반 합성 데이터 14명, 조직 7개, Interaction 18건, Memory 20건, Action 10건 생성
- 동명이인, 유사 조직, 반복 Interaction, 미완료 Action, Draft Memory 포함
- `app_private.rebuild_memory_documents`로 Person별 검색 문서 삭제·재생성 검증
- `/people` 목록과 `/people/[personId]` 시간순 Context·근거 화면 구축
- `npm run db:verify`, `npm run verify` 통과

## 6. Phase 3 — Seeded Recall Vertical Slice

**상태: 완료 (2026-09-15)**

### 목표

가장 중요한 Recall + Evidence 가설을 Capture보다 먼저 검증한다.

### 작업

- Query intent, entity와 time constraint parsing
- 구조화 필터 retrieval
- semantic retrieval
- bounded relation expansion
- Evidence ranking과 중복 제거
- evidence-constrained answer generation
- 저장된 약속과 AI 추천 Action 구분
- Recall UI: Person, 이유, Evidence, Context, Action
- 결과 없음, 모호함과 Provider 오류 상태
- Golden Query evaluation runner

### Golden Query 범주

- 행사: “지난 행사에서 만난 투자자”
- 주제: “AI Agent에 관심 있던 사람”
- 장소: “코엑스에서 만난 사람”
- 시간: “지난달 만난 사람”
- 회사: “ABC Ventures 사람”
- Interaction: “마지막으로 무슨 이야기를 했지?”
- Action: “다시 연락해야 하는 사람”
- Identity ambiguity: 동명이인 구분

### 종료 조건

- 각 Golden Query에 기대 Person과 Evidence가 정의됨
- 응답이 존재하지 않는 Evidence를 인용하지 않음
- 동명이인을 이름만으로 합치지 않음
- 결과 없음과 모호한 결과를 정상 응답으로 처리
- Query별 retrieval 결과와 latency를 재현 가능하게 기록

### 완료 근거

- 한국어 Query 정규화, intent·entity term·상대 시간 파싱 구현
- 구조화 일치와 deterministic local semantic retrieval을 결합한 `hybrid-v1` 기준선 구축
- 확정된 Memory, Interaction, Action만 검색 corpus와 Evidence에 포함
- 이름만 입력한 동명이인 2명을 병합하지 않고 `ambiguous` 결과로 반환
- Answer, 선택 이유, 확인된 Evidence, 저장된 Action과 비실행형 AI 제안을 분리한 응답 계약 구축
- `POST /api/recall`과 `/recall` 사용자 화면 연결
- 8개 범주와 `no_result` 사례를 포함한 Golden Query, 기대 Person·Evidence·reference time 저장
- Golden Query 9/9 통과, Recall UI Chromium E2E 3개 포함 전체 E2E 5개 통과
- Query, AI Run, latency, retrieval trace와 Evidence snapshot을 PostgreSQL에 기록
- Draft Memory의 Recall projection 포함 여부 0건 검증

## 6.5 Phase 3.5 — Foundation Hardening

**상태: 완료 (2026-09-15)**

### 목표

Phase 4 Capture와 이후 live AI 연결 전에 상태, 실행 route, projection과 실패 회귀 계약을 단단하게 만든다.

### 완료 내용

- `capture-draft-v1` strict schema와 Capture 상태 전이 domain contract
- PostgreSQL Capture 상태 전이 guard와 명시적인 `commit_result`
- AI 최초 Draft와 사용자 수정 Draft의 분리 기반
- Capture별 AI Run attempt와 retry 연결
- 실제 환경 model override와 credential 상태를 반영하는 mock/live runtime router
- timeout, retry, fallback, schema validation과 개인정보 없는 attempt telemetry
- `memory_documents`의 `vector(1024)` 및 embedding 상태 수명주기
- 전체 삭제 대신 content hash 기반 Person 단위 projection upsert
- 확인된 Event, place, topic과 Action까지 포함한 projection v3
- Recall hash 충돌 false positive 차단과 `no_result` Golden Query

### 종료 근거

- AI runtime, Capture schema·상태와 no-result를 포함한 단위 테스트 23개 통과
- Golden Query 9/9 통과
- DB에서 `vector(1024)`, Capture guard, commit result와 Person 단위 projection 확인
- 변경 없는 projection rebuild가 기존 row를 갱신하지 않음을 검증
- Draft Memory projection 유출 0건

## 7. Phase 4 — Text Capture to Memory

**상태: 완료 (2026-09-15)**

### 목표

AI 구조화와 사용자 확인을 거쳐 새로운 관계 기억이 Recall에 반영되는 첫 완전 수직 슬라이스를 만든다.

### 작업

- Capture Session state machine
- Text Context 입력
- Event, place, topic, memory와 action 후보 구조화
- source kind와 verification 상태 표시
- 구조화 결과 수정
- Identity 후보 검색
- 기존 Person 연결 또는 신규 생성 선택
- idempotent atomic Memory Commit
- commit 이후 Memory Document 생성
- Archive와 Person Context Profile 갱신
- 저장 직후 Recall 확인

### 종료 조건

- Text 입력 하나가 검토 가능한 Draft가 됨
- 사용자 확인 전에는 Graph, Profile과 Recall에 나타나지 않음
- 동일 요청 재시도로 중복 Person/Interaction이 생성되지 않음
- 사용자 수정값이 저장 후 유지됨
- 저장한 맥락을 이름 없이도 Golden Query로 찾을 수 있음

### 완료 근거

- `/capture`에서 자유 텍스트 입력, 구조화, 전체 Draft 수정과 명시적 Identity 선택 가능
- `capture-draft-v1` strict schema를 mock과 OpenAI `gpt-5.6-luna` production adapter가 공유
- 사용자 확인 전 Person·Profile·Recall 미노출을 실제 개발 DB에서 검증
- 기존 Person 연결 또는 신규 생성, Organization·Event·Topic resolve와 Interaction·Memory·Action·provenance 저장을 단일 transaction으로 구현
- committed Capture 재요청 시 기존 `commit_result`를 반환하며 Person·Interaction 중복 0건
- `model_draft`와 최종 `structured_draft` 분리, 사용자 수정 횟수와 수정값 보존
- commit 이후 Person 단위 Memory Document 갱신, 실패 시 canonical Memory 유지
- mock 및 Luna live production adapter 모두 Draft → Commit → 이름 없는 Recall 수직 슬라이스 통과
- Phase 4 검증 데이터 자동 정리 후 기존 Golden Dataset과 Draft projection 유출 0건 유지

## 8. Phase 5 — Business Card Capture

### 목표

명함을 Person Draft의 빠른 시작점으로 연결한다.

### 작업

- 이미지 업로드와 Source Asset
- 파일 유형·크기 validation
- card extraction adapter
- extraction schema validation
- 필드별 source와 review status
- Inline 수정
- Context Draft와 결합
- 실패, timeout과 retry
- 보관·삭제 정책에 따른 원본 asset 처리

### 종료 조건

- 지원 범위의 실제 명함을 업로드할 수 있음
- 핵심 필드를 추출하고 모두 수정 가능
- OCR 오류가 Identity 자동 병합으로 이어지지 않음
- extraction 실패 후 같은 Capture Session에서 재시도 가능
- 명함 + Text Context → Confirm → Memory → Recall 흐름 통과

## 9. Phase 6 — Voice Context Module

### 목표

Voice가 Text 대비 Capture 마찰을 실제로 낮추는지 검증한다.

### 작업

- 녹음 권한, 시작·중지와 미리 듣기
- audio upload와 STT adapter
- transcript 검토 및 수정
- Text Context와 동일한 구조화 pipeline 재사용
- 녹음 취소, 권한 거부, STT 실패 상태
- Text 대비 입력 시간과 correction count 계측

### 종료 조건

- Voice 단독 및 Voice + Text 입력 가능
- transcript 수정 후에만 구조화 진행 가능
- STT 실패가 기존 Capture Draft를 손상시키지 않음
- Voice와 Text의 입력 마찰을 비교할 이벤트가 기록됨

Voice가 Gate 0에서 필수가 아니라고 결정되면 Phase 8 이후 독립 실험으로 이동한다.

## 10. Phase 7 — Relationship Graph Module

### 목표

Graph가 관계 탐색에 추가 가치를 주는지 검증한다.

### 작업

- confirmed Memory 기반 Graph projection
- Person, Organization, Event와 Topic 노드
- edge type과 provenance 반환
- 기본 2D interaction
- 노드 선택, focus와 Person Profile 연동
- Archive/Search 결과와 Graph focus 연결
- 파생 관계의 시각적 구분
- node click, search-to-focus와 profile-open 계측

### 종료 조건

- Graph가 별도 원본 데이터를 갖지 않음
- 확인 전 Draft가 Graph에 나타나지 않음
- 노드와 edge의 관계 이유를 설명 가능
- Graph에서 선택한 Person의 실제 Evidence를 확인 가능
- 목록·검색 대비 Graph의 추가 효용을 인터뷰에서 분리해 질문 가능

3D, animation, shared-context Person-Person edge와 고급 strength는 제외한다.

Graph가 Gate 0에서 필수가 아니라고 결정되면 Phase 8 이후 독립 실험으로 이동한다.

## 11. Phase 8 — Interview Readiness

### 목표

기능 데모가 아니라 제품 가설을 관찰할 수 있는 안정된 인터뷰 빌드를 만든다.

### 작업

- 전체 E2E happy path와 주요 실패 경로
- Golden Query regression
- AI schema contract fixtures
- latency와 오류 계측 검증
- 사용자 correction과 feedback 흐름
- 개인정보가 log에 노출되지 않는지 검토
- seed reset과 demo recovery 절차
- 접근성, loading, error와 empty states
- 인터뷰 진행 script와 관찰 기록 양식

### 종료 조건

- 깨끗한 환경에서 setup 및 demo 재현 가능
- 전체 Core Loop E2E 통과
- Provider 한 단계가 실패해도 데이터 손상 없이 복구 가능
- Golden Query 결과가 정해진 baseline 이상으로 재현됨
- 인터뷰 중 seed를 안전하게 reset 가능
- 알려진 한계와 Cut scope가 문서화됨

## 12. Phase 9 — Pilot Hardening

인터뷰 결과에서 반복 사용 의향이 확인된 경우에만 진행한다.

- 실제 Auth와 workspace isolation 정책 검증
- 데이터 export와 삭제
- 원본 asset retention
- 비동기 작업과 retry 내구성
- 비용 budget과 rate limit
- 운영 monitoring
- schema migration 및 backup 복구
- 실제 사용자 파일에 대한 보안 검토

이 단계 전 빌드는 인터뷰용 MVP이며 공개 Production 서비스로 취급하지 않는다.

## 13. 단계별 Cut 원칙

일정이 지연되면 다음 순서로 줄인다.

1. 3D와 Graph animation
2. Person-Person derived relation
3. edge strength 점수
4. Web enrichment
5. Query suggestion
6. Voice module
7. Graph module
8. AI가 새로 만드는 Action recommendation

끝까지 유지할 항목:

- 사용자 확인 기반 Identity
- Text Context Capture
- provenance가 있는 Memory Commit
- Person Profile
- 자연어 Recall
- 실제 Evidence
- 저장된 약속의 회상
- 오류·피드백 계측

## 14. 원본 2-Day Plan에 대한 판단

원본 P0 전체를 단단한 기반과 함께 2일 안에 구현한다는 계획은 위험하다. 2일이 강제 조건이라면 이를 장기 MVP가 아니라 **throwaway가 아닌 제한된 validation build**로 정의하고 아래만 목표로 한다.

### Day 1

- 프로젝트 skeleton
- 최소 schema와 합성 seed
- Person Profile
- Golden Query 기반 Recall + Evidence 한 경로

### Day 2

- Text Context Draft
- 사용자 확인과 Memory Commit
- 새 Memory가 Recall에 반영되는 E2E
- 간단한 Archive
- feedback logging

명함 OCR, Voice와 Graph는 실제 Core Loop가 검증된 이후 순차 연결한다. 원본 문서의 전체 데모를 2일 안에 요구하면 mock, hard-coded graph 또는 취약한 데이터 모델이 필요해질 가능성이 높으며, 이는 이번 프로젝트의 “추후 이어서 작업하기 쉬운 단단한 기반” 목표와 맞지 않는다.

## 15. 초기 Working Decisions

- MVP Definition을 구현 기준으로 사용한다.
- Text Core Loop 이후 Voice를 연결한다.
- Recall 이후 기본 2D Graph를 연결한다.
- 저장된 약속과 비실행형 AI 행동 제안을 구분한다.
- 한국어 중심, 한영 혼합 단일 명함을 우선 지원한다.
- Supabase 기반 단일 애플리케이션으로 시작한다.
- Auth 전에도 모든 데이터에 Workspace 경계를 둔다.
- 합성 Golden Dataset을 먼저 사용한다.
- 2일을 강제 기한으로 두지 않고 단계별 수직 슬라이스를 빠르게 검증한다.
- AI task별 Provider와 모델은 ADR 0001을 따른다. SDK와 endpoint 세부 계약은 해당 adapter 착수 시 검증한다.
- 원본 자료 보관 정책은 해당 기능 착수 시 필요한 범위에서 확정한다.

되돌리기 쉬운 세부 선택은 구현 과정에서 자율적으로 결정하고, 외부 비용·개인정보·되돌리기 어려운 변경만 별도로 확인한다.
