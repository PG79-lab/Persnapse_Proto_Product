# Persnapse MVP Architecture v0.1

- 상태: Phase 3.5 runtime·projection hardening 반영
- 작성일: 2026-09-13
- 목적: 빠른 MVP와 이후 확장 사이의 최소 안정 경계를 정의
- 비목적: 세부 DB migration, API 최종 계약, 특정 AI 모델 확정

## 1. 설계 원칙

1. 하나의 배포 가능한 애플리케이션으로 시작한다.
2. 기능이 아니라 도메인 경계로 코드를 나눈다.
3. 사용자 확인 전 데이터는 Draft, 확인 후 데이터는 Memory로 분리한다.
4. Person Identity는 보수적으로 처리하고 자동 병합하지 않는다.
5. 사용자가 입력·확인한 사실과 AI 추론을 구분한다.
6. PostgreSQL 관계 데이터가 원본이며 Graph와 Vector는 파생 projection이다.
7. AI 출력은 schema validation을 통과한 뒤에만 사용한다.
8. Provider 실패가 확정 데이터를 손상시키지 않게 한다.
9. 외부 행동은 실행하지 않고 제안까지만 제공한다.
10. 개인정보 격리와 삭제 가능성을 첫 schema부터 고려한다.

## 2. 제안 기술 형태

원본 문서의 단순한 단일 애플리케이션 방향은 유지한다.

| 영역                 | 제안                                             |
| -------------------- | ------------------------------------------------ |
| Language             | TypeScript                                       |
| Web application      | Next.js 기반 단일 애플리케이션                   |
| UI                   | Tailwind CSS 및 접근 가능한 component primitives |
| Primary database     | PostgreSQL                                       |
| Managed backend 후보 | Supabase Database, Storage, Auth                 |
| Semantic index       | PostgreSQL vector extension 기반 파생 index      |
| Runtime validation   | Zod 또는 동등한 schema validator                 |
| Unit / integration   | Vitest 계열                                      |
| Browser E2E          | Playwright 계열                                  |
| Deployment 후보      | Vercel + Supabase managed services               |

AI task별 Provider와 모델은 `ADR 0001 — AI Task Model Routing`으로 확정했다. 정확한 SDK version과 Provider endpoint 계약은 해당 adapter 구현 직전 공식 문서와 계정 접근 상태를 확인한다. 애플리케이션 코어가 특정 Provider 응답 형식에 직접 의존하지 않도록 얇은 adapter 경계를 유지한다.

### AI Model Router

| 역할                      | Primary API                 |
| ------------------------- | --------------------------- |
| 명함 OCR                  | NAVER CLOVA OCR             |
| 음성 변환                 | OpenAI `gpt-transcribe`     |
| 정보 구조화·분류          | OpenAI `gpt-5.6-luna`       |
| Context embedding         | Voyage `voyage-4`           |
| 후보 재정렬               | Voyage `rerank-3-lite`      |
| 일반 사용자 질의          | OpenAI `gpt-5.6-terra`      |
| 고품질 Business reasoning | Anthropic `claude-sonnet-5` |
| 최고난도 선택 호출        | OpenAI `gpt-5.6-sol`        |

일반 경로에서 최고급 모델을 상시 호출하지 않는다. Model Router는 task 유형과 reasoning escalation 조건을 기준으로 adapter를 선택하며, 각 모델은 환경변수로 교체 가능하게 둔다.

Phase 3.5부터 `mock`은 외부 호출 없는 deterministic adapter만 사용하고, `live`는 task별 credential과 실제 adapter가 없으면 명시적으로 실패한다. 환경변수의 model override, timeout, retry, fallback, schema validation과 개인정보를 포함하지 않는 attempt telemetry는 공통 runtime 계약에서 처리한다.

## 3. 시스템 경계

```text
Browser UI
  ├─ Capture & Review
  ├─ Archive & Person Profile
  ├─ Recall & Evidence
  └─ Graph / Voice modules
          │
          ▼
Application Services
  ├─ Capture Session
  ├─ Identity Resolution
  ├─ Memory Commit
  ├─ Recall
  └─ Feedback / Telemetry
          │
          ├──────────────┐
          ▼              ▼
PostgreSQL / Storage   AI Adapters
  ├─ Canonical facts    ├─ card extraction
  ├─ Provenance         ├─ transcription
  ├─ Draft state        ├─ context structure
  ├─ Vector projection  ├─ embedding
  └─ Query evidence     └─ answer / suggestion
```

