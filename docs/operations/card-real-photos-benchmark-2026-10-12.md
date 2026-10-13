# 실제 명함 27장 외곽 감지 파일럿

- 실행일: 2026-10-12, Asia/Seoul.
- 입력: `card_test_image/`의 JPEG 27장. 원본은 수정하지 않았다.
- 대상: **단일 명함의 외곽 네 변/네 모서리**. 내부 이름·회사·연락처·로고 구역 분류와 OCR은 제외.
- 실행: 개발 PC Chrome 155.0.8059.39, ORT Web 1.30.0 단일 스레드 WASM Worker,
  DocAligner T8/LC100 공식 FP32 ONNX, 기존 OpenCV.js 5.0.0-release.1.
- 외부 OCR/AI API 호출: **0회**. 이미지·라벨·결과는 Git 제외 로컬 경로에 보관.

## 확인 화면

2026-10-13: LC100을 우선 모델로 선택했다. 서버 없이 열 수 있는 단일 파일은
`output/card-rectification/real-pilot/card-boundary-comparison-LC100-2026-10-13.html`이다.
더블클릭해 Chrome/Edge에서 연다. 사진 27장, 검출 81개, CSV/요약과 테두리 편집을
포함한다. 표시 사진만 동일 해상도 JPEG로 내장했고 원본·기존 측정값은 보존했다.
정답·평가는 JSON 다운로드로 보관하고 재실행 시 불러온다. 파일은 약 15.3MB이며
개인 사진을 포함하므로 공유 범위를 확인한다. 오프라인 브라우저 검증에서
사진 로드·PNG/JSON/CSV 다운로드, 외부 요청 0건, JS 오류 0건을 확인했다.

재생성: `npm run card:export-photo-html` (기존 보고서 준비 후).
검증: `node scripts/card_recognition/verify-photo-html.mjs`.
운영 촬영 복원은 아직 기존 OpenCV 경로이며 LC100 기본값은 로컬 테스트 패널에 적용했다.

**http://127.0.0.1:3103/**

사진별 세 엔진의 결과를 나란히 표시한다. 녹색 선은 유효 사각형 예측, 빨간 점은
검출한 모서리다. 검출 실패도 같은 사진 행에 남기며 제외하지 않았다.
테두리가 있는 PNG 81개, 원자료 CSV/JSON을 내려받을 수 있다.

### 정답을 지정해 정확도를 확인하기

1. 사진 아래 **정답 테두리 지정 / 검수**를 연다.
2. 예측선이 없는 원본에서 네 파란 점을 실제 변의 교점으로 옮긴다.
3. **이 사진 정답 확인**을 누르면 세 모델의 IoU·코너 오차를 즉시 계산한다.
4. 네 변이 보이지 않는 사진은 **판정불가·재촬영 대상**으로 기록한다.
5. 상단 **정답 테두리 저장·재평가**로 `labels.json`과 `label-evaluation.json`을
   로컬에 저장한다. JSON 다운로드/재불러오기도 가능하다.

정답은 단일 검수의 임시 기준이다. 독립 2회 검수·실측 비율·최종 보류 평가를
대체하지 않는다. 제공 이미지가 없다고 다시 요청하지 않으며, 정답 미지정을
완료된 정확도 평가로 표시하지 않는다.

## 벤치마크 구성

- 원본 27장 모두 약 12.2MP. EXIF 6 방향 26장, EXIF 3 방향 1장이다.
- EXIF를 적용한 RGB 입력을 긴 변 강제가 아니라 총 **2MP 이하**로 축소했다.
  portrait 1224×1632, landscape 1632×1224, 모두 1,997,568px이다.
- 같은 lossless PNG를 세 엔진에 입력했다. 원본 JPEG와 준비 PNG의 SHA-256을 기록했다.
- 엔진별 27장, 전체 **81회**. 9장마다 새 page/Worker/session을 만들고 session
  준비 시간은 별도로 기록했다. 각 사진은 한 번 처리한 파일럿이며 warm 200회,
  cold 50회, 원본 12MP 복원, 모바일 성능 시험은 아니다.
- “유효 네 점”: 유한 좌표 4개, 순환 정렬 후 볼록성, 입력 범위를 만족.
  **명함 테두리가 정확하다는 판정은 아니다.**
- p50/p95는 nearest rank이다. 처리 시간은 동일 페이지 clock에서 측정했다.
  Worker 추론 구간은 Worker 내부 duration으로 별도 기록했다.
- 모델별 후처리 threshold 0.3 등 기존 공식 어댑터를 그대로 사용했다. 이
  사진의 결과를 보고 threshold나 가중치를 바꾸지 않았다.

## 수치 결과

| 엔진             | 처리  | 유효 네 점        | 검토 필요 | 실행 오류 | 전체 호출 p50 | 전체 호출 p95 | 최대     |
| ---------------- | ----- | ----------------- | --------- | --------- | ------------- | ------------- | -------- |
| 기존 OpenCV      | 27/27 | **2/27 (7.4%)**   | 25        | 0         | 123.4ms       | 615.7ms       | 682.8ms  |
| DocAligner LC100 | 27/27 | **23/27 (85.2%)** | 4         | 0         | 3325.0ms      | 4063.5ms      | 4946.8ms |
| DocAligner T8    | 27/27 | **23/27 (85.2%)** | 4         | 0         | 3465.0ms      | 4492.7ms      | 4921.6ms |

