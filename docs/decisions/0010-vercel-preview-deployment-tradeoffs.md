# ADR 0010 — Vercel Preview Deployment Safety Tradeoffs

Status: Accepted

Date: 2026-09-20

## Goal

Make the Persnapse MVP available on real mobile devices over HTTPS while keeping
the unauthenticated, single-workspace prototype and its server credentials out of
public access.

## Accepted decisions and tradeoffs

| Decision                                                                          | Benefit                                                                                                   | Cost or residual risk                                                                                                     | Mitigation / exit plan                                                                                                                                                |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Use Vercel Authentication with **All Deployments**                                | Preview and bootstrap Production URLs require a permitted Vercel account                                  | Testers must sign in; access depends on Vercel membership                                                                 | Keep membership minimal; do not create Shareable Links or bypass tokens                                                                                               |
| Create one secret-free static Production bootstrap after enabling All Deployments | Satisfies Vercel's first-deployment behavior so the actual MVP can be deployed as Preview                 | A Production deployment record and production alias exist even though this phase is Preview-only                          | Bootstrap contains no app, DB, OCR, or secret; verify protection before deploying it and never promote the MVP Preview                                                |
| Reuse current development Supabase and Clova credentials in Preview               | Fastest path to testing the complete camera → OCR → review → save flow                                    | Preview and local development share a data/provider trust boundary; Vercel becomes a secret holder                        | Store server values as write-only Preview Secrets, restrict project access, use team-only cards, clean test data, migrate to dedicated Preview credentials later      |
| Keep general AI routing mocked and enable only Clova OCR live                     | Limits cost and isolates the feature currently being evaluated                                            | Full multi-model behavior is not represented                                                                              | Set `AI_ROUTING_MODE=mock`; upload no OpenAI, Voyage, Google, Anthropic, Mistral, Together, or Fireworks keys                                                         |
| Rely on application OCR limits while provider hard quota remains unverified       | Enables mobile product validation now                                                                     | A provider-side misconfiguration could still allow spend beyond the intended hard quota if app controls are bypassed      | Distributed DB limiter remains 1 request/second, 100/day, 1,000/month; verify the Naver Stage hard quota before widening access                                       |
| Use one shared prototype workspace                                                | Avoids adding product authentication before validating the experience                                     | Approved testers can see or affect shared test data                                                                       | Limit Vercel membership, use team-owned test cards, and delete test rows/assets after validation                                                                      |
| Deploy the uncommitted reviewed working tree via CLI                              | Allows the complete Phase 5 MVP to be tested before reorganizing commits                                  | Deployment is not tied to an immutable Git commit                                                                         | Record the deployment ID, keep the working tree untouched, and commit only after review                                                                               |
| Pin Vercel builds to Node.js `24.x` and disable Next/Vercel telemetry             | Keeps the build runtime predictable and avoids unnecessary deployment metadata collection                 | Requires an intentional runtime upgrade later; telemetry is unavailable for framework diagnostics                         | Review the runtime pin during dependency upgrades; use explicit build and runtime logs for diagnosis                                                                  |
| Keep the first Preview function region at Vercel's current `iad1` default         | Avoids changing compute placement before the Supabase region and end-to-end latency are measured together | The observed Clova OCR round trip exceeded the 3–5 second product goal                                                    | Treat `icn1` as an A/B candidate, verify the Supabase region first, and compare end-to-end latency and pricing before changing                                        |
| Synchronize Preview environment variables as sequential Vercel writes             | Uses the existing CLI and avoids adding another secret-management service                                 | A mid-sync failure can leave a temporary mixed state; unknown pre-existing variables could expand the deployment boundary | Post-sync and pre-deploy checks require the exact name/scope/type allowlist; mismatches block deployment, and unknown variables are reviewed rather than auto-deleted |
| Permit one deployment-bound synthetic Clova smoke call                            | Proves the protected Preview reaches the real paid OCR path                                               | It incurs one charge; a transport timeout can make the outcome temporarily uncertain                                      | Bind approval to the immutable deployment ID, never retry automatically, reconcile the exact operation key for 75 seconds, and require exact DB/Storage cleanup       |

