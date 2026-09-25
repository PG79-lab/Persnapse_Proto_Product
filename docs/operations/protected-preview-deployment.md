# Protected Preview Deployment Runbook

## Purpose

Create an HTTPS Vercel Preview that can be opened on mobile devices without exposing the unauthenticated single-workspace MVP to the public internet.

## Safety gates

1. `npm run verify` passes locally.
2. Authentication is completed in a standalone Chrome or Edge window, never in the Codex/ChatGPT in-app browser.
3. The exact Vercel user, team, `projectId`, and `orgId` are reviewed after linking.
4. Vercel Authentication is verified as **All Deployments** before any deployment
   or secret upload and is not downgraded to Preview-only protection.
5. A new project has only the reviewed, secret-free static Production bootstrap
   before the actual MVP Preview is deployed.
6. Only the allowlisted Preview environment variables are synchronized after a project-bound confirmation.
7. An unauthenticated request is stopped by Vercel before application content is returned.

Vercel documents that a new project's first deployment is Production even when
`--prod` is omitted. For a new project, verify All Deployments protection first,
then use the explicitly approved, secret-free bootstrap below. The actual MVP
wrapper independently requires both All Deployments protection and READY
Production deployment history before it will create a Preview.

When a secret-free bootstrap has been explicitly approved, use the guarded
commands below. Both commands are dry-run-only until their confirmation is bound
to the reviewed project ID. The bootstrap script independently verifies both
`All Deployments` and zero deployment history before creating a static Build
Output deployment, then removes its temporary files.

```powershell
npm run deploy:protect:all
npm run deploy:protect:all -- --confirm-all-deployments-protection=<reviewed-project-id>
npm run deploy:bootstrap
npm run deploy:bootstrap -- --confirm-bootstrap-production=<reviewed-project-id> --confirm-all-deployments-protection
```

