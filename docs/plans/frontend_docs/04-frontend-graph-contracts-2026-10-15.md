# Persnapse Graph 상태·조회 계약 설계 v0.1

- 작성일: 2026-10-15 (Asia/Seoul)
- 상태: **2026-10-16 W02~W04의 인물·만남 어댑터와 탐색 전이를 구현 중이다.** 실제 범위는 [실행 기록](../../operations/frontend-graph-runs/2026-10-16-initial.md)을 따른다. 아래 전체 Graph 읽기 API·맥락 노드·원문 접근 계약은 W06–W07 대상이며 아직 구현하지 않았다.
- 연결: [실행 설계](01-frontend-graph-execution-2026-10-15.md), [전체 설계](02-frontend-graph-work-design-2026-10-14.md), [Visual Design](03-frontend-graph-visual-design-2026-10-14.md).
- 적용: W02의 client adapter·탐색 상태, W06의 계약 적합성 검토, W07의 읽기 API 구현. 기존 mutation·Recall 엔진 계약을 대체하지 않는다.

## 1. 현재 제공 정보와 확장 경계

현재 [Workspace 계약](../../../src/domain/workspace/contracts.ts)은 people·meetings·edges·personLinks·todos를 제공한다. [Recall 응답](../../../src/domain/recall/types.ts)은 personId·evidence ID/type/excerpt·memoryStatementId·memoryDocumentId를 제공하지만 모든 원본 interaction/event/topic ID를 응답에 담지는 않는다.

| 표현      | W02~W04의 근거                                    | W06~W07에서 추가 확인할 근거                                                 |
| --------- | ------------------------------------------------- | ---------------------------------------------------------------------------- |
| 인물      | `state.people[].id`, 현재 소속 문자열은 표시 속성 | 별도 Organization ID·Affiliation 없이는 회사 노드 생성 금지                  |
| 만남·참석 | `meetings[].id`, `edges[].meetingId/personId/id`  | 당시 역할·발생 시점·원문 연결                                                |
| 소개      | `personLinks[].id/aId/bId/direction`              | 역할·기록 원본의 해석 한계, 추가 사람 관계 추정 금지                         |
| 행사      | 현재 만남 이름을 Event ID로 바꾸지 않음           | `events`, `interactions.event_id`                                            |
| 주제      | 텍스트 단어로 Topic ID를 만들지 않음              | `topics`, `interaction_topics`, 검토 상태                                    |
| 소속      | 현재 프로필 문자열과 당시 소속을 구분             | `organizations`, `affiliations`의 시점·근거                                  |
| 원문      | snapshot의 실제 기록 또는 Recall 제공 발췌        | `memory_statements`, `provenance_records`, `source_assets` 등 실제 참조 경로 |

테이블 이름은 저장소 migration에서 확인한 후보이며 배포 DB의 현재 상태나 필요한 join의 적합성을 검증했다는 뜻은 아니다. W06에서 기존 repository·archived/verification 조건·workspace 접근 경계·현재 migration 순서를 대조해 매핑표를 완성한다. 계약을 맞추기 위해 DB 컬럼이나 관계를 임의 생성하지 않는다.

## 2. ID·출처·기간의 공통 언어

다음은 프레임워크 독립 TypeScript 명세다. runtime 검증 schema와 실제 파일 위치는 구현 시 기존 zod/도메인 구조에 맞춘다.

```ts
type NodeKind = "person" | "interaction" | "event" | "organization" | "topic";
type NodeKey = `${NodeKind}:${string}`; // 뒤 문자열은 실제 원본 UUID
type EdgeKey = string; // 실제 관계 ID 또는 원본 ID tuple의 정규화 key
type RecordRef = {
  kind:
    | "person"
    | "interaction"
    | "attendance"
    | "introduction"
    | "event"
    | "topic"
    | "affiliation"
    | "memory_statement"
    | "source_asset";
  id: string;
};
type GraphDate = {
  value: string | null; // YYYY / YYYY-MM / YYYY-MM-DD / offset 포함 ISO instant
  precision: "year" | "month" | "day" | "instant" | "unknown";
};
type Selection =
  { kind: "node"; key: NodeKey } | { kind: "edge"; key: EdgeKey } | null;
```

