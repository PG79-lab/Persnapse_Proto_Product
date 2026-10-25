# Persnapse MVP

**명함과 만남 기록을 정리하고, 사람과 관계를 다시 찾는 프로토타입입니다.** AI가 추출한 정보를 사용자가 확인한 뒤 저장하고, 관계 지도와 원문 근거를 제시하는 AI 검색으로 활용합니다.

현재는 **하나의 공유 워크스페이스를 사용하는 개발·검증용 제품**입니다. 사용자별 로그인·권한 분리와 실제 메일 생성·발송은 미완료입니다.

## 처음 인계받았다면

| 목적               | 먼저 볼 문서                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------- |
| 제품과 시스템 이해 | [HTML 기술 문서](docs/system-explorer-refined/index.html) — 전체 구조, 기능별 처리 흐름, 주요 코드, 화면 예시 |
| 개발 환경 준비     | [설치와 실행](docs/handoff/SETUP.md) — 모델·환경변수·DB·검색 Worker 설정                                      |
| 동작 확인          | [검증 안내](docs/handoff/TESTING.md) — 기본 검사, 브라우저 검사, 실제 서비스 연결 검사의 범위                 |
| 작업 이어가기      | [GitHub 작업 안내](docs/handoff/GITHUB.md) — 복제·브랜치·PR·Release 기준                                      |
| 전달 범위 확인     | [인계 구성](docs/handoff/RELEASE.md) · [준비 작업 결과](docs/handoff/RESULTS.md)                              |

