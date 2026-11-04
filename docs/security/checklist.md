# Security checklist

Use this list before any public launch, and again after any big change. A tick needs evidence
(a test, a screenshot of a setting, or a named person's sign-off), not just a belief. Findings
and open risks are in [security-review.md](security-review.md).

## Done in the code (checked by automated tests on every change)

- [x] Every API route declares who may use it; the list of public routes is fixed (`route-access.spec.ts`).
- [x] Organisation data is isolated by the database and by every query (`tenancy.e2e.spec.ts`).
- [x] Roles cannot be raised beyond the giver's own; Super Admin cannot be granted through the API (`access.e2e.spec.ts`).
- [x] Changes need the CSRF header and an allowed origin (`security.e2e.spec.ts`).
- [x] Sign-in, password reset, password change, invitation links, AI, clause finder, uploads, imports, invitations and payment reports are rate limited; there is also a general per-address limit.
- [x] Super Admin sessions end after 30 minutes idle and 12 hours in total.
- [x] Passwords hashed with Argon2id; session tokens stored only as hashes; cookie HttpOnly, SameSite=Lax, Secure and `__Host-` once deployed.
- [x] API: locked-down Content Security Policy, `no-store` caching, no framing, `nosniff`, HSTS once deployed.
- [x] Web: per-page nonce Content Security Policy, no framing, HSTS (production), COOP; browser test checks no violations and that injected scripts are blocked.
- [x] Uploads: type checked by content, size, page, ZIP-expansion, time and text limits; tenant folder checks; downloads sent as attachments.
- [x] AI: provider key server-side only; answers checked against the passages given; off by default.
- [x] Subscription rules enforced on the server.
- [x] Audit log append-only (database triggers; tested).
- [x] Logs exclude headers, cookies, passwords, tokens and query strings; unknown sign-in emails masked.
- [x] Production refuses to start with unsafe settings (no TLS to the database, plain-HTTP addresses, test AI mode, log-only email, debug logging, relative storage path).
- [x] Dependency audit and secret scan in CI, plus weekly; Dependabot update pull requests.

## Decisions and work needed before launch

- [ ] **Two-factor sign-in** for Super Admins (required) and Owners/Administrators (offered). (U1)
- [ ] Hosting chosen and approved, in Botswana or meeting the Data Protection Act's transfer rules. (U2)
- [ ] HTTPS on every address; HSTS confirmed in a browser.
- [ ] `TRUST_PROXY` matches the real proxy chain (load balancer → web app → API), checked by signing in from two networks and confirming the audit log shows two different addresses. (U5)
- [ ] Firewall or CDN in front of the site for large-scale attack protection. (U5)
- [ ] Separate database accounts: migrations/owner vs. the API's runtime account (cannot alter tables or disable triggers). (U3)
- [ ] Secrets (database password, email provider key, any AI key) kept in the host's secret manager; nobody keeps copies in chat, email or documents.
- [ ] Real email provider configured (`MAIL_TRANSPORT`), with SPF/DKIM/DMARC for the sending domain.
- [ ] Backups: encrypted, in-country, access limited to named people, restore tested, retention agreed. (U7)
- [ ] Monitoring and alerts: error rate, 429 spikes, failed sign-in spikes, health checks.
- [ ] Log retention period agreed (data-protection requirement) and applied by the host.
- [ ] Document parsing moved to an isolated worker, or the residual risk accepted in writing. (U4)
- [ ] First Super Admin created with the command-line bootstrap only; the account's email is a named person's, not shared.
- [ ] Latest "Security scans" run is green and its reports were read; open Dependabot pull requests reviewed.
- [ ] Independent penetration test, or a documented decision to launch without one. (U11)
- [ ] Incident plan: who is called, how to suspend an organisation or user, how to rotate secrets, how to tell affected organisations and the regulator.

## After launch (recurring)

- [ ] Monthly: review Super Admin accounts and Owners of each organisation; remove leavers.
- [ ] Monthly: read the platform audit log for unusual activity (support access, suspensions, bulk invitations).
- [ ] Weekly: security scan results and Dependabot pull requests.
- [ ] Every release: CI green, including browser tests; no new public routes without review.
- [ ] Twice a year: restore a backup into a test environment.
