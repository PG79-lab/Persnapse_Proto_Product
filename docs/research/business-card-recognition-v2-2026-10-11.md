# 명함 인식 기술 조사 — 2026-10-11

상태: **후보 조사와 1차 구현**. 실제 명함 사진·정답 경로는 아직 전달되지 않았고 아래 후보의 실명함 성능은 미측정이다. [제품 결정](../decisions/0019-business-card-recognition-v2.md)과 [개발 계획](../plans/business-card-recognition-v2-proposal-2026-10-11.md)을 함께 본다.

## 확인한 기준선

기존 [검증 기록](../operations/business-card-recognition-validation-2026-10-08.md)의 합성 명함 4장은 OpenAI 20/20 필드·평균 2,037ms, CLOVA 14/20 필드·평균 1,078ms였다. 원격 합성 1회의 OpenAI OCR 구간 2,915ms도 기록되어 있다. 이 숫자는 실제 모바일의 촬영→수정 가능 p95나 실명함 정확도가 아니다. 코드 기본 제공자는 CLOVA이고 해당 Preview에는 OpenAI가 명시 설정되므로 평가마다 실제 설정을 기록해야 한다.

| 목적                | 재사용 또는 후보                                                                                                                                                                                                                                                             | 검증 항목                                                        |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 촬영                | 웹 [Media Capture](https://www.w3.org/TR/mediacapture-streams/), 가능한 기기의 [ImageCapture](https://developer.mozilla.org/en-US/docs/Web/API/ImageCapture/takePhoto), 전체 비디오 프레임 fallback                                                                          | 기기별 권한·해상도·촬영 지연·원본 글자 선명도                    |
| 평면 복원           | 지연 로딩한 OpenCV.js의 [contour](https://docs.opencv.org/4.5.2/dc/dcf/tutorial_js_contour_features.html)와 [perspective transform](https://docs.opencv.org/4.10.0/dd/d52/tutorial_js_geometric_transformations.html), 수동 코너 지정                                        | 카드 전체 포함, 글자/로고 잘림, 오검출, 모바일 지연·메모리       |
| 필드 추출           | 기존 [OpenAI 이미지 입력](https://developers.openai.com/api/docs/guides/images-vision), [CLOVA General OCR](https://api.ncloud-docs.com/docs/en/ai-application-service-ocr-ocr), 접근 가능 시 [CLOVA 명함 전용 OCR](https://guide.ncloud-docs.com/docs/en/clovaocr-document) | 값 단위 정확도, 잘못된 전화·이메일, 누락, 지연·비용·권한         |
| 시각 품질 추가 개선 | 보정 이미지의 비생성형 업스케일링, 이미지 기반 디자인 복원 후보                                                                                                                                                                                                              | 글자·숫자·로고의 변형 여부와 원본 유사도. 실제 사진 확보 후 선택 |

현재 서버 경로는 브라우저 전처리·전송 → 비공개 Storage 자산 업로드 → DB 캡처 → OCR → 화면 표시다. 3초 이내는 지향 목표이지만 품질 우선이며, 이미지 저장과 OCR의 병렬화는 비용 예약·멱등성·실패 정리 경계를 설계한 뒤 실측이 필요할 때 검토한다. `OK` 이후 평면 복원은 별도 경로로 처리한다.

초기 복원 방식은 원본 이미지를 그대로 원근 변환하므로 인쇄된 폰트·색·로고를 새로 그리지 않는다. 이 방식이 원본 디자인 보존에 유리하다는 것은 구현 선택에 대한 추론이며, 저해상도·반사·흐림을 회복한다는 성능 주장은 아니다. 자동 결과를 확인한 후 저장하고 원본을 보존한다. 복원본은 새 비공개 Storage 경로에 먼저 올리고 DB 자산 경로를 조건부로 전환한다. DB 전환 실패 시 새 파일을 정리하고 기존 표시 이미지를 유지한다. 전환 성공 후 이전 파일 삭제가 실패하면 고아 파일이 남을 수 있어 운영 정리 대상이다.

## 평가 기준

실제 명함 약 20장에 ID, 촬영 조건, 사진 해시, 검수 필드 정답, 이미지 사용 권한을 붙인다. 같은 사진으로 OCR 제공자와 이미지 변형을 비교하고, 원본/복원본을 함께 검수한다. 결과는 오류 유형과 후보 순위의 파일럿 근거로만 사용한다. 추가 표본과 Android Chrome, iPhone Safari 실기기 반복 측정 전에는 p95 달성이나 상용 정확도를 주장하지 않는다. 개인정보 이미지·정답·OCR 원문은 저장소와 공유 Preview에 넣지 않는다.
