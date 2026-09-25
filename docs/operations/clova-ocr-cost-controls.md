# CLOVA OCR 비용·보안 운영 가이드

> 2026-09-22 후속 변경: 사용자 승인으로 앱 일/월 누적 한도를 제거하고 단기 대량 호출 방어로 전환했다. [최신 정책·가능 횟수](user-test-capacity-2026-09-22.md)를 우선한다. 아래 이전 누적 한도 수치는 당시 기록이다.

## 현재 상태

| 계층                         | 상태              | 설정                                 |
| ---------------------------- | ----------------- | ------------------------------------ |
| Persnapse 앱                 | 완료·DB 검증 완료 | 1 req/s, 100/day, 1,000/month        |
| Naver API Gateway hard quota | 미검증            | 실제 OCR Stage에서 확인 필요         |
| Cost Explorer 예산·알림      | 미검증            | 요금제·단가 확인 후 사용자 결정 필요 |

2026-09-20 점검에서는 Windows UI 도우미의 ACL 오류 때문에 Naver 콘솔을 직접 열 수 없었다. 제공자 계층은 완료로 표시하지 않는다.

## 앱 계층 동작

- `public.ocr_provider_calls`와 PostgreSQL advisory lock이 credential 전체 호출을 직렬화한다.
- 제한 초과는 provider 호출 전에 HTTP 429와 `Retry-After`로 응답한다.
- limiter 저장소가 동작하지 않으면 HTTP 503으로 실패하고 CLOVA를 호출하지 않는다.
- 동일 workspace·동일 이미지 SHA-256의 성공 결과는 기존 model Draft에서 재사용한다.
- retry endpoint는 실패 상태의 Capture와 새로운 request UUID를 모두 요구한다.
- 자동 provider retry는 사용하지 않는다. Business Card OCR은 route당 최대 1회만 시도한다.
- adapter timeout은 12초다.
- 업로드는 JPEG/PNG만 허용한다. 각 파일 signature와 선언 MIME이 일치해야 한다.
- 원본은 2.3 MB 이하, 표시용은 1.5 MB 이하, 두 파일 합계는 4 MiB 미만이어야 한다.
- HTTP `Content-Length`가 4,400,000 bytes를 넘으면 multipart parsing 전에 413을 반환한다. 이는 Vercel Function의 4.5 MB request limit보다 낮다.

검증 명령:

```powershell
npm run db:verify:ocr-guard
```

이 명령은 미래 시각의 격리된 fixture로 분산 예약, 동일 이미지 차단, 1 req/s, 100/day, 1,000/month를 검증한 뒤 생성 행을 모두 삭제한다. CLOVA API는 호출하지 않는다.

현재 일·월 예약 수와 provider network request 시작 수는 개인정보 없이 확인할 수 있다.

```powershell
npm run db:report:ocr-usage
```

## Naver API Gateway hard quota 확인 절차

공식 문서:

- Usage Plans: https://guide.ncloud-docs.com/docs/en/apigw-apigw-2-3
- My Products / Stage Usage Plans: https://guide.ncloud-docs.com/docs/apigw-myproducts
- CLOVA OCR API Gateway 연동: https://guide.ncloud-docs.com/docs/en/clovaocr-domain

1. NAVER Cloud Platform 콘솔에서 **AI Services → CLOVA OCR → Domain**을 연다.
2. 현재 Persnapse에서 사용하는 domain의 API Gateway 연동 정보를 연다. Invoke URL이나 Secret 전체 값을 화면 공유·로그·문서에 복사하지 않는다.
3. **Application Services → API Gateway → My Products**로 이동한다.
4. 자동 연동이면 일반적으로 생성되는 `OCR_CUSTOM_API_KR` Product를 찾는다. 수동 연동이면 해당 domain과 연결한 Product를 선택한다.
5. Product의 **API → Stages**에서 OCR domain endpoint로 연결된 실제 Stage를 식별한다. 이름만 같고 연결되지 않은 Stage를 수정하지 않는다.
6. Stage의 **Usage Plans** 탭에서 Default Usage Plan 또는 연결된 별도 Usage Plan의 실제 적용 대상을 확인한다.
7. 기존 값이 아래보다 엄격하면 유지한다. 더 느슨하면 다음 값으로 낮춘다.
   - Request rate: 1 request/second
   - Daily quota: 100 requests/day
   - Monthly quota: 1,000 requests/month