- display 이름·배열 index·좌표·현재 날짜를 ID로 사용하지 않는다. 기존 `meetingId`는 원본 Interaction ID와 실제 일치함을 adapter에서 확인한 뒤 `interaction:<id>`로 대응한다.
- 참석은 기존 edge ID를 보존한다. 복합키 관계는 workspace 내부에서 관계 종류+양 끝의 원본 ID+필요한 기간/원본 구분으로 안정 key를 만든다. 서로 다른 의미·시기의 관계를 합치지 않는다.
- `GraphDate.value=null`이면 precision은 unknown이다. 불완전한 연·월을 가짜 1일 날짜로 표시하지 않는다. `occurredAt`과 `recordedAt`은 별도 필드다.
- 기간 필터는 `[from, toExclusive)`와 IANA timezone을 사용한다. 날짜 미정 포함은 `includeUndated`로 명시한다. 부분 날짜는 기간과 가능한 구간이 겹치는 경우에만 `시점 일부만 확인`을 표시한다. 그 계산·표시는 테스트하고 완전한 일자처럼 단정하지 않는다.
- 원문·질문을 graph key나 URL에 포함하지 않는다. `confirmed`는 사용자 확인 상태이고 기록/파생/AI 여부와 별도다.

## 3. 탐색 상태 소유권과 이력

| 소유자                          | 상태                                                         | 금지 결합                                                              |
| ------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------- |
| 기존 workspace store            | 서버 canonical snapshot·version·저장 결과                    | D3 좌표·selection을 서버 모델에 기록하지 않음                          |
| Graph 탐색 reducer              | selection·focus·view·filters·expansion·history·inspectorOpen | 선택으로 focus를 자동 변경하지 않음                                    |
| layout cache                    | key별 좌표·pin·camera `{x,y,k}`·viewport 조건                | D3가 도메인 객체를 직접 변경하지 않음                                  |
| 기존 Recall 흐름과 연결 adapter | 입력 초안·제출 질문·query revision·응답·준비 상태            | 전역 검색과 업무 어시스턴트에 별도 엔진/복제 결과 저장소를 만들지 않음 |
| 편집 흐름                       | draft·최초 target ID/version·request ID·저장 상태            | selection 변경으로 저장 대상을 바꾸지 않음                             |

논리 탐색 이력은 focus·view·filters·expansion·selection·camera·좌표·그 시점 pin·Inspector 상태·목록 스크롤을 저장한다. focus/보기/필터/성공한 확장·접기 변화 직전에 이전 상태를 추가하고 동일 상태를 중복 push하지 않는다. 선택·hover·pan/zoom 매 프레임·원문 스크롤은 새 이력 항목을 만들지 않는다. 명시적 pin/drag는 현재 layout에 반영하되 자체로 논리 탐색 이력을 늘리지 않는다.

이전 탐색 복귀는 그 항목의 layout/pin도 복원한다. 이는 탐색 배치 복귀이며 저장 데이터 Undo가 아니다. snapshot 이후 저장·삭제된 서버 사실을 과거 값으로 되돌리지 않는다. 질문 초안·현재 Recall 요청·편집 draft는 탐색 이력 복귀와 별도로 유지한다. 브라우저 Back은 기존 hash 화면 이력, Graph ‘이전 탐색’은 위 이력으로 구분한다.

## 4. 이벤트 전이 계약

