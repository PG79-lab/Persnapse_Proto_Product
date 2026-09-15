# Live AI API Verification

이 문서는 Phase 4 전에 task별 모델 credential, 접근 권한과 최소 응답 계약을 합성 데이터로 확인하는 절차다.

## 안전 경계

- `.env.local`은 Git에서 제외하며 키 값을 출력하거나 결과 파일에 저장하지 않는다.
- 앱의 기본 `AI_ROUTING_MODE=mock`과 별개로 이 명령만 명시적으로 live route를 해석한다.
- 입력은 고정된 합성 인물과 맥락만 사용한다.
- 원문 응답은 기록하지 않고 모델, 지연시간, token, vector 차원, 정제된 오류만 출력한다.
- 호출 비용이 발생할 수 있으므로 CI나 일반 `npm run verify`에는 포함하지 않는다.
- HTTP 429, 5xx, timeout과 network error만 최대 1회 재시도한다.
- 실패 시 지정 모델을 다른 모델로 자동 대체하지 않는다.

## 실행

전체 최소 검증:

```bash
npm run ai:verify:live
```

단일 케이스 재검증:

```bash
npm run ai:verify:live -- --only=google-structured-output
```

지원하는 `--only` 값:

| 값                          | 확인 계약                                     |
| --------------------------- | --------------------------------------------- |
| `openai-structured-output`  | 정보 구조화 primary의 strict JSON schema 출력 |
| `openai-embedding-fallback` | embedding fallback의 1024차원 finite vector   |
| `voyage-embedding-primary`  | embedding primary의 1024차원 finite vector    |
| `voyage-rerank-primary`     | 관련 합성 문서가 1위가 되는지                 |
| `google-structured-output`  | Main Agent primary의 JSON schema 출력         |

성공한 실행은 exit code 0, 하나라도 실패한 실행은 exit code 1을 반환한다.

## 환경변수

검증기는 기존 task router가 해석하는 아래 설정을 그대로 사용한다.

- `OPENAI_API_KEY`
- `VOYAGE_API_KEY`
- `GOOGLE_GENERATIVE_AI_API_KEY`
- `OPENAI_STRUCTURING_MODEL`
- `OPENAI_EMBEDDING_FALLBACK_MODEL`
- `VOYAGE_EMBEDDING_MODEL`
- `VOYAGE_RERANK_MODEL`
- `GOOGLE_MAIN_AGENT_MODEL`

키를 바꾸거나 노출이 의심되면 Provider 콘솔에서 기존 키를 폐기하고 새 키를 발급한다.

## 범위

이 검증은 Provider endpoint와 모델별 최소 입출력 계약을 확인한다. Phase 4의 production adapter, Capture별 `ai_runs` 기록, fallback 실행과 사용자 오류 표시는 별도 구현 범위다.
