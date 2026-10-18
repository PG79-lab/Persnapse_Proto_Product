# Persnapse MVP 작업 규칙

## 작업 범위

- 이 저장소와 관련된 생성·수정·명령 실행은 원칙적으로 이 디렉터리 내부에서 수행한다.
- 상위 디렉터리와 다른 프로젝트는 명시적인 요청 없이 수정하지 않는다.
- 외부 자료가 필요하면 읽기 또는 참조만 하고, 가져온 내용과 출처를 기록한다.

## 단계적 진행

- 원본 자료를 분석하기 전에 제품 요구사항이나 기술 스택을 확정하지 않는다.
- 구현은 제품 범위와 기술 설계가 검토된 이후 시작한다.
- MVP 범위 밖의 기능은 임의로 추가하지 않고 별도 후보로 기록한다.

## 기록 원칙

- 원본 자료, 정제된 맥락, 확정된 결정과 실행 계획을 분리한다.
- 사실, 가정, 제안, 확정 사항, 미결정 사항을 구분해 기록한다.
- 중요한 결정은 `docs/decisions`에 근거와 영향까지 남긴다.
- 문서와 구현이 달라지면 같은 변경에서 문서를 갱신한다.

## 개발 원칙

- 단순한 MVP 구현을 우선하되 데이터 경계와 모듈 책임은 명확히 한다.
- 비밀정보와 개인 데이터는 저장소에 커밋하지 않는다.
- 검증 가능한 변경에는 적절한 자동화 테스트를 함께 둔다.
- 관련 없는 파일이나 사용자 변경 사항을 수정하지 않는다.
- 프론트 작업·검증 대상은 `/`의 통합 워크스페이스로 통일한다. 명함은 `/#cards`, 인맥은 `/#people`, 검색·기록은 `/#todos`의 AI 어시스턴트에서 작업한다. 기존 `/capture`, `/recall`, `/people` 주소는 호환 리다이렉트이며 독립 화면을 다시 만들지 않는다.

## 검증 명령

- 전체 기본 검증: `npm run verify`
- 단위 테스트: `npm test`
- 프로덕션 빌드: `npm run build`
- 브라우저 E2E: `npm run test:e2e`

큰 단계가 끝날 때마다 최소한 lint, typecheck, unit test와 production build를 실행한다.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
