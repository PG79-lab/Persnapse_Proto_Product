# Persnapse MVP Definition v0.1

- 상태: 구축을 위한 Working Baseline
- 작성일: 2026-09-13
- 근거: Canonical Context 및 Context Business Card MVP v0 분석
- 목적: 구현에 앞서 검증할 제품 가설과 경계를 명확히 함

## 1. 제품 정의

Persnapse MVP는 명함과 사용자가 남긴 만남 맥락을 신뢰 가능한 관계 기억으로 저장하고, 시간이 지난 뒤 자연어 질문으로 정확한 사람과 근거를 회상해 다음 행동을 판단하도록 돕는 개인용 Business Relationship Memory다.

## 2. 최초 사용자와 상황

### 우선 사용자

외부 사람을 자주 만나며 후속 연락이 업무 성과에 직접 영향을 주는 Sales / Business Development 사용자.

### 최초 상황

행사나 미팅에서 받은 명함을 등록하고 짧은 관계 맥락과 약속을 남긴 뒤, 며칠 또는 몇 주 후 특정 주제·행사·회사·약속을 단서로 다시 사람을 찾는 상황.

## 3. 검증할 핵심 가설

### H1. Context Capture

사용자는 연락처 정보만 저장하는 것보다 어디서 왜 만났고 무엇을 약속했는지 남기는 데 추가 가치를 느낀다.

### H2. Trustworthy Memory

AI가 구조화한 결과를 빠르게 검토·수정할 수 있고 출처와 추정 여부를 이해할 때 관계 기억을 맡길 의향이 생긴다.

### H3. Recall Value

사용자는 이름을 정확히 기억하지 못해도 시간, 장소, 행사, 회사, 주제나 약속을 단서로 원하는 사람을 찾을 수 있다.

### H4. Evidence

결과의 이유와 원래 맥락이 함께 제시될 때 사용자는 AI 답변을 신뢰하고 행동에 활용한다.

### H5. Action Bridge

기존 약속의 회상 또는 근거 있는 다음 행동 제안이 단순 검색보다 더 높은 제품 가치를 만든다.

### H6. Graph Experience

관계 맥락을 시각적으로 탐색하는 방식이 목록과 검색만으로 얻기 어려운 이해를 추가한다. 이 가설은 Core Recall과 분리해 측정한다.

### H7. Voice Experience

음성 입력이 텍스트보다 실제 Capture 마찰을 낮추고 더 풍부한 맥락 기록을 유도한다. 이 가설도 Text Capture와 분리해 측정한다.

## 4. 핵심 사용자 흐름

```text
명함 업로드
→ 필드 추출 결과 검토·수정
→ 기존 Person 후보 확인 또는 신규 선택
→ 만남 맥락 입력
→ 구조화 결과와 추정 항목 검토
→ Memory Commit
→ Archive / Profile에서 확인
→ 자연어 질문
→ 관련 Person + Evidence + Context 회상
→ 기존 약속 또는 추천 행동 확인
```

Voice와 Graph는 이 흐름에 연결되는 독립 Experience Module이다.

## 5. MVP 필수 범위

### Capture와 Confirm

- 단일 명함 이미지 업로드
- 이름, 회사, 직책, 이메일, 전화번호 추출
- 모든 추출 필드 검토와 수정
- 처리 실패 표시와 재시도
- 유사한 기존 Person 후보 표시
- 자동 병합 없는 사용자 확인
- Text Context 입력
- 시간, 장소, 행사, 주제, 약속과 다음 행동 후보 구조화
- 사용자 명시, 확인된 메타데이터, AI 추정 상태 구분
- 저장 전 수정과 최종 확인

### Memory

- Person, 소속, Interaction, Event, Topic와 Action의 최소 관계 저장
- 사용자 입력과 AI 파생값의 provenance
- 생성·발생 시점 구분
- 확인된 사실과 추정 상태 구분
- Profile에서 시간순 관계 맥락 확인

### Recall

