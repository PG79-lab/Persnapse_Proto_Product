# 실시간 전사 테스트 환경

## 사용

**http://127.0.0.1:3200/#recordings**에서 새로고침한다. “말하는 동안 텍스트 표시”가 기본 켜져 있다.

1. 녹음 시작. 연결 준비 표시가 녹음 중으로 바뀌면 말한다.
2. 실시간 텍스트를 보면서 말한다.
3. 녹음 마치기. 최종 전사가 아래 메모에 자동 반영된다. 필요하면 메모를 직접 수정한다.

별도 “텍스트로 변환”·“결과 추가” 버튼을 누르지 않는다. 최대 100초이며 녹음 중 음성을 OpenAI로 전송한다. 기존 파일은 선택 후 기존 파일 전사 기능으로 변환한다. 실시간 표시를 끄면 기존 녹음만 하는 모드다.

## 동작

- 모델: 실시간 `gpt-live-transcribe`; 파일 `gpt-transcribe`.
- 시작 시 서버가 60초 유효한 임시 자격증명을 발급한다. 브라우저에 영구 API 키를 전달하지 않는다.
- AudioWorklet 24kHz PCM 샘플을 로컬 WAV와 WebSocket 전사에 함께 사용한다.
- 종료 시 WAV를 먼저 브라우저 IndexedDB에 보관하고 최종 전사까지 최대 25초 기다린다. 확정된 결과만 기존 메모에 추가한다.
- 녹음 중 수정한 메모는 유지한다. 합친 텍스트가 2,000자 상한을 넘으면 원문을 보관하고 검토 상태로 둔다.
- 연결 실패 시 WAV와 기존 메모를 유지하고 부분 텍스트를 최종 결과로 자동 반영하지 않는다. 파일 변환으로 다시 시도할 수 있다.
- 녹음과 녹음 초안은 이 브라우저에 보관된다. 2026-10-14부터 기존 인맥을 조회하고 선택한 인맥에 메모를 저장할 수 있다. Gateway는 workspace 메모 추가(note.add)만 허용하며 다른 변경·AI 요청은 차단한다.

## 검증

- 실제 임시 자격증명 API HTTP 200 및 gpt-live-transcribe 전사 세션 연결 확인.
- 라이프사이클·임시 자격증명 API 단위 테스트 7개 통과: 종료 전 delta, final 대체, 실패 시 부분 결과 미확정, 취소 후 늦은 결과 무시, 100ms 미만 입력, Origin 확인, 영구 키 미노출.
- 최종 브라우저 mock 4개 통과: 시작/종료만으로 자동 추가·녹음 중 메모 편집 보존, provider 실패 시 WAV 보관·부분 텍스트 미저장, 기존 파일 전사 화면 및 실제 Origin 확인.
- 실제 샘플 음성을 사용한 실시간 브라우저 시험 통과: 종료 전 텍스트 표시, 종료 후 자동 추가, 추가 클릭 없음, 새로고침 후 텍스트 유지와 녹음 재생.
- 최종 샘플 측정: 시작 클릭→첫 실제 텍스트 4,791ms(연결·마이크 준비 포함), 종료 클릭→최종 메모 반영 1,460ms. 연결 안내 문구를 모델 출력으로 오인하지 않도록 검증 조건을 실제 샘플 전사 문자로 수정해 재검증했다. 서비스 전체 지연 또는 한국어 정확도를 보장하는 수치는 아니다.
- 실시간 끈 기존 녹음·파일 STT, AI 어시스턴트의 음성 입력 실전 시험도 각각 통과했다.
- 설치된 Next 가이드 확인, 변경 파일 lint/typecheck 및 분리 webpack build 확인. 최종 환경 재검증 수치와 캡처는 아래 로그/이미지에 남긴다.

테스트 명령:

```powershell
cd D:\Persnapse\persnapse-mvp
node node_modules/@playwright/test/cli.js test --config=tests/stt-playwright.config.ts
node node_modules/@playwright/test/cli.js test --config=tests/stt-media-playwright.config.ts --grep "live text appears"
```

두 번째 명령은 공개 샘플 마이크 입력과 실제 OpenAI 호출을 포함한다. 테스트의 `firstTextFromStartClickMs`, `finalTextFromStopMs`는 특정 PC·네트워크·샘플 한 번의 측정이며 서비스 지연 보장은 아니다. 부분 전사는 최종 결과로 수정될 수 있다.

캡처: `test-results/stt-realtime-streaming.png`, `test-results/stt-realtime.png`. 빌드: `output/stt-integration/build-realtime-final.log`. 현재 snapshot은 `output/stt-integration/validation-path.txt`.

API 가이드의 delay 지원 설명과 reference의 지원 모델 설명이 달라 초기 delay는 생략했다. `delay=low` 발급 요청이 HTTP 200이었지만 실제 `session.created` 전사 설정에는 delay 필드가 없었다. 실제 지연 효과가 확인됐다고 주장하지 않는다.

## 작업 범위

`src/app/api/stt/realtime-session`, `src/features/speech/realtime-transcription.ts`, PCM 샘플 콜백, 기존 녹음 hook와 화면, STT 테스트 gateway를 수정했다. 명함 소스·명함 서버·공통 패키지/env 스키마는 변경하지 않았다. AI 어시스턴트의 “음성으로 입력”은 기존 종료 후 파일 전사 방식을 유지한다.

설계 근거: `docs/decisions/stt-live-transcription-2026-10-13.md`. 서버 시작·종료는 기존 `START_STT_TEST.cmd`, `STOP_STT_TEST.cmd` 사용. 코드/키 변경 후 분리 빌드 갱신은 `node scripts/stt/build-test.mjs`이며 명함 서버의 .next를 수정하지 않는다.

## 녹음 제한 연장

최대 녹음 및 파일 전사 시간을 100초로 변경했다. 100초 파일은 전사 전에 16kHz 모노 WAV로 준비되어 3,200,044바이트이며 기존 업로드 제한 이내다. 연결용 임시 자격증명의 60초 유효기간은 녹음 시간 제한과 별개이므로 유지한다. 100초 파일 준비 및 101초 거부 경계 테스트를 통과했다.

## 2026-10-14 버튼 활성화 수정

인맥 저장 불가의 확인된 원인은 테스트 gateway가 빈 인맥 목록을 반환하고 workspace POST를 차단하던 설정이었다. 실제 backend 조회는 정상이며 기존 인맥이 존재한다. 이제 기존 인맥 조회와 note.add 저장 요청을 전달한다. 인맥 선택 및 메모 내용은 저장에 필수다.

녹음 시작은 보관함 loading 상태에서 잠긴다. 새 브라우저에서 정상 활성화되어 사용자 브라우저의 정확한 지연 원인은 재현되지 않았다. IndexedDB 무응답에 대비해 8초 뒤 녹음을 허용하고 보관 불가 안내를 표시하며, 늦게 조회가 완료되면 기존 녹음 목록을 복원한다. 기존 녹음은 삭제하지 않는다.
