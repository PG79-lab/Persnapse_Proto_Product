# 실제 AI 기억 흐름 — 구현 및 활성화 절차

> 2026-09-22 후속 변경: 사용자 승인으로 앱 일/월 누적 한도를 제거하고 단기 대량 호출 방어로 전환했다. [최신 정책·가능 횟수](user-test-capacity-2026-09-22.md)를 우선한다. 아래 이전 누적 한도 수치는 당시 기록이다.

2026-09-22. 구현·활성화 절차 및 초기 검증 기록. 이후 사용자 승인으로 원격 DB 적용과 보호된 live Preview를 활성화했다. 최신 상태·비용·한계는 [실제 검증 보고](live-memory-verification-2026-09-22.md)를 우선한다.

## 현재 연결

- AI_ROUTING_MODE=mock: 기존 로컬 검색·mock 맥락 처리. 모델 네트워크 호출 없음.
- AI_ROUTING_MODE=live: 기존 OpenAI Luna 맥락 처리, 질문 이해 → Voyage embedding/re-ranking → Terra 답변 경로.
- 명함 OCR 모드는 별도이며 기존 Clova 비용 방어를 유지한다.
- 최신 보호된 Preview는 live 모드이며, 기존 mock 배포 URL과 다르다. 최신 URL과 호출 한도는 실제 검증 보고에 있다.

## 필요한 설정 — 값은 문서·로그에 기록하지 않음

- OPENAI_API_KEY: 서버 전용
- VOYAGE_API_KEY: 서버 전용
- AI_LIVE_DAILY_CALL_LIMIT / AI_LIVE_MONTHLY_CALL_LIMIT: 기본 0. 승인된 양수 한도가 있어야 호출 가능.
- 기존 모델 override 이름은 server/env.ts에 유지한다.
- 기존 데이터베이스·Workspace·Preview 접근 보호 설정을 유지한다.

## 적용 순서 — 각각 승인 범위 확인 후 실행

1. 새 migration 20260922100000_live_memory_assistant.sql 검토·적용. 기존 날짜나 사용자 기록을 재작성하지 않는다. 코드의 날짜 미상 저장은 이 migration 적용 이후 가능하다.
2. 승인된 환경에서 live 모드와 호출 한도를 설정한다. 실제 모델 응답·비용·지연을 소수 합성 입력으로 확인한다.
3. 승인된 Workspace의 기존 검색 문서를 제한 배치로 준비한다. 이름/본문을 출력하지 않고 처리 개수만 기록한다.

   ```powershell
   node --env-file=.env.local --conditions=react-server --import tsx scripts/ai/index-memory.ts --confirm-live --limit=10
   ```

   이 명령은 유료 embedding 호출과 검색 projection DB 쓰기를 수행한다. 기존 canonical memory를 삭제하지 않는다. 미완료 문서가 남아 있으면 live Recall은 준비 필요 상태를 반환한다. 비용/설정 오류를 해결한 후 같은 제한 배치로 재시도한다.

4. 실제 질의 검증. 기존 Golden 이외에도 무관한 질문, 동명이인, 표현 변화, 같은 만남 조건, 오늘 기한/미래 준비 제안, 날짜 미상을 포함한다.

   ```powershell
   node --env-file=.env.local --conditions=react-server --import tsx scripts/evals/recall.ts --confirm-live
   ```

   eval은 query/response 기록을 남기지 않는 persist:false다. **live에서는 호출 예약과 AI attempt telemetry를 쓰므로 DB 전체 읽기 전용이 아니다.** mock 모드의 eval은 기존 DB 읽기만 한다. 기존 Golden 기대값이 좁은 경우 통과를 위해 기대값을 바꾸지 않고 사례와 의미를 검토한다.