Graph API와 semantic retrieval은 별도 원본 저장소가 아니라 PostgreSQL의 확인된 Memory를 읽어 만든 projection이다.

## 4. 도메인 모듈

### Identity

- Person 생성과 수정
- 연락 수단과 소속 정보
- 유사 Person 후보 탐색
- 사용자 확인 기반 연결 또는 신규 생성
- 자동 병합 금지

### Capture

- 이미지와 음성 원본 수신
- Capture Session 상태 관리
- 명함 필드 추출
- Text / Voice Context 수집
- AI 구조화 결과와 사용자 수정 보존

### Memory

- Interaction, Event, Topic, Commitment와 Action 저장
- provenance 및 verification 상태
- 시간순 Person Context 조립
- 검색용 Memory Document 생성

### Recall

- Query 해석
- 구조화 조건과 semantic retrieval 결합
- 관련 Memory와 Person ranking
- Evidence selection
- 근거 기반 응답과 행동 제안

### Exploration

- Archive와 필터
- Person Context Profile
- Graph projection 및 focus

### Evaluation

- Golden Dataset과 Query
- Capture correction, retrieval 결과와 feedback 기록
- AI 호출 latency, 오류와 비용 메타데이터

## 5. 핵심 상태 흐름

### Capture Session

```text
draft
→ review
→ committed
```

복구 상태:

```text
draft 또는 review → failed
failed → draft 또는 review
review → draft 수정
```

`committed`는 terminal 상태다. 세부 처리 milestone은 Capture 종류별 application metadata로 표현하고 영속 상태 수를 불필요하게 늘리지 않는다. `committed` 전에는 확정 Person, Interaction과 Graph에 나타나지 않는다. AI 최초 결과인 `model_draft`와 사용자가 수정하는 `structured_draft`를 분리하고, 사용자에게 보이는 Draft는 versioned validation schema를 통과한 구조만 사용한다.

### Memory Commit

사용자 확인 시 하나의 transaction에서 다음을 수행한다.

1. 기존 Person 연결 또는 신규 Person 생성
2. 확인된 Profile field 반영
3. Event / Organization / Topic 후보 resolve
4. Interaction과 참여 관계 생성
5. 약속과 Action 생성
6. provenance 및 verification 기록
7. Capture Session을 committed로 전환

검색 문서와 embedding 생성은 commit 이후 재시도 가능한 작업으로 분리한다. Person 단위 projection은 content hash가 달라질 때만 갱신하고 해당 embedding을 `pending`으로 되돌린다. embedding은 1024차원 계약을 사용하며 실패해도 원본 Memory commit은 유지된다.

## 6. 최소 개념 데이터 모델

아래는 table 최종 명세가 아니라 반드시 보존할 도메인 경계다.

| 개념                             | 책임                                                       |
| -------------------------------- | ---------------------------------------------------------- |
| Workspace                        | 모든 개인정보와 관계 데이터의 소유 범위                    |
| Person                           | 독립 Identity                                              |
| Person Attribute / Contact Point | 이름 외 식별 정보와 검증 상태                              |
| Organization                     | 회사 및 조직 Identity                                      |
| Affiliation                      | Person과 Organization의 시간성 있는 소속·직책              |
| Source Asset                     | 명함 이미지, 음성과 원본 입력 메타데이터                   |
| Capture Session                  | 확인 전 Draft와 처리 상태                                  |
| Event                            | 관계가 발생한 명시적 사건                                  |
| Interaction                      | 특정 시점의 만남·대화·연락                                 |
| Participant                      | Interaction에 참여한 Person                                |
| Topic                            | 구조화된 관심사·논의 주제                                  |
| Interaction Topic                | Interaction에서 Topic이 언급된 근거 관계                   |
| Memory Statement                 | 사용자 사실 또는 AI가 도출한 기억 단위                     |
| Action Item                      | 약속, 후속 행동 또는 AI 추천 후보                          |
| Provenance                       | source, derivation, confidence class와 verification        |
| Memory Document                  | Retrieval을 위해 재생성 가능한 파생 텍스트                 |
| Query / Evidence                 | 질문, 회수 결과와 답변 근거                                |
| Feedback                         | 사용자의 결과 평가                                         |
| AI Run                           | Provider, model, latency, token, schema 및 오류 메타데이터 |

### 최소 시간 필드

- `occurred_at`: 실제 사건 시점
- `captured_at`: 사용자가 시스템에 입력한 시점
- `created_at`: 레코드 생성 시점
- `updated_at`: 최신 수정 시점
- 필요시 `valid_from`, `valid_to`: 소속과 상태의 유효 기간

