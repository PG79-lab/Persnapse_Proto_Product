# 최신 명함 기능 사용자 테스트

2026-10-13. 이번 소규모 후처리 개선·90도 회전을 포함한 최신 소스로 실행한다. 기존 3002/3100 서버는 유지하고 새 테스트 포트를 사용한다.

**준비 완료:** 최신 소스 snapshot의 Webpack production build PASS. 실제 통합 Next 화면에서 대표 사진 업로드 → LC100 → 원근 보정 → 90도 회전 → Mock OCR 정보 표시 smoke PASS, page error 0. 보정본 807×1468을 회전하여 OCR에 1468×807로 전달했다. 개발 모드 검증은 메모리 부족으로 실패하여 production 실행본으로 전환했다.

| 주소                           | 용도                                                                                          |
| ------------------------------ | --------------------------------------------------------------------------------------------- |
| `http://127.0.0.1:3130/#cards` | 실제 LC100·원근 보정·회전, Mock OCR. 반복 테스트에 사용. 명함 최종 DB 저장은 제공하지 않는다. |
| `http://127.0.0.1:3131/#cards` | 실제 OCR·저장을 사용하는 일반 앱. 현재 환경의 제공자 설정을 따른다.                           |

## 사용 순서

1. 주소를 열고 **이미지 업로드** 또는 **명함 촬영**을 선택한다. 데스크톱 촬영은 브라우저 카메라 권한과 연결된 카메라가 필요하다.
2. `D:\Persnapse\persnapse-mvp\card_test_image`의 사진을 선택한다. 처음에는 한 장씩 테스트한다.
3. **명함 테두리·2D 이미지 확인**에서 원본의 테두리와 보정 이미지를 비교한다.
4. 글자가 옆으로 있거나 뒤집혔으면 **오른쪽으로 90도 회전**을 누른다. 다운로드 JPEG도 같은 방향이다.
5. 테두리가 잘못 잡히거나 자동 감지에 실패하면 **OCR 전 모서리 직접 지정** → **지정한 영역으로 보정**을 선택한다.
6. **이 2D 이미지로 OCR 실행**을 눌러 정보 화면까지 확인한다. 3130의 정보는 Mock이므로 실제 문자 정확도 평가에는 3131을 사용한다.

## 실행 구성

메모리 부족이 발생한 개발 모드 대신 이번 세션은 `output/card-rectification/test-ready-build-20261013/`에 최신 소스를 복사한 별도 프로덕션 실행본을 실행 중이다. 기존 미커밋 변경을 원본에서 삭제하거나 덮어쓰지 않았다. 이 snapshot은 이후 소스 수정이 자동 반영되지 않는다.

3130은 Mock gateway이고 3131은 일반 앱이다. `scripts/card_recognition/serve-test.ts`의 `CARD_TEST_BACKEND_MODE=external`로 이미 실행한 backend에 연결한다. 다른 서버를 종료하지 않는다.

다음 세션에서 소스 개발 모드로 재실행할 경우, 비어 있는 포트인지 확인한 뒤 각각 별도 터미널에서 실행한다.

```powershell
# 터미널 1: 최신 소스 일반 앱
npm run dev -- --webpack --hostname 127.0.0.1 --port 3131
```

```powershell
# 터미널 2: 같은 앱에 연결하는 Mock gateway
$env:CARD_TEST_PORT = '3130'
$env:CARD_TEST_BACKEND_PORT = '3131'
$env:CARD_TEST_BACKEND_MODE = 'external'
node --import tsx scripts/card_recognition/serve-test.ts
```

모델이 없는 새 checkout에서는 먼저 `npm run card:download-models`를 수행한다. 개인 사진과 생성 HTML은 Git에 포함되지 않는다.

## 확인 자료

로그·PID·사용자 화면 스크린샷·smoke 결과: `output/card-rectification/test-ready-2026-10-13/`.

최신 통합 화면에서 자동 확인: `node scripts/card_recognition/verify-card-ready.mjs`. 실제 LC100과 JPEG 회전 후 Mock OCR에 전달된 크기를 검사하고 이번 테스트 카드만 삭제한다. 실제 제공자 호출·최종 DB 저장은 하지 않는다.

관련 결과: [20분 개선 보고](card-quick-optimization-results-2026-10-13.md). 모바일 실기기 검증과 실제 사용자 촬영 결과는 이번 준비 과정에서 보장하지 않는다.
