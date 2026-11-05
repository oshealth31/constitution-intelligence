# Production readiness (Stage 14)

Assessment date: 4 November 2026 (updated for tasks D1, S3 and D2 on the same date). Based on
the code on `main`, the Stage 12 security review, the Stage 13 QA report and the Deployment check
workflow. **Nothing has been deployed**, and nothing may be deployed publicly without the owner's
approval.

## Go-live recommendation: **Not ready**

**The software is ready for a controlled pilot. The service around it is not.** The
application builds into production images, starts in production mode behind HTTPS, refuses
unsafe settings, and passed a full backup-and-restore test (on a throwaway runner with
fictional data). But a public go-live needs things that do not exist yet:

1. **No hosting.** No server, provider or location is chosen, so nothing about the real
   environment (network, firewall, provider access, in-country storage) has been checked.
2. ~~Email is built but not connected.~~ **Done:** SMTP sending (D1) and the Brevo account,
   authenticated domain `constitutionintel.com` and a live test that reached a Gmail inbox, not
   spam, with the link unchanged (S3, `email-live-test` workflow run 1). On the real server a new
   SMTP key is still to be made (the live-test key was deleted).
3. **Legal and data-protection groundwork is missing**: the agreements, privacy notice,
   impact assessment, controller/processor roles and breach procedure under the Data
   Protection Act, 2024. Church membership can reveal religious belief, which the Act treats
   as sensitive data.
4. ~~No two-factor sign-in.~~ **Done in task D2:** two-step sign-in with an authenticator app,
   required for Super Admins and offered to Owners and Administrators; tested in CI (API tests
   and phone-sized browser tests). Since task T1 the browser tests also run in Firefox, WebKit
   (Safari), an emulated iPhone and an emulated Android phone ([browser-support.md](../qa/browser-support.md)); real phones are task T4.
5. **Operations are documented, not running**: no monitoring, no alerts, no off-site backups,
   no named on-call people, and no restore test on real infrastructure.

### What would make it "Ready with conditions" (controlled pilot with RBPC only)

| #   | Condition                                                                                                                                   | Type             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| C1  | Hosting chosen and approved by the owner (in Botswana, or a destination the Act allows); server prepared per [deployment.md](deployment.md) | Decision + setup |
| C2  | ✅ Email: SMTP sending (D1) and Brevo account, authenticated domain, live test (S3). New SMTP key on the real server                        | Setup            |
| C3  | ✅ Two-step sign-in for Super Admins (D2). `MFA_ENCRYPTION_KEY` created on the real server and kept offline                                 | Development      |
| C4  | Pilot agreement with RBPC covering data protection roles, plus a privacy notice for members                                                 | Legal            |
| C5  | Off-site encrypted backup copy running, **and one restore test on the real server's backup recorded**                                       | Setup + test     |
| C6  | Uptime monitor and the critical alerts from [logging-and-monitoring.md](logging-and-monitoring.md) running; two named responders            | Setup            |
| C7  | Deployment check green on the release commit; owner's written go-ahead                                                                      | Approval         |

With C1–C7 met, a **pilot with one organisation**, a small group of known users, AI off and
manual payments is reasonable. Wider launch also needs the "Before general availability"
items below.

## Readiness checklist

✅ = done and evidenced; ⏳ = documented or prepared, not in place; ❌ = missing.

### Application and configuration

- ✅ Production configuration reviewed; the API refuses unsafe production settings (tested in CI and in the Deployment check)
- ✅ Production images for API, web and operations; unprivileged user; no secrets inside (checked)
- ✅ Development seed refuses to run in production; no development credentials in any image or template
- ✅ Secrets read from files (`*_FILE`), never from images or committed files ([secrets.md](secrets.md))
- ✅ HTTPS with automatic certificates, HTTP → HTTPS redirect, HSTS at three layers, TLS to the database with certificate verification (tested on a runner, not on a real domain)
- ✅ Client address read correctly through both proxies (`TRUST_PROXY=2`, tested)
- ✅ Application database account is not a superuser (tested)
- ✅ Structured logs without secrets or query strings; rotation configured
- ✅ Health checks (web, API live, API ready) with Docker health checks
- ✅ Separate migration and runtime database accounts (U3, D4; tested in the deployment check)
- ✅ Email sending through SMTP (D1), Brevo domain authenticated and a live test delivered to an inbox (S3)
- ✅ Two-step sign-in: required for Super Admins, offered to Owners and Administrators (D2; tested in CI, Chromium only)

### Data

