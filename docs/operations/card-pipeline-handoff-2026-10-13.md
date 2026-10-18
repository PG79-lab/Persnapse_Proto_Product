# 명함 인식 파이프라인 현황·인수인계

기준일: **2026-10-13**. 최적화·고도화 이전 기능 체크포인트를 기록한다. 다른 세션이나 코드베이스에서 현재 구현과 검증 범위를 파악하기 위한 문서다.

## 1. 현재 결론

통합 워크스페이스 `/#cards`에 **명함 촬영/업로드 → LC100 테두리 감지 → 원근 보정 → 2D 이미지 확인 → OCR → 정보 확인·저장** 흐름을 연결했다. 핵심 기능 연결은 완료했으며, 초기 설계의 최종 품질·성능 기준은 아직 충족 여부를 검증하지 않았다.

- 명함 작업 커밋: `88480f2` — `feat(cards): integrate LC100 rectification before OCR`.
- 해당 커밋은 로컬 `main`에 반영했다. 이 작업에서 원격 푸시는 수행하지 않았다.
- 문서 작성 시 저장소 HEAD는 후속 STT 커밋 `9ec8392`다. 명함 작업 기준은 위 `88480f2`로 구분한다.
- 별도 작업의 미커밋 변경은 보존했다. 이후 작업에서도 전체 작업 트리를 초기화하거나 일괄 커밋하지 않는다.

## 2. 구현 상태와 처리 정책

| 기능                    | 현재 구현                                                   |
| ----------------------- | ----------------------------------------------------------- |
| 촬영·파일 업로드        | 같은 명함 처리 파이프라인 사용                              |
| 외곽 테두리 감지        | DocAligner LC100을 기본 모델로 사용                         |
| 감지 실패·잘못된 테두리 | 수동 모서리 편집 후 다시 보정 가능                          |
| 원근 보정               | OpenCV로 사각형 영역을 평면 2D 명함 이미지로 변환           |
| 사용자 확인             | 원본의 테두리와 보정 결과 비교, 보정 JPEG 다운로드          |
| OCR 시작                | 사용자가 보정 이미지를 승인한 뒤 실행                       |
| OCR 재시도              | 새 처리 recipe에서는 저장된 보정 이미지를 입력으로 사용     |
| 원본 관리               | 원본과 보정 이미지를 별도 관리; 기존 원본 압축 정책 유지    |
| 정보 확인·저장          | 기존 명함 정보 편집·Identity 선택·저장 흐름에 연결          |
| 중단·취소               | AbortSignal 및 작업 revision으로 이전 작업의 늦은 응답 차단 |

원근 보정은 촬영된 평면 명함의 시점 왜곡을 펴는 처리다. 현재 가로세로 비율은 영상 속 경계 길이로 추정하며, 실제 물리적 비율 복원·글자 방향 자동 회전은 구현하지 않았다. 감지 실패 시에는 OCR을 먼저 실행하지 않고 수동 보정을 안내한다.

처리 recipe는 `docaligner-lc100-card-v1`, `manual-card-v1`이다. 과거 `canvas-card-v1` 데이터는 기존 원본 OCR 정책을 유지한다.

### 모델·런타임

| 역할           | 구성                                                                     |
| -------------- | ------------------------------------------------------------------------ |
| 테두리 모델    | DocAligner LC100, `lcnet100_h_e_bifpn_256_fp32.onnx`                     |
| 모델 출처 기준 | DocsaidLab/DocAligner commit `3275b0f07f8e99d8c01cb0774dea2549be1416b6`  |
| 모델 크기      | 4,767,987 bytes                                                          |
| 모델 SHA-256   | `f4117b786e3a18470f3865c93f3c2bd69d9b998edd60f385574a5c665e79594e`       |
| 브라우저 추론  | ONNX Runtime Web 1.30.0, Worker, WASM 단일 thread                        |
| 원근 보정      | OpenCV.js                                                                |
| OCR            | 기존 서버 OCR 설정 사용; 앞선 통합 확인 시 live/OpenAI/gpt-5.6-luna 설정 |

