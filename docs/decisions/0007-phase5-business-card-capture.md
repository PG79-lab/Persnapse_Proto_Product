# ADR 0007 — Phase 5 Business Card Capture와 Digital Card

- 상태: Accepted
- 결정일: 2026-09-15
- 적용 범위: Camera / Image → OCR → Context → Identity → Digital Card → Memory

## 맥락

Phase 4의 Text Capture는 검토 전 Draft 격리, 명시적 Identity 선택과 원자적 Memory Commit을 검증했다. Phase 5는 명함을 이 흐름의 빠른 시작점으로 연결한다. 명함 이미지는 OCR 후 버리는 임시 입력이 아니라, 실제 명함의 시각성과 출처를 유지하는 디지털 카드의 핵심 자산이다.

현재 단계에서는 유료 OCR API를 호출하지 않고 deterministic mock으로 전체 사용자 흐름과 교체 가능한 adapter 경계를 먼저 검증한다.

## 결정

### 이미지와 Digital Card

- 브라우저에서 카메라 촬영 또는 JPEG·PNG·WebP 업로드를 지원한다.
- 원본 이미지와 브라우저에서 방향·크기·대비·선명도를 보정한 display 이미지를 모두 private Storage에 저장한다.
- 생성형 super-resolution은 글자나 숫자를 만들어낼 위험 때문에 사용하지 않는다. display 보정은 최대 2배 확대와 장축 1960px 이내의 결정적 Canvas 처리만 사용한다.
- Digital Card의 기본 면은 보정된 실제 명함 이미지다. 구조화된 이름·소속·전화·이메일·웹사이트는 별도 정보 면과 클릭 가능한 동작으로 제공한다.
- 원본·display asset은 Workspace 소유권과 SHA-256, MIME, 크기, 픽셀 크기, 처리 recipe를 가진다. 공개 URL을 만들지 않고 Workspace를 확인하는 서버 route로 전달한다.
- 사용자는 원본만 삭제할 수 있다. Digital Card에 필요한 display 이미지는 유지되며 삭제 사실은 메타데이터에 남는다.

### Capture와 OCR

- 한 Capture Session은 한 장의 명함만 나타낸다.
- `business-card-draft-v1`은 연락처와 관계 Context를 함께 검증한다.
- mock OCR와 추후 CLOVA / Google adapter는 같은 extraction schema를 반환한다.
- mock 결과임을 UI에 명시하고 모든 필드는 사용자가 수정할 수 있게 한다.
- OCR 실패는 같은 Capture에서 재시도하며 Person을 생성하거나 자동 연결하지 않는다.
- OCR 완료 후 사용자가 Context를 입력하면 기존 deterministic structurer로 Interaction·Topic·Memory·Action Draft를 만들고 `review`로 전환한다.

### Identity와 Commit

- 정규화된 이메일·전화의 정확 일치, 이름과 소속을 후보 신호로 사용한다.
- 강한 단일 후보도 자동 선택하거나 병합하지 않는다.
- 사용자 확인 시 Person, Organization, Affiliation, 연락처, Interaction, Memory, Action, provenance와 Digital Card를 하나의 DB transaction에서 확정한다.
- Storage 업로드는 DB transaction 밖의 외부 작업이므로 실패 시 생성한 object를 보상 삭제한다. canonical commit 전 asset은 Draft 전용이며 Recall에 나타나지 않는다.

### 다중 명함

- 한 번에 최대 5개 파일을 선택하거나 카메라로 연속 추가할 수 있다.
- 각 명함은 독립 Capture Session이며 순차 처리한다. 한 장의 실패가 다른 명함을 막지 않는다.
- 한 사진 안의 여러 명함을 자동 분할하는 기능은 segmentation과 필드 혼합 위험 때문에 후속 확장으로 둔다.

### 성능 기준

- live OCR의 UX 목표는 사용자가 사진 사용을 확정한 시점부터 수정 가능한 Digital Card가 나타날 때까지 p50 3초 이하, p95 5초 이하다.
- mock 단계에서도 동일 구간을 계측하며 Provider 보장값으로 표현하지 않는다.
- 5초가 넘으면 지연 안내, 12초에는 timeout과 같은 Capture 재시도를 제공한다.

## 검증 게이트

- 카메라 권한 허용·거부와 업로드 fallback
- 파일 MIME·magic bytes·크기 validation
- 원본 디자인을 유지한 display 이미지와 정보 면 전환
- 최대 5개 독립 순차 Capture
- mock OCR → Context → explicit Identity → atomic Commit → Profile / Recall
- contact exact-match가 자동 병합으로 이어지지 않음
- commit 재시도 멱등성과 Draft의 Recall 비노출
- 원본 삭제 후 display Digital Card 유지

## 후속 live 단계

Phase 5 mock 게이트 통과 후 CLOVA Business Card OCR invoke URL과 secret을 연결한다. Google Cloud Vision은 raw text fallback으로 두며 별도 structuring adapter를 거친다. 실제 명함 fixture로 정확도, correction count와 3–5초 latency를 다시 측정한다.

## Live OCR 확장 — 2026-09-16

- 명함 OCR은 전역 AI 모드와 분리된 `BUSINESS_CARD_OCR_MODE`로 전환한다. 이 값이 `live`여도 Context 구조화 등 다른 task는 기존 `AI_ROUTING_MODE`를 따른다.
- 서버만 `CLOVA_OCR_INVOKE_URL`과 `CLOVA_OCR_SECRET`을 읽고 브라우저에는 전달하지 않는다.
- CLOVA Document OCR의 `nameCard.result`가 제공되면 구조화된 필드를 우선 사용한다.
- 현재 활성화된 General OCR `/general` 도메인도 지원한다. 이 경우 V2 `fields`의 읽기 순서를 복원하고 이메일·전화·웹사이트와 이름·소속·직책·부서·주소를 결정적으로 정규화한다.
- Provider 응답 원문과 OCR 텍스트는 로그·AI Run metadata에 저장하지 않는다. Persnapse에는 strict extraction Draft, provider, latency와 provenance만 남긴다.
- API 오류는 인증·설정·timeout·rate limit·인식 실패로 구분하고 같은 Capture에서 재시도한다.
- live 자동 검증에는 합성 명함만 사용하며 성공·실패 후 DB와 Storage 잔여물이 0인지 확인한다.
