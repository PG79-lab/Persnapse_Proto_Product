# Persnapse 기술 인수인계 문서

`index.html`을 브라우저에서 연다. 본문, 직선 구조도 3개, 기능별 화면 9개를 포함하며 오프라인에서 목차·이미지 확대·인쇄를 사용할 수 있다. 코드 링크는 이 폴더가 저장소 내에 있을 때 유효하다. 기능 화면 링크는 별도 배포 환경을 연다.

2026-10-24 최초 조사 답변을 다듬은 `report-source.txt`가 본문의 기준이다. 당시 코드 기준은 `main / fa732fa`다. 준비본의 이후 변경과 실행 방법은 [인계 안내](../handoff/RELEASE.md)에 별도로 정리한다.

2026-10-25 준비본에는 **합성 데이터로 실제 로컬 제품 UI를 촬영한 화면**만 포함했다. 원본의 실제 연락처가 있는 캡처와 내장 HTML 이미지는 가져오지 않았다. 캡처를 배포 데이터의 현재 상태나 실제 AI 처리 결과로 해석하지 않는다.

## 수정과 재생성

- 본문: `report-source.txt`
- 구조도·문서 생성: `build.mjs`
- 화면 설명·진입 링크: `screenshots.json`
- 화면 자동 촬영: `../../scripts/handoff/capture-docs.ts`
- 스타일·상호작용: `styles.css`, `app.js`

저장소 루트에서 모델을 복원하고 프로덕션 빌드를 마친 뒤 실행한다.

```powershell
npm run docs:capture
npm run docs:build
npm run docs:verify
```

브라우저 검증에는 Playwright Chromium이 필요하다(`npm run test:e2e:install`). 설치된 Edge를 쓰려면 `PLAYWRIGHT_CHANNEL=msedge`를 설정한다. `verify.mjs`는 오프라인에서 본문 보존, 소스 링크, 화면 해시, 목차·이미지 확대, 반응형과 SVG 직선 연결을 확인한다.

`index.html`, `report-manifest.json`, `figures/`는 생성물이다. 본문이나 화면을 변경한 경우 함께 재생성하고 검증한다.