8. 저장 후 Stage 상세 화면에서 값과 연결 상태를 다시 연다. Usage Plan 목록에 존재하는 것만으로는 충분하지 않고 해당 OCR Stage에 연결되어 있어야 한다.
9. API Gateway dashboard의 해당 Stage 호출량과 CLOVA OCR 사용량을 함께 확인한다.

### API Key 주의

Naver API Gateway 문서는 method의 **API Key 필요** 설정이 켜져 있어야 Usage Plan이 적용된다고 명시한다. 현재 Persnapse adapter는 OCR 자동 연동의 `X-OCR-SECRET`만 전송한다. 다음을 확인하기 전에는 API Key 필요 설정을 켜거나 새 API Key를 만들지 않는다.

- 자동 연동 OCR Stage에서 Default Usage Plan이 API Key 없이도 적용되는 별도 정책이 있는지
- API Key 필요를 켰을 때 기존 `X-OCR-SECRET` 호출이 그대로 성공하는지
- 추가 `x-ncp-apigw-api-key`가 필요하다면 기존 인증 흐름을 바꾸어도 되는지

이 조건을 충족하지 못하면 provider hard quota는 미완료로 유지한다. 인증 방식을 임의로 변경해 OCR 연결을 깨뜨리지 않는다.

## Cost Explorer 예산·알림

공식 문서: https://guide.ncloud-docs.com/docs/en/costexplorer-budget

1. 먼저 CLOVA OCR domain의 서비스 요금제와 실제 단가를 확인한다.
2. **Management & Governance → Cost Explorer → Budgets**에서 CLOVA OCR과 API Gateway 청구 항목을 각각 식별한다.
3. 현재 테스트량과 단가로 월 최대 예상액을 계산한 뒤 예산액과 수신자를 사용자와 확정한다.
4. 낮은 비율부터 여러 알림 조건을 두되 계정의 다른 서비스가 같은 billing item group에 포함되는지 확인한다.

Cost Explorer 알림은 전날 비용 데이터를 기준으로 발송될 수 있으므로 실시간 차단 장치가 아니다. provider hard quota와 앱 limiter를 대체하지 않는다.

## 운영 시 확인할 수치

Secret이나 개인정보 없이 현재 월 예약·시작·성공 수를 확인한다.

```sql
select
  count(*) as reserved,
  count(provider_request_started_at) as provider_requests_started,
  count(*) filter (where status = 'succeeded') as succeeded,
  count(*) filter (where status = 'failed') as failed
from public.ocr_provider_calls
where provider_scope = 'naver_clova:business-card-extraction-v1'
  and reserved_at >= date_trunc('month', now());
```

`provider_requests_started`는 앱이 실제 network fetch 직전에 기록한 수치다. 네트워크 단절 시 Naver가 요청을 수신했는지까지 증명하지는 않으므로, 최종 과금 수치는 Naver dashboard/Cost Explorer와 대조한다.

## 비밀정보·개인정보 원칙

- `CLOVA_OCR_SECRET`, 전체 Invoke URL, Supabase server key와 `DATABASE_URL`을 출력하거나 로그에 남기지 않는다.
- OCR 이미지·인식 텍스트·provider 응답 원문을 로그에 남기지 않는다.
- CLOVA 환경변수는 `NEXT_PUBLIC_` 접두사를 사용하지 않고 `server-only` 모듈에서만 읽는다.
- 오류 응답에는 공개 오류 코드와 사용자 행동만 포함한다.
