# 기록·명함 실제 저장 검증 — 2026-10-08

## 결과와 범위

2026-10-08 01:51 KST, 실제 API route handler → application service → 원격 PostgreSQL·Supabase Storage 경로의 17개 시나리오가 통과했다. 사용자 요청의 1번(기록·명함 저장, 명시적 인물 연결, 중복 방지, 오류 처리)을 검증하고 발견한 결함을 수정했다.

AI 구조화와 OCR은 검증 프로세스에서만 `mock`으로 실행했다. `.env.local`을 수정하지 않았고 OpenAI·Voyage·CLOVA 요청은 0회다. Supabase 이외 fetch를 차단하는 검증 장치를 두었다. 이는 실제 OCR 인식 품질·live Recall이나 브라우저/HTTP listener 전체 E2E 검증을 의미하지 않는다. 기존 UI·공유 배포·원격 schema는 변경하지 않았다.

## 검증 내용

| 영역            | 실제 확인한 동작                                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------------------------ |
| 기록 Draft      | 구조화·재시도 전후 원문 보존, 확인 전 canonical 인물·만남·기억·행동·검색 문서 없음                                 |
| 기록 저장       | Person·Interaction·조직·행사·주제·Memory·Action을 저장하고 참가자 연결·confirmed 출처·사용자 수정 보존             |
| 인물 연결       | 기존 UUID 선택은 해당 인물에 연결, 이름이 같아도 신규 선택은 별도 인물 생성, 다른 워크스페이스 인물은 `409`        |
| 중복 저장       | 같은 생성 키 재요청과 중복/동시 Commit에 새 인물·만남·기억·행동·명함이 추가되지 않음                               |
| 오류·rollback   | 잘못된 기존 인물 선택은 Draft 수정량과 DB 내용까지 되돌림, 미검토 Commit은 `409`, 없는 Capture는 `404`             |
| 명함 업로드     | 실제 private Storage에 원본·표시용 PNG 업로드, 같은 요청 재사용 시 asset 2개 유지, 잘못된 이미지 `400`·잔여물 없음 |
| 명함 검토·저장  | OCR Draft → 맥락 검토 → 명시적 인물 연결, 이메일·전화·웹사이트 confirmed 속성과 수정된 기억 저장                   |
| 명함 오류 복구  | 실패 상태를 테스트에서 주입하고 같은 Capture·원본 파일로 재시도, 새 업로드·확정 기억 추가 없음                     |
| 이미지 관리     | 저장 bytes 비교, 원본 삭제 후 표시 이미지와 확정 명함 유지, 재삭제는 no-op, 미확정 Draft 폐기 시 DB·Storage 제거   |
| 검색 projection | 저장 후 검색 문서 재생성 확인. mock에서는 vector가 없는 `pending`; live 검색 준비 완료로 보고하지 않음             |

실제 provider 장애는 발생시키지 않았다. 실패 복구 시나리오는 테스트 Capture의 실패 상태를 주입해 API·DB·Storage 복구 경로를 검증한 것이다.

## 발견한 결함과 수정

### 같은 명함의 동시 업로드

서로 다른 요청이 사전 조회에서 모두 신규로 판단한 뒤 업로드하면 DB unique 충돌이 `500`으로 반환됐다. 원격 DB·Storage 검증에서 `[500, 201]`을 재현했다.

`createBusinessCardCapture`는 기존 DB unique 제약으로 한 요청만 생성하고 생성 여부를 반환한다. 중복 요청은 자신의 업로드 파일만 제거하고 기존 Draft를 반환하거나 처리 중 `429`·2초 재시도를 안내한다. 다른 종류 Capture에 이미 연결된 키는 `409`다. 중복 요청에서 추가 OCR을 실행하지 않는다. 수정 후 동시 요청의 결과는 `[201, 201]`, Capture 1개·asset 2개였다. 처리 중 결과의 `429`는 별도 단위 테스트로 검증했다.

### 명함의 잘못된 검토 상태

없는 명함 검토·후보 조회와 이미 저장한 명함의 재검토·후보 조회가 `[500, 500, 502, 500]`을 반환했다. typed 오류와 사전 상태 검사로 `[404, 404, 409, 409]`로 수정했다. 잘못된 재검토는 모델 실행·실패 상태 전환을 하지 않고 저장된 DB 내용이 유지된다.

검토 도중 다른 요청이 먼저 완료한 경우의 상태 충돌도 provider 실패로 바꾸지 않는다. 실패한 기존 요청은 Draft가 있어도 성공한 재사용 결과로 숨기지 않고 복구 가능한 오류를 반환한다.

## 실행·정리 경계

```bash
npm run db:preflight
npm run db:verify:capture-storage
npm run verify
```

새 검증 명령은 외부 호출이 없는 읽기 전용 명령이 아니다. 현재 Supabase DB·private Storage에 고유한 테스트 워크스페이스 2개를 생성하며, 성공·실패 모두 `finally`에서 정리한다. 일반 `verify`에는 자동 포함하지 않았다. 직접 스크립트 실행에는 `--confirm-test-writes`가 필요하다.

- 모든 생성·삭제는 해당 실행에서 만든 workspace UUID·이름과 Storage 경로로 제한한다.
- 기존 기본 워크스페이스의 24개 public table 내용을 행 수와 DB 내부 hash로 전후 비교했다. 개인 내용·hash·키는 보고서에 출력하지 않는다.
- 최종 테스트 워크스페이스·관련 public row·Storage object는 0개이고 기존 DB 내용은 동일했다. 실패 재현 실행도 정리 검증을 통과했다.
- reset·seed·migration·기존 데이터 재색인·환경 파일 수정·신규 배포를 실행하지 않았다.
- 변경 전 관련 소스 ZIP: `tmp/backups/before-capture-storage-fixes-20261008.zip`.
- 실행별 비밀값 없는 JSON 보고서는 `test-results/capture-storage-<runId>.json`에 남는다. 17개 시나리오 최종 통과: `capture-storage-68d4ec41-6ed4-48ac-bc93-f635b02c6995.json`.

기존 Phase 4/5 스크립트는 기본 워크스페이스를 사용하는 이전 검증 도구다. 이번 검증에는 격리된 새 명령을 사용했다.

## 최종 코드 검증

- 전체 `npm run verify` exit 0: lint·TypeScript·33파일 167테스트·전체 Prettier·production build 통과. 이번 명함 upload/state 회귀 테스트 14개 포함.
- 상태 오류의 단위 테스트는 수정 전 5개 실패를 확인하고 수정 후 통과했다. 다른 요청이 검토를 먼저 완료하는 충돌도 저장 상태를 실패로 바꾸지 않음을 검증했다.
- 2026-10-08 01:52 KST 읽기 전용 preflight 재확인: DB 연결 정상, 인맥 16명·만남 21개·명함 2개, 미적용 migration·RLS 비활성 table 없음, private bucket 정상. 검색 문서는 13/16개 준비, 3개 미완료다.
- 로컬 환경은 기존대로 AI `mock`, OCR `live`다. 저장 검증의 OCR `mock` override는 검증 프로세스 종료와 함께 사라졌다.

## 다음 단계

현재 기본 워크스페이스의 검색 문서 준비 3개와 실제 live Recall 검증이 다음 작업이다. 검색 준비·근거 기반 답변이 통과한 뒤 프론트 데이터 계약과 연결을 진행한다. 이번 검증만으로 전체 AI/프론트 통합이나 신규 배포 완료를 보고하지 않는다.