## Required Preview variables

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY`
- `DATABASE_URL` using the Supabase Transaction Pooler on port 6543
- `AI_ROUTING_MODE=mock`
- `BUSINESS_CARD_OCR_MODE=live`
- `NEXT_TELEMETRY_DISABLED=1`
- `CLOVA_OCR_INVOKE_URL`
- `CLOVA_OCR_SECRET`
- `APP_REMOTE_PROTOTYPE_ACCESS=vercel_preview`
- `APP_DEFAULT_WORKSPACE_ID`

The sync script is dry-run-only unless its confirmation is bound to the linked `projectId`. It reads local values without printing them and sends only this allowlist to the Vercel Preview environment. Public browser configuration is stored as Config; server credentials are stored as write-only Secret values.

```powershell
npm run deploy:env:preview
npm run deploy:env:preview -- --confirm-sensitive-upload=<reviewed-project-id> --confirm-vercel-authentication-enabled
```

The first command must stop without uploading anything and print the destination plus variable names. Run the second command only after independently checking the destination and protection setting.

Vercel updates these variables sequentially rather than atomically. If any write
fails, do not deploy: rerun the complete sync and require its metadata-only
inventory check to pass. The check compares names, Preview-only scope, and
Secret/config type without reading values. Unexpected variables stop the
workflow for review and are never deleted automatically. The deployment wrapper
repeats this inventory check immediately before creating a Preview.

## Deployment sequence

```powershell
$env:VERCEL_TELEMETRY_DISABLED = "1"
npx --yes vercel@59.17.0 login
npx --yes vercel@59.17.0 whoami
npx --yes vercel@59.17.0 link
Remove-Item Env:VERCEL_TELEMETRY_DISABLED
npm run deploy:protect:all
npm run deploy:protect:all -- --confirm-all-deployments-protection=<reviewed-project-id>
npm run deploy:bootstrap
npm run deploy:bootstrap -- --confirm-bootstrap-production=<reviewed-project-id> --confirm-all-deployments-protection
npm run deploy:env:preview
```

`VERCEL_TELEMETRY_DISABLED=1` opts out of CLI telemetry for these commands without printing telemetry event details. Copy the login URL into a standalone browser. Reject any Codex/ChatGPT passkey-access prompt; passkey access is not needed for this deployment. After `link`, inspect `.vercel/project.json`, open the project dashboard, and verify Vercel Authentication is set to **All Deployments** under Security → Deployment Protection. Do not downgrade it to Preview-only protection. Stop for review, then run the project-bound commands shown by the dry runs:

```powershell
npm run deploy:env:preview -- --confirm-sensitive-upload=<reviewed-project-id> --confirm-vercel-authentication-enabled
npm run deploy:preview
npm run deploy:preview -- --confirm-preview-deploy=<reviewed-project-id> --confirm-vercel-authentication-enabled --confirm-project-has-deployment-history
```

The first `deploy:preview` command must stop without deploying and show the exact destination. The confirmed command automatically removes generated Turbopack secret caches and requires the secret-residue audit to pass before invoking Vercel.

The history flag records explicit operator intent. The wrapper independently
queries Vercel immediately before deployment and fails closed unless All
Deployments protection and READY Production deployment history are present. It also
passes `--target=preview`, but this does not override Vercel's documented
first-deployment behavior.

The accepted tradeoffs and exit plan for the current MVP are recorded in
`docs/decisions/0010-vercel-preview-deployment-tradeoffs.md`.

Do not use a Shareable Link or Protection Bypass for Automation. Keep access limited to explicitly reviewed Vercel project members.

Do not pass `--prod`. The generated `.vercel.app` Preview URL is the test domain for this phase.

## Verification

1. Open the Preview URL in a private browser session. Confirm that Vercel authentication appears before the app.
2. Authenticate as a project member and open `/capture`.
3. On iOS Safari and Android Chrome where available:
   - grant camera permission;
   - capture one card;
   - confirm the request avoids HTTP 413;
   - confirm Clova provider and latency are shown;
   - edit a field;
   - add context;
   - commit to a Person;
   - reopen the Person profile and displayed card.
4. Review deployment error logs after the flow.
5. Delete synthetic test rows and Storage objects. Team test cards may remain only by explicit team choice.

For one paid, synthetic server-path smoke test with automatic draft cleanup, use
the guarded command below. It creates a unique image so an older OCR cache cannot
satisfy the request, verifies exactly one provider call, deletes the uncommitted
capture through the Preview API, and checks DB and Storage residue are both zero.

```powershell
npm run deploy:verify:preview:live -- --deployment=<reviewed-preview-url>
npm run deploy:verify:preview:live -- --deployment=<reviewed-preview-url> --confirm-live-ocr-once=<reviewed-deployment-id>
```

The non-PII OCR usage ledger row is intentionally retained for daily/monthly cost
accounting; it is not counted as test-data residue.

The first command is a dry run that verifies the immutable URL, linked project,
Preview target, READY state, and All Deployments protection, then prints the
deployment-bound confirmation command. If the paid POST ends without a definite
HTTP response, never rerun it. The verifier prints the non-secret operation key,
disables automatic retry, waits up to 75 seconds, reconciles the exact Capture
and provider ledger row, and performs exact cleanup. If reconciliation remains
uncertain, stop and inspect that operation key manually before authorizing any
further live OCR call.

## Rollback

- Set `APP_REMOTE_PROTOTYPE_ACCESS=off` in Preview and redeploy, or disable/delete the Preview deployment.
- Do not remove Vercel Authentication as the first rollback action; close the application gate first.
- Run `npx --yes vercel@59.17.0 logout` and remove the CLI token from the Vercel Account Tokens page if the login device, destination team, or activity is uncertain.
- Rotate only credentials that were actually uploaded to an incorrect project, exposed in a log, or read by an unknown actor.

## Secret trust boundary

`SUPABASE_SECRET_KEY`, `DATABASE_URL`, and `CLOVA_OCR_SECRET` grant server-side access and make the selected Vercel project a trusted secret holder. Prefer a dedicated Preview Supabase project and a Preview-only Clova credential. If the current development credentials are reused for the MVP, limit project membership, keep every server credential as a Vercel Secret, never log environment values, and remove or rotate them when the Preview is retired.

Vercel currently redacts Secret values from build logs only when the value is at least 32 characters. Application code must therefore avoid logging secrets regardless of platform redaction.
