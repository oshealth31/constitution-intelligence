# Control centre (Platform Super Admin)

The private control centre is where the platform owner manages every customer organisation.
It lives in the web app at **`/admin`** and talks to the real API and database.

## Access

- Sign in at `/admin/sign-in` with a **Platform Super Admin** account
  (create the first one with `pnpm super-admin:create`; see `docs/security/authentication.md`).
- Every control-centre API route (`/api/v1/platform/*`) is protected **on the server**: anyone who is
  not a Platform Super Admin receives 403, and the attempt is recorded (`permission.denied`).
- Organisation Owners and Administrators who sign in here see "This area is restricted" and no data.
- The web app forwards `/api/v1/*` to the API, so the session cookie is a first-party, HttpOnly
  cookie. Set `API_INTERNAL_URL` for the web app when building it (default `http://127.0.0.1:4000`).

## Pages

| Page                | What it shows / does                                                                                                                                                                                                                                                                                                                                | API                                                                                                                                                                                                                                      |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Overview            | Organisation, people and constitution totals; failed sign-ins; subscriptions by status; constitution processing by stage; usage (30 days); newest organisations; health summary                                                                                                                                                                     | `GET /platform/overview`, `GET /platform/health`                                                                                                                                                                                         |
| Organisations       | Search and filter; subscription, onboarding progress, constitution status and member count per organisation; create an organisation (with default branding and a 30-day trial)                                                                                                                                                                      | `GET/POST /platform/organisations`                                                                                                                                                                                                       |
| Organisation detail | Edit name and web address; suspend or activate (reason required); invite Owners/Administrators, revoke invitations, suspend or reactivate administrators; manage the subscription manually; configure branding with preview; onboarding checklist; constitution processing; members by role (counts only); usage; audited support access to content | `GET/PATCH /platform/organisations/:id`, `POST …/status`, `PATCH …/branding`, `PUT …/subscription`, `POST …/administrator-invitations`, `POST …/invitations/:id/revoke`, `PATCH …/administrators/:membershipId`, `POST …/support-access` |
| Support             | Failed and blocked sign-ins, permission refusals, inactive accounts, expired invitations, organisations without an owner, trials ending soon, payment attention, recent security events (emails masked)                                                                                                                                             | `GET /platform/support`                                                                                                                                                                                                                  |
| Audit log           | All audit events with filters (organisation, area, outcome)                                                                                                                                                                                                                                                                                         | `GET /platform/audit-events`                                                                                                                                                                                                             |
| System health       | Database (with response time), migrations applied, storage writable, email delivery mode, version and uptime                                                                                                                                                                                                                                        | `GET /platform/health`                                                                                                                                                                                                                   |

## Privacy and accountability

- **Data minimisation:** organisation pages show statuses and counts. Constitution text is never shown,
  and ordinary members are counted by role but not named. Only Owners and Administrators are listed by
  name and email, because the platform needs them to manage the account. Emails in the support view
  are partly hidden.
- **Restricted content access:** viewing an organisation's published constitution requires a written
  reason (at least 10 characters). The access is recorded as `support.content_accessed`, with the
  reason, in both the platform audit log and **the organisation's own audit log**, so customers can
  see when and why their content was viewed. Drafts are never shown.
- **Every privileged action is audited:** organisation created, updated, suspended or activated;
  branding updated; subscription changed (with before and after values); administrators invited,
  suspended or reactivated; invitations revoked; account status changed; support content accessed.

## Subscriptions

Subscriptions are recorded manually: plan (`trial`, `starter`, `standard`, `premium`), status
(`trialing`, `active`, `past_due`, `suspended`, `cancelled`) and the date paid until / trial end.
**No payment provider is connected** and subscription status does not yet restrict an organisation's
access; access is controlled by the organisation's own status (active, suspended or archived).
Plan names and prices are placeholders until confirmed.

## Tests

- `apps/api/test/platform-dashboard.e2e.spec.ts`: server-side access control for every control-centre
  route, workflows against a real database, audit records, data minimisation, audited content access.
- `apps/web/e2e/control-centre.spec.ts` (Playwright): real browser against the real API and database:
  sign-in errors, redirects, overview and health, creating and managing an organisation, audited
  content access, refusal for organisation administrators, and the phone layout.

## Known limitations

- No email delivery yet: invitations sent from the control centre are written to the API log
  (development only). Until email is connected, invitees in deployed environments cannot receive links.
- Two-factor authentication for super admins is not yet implemented.
- Lists are capped (500 organisations, 500 audit events per query) without pagination.
- Logos cannot be uploaded yet (arrives with secure uploads).
