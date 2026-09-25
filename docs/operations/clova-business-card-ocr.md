# CLOVA Business Card OCR 운영 가이드

## 로컬 설정

`.env.local`에 아래 서버 전용 값을 둔다.

```dotenv
BUSINESS_CARD_OCR_MODE=live
CLOVA_OCR_INVOKE_URL=...
CLOVA_OCR_SECRET=...
```

`AI_ROUTING_MODE`과 `BUSINESS_CARD_OCR_MODE`은 독립적이다. 명함 OCR만 실제 호출하려면 전자는 `mock`, 후자는 `live`로 유지한다. 환경변수를 바꾼 뒤에는 Next.js 서버를 재시작한다.

## 지원하는 CLOVA 도메인

- Business Card Document OCR: URL이 `/document/name-card`로 끝나며 `nameCard.result`를 사용한다.
- General OCR: URL이 `/general`로 끝나며 V2 `fields`를 명함 Draft로 결정적으로 정규화한다.

현재 Naver 도메인에서 Document OCR 요청이 `0022 Request domain invalid`를 반환하면 General OCR URL을 그대로 사용한다. Document OCR 기능을 별도로 활성화한 뒤 발급한 URL도 코드 변경 없이 사용할 수 있다.

## 검증

다음 명령은 합성 명함 한 장을 실제 CLOVA API로 보내므로 호출 비용이 발생할 수 있다.

```powershell
npm run ai:verify:clova
```

다음 명령은 합성 명함으로 private Storage, OCR, Draft, Context, Identity, atomic Commit, 원본 삭제와 cleanup을 함께 검증한다.

```powershell
npm run db:verify:phase5:live
```

기본 `npm run db:verify:phase5`는 실제 API를 호출하지 않는 deterministic Mock 검증이다.

## 데이터와 보안

- Secret과 Invoke URL은 서버에서만 사용한다.
- OCR 응답 원문과 인식 텍스트를 로그에 출력하지 않는다.
- 과도한 호출, 동일 이미지 중복 과금, 일·월 한도와 provider hard quota 운영 절차는 `docs/operations/clova-ocr-cost-controls.md`를 따른다.
- 검증 출력은 필드 존재 여부, 개수, provider와 latency만 포함한다.
- live 검증이 생성한 DB 행과 Storage 객체는 정확한 Capture ID 범위로 정리하고 잔여 개수 0을 확인한다.
- 실제 팀 명함을 테스트할 때는 관계자의 동의를 확인하고, 완료 후 Draft 삭제 또는 원본 삭제 기능을 사용한다.
