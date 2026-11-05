# Automated security scan (OWASP ZAP) — Task T5

**What this is:** an automated scanner run against a test copy of the app in CI, using
synthetic data only. **What this is not:** a penetration test. A scanner finds common,
well-known mistakes; it does not think like an attacker. An independent penetration test is
still needed before going live (see U11). This does not show the system is unhackable.

## When it runs

Workflow: `.github/workflows/zap.yml`

| Trigger                                           | Scans                                                                  |
| ------------------------------------------------- | ---------------------------------------------------------------------- |
| Every pull request and push to `main`             | Passive scan signed out, passive scan signed in                        |
| Weekly (Monday 03:17 UTC) and pushes to `scan/**` | The above **plus** an active (attack) scan signed in, up to 40 minutes |

The active scan only ever runs against the throwaway CI copy. It is never pointed at a live
server.

While signed in, the scanner is stopped from signing itself out, changing the password or
changing two-step settings (those addresses are rewritten by `security/zap-auth-options.sh`),
so it keeps a working session for the whole scan.

## Pass rule

`security/zap-summary.py` fails the job on any **High** or **Medium** finding that is not listed,
with a reason, in `security/zap-accepted.tsv`. Low and informational findings are shown in the
job summary but do not fail it.

## First results (November 2026)

No High findings. No SQL injection, cross-site scripting, path traversal or similar problems
were found by the active rules (139 checks passed).

| Rule  | Level  | Finding                                     | Decision                                                                                                                                                                                                                                               |
| ----- | ------ | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 10202 | Medium | Absence of anti-CSRF tokens in forms        | **Accepted.** See below.                                                                                                                                                                                                                               |
| 20012 | Medium | Anti-CSRF tokens check (active)             | **Accepted.** Same reason.                                                                                                                                                                                                                             |
| 90004 | Low    | Cross-Origin-Resource-Policy header missing | **Fixed** for the web app: `Cross-Origin-Resource-Policy: same-origin` added in `apps/web/next.config.ts`. The related "Embedder policy" (COEP) part is left off on purpose: it can block legitimate images and gives no real protection for this app. |
| 90027 | Low    | Cookie slack detector                       | Informational; the scanner notices pages look the same with fewer cookies (public pages). No action.                                                                                                                                                   |

### Why the CSRF findings are accepted

The scanner looks for a hidden token field in each form. This app protects against forged
requests differently:

1. Forms are handled by the page's own script, which sends the data to the API with `fetch`.
   The page itself does nothing with a plain form post.
2. The API refuses every change (POST, PUT, PATCH, DELETE) that lacks the `X-Requested-With`
   header, and any request whose `Origin` is not our own website (`CsrfGuard`). Another website
   cannot add that header without our permission, and we never give it.
3. The session cookie is `HttpOnly` and `SameSite=Lax`, so browsers do not send it with
   cross-site form posts at all.

Automated proof: `apps/api/test/security.e2e.spec.ts` ("refuses changes without the custom
header, or from another website") forges both kinds of request and checks the user is still
signed in afterwards.

## Known limits of this scan

- The scanner found about 30 addresses. Many API addresses are only reached by the app's
  script after user actions, and the API has no published description (OpenAPI) for the
  scanner to read. Those API addresses are covered by the automated API tests (permissions,
  tenant isolation, validation, rate limits), not by ZAP.
- Business-logic problems (for example, a member seeing something they should not) are not
  something a scanner can judge. These are covered by the tenant-isolation and permission
  tests, and should be part of the independent penetration test.
- The scan runs over plain HTTP inside CI. HTTPS settings are checked separately by the
  deployment check job.
