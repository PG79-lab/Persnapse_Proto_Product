# GitHub에서 이어서 작업하기

## 인계 기준

- 저장소: [PG79-lab/Persnapse_Proto_Product](https://github.com/PG79-lab/Persnapse_Proto_Product) · 비공개 · 기본 브랜치 `main`.
- 인계 스냅샷: [`handoff-2026-10-25`](https://github.com/PG79-lab/Persnapse_Proto_Product/releases/tag/handoff-2026-10-25). 기존 main 이력을 유지하고 설치 문서·합성 화면·검증 설정을 추가한 프로토타입이다.
- 이후 개발은 `main`에서 작업 브랜치를 만들고 PR로 검토한다. 인계 태그는 과거 기준점을 가리키므로 새 변경으로 옮기지 않는다.

## 새 PC에서 시작

저장소 접근 권한을 받은 계정으로 GitHub와 로컬 Git에 로그인한다. 플러그인 로그인과 로컬 Git 인증은 별개다.

```powershell
git clone https://github.com/PG79-lab/Persnapse_Proto_Product.git
cd Persnapse_Proto_Product
npm ci
```

Release에서 `persnapse-models-fa732fa.zip`과 `.sha256`을 내려받는다. 체크섬을 비교한 뒤 압축을 해제하고 모델을 복원한다.

```powershell
Get-FileHash D:\Downloads\persnapse-models-fa732fa.zip -Algorithm SHA256
npm run models:restore -- D:\Downloads\persnapse-models
npm run models:check
```

이후 [설치 안내](SETUP.md)에 따라 `.env.local`과 전용 개발 DB를 구성한다. 비밀값·실제 명함·녹음·DB 덤프는 Git에 추가하지 않는다. GitHub의 자동 생성 Source code ZIP에는 별도 모델 파일과 운영 데이터가 없다.

## 개발·검토 흐름

```powershell
git switch main
git pull --ff-only
git switch -c feature/작업명
# 변경 후 관련 검증 실행
npm run verify
npm run test:e2e
git add <검토한 파일>
git commit -m "변경 내용"
git push -u origin feature/작업명
```

GitHub에서 `main`으로 PR을 열어 변경 내용·검증 결과를 남긴다. 일반 브라우저 검증과 실제 DB·AI 연동 검증의 범위는 [검증 안내](TESTING.md)에 따른다. 자동 CI 워크플로와 강제 병합 규칙은 이번 인계 작업에 추가하지 않았다. 기존 규칙 API는 점검 당시 계정 요금제 제한을 반환했으므로 필수 리뷰 등 강제 정책을 적용하려면 계정 조건을 별도로 확인한다.

## Release 첨부물

| 파일                                  | 용도                                                   |
| ------------------------------------- | ------------------------------------------------------ |
| `persnapse-models-fa732fa.zip`        | LC100·T8 ONNX, manifest, 라이선스·NOTICE, 복원 안내.   |
| `persnapse-models-fa732fa.zip.sha256` | ZIP 전체의 SHA-256. 복원 명령은 내부 모델 해시도 확인. |
| `persnapse-handoff.html`              | 구조도·합성 화면을 포함한 오프라인 기술 문서.          |
| `persnapse-handoff.html.sha256`       | 독립 HTML의 SHA-256.                                   |

코드 링크를 따라가며 읽을 때는 저장소의 `docs/system-explorer-refined/index.html`을 연다. 독립 HTML은 이미지가 포함된 열람용이다. 모델 manifest의 기존 조사 상태 표기와 이번 브라우저 런타임 검증 결과는 [준비 검증 기록](RESULTS.md)에서 구분한다.

실제 Supabase 데이터, 명함 Storage, 브라우저 IndexedDB 녹음, Vercel 환경변수·배포 설정과 AI 계정은 별도 인계 대상이다. 원본 `D:\Persnapse\persnapse-mvp`는 보존하며 이후 개발 기준은 이 저장소로 정한다.
