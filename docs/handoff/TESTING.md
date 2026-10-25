# 검증 명령과 범위

## 외부 서비스 없이 실행하는 기본 검증

모델을 복원하고 `npm ci`를 마친 뒤 실행한다.

```powershell
npm run verify
npm run test:e2e:install
npm run test:e2e
npm run docs:verify
```

| 명령                | 확인하는 내용                                                                                  |
| ------------------- | ---------------------------------------------------------------------------------------------- |
| `verify`            | 모델 무결성 → lint → TypeScript → 단위 테스트 → 격리 DB 테스트 → 서식 → 프로덕션 빌드.         |
| `test:assistant:db` | 로컬 PGlite에서 검색 관련 SQL과 데이터 동작 검증. 실제 Supabase를 사용하지 않음.               |
| `test:e2e`          | 검증용 환경으로 다시 빌드한 뒤 일반 UI와 관계 지도 테스트를 순서대로 실행.                     |
| `docs:verify`       | 오프라인 HTML의 본문 보존, 소스 링크, 9개 화면, 이미지 확대, 목차, 반응형 및 직선 구조도 검증. |

브라우저 테스트는 유료 공급자 키를 비우고 DB 주소를 연결 불가능한 loopback 주소로 바꾼다. 화면 데이터는 테스트 fixture로 제공한다. 기존 개발 서버를 재사용하지 않는다. 기본 포트는 일반 UI 3000, 그래프 4315이며 각각 `PLAYWRIGHT_PORT`, `PLAYWRIGHT_GRAPH_PORT`로 변경할 수 있다.

`test:e2e`가 만든 `.next`는 검증용 환경으로 빌드한 결과다. 실제 개발 서비스의 프로덕션 실행이나 배포 전에는 해당 환경변수를 준비하고 `npm run build`를 다시 실행한다.

기본 브라우저는 Playwright Chromium이다. 설치된 Edge를 사용하려면 PowerShell에서 `$env:PLAYWRIGHT_CHANNEL="msedge"`를 설정한다. 단위 테스트는 메모리 사용량과 재현성을 위해 worker 1개로 실행한다. 격리를 해제하지 않으므로 완료까지 시간이 걸릴 수 있다.

비공개 실물 명함 사진을 요구하는 회전 검사는 사진 미포함 시 skip된다. 이는 합성 명함·LC100/T8 런타임 검증과 구분한다.

## 실제 개발 환경을 요구하는 별도 검사

```powershell
# 별도 터미널에서 전용 개발 DB에 연결한 앱을 실행한 상태
$env:PERSNAPSE_INTEGRATION_BASE_URL="http://127.0.0.1:3000"
npm run test:e2e:integration
```

이 검사는 기존 인맥 읽기와 녹음 메모 저장 확인 등 실제 데이터 연결을 요구하는 2개 시나리오다. 초기 데이터가 있는 전용 개발 환경에서 실행한다. 일반 검증 성공은 이 검사의 성공이나 실제 AI 품질을 의미하지 않는다.

기존 `db:verify:*`, `ai:verify:*`, `deploy:*` 명령은 실제 DB 쓰기·유료 호출·배포를 포함할 수 있다. 각 스크립트와 요구 플래그를 읽고 대상 환경을 확인한 뒤 별도로 실행한다. 준비본 검증 과정에서는 실행하지 않는다.

## 문서 재생성

```powershell
# 앞서 프로덕션 빌드를 마친 상태
npm run docs:capture
npm run docs:build
npm run docs:verify
```

화면 촬영은 합성 인맥·명함 데이터를 실제 로컬 UI에 주입한다. 모든 API 요청을 브라우저에서 처리하거나 차단하고 외부 요청을 허용하지 않는다. 생성한 화면은 제품 조작 방법의 예시이며 배포 DB의 상태를 나타내지 않는다.
