# 실시간 음성 텍스트 입력 테스트

## 결정

사용자 요청에 따라 녹음 메뉴 `/#recordings`를 **시작 → 말하는 동안 텍스트 표시 → 종료 시 최종 텍스트 자동 반영** 흐름으로 시험한다. 실시간 모드는 기본 켜짐, 최대 100초다. 녹음만 필요한 경우 실시간 표시를 끄고 기존 녹음을 사용할 수 있다.

## 모델과 연결

- 말하는 동안 텍스트를 제공하는 경로는 `gpt-live-transcribe` 사용. 기존 파일 전사용 `gpt-transcribe` 설정은 유지.
- 서버가 `/v1/realtime/client_secrets`로 60초 유효한 임시 자격증명을 발급한다. 영구 `OPENAI_API_KEY`는 서버에서만 사용한다.
- 브라우저 WebSocket 전사 세션에 24kHz mono PCM16을 스트리밍한다. 기존 AudioWorklet/WAV 기록 구조를 재사용해 동일한 마이크 샘플을 로컬 WAV 보관과 실시간 전사에 함께 사용한다.
- `turn_detection=null`로 녹음 하나를 한 발화로 처리한다. 사용자가 종료하면 마지막 샘플 이후 commit을 보내 최종 결과를 받는다. 녹음 중 partial delta와 종료 후 completed를 구분한다.
- API reference와 가이드에 delay 지원 설명 차이가 있어 초기 delay 옵션은 생략한다. 실제 발화로 지연/정확도 평가 후 설정한다.

## UX와 데이터

- 종료 시 별도 “텍스트로 변환”, “결과 추가” 클릭 없이 최종 전사를 메모에 추가한다. 기존 메모·녹음 중 편집을 유지한다. 외부 Person 메모 저장은 기존 별도 동작이다.
- WAV는 provider 확정 응답 전에 즉시 로컬 저장한다. 연결 실패 시 녹음 파일은 남기고, 부분 텍스트를 최종 결과처럼 자동 저장하지 않는다.
- 확정된 전사가 기존 메모와 합쳐 2,000자를 넘으면 원문을 별도로 유지하고 검토 상태로 둔다. 텍스트를 자르거나 기존 메모를 덮어쓰지 않는다.
- 확인된 세션 오류나 단절은 자동 재연결/중복 전사하지 않는다. 기존 파일 변환으로 다시 시도할 수 있다.
- 키/임시 token을 IndexedDB나 파일 로그에 보관하지 않는다. 기존 prototype-access 및 Origin/요청 헤더 확인을 적용한다. 사용자별 인증·과금 제한까지 갖춘 공개 서비스로 간주하지 않는다.

## 범위와 병행 작업

기존 녹음 메뉴와 STT 전용 파일을 수정한다. 명함 기능, 공통 package/lock/env 스키마, 명함 테스트 서버는 변경하지 않는다. AI 어시스턴트의 짧은 “음성으로 입력”은 기존 종료 후 파일 전사 흐름을 유지한다. 먼저 녹음 메뉴의 실시간 UX를 검증하는 vertical slice다.

## 근거

[OpenAI 실시간 전사 가이드](https://developers.openai.com/api/docs/guides/realtime-transcription), [클라이언트 임시 자격증명 API](https://developers.openai.com/api/reference/resources/realtime/subresources/client_secrets/methods/create), [브라우저 WebSocket 인증](https://developers.openai.com/api/docs/guides/realtime-websocket). 실제 임시 token 발급 HTTP 200과 `session.created`의 transcription/gpt-live-transcribe를 확인했다.
