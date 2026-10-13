# 녹음 재생·STT 실패 재발 확인 및 PCM 녹음 전환

## 확인된 사실과 한계

- 사용자 화면의 `Unable to decode audio data`는 OpenAI API 이전의 `AudioContext.decodeAudioData` 실패다. 이 함수가 실패하면 전사용 WAV를 준비하지 못해 STT 버튼도 비활성화된다. 따라서 재생과 STT가 함께 막힌 공통 실패 지점은 저장된 녹음 파일의 해독 단계다.
- 이전 녹음 구현은 MediaRecorder.stop 직후 마이크 track을 종료했고, Blob 크기가 0보다 크면 음성 프레임 존재나 재생 가능 여부를 확인하지 않고 저장했다. 최종 데이터 이벤트보다 앞서 입력을 해제하는 순서와 인코딩된 파일에 대한 검증 부족을 확인했다.
- 같은 PC의 실제 마이크와 Edge에서 기존 WebM을 7초 녹음한 시험은 정상이었다: 121,989 bytes, WebM 헤더, 해독 길이 7.56초. 사용자가 실패한 파일의 바이트를 아직 제공받지 못했으므로 특정 브라우저/장치에서 그 파일이 왜 해독 불가능해졌는지는 확정하지 않는다. 종료 순서·코덱 문제를 확정된 원인으로 보고하지 않는다.
- 이전 샘플 주입 시험은 모든 사용자 브라우저/장치 조건을 입증하지 않는다. 이번 검증에는 실제 PC 마이크를 포함했다.

## 구현 변경

- 두 녹음 경로(기존 녹음 메뉴, AI 어시스턴트의 음성 입력)를 AudioWorklet의 실제 PCM 샘플 수집으로 통일했다.
- 16kHz mono PCM16 데이터를 모으고, 마지막 샘플 패킷과 종료 확인을 받은 뒤 길이가 완성된 WAV 헤더를 붙인다. 새 녹음의 재생/STT가 MediaRecorder의 WebM/Opus 파일 인코딩에 의존하지 않는다.
- 샘플이 하나도 들어오지 않으면 헤더만 있는 WAV를 저장하지 않는다. 시간 표시만 흐른 무효 녹음을 완료된 음성으로 취급하지 않는다.
- 마이크 해제는 최종 샘플 수집 이후 실행한다. 취소·화면 종료에서는 worklet/context를 폐기하고 마이크를 해제한다. 일시정지/재개, 파일 크기 상한과 녹음 시간 상한은 유지한다.
- 완료된 녹음 길이는 실제 샘플 개수/샘플레이트로 계산한다. 다운로드 확장자는 WAV로 제공한다.
- 기존 실패 파일의 해독 오류는 한국어로 안내한다. 기존 파일과 메모를 자동 삭제하거나 덮어쓰지 않는다. 음성 데이터가 없는 기존 파일은 이 변경으로 복구됐다고 주장하지 않는다.
- 서버 시작 스크립트는 실제 HTTP 준비 완료를 기다린 뒤 주소를 반환한다. 시작 직후 테스트가 다른 서버를 중복 실행하던 포트 경합도 방지한다.

## 검증 결과

- PCM 최종 패킷 수집/WAV 헤더/샘플 없는 녹음 거부 3개 + 기존 짧은 녹음 UI 4개: 7개 통과.
- 기존 녹음 전처리·결과 검토 테스트 6개 통과.
- 실제 공개 샘플을 마이크 입력에 공급한 Edge 시험 2개 통과: 두 녹음 화면의 재생·되감기, 실제 OpenAI HTTP 200, 인식 결과 검토·수정·메모 추가 및 새로고침 후 유지.
- 제품 연결 mock 브라우저 시험 2개 통과. 녹음은 실제 AudioWorklet/WAV 경로, STT 응답만 mock.
- 실제 PC 마이크 7초 시험: WAV 234,284 bytes, PCM 헤더, 해독 길이 7.32초. 실제 마이크의 음성 내용은 외부 API로 전송하지 않았다.
- 실제 PC 마이크의 1초·3초 추가 시험: 파일 해독·브라우저 재생·처음부터 다시 재생까지 확인. 수치 근거는 아래 JSON 참조.
- 실제 PC 마이크의 일시정지·재개 후 3초 시험도 통과: 해독 길이 3.08초, 재생·다시 재생 확인. 일시정지 시간은 저장 음성에 포함되지 않았다.
- 변경 파일 lint/format, 제품 타입 검사 및 분리 webpack production build 통과.

근거 파일(ignored output):

- `output/stt-integration/physical-mic-evidence.json`: 이전 WebM 기준 측정.
- `output/stt-integration/physical-mic-pcm-evidence.json`, `physical-mic-pcm-1s.json`, `physical-mic-pcm-3s.json`: PCM 이후 파일 크기/헤더/해독 길이. 음성 내용은 기록하지 않는다.
- `output/stt-integration/physical-mic-pcm-3s-pause.json`: 일시정지·재개 시험.
- `output/stt-integration/build-pcm-final.log`: 최종 빌드.

## 사용

http://127.0.0.1:3200/#recordings 에서 페이지를 새로고침하고 **새 녹음**을 만든다. 기존 실패 녹음은 그대로 보관되므로 새 파일로 먼저 확인한다. 녹음 마치기 → 재생 확인 → 텍스트로 변환 → 결과 검토 → 메모에 추가.

STT는 최대 60초. 녹음 메뉴 자체는 30분/50MiB 중 먼저 도달하는 조건으로 종료한다. PCM WAV는 압축 음성보다 커서 16kHz 기준 약 27분에 50MiB에 도달한다. HTTPS/localhost와 AudioWorklet 지원 브라우저가 필요하다.

## 참고 기준

[W3C MediaStream Recording](https://www.w3.org/TR/mediastream-recording/)의 비동기 stop/dataavailable 순서 및 전체 Blob 조합의 재생 가능성, [W3C Web Audio API](https://www.w3.org/TR/webaudio/)의 AudioWorklet 처리 모델을 참조했다. 명함 소스·공통 설정·명함 서버는 변경하지 않았다.
