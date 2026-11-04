# Authentication and access control

How people sign in, what each role may do, and how this is enforced. All rules are enforced
by the API on the server; the web app never decides who may do what.

## Roles

| Role                          | Where it applies | Purpose                                                                                                                                                                                            |
| ----------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Platform Super Admin          | Whole platform   | Constitution Intelligence staff: create organisations, invite their first owners, suspend accounts, read the platform audit log. **No automatic access to any organisation's content or members.** |
| Organisation Owner            | One organisation | Full control of the organisation, including granting the Owner role.                                                                                                                               |
| Organisation Administrator    | One organisation | Manages members (below Administrator), invitations, branding and content editing. Cannot grant Owner, cannot manage Owners or other Administrators, cannot approve content.                        |
| Organisation Content Reviewer | One organisation | Reviews and approves constitution content (used from the content stages).                                                                                                                          |
| Organisation Member           | One organisation | Reads the organisation's published constitution.                                                                                                                                                   |
| Auditor (read-only)           | One organisation | Reads members, billing and the audit log. Cannot change anything.                                                                                                                                  |

One person can hold different roles in different organisations with a single account.

## Permissions

The single source of truth is `packages/shared/src/access.ts`.

| Permission                   | Owner | Admin | Content Reviewer | Member | Auditor |
| ---------------------------- | ----- | ----- | ---------------- | ------ | ------- |
| organisation.read            | Yes   | Yes   | Yes              | Yes    | Yes     |
| constitution.read            | Yes   | Yes   | Yes              | Yes    | Yes     |
| organisation.settings.manage | Yes   | No    | No               | No     | No      |
| content.edit                 | Yes   | Yes   | Yes              | No     | No      |
| content.review               | Yes   | Yes   | Yes              | No     | No      |
| content.approve              | Yes   | Yes   | No               | No     | No      |
| members.read                 | Yes   | Yes   | No               | No     | Yes     |
| members.invite               | Yes   | Yes   | No               | No     | No      |
| members.manage               | Yes   | Yes   | No               | No     | No      |
| branding.manage              | Yes   | Yes   | No               | No     | No      |
| billing.read                 | Yes   | No    | No               | No     | Yes     |
| audit.read                   | Yes   | Yes   | No               | No     | Yes     |

Stage 7 changed the content permissions so that approval is the organisation administrator's
decision: Content Reviewers check and correct extracted text and send it for approval
(`content.edit`, `content.review`); Owners and Administrators approve, publish and archive
(`content.approve`). See [../documents.md](../documents.md).

### Privilege-escalation rules

1. Only an Owner can grant the Owner role (by invitation or role change).
2. Nobody can grant a role above their own.
3. Administrators can only change or remove people ranked below them (not Owners, not other Administrators).
4. Nobody can change or remove their own membership.
5. An organisation always keeps at least one active Owner.
6. Roles not in the list above (for example "platform_super_admin") are rejected as invalid input.
7. The Platform Super Admin flag cannot be granted through the API; only the command-line
   bootstrap script (run by someone with server access) can grant it.

## How enforcement works

Three guards run on every API request, in order:

1. **CsrfGuard**: state-changing requests (POST, PUT, PATCH, DELETE) must carry the
   `X-Requested-With` header, and, if the browser sends an `Origin`, it must be an allowed web origin.
2. **AuthGuard**: a valid session is required for every route except those explicitly marked
   `@Public()` (sign-in, password reset, invitation acceptance, health checks). Access is denied by default.