| ID / 이벤트                       | 변경 상태                                                                                     | 보존·예외                                                                                                                   | 검증할 결과                                                                   |
| --------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| T01 노드/선 선택·Inspector 닫기   | 선택 시 selection·Inspector 대상/open. 닫기는 open만 false                                    | focus·좌표·camera·draft·query 보존. 호출 대상이 사라졌으면 목록/Graph toolbar로 포커스 반환                                 | 같은 ID, 닫은 후 선택 marker 유지, 전체 재배치 없음                           |
| T02 빈 캔버스·명시 선택 해제      | selection=null, Inspector 닫기                                                                | 메뉴·panel·drag 종료를 빈 영역 클릭으로 오인하지 않음                                                                       | focus/filter/query/history 불변                                               |
| T03 중심/보기 변경                | 이력 push 후 focus/view·기본 slice 갱신                                                       | draft/query 유지. 기존 노드 좌표 재사용, 카메라 이동은 명시 행동의 결과                                                     | 이전 탐색으로 원래 조건·좌표 복원                                             |
| T04 필터 변경·범위 밖 결과        | 이력 push, filters·slice·관계 집계 갱신, revision 증가                                        | 기존 selection은 범위 밖 상태로 Inspector 접근 유지. 필터 해제를 암묵 실행하지 않음                                         | 범위 밖 인물 열기와 ‘지도에서 보기’ 분리, 후자는 명시 탐색                    |
| T05 확장·추가·중복/지연 응답      | 성공 후 해당 expansion과 nodes/edges를 ID로 합성                                              | anchor+종류+filters+cursor+revision이 일치할 때만 반영. 중복 클릭은 요청·삽입 중복 방지                                     | 기존 좌표/pin/camera 유지, 늦은 결과 미반영                                   |
| T06 접기·중첩 참조                | 해당 expansion만 제거                                                                         | base slice·다른 expansion·현재 selection/focus·pin이 참조하는 노드는 유지                                                   | 한 노드가 A/B 양쪽에 있으면 A 접기 후 남고 B 접기 후 보호 참조가 없을 때 제거 |
| T07 이전 탐색·갱신된 데이터       | 저장한 탐색 조건·배치 복원 후 현재 canonical 데이터와 reconcile                               | 삭제 ID는 좌표 cache 외 사실 Graph에서 제외, 대상 접근 불가 표시. draft·저장 사실 유지                                      | 과거 노드/원문 부활 없음, 복원 불가 차이 안내                                 |
| T08 선택 대상 삭제·필터 응답 경합 | 대상은 unavailable 상태, 관련 폐기 요청 무효화                                                | 알고 있는 삭제/접근 불가만 표시, 이유 불명은 열 수 없음. 숨겨진 제목 재노출 금지                                            | 다른 사람 자동 선택·draft 소실 없음                                           |
| T09 검색·Recall A/B·IME           | 입력과 제출 상태 분리, 제출 때 query revision 증가                                            | 이름/자연어를 추측해 자동 유료 호출하지 않음. IME Enter 무시, 명시 ‘기억에서 찾기’만 Recall                                 | A→B 후 B→A 응답에도 B 유지. 실패/준비 실패≠0건                                |
| T10 원문 열기·근거 응답           | source read 상태와 return selection/scroll 저장                                               | 선택·workspace·근거 revision이 달라진 응답은 현재 패널에 표시하지 않음                                                      | 발췌·요약 구분, 원문 닫기 후 이전 맥락 복원                                   |
| T11 저장·재시도·충돌              | 원래 target·version·request ID로 기존 mutation 실행                                           | 같은 payload 재확인은 request ID 재사용. 내용 수정·충돌 재검토 후 새 작업은 새 ID. 미확인은 성공 아님                       | draft 유지, 서버 확인 후 실제 변경만 반영, 카메라 자동 이동 없음              |
| T12 모바일 전환·workspace 변경    | 지도/목록·sheet 변경은 presentation만 변경. workspace 변경은 이전 요청 무효화·접근 cache 분리 | 모바일 닫기는 selection 유지. workspace가 바뀌면 이전 데이터를 표시하지 않고 미저장 draft는 기존 경계에 보존/폐기 결정 안내 | scroll·camera 복귀, 다른 workspace의 원문/개수 유출 없음                      |

scope revision은 workspace·view·focus·filter의 변경마다 갱신한다. expansion은 별도 요청 revision, evidence는 selection+ref revision, Recall은 query revision을 사용한다. Abort 외에도 response 적용 직전 키를 검사한다. 서버 데이터의 freshness 식별과 client 요청 revision은 다른 개념이다.

노드 포함 여부는 `base / expansion IDs / selection / focus / pinned` 참조 집합으로 계산한다. 필터로 숨겨진 노드를 pin 때문에 조건에 맞는 것처럼 표시하지 않는다. pin은 layout cache에서 유지하고 범위 밖 이유를 표시한다. 삭제·접근 불가 사실은 모든 표시 보호보다 우선한다.

## 5. Graph 읽기 API 제안

### 5.1 Endpoint와 요청

| 메서드·후보 경로          | 입력                                                                                                                      | 반환·책임                                          |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `GET /api/graph`          | `view`, 선택적 `focusKind/focusId`, `relationKinds`, `from/toExclusive/timezone/includeUndated`, `limit`, 선택적 `cursor` | 목적별 부분 Graph 및 capability·범위·후속 페이지   |
| `GET /api/graph/evidence` | 관계가 제공한 opaque `ref`                                                                                                | 원문 접근 상태·실제 발췌/원문·허용되는 레코드 참조 |

서버가 인증된 기존 workspace 접근 경계를 적용한다. 임의 client workspace ID를 신뢰하지 않는다. 이 endpoint를 승인·적합성 확인 전 기존 제품에 있다고 가정하지 않는다. graph read는 데이터/검색 준비를 생성하거나 LLM을 호출하거나 기록 상태를 수정하지 않는다.

focusKind/ID는 함께 제공하거나 함께 생략한다. 미지원 view/relation은 validation 오류로 알려주고 UI가 capability에 맞춰 숨긴다. limit 기본 20·최대 50은 **조회 묶음 제안**이며 동시 렌더링 한도가 아니다. 종류별 확장 UI의 초기 10개와 구분한다. W06에서 실제 비용·지원 범위를 검증하고 바뀌면 API와 fixture를 함께 갱신한다.

