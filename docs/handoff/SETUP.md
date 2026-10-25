# 설치와 실행

이 문서는 GitHub 인수인계 준비본의 실행 안내다. 제품 구조와 기능별 파이프라인은 [HTML 기술 문서](../system-explorer-refined/index.html)를 먼저 읽는다.

## 1. 소스와 모델 준비

Node.js 24.x와 npm을 설치하고 저장소 루트에서 실행한다. 패키지 버전은 `package-lock.json`에 고정되어 있다.

```powershell
npm ci
# 함께 전달받은 모델 ZIP을 별도 폴더에 압축 해제한 뒤 실행
npm run models:restore -- D:\Downloads\persnapse-models
npm run models:check
Copy-Item .env.example .env.local
```

모델 ZIP의 최상위에는 `models/`, `manifest.json`, 라이선스 파일이 있다. 복원 명령은 LC100과 T8 모두의 파일 크기·SHA-256을 확인한 뒤 `public/models/`에 복사한다. 검증 실패 시 복원하지 않는다. ONNX와 빌드 산출물은 Git에 포함하지 않는다.

`card:download-models`는 모델 조사·갱신용 기존 명령이다. 동일한 인수인계 버전을 재현할 때는 전달된 ZIP과 `models:restore`를 사용한다.

## 2. 환경변수와 데이터베이스

`.env.local`에는 담당자가 별도로 전달받은 값을 입력한다. 실제 키·DB 연결 문자열은 Git이나 문서에 넣지 않는다.

| 설정                                                               | 목적                                                                            |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                     | 서버의 PostgreSQL 연결. 비밀번호의 예약 문자는 URL 인코딩한다.                  |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase 프로젝트의 공개 연결 설정.                                             |
| `SUPABASE_SECRET_KEY`                                              | 서버의 비공개 명함 Storage 접근. 브라우저에 노출하지 않는다.                    |
| `APP_DEFAULT_WORKSPACE_ID`                                         | 현재 프로토타입이 사용하는 공용 워크스페이스.                                   |
| `AI_ROUTING_MODE=mock`, `BUSINESS_CARD_OCR_MODE=mock`              | 기본 AI·OCR 모의 응답. **DB와 Storage까지 모의 데이터로 바꾸는 설정은 아니다.** |
| `ASSISTANT_CONTEXT_ENABLED`                                        | 새 맥락 검색·대화 기능 사용 여부. 관련 마이그레이션 적용 후 `on`으로 전환한다.  |
| `ASSISTANT_INDEX_WORKER_ENABLED`                                   | 별도 검색 인덱싱 작업 실행 허용 여부.                                           |
| `ASSISTANT_WORKER_SECRET`                                          | 스케줄러 배치 API 인증용 비밀값. 최소 32자 난수를 사용한다.                     |

실제 AI를 연결할 때만 사용하는 공급자의 키를 설정한다. 현재 주요 경로는 OpenAI(구조화·전사·응답), Voyage(검색 임베딩·재정렬), CLOVA(명함 OCR)다. 모델 이름과 추가 옵션은 `.env.example`과 [AI 운영 문서](../operations/)를 확인한다.

먼저 `npm run db:preflight`로 연결·스키마 상태를 확인한다. 기존 DB를 이어받는 경우 마이그레이션·seed를 무조건 다시 실행하지 않는다. **새 전용 개발 DB**를 만드는 경우에만 다음 절차를 적용한다.

```powershell
npm run db:migrate:dry
# 대상 DB와 변경 SQL을 확인한 후
npm run db:migrate
# 초기 데이터가 필요한 새 개발 DB에만 실행
npm run db:seed
```

DB 스키마·RLS·Storage 정책은 `supabase/migrations/`가 기준이다. 저장소를 복제해도 기존 Supabase 데이터·Storage 객체·브라우저 녹음은 복제되지 않는다. 운영 데이터 이관은 별도 작업이다.

## 3. 제품과 인덱싱 Worker 실행

```powershell
npm run dev
# 또는 프로덕션 방식
npm run build
npm start
```

`http://localhost:3000/#map`에서 통합 워크스페이스를 연다. 명함 `/#cards`, 인맥 `/#people`, 만남 `/#meetings`, 녹음 `/#recordings`, 일정·업무 및 AI 어시스턴트 `/#todos`로 이동한다.

검색 인덱싱은 웹 서버와 별도다. 관련 DB 마이그레이션과 검색 공급자 설정을 확인하고 Worker 기능을 켠 뒤, 별도 터미널 또는 운영 프로세스에서 실행한다.

```powershell
# 검색용 투영 데이터 생성: DB 쓰기 있음, 공급자 호출 없음
npm run assistant:worker -- --backfill
# 인덱싱 한 배치: 실제 공급자 호출·비용 발생 가능
npm run assistant:worker -- --confirm-live
# 계속 실행할 운영 프로세스에서 사용
npm run assistant:worker -- --confirm-live --watch
```

Worker를 어디에서 상시 실행할지, 실패 작업을 누가 확인할지는 운영 인계 시 정한다. Vercel에 웹을 배포하는 것만으로 별도 Worker의 지속 실행이 보장되지는 않는다. 스케줄러 배치 API를 사용할 경우 인증 비밀값과 호출 주기를 별도로 설정한다.

플래그 없는 `assistant:worker`는 실행을 거부한다. `--confirm-live`만 지정하면 한 배치 후 종료하며, `--watch`를 함께 지정해야 반복 실행한다. 이번 준비 작업에서는 위 DB 쓰기·실제 인덱싱 명령을 실행하지 않았다.

## 4. 현재 제품의 경계

- 사용자 확인 전 AI 추출 결과는 확정된 관계 데이터가 아니다.
- 녹음은 해당 브라우저·접속 주소의 IndexedDB에 저장된다. 접속 주소 변경이나 브라우저 초기화 시 기존 녹음이 자동 이동하지 않는다.
- 맞춤형 메일은 현재 초안 UI이며 실제 AI 생성·발송 연결은 미완료다.
- 공용 워크스페이스 기반 프로토타입이다. 사용자별 인증·권한 분리가 완성된 서비스로 간주하지 않는다. 원격 접근 설정은 검증된 보호 환경에서만 조정한다.
- 2026-10-25 읽기 전용 점검에서 일부 인덱싱 작업의 공급자 호출 제한 실패가 확인됐다. 이 준비 작업은 실제 DB나 실패 큐를 변경하지 않는다. 당시 관찰과 현재 운영 상태는 구분해 확인한다.