OCR provider/model은 환경 설정에 따라 바뀐다. 위 OCR 설정은 당시 확인값이며 새 세션에서 실행 전 확인해야 한다. CLOVA 구현은 존재하지만 이번 통합 실험에서 선택·평가하지 않았다. 비밀값은 문서에 기록하지 않는다.

## 3. 검증 결과와 해석

| 검증                      | 결과                                               | 해석·제한                                              |
| ------------------------- | -------------------------------------------------- | ------------------------------------------------------ |
| 실제 사진 LC100 감지·보정 | 27장 중 23장 생성, 4장 수동 보정 필요              | 유효한 사각형 판정; 정답 기반 정확도는 아님            |
| 수동 보정 필요 사진       | `photo-003`, `photo-014`, `photo-017`, `photo-026` | prepared manifest의 imageId 기준                       |
| 보정 이미지 OCR 전달      | 자동 성공 23장 모두 Mock 전달 PASS                 | recipe·원본/보정 해시 구분 확인                        |
| 실제 OCR 문자·필드 정확도 | NOT_RUN                                            | 27장 파이프라인 실험의 외부 OCR 호출 0회               |
| 단위 테스트               | 259개 PASS                                         | 명함 커밋의 분리된 staged 소스 기준                    |
| 관련 E2E                  | 6개 PASS                                           | 카메라 입력은 시뮬레이션; 실제 모바일 카메라 검증 아님 |
| lint/typecheck/format     | PASS                                               | 커밋 시점 검증                                         |
| 프로덕션 빌드             | Webpack PASS                                       | 분리 검증 환경의 Turbopack 빌드는 메모리 부족 발생     |

**23/27을 테두리 정확도 85.2%로 보고하면 안 된다.** 독립 정답 테두리가 없어 IoU·모서리 오차·내용 잘림 정확도는 미평가다. 실제 DB 저장·모바일·최종 품질 gate 전체 통과를 의미하지도 않는다.

### 처리 시간

자동 성공 사진 23장 기준, 사진마다 새 Worker/브라우저에서 모델·OpenCV 초기 로드를 포함한 PC 측정이다. OCR·업로드 시간은 제외했다. 일부 구간에 다른 검증이 동시에 실행되어 통제된 성능 벤치마크로 해석하지 않는다.

| 구간                | 중앙값(p50) |        p95 |
| ------------------- | ----------: | ---------: |
| 전체 로컬 감지·보정 |   8,373.5ms | 18,340.6ms |
| 모델 로드           |   1,594.2ms |  5,894.2ms |
| 추론                |     304.5ms |    551.7ms |
| 테두리 후처리       |   4,594.8ms |  9,819.2ms |
| warp·JPEG 생성      |     571.8ms |    894.9ms |

테두리 후처리가 주요 병목이다. 모델·Worker 재사용과 후처리 최적화를 우선 진행한다. 구간별 percentile을 더해 전체 percentile로 계산하지 않는다.

## 4. 코드 위치

아래 경로는 저장소 루트 기준이다.

| 위치                                               | 책임                                                |
| -------------------------------------------------- | --------------------------------------------------- |
| `src/features/capture/business-card-workspace.tsx` | 촬영 큐, 감지·보정, 비교 화면, 승인 후 OCR 연결     |
| `card_recognition/rectify-card.ts`                 | LC100 전·후처리, 모서리 검증, warp 및 시간 측정     |
| `card_recognition/model-policy.ts`                 | 기본 모델 선택                                      |
| `card_recognition/card-corner-editor.tsx`          | 수동 모서리 편집                                    |
| `card_recognition/models/`                         | 모델 manifest·출처·라이선스                         |
| `src/domain/business-card-workflow.ts`             | 처리 recipe 계약                                    |
| `src/server/services/`                             | OCR 입력 선택 및 기존 명함 처리 서비스              |
| `src/server/repositories/`                         | 재시도 시 보정 자산 선택 등 DB 접근                 |
| `scripts/card_recognition/`                        | 모델 준비, 사진 벤치마크, Mock 서버, HTML 생성·검증 |
| `card_recognition/README.md`                       | 모듈 상세 사용 안내                                 |

