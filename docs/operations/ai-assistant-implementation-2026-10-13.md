# AI 어시스턴트 핵심 구축 및 통합 인계

- 날짜: 2026-10-13
- 사용자 승인: 설계 후 구축 착수 OK. 이후 핵심 기능 경험 중심으로 마무리하고 추가 개선은 후속 문서에 남기도록 지시.
- 작업 공간: `D:\Persnapse\worktrees\persnapse-ai-assistant`
- 브랜치/기준: `feat/ai-assistant-context`, `9ec8392`
- 원본 `D:\Persnapse\persnapse-mvp`의 다른 세션 변경, 원격 DB, Storage, 배포 환경은 수정하지 않았다.
- 실제 연결 활성화는 아래 통합·migration·환경 설정 이후다. 코드가 작성됐다는 것과 현재 원본 제품에서 활성화됐다는 것을 구분한다.

## 구현한 사용자 경험

1. 대화의 인물·만남·기간·목적을 이어받고, 동명이인이나 여러 만남은 확인한다. 대화 복원, 새 대화, 대상·만남 선택 및 독립적인 만남 날짜/기한 변경을 제공한다.
2. 일부 또는 전체 임베딩이 미준비여도 현재 확정된 기록의 구조화·키워드 검색으로 진행한다. 의미 검색의 제한과 후보·근거 절단을 표시한다.
3. 인물·만남·사실·약속 및 인물과 연결된 사용자 업무를 검색한다. 현재 원본에서 근거를 다시 읽고, 답변 생성 중 수정된 근거는 거절한다.
4. 진행 상황 정리, 기록 연결·비교, 연락 우선순위, 만남 준비·연락 초안을 제공한다. 확인된 사실·맥락 해석·제안·초안을 구분하고 근거를 연결한다.
5. 확정 데이터 변경이 검색 단위와 durable job으로 연결된다. worker는 lease/hash/model을 확인해 결과를 반영하고 재시도·시간당 호출 한도를 적용한다. 수동 복구도 같은 queue를 사용한다.

인물과 연결되지 않은 일반 업무의 통합 답변, 대화로 기록·업무 변경, 실제 발송·외부 실행은 이번 범위에 포함하지 않았다.

## 주요 파일

| 책임                           | 경로                                                                                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| 대화 계약/맥락/검색 근거 구성  | `src/domain/assistant/`                                                                                                               |
| 세션 예약·멱등성·복원          | `src/server/db/assistant-session-repository.ts`                                                                                       |
| 검색과 확정 근거               | `assistant-search-repository.ts`, `recall-repository.ts`                                                                              |
| 대화/맥락 답변 파이프라인      | `src/server/application/assistant-service.ts`, `assistant-memory-service.ts`                                                          |
| 자동 검색 복구                 | `assistant-index-worker.ts`, `scripts/ai/assistant-worker.ts`                                                                         |
| API                            | `/api/assistant/turns`, `/sessions/:id`, `/index-retry`, `/index-batch`                                                               |
| 통합 UI                        | `src/features/workspace/assistant.tsx`, `use-assistant-session.ts`, `assistant-context-controls.tsx`, `assistant-result-sections.tsx` |
| DB 추가 스키마·projection 연결 | `supabase/migrations/20261013130000_assistant_context.sql`                                                                            |

기존 `/api/recall`은 계약을 유지한다. 새 기능 활성화 시 공통 맥락 검색 서비스를 사용하고, 비활성화 시 기존 경로를 유지한다.

## 검증과 경계

- 전체 단위·회귀 테스트 314개가 이전 최종 실행에서 통과했다. 사용자 업무 보완 이후에는 관련 테스트와 최종 타입·빌드·핵심 E2E를 확인한다. 최종 결과는 이 문서 하단에 갱신한다.
- 격리 PostgreSQL 검증: 전체 migration, 현재 기록 검색, workspace 분리, job 중복·hash/lease 차단, 공유 만남 보존, 세션 재전송·버전 충돌·만료, 공유 사실·transaction rollback, 실제 대화 저장과 REST 역할 접근 제한의 10개 묶음이 통과했다. 사용자 업무 생성·완료·기한 검색도 포함한다.
- 핵심 E2E 3개: 후속 대화·새로고침·초기화, 응답 유실 후 같은 request ID 재전송, 대상/만남 날짜/기한의 독립 제출. 실제 Chrome, 3100 포트, API 합성 fixture이며 실제 DB/AI 호출은 없다.
- 실제 provider 호출은 사용자 승인 한도 20회를 모두 사용했다. 합성 정보만 전달하고 DB는 PGlite에 격리했다. `DATABASE_URL`도 실행 내부에서 연결 불가능한 주소로 바꿔 원격 DB 접속을 막았다.
- live 검증에서 정리·미팅 준비·기록 연결·연락 우선순위와 1024차원 임베딩 저장을 확인했다. 초기 실패를 통해 준비 목적과 미래 기록 검색, 만남 날짜와 기한, 후속 출력 형식의 조건 혼동을 수정했다.
- 마지막 live 검증의 연락 우선순위는 약속 기한과 제한된 검색 범위를 올바르게 반영했다. **질문 축약의 마지막 보정과 새 사용자 업무 계약은 추가 live 재검증 전**이며 자동 회귀 검증으로 확인했다.
- 이는 소규모 개발 검증이다. 설계안의 대규모 holdout, 반복 평가, 정량 품질 목표나 사용자 만족도가 모두 달성됐다는 의미는 아니다.
- live 근거 자료: [초기 결과](assistant-validation-2026-10-13/initial.json), [보정 후 결과](assistant-validation-2026-10-13/followup.json), [최종 우선순위 결과](assistant-validation-2026-10-13/final.json). 모두 합성 데이터이며 개발 중 실패도 보존한다.

