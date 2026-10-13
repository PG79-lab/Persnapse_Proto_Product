# OpenAI STT 임시 채택

## 결정

사용자 요청에 따라 OpenAI `gpt-transcribe`를 임시 채택한다. 한국어 중심의 짧은 녹음 후 결과 확인·수정을 제공한다. 정확도 비교 승자를 확정한 결정은 아니다. 소음 개선과 파인튜닝은 이번 범위에서 제외한다.

## 구현 경계

- 통합 워크스페이스 `/#todos` → AI 어시스턴트 → 기록 남기기에 음성 입력을 추가한다.
- 제품 서버가 OpenAI transcription API를 직접 호출한다. `D:\STT_ASR_Test` 서버에 의존하지 않는다.
- 기존 `OPENAI_API_KEY`, `OPENAI_TRANSCRIPTION_MODEL=gpt-transcribe` 설정을 재사용한다.
- 다른 기능의 `AI_ROUTING_MODE=mock`을 유지해도 사용자가 명시적으로 녹음 변환을 요청하면 STT는 실제 OpenAI를 호출한다. 자동 대체 모델은 사용하지 않는다.
- 결과는 별도 편집 영역에서 확인 후 기존 입력에 추가한다. 구조화·저장 요청은 기존 버튼으로 사용자가 따로 실행한다.
- 원본 녹음은 서버 DB/Storage에 저장하지 않는다. 브라우저 메모리의 다시 듣기 URL은 교체·화면 종료 시 해제한다.
- 기존 명함 기능, 모델 라우팅, 환경변수 스키마, 패키지 설정은 수정하지 않는다. 2026-10-13 후속 수정으로 기존 `/#recordings`에도 선택한 녹음의 수동 STT를 연결한다. 변환 대상은 최대 60초이며 장시간 녹음의 자동 전사는 이번 범위가 아니다.

## API 및 제한

`GET /api/stt/transcribe`는 키/모델 설정 여부만 반환하며 키 검증 또는 과금 호출은 하지 않는다.

`POST /api/stt/transcribe`는 multipart `audio`, `language`(ko/ko-en/auto), `hints`(쉼표 또는 줄바꿈 구분)를 받는다. 동일 Origin 및 `X-Persnapse-STT: 1`을 확인하고 기존 prototype-access 정책을 따른다. 이 정책은 사용자 인증을 대신하지 않는다.

성공: `{ text, provider: "openai", model: "gpt-transcribe" }`. 오류: `{ error, code }` 및 400/403/413/422/429/502/503/504 상태. 응답은 no-store. 제공자 원문 오류와 키는 반환하지 않는다.

브라우저 녹음은 60초, 파일은 3.9MB, 전체 HTTP body는 4MB 상한이다. 길이 제한은 녹음 UI 정책이며 임의 파일의 실제 재생 길이를 서버에서 분석하지는 않는다. WebM/MP4를 녹음에 사용하며 OGG는 지원하지 않는다. 용어는 30개·각 100자 이내, `<`와 `>` 제외. 요청 시간이 초과되거나 취소·화면 종료 후 도착한 결과는 적용하지 않는다. 취소가 이미 처리 중인 제공자의 과금까지 취소한다는 보장은 없다.

## 근거

실험 코드와 API 계약: `D:\STT_ASR_Test\app.py`, `OPENAI_INTEGRATION.md`.

[OpenAI 공식 파일 전사 문서](https://developers.openai.com/api/docs/guides/speech-to-text): `gpt-transcribe`의 `languages[]` 및 `keywords[]` multipart 필드 사용. 음성 인식 문맥은 정확도를 보장하지 않으며 사용자가 실제 발화로 평가해야 한다.

## 병행 작업

제품 작업 트리에 기존 미커밋 변경이 있어 신규 STT 파일 위주로 구현한다. 공통 화면은 `text-capture-workspace.tsx`에 import와 연결만 추가한다. 빌드는 별도 ignored output 복사본에서 수행하며 기존 명함 테스트 서버와 .next를 재시작·교체하지 않는다. 검증 결과와 실행 방법은 `docs/operations/stt-integration-2026-10-13.md`에 기록한다.