## 5. 실행·재검증

Node.js 24.x, 프로젝트 의존성, 모델 자산이 필요하다. 새로운 checkout에는 Git에서 제외된 모델 바이너리와 개인 사진·측정 결과가 포함되지 않는다.

```powershell
npm ci
npm run card:download-models

# 일반 앱: 실제 OCR·저장은 로컬 환경 설정에 따름
npm run dev
# http://localhost:3000/#cards

# 별도 터미널: 실제 LC100·보정 + Mock OCR, 외부 AI/DB 호출 없음
npm run card:test-ui
# http://127.0.0.1:3100/#cards
```

Mock 화면은 이미지 처리와 OCR 전달·정보 표시까지 확인하는 용도다. 최종 정보 확정·DB 저장은 일반 앱에서 검증한다. 2026-10-13 작업 종료 시 일반 앱을 3002, Mock을 3100 포트로 실행했지만, 서버 실행 상태는 세션마다 확인해야 한다.

```powershell
npm run verify
npm run card:test-e2e

# 준비된 실제 사진 manifest와 3100 Mock 서버가 있을 때
node scripts/card_recognition/verify-pipeline-photos.mjs
node scripts/card_recognition/python.mjs scripts/card_recognition/report_pipeline.py

# 감지 테두리 비교용 단일 HTML 재생성: 기존 측정 자료 필요
npm run card:export-photo-html
```

사진 처리·HTML 생성 Python 명령은 프로젝트의 Python 의존성/환경 준비가 필요하다. 상세 준비·옵션은 `card_recognition/README.md`와 해당 스크립트를 참고한다. 모델 다운로드는 별도 단계이며 일반 빌드는 네트워크 다운로드를 수행하지 않는다.

### 로컬 결과물

| 경로                                                                                  | 내용                                                          |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `card_test_image/`                                                                    | 실제 명함 사진 약 27장; 개인 데이터, Git 제외                 |
| `output/card-rectification/real-pilot/photos.json`                                    | EXIF 정규화·준비 이미지 manifest                              |
| `output/card-rectification/real-pilot/card-boundary-comparison-LC100-2026-10-13.html` | 27장·3개 감지 방식 비교, 정답 편집·JSON 입출력, 오프라인 HTML |
| `output/card-rectification/real-pilot/pipeline-2026-10-13/pipeline-comparison.html`   | 원본·보정 이미지 비교: 23장 결과와 4장 수동 보정 대상         |
| `output/card-rectification/real-pilot/pipeline-2026-10-13/summary.json`               | 처리 시간·성공·실패 요약                                      |
| `output/card-rectification/real-pilot/pipeline-2026-10-13/rows.json`                  | 사진별 측정·판정                                              |

두 HTML은 이미지가 포함된 단일 파일로, 브라우저에서 직접 열어 검증할 수 있다. 사진·모델 바이너리·생성 HTML·측정 산출물은 Git에서 제외되어 다른 환경으로 자동 전달되지 않는다. 원본 27장의 SHA-256 보존을 당시 확인했다. HTML 도구로 입력한 테스트용 정답을 독립 검증된 ground truth로 간주하지 않는다.

## 6. 다음 작업 우선순위

| 순서 | 작업                                            | 확인할 성과                                                         |
| ---- | ----------------------------------------------- | ------------------------------------------------------------------- |
| 1    | 후처리 최적화, 모델·Worker 재사용               | 같은 사진·환경에서 전후 p50/p95, 취소·메모리 안정성 비교            |
| 2    | 실제 정답 테두리 작성 및 OCR 비교               | IoU·모서리 오차·내용 잘림, 원본 대비 보정 OCR 문자/필드 정확도      |
| 3    | 비율·90도 회전 조정, 경계 정밀화, 원본 ROI 활용 | 왜곡·방향·해상도 개선과 재처리 품질                                 |
| 4    | 저장 구조·복원 안정화 및 모바일 검증            | Android/iPhone 촬영, 반복·취소, 저장·새로고침, revision/idempotency |

