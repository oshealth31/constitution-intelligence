# Authentication and access control

How people sign in, what each role may do, and how this is enforced. All rules are enforced
by the API on the server; the web app never decides who may do what.

## Roles

| Role | Where it applies | Purpose |
| --- | --- | --- |
| Platform Super Admin | Whole platform | Constitution Intelligence staff: create organisations, invite their first owners, suspend accounts, read the platform audit log. **No automatic access to any organisation's content or members.** |
| Organisation Owner | One organisation | Full control of the organisation, including granting the Owner role. |
| Organisation Administrator | One organisation | Manages members (below Administrator), invitations, branding and content editing. Cannot grant Owner, cannot manage Owners or other Administrators, cannot approve content. |
| Organisation Content Reviewer | One organisation | Reviews and approves constitution content (used from the content stages). |
| Organisation Member | One organisation | Reads the organisation's published constitution. |
| Auditor (read-only) | One organisation | Reads members, billing and the audit log. Cannot change anything. |

One person can hold different roles in different organisations with a single account.

## Permissions

The single source of truth is `packages/shared/src/access.ts`.

| Permission | Owner | Admin | Content Reviewer | Member | Auditor |
| --- | --- | --- | --- | --- | --- |
| organisation.read | Yes | Yes | Yes | Yes | Yes |
| constitution.read | Yes | Yes | Yes | Yes | Yes |
| organisation.settings.manage | Yes | No | No | No | No |
| content.edit | Yes | Yes | No | No | No |
| content.review | Yes | Yes | Yes | No | No |
| content.approve | Yes | No | Yes | No | No |
| members.read | Yes | Yes | No | No | Yes |
| members.invite | Yes | Yes | No | No | No |
| members.manage | Yes | Yes | No | No | No |
| branding.manage | Yes | Yes | No | No | No |
| billing.read | Yes | No | No | No | Yes |
| audit.read | Yes | Yes | No | No | Yes |

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
- Sessions are ended immediately on sign-out, "sign out everywhere", password reset (all sessions),
  password change (all other sessions), and account suspension or deactivation.
- Wrong password and unknown email produce the same message, and take the same time, so attackers
  cannot discover who has an account.

## Brute-force protection

Counters are stored in PostgreSQL, so they hold across all running copies of the API.

| Limit | Default | Setting |
| --- | --- | --- |
| Sign-in attempts per email address | 5 per 15 minutes | `LOGIN_MAX_ATTEMPTS_PER_EMAIL`, `AUTH_RATE_LIMIT_WINDOW_MINUTES` |
| Sign-in attempts per network address | 50 per 15 minutes | `LOGIN_MAX_ATTEMPTS_PER_IP` |
| Password-reset requests per email | 3 per 15 minutes | fixed |
| Password-reset requests per network address | 20 per 15 minutes | fixed |

Once a limit is reached, further attempts are refused with HTTP 429, even with the right password,
until the window ends. A successful sign-in resets the per-email counter.

## Password reset and invitations

- "Forgot password" always answers the same way. If the account exists and is active, a one-time link
  valid for `PASSWORD_RESET_TTL_MINUTES` (default 30) is emailed. Using it signs the person out everywhere.
- Invitations are one-time links valid for `INVITATION_TTL_HOURS` (default 7 days). Only the newest
  invitation per email and organisation stays valid. A new person chooses their name and password
  when accepting; someone who already has an account must be signed in as the invited email address.
- Tokens are 256-bit random values; only their SHA-256 hashes are stored.
- **Email delivery:** a real email provider is connected in a later stage. Until then, emails are
  written to the server log (`MAIL_TRANSPORT=log`, allowed only locally and in tests).

## Audit events

Written to the append-only `audit_events` table (the database refuses UPDATE, DELETE and TRUNCATE):

| Event | When |
| --- | --- |
| `auth.login.succeeded` / `auth.login.failed` / `auth.login.rate_limited` | Sign-in attempts |
| `auth.logout` / `auth.logout_all` | Sign-out |
| `auth.password.reset_requested` / `reset_rate_limited` / `reset_completed` / `reset_failed` | Password reset |
| `auth.password.changed` / `auth.password.change_failed` | Password change |
| `invitation.created` / `invitation.revoked` / `invitation.accepted` / `invitation.accept_failed` | Invitations |
| `membership.role_changed` / `membership.status_changed` / `membership.removed` | Member management |
| `user.created` / `user.status_changed` / `user.super_admin_granted` | Accounts |
| `organisation.created` | Platform |
| `permission.denied` | Any refused permission check or escalation attempt |

Events record who, what, when, the organisation, network address, browser and request ID.
They never contain passwords, tokens or session values.

## API endpoints (Stage 3)

| Method and path | Who | Purpose |
| --- | --- | --- |
| `POST /api/v1/auth/login` | Anyone | Sign in `{ email, password }` |
| `POST /api/v1/auth/logout` | Signed in | Sign out this device |
| `POST /api/v1/auth/logout-all` | Signed in | Sign out every device |
| `GET /api/v1/auth/me` | Signed in | Your account and organisation roles |
| `POST /api/v1/auth/password/forgot` | Anyone | Request a reset link `{ email }` |
| `POST /api/v1/auth/password/reset` | Anyone with a link | `{ token, newPassword }` |
| `POST /api/v1/auth/password/change` | Signed in | `{ currentPassword, newPassword }` |
| `POST /api/v1/invitations/accept` | Invitee | `{ token, displayName?, password? }` |
| `GET /api/v1/organisations/:id` | organisation.read | Organisation and your role |
| `GET /api/v1/organisations/:id/members` | members.read | Member list |
| `PATCH /api/v1/organisations/:id/members/:membershipId` | members.manage | `{ role?, status? }` |
| `DELETE /api/v1/organisations/:id/members/:membershipId` | members.manage | Remove member |
| `GET /api/v1/organisations/:id/invitations` | members.read | Invitation list |
| `POST /api/v1/organisations/:id/invitations` | members.invite | `{ email, role }` |
| `POST /api/v1/organisations/:id/invitations/:invitationId/revoke` | members.invite | Revoke |
| `GET /api/v1/organisations/:id/audit-events` | audit.read | Organisation audit log |
| `POST /api/v1/platform/organisations` | Super Admin | `{ name, slug }` |
| `GET /api/v1/platform/organisations` | Super Admin | List organisations |
| `POST /api/v1/platform/organisations/:id/owner-invitations` | Super Admin | `{ email }` |
| `PATCH /api/v1/platform/users/:userId/status` | Super Admin | `{ status }` |
| `GET /api/v1/platform/audit-events` | Super Admin | Platform audit log |

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

This creates a fictional organisation ("Sample Community Choir (fictional)") and one account per role
(`superadmin@sample.test`, `owner@sample.test`, `admin@sample.test`, `reviewer@sample.test`,
`member@sample.test`, `auditor@sample.test`). Each run sets **new random passwords**, printed once.
The `.test` domain is reserved and can never receive real email.

## Known limitations (planned)

- Two-factor authentication for privileged roles (Stage 1 requirement) is not yet implemented.
- Breached-password checking is not yet implemented.
- Email is not yet delivered (log transport only).
- Row-Level Security policies in PostgreSQL (database-level tenant isolation) come in the tenant-isolation stage.
- Web sign-in screens are built with the portal user interface.