## Non-negotiable safety conditions

- The bootstrap must be static, contain no credentials, and run only after
  `ssoProtection.deploymentType=all` is verified from Vercel.
- The bootstrap is allowed only when the project has zero deployments.
- Actual application credentials are uploaded only to the Preview environment.
- The actual MVP deploy command must use `--target=preview`; no promotion or
  custom domain is allowed in this phase.
- Environment sync and Preview deployment wrappers must query Vercel immediately
  before mutation and fail closed unless All Deployments protection is active
  on the linked team and project. The deploy wrapper must also verify a READY
  Production deployment history.
- A paid remote OCR smoke test must bind its target to the linked project and
  verify its immutable URL, Preview target, `READY` state, and All Deployments
  protection before issuing the provider request.
- `.env.local`, `.vercel`, generated build caches, source documents, tests, and
  migrations are excluded from the deployment archive.
- Secret values, OCR images, and OCR personal data must not appear in CLI output,
  build logs, runtime logs, or user-facing error responses.
- An unauthenticated request must be stopped by Vercel before application
  middleware or content is reached.

## Observed deployment validation

- `All Deployments` protection was verified before the bootstrap and remained
  enabled after the MVP Preview deployment.
- The one-time Production bootstrap was static and secret-free. Unauthenticated
  requests to both its unique URL and production alias were redirected to Vercel
  authentication without returning bootstrap content.
- The actual MVP deployment was created as Preview and reached `READY`.
  Unauthenticated requests were blocked by Vercel; authenticated requests to
  `/` and `/capture` returned HTTP 200.
- Deployment record: the secret-free Production bootstrap is
  `dpl_8E6fYwZnHfVQoKcE3HYXNFfzrSFK`; the paid live-OCR smoke ran on Preview
  `dpl_EMnBPpY4LqQa6qzFA4yDSAMAeXRg`; the latest reviewed Preview is
  `dpl_XBrGpygtN1t2xz8A9CnJ95tqypaD`.
- Production and Development contain no application environment variables.
  Preview contains only the reviewed allowlist; server credentials use Vercel's
  sensitive Secret type.
- One synthetic remote smoke test reached `naver_clova` exactly once, returned a
  draft, and increased the provider ledger by one successful call. Its Capture,
  draft, assets, Storage objects, and synthetic AI-run data were removed; the
  non-PII provider-call ledger row was retained for cost accounting.
- The observed live OCR latency was 8,270 ms. This proves the path works but does
  not meet the 3–5 second target. Vercel currently reports `iad1` for the
  function region; changing to `icn1` is deferred until the Supabase region,
  cross-region DB cost, function pricing, and repeated end-to-end measurements
  are evaluated together.
- Deployment logs contained no error events, known secret values, synthetic OCR
  text, or image data during the reviewed interval.

## Deferred improvements

1. Create dedicated Preview Supabase and Clova credentials and migrate away from
   development credential reuse.
2. Verify Naver's provider-side 1 request/second, 100/day, and 1,000/month hard
   quota on the exact OCR Stage.
3. Replace the shared workspace boundary with product-level user and workspace
   authentication before broader external testing.
4. Connect an reviewed Git workflow so each Preview maps to an immutable commit.
5. Evaluate `icn1` against `iad1` with the same synthetic fixture after confirming
   the Supabase region; adopt it only if the complete capture flow improves
   without creating a larger database-latency or pricing regression.

## Rollback

1. Set `APP_REMOTE_PROTOTYPE_ACCESS=off` for Preview and redeploy, or delete the
   Preview deployment.
2. Keep Vercel Authentication enabled while removing Preview environment values.
3. Remove the Vercel project if the bootstrap and Preview are no longer needed.
4. Rotate Supabase or Clova credentials only if they were exposed, uploaded to an
   incorrect project, or accessible to an untrusted member.