PC 중단과 메모리 부족으로 일부 실행이 종료됐다. 완료 기록이 없는 실행은 통과로 세지 않았다. WASM DB 검증은 메모리 제한을 둔 별도 Node 프로세스에서 실행하고, 기본 `verify`에도 별도 단계로 연결했다. 기존 이미지 관련 lint 경고는 이번 변경 범위 밖이다.

## 원본 통합 시 충돌 방지

1. 전용 브랜치의 변경 파일을 먼저 확인한다. 현재 원본에 있는 프론트 통합·명함 회전·문서·E2E 변경을 commit/stash/reset하지 않는다.
2. 새 assistant/domain/repository/API 파일을 우선 통합한다. 공통 타입, `assistant.tsx`, `recall-repository.ts`, env, package/lockfile, workspace capability는 각 파일의 현재 변경을 대조한다.
3. 원본에서 `src/features/recall/recall-workspace.tsx`를 이미 삭제했다면 삭제를 유지한다. 이 브랜치의 해당 파일 변경은 이전 화면의 타입 라벨 호환 한 줄뿐이며 화면을 복원할 필요가 없다.
4. 원본에 이미 있는 방향·설계 문서는 최신 상태 링크를 병합한다. 다른 세션의 문서 index는 통째로 덮어쓰지 않는다.
5. 통합 상태에서 타입 검사와 `/`의 `/#todos` 핵심 E2E를 확인한다. 이 작업 공간의 테스트는 다른 세션의 미커밋 변경까지 합친 상태의 검증이 아니다.

## 활성화·실행

먼저 격리된 DB에 migration을 적용·확인한다. 기존 migration 수정이나 canonical 사실 재작성은 하지 않는다. 기존 데이터의 검색 projection backfill은 별도 명령이다.

```powershell
npm run test:assistant:db
npm run assistant:worker -- --backfill
```

해당 환경의 `.env.local`에는 기존 DB/provider 설정과 함께 다음을 설정한다. 비밀 값은 Git에 넣지 않는다.

```dotenv
ASSISTANT_CONTEXT_ENABLED=on
ASSISTANT_INDEX_WORKER_ENABLED=on
ASSISTANT_WORKER_SECRET=<32자 이상의 무작위 값>
```

```powershell
# 초기 기능 확인은 AI_ROUTING_MODE=mock으로 수행 가능
npm run dev -- --port 3100
# live worker: 시작 자체가 유료 임베딩 처리를 승인한다는 의미
npm run assistant:worker -- --confirm-live --watch
```

worker는 한 batch 최대 10개/새 호출 시작 20초 제한, 임베딩 호출 최대 15초, transient 재시도 최대 3회, 복구 호출 시간당 120회 및 기존 공통 burst 한도를 적용한다. 동일 내용은 다시 enqueue하지 않는다.

원격 scheduler는 보호된 `POST /api/assistant/index-batch`를 Bearer secret으로 호출해야 한다. **scheduler는 아직 연결하지 않았다.** 코드를 배포하는 것만으로 자동 복구가 실행되지는 않는다. 이 endpoint는 30일을 지난 assistant 세션/turn 정리도 수행한다. 기존 Recall query/feedback 이력은 별도 보존 정책을 따른다.

rollback은 두 feature flag를 `off`로 바꾸고 worker를 중단한다. canonical 데이터나 신규 테이블을 급히 삭제하지 않는다.

## 추가 개선

[후속 개선 목록](../plans/ai-assistant-follow-up-2026-10-13.md)을 참고한다. 이번 사용자 지시에 따라 더 큰 평가나 구조 확장은 여기서 계속 늘리지 않는다.

## 최종 확인

- 최신 변경 기준: 타입 검사, 변경된 코드 파일 lint, 프로덕션 빌드 통과.
- 핵심 자동 테스트 23개 통과. 전체 회귀 314개 통과는 앞선 실행의 결과이며 마지막에는 관련 테스트로 범위를 좁혔다.
- 격리 PostgreSQL 검증 10개 묶음 통과. 실제 대화 저장·재전송, 사용자 업무 생성/완료 및 원격 연결·provider 호출 0회 포함.
- 핵심 Chrome E2E 3개는 마지막 빌드에서도 통과했다.
- 유료 호출은 총 20회이며 한도 소진 이후 추가 호출하지 않았다.
- 전체 `format:check`는 기준 코드의 기존 364개 파일에서 실패했다. 관련 없는 파일을 일괄 포맷하지 않았으며 이번 변경 파일만 별도로 확인했다. 따라서 전체 `npm run verify` 통과로 보고하지 않는다.
