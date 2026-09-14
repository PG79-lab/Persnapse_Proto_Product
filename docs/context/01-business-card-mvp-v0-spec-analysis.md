# Context Business Card MVP v0 분석

- 상태: 분석 완료, 의사결정 대기
- 작성일: 2026-09-13
- 원본: `docs/inputs/Context Business Card MVP v0 — Codex Technical Spec.md`
- 상위 기준: `docs/context/00-initial-canonical-context-analysis.md`
- 비목적: 원본 문서의 명령을 그대로 실행하거나 구현을 시작하는 것

## 1. 문서의 역할

이 문서는 Persnapse의 상위 개념을 실제 인터뷰용 제품 데모로 번역한 **구체화 초안**이다. Capture, Context, Memory, Recall, Action을 하나의 경험으로 닫으려는 방향은 Canonical Context와 일치한다.

다만 제목과 내용상 다음 세 문서가 한곳에 섞여 있다.

1. 제품 가설과 MVP 범위
2. 기술 설계 초안
3. 2일 프로토타입 실행 계획

세 역할은 수명과 확정 기준이 다르므로 분리해야 한다. 특히 `2일 내 완성`은 일정 제약이지 제품 정의나 장기 아키텍처 원칙이 아니다.

## 2. Canonical Context와 잘 맞는 부분

- Capture → Context → Memory → Recall → Action의 전체 루프를 구현 단위로 본다.
- 명함 OCR을 최종 가치가 아닌 Capture 수단으로 본다.
- 추정 정보를 사실처럼 저장하지 않고 출처와 확신도를 표시한다.
- AI 출력 수정과 사용자 확인을 전제로 한다.
- Graph를 데이터 원본이 아닌 탐색 인터페이스로 본다.
- Recall 응답에서 답변보다 Evidence, Context, Action을 강조한다.
- Agent의 외부 실행과 복잡한 자율 루프를 제외한다.
- Graph DB, microservice와 범용 Agent framework 같은 초기 과설계를 피한다.
- Golden Dataset과 사용자 피드백을 통해 Recall 품질을 검증하려 한다.

## 3. 가장 가치 있는 구체화

### 완결된 데모 시나리오

명함 입력부터 맥락 추가, 관계 기억 생성, 자연어 회상, 근거 제시와 행동 추천까지 연결된 하나의 검증 단위가 생겼다. 이는 기능별 데모보다 제품 가설을 검증하기에 적합하다.

### Recall 결과 계약

`answer`, 관련 사람, 이유, evidence, recalled context와 suggested action을 분리한 응답 구조는 Persnapse가 단순 채팅 검색이 아님을 잘 드러낸다.

### 관찰 지표

등록 시간, 수정 횟수, Context 입력률, Query 성공 여부, 근거 열람과 결과 피드백은 인터뷰에서 기능 작동 여부와 가치 신호를 분리해 관찰할 수 있게 한다.

### 의도적인 제외 범위

Native app, 외부 CRM 연동, 자동 행동 실행, 자체 모델 학습과 대규모 최적화를 제외한 것은 초기 검증 목적에 적합하다.

## 4. 구현 전에 보정해야 할 구조적 문제

### 4.1 2일 P0가 과도하게 크다

현재 P0에는 이미지 추출, 편집, 음성, STT, Context 추론, Profile, Archive, Graph, 자연어 검색, Retrieval, 분석, 행동 제안, 피드백까지 포함된다. 이는 단일 위험을 검증하는 MVP가 아니라 여러 불확실성을 동시에 구현하는 압축 프로젝트에 가깝다.

이 범위를 2일에 맞추면 다음이 희생될 가능성이 높다.

- Identity와 중복 처리
- 데이터 provenance
- 실패·재시도와 부분 저장
- 개인정보 보호
- 테스트와 재현 가능한 평가
- 이후 변경 가능한 모듈 경계

따라서 **2일 프로토타입 계획과 지속 가능한 MVP 구축 계획을 분리**해야 한다.

### 4.2 Draft와 Memory Commit 경계가 없다

