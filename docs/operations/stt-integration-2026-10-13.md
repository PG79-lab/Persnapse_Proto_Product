# STT 제품 연결 및 테스트

## 현재 연결

제품 저장소: `D:\Persnapse\persnapse-mvp`. 임시 제공자는 OpenAI `gpt-transcribe`다.

통합 화면 `/#todos` → **기록 남기기** → **음성으로 입력** → **녹음 시작** → **녹음 끝내고 변환** → 결과 확인·수정 → **확인하고 입력에 추가** 순서로 사용한다. 기존 메모는 유지하며 자동 저장·검색은 하지 않는다. 마이크 사용은 HTTPS 또는 localhost에서 가능하다.

후속 수정: 기존 **녹음** 메뉴 `/#recordings`에서도 녹음 항목 선택 → **텍스트로 변환** → 결과 확인·수정 → **확인하고 메모에 추가**를 사용할 수 있다. 기존 녹음의 “자동 텍스트 변환 준비 중” 표시는 제거했다. 최대 60초 녹음을 WAV로 준비해 다시 듣기와 시간 탐색을 보완했다. 상세 내용은 `stt-recordings-fix-2026-10-13.md` 참조.

재발 후 보완: 새 녹음은 AudioWorklet에서 PCM을 직접 수집해 WAV로 저장한다. 사용자 오류의 확인 범위, 변경 및 실제 마이크 시험은 `stt-pcm-recording-2026-10-13.md`에 기록했다. 이전 실패 파일은 자동 삭제하거나 복구된 것으로 취급하지 않는다.

실시간 UX 시험: `/#recordings`의 새 녹음은 기본적으로 말하는 동안 텍스트를 표시하고 종료 시 메모에 자동 반영한다. `stt-realtime-test-2026-10-13.md` 참조. 기존 파일 변환·AI 어시스턴트 음성 입력은 별도 파일 전사 방식이다.

## 지금 테스트하는 주소

**http://127.0.0.1:3200/#todos**

3200은 STT 테스트 gateway, 3201은 분리된 제품 production build다. 빈 테스트 워크스페이스를 제공하고 STT만 실제 OpenAI로 연결한다. 제품의 DB/Storage 쓰기와 다른 AI API는 막혀 있으므로 “구조화하고 검토하기”는 이 테스트 서버에서 사용할 수 없다. 명함 테스트 3100/3101, 기존 STT 실험 8765와 별개다.

서버 실행/종료는 제품 루트의 `START_STT_TEST.cmd` / `STOP_STT_TEST.cmd`를 사용한다. 시작은 숨겨진 프로세스로 실행하며 종료는 저장된 PID·시작 시각·실행 명령이 일치하는 STT 서버와 소유한 backend만 대상으로 한다. 이미 사용 중인 포트의 다른 프로세스는 종료하지 않는다.

## 서버 설정

제품 `.env.local`의 `OPENAI_API_KEY`와 `OPENAI_TRANSCRIPTION_MODEL=gpt-transcribe` 사용. 키는 브라우저에 노출하지 않는다. 실험 서버 메모리의 키를 복사하지 않았다.

`AI_ROUTING_MODE=mock`이어도 STT 녹음 변환은 실제 OpenAI API를 호출한다. 다른 기능의 라우팅 모드는 변경하지 않았다. GET 상태의 configured는 키/모델 설정 확인이며 실제 키 유효성은 보장하지 않는다.

현재 제품 설정을 사용하는 공개 JFK 샘플 음성의 실제 호출은 HTTP 200 및 정상 텍스트 반환을 확인했다. 이는 한국어 정확도 평가를 대신하지 않는다. 샘플 출처는 기존 실험의 `D:\STT_ASR_Test\tests\jfk.wav`(whisper.cpp 공개 샘플)이며 DB 쓰기는 수행하지 않았다.

## 변경 파일

