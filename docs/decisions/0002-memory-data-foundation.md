# ADR 0002 — Memory Data Foundation

- 상태: Accepted
- 결정일: 2026-09-15
- 적용 범위: Phase 2 Memory Foundation과 이후 Recall·Capture 단계

## 맥락

Persnapse는 연락처 목록이 아니라 사람과 만남의 맥락을 근거와 함께 기억하는 시스템이다. 초기 MVP에서도 동명이인, 유사 조직, 시간에 따라 달라지는 소속, 반복 만남, 확인되지 않은 AI 추론을 안전하게 표현해야 한다. 동시에 Recall용 검색 데이터는 빠르게 바꿀 수 있어야 하며 원본 관계 기억을 손상시키면 안 된다.

## 결정

1. Supabase PostgreSQL을 Canonical Source로 사용한다.
2. 모든 관계 데이터는 `workspace_id`를 가지며 복합 외래키로 다른 Workspace의 레코드를 연결할 수 없게 한다.
3. `persons.normalized_name`은 검색 보조값으로만 사용하고 unique constraint나 이름 기반 자동 병합을 두지 않는다.
4. 기억과 행동에는 `source_kind`와 `verification_status`를 두고, 상세 근거는 `provenance_records`에 별도로 보존한다.
5. `memory_documents`는 정규화된 원본 테이블에서 재생성하는 검색 projection으로 취급한다.
6. embedding 모델의 실제 출력 차원이 adapter 검증 전에 고정되지 않도록 초기 vector column은 차원 미지정으로 둔다. 모델과 차원 메타데이터는 각 문서에 기록한다.
7. 브라우저 역할에는 모든 public 테이블의 RLS를 활성화한다. MVP 서버는 직접 DB 연결을 사용하고, 향후 Auth에서는 JWT `app_metadata.workspace_id`로 사용자 Workspace를 제한한다.
8. 개발 데이터는 실제 개인정보가 없는 고정 UUID 기반 합성 Golden Dataset으로 제공한다.

## 이유

- 관계형 원본은 Identity, 시간, provenance와 transaction 무결성을 명확히 표현한다.
- 파생 검색 문서를 분리하면 embedding 또는 retrieval 전략을 바꿔도 확인된 Memory가 유지된다.
- 이름을 유일 식별자로 사용하지 않음으로써 Persnapse의 보수적 Identity 원칙을 스키마 수준에서 지킨다.
- Workspace 복합 외래키와 RLS를 함께 사용하면 애플리케이션 실수와 Data API 접근 모두에 방어선을 둔다.

## 영향

- Capture Commit은 여러 Canonical table을 하나의 transaction에서 갱신해야 한다.
- Memory가 바뀌면 projection 재생성 또는 embedding 재처리가 필요하다.
- 실제 Auth 공개 전 JWT claim 설정과 RLS 통합 테스트를 추가해야 한다.
- Vector index와 고정 차원은 Phase 3 embedding adapter가 실제 provider 응답을 검증한 뒤 별도 migration으로 추가한다.

## Phase 3.5 개정

- ADR 0004에서 Voyage `voyage-4`와 OpenAI `text-embedding-3-small` fallback의 공통 차원을 1024로 확정했다.
- `memory_documents.embedding`은 `vector(1024)`로 고정하고 content hash가 달라진 Person만 embedding을 다시 처리한다.
- 전체 projection 삭제·재생성 방식은 Person 단위 upsert로 교체했다.
