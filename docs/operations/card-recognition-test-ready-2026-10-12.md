# 바로 실행하는 명함 테스트

현재 구현은 **로컬에서 테스트 가능**하다. 통합 `/#cards`에 사진 선택부터
모델 외곽·보정 미리보기·JPEG 다운로드까지 확인하는 테스트 패널을 추가했다.

2026-10-13: 일반 촬영/파일 선택에도 LC100 → 원근 보정 → 2D 이미지 확인 → OCR을
연결했다. 새 통합 흐름과 실제/Mock OCR 구분은
[통합 명함 파이프라인 테스트](card-pipeline-test-2026-10-13.md)를 따른다.
아래 별도 테스트 패널은 모델 비교용으로 유지한다.

## 실행

```powershell
cd D:\Persnapse\persnapse-mvp
npm run card:test-ui
```

브라우저에서 **http://127.0.0.1:3100/?cardTest=1#cards**를 연다.
빌드가 준비되어 있으면 `npm run card:serve-test`로 바로 시작할 수 있다.
종료는 실행 터미널에서 Ctrl+C다. 테스트 서비스는 localhost에만 열린다.
별도 backend 3101 포트는 페이지 제공을 위한 것이므로 테스트에는 3100 주소를 사용한다.

1. **합성 샘플 불러오기**를 누른다. 실제 사진 없이 테스트할 수 있다.
2. 기본 모델은 **LC100**이다(2026-10-13 선택). **외곽·복원 테스트 실행**을 누른다.
3. 왼쪽 검출 테두리와 오른쪽 보정 이미지를 비교한다. 크기·바이트·구간별
   시간, 합성 샘플의 정답 외곽 IoU가 표시된다.
4. 같은 사진에서 **T8**, **LC100**으로 바꿔 반복 비교한다. 유효한 네 모서리를
   찾지 못하면 보정을 생략하고 검출 점 수·코너별 최대 모델 응답을 표시한다.
5. **보정 JPEG 다운로드**로 결과 파일을 받는다.
6. 선택적으로 **테스트 사진 선택**으로 JPEG·PNG·WebP(10MiB 이하)를 넣는다.
   실제 사진 경로를 별도로 요청하지 않는다.

테스트 gateway는 빈 workspace를 제공한다. 일반 업로드의 OCR 응답은 메모리 내 Mock이며
DB/Storage 저장·인물/만남 생성·외부 AI는 실행하지 않는다. 아래 모델 비교 패널에서는
OCR 요청도 실행하지 않는다.
일반 등록 폼이 아니라 위쪽 **명함 외곽·복원 테스트** 패널을 사용한다.
등록·필드 OK·저장·재개·인맥 이동의 전체 흐름은 아래 mock E2E로 검사한다.

## 현재 테스트 가능한 범위

| 대상                                 | 확인 방법                                      | 구분                                       |
| ------------------------------------ | ---------------------------------------------- | ------------------------------------------ |
| 실제 모델 외곽·보정 미리보기         | 로컬 패널에서 샘플/파일과 T8·LC100·OpenCV 비교 | 실제 ONNX/WASM/OpenCV 실행                 |
| 촬영 파일 우선 수동 복원·편집        | 통합 E2E                                       | OCR/DB는 mock, 이미지 처리 실제            |
| 필드 확인·이미지 채택·재개·인맥 이동 | 통합 E2E                                       | 서버 응답 mock; 실제 Storage 검증 아님     |
| Worker 추론·전처리·후처리            | `npm run card:compatibility`                   | 고정 기준 입력과 CPU/WASM 비교             |
| 취소·시간 초과·늦은 응답 폐기        | 단위 검사와 패널 중단                          | 메인 스레드 기존 warp는 즉시 중단되지 않음 |
| 전체 품질·모바일·v2 저장             | 아직 테스트 완료 불가                          | 미구현/미측정 유지                         |

테스트 패널은 기존 복원기에 모델 코너를 전달한다. 출력 비율은 **estimated**이며
실제 비율 복원을 보장하지 않는다. 검출 입력은 최대 2MP로 준비하고 warp에는
선택 파일을 사용한다. 표시 시간은 개발 PC의 동작 확인값이며 통제된 warm/cold
성능 gate의 측정값이 아니다. 검출 결과가 좋아 보여도 모델 품질 전체 PASS로 판정하지 않는다.

실제 패널 검증 중 T8은 기본 합성 사진에서 1/4점만 반환했고, LC100은 네 점을
반환했지만 잘못된 영역을 잡았다. ONNX 실행 성공과 외곽 품질 성공을 구분한다.
OpenCV 미리보기는 모델을 직접 선택해 확인하고, 학습 모델은 검출 점과 응답 값을 비교한다.
임계값을 낮추거나 가짜 코너를 만들어 성공 결과로 표시하지 않는다.

## 이번 검토·검증 결과

- `npm run verify`: lint·typecheck·단위 테스트 256개·포맷·production build 통과.
- `npm run card:test-e2e`: **5개 통과**, 실제 모델 실행·패널·404·기존 등록 흐름 포함.
- 테스트 gateway: 화면·샘플 GET 200, workspace/명함 POST 405 확인.
- 패널의 서버 API 쓰기 요청: **0회**.
- 제공 주소 3100의 실제 브라우저 검사: 샘플 선택 → OpenCV 보정 → 미리보기
  **PASS**, API 쓰기 0회. `test-ready-live.json`·`test-ready-live.png`에 기록했다.

아래는 기본 **합성 샘플 1장**에서 직접 확인한 결과이며 전체 품질/성능 판정이 아니다.

| 엔진             | 검출·결과                            | 외곽 IoU | 전체 호출 시간 |
| ---------------- | ------------------------------------ | -------- | -------------- |
| 기존 OpenCV      | 보정 856×598px, 37KiB, 다운로드 가능 | 1.0000   | 860.0ms        |
| DocAligner T8    | 1/4점 검출, 보정 생략                | 0.0000   | 3244.8ms       |
| DocAligner LC100 | 보정 280×344px, 21KiB, 잘못된 영역   | 0.2154   | 2793.7ms       |

따라서 지금 제공하는 성과는 **사용자가 실제 입력으로 동작·실패를 재현하고
결과 이미지를 받을 수 있는 테스트 환경**이다. 학습 모델의 명함 정확도가
검증됐다고 보고하지 않는다. 원자료는
`test-results/playwright/.../test-lab-results.json`, `card-test-lab.png`와
`output/card-rectification/test-ready-verify.log`, `test-ready-e2e.log`에 있다.

## 자동 테스트

```powershell
npm run verify
npm run card:test-e2e
```

`card:test-e2e`는 Windows에서 설치된 Chrome/Edge를 선택하고 1 Worker로 실행한다.
다른 환경은 Playwright Chromium 설치가 필요하다. E2E는 production 빌드를
사용하므로 제품 코드 수정 후 먼저 `npm run build` 또는 `npm run verify`를 실행한다.

실제 모델 파일이 없는 새 환경은 다음을 먼저 수행한다. 일반 제품 legacy 빌드는
모델 없이 가능하지만 실제 모델 테스트는 파일이 필요하다.

```powershell
python -m venv --system-site-packages output/card-rectification/python
node scripts/card_recognition/python.mjs -m pip install -r scripts/card_recognition/requirements.txt
npm run card:download-models
npm run card:inspect-models
npm run card:test-ui
```

샘플은 자체 합성 도안이며 개인정보가 없다. 생성기·모델 출처·기존 측정은
[실행 안내](../../scripts/card_recognition/README.md)와
[개발 진행 보고서](card-boundary-rectification-progress-2026-10-12.md)에 있다.