현재 실제 명함 비율 복원, 원본 경계의 직선 정밀화, 원본 ROI 기반 고품질 단일 warp, v2 복원 소스·메타데이터 저장 설계는 완성하지 않았다. 실제 기기·통제된 warm/cold 성능·최종 실저장 장애 검증도 남아 있다.

초기 벤치마크의 주요 목표에는 정답 기준 테두리 통과율 ≥95%, IoU ≥0.985·최대 모서리 오차 ≤1.5%, warm p95 ≤4초/p99 ≤6초 등이 있다. 현재 측정은 이 gate에 직접 대응하지 않는다. 최종 데이터 규모·음성 사례·재촬영·메모리·저장 조건은 아래 벤치마크 원문을 기준으로 평가한다.

## 7. 설계 변경과 참고 자료

초기 설계의 OCR 병렬 처리 및 정보 확인 후 복원 순서에서, 사용자 승인에 따라 **보정 이미지 확인 후 OCR** 순서로 변경했다. 기본 모델 역시 LC100으로 결정했다. 이 문서는 상태 기록이며 새 구현 범위를 승인하는 문서가 아니다.

- [초기 설계](../plans/card-boundary-rectification-design-2026-10-12.md)
- [초기 벤치마크·통과 기준](../plans/card-boundary-rectification-benchmark-2026-10-12.md)
- [LC100 선택 결정](../decisions/0022-card-boundary-lc100-selection.md)
- [OCR 이전 보정 결정](../decisions/0023-card-rectification-before-ocr.md)
- [기존 커밋 체크포인트](card-rectification-checkpoint-2026-10-13.md)
- [통합 파이프라인 테스트 안내](card-pipeline-test-2026-10-13.md)

다음 세션은 먼저 `AGENTS.md`, 이 문서, 관련 결정 문서를 읽고 Git 상태를 확인한다. 기존 미커밋 변경을 보존한다.

### 후속 방향 확정·설계 기록 — 2026-10-13

최신: 사용자 승인한 20분 개선으로 후처리 getter 접근 최적화·보정본 90도 회전·대표 사례/실제 OCR 비교를 수행했다. [실행 결과와 한계](card-quick-optimization-results-2026-10-13.md)를 먼저 읽는다. 아래 이전 기능·수치는 기존 체크포인트 이력이다.

사용자 테스트 제공 후속 작업: 최신 소스 별도 production snapshot을 빌드하고 **3130 Mock / 3131 일반 앱**을 실행했다. 실제 통합 화면의 업로드·감지·보정·회전·Mock OCR smoke가 통과했다. [접속·사용·재실행 안내](card-test-ready-2026-10-13.md)를 참고한다. 실행 상태는 다음 세션에서 다시 확인한다.

사용자가 **제한된 속도 최적화·27장 품질 평가 → 원본 보존 → 이미지 처리 → 명함 디지털 재현** 순서를 확정했다. 디지털 재현은 원본 도안에 가까운 프론트엔드 디자인 재구성이며 현재 원근 보정과 구분한다.

- [확정 작업 방향과 승인 경계](../decisions/0024-card-optimization-quality-and-digital-reproduction-direction.md)
- [1·2단계 상세 설계·측정 계획](../plans/card-pipeline-optimization-quality-2026-10-13.md)

상세 설계 보고 후 사용자 OK를 받고 구현을 시작한다. 최신 사용자 피드백에 따라 이번 실행은 **20분 이내의 후처리 소규모 개선·대표 사례 평가·기울기/회전 처리**로 축소했다. 27장 전체 GT/OCR 평가와 Worker 재사용 구현은 후속 후보이며, 상세 설계의 최신 범위를 따른다. 이 추가 기록은 새 구현이나 성능 측정이 완료되었다는 의미가 아니다.
