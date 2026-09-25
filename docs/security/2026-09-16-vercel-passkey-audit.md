# Vercel Login and Passkey Security Audit — 2026-09-16

## Outcome

The unexpected Windows prompt was a passkey-enumeration privacy request for the `OpenAI.Codex` packaged app on `google.com`. It was not a request to read API keys, Google passwords, `.env.local`, or passkey private keys.

The Windows consent store showed the app/domain decision as `Deny`. The pending Vercel device login was cancelled. Vercel CLI remained logged out, the repository was not linked to a Vercel project, and no deployment or environment-variable synchronization had occurred.

## Exposure assessment

- API keys, database credentials, and passkey private keys: no evidence of disclosure.
- Passkey metadata: potentially visible only if the Windows enumeration permission is allowed; the observed app/domain permission is denied.
- Google OAuth: the observed request contained only `openid`, `profile`, and `email`, which cover basic identity information rather than Google Drive, Gmail, Password Manager, or Google Cloud credentials.
- Vercel CLI token: none was retained after the cancelled login. A successful CLI login would create a separate high-privilege Vercel credential and must be reviewed independently of Google OAuth.
- Local generated files: Next.js/Turbopack cache files contained copies of server secrets loaded from `.env.local`. They were ignored by Git and excluded by `.vercelignore`; generated secret-bearing caches must be cleaned before deployment or sharing.

## Required controls

1. Keep Codex/ChatGPT passkey access disabled under Windows Settings → Privacy & security → Passkey access.
2. Start a fresh Vercel device flow and complete it only in standalone Chrome or Edge.
3. Verify the Vercel user, team, `projectId`, and `orgId` before any secret upload.
4. Enable Vercel Authentication before uploading Preview secrets.
5. Run the environment sync once in dry-run mode, then use the project-bound confirmation only after review.
6. Store server credentials as write-only Vercel Secret values and keep unrelated model-provider keys out of the Preview.
7. Do not use Shareable Links or Protection Bypass for Automation for this MVP.
8. Clean generated caches and run the secret-residue audit before deployment or sharing.
9. Review Vercel Account Tokens and Activity Log after authentication. Revoke unknown tokens and rotate only credentials with evidence of actual exposure.
10. Run scripted Vercel operations with telemetry debug mode so command telemetry is kept local during this security-sensitive setup.

## References

- https://learn.microsoft.com/windows/security/identity-protection/passkeys/
- https://learn.microsoft.com/windows/client-management/mdm/policy-csp-privacy
- https://developers.google.com/identity/openid-connect/openid-connect
- https://vercel.com/changelog/new-vercel-cli-login-flow
- https://vercel.com/docs/cli/logout
- https://vercel.com/docs/environment-variables/sensitive-environment-variables
- https://vercel.com/docs/deployment-protection/methods-to-protect-deployments/vercel-authentication
