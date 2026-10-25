# GitHub 인계 구성

## 준비본의 기준

- 기준 소스: 기존 `main`의 `fa732fa6def41c219ee8e832cfa19d84b6073f19`와 그 이전 이력.
- 원본은 그대로 보존하고 별도 `persnapse-mvp-github` 폴더에서 준비한다.
- 기존 실험 worktree와 중복된 예전 HTML 문서는 합치지 않는다.
- 최신 `docs/system-explorer-refined/` 문서를 포함하되 실제 개인정보가 있는 화면은 합성 데이터로 다시 촬영한다. HTML 안에 포함되는 이미지도 함께 교체한다.
- `.env.local`, 비밀키, DB 덤프, 실제 명함·녹음, `node_modules`, `.next`, 로컬 검사 로그는 업로드하지 않는다.

## 전달할 세 가지

| 전달물                         | 구성·용도                                                                                                        |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| 비공개 GitHub 저장소           | 소스, 기존 Git 이력, DB 마이그레이션, 테스트, 설정 예시, 기술 문서, 모델 manifest·라이선스. 이후 개발의 기준.    |
| `persnapse-models-fa732fa.zip` | 검증된 LC100·T8 ONNX, manifest, 라이선스, 설치 안내. GitHub Release 첨부물로 전달할 예정.                        |
| `persnapse-handoff.html`       | 이미지·구조도를 포함한 독립 열람용 기술 문서. 오프라인 열람 가능. 소스 링크는 저장소 내 문서에서 사용할 때 유효. |

ZIP과 독립 HTML은 `releases/`에 생성하며 Git 추적에서는 제외한다. ZIP의 SHA-256은 함께 생성하는 `.sha256` 파일로 확인한다. 모델 개별 파일의 크기·해시는 소스의 `card_recognition/models/manifest.json`과 `models:check`로 다시 검증한다.

## 확정된 GitHub 전달 기준

- 저장소: [PG79-lab/Persnapse_Proto_Product](https://github.com/PG79-lab/Persnapse_Proto_Product), 비공개.
- 기본 브랜치: `main`. 기존 커밋 27개에 인수인계 준비 변경을 추가한다.
- 최초 인계 태그: `handoff-2026-10-25`. 프로토타입 인계용 pre-release로 모델 ZIP·HTML과 각 SHA-256 파일을 제공한다.
- 원본 폴더는 그대로 두고 준비본에서만 커밋·원격 연결·업로드한다. 기존 이력을 덮어쓰는 force push는 사용하지 않는다.

## 별도로 인계할 사항

1. 초대할 담당자와 권한. 현재 작업에서 새 협업자를 초대하지 않는다.
2. Supabase·Vercel·AI 계정의 소유권과 비밀값 전달 경로. GitHub 소스 전달과 서비스 계정 인계는 별개다.
3. 기존 DB를 이어갈지 새 개발 DB를 만들지, Worker 실행 위치와 실패 작업 확인 담당자.

사용자는 2026-10-25 지정 저장소로의 업로드와 Release 전달을 승인했다. GitHub 소스·첨부물 전달에 범위를 한정하며 실제 제품 배포, DB 변경, 기존 서비스 계정 권한 변경은 포함하지 않는다. 이어서 작업하는 방법은 [GitHub 안내](GITHUB.md)를 따른다.

## 검증 기록

준비 과정의 상세 로그와 원본 보존 비교 결과는 로컬 `output/handoff/`에 둔다. 최종 요약은 [검증 결과](RESULTS.md)를 참조한다. 최초 HTML 본문의 조사 날짜는 유지하고 준비 과정의 변경은 이 문서군에 별도로 기록한다.