5. 보호된 Preview 활성화 승인이 있을 때만 기존 sync/readiness/deploy 명령에 --live-assistant를 추가한다. 기존 대상 프로젝트·민감정보 업로드·배포 보호 확인 플래그는 그대로 필요하다. live opt-in은 필요한 두 모델 키와 한도만 환경 목록에 추가한다. 기본 명령은 기존 mock 정책을 유지한다.
6. 실기기에서 새 기억 입력 → 수정 → 저장 → 자연어 회상 → 근거 열람 → 평가를 확인한다.

## 최초 유료 검증 제안 — 승인·실행 전 기록

첫 검증은 합성 맥락 4건, 문서 embedding 최대 8건, 회상 최대 10건을 제안한다. 최대 예약 호출은 4 + 8 + 40 = 52회이며 자동 재시도는 없다. 모델별 실제 토큰·비용은 승인 시점의 제공자 가격과 기록으로 확인한다. OCR 재호출·기존 데이터 전체 재색인은 이 묶음에 포함하지 않는다. 이 수량은 제안이며 현재 승인되거나 실행된 것이 아니다.

## 검증과 알려진 한계

- 로컬 테스트는 외부 제공자·원격 DB를 사용하지 않는 테스트 대역과 순수 함수 검증이다.
- 새 SQL migration과 vector 검색 쿼리는 승인 후 실제 PostgreSQL 경로 검증을 완료했다.
- 검색은 사람 단위 후보에서 상위 8명을 확인하므로 후보 누락이 가능하다. 그 경우 후보 검색과 답변 생성 문제를 나누어 진단한다.
- 일부 검색 문서가 미준비이면 live 검색을 전체 차단하는 보수적 정책이다.
- 구조적 근거 검증은 자연어 주장 전체의 사실성을 증명하지 않는다.
- 정해진 일/월 호출 수와 입력·출력 크기는 제한하지만 provider hard quota나 정확한 금액 상한은 아니다.
- Feedback의 helpful/not_helpful/wrong_person과 자유 이유를 저장한다. 사용자 식별을 추가한 제품별 격리나 중복 평가 정책은 이번 범위가 아니다.
- 기존 데이터의 잘못 저장된 날짜는 자동 교정하지 않았다.
- 기본 Graph, 음성/STT, 실제 사용자 인터뷰는 후속 필수 작업이다.

## 활성화 전 직접 실행한 검증 — 과거 기록

- 전체 lint 및 TypeScript 검사 통과.
- 단위·회귀 테스트 25파일 / 95개 통과.
- 프로덕션 빌드 통과. 마지막 UI 변경도 빌드에 포함.
- 외부 API를 가로챈 로컬 Chromium E2E 2개 통과: 명시적 검색→근거→피드백→오류 후 입력 보존, 명함/텍스트 탭 전환 시 초안 보존.
- 390px 모바일 폭에서 메뉴 줄바꿈 결함을 관찰·수정하고 최종 화면을 직접 확인. 가로 넘침 검사 통과. 실제 모바일 기기·카메라 시험은 아님.
- 화면 캡처: test-results/assistant-desktop.png, test-results/assistant-mobile.png. 합성 응답을 사용한 UI 검증 자료다. 표시된 속도와 내용은 실제 AI 성능 측정 결과가 아니다.
- 전체 E2E 및 원격 DB 기반 검증은 실행하지 않았다. 기존 데이터 쓰기 가능성이 있어 이번 허용 범위에 포함하지 않았다.
- 이번 세션 유료 모델 호출 0회, 원격 DB 변경 0회, 배포·자격증명 업로드 0회. commit/push 없음.
- 이전부터 존재한 modified/untracked 작업물을 보존했다.

## 후속 실제 검증 — 2026-09-22

사용자 승인 후 migration 적용과 기존 문서 14건 검색 준비, 합성 맥락 4건 및 실제 회상 검증을 진행했다. 위의 미실행 기록은 활성화 전 시점의 기록이다. 최신 결과·한도·미완료 항목은 [실제 검증 보고](live-memory-verification-2026-09-22.md)를 기준으로 확인한다.
