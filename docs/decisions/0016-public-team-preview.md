# 0016. 팀 테스트용 통합 Preview의 로그인 없는 접속

- 날짜: 2026-10-08
- 근거: 사용자가 팀원이 로그인 없이 접속하여 사용할 수 있도록 명시적으로 요청했다.
- 대상: https://persnapse-htb5dz6hx-choeseyong180-8216.vercel.app/
- Deployment: `dpl_J8CfSBoZqbz49ojGoe75F271AQ1v`

## 결정 및 적용

프로젝트의 Vercel Authentication `deploymentType=all`은 유지하고, 위 배포 URL에만 Deployment Protection Exception을 적용했다. 앱 코드, 공유 workspace, 서버 환경변수와 OCR 모델은 변경하지 않았다.

Vercel 공식 OpenAPI의 `PATCH /aliases/{id}/protection-bypass`에 대상 deployment ID와 teamId를 지정하고 다음 요청을 적용했다.

```json
{ "override": { "scope": "alias-protection-override", "action": "create" } }
```

되돌릴 때는 같은 대상에 `action=revoke`를 사용한다. 새 배포 주소는 이 예외를 자동 상속하지 않으므로, 팀 공유 시 새 주소에 대한 공개 여부를 별도로 확인한다. 기존 배포 보호 확인 스크립트는 프로젝트 기본 정책을 확인하며, 특정 도메인의 예외 유무까지 보장하지는 않는다.

## 영향 및 검증

- 이 링크는 팀원 전용 인증 경계가 아니다. 링크로 접속한 누구나 공유 데이터와 활성화된 AI/OCR 기능을 사용할 수 있다. 기존 호출 제한은 유지한다.
- 인증 헤더·쿠키 없이 `/`, `/api/workspace`, `/api/recall/preparation` 모두 HTTP 200.
- 서버 저장, live AI/OCR 설정 및 인맥 16명·만남 20개·업무 10개 확인. 검색 준비 16/16.
- 새 Edge 브라우저 컨텍스트에서 로그인 이동 없이 앱 표시, 페이지 JavaScript 오류 0건.
- 이전 통합 배포 `persnapse-lm5uhrinz-choeseyong180-8216.vercel.app`는 비인증 HTTP 302 유지.
- 이번 변경 검증에서는 데이터 쓰기나 유료 모델 호출을 추가로 실행하지 않았다. OCR 실호출 검증은 직전 배포 검증 기록을 따른다.
- 재현: `npm run deploy:verify:workspace -- --deployment=https://persnapse-htb5dz6hx-choeseyong180-8216.vercel.app --public-access`
- 결과: `test-results/workspace-public-preview-verification.json`

## 출처

- [Vercel Deployment Protection Exceptions](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/deployment-protection-exceptions)
- [Vercel URL Protection Bypass API](https://vercel.com/docs/rest-api/aliases/update-the-protection-bypass-for-a-url)
- [Vercel 공식 OpenAPI 스키마](https://openapi.vercel.sh)
