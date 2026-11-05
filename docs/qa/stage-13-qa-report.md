# Stage 13: full system QA report

Date: 4 November 2026. Code: `main` after Stage 12 (PR #24) plus the Stage 13 changes in this
pull request. Everything ran against throwaway databases with fictional data. Nothing was
deployed and no live system was touched.

**Only tests that actually ran are counted as passed.** Every number below comes from the
machine-readable results of the "QA results" workflow (`.github/workflows/qa-results.yml`),
summarised with `scripts/qa-summary.py`:

| Run                   | GitHub Actions run | Result                                                                 |
| --------------------- | ------------------ | ---------------------------------------------------------------------- |
| 1 (before fixes)      | 41761959247        | 480 tests: 473 passed, **7 failed**                                    |
| 2 (after first fixes) | 41762925363        | 480 tests: 478 passed, **2 failed**                                    |
| 3 (final)             | 41763528294        | 480 tests: **480 passed**, 0 failed, 0 passed only on retry, 0 skipped |

The normal CI checks on the pull request (lint, type-check, all tests, build, formatting,
dependency audit, secret scan, browser tests) run separately.

## What was tested, and how

**Fictional organisations:** _Sample Community Choir_ and _Sample Netball Club_ (browser tests),
plus organisations created fresh by each API test suite.

**Users and roles:** Platform Super Admin, Owner, Administrator, Content Reviewer, Member and
Auditor in the choir; Owner and Member in the netball club; plus suspended, deactivated and
invited users created by the tests.

**Test levels:**

| Level                | What it is                                                                  | Tests (run 3) |
| -------------------- | --------------------------------------------------------------------------- | ------------- |
| Unit                 | Single functions: parsers, checks, formatting, configuration, access tables | 185           |
| Integration / API    | The real API against a real PostgreSQL database, over HTTP                  | 231           |
| End-to-end (browser) | Chromium driving the real web app, API and database                         | 64            |
| **Total**            |                                                                             | **480**       |

Positive and negative cases were both tested on purpose. Most suites are mostly negative:
wrong role, other organisation, bad input, expired links, over the limit, suspended
subscription.

## Results by area

A test can count towards more than one area (for example a cross-organisation upload test
counts for both Tenant isolation and Constitution upload).

| Area                      | Result                       | Tests passed | Examples of what was checked (✓ positive, ✗ negative)                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------- | ---------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Authentication            | **Passed**                   | 25           | ✓ sign-in sets a secure cookie; ✓ reset link; ✓ password change signs out other devices. ✗ wrong password and unknown email answer the same; ✗ suspended accounts refused; ✗ lock after 5 tries; ✗ expired links; ✗ idle sessions expire; ✗ empty form not sent (browser)                                                                                                                                                |
| Roles and permissions     | **Passed**                   | 65           | ✓ each of the 5 roles sees exactly its Manage sections (browser). ✗ sections opened by address refused; ✗ member/auditor API writes refused; ✗ an Administrator cannot grant Owner; ✗ organisation roles refused by the Control Centre; ✓ every route has an access rule                                                                                                                                                 |
| Organisation onboarding   | **Passed**                   | 21           | ✓ Super Admin creates an organisation with a pilot subscription and onboarding checklist, configures branding, invites an administrator. ✗ duplicate address refused; ✗ owners/members refused by every Control Centre route                                                                                                                                                                                             |
| Tenant isolation          | **Passed**                   | 40           | ✗ choir member opening the netball portal sees "not a member", and the reverse (browser); ✗ choir Owner using the netball club's ID gets 404 on 7 API routes (browser); ✗ database row security, search, AI, offline, files, answers, invoices all refuse other organisations (API)                                                                                                                                      |
| Branding                  | **Passed**                   | 58           | ✓ each organisation shows its own branding; ✓ PNG logo served safely. ✗ SVG/HTML refused; ✗ over 512 KB refused; ✗ bad colour codes; ✗ members/reviewers/auditors cannot change it                                                                                                                                                                                                                                       |
| Constitution upload       | **Passed**                   | 18           | ✓ PDF and Word stored privately as a draft. ✗ unsupported, mislabelled, empty, oversized and unsafe files refused; ✗ members/auditors cannot upload; ✗ upload to another organisation refused                                                                                                                                                                                                                            |
| Text extraction           | **Passed**                   | 39           | ✓ Word numbering, PDF lines, headings, lettered sub-clauses. ✗ uncertain results flagged; ✗ unreadable documents marked failed; ✗ archives that would expand too far, macro-enabled, damaged and script-carrying files refused                                                                                                                                                                                           |
| Content approval          | **Passed**                   | 52           | ✓ draft → review → approve → publish. ✗ reviewers cannot approve; ✗ flagged sections block submission; ✗ approved versions cannot be changed, even in the database; ✗ approved answers and simple words need confirmation and are refused when they mention unlinked clauses                                                                                                                                             |
| Version management        | **Passed**                   | 27           | ✓ publishing supersedes the previous version; ✓ search, AI and offline switch to the new version at once; ✓ answers and simple words carried over only for unchanged clauses. ✗ the current version cannot be archived                                                                                                                                                                                                   |
| Search                    | **Passed**                   | 43           | ✓ by title, word, clause number, sub-clause reference; exact excerpts. ✗ no match explained; ✗ drafts never searched; ✗ other organisations never returned                                                                                                                                                                                                                                                               |
| AI answers and citations  | **Passed (test model only)** | 42           | ✓ exact quotes with source and version; ✓ "Find relevant clauses" with AI off. ✗ invented clauses, quotes and numbers rejected; ✗ instructions hidden in the constitution ignored; ✗ instructions never revealed; ✗ other organisations' text never sent. **The real AI provider was not called (see below).**                                                                                                           |
| Subscription entitlements | **Passed**                   | 34           | ✓ active, pilot and grace periods work. ✗ after grace members are blocked and admins read-only; ✗ suspended blocks everyone; ✗ features outside the plan refused by the server; ✗ limits on members, documents and AI questions; ✗ card numbers never accepted                                                                                                                                                           |
| Online/offline            | **Passed (Chromium)**        | 15           | ✓ save, read and search offline; ✓ last-sync and outdated notices; ✓ refresh when back online. ✗ no personal data in the offline copy; ✗ nothing from /api or /admin cached; ✗ sign-out clears it; ✗ suspended subscription stops downloads                                                                                                                                                                              |
| Mobile responsiveness     | **Passed (emulated)**        | 7            | ✓ 25 pages checked on a 360 × 740 phone screen for all four kinds of user: none scrolls sideways. Phone navigation and large section buttons. **Failed in run 1, fixed (see below).**                                                                                                                                                                                                                                    |
| Error handling            | **Passed**                   | 83           | ✗ unknown portal, unknown API route (structured error with a request ID, no stack trace), made-up reset link, ended session (back to sign-in), wrong password, malformed input not echoed back, AI provider errors hidden, unexpected errors hide internal details, database down → health check 503 without details                                                                                                     |
| Accessibility             | **Passed (automated scan)**  | 5            | ✓ 25 pages scanned with axe-core (WCAG 2.1 A and AA): **0 violations of any severity** in run 3. **Failed in run 1, fixed (see below).** No manual screen-reader test (see "Not tested").                                                                                                                                                                                                                                |
| Security controls         | **Passed**                   | 46           | Headers and Content Security Policy, CSRF, CORS, rate limits, Super Admin session limits, `__Host-` cookie, injected markup cannot run code, configuration safety rules                                                                                                                                                                                                                                                  |
| Audit logs                | **Passed**                   | 28           | ✓ owners, admins and auditors can read their organisation's log; ✓ Super Admin content access is recorded in the organisation's own log; ✓ events filter by organisation, action and outcome. ✗ reviewers and members refused; ✗ each organisation sees only its own events; ✗ cannot be updated, deleted or truncated, even directly in the database; ✗ questions and answers kept out; ✓ unknown sign-in emails masked |

## Failed: problems QA found, and what happened to them

All seven failures from run 1 were real problems, not test faults, except where marked. All
were fixed and passed in run 3.

| #   | Found    | Problem                                                                                                                                                                                                                                                                                                                                      | Fix                                                                                                                                      |
| --- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Run 1    | **Colour contrast (accessibility):** teal text and badges (`#138a8a`) were 3.5–4.2 : 1 against white, ivory and light-teal backgrounds, below the WCAG AA minimum of 4.5 : 1. Seen on 9 pages: forgot password, unknown portal, portal finder, approved answers, subscription, Control Centre overview, organisations, plans, system health. | Teal-600 darkened to `#0e6f6f` (5.0–6.0 : 1 on every light background). Teal on navy already used the lighter teal-500 and is unchanged. |
| 2   | Run 1    | **Button names (accessibility):** the reader's "A−" / "A+" buttons were announced as "Smaller text" / "Larger text", so voice-control users saying what they see ("click A plus") would not reach them.                                                                                                                                      | Names now include the visible text ("A+ Larger text").                                                                                   |
| 3   | Run 1    | **Phone layout:** the owner's Branding page was 8 px wider than a 360 px screen.                                                                                                                                                                                                                                                             | Grid columns may now shrink below their content width.                                                                                   |
| 4   | Runs 1–2 | **Phone layout:** the Control Centre overview was 96 px too wide (statistics forced into two columns, cards could not shrink).                                                                                                                                                                                                               | One column on phones; cards may shrink. The test now names the widest elements when this happens.                                        |
| 5   | Run 1    | Password-reset error test timed out. **Test fault:** the field's label includes its hint text.                                                                                                                                                                                                                                               | Test corrected.                                                                                                                          |
| 6   | Run 2    | Same test found two "alert" regions. **Test fault:** Next.js adds its own page-change announcer.                                                                                                                                                                                                                                             | Test now checks for the exact message.                                                                                                   |

**Currently failing: none.**

## Not tested

| What                                       | Why                                                                                                                                                                                                                                                          |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Answers from a real AI model               | AI is off for launch (data protection decision), and no provider account is connected. AI behaviour was tested with a scripted test model and the built-in offline mode, which prove the checks around the model, not the quality of a real model's answers. |
| Real email delivery                        | No email provider yet; tests read the emails from the server's test outbox.                                                                                                                                                                                  |
| Real payments                              | No payment provider by design (manual verification). The manual workflow was tested.                                                                                                                                                                         |
| Browsers other than Chromium               | Firefox, Safari and Edge were not run. Safari matters most (iPhones), especially for offline reading. **Since task T1: Firefox, WebKit, iPhone and Android emulation run on every change (docs/qa/browser-support.md).**                                     |
| Real phones and tablets                    | Phone screens were emulated in Chromium, not tested on physical iOS or Android devices.                                                                                                                                                                      |
| Screen readers and keyboard-only use       | Automated scanning finds only part of accessibility problems. No manual test with NVDA, VoiceOver or TalkBack, and no full keyboard walkthrough.                                                                                                             |
| Load and performance                       | No load test (many users at once, large constitutions, slow networks).                                                                                                                                                                                       |
| Scanned (image-only) PDFs                  | Not supported (no text recognition); only the warning is tested.                                                                                                                                                                                             |
| The real RBPC constitution in the app      | Tested earlier outside the app (typed version, parser flags); not uploaded into a test run here.                                                                                                                                                             |
| Backup and restore, deployment, monitoring | Do not exist yet (deployment stage).                                                                                                                                                                                                                         |

## Blocked by environment

| What                                        | Blocker                                                                                                                                                                             |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Running tests in this development workspace | The workspace cannot reach the npm package registry, so dependencies cannot be installed here. Every test therefore ran in GitHub Actions; no result here comes from the workspace. |
| Real AI, email and payment services         | No accounts or network access for them in the test environment (and AI deliberately off).                                                                                           |
| GitHub code scanning (CodeQL)               | Not available for this private repository on the current plan.                                                                                                                      |

## Known limitations (accepted or open)

- **Clause 14.1.3 nesting:** lettered items under a roman-numeral item can be nested under the
  wrong parent by the text parser (found in the RBPC document). Reviewers can correct it by hand
  before approval. Not fixed in this stage. **Fixed later in task D9** (lists nest to any depth).
- **AI is off at launch:** members get approved answers and "Find relevant clauses" instead.
- **Two-factor sign-in, hosting, backups, separate database accounts, isolated document parsing**:
  open security items from Stage 12 (`docs/security/security-review.md`, U1–U12).
- **Offline copies** stay on a device until it reconnects or the person signs out
  (`docs/offline.md`).
- **Form hints are inside labels**, so screen readers read the hint as part of the field name.
  Allowed by WCAG and not flagged by the scan, but longer than ideal.
- **Development tools** (Vitest and others) have known vulnerabilities; nothing that ships is
  affected (Stage 12, U12). **Fixed later in task D10** (one low item without a fix remains).
- **Test data:** browser tests use one fixed seed; most API tests create their own data.

## How to repeat this QA

1. Push the branch to a name starting `tooling/qa-results` (for example `tooling/qa-results-4`).
2. When the "QA results" workflow finishes, it commits `qa-results/*.json` to that branch.
3. Run `python3 scripts/qa-summary.py qa-results` on those files for the tables above.