### Provenance 분류

```text
source_kind:
  manual
  business_card
  note
  voice
  import
  ai_inference
  system

verification_status:
  draft
  confirmed
  rejected
```

사용자 수정은 source와 provenance 이력으로 보존한다. 수치 confidence는 선택적 내부 메타데이터로 유지하며 verification을 대신하지 않는다.

## 7. Identity Resolution

### 후보 생성 신호

- 정규화된 이메일 또는 전화번호의 정확 일치
- 이름과 Organization 조합
- 이름과 역할 또는 웹사이트 조합
- 과거 Interaction 맥락

### 결정 규칙

- 후보가 없어도 자동 생성 전에 사용자가 확인한다.
- 단일 강한 후보가 있어도 자동 병합하지 않는다.
- 사용자는 기존 Person 연결, 신규 Person 생성 또는 보류를 선택한다.
- merge 기능은 MVP 기본 흐름에서 제외하고 별도 관리 작업으로 둔다.

## 8. Recall Pipeline

```text
Query
→ Korean normalization / intent / term / reference-time parsing
→ confirmed-only corpus load
→ structured term matching + deterministic local semantic retrieval
→ evidence ranking and Person aggregation
→ evidence-constrained deterministic answer
→ response contract validation
→ result + evidence + action distinction
→ Query / AI Run / Evidence snapshot persistence
```

Phase 3 기준선의 semantic retrieval은 외부 모델 호출이나 영속 vector가 아닌 `local-hash-v1` feature hashing을 사용한다. 이는 Golden Dataset에서 retrieval 계약과 UX를 먼저 검증하기 위한 deterministic adapter이며 Canonical Memory가 아니다. 실제 token 또는 정의된 의미 concept이 공유되지 않으면 hash 충돌 점수만으로 후보를 만들지 않는다. 실제 Voyage embedding과 reranking은 동일한 응답 계약 뒤에 교체 가능하게 연결한다.

### Retrieval 우선순위

1. 정확한 식별 정보와 구조화 조건
2. 시간·행사·장소·회사 조건
3. semantic similarity
4. 확인된 관계 확장

### 응답 계약의 핵심

- Answer는 선택된 Evidence 밖의 사실을 단정하지 않는다.
- 관련 Person마다 선택 이유와 Evidence ID를 제공한다.
- 저장된 약속과 새 AI 제안을 다른 타입으로 반환한다.
- 저장된 Action과 AI 제안은 모두 자동 실행하지 않는다.
- 결과 없음, 모호함과 부분 일치를 표현할 수 있어야 한다.
- 전체 응답에 하나의 confidence 숫자를 붙이는 대신 근거 상태를 표시한다.
- 검색 시점의 Evidence 본문과 사건 시각을 snapshot으로 보존하여 projection 재생성 후에도 과거 답변을 설명할 수 있게 한다.

### Phase 3 구현 경계

- `memory_documents` Person projection에는 `confirmed` Affiliation, Memory, Interaction만 들어간다.
- Query의 상대 시간 해석 기준인 `reference_time`과 parser·retrieval version을 함께 저장한다.
- 동명이인은 정확한 이름 하나만으로 질의했을 때 별도 Person 후보를 유지하고 `ambiguous`로 반환한다.
- `query_evidence`는 결과 Person마다 대표 Evidence를 저장하고 전체 선택 Evidence는 Query response payload에 보존한다.
- API와 서버 화면은 동일한 Recall application service를 사용한다.
- Provider 오류 UI 경계는 구축했으며 live AI adapter 오류 분류는 실제 Provider 연결 단계에서 추가한다.

## 9. Graph Projection

초기 Graph는 확인된 데이터에서 읽기 시점에 만든다.

### 기본 노드 후보

- Person
- Organization
- Event
- Topic
- 선택적으로 Place

Interaction은 Profile timeline의 중심이지만 초기 Graph에서는 edge evidence로 표현할 수 있다. Interaction을 Node로 보여줄지는 UX 검증 후 결정한다.

### Edge 분류

- `confirmed`: 사용자가 확인한 사실
- `reported`: 사용자 입력에서 나온 관계
- `inferred`: AI 추정
- `derived`: 같은 Event나 Topic을 공유해 계산된 관계

`derived` Person-Person 연결은 실제 친분을 의미하지 않으며 기본 MVP에서는 보류한다.

관계 강도는 초기에 굵기 하나로 단정하기보다 recency, interaction count, explicit importance 같은 구성 신호를 설명 가능하게 제공한다.

