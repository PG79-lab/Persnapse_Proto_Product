# ADR 0008 — Protected Vercel Preview Deployment

Status: Accepted

Date: 2026-09-16

## Context

The MVP must be usable from real mobile devices before later product work can be evaluated. Camera access requires a secure browser context, while the current application has no user authentication and operates against one shared prototype workspace.

Vercel Functions reject request bodies above 4.5 MB. The Phase 5 card flow previously allowed a 10 MiB original plus a 5 MiB display image in one request, so a normal phone photo could work locally and fail only after deployment.

## Decision

- Deploy the current working tree as a Vercel Preview, not as the public production domain.
- Refuse the deploy wrapper unless the linked project is confirmed to have
  deployment history. Vercel documents that a new project's first deployment is
  Production even without `--prod`; a Production bootstrap requires a separate
  reviewed decision.
- Require Vercel Authentication before enabling remote application access.
- Keep `APP_REMOTE_PROTOTYPE_ACCESS=off` by default.
- Permit remote requests only when all of the following are true:
  - `APP_REMOTE_PROTOTYPE_ACCESS=vercel_preview`
  - Vercel sets `VERCEL=1`
  - Vercel sets `VERCEL_ENV=preview`
  - the request host ends in `.vercel.app`
- Apply the same policy in the global Next.js Proxy and in sensitive business-card API routes.
- Resize and encode both uploaded card variants in the browser, keeping their combined bytes below 4 MiB before multipart overhead.
- Keep general AI routing mocked in Preview and enable only `BUSINESS_CARD_OCR_MODE=live` for the current Clova experience.
- Synchronize only the explicitly allowlisted Preview variables; do not upload `.env.local` wholesale.
- Require an explicit confirmation bound to the reviewed Vercel `projectId` before uploading any secret.
- Authenticate through a standalone system browser and keep Codex/ChatGPT passkey access disabled because deployment does not require it.
- Treat Vercel as a server-secret trust boundary; prefer Preview-only Supabase and Clova credentials when they are available.

## Consequences

- HTTPS enables mobile camera capture on the generated Preview domain.
- A production alias or custom domain remains intentionally unusable until an authenticated product boundary is designed.
- A newly created, deployment-empty Vercel project cannot be used by this
  Preview-only runbook until the first-deployment policy is resolved explicitly.
- Disabling Vercel Authentication does not silently expose an `off` deployment, but a Preview with remote access enabled still relies on the platform protection setting. Protection must be checked after every project-level security change.
- Stored team test cards remain in the shared workspace until explicitly deleted. Automated deployment checks must use synthetic data and clean it up.
- Local Next.js/Turbopack caches can contain copies of loaded server environment values. They remain ignored and excluded from deployment, and must be cleaned and audited before sharing or deployment.

## References

- https://vercel.com/docs/deployment-protection
- https://vercel.com/changelog/protect-production-deployments-for-free-on-every-plan
- https://vercel.com/docs/errors/function_payload_too_large
