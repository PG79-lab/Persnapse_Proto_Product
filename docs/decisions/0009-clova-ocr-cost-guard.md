# ADR 0009 — CLOVA OCR 비용·중복 호출 방어

- 상태: 앱 계층 적용 완료 / 제공자 hard quota 검증 대기
- 결정일: 2026-09-20
- 적용 범위: Phase 5 Business Card OCR

## 배경

CLOVA OCR은 호출량에 따라 비용이 증가한다. Vercel Serverless의 단일 프로세스 메모리 limiter는 인스턴스 사이에서 공유되지 않아 최종 방어선으로 사용할 수 없다. 또한 브라우저 이중 클릭, 응답 유실 후 재전송, 같은 이미지의 반복 업로드와 retry API 직접 호출이 별도 방어 없이 유료 호출로 이어질 수 있었다.

## 결정

- PostgreSQL `public.ocr_provider_calls`를 credential 단위 비용 원장으로 사용한다.
- provider scope에 대한 PostgreSQL transaction advisory lock으로 모든 서버리스 인스턴스의 예약을 직렬화한다.
- 앱 hard limit은 CLOVA Business Card OCR 전체에 대해 1 request/second, 100 requests/day, 1,000 requests/month이다. 일·월 경계는 `Asia/Seoul` 기준이다.
- 예약된 호출도 예산에서 차감하는 보수적 정책을 사용한다. provider 호출을 시작한 시각은 별도 필드로 기록한다.
- limiter DB가 실패하면 provider를 호출하지 않는 fail-closed 정책을 사용한다.
- OCR adapter는 DB 예약을 `started`로 전환한 뒤에만 네트워크 요청을 시작한다.
- 성공한 OCR Draft 저장과 비용 원장의 `succeeded` 전환은 한 DB transaction으로 처리한다.
- 같은 workspace의 동일 display image SHA-256에 성공한 CLOVA 결과가 있으면 identity extraction만 재사용하고, 만남 시각은 현재 Capture 기준으로 다시 만든다. Naver를 재호출하지 않는다.
- 재시도 API는 `failed` Capture에만 허용한다. UI는 처리 중 이중 제출을 ref로 차단하며, 최초 업로드의 idempotency key는 네트워크 재시도에서도 재사용한다.
- 서버는 JPEG/PNG signature와 MIME을 함께 확인하고, 파일별/합계/HTTP 요청 크기를 제한한다.
- 내부 provider 상태 코드와 응답 본문은 클라이언트 오류에 그대로 전달하지 않는다.

## 데이터 경계

비용 원장은 workspace/capture ID, provider scope, 요청 UUID, 이미지 SHA-256, 상태, 시각과 정규화된 오류 코드만 저장한다. 이미지 바이트, CLOVA Secret, Invoke URL, OCR 원문은 저장하지 않는다. 구조화된 명함 정보는 기존 `business_card_drafts` 경계에만 남는다.

`ocr_provider_calls`는 RLS를 활성화하고 `anon`과 `authenticated` 권한을 모두 회수한다. 기존 행 삭제, `DROP`, `TRUNCATE`는 마이그레이션에 포함하지 않는다.

## 제공자 hard quota

Naver API Gateway의 실제 Product/API/Stage와 Usage Plan은 콘솔에서 별도로 검증해야 한다. 앱 limiter는 방어의 한 계층이며 provider hard quota를 대신하지 않는다. 실제 Stage 적용을 확인하기 전에는 전체 비용 방어를 완료로 간주하지 않는다.

## 결과

- 여러 Vercel 인스턴스에서도 동일한 상한을 적용한다.
- 제한·중복·limiter 장애는 CLOVA 네트워크 호출 전에 차단된다.
- 외부 provider가 요청을 수신한 이후 응답 전달 전에 프로세스가 종료되는 극단적 구간은 완전한 exactly-once를 보장할 수 없다. 예약 예산 차감과 동일 이미지 재사용으로 재과금 가능성을 최소화한다.