3. **PermissionGuard**: routes marked `@RequireSuperAdmin()` or `@RequireOrgPermission(...)`
   are checked against the database on every request. Someone who is not an active member of an
   organisation receives **404** (the organisation's existence is not revealed); a member whose
   role lacks the permission receives **403** and the attempt is audited.

## Sign-in and sessions

- Passwords are hashed with **Argon2id** (19 MiB memory, 2 iterations: OWASP's recommended minimum).
  Passwords are never stored, logged, or returned by the API.
- Password rules: 12–128 characters, not a common password, not mostly one repeated character,
  must not contain your email name or display name. (A breached-password check is planned.)
- A successful sign-in creates a server-side session. The browser receives a random 256-bit token
  in a cookie that is **HttpOnly** (invisible to JavaScript), **SameSite=Lax**, and **Secure** (HTTPS-only)
  in staging and production. The database stores only a SHA-256 hash of the token.
- Sessions end after `SESSION_IDLE_MINUTES` without activity (default 24 hours) and always after
  `SESSION_ABSOLUTE_HOURS` (default 14 days).
- Platform Super Admin sessions are shorter: `SUPER_ADMIN_SESSION_IDLE_MINUTES` (default 30) and
  `SUPER_ADMIN_SESSION_ABSOLUTE_HOURS` (default 12). In staging and production the cookie is named
  `__Host-ci_session`, so it can only be set by the site itself over HTTPS (Stage 12).
- Password change, password-reset links and invitation links are rate limited too (Stage 12);
  see [security-review.md](security-review.md).
- Sessions are ended immediately on sign-out, "sign out everywhere", password reset (all sessions),
  password change (all other sessions), and account suspension or deactivation.
- Wrong password and unknown email produce the same message, and take the same time, so attackers
  cannot discover who has an account.

## Two-step sign-in

After the password, people who have it turned on type a **6-digit code from an authenticator app**
on their phone (Google Authenticator, Microsoft Authenticator, 2FAS or similar). Someone who learns
the password still cannot sign in. Added in Task D2. Codes by text message (SMS) are not offered:
they can be intercepted or moved to another SIM.

| Who                               | Two-step sign-in                                                                                                     |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Platform Super Admins             | **Required.** Until it is set up, a Super Admin can sign in but sees only the setup steps; the API refuses every Control Centre and organisation route (403, reason `TWO_STEP_SETUP_REQUIRED`). Cannot be turned off. |
| Organisation Owners and Administrators | **Optional**, on the profile page of their portal. Recommended.                                                      |
| Other roles                       | Not offered.                                                                                                         |

**How it works**

- Standard TOTP (RFC 6238): HMAC-SHA-1, 6 digits, 30-second steps, 160-bit secrets. Written with
  `node:crypto` only and checked against the RFC 4226 and RFC 6238 published test values. Codes from
  one step before or after are accepted (phone clocks drift).
- **Setting up:** a new secret is shown once as a QR code and as a text key. Two-step sign-in is
  turned on only after the first correct code, which proves the app works. Then **10 recovery
  codes** are shown once, every other session of that person is signed out, and a confirmation email
  is sent.
- **Signing in:** a correct password no longer creates a session for these people. It returns a
  one-time "challenge" token instead (valid **5 minutes**, single use, only its hash stored). The
  session is created only after `POST /auth/login/two-step` with a right code or recovery code.
- **Each code works once:** the time step of the last accepted code is stored, and that code or any
  older one is refused (replay protection, RFC 6238 §5.2).
- **Wrong codes:** a waiting sign-in is abandoned after **5 wrong codes**; a person may get at most
  **10 wrong codes per 15 minutes** in total (then HTTP 429). The per-email sign-in counter is not
  reset until the second step succeeds. Every wrong code is audited.
- **Recovery codes:** single use. Using one emails the person ("A recovery code was used to sign
  in") with how many are left. New codes can be made with a current code (the old ones stop working).
- **Turning it off** (Owners and Administrators only) needs the password **and** a current code. A
  confirmation email is sent.
- **Defence in depth:** a session that never passed the second step is refused for anyone who has
  two-step sign-in on (the `sessions.two_step_verified_at` column), whatever created it.
- **No "remember this device".** Every sign-in asks for a code.

**Stored data** (migration `0009_two_step_sign_in.sql`; none of it is readable by the tenant
database role `app_tenant`):

- `user_two_step`: the secret **encrypted with AES-256-GCM** (a random IV each time; the user id is
  bound in as authenticated data, so a secret copied onto another row does not decrypt), when it was
  turned on, and the last used time step.
- `two_step_recovery_codes`: **HMAC-SHA-256 hashes** only, keyed with a key derived from the master
  key, so a stolen database copy alone is not enough to try codes offline.
- `two_step_challenges`: hashes of waiting sign-ins, their expiry and wrong-code count.
- The master key is `MFA_ENCRYPTION_KEY` (64 hexadecimal characters; `MFA_ENCRYPTION_KEY_FILE` in
  production). **Required in staging and production.** Two keys are derived from it with HKDF. Local
  development and tests use a fixed key derived from a public phrase; it protects nothing. See
  [secrets](../operations/secrets.md).

**Lost phone.** With a recovery code: sign in with it, then (Owners/Administrators) turn two-step
sign-in off and on again with the new phone, or (Super Admins) ask another Super Admin to reset it.
Without recovery codes: another Super Admin resets it on the Control Centre **Support** page (email
address and a reason; audited as `auth.two_step.reset`; the person is signed out everywhere and
emailed). For the last remaining Super Admin, someone with server access runs
`node dist/cli/reset-two-step.js --email … --reason "…"` (see
[incident response](../operations/incident-response.md)). Nobody can reset their own two-step
sign-in. Always confirm who is asking before a reset.

## Brute-force protection

Counters are stored in PostgreSQL, so they hold across all running copies of the API.

| Limit                                       | Default           | Setting                                                          |
| ------------------------------------------- | ----------------- | ---------------------------------------------------------------- |
| Sign-in attempts per email address          | 5 per 15 minutes  | `LOGIN_MAX_ATTEMPTS_PER_EMAIL`, `AUTH_RATE_LIMIT_WINDOW_MINUTES` |
| Sign-in attempts per network address        | 50 per 15 minutes | `LOGIN_MAX_ATTEMPTS_PER_IP`                                      |
| Password-reset requests per email           | 3 per 15 minutes  | fixed                                                            |
| Password-reset requests per network address | 20 per 15 minutes | fixed                                                            |
| Wrong two-step codes per person             | 10 per 15 minutes | fixed (window: `AUTH_RATE_LIMIT_WINDOW_MINUTES`)                 |
| Wrong codes on one waiting sign-in          | 5                 | fixed                                                            |

Once a limit is reached, further attempts are refused with HTTP 429, even with the right password,
until the window ends. A successful sign-in resets the per-email counter.

## Password reset and invitations

- "Forgot password" always answers the same way. If the account exists and is active, a one-time link
  valid for `PASSWORD_RESET_TTL_MINUTES` (default 30) is emailed. Using it signs the person out everywhere.
- Invitations are one-time links valid for `INVITATION_TTL_HOURS` (default 7 days). Only the newest
  invitation per email and organisation stays valid. A new person chooses their name and password
  when accepting; someone who already has an account must be signed in as the invited email address.
- Tokens are 256-bit random values; only their SHA-256 hashes are stored.
- **Email delivery:** through an SMTP email provider (Task D1; Brevo for the pilot). `MAIL_TRANSPORT=log`
  (emails written to the server log) is allowed only locally and in tests.

## Audit events

Written to the append-only `audit_events` table (the database refuses UPDATE, DELETE and TRUNCATE):

| Event                                                                                            | When                                               |
| ------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| `auth.login.succeeded` / `auth.login.failed` / `auth.login.rate_limited`                         | Sign-in attempts                                   |
| `auth.logout` / `auth.logout_all`                                                                | Sign-out                                           |
| `auth.password.reset_requested` / `reset_rate_limited` / `reset_completed` / `reset_failed`      | Password reset                                     |
| `auth.password.changed` / `auth.password.change_failed`                                          | Password change                                    |
| `auth.login.two_step_required`                                                                   | Right password; waiting for the code               |
| `auth.two_step.enabled` / `disabled` / `reset` / `recovery_codes_replaced`                        | Two-step sign-in changes                           |
| `auth.two_step.failed` / `auth.two_step.recovery_code_used`                                       | Wrong codes; a recovery code used                  |
| `invitation.created` / `invitation.revoked` / `invitation.accepted` / `invitation.accept_failed` | Invitations                                        |
| `membership.role_changed` / `membership.status_changed` / `membership.removed`                   | Member management                                  |
| `user.created` / `user.status_changed` / `user.super_admin_granted`                              | Accounts                                           |
| `organisation.created`                                                                           | Platform                                           |
| `permission.denied`                                                                              | Any refused permission check or escalation attempt |

Events record who, what, when, the organisation, network address, browser and request ID.
They never contain passwords, tokens or session values.

## API endpoints (Stage 3)

| Method and path                                                   | Who                | Purpose                              |
| ----------------------------------------------------------------- | ------------------ | ------------------------------------ |
| `POST /api/v1/auth/login`                                         | Anyone             | Sign in `{ email, password }`; answers `{ user }` or `{ twoStepRequired, challengeToken, expiresAt }` |
| `POST /api/v1/auth/login/two-step`                                | Anyone with a challenge | `{ challengeToken, code }` or `{ challengeToken, recoveryCode }` |
| `GET /api/v1/auth/two-step`                                       | Signed in          | Your two-step status                 |
| `POST /api/v1/auth/two-step/setup`                                | Super Admin, Owner, Administrator | New secret: `{ secret, otpauthUrl, qrCode }` |
| `POST /api/v1/auth/two-step/confirm`                              | Signed in          | `{ code }`: turns it on, returns `{ recoveryCodes }` once |
| `POST /api/v1/auth/two-step/recovery-codes`                       | Signed in          | `{ code }`: new recovery codes       |
| `POST /api/v1/auth/two-step/disable`                              | Owner, Administrator | `{ password, code }`               |
| `POST /api/v1/platform/two-step/reset`                            | Super Admin        | `{ email, reason }` (not your own)   |
| `POST /api/v1/auth/logout`                                        | Signed in          | Sign out this device                 |
| `POST /api/v1/auth/logout-all`                                    | Signed in          | Sign out every device                |
| `GET /api/v1/auth/me`                                             | Signed in          | Your account and organisation roles  |
| `POST /api/v1/auth/password/forgot`                               | Anyone             | Request a reset link `{ email }`     |
| `POST /api/v1/auth/password/reset`                                | Anyone with a link | `{ token, newPassword }`             |
| `POST /api/v1/auth/password/change`                               | Signed in          | `{ currentPassword, newPassword }`   |
| `POST /api/v1/invitations/accept`                                 | Invitee            | `{ token, displayName?, password? }` |
| `GET /api/v1/organisations/:id`                                   | organisation.read  | Organisation and your role           |
| `GET /api/v1/organisations/:id/members`                           | members.read       | Member list                          |
| `PATCH /api/v1/organisations/:id/members/:membershipId`           | members.manage     | `{ role?, status? }`                 |
| `DELETE /api/v1/organisations/:id/members/:membershipId`          | members.manage     | Remove member                        |
| `GET /api/v1/organisations/:id/invitations`                       | members.read       | Invitation list                      |
| `POST /api/v1/organisations/:id/invitations`                      | members.invite     | `{ email, role }`                    |
| `POST /api/v1/organisations/:id/invitations/:invitationId/revoke` | members.invite     | Revoke                               |
| `GET /api/v1/organisations/:id/audit-events`                      | audit.read         | Organisation audit log               |
| `POST /api/v1/platform/organisations`                             | Super Admin        | `{ name, slug }`                     |
| `GET /api/v1/platform/organisations`                              | Super Admin        | List organisations                   |
| `POST /api/v1/platform/organisations/:id/owner-invitations`       | Super Admin        | `{ email }`                          |
| `PATCH /api/v1/platform/users/:userId/status`                     | Super Admin        | `{ status }`                         |
| `GET /api/v1/platform/audit-events`                               | Super Admin        | Platform audit log                   |

All `POST`, `PATCH` and `DELETE` requests must include the header `X-Requested-With: XMLHttpRequest`.

## Creating the first Platform Super Admin

There is no default administrator and no default password. Someone with access to the server runs:

```bash
pnpm super-admin:create --email you@example.com --name "Your Name"
```

It prints a one-time link (valid 30 minutes). Until the web sign-in screens exist, set the password
by sending the token from that link to the reset endpoint:

```bash
curl -X POST http://localhost:4000/api/v1/auth/password/reset \
  -H "Content-Type: application/json" -H "X-Requested-With: XMLHttpRequest" \
  -d '{"token":"PASTE-TOKEN-HERE","newPassword":"choose a long passphrase"}'
```

## Fictional development accounts

For local development only (`APP_ENV=local`):

```bash
pnpm seed:dev
```

This creates two fictional organisations ("Sample Community Choir (fictional)" and "Sample Netball
Club (fictional)") with sample constitution content, and accounts: one per role in the choir
(`superadmin@sample.test`, `newstaff@sample.test`, `owner@sample.test`, `admin@sample.test`, `reviewer@sample.test`,
`member@sample.test`, `auditor@sample.test`) plus `netball.owner@sample.test` and `netball.member@sample.test`. Each run sets **new random passwords**, printed once. `superadmin@sample.test` gets a new two-step
key each run (printed once; add it to an authenticator app as a "setup key"), and
`newstaff@sample.test` is a second fictional Super Admin with no two-step sign-in, to try the setup steps.
The `.test` domain is reserved and can never receive real email.

## Known limitations (planned)

- Two-step sign-in is optional (not required) for organisation Owners and Administrators. Making it
  required for them is a business decision; the code supports it.
- Breached-password checking is not yet implemented (Task D5).
- Two-step sign-in has been tested in Chromium only (desktop and a phone-sized screen); Safari and
  Firefox checks are Task T1.
- Database-level tenant isolation is described in [tenant-isolation.md](tenant-isolation.md).
- Web sign-in screens are built with the portal user interface.
