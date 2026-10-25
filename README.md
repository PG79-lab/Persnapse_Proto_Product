# Persnapse MVP

명함과 만남 기록을 **사용자 확인 후 저장**하고, 관계 지도와 근거 기반 AI 검색으로 다시 찾는 프로토타입이다. Next.js 통합 워크스페이스, PostgreSQL·Supabase Storage, 브라우저 명함 보정·녹음, 별도 검색 인덱싱 Worker로 구성된다.

비공개 인계 저장소: [PG79-lab/Persnapse_Proto_Product](https://github.com/PG79-lab/Persnapse_Proto_Product) · 모델 ZIP과 독립 HTML: [인수인계 Release](https://github.com/PG79-lab/Persnapse_Proto_Product/releases/tag/handoff-2026-10-25). 저장소 접근 권한이 있는 GitHub 계정으로 로그인해 내려받는다.

## 처음 인계받았다면

1. [HTML 기술 문서](docs/system-explorer-refined/index.html)를 로컬 브라우저에서 연다. 시스템 구조, 기능별 파이프라인, 코드 위치와 화면 예시를 함께 볼 수 있다.
2. [설치와 실행](docs/handoff/SETUP.md)에 따라 Node.js 24, 의존성, 모델, 환경변수와 개발 DB를 준비한다.
3. [검증 안내](docs/handoff/TESTING.md)로 기본 검사와 실제 환경 검사를 구분해 실행한다.
4. [인계 구성](docs/handoff/RELEASE.md)에서 모델 ZIP·계정·데이터 전달 범위를 확인한다.
5. [GitHub에서 이어서 작업하기](docs/handoff/GITHUB.md)에서 복제·브랜치·PR 및 Release 기준을 확인한다.

```powershell
npm ci
npm run models:restore -- D:\Downloads\persnapse-models
Copy-Item .env.example .env.local
# 전용 개발 DB·Storage 연결 정보를 입력한 뒤
npm run dev
```

모델 ZIP은 별도 전달물이다. 압축 해제 폴더를 `models:restore`에 지정한다. 기본 AI 모드는 `mock`이지만 앱의 DB·Storage 설정은 여전히 필요하다. 실제 키는 커밋하지 않는다.

## 화면과 코드

| 영역                     | 진입 / 주요 코드                                                           |
| ------------------------ | -------------------------------------------------------------------------- |
| 관계 지도·인맥·만남·일정 | `/#map`, `/#people`, `/#meetings`, `/#todos` · `src/features/workspace/`   |
| 명함 등록·검토           | `/#cards` · `card_recognition/`, `src/server/application/`                 |
| 녹음·전사                | `/#recordings` · `src/features/`, `src/app/api/`                           |
| API·업무 규칙·저장       | `src/app/api/`, `src/server/application/`, `src/domain/`, `src/server/db/` |
| DB 변경 이력             | `supabase/migrations/`                                                     |
| 검색 인덱싱 Worker       | `scripts/ai/assistant-worker.ts`                                           |
| 설계 결정·운영 기록      | `docs/decisions/`, `docs/operations/`                                      |

## 기본 검증

```powershell
npm run verify
npm run test:e2e:install
npm run test:e2e
npm run docs:verify
```

`verify`는 모델·정적 검사·단위 테스트·격리 DB 검사·서식·빌드를 실행한다. 브라우저 검증과 실제 서비스 연결 검사는 별도다. 자세한 범위와 skip 조건은 [검증 안내](docs/handoff/TESTING.md)를 따른다.

## 인계 시 알아둘 점

현재는 공용 워크스페이스 프로토타입이다. 사용자별 인증·권한, 실제 메일 생성·발송은 완성된 기능으로 보지 않는다. 녹음은 브라우저 IndexedDB에 저장되고 검색 인덱싱은 별도 Worker 실행이 필요하다.

기술 문서의 화면은 개인정보 없는 합성 예시다. 배포 화면 링크는 별도 실제 환경을 연다. 원본 조사 내용과 준비본 변경 사항은 [인계 구성](docs/handoff/RELEASE.md)에서 구분한다.