## 10. 제안 API 경계

세부 URL과 payload는 구현 전 contract로 확정한다.

| 작업                     | 책임                                       |
| ------------------------ | ------------------------------------------ |
| Create capture session   | 빈 Draft와 업로드 위치 생성                |
| Upload source asset      | 명함 또는 음성 연결                        |
| Extract card             | validation된 field observations 생성       |
| Add context              | Text 또는 transcript를 Draft에 추가        |
| Structure context        | Event, Topic, Memory와 Action 후보 생성    |
| Find identity candidates | 기존 Person 후보와 근거 반환               |
| Commit capture session   | 사용자 선택을 하나의 transaction으로 확정  |
| Get person context       | Profile과 timeline 반환                    |
| Query recall             | 관련 Person, Evidence와 Action 반환        |
| Get graph projection     | 필터된 nodes, edges와 edge provenance 반환 |
| Record feedback          | Query 및 기능 평가 저장                    |

Write API는 workspace 범위와 idempotency를 가져야 하며, 재시도로 Person이나 Interaction이 중복 생성되지 않아야 한다.

## 11. 저장소 구조 제안

초기에는 monorepo나 별도 package를 만들지 않고 하나의 애플리케이션으로 시작한다.

```text
src/
  app/                 # routes와 화면 조립
  features/
    capture/
    identity/
    memory/
    recall/
    exploration/
    evaluation/
  domain/              # 핵심 타입, 상태와 불변 조건
  server/
    application/       # use cases
    db/                # repositories와 transactions
    ai/                # 얇은 provider adapters
    telemetry/
  components/          # 공유 UI primitives
supabase/
  migrations/
  seed/
tests/
  integration/
  e2e/
  evals/
```

실제 scaffold는 기술 선택 승인 후 생성한다.

## 12. 개인정보와 보안 기반

- 명함, 음성, 연락처와 관계 메모를 민감한 사용자 데이터로 취급한다.
- 모든 row와 storage object는 Workspace 소유 범위를 가진다.
- 원본 이미지와 음성의 보관 기간 및 삭제 정책을 정의한다.
- application log에 명함 원문, transcript, 이메일과 전화번호를 기본 출력하지 않는다.
- AI Provider로 전송되는 데이터와 보존 설정을 명시한다.
- secrets는 환경변수로만 관리하고 저장소에 커밋하지 않는다.
- Production 공개 사용은 Auth, 접근 정책과 삭제 경로가 검증된 이후에만 허용한다.

## 13. 실패와 재시도 원칙

- 업로드, OCR, STT, 구조화, embedding과 answer generation 오류를 구분한다.
- 재시도는 동일 Capture Session과 AI Run에 연결한다.
- AI parsing 실패는 원본 응답을 확정 데이터로 쓰지 않는다.
- embedding 실패는 Memory 저장을 rollback하지 않는다.
- Recall 실패는 저장 데이터를 수정하지 않는다.
- 부분 성공 상태를 사용자에게 보여주고 재개할 수 있게 한다.

## 14. 테스트 전략

### Domain

- Capture 상태 전이
- 자동 병합 금지
- 사용자 확인 데이터 우선
- 취소된 Draft가 Memory에 나타나지 않음
- Commit idempotency

### AI Contract

- 명함 extraction schema fixture
- Context structure schema fixture
- 잘못된 JSON과 필수 필드 누락 fallback
- Evidence 없는 답변 차단

### Database Integration

- migration from empty database
- workspace 격리
- atomic commit
- Memory Document 재생성
- vector index 없이도 원본 Memory 보존

### Evaluation

- 동명이인과 유사 회사가 포함된 Golden Dataset
- entity, time, event, topic, commitment 유형별 Golden Query
- 기대 Person과 Evidence ranking
- hallucinated relation 탐지

### End-to-End

- Upload → Review → Context → Identity → Commit → Recall
- Provider 실패 후 retry
- 사용자 correction 보존
- 결과 없음과 모호한 Query

## 15. 구현 전 기술 결정 사항

1. 관리형 Supabase를 초기 backend로 확정할지
2. 데모에도 실제 Auth를 적용할지 단일 Workspace mode로 시작할지
3. 원본 명함과 음성의 보관 정책
4. AI Provider와 모델별 역할
5. background processing을 request 안에서 할지 최소 job mechanism을 둘지
6. Graph library 및 2D/3D 여부
7. 한국어·영어 명함과 Query의 최초 지원 범위