- ✅ Encrypted backup of database and files, with manifest and checksums
- ✅ Restore procedure; **restore tested** on fictional data in a throwaway environment ([record](backup-and-restore.md#restore-test-record)); repeats weekly in CI
- ❌ Restore test on the real server's backups (C5)
- ⏳ Off-site backup copy (C5): script, checks, pruning and nightly timer built and tested against a test object store (D7); the location (S6) is not chosen and nothing runs on a real server yet
- ✅ Organisation export (tested: contains only that organisation, no password or token hashes)
- ✅ Organisation deletion tool with second-person approval or a 24-hour wait; tested in CI and in the deployment check, not yet on the real server ([offboarding-and-retention.md](offboarding-and-retention.md#deletion-task-d3))
- ⏳ Retention periods proposed, not confirmed by the data-protection review

### Operations

- ✅ Deployment, migration, rollback, maintenance, incident-response, onboarding and offboarding procedures written
- ❌ Server, DNS, firewall (C1)
- ❌ Monitoring and alerting running (C6)
- ❌ Named people for incidents and on-call (C6)
- ⏳ Release and change log in practice (procedure written)

## Unresolved requirements

### Legal

- Agreements with organisations: service terms, fees, liability, and the **data processing
  terms** (which party is the controller of members' data, and what Constitution Intelligence
  may do with it as processor).
- Terms of use and a **privacy notice** for members (what is collected, why, how long, rights).
- The "not legal advice" wording of approved answers and simple words: confirm with a lawyer.
- Accounting retention period for invoices and receipts.
- Payment handling: manual EFT/mobile-money verification only; any payment provider needs its
  own agreement.

### Privacy (Data Protection Act, 2024, Act No. 18 of 2024)

- Whether Constitution Intelligence and/or each organisation must **register** with the
  Information and Data Protection Commission. The Act provides for a register of data
  controllers, but the registration method had not been published when last checked.
- **Data protection impact assessment**, especially because church membership can reveal
  **religious belief** (sensitive personal data).
- Data Protection Officer: whether one is required, and who.
- **Breach notification within 72 hours** to the Commission. Procedure in
  [incident-response.md](incident-response.md); contacts still to be named.
- **Cross-border transfers**: hosting and backups in Botswana, or only to countries/safeguards
  the Act allows. This also covers outside services such as uptime monitors, email providers and
  GitHub (which holds code and fictional test data only, never production data).
- Data-subject requests (access, correction, deletion) from individual people: Control Centre tool (Task D11, [data-requests.md](data-requests.md)); deadlines and who answers still to be confirmed with a lawyer. Whole-organisation deletion has a tool (D3).
- AI stays off. Any AI provider outside Botswana needs a transfer assessment first (decided earlier).

### Security (from docs/security/security-review.md)

- ~~U1 two-step sign-in~~ (done, D2) · ~~U3 separate database accounts~~ (done, D4) · ~~U4 document parsing in an
  isolated process~~ (done, D8) · ~~U6 leaked-password check~~ (done, D5; the lock-out part of U6 remains) · ~~U8 tamper-evident audit copy~~ (done, D12; needs write-once off-site storage, S6) ·
  U11 independent penetration test before general availability · U12 development-tool
  vulnerabilities (done in task D10; one low item has no fix yet).

### Hosting

- Provider and location; data-centre security; who at the provider can access the server or disks.
- Off-site backup location; disk encryption at rest; snapshots.
- Firewall/DDoS protection in front of the site (U5).
- Sizing confirmed by a load test (not done, see the Stage 13 QA report).

### Operational

- Named incident lead, technical responder and data-protection contact, with backups.
- Support process for organisations (how they report problems, response times).
- Service levels: availability target, recovery point (proposed 24 h) and recovery time (proposed 4 h).
- Monthly and quarterly tasks scheduled with owners ([maintenance.md](maintenance.md)).
- Cleanup job for expired sessions and tokens (manual SQL until built).

## Before general availability (beyond the pilot)

Everything above, plus: penetration test; separate database accounts;
a load test; a tested Safari/iOS offline experience on a real iPhone (T4); the manual
screen-reader check (T2, [screen-reader-check.md](../qa/screen-reader-check.md)); payment-provider decision. (The 14.1.3 parser fix is done: task D9.)

## Sources

- [Data Protection in Botswana – DLA Piper](https://www.dlapiperdataprotection.com/?c=BW&t=law)
- [Botswana's Data Protection Act – Michalsons](https://www.michalsons.com/blog/botswanas-data-protection-act-grace-period-extended/60775)
- [Understanding Botswana's new Data Protection Act – Tech Hive Advisory](https://www.techhiveadvisory.africa/insights/understanding-botswanas-new-data-protection-act-key-updates-and-changes)

These summaries are not legal advice; a Botswana lawyer should confirm the requirements.
