# 통합 명함 촬영·감지·보정·OCR 테스트

일반 앱의 `/#cards`에 LC100과 원근 보정을 OCR 앞 단계로 연결했다.

1. **명함 촬영** 또는 **이미지 업로드**로 명함 한 장을 추가한다.
2. LC100 검출 테두리와 **정면 2D 명함 이미지**를 비교한다. JPEG 다운로드 가능.
3. 검출 실패 또는 잘못된 테두리는 **OCR 전 모서리 직접 지정** 후 **지정한 영역으로 보정**한다.
4. **이 2D 이미지로 OCR 실행**을 누른다. 보정 이미지와 추출된 명함 정보를 확인한다.
5. 일반 앱에서는 기존 정보 확인·Identity 선택·저장 절차를 진행한다.

원본과 보정본을 별도로 유지한다. 서버의 기존 원본 압축 정책은 유지한다.
새 recipe는 보정된 display 이미지를 최초 OCR 및 재시도 입력으로 사용한다.
과거 canvas-card-v1 기록은 기존 원본 OCR 정책을 유지한다. 가로·세로 비율은
추정값이며 글자 방향 자동 회전·실측 비율 복원은 포함하지 않는다.

## 실행 경로

- 로컬 이미지 처리/Mock OCR: `npm run card:test-ui` → http://127.0.0.1:3100/#cards
  - 실제 LC100과 원근 보정, 메모리 내 Mock OCR 응답. 표시된 이름/연락처는 실제 사진을 읽은 결과가 아니다.
  - 외부 AI와 DB 저장은 실행하지 않는다. 정보 추출 확인까지 지원하며 이후 확정/저장은 일반 앱에서 테스트한다.
- 실제 OCR/기존 저장 흐름: `npm run dev` → http://localhost:3000/#cards
  - 기존 `.env.local`의 BUSINESS_CARD_OCR_MODE/PROVIDER와 서버 접근 설정을 사용한다.
  - live 설정이면 사용자가 OCR 실행을 누를 때 기존 OCR API 호출 및 Draft 자산 저장이 수행된다.

## 재현·검증

```powershell
npm run verify
npm run card:test-e2e
node scripts/card_recognition/verify-pipeline-photos.mjs
node scripts/card_recognition/python.mjs scripts/card_recognition/report_pipeline.py
```

27장 검증은 3100 테스트 서비스를 먼저 실행한다. 기존 준비 이미지
`output/card-rectification/real-pilot/photos.json`을 사용한다. 검출 실패를 제외하지
않고 수동 보정 대상으로 기록하며, 자동 성공 사진은 보정 JPEG와 전송 receipt를 확인한다.
개인 사진과 결과는 Git에서 제외된 output 아래에만 보관한다.

결과: `output/card-rectification/real-pilot/pipeline-2026-10-13/summary.json`,
`rows.json`, 사진별 `*-rectified.jpg`, `pipeline-comparison.html`.
실제 OCR 정확도와 모바일 품질 gate는 이 Mock 시험으로 통과 판정하지 않는다.

## 이번 결과

| 단계                      | 측정·판정                                                                                            |
| ------------------------- | ---------------------------------------------------------------------------------------------------- |
| LC100 자동 외곽·원근 보정 | 23/27장 생성 PASS, photo-003/014/017/026은 수동 보정 필요                                            |
| 보정 이미지 OCR 전송      | 자동 성공 23장 모두 Mock 전달 PASS, 원본/보정본 해시 구분 및 recipe 확인                             |
| 단계 시간                 | 성공 23장 기준 cold PC 전체 p50 8,373.5ms / p95 18,340.6ms; 추론 p50 304.5ms / warp·JPEG p50 571.8ms |
| 실제 OCR 문자 정확도      | NOT_RUN; 외부 OCR 호출 0회                                                                           |
| 기본 검증                 | lint/typecheck/format/build PASS, 단위 검사 259개 PASS                                               |

시간에는 사진별 새 Worker/브라우저의 모델·OpenCV 초기 로드를 포함하고,
OCR/업로드 시간은 제외한다. 일부 구간에 다른 검증도 동시 실행됐으므로 통제된
속도 비교·모바일 성능 gate로 쓰지 않는다. 실제 외곽 정확도도 정답 검수 전 미확정이다.

현재 실행된 일반 앱은 http://127.0.0.1:3002/#cards 이다. 기존 live/OpenAI 설정을
사용하며 `/api/workspace`, `/api/business-cards` 읽기 응답 200을 확인했다.
실제 OCR 시험은 이 주소에서 이미지 확인 후 OCR 실행을 누른다.

통합 E2E 6개 PASS. 카메라 입력은 시뮬레이션한 영상/사진이며, LC100 로드 실패 시
수동 보정 → 이미지 채택 → OCR 순서와 채택 전 OCR 요청 0회를 확인했다.
실제 휴대폰 카메라/모바일 성능 검증은 별도로 남았다.