- 자연어 질문 입력
- 사람, 회사, 행사, 장소, 주제와 시간 조건을 이용한 검색
- 관련 Person과 근거 제시
- 어떤 기억 때문에 선택됐는지 표시
- 결과가 불확실하거나 없을 때 명확한 상태 제공

### Action

- 사용자가 기록한 약속 또는 미완료 행동 회상
- 근거가 있는 비실행형 행동 제안
- 회상된 약속과 AI 추천을 명확히 구분

### Validation

- Capture 완료와 수정량 계측
- Query, retrieval, evidence와 latency 기록
- 결과 유용성 피드백
- Golden Dataset 및 Golden Query
- Core Loop end-to-end 검증

## 6. 독립 Experience Module

### Voice Context

- 10~60초 음성 녹음
- STT 결과 확인
- Text와 동일한 Context 구조화 흐름
- Text 대비 입력 시간과 수정량 비교

### Relationship Graph

- 확인된 Person, Organization, Event와 Topic 중심의 기본 그래프
- 노드 선택과 Profile 연동
- 사실 관계와 파생 관계의 시각적 구분
- 목록·검색 대비 추가 탐색 가치 측정

두 모듈은 MVP 후보지만 Core Loop 구축을 지연시키는 선행 조건은 아니다.

## 7. 비범위

- 3D Graph와 고급 애니메이션
- Graph DB
- Web 자동 enrichment
- 실제 지인 관계로 오해될 Person-Person 추론
- 고도화된 관계 점수
- 외부 연락·이메일·캘린더 자동 실행
- 자율 Agent loop
- 자체 OCR, STT 또는 LLM 학습
- Native mobile app
- CRM 연동
- Team Relationship Graph
- 대규모 운영 최적화
- Production 공개 출시

## 8. 성공 기준

### 기능 성공

Golden Dataset을 사용해 다음 흐름이 반복 가능해야 한다.

1. 실제 명함에서 수정 가능한 Person draft를 만든다.
2. 사용자가 만남 맥락을 입력하고 추정 내용을 확인한다.
3. 기존 Person을 잘못 병합하지 않고 Memory를 저장한다.
4. 이름을 직접 사용하지 않는 Golden Query로 관련 Person을 찾는다.
5. 답변이 실제 저장된 Evidence를 가리킨다.
6. 기록된 약속 또는 근거 있는 행동 제안을 구분해 보여준다.

### 품질 성공

- Golden Query마다 기대 Person과 필수 Evidence를 정의한다.
- 근거 없는 Person 또는 관계를 생성하지 않는다.
- 사용자 수정 내용이 이후 AI 처리로 되돌아가지 않는다.
- 실패한 Capture가 확정 Memory나 Graph를 오염시키지 않는다.
- AI 출력 validation 실패와 Provider 오류가 사용자에게 복구 가능한 상태로 표시된다.

### 제품 신호

- 사용자가 Context를 자발적으로 추가하는가?
- Recall 결과가 누구인지뿐 아니라 왜 관련 있는지 이해하게 하는가?
- 사용자가 결과를 실제 후속 행동에 활용할 의향을 보이는가?
- 같은 방식으로 더 많은 관계를 기록하고 싶어 하는가?
- Voice와 Graph가 각각 추가 가치를 만드는가?

정량 기준은 초기 인터뷰와 Golden Dataset baseline을 확보한 뒤 확정한다. 근거 없는 임의 백분율은 초기 합격 기준으로 사용하지 않는다.

## 9. 구현 전 승인할 Product Decisions

1. Sales / BD 안에서 최초 인터뷰 역할과 업무 상황
2. Graph를 최초 MVP release 필수로 볼지 독립 실험으로 볼지
3. Voice를 최초 MVP release 필수로 볼지 독립 실험으로 볼지
4. Action의 경계를 약속 회상까지로 둘지 AI 추천까지 포함할지
5. 최초 지원 언어와 명함 형식
6. 개인 데이터 보관·삭제와 원본 이미지 유지 정책
7. 최초 검증에 사용할 Golden Dataset의 실데이터 또는 합성데이터 비율