### 5.2 응답 타입

```ts
type RelationKind =
  | "attended"
  | "part_of_event"
  | "recorded_topic"
  | "affiliated_with"
  | "introduction_record"
  | "shared_context";
type GraphNode = {
  key: NodeKey;
  kind: NodeKind;
  sourceId: string;
  label: string;
  subtitle: string | null;
  role: "result" | "context";
  occurredAt: GraphDate;
  recordedAt: string | null;
};
type GraphEdge = {
  key: EdgeKey;
  from: NodeKey;
  to: NodeKey;
  kind: RelationKind;
  direction: "none" | "from_to";
  basis: "recorded" | "derived_context";
  verificationStatus: "confirmed" | "unreviewed" | "unknown";
  supportingRecords: RecordRef[];
  evidenceRefs: string[]; // 서버가 발급하는 opaque ref
  occurredAt: GraphDate;
  count: number | null; // 해당 기간·동일 의미로 정확하게 집계한 경우만
};
type GraphSliceResponse = {
  schemaVersion: "graph-read-v1";
  dataRevision: string; // 같은 읽기의 정합성을 나타내는 opaque token
  nodes: GraphNode[];
  edges: GraphEdge[];
  capabilities: {
    nodeKinds: NodeKind[];
    relationKinds: RelationKind[];
    evidenceRead: boolean;
  };
  coverage: {
    resultCount: number;
    contextCount: number;
    totalResultCount: number | null;
    truncated: boolean;
  };
  page: { hasMore: boolean; nextCursor: string | null };
};
```

nodes/edges 명칭은 계약 후보이며 새 runtime 타입이 이미 존재한다는 뜻은 아니다. AI 제안은 P0 기본 slice에 혼합하지 않는다. 후속 도입 시 명시적인 별도 타입·근거 계약으로 설계한다.

### 5.3 정합성·페이지·오류

- 각 페이지는 포함된 모든 edge의 양 끝 노드도 함께 반환한다. 후속 페이지에서 anchor/context 노드를 반복 반환할 수 있으며 client는 안정 key로 합성한다. dangling edge를 조용히 버려 정상 데이터로 보이지 않게 한다.
- `coverage`는 현재 응답의 중복 제거된 result/context 수다. 누적 표시 수는 client 합성 후 따로 계산한다. totalResultCount는 접근 가능하고 같은 조건으로 정확히 계산한 경우만 값이 있으며, 그 외 null이다.
- 정렬은 view별 결정적 순서와 원본 ID tie-break를 정의한다. W06에서 날짜 기반인지 이름 기반인지, null/부분 날짜 순서를 매핑표에 기록한다. cursor는 해당 focus·종류·필터·dataRevision에 바인딩한다.
- 단일 응답의 nodes·edges·집계는 일관된 읽기에서 얻는다. cursor 유효 revision이 바뀌면 `409 GRAPH_CURSOR_STALE`로 알려 첫 페이지 재조회를 제공한다. 기존 화면·초안·좌표는 보존하고 중복/누락을 성공처럼 숨기지 않는다.
- `400 GRAPH_QUERY_INVALID`, 미인증 `401`, 기존 정책상 접근 불가 `403/404`, stale cursor `409`, 조회 실패 `5xx GRAPH_READ_FAILED`를 구분한다. 다른 workspace 존재를 노출하는 오류 세분화는 하지 않는다. 오류 body는 `code`, 사용자용 `message`, `retryable`만 포함하고 내부 SQL/개인정보를 담지 않는다.
- 공유 맥락은 각각의 실제 연결을 supportingRecords로 확인한다. 기본은 맥락 경로로 제시하고 derived_context 직접 선은 별도 명시 보기에서만 사용한다. AI 추론이나 이름 파싱으로 관계를 보강하지 않는다.

### 5.4 작은 응답 예시

UUID는 가상 fixture용이다. 실제 엔드포인트 응답이나 DB 레코드가 아니다. 아래 예시는 전체 타입의 인물·만남·참석 부분을 보여준다.