시간에는 로컬 PNG fetch/decode·전처리·추론·후처리가 포함된다. session 준비는
위 시간에서 제외되며, Worker의 OpenCV 최초 로딩은 해당 호출에 포함된다.
기존 OpenCV는 성공한 2장에서 warp/JPEG 인코딩도 포함한다. 따라서 위 열은
**현재 경로별 호출 시간**이며 같은 범위의 검출 연산 속도 비교/최종 성능 PASS로
사용하지 않는다. 빠른 실패를 성공 복원 시간으로 간주하지 않는다.

LC100 Worker 추론만의 p95는 **248.1ms**, T8은 **249.8ms**였다. 그 밖의 시간은
decode·전처리·후처리 등이며 원자료에서 구간별로 확인할 수 있다.

### 모델 간 일치도

두 학습 모델이 모두 유효한 **21/27장**에서:

- 예측 영역 간 IoU 중앙값: **0.992489**.
- 예측 영역 간 IoU p5: **0.982598**.
- 가장 낮은 일치도: `photo-009`, IoU **0.966373**.

이는 **LC100과 T8의 일치도**다. 한 모델의 예측을 실제 정답으로 간주하지 않았으며,
두 모델이 같은 영역을 잘못 잡을 가능성도 있으므로 정답 정확도로 해석하지 않는다.

### 학습 모델의 검토 필요 사진

- LC100: `photo-003`, `photo-014`, `photo-017`, `photo-026`.
- T8: `photo-008`, `photo-010`, `photo-014`, `photo-017`.
- 공통: `photo-014`, `photo-017`.

사진번호와 원본 파일명의 대응은 보고서와 `photos.json`에 있다. 일부 사진은
프레임 끝과 명함이 가깝거나 변이 잘려 있어, 미검출과 재촬영 필요를 시각적으로
구분해야 한다. 이 사유를 모델 출력만으로 정답 라벨에 자동 반영하지 않았다.

## 판정과 검증

| 항목                          | 판정                  | 근거                                                                   |
| ----------------------------- | --------------------- | ---------------------------------------------------------------------- |
| 실행·원자료 수집              | PASS                  | 27×3=81건 전부 기록, 실행 오류 0                                       |
| 테두리 시각화·다운로드        | PASS                  | 이미지 81개, 브라우저에서 사진 27행/overlay 81개 확인                  |
| 수동 정답 편집                | PASS: 기능 확인       | 점 이동 동작·잘못된 소스 라벨 400 거절 확인, 가짜 정답은 저장하지 않음 |
| 실제 외곽 IoU·Emean·내용 보존 | **NOT_RUN**           | 검수된 정답·필수 인쇄 영역 라벨 없음                                   |
| 수정 없는 채택률              | **NOT_RUN**           | 사용자 채택 평가 없음                                                  |
| 최종 성능                     | **NOT_RUN**           | 반복 수·warm/cold·모바일·통제 환경 기준 미충족                         |
| 최종 데이터 충족              | **INSUFFICIENT_DATA** | 실제 정상 최소 100개 카드/300장 미달; 물리적 카드 중복도 미분류        |

이 파일럿으로 기존 OpenCV의 미검출 문제를 실제 자료에서 재현했고, 두 학습
모델의 후보 제시량 개선을 확인했다. 최종 모델 선택·제품 기본 전환은 하지 않았다.
원 자료의 앞/뒤나 같은 카드 반복 촬영을 독립 카드로 가정한 95% 구간은 계산하지 않았다.

## 재실행

```powershell
cd D:\Persnapse\persnapse-mvp
npm run card:prepare-photos
npm run card:benchmark-photos
npm run card:report-photos
npm run card:serve-photo-report
```

새 실행 전에 이전 `output/card-rectification/real-pilot/` 결과는 별도 경로로
보존한다. 같은 입력의 라벨은 manifest SHA-256과 원본 SHA로 연결하며 다른
입력의 라벨을 가져오면 거절한다.

산출물(모두 Git 제외):

- `output/card-rectification/real-pilot/report.html`, `report-metrics.js`.
- `photos.json`, `provenance.json`, `browser.json`, `summary.json`, `cross-model.json`.
- `measurements.jsonl`, `measurements.csv`, `raw-measurements.jsonl`.
- `inputs/` 준비 PNG, `overlays/` 81개 PNG, `contact-*.jpg` 엔진별 전체 보기.
- `report-check.json`, `report-verified.png`, `benchmark.log`, 검증 로그.

원 기록의 source/input SHA 이름을 manifest 기준으로 바로잡았고, 원본
`raw-measurements.jsonl`을 별도 보존했다. 예측·시간 값은 수정하지 않았다.

근거: [설계](../plans/card-boundary-rectification-design-2026-10-12.md),
[정량 기준](../plans/card-boundary-rectification-benchmark-2026-10-12.md).