HTML 문서는 저장소를 복제한 뒤 로컬 브라우저에서 엽니다. 파일 하나로 보려면 [인수인계 Release](https://github.com/PG79-lab/Persnapse_Proto_Product/releases/tag/handoff-2026-10-25)의 `persnapse-handoff.html`을 내려받습니다. 비공개 저장소 접근 권한이 있는 GitHub 계정이 필요합니다.

## 기능과 주요 코드

| 기능           | 처리 흐름                                                        | 화면 / 주요 코드                                                                                            |
| -------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 명함 등록      | 브라우저 이미지 보정 → 문자·필드 추출 → 사용자 검토 → 저장       | `/#cards` · `card_recognition/`, `src/features/capture/`, `src/server/application/business-card-service.ts` |
| 만남·인맥 관리 | 기록 입력·수정 → 관계 데이터 저장 → 목록·관계 지도에 반영        | `/#people`, `/#meetings`, `/#map` · `src/features/workspace/`, `src/server/db/workspace-repository.ts`      |
| 녹음·전사      | 브라우저 녹음·로컬 보관 → 음성 전사 요청 → 텍스트 확인           | `/#recordings` · `src/features/speech/`, `src/app/api/stt/`                                                 |
| 검색·후속 업무 | 저장된 기록의 검색 데이터 생성 → 근거 검색·응답 → 일정·업무 관리 | `/#todos`의 AI 어시스턴트 · `src/server/application/`, `scripts/ai/assistant-worker.ts`                     |

웹 화면과 API는 **Next.js**, 업무 규칙은 `src/domain/`과 `src/server/application/`, 데이터 저장은 **PostgreSQL**과 비공개 **Supabase Storage**가 담당합니다. API 진입점은 `src/app/api/`, DB 접근 코드는 `src/server/db/`, 스키마 변경 이력은 `supabase/migrations/`에 있습니다.

검색 Worker는 저장된 기록을 검색하기 좋은 형태로 가공하는 별도 프로세스입니다. 웹 서버 실행이나 Vercel 배포만으로 Worker가 계속 실행되지는 않습니다. 기능별 세부 흐름은 HTML 기술 문서, 설계 이유와 당시 검증 기록은 `docs/decisions/`와 `docs/operations/`에서 확인합니다.

## 로컬 실행

**준비물:** Git, Node.js **24.x**와 npm, 모델 ZIP, 전용 개발용 PostgreSQL·Supabase Storage 연결 정보.

### 1. 소스와 모델 준비

```powershell
git clone https://github.com/PG79-lab/Persnapse_Proto_Product.git
cd Persnapse_Proto_Product
npm ci
```

[Release](https://github.com/PG79-lab/Persnapse_Proto_Product/releases/tag/handoff-2026-10-25)에서 `persnapse-models-fa732fa.zip`을 내려받아 압축을 풉니다. `models/`와 `manifest.json`이 들어 있는 폴더를 아래 명령에 지정합니다. 경로는 실제 압축 해제 위치에 맞춥니다.

```powershell
npm run models:restore -- D:\Downloads\persnapse-models
npm run models:check
Copy-Item .env.example .env.local
```

복원 명령은 모델의 크기와 SHA-256을 확인합니다. 모델 파일은 Git에 포함되지 않습니다. 이미 `.env.local`을 만들었다면 복사 명령으로 덮어쓰지 않습니다.

### 2. 개발 DB와 환경변수 설정

`.env.local`에 담당자가 별도로 전달받은 값을 입력합니다. 주요 항목은 `DATABASE_URL`, Supabase 공개 연결 설정, 서버 전용 `SUPABASE_SECRET_KEY`, 공유 공간을 지정하는 `APP_DEFAULT_WORKSPACE_ID`입니다. 실제 키와 연결 문자열은 커밋하지 않습니다.

DB의 스키마·초기 데이터·Storage 준비는 [설치와 실행](docs/handoff/SETUP.md#2-환경변수와-데이터베이스)을 따릅니다. 기존 DB에 마이그레이션이나 seed를 무조건 다시 실행하지 않습니다.

| 기능       | 실행 조건과 주의점                                                                                                                                |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 일반 AI    | `AI_ROUTING_MODE=mock`이 기본값입니다. `live`는 사용하는 공급자의 설정이 필요합니다.                                                              |
| 명함 OCR   | `BUSINESS_CARD_OCR_MODE`로 별도 제어합니다. 일반 AI가 `mock`이어도 OCR이 `live`일 수 있습니다.                                                    |
| 음성 전사  | 일반 AI·OCR 모드와 별개로 `OPENAI_API_KEY`와 전사 모델 설정을 사용합니다. 키가 있는 환경에서 전사를 요청하면 실제 호출·비용이 발생할 수 있습니다. |
| DB·Storage | AI·OCR의 `mock` 설정으로 대체되지 않습니다. 앱의 저장 기능에는 실제 개발용 연결이 필요합니다.                                                     |

### 3. 웹 실행

```powershell
# 개발용 서버를 현재 컴퓨터에서만 접속하도록 실행
npm run dev -- --hostname 127.0.0.1
```

브라우저에서 <http://127.0.0.1:3000/#map>을 엽니다. 녹음은 브라우저의 접속 주소별 저장소에 보관되므로 `localhost`와 `127.0.0.1`을 번갈아 사용하면 녹음 목록이 달라질 수 있습니다.

검색 Worker의 초기 데이터 생성·실제 인덱싱·반복 실행 방법은 [Worker 실행 안내](docs/handoff/SETUP.md#3-제품과-인덱싱-worker-실행)를 따릅니다. 해당 명령은 DB 쓰기나 공급자 호출을 수반할 수 있습니다.

## 검증

```powershell
npm run verify
npm run test:e2e:install
npm run test:e2e
npm run docs:verify
```

`verify`는 모델 확인, lint·타입 검사, 단위 테스트, 격리 DB 검사, 서식 검사, 빌드를 실행합니다. 브라우저 검사는 별도이며, 실제 DB·유료 AI 연결 검사는 위 명령에 포함되지 않습니다. 검사별 준비 조건과 제외 항목은 [검증 안내](docs/handoff/TESTING.md)를 확인합니다.

## 데이터와 보안 경계

- **저장소 복제는 데이터 이관이 아닙니다.** 기존 DB 데이터, Storage의 명함 이미지, 브라우저 녹음, 실제 비밀키는 별도로 인계합니다. 문서의 화면은 개인정보 없는 합성 예시이며, 배포 화면 링크는 별도 실제 환경을 엽니다.
- **GitHub 비공개 설정은 배포 앱의 접근 보호와 별개입니다.** 원격 사용 전 Vercel 배포·개별 URL의 보호 설정을 확인합니다. 현재 공용 워크스페이스를 사용자별로 격리된 서비스로 간주하지 않습니다.
- **보안 보완이 남아 있습니다.** 2026-10-25 소스 검토에서 Host 헤더에 의존하는 접근 판정, 저장 API의 요청 출처 검사, 음성 전사의 반복 호출 제한을 보완 대상으로 확인했습니다. 인터넷 공개 운영 전 이 경계를 정비해야 합니다. 이번 문서 갱신은 해당 코드를 수정한 것이 아닙니다.
- **로컬 산출물도 선별해 공유합니다.** STT 테스트 빌드는 `.env.local`을 `output/` 아래에 복사할 수 있습니다. `.env*`, `.next/`, `output/`, `.vercel/`을 포함한 작업 폴더 전체를 그대로 전달하지 않습니다.

현재 소스·로컬 Git 이력·Release 첨부물의 알려진 키값 및 주요 비밀키 형식 검사에서는 유출을 발견하지 못했습니다. 실제 배포의 접근 보호, 키 권한·유효성, DB 권한, 모든 형태의 비밀정보 부재까지 확인했다는 의미는 아닙니다.