원본 API 흐름은 `/cards/ingest`가 `draftPerson`을 반환하지만 `/context/process`는 `person_id`를 요구하고, `/people/confirm`에서 최종 저장한다고 설명한다. 확인되지 않은 Person이 언제 생성되는지 모순된다.

필요한 제품 개념은 Person을 성급히 생성하는 것이 아니라 **Capture Session / Draft**다.

```text
Upload
→ extraction draft
→ context draft
→ identity candidate review
→ user confirm
→ atomic memory commit
```

실패하거나 취소된 Capture가 확정 Person과 Graph를 오염시키지 않아야 한다.

### 4.3 Canonical Entity가 문자열과 배열로 축소된다

원본 DB 초안의 `people.company`, `interactions.event_name`, `place_name`, `topics[]`, `commitments[]`, `next_actions[]`는 데모 구현에는 빠르지만 다음 문제를 만든다.

- 같은 회사·행사·주제의 표기 차이로 Graph가 분열된다.
- 소속과 직책의 시간 변화가 사라진다.
- 행동과 약속의 상태를 갱신하기 어렵다.
- 값별 출처와 사용자 확인 상태를 보존하기 어렵다.
- 여러 사람이 참여한 Interaction과 Introduction을 표현하기 어렵다.

모든 것을 완전 정규화할 필요는 없지만, Person·Organization·Interaction·Event·Topic·Action과 provenance 경계는 초기에 보존해야 한다.

### 4.4 Identity Resolution이 누락됐다

Canonical Context의 중요한 원칙인 `Candidate Match → User Verify → Commit`이 API, 화면과 데이터 모델에서 충분히 드러나지 않는다. 이름, 이메일, 전화번호와 회사가 비슷한 기존 Person 후보를 보여주되 자동 병합하지 않는 흐름이 필요하다.

### 4.5 사용자 또는 Workspace 경계가 없다

Business Card, 음성, 관계 메모는 개인정보와 민감한 업무 맥락을 포함한다. Production Auth를 제외하더라도 모든 핵심 레코드에 소유 범위를 둘 수 있어야 한다. 단일 데모 사용자를 사용하더라도 schema에서 `workspace_id` 또는 동등한 경계를 제거하면 이후 격리가 매우 어려워진다.

### 4.6 Memory Chunk가 원본 사실처럼 보인다

Embedding용 Memory Chunk는 검색을 위한 파생물이어야 한다. 사용자 입력, 확인된 Person, Interaction과 Action이 원본이며 Chunk와 embedding은 언제든 다시 생성할 수 있어야 한다.

요약 문장만 저장하면 어떤 문장이 사용자 사실이고 어떤 문장이 AI 추론인지 설명하기 어렵다.

### 4.7 수치 Confidence의 의미가 과대평가된다

LLM이 반환한 `0.84`는 실제 확률로 보장되지 않는다. 사용자에게는 다음과 같은 상태가 더 중요하다.

- 사용자 명시
- 메타데이터로 확인
- 외부 출처로 확인
- AI 추정
- 알 수 없음
- 사용자 확인 또는 수정 완료

수치 confidence는 내부 정렬과 검토 우선순위에 사용할 수 있지만 사실성의 보증으로 표시하면 안 된다.

### 4.8 Graph 정의가 내부적으로 일치하지 않는다

Node Types에는 Interaction이 없지만 Edge 예시는 `Interaction → Place`를 사용한다. 예시 그래프에서는 `Event → Place`를 사용한다. 또한 `SHARED_CONTEXT`는 실제 사람 간 관계가 아니라 파생된 유사성이다.

Graph에는 다음 구분이 필요하다.

- 확인된 사실 관계
- 사용자 입력 관계
- 시스템이 계산한 파생 관계
- 질문 시점에만 만들어지는 탐색 관계

### 4.9 Edge Strength가 데이터보다 앞서 있다

초기에는 interaction frequency, explicit priority와 repeated context 데이터가 충분하지 않다. 가중치 수식은 정밀해 보여도 실제 근거가 약할 수 있다. MVP에서는 설명 가능한 단순 신호와 구성 요소 표시가 우선이며, 관계 강도를 핵심 성공 기준으로 삼지 않는 편이 안전하다.