```json
{
  "schemaVersion": "graph-read-v1",
  "dataRevision": "fixture-01-r1",
  "nodes": [
    {
      "key": "person:10000000-0000-4000-8000-000000000001",
      "kind": "person",
      "sourceId": "10000000-0000-4000-8000-000000000001",
      "label": "김민수",
      "subtitle": "가온벤처스",
      "role": "result",
      "occurredAt": { "value": null, "precision": "unknown" },
      "recordedAt": null
    },
    {
      "key": "interaction:20000000-0000-4000-8000-000000000001",
      "kind": "interaction",
      "sourceId": "20000000-0000-4000-8000-000000000001",
      "label": "데모데이에서의 대화",
      "subtitle": null,
      "role": "context",
      "occurredAt": { "value": "2026-09-18", "precision": "day" },
      "recordedAt": null
    }
  ],
  "edges": [
    {
      "key": "attendance:30000000-0000-4000-8000-000000000001",
      "from": "person:10000000-0000-4000-8000-000000000001",
      "to": "interaction:20000000-0000-4000-8000-000000000001",
      "kind": "attended",
      "direction": "none",
      "basis": "recorded",
      "verificationStatus": "unknown",
      "supportingRecords": [
        { "kind": "attendance", "id": "30000000-0000-4000-8000-000000000001" }
      ],
      "evidenceRefs": [],
      "occurredAt": { "value": "2026-09-18", "precision": "day" },
      "count": null
    }
  ],
  "capabilities": {
    "nodeKinds": ["person", "interaction"],
    "relationKinds": ["attended"],
    "evidenceRead": false
  },
  "coverage": {
    "resultCount": 1,
    "contextCount": 1,
    "totalResultCount": null,
    "truncated": false
  },
  "page": { "hasMore": false, "nextCursor": null }
}
```

## 6. 근거 읽기와 Recall 연결

근거 읽기 결과는 다음 판별 union으로 다룬다. metadata도 접근 허용된 범위에서만 반환한다.

```ts
type EvidenceRead =
  | {
      status: "available";
      ref: string;
      record: RecordRef;
      contentKind: "source_text" | "stored_note";
      excerpt: string | null;
      text: string;
      occurredAt: GraphDate;
      recordedAt: string | null;
      locator: { offset: number } | null;
    }
  | { status: "absent"; ref: string }
  | { status: "deleted"; ref: string }
  | { status: "unavailable"; ref: string };
```

네트워크/서버 실패는 `load_failed` client 상태로 다룬다. 서버가 실제 확인한 삭제만 deleted이며, 권한상 존재를 구분할 수 없으면 unavailable이다. absent를 네트워크 실패의 fallback으로 사용하지 않는다. available은 원문 출처 진실성의 보증이 아니다. 원본 텍스트와 저장 요약은 contentKind와 UI 문구로 구분한다. locator가 없으면 특정 문장 위치로 이동했다고 표시하지 않는다.

Recall evidence의 `id`는 type별 원본을 확인하고 기존 memoryStatementId/memoryDocumentId와 실제 resolver를 통해 연결한다. interactionId가 없는 응답은 그 경로를 추측하지 않는다. 텍스트 발췌는 그대로 읽을 수 있어도 원문 endpoint 접근은 별도 capability다. D03은 Graph 읽기 API 제안이며 Recall 응답 변경을 포함하지 않는다. Recall 응답 확장이 필요하면 별도 계약 결정·영향·테스트 근거를 기록한다.

## 7. 구현 전 적합성 Gate와 완료 증거

W06은 `노드/관계 종류 → 실제 repository/table/ID → 날짜·검토·archive 조건 → workspace 경계 → evidence resolver → 지원/미지원 → fixture 사례` 매핑표를 산출한다. 실제 컬럼·join·제한이 확인되지 않은 항목은 구현 완료로 보고하지 않는다.

| 시점    | 필수 검사·산출물                                                                              |
| ------- | --------------------------------------------------------------------------------------------- |
| W02     | 기존 snapshot→NodeKey/EdgeKey 매핑, 동명이인·고립 노드·원본 객체 불변, T01~T04의 reducer 검증 |
| W04     | T05–T08, 중첩 참조·pin·선택 보호·삭제 reconcile, 화면 좌표/카메라 전후 비교                   |
| W06     | endpoint/schema 예시 적합성, 미지원 capability·오류·cursor·기간 조건의 계약 fixture           |
| W07     | 읽기 경계·정합성·전체/표시 개수 구분, 원문 union·load_failed, 다른 workspace 사례             |
| W08–W09 | T09–T12, 기존 Recall·저장 ID·version·draft 유지, mock과 실제 연결 증거 분리                   |

날짜·원문·관계 조건이 지원되지 않을 때 client가 임의 보완하지 않는다. P0 필수 범위면 구현 의존으로 추적하고 해결하거나 사용자 범위 결정을 기록한다. 이 문서가 있다는 사실만으로 계약 적합성 Gate가 통과된 것은 아니다.