- 서버: `src/server/ai/openai-transcription-adapter.ts`, `src/app/api/stt/transcribe/route.ts` 및 테스트.
- 화면: `src/features/speech/voice-input.tsx` 및 테스트. 기존 `src/features/capture/text-capture-workspace.tsx`에는 import와 컴포넌트 연결만 추가.
- 브라우저 검증: `tests/e2e/stt-integration.spec.ts`, `tests/stt-playwright.config.ts`.
- 분리 서버 도구: `scripts/stt/*`, `START_STT_TEST.cmd`, `STOP_STT_TEST.cmd`.
- 결정: `docs/decisions/stt-openai-integration-2026-10-13.md`.

명함 소스, 공통 package/lock/config/env 스키마, 기존 서버 프로세스는 이 작업에서 변경하지 않았다. 다른 세션의 미커밋 변경은 유지한다. 기존 녹음 화면은 후속 수정에서 수동 STT를 연결했으며 장시간 자동 전사는 지원하지 않는다.

## 분리 빌드와 재시작

현재 복사본 경로는 `output/stt-integration/validation-path.txt`에 있다. 복사본은 빌드 당시 제품 코드·환경설정의 snapshot이며 이후 다른 세션 변경은 자동 반영하지 않는다. `.next`와 prebuild 출력은 복사본에서만 생성했다. PC 메모리 제약으로 단일 worker 및 webpack production build를 검증했다. 기본 Turbopack build는 이번 환경에서 완료하지 못했다.

제품 코드나 키 설정을 변경한 후 테스트 snapshot을 갱신할 때:

```powershell
cd D:\Persnapse\persnapse-mvp
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/stt/stop-test.ps1
node scripts/stt/build-test.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/stt/start-test.ps1
```

snapshot과 `.env.local` 복사본은 ignored output 아래 로컬에만 둔다. 외부 공유 대상은 소스와 문서이며 output 전체를 공유하지 않는다. 별도 빌드가 완료돼야 pointer를 갱신한다.

일반 제품의 개발/배포 빌드에도 새 STT API·화면이 포함된다. 메인 `.next` 재빌드/서버 재시작은 명함 작업 세션과 시점을 나눠 진행한다.

## 검증 기록

- STT API/adapter: 11개 테스트 통과. gateway의 외부 Host/Origin과 내부 서버 포트 차이도 검증.
- 녹음 UI: 4개 테스트 통과. 결과 확인 후 적용, 늦은 응답 무시, 취소 후 늦은 마이크 권한 해제, 길이 초과 시 결과 보존 포함.
- 최신 타입 검사 통과, STT 변경 파일 lint/format 검사 통과.
- 분리 webpack production build 통과. API route 생성 확인.
- 통합 화면 브라우저 E2E 2개 통과. 실제 gateway의 동일 Origin 업로드 검증, 녹음 중 수정한 메모 보존, 결과 수정·추가 및 모바일 overflow 확인. 녹음/전사 응답은 mock이며 실제 OpenAI 호출은 별도 샘플로 확인.
- 테스트 gateway GET 화면 HTTP 200, STT 설정 configured=true 확인.
- 전체 단위 테스트 49개 파일·273개 테스트 분할 실행 통과. 일괄 실행이 멈춰 4개 파일씩 분할 실행했으며 개별 batch 로그와 합본은 `output/stt-integration/unit-tests.log`에 기록했다. 최종 STT 전용 15개 테스트도 다시 통과.

## 다음 작업

1. 사용자가 한국어 이름·회사명·약속을 실제로 녹음해 정확도 평가. 필요 시 용어 힌트 및 한국어+영어 선택 비교.
2. 기존 제품 서버 재빌드 시점을 명함 작업과 분리해서 적용. 실제 사용자 데이터 저장까지의 흐름은 제품 워크스페이스에서 검증.
3. 장시간 녹음 전사, 사용자별 인증/요청 제한 및 비용 정책은 제품 사용 범위에 맞게 별도 설계.