### 4.10 Retrieval이 Vector Top-K에 과도하게 의존한다

“ABC Ventures 사람”, “코엑스에서 만난 사람”, “지난달 행사” 같은 질문은 구조화 필터와 시간 조건이 중요하다. Vector search만으로 처리하면 명확한 사실 질문도 불안정해질 수 있다.

Recall은 다음을 조합해야 한다.

- Entity와 시간 조건 추출
- 구조화 필터
- semantic retrieval
- 관계 확장
- evidence ranking

### 4.11 Action의 책임 범위가 불명확하다

외부 실행을 제외한 것은 명확하지만, 추천 Action이 기존 사용자의 약속을 회상한 것인지 AI가 새로 제안한 것인지 구분되지 않는다. 둘은 신뢰 수준과 UI가 달라야 한다.

### 4.12 성능 목표와 Demo Error Rate 정의가 부족하다

AI 호출이 여러 개인 흐름에서 Card 5초, Agent 6초는 유용한 체감 목표지만 네트워크와 Provider 변동을 포함한 합격 기준으로 쓰기 어렵다. `Demo error rate <5%`도 분모와 오류 유형이 정의되지 않았다.

성능은 단계별 계측값으로, 품질은 Golden Dataset의 field·retrieval·evidence 정확도로 분리해야 한다.

## 5. MVP 범위에 대한 재분류 제안

### Core Loop 필수

- 단일 명함 이미지 업로드
- 구조화 결과 검토 및 수정
- 기존 Person 후보 확인 또는 신규 생성
- Text Context 입력과 구조화 결과 검토
- 하나의 트랜잭션으로 Person·Interaction·Memory 저장
- Archive와 Person Context Profile
- 자연어 Recall
- 근거가 연결된 결과
- 기존 약속 회상 또는 비실행형 행동 제안
- 핵심 이벤트와 오류 계측

### 독립적으로 검증할 Experience Module

- Voice + STT
- Graph 탐색 UI

두 기능은 최종 MVP 후보에는 포함할 수 있지만 Core Loop가 작동하지 않을 때 전체 구축을 막는 선행 조건으로 두지 않는다.

### 초기 보류

- 3D Graph
- Web enrichment
- Person-Person shared-context edge
- 관계 강도 고도화
- 자동 Query suggestion
- 외부 Action 실행
- Team Graph

## 6. 제품 검증 관점에서의 우선순위

원본 문서는 Capture 구현 후 Memory와 Agent를 배치하지만, Persnapse의 가장 큰 제품 위험은 OCR이 아니라 Recall 가치다. 따라서 Seed Dataset으로 Recall과 Evidence를 먼저 검증 가능한 상태로 만들고, 이후 실제 Capture를 연결하는 순서가 더 안전하다.

```text
Seeded Memory → Recall + Evidence
              ↓
Text Capture → Confirm → Memory Commit → Recall
              ↓
Card Extraction
              ↓
Voice
              ↓
Graph Experience
```

이 순서는 최종 사용자 흐름을 바꾸는 것이 아니라 가장 위험한 가설을 더 일찍 검증한다.

## 7. 결론

원본 Technical Spec은 Persnapse의 첫 데모를 상상하고 작업 단위를 식별하는 데 충분히 구체적이다. 그러나 그대로 코드로 옮기기 전에 다음 네 가지를 보정해야 단단한 0→1 기반이 된다.

1. 2일 데모와 지속 가능한 MVP 구축을 분리한다.
2. Draft → Identity Review → Atomic Commit 경계를 만든다.
3. Temporal Context와 provenance를 잃지 않는 최소 도메인 모델을 사용한다.
4. Recall + Evidence를 가장 먼저 검증하고 Graph와 Voice를 독립 모듈로 연결한다.

이 보정을 반영한 제안 제품 범위, 아키텍처와 구축 계획은 각각 별도 문서로 관리한다.
