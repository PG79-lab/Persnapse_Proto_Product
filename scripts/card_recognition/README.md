# 명함 외곽 평가 실행

제품 동작과 평가 도구를 분리한다. 이 도구는 외부 AI/OCR API를 호출하지 않는다.
실제 사진 경로는 제공될 때까지 보류하며 재요청하지 않는다.

## 1단계 재현

PowerShell, 저장소 루트에서 실행한다. 생성 데이터와 원자료는 Git 제외인
`output/card-rectification/`에 저장한다. 도안 단위 36/12/12 분할과 seed
20261012를 고정한다. 임계값 튜닝에 보류 자료를 사용하지 않는다.

```powershell
python -m venv --system-site-packages output/card-rectification/python
node scripts/card_recognition/python.mjs -m pip install -r scripts/card_recognition/requirements.txt
npm run card:dataset
npm run card:validate-dataset
$env:PLAYWRIGHT_CHANNEL = 'chrome' # 설치된 Chrome; 생략하면 Playwright Chromium 사용
npm run card:benchmark
npm run card:image-metrics
npm run card:report
```

초기 사용자 변경 백업은 `output/card-rectification/baseline/`에 있다. 재현 시
이 백업이 없으면 기존 평가 실행의 `files.json`을 보존하거나 현재 Git 상태를
별도로 기록해야 한다. 평가기는 백업을 덮어쓰지 않는다.

생성 manifest와 마스크의 SHA-256, 크기, 기하 정답을 확인한다. 정상 1,200장,
명함 없음 300장, 비정상 200장을 처리하며 정상 입력의 기존 검출과 정답 코너
복원을 별도 경로로 기록한다. 판정은 준비 단계와 검출기 품질을 분리한다.

`measurements.jsonl`은 응답마다 기록하므로 중단 시에도 완료된 원자료가 남는다.
다시 실행하면 새 runId로 재측정한다. 이전 실행은 별도 경로에 보존한다.
`CARD_BENCHMARK_LIMIT`는 예비 실행용이며 1,700장보다 적으면 성공 종료하지 않는다.

브라우저 페이지를 20장마다 재생성하는 실행은 정확성 대조용이다. 시간에는
로컬 fetch와 직렬화가 포함된다. warm/cold 성능 기준, 통제 네트워크 또는
모바일 속도 PASS로 해석하지 않는다. 실패와 미검출도 전체 분모에 포함한다.

영상 평가는 합성 보류 240장의 동일 촬영 소스를 OpenCV로 변환하고 고정
JPEG 품질 94로 인코딩한 기준과 비교한다. Pillow RGB decoder를 양쪽에
사용하며 임의 resize나 재정렬로 결과를 맞추지 않는다. 정답 코너 경로도
기존 출력 크기/근사 비율을 유지하므로 실측 비율 시험을 대체하지 않는다.

## 2단계 호환성 하위 시험

```powershell
npm run card:download-models
npm run card:inspect-models
node scripts/copy-card-runtime.mjs
node scripts/card_recognition/python.mjs scripts/card_recognition/reference_preprocessing.py
npm run card:compatibility
```

DocAligner upstream commit과 공식 가중치 매핑을 다운로드 시 기록한다.
ONNX checker로 무결성과 입출력을 검사한 manifest, 라이선스만 추적하며
모델은 해시 경로로 정적 복사한다. dev/build 중 네트워크 다운로드는 없다.
기본 legacy 환경은 로컬 모델 없이 빌드할 수 있다. learned 준비 환경에서는
해당 모델 파일을 요구한다. 추론 모델을 제품 복원 후보로 사용하기 전
공식 전후처리와 품질 기준을 모두 검증해야 한다.

ORT 1.30.0을 고정했다. 단일 스레드 WASM 전용 Worker를 사용하고 proxy와
WebGPU는 사용하지 않는다. 고정 BGR NCHW tensor 30개/모델로 CPU와 WASM
출력을 비교한다. 별도 RGB 패턴 30개에서 OpenCV/NumPy의 BGR·resize·NCHW
전처리와 Worker 결과를 비교하고, 수학적으로 생성한 heatmap 30개에서
threshold·Otsu·최대 윤곽 중심점 후처리를 재현한다. 실제 모델 출력에 대한
공식 코너 비교는 NOT_RUN이며 이 시험만으로 2단계 전체를 통과시키지 않는다.

production 자산 시험은 실제 모델 파일이 준비된 상태에서 실행한다.

```powershell
$env:NODE_OPTIONS = '--max-old-space-size=512'
npm run verify
$env:PLAYWRIGHT_CHANNEL = 'chrome'
npx playwright test tests/e2e/capture.spec.ts tests/e2e/card-runtime.spec.ts --workers=1
```

`/#cards` E2E의 OCR/DB는 mock이다. runtime 시험의 ONNX와 WASM은 실제
파일이다. PC Chrome 결과를 Android/iPhone 결과로 표시하지 않는다.

## 근거와 미완료

- [작업 설계](../../docs/plans/card-boundary-rectification-design-2026-10-12.md)
- [벤치마크 정의](../../docs/plans/card-boundary-rectification-benchmark-2026-10-12.md)
- [DocAligner 공식 추론](https://github.com/DocsaidLab/DocAligner/blob/3275b0f07f8e99d8c01cb0774dea2549be1416b6/docaligner/heatmap_reg/infer.py)
- [ORT 실행 설정](https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html)

공식 전후처리, DocQuad 동일 버전 확인, 새 복원기/비율/ROI, v2 저장,
모바일·실사진 검증이 남아 있다. 제품 기본 모델은 선택하지 않았다.
