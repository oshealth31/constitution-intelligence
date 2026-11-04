# Is Constitution Intelligence ready to accept paying pilot clients?

Assessment: 4 November 2026, after Stage 15. Evidence: Stage 13 QA report (480 automated tests
passing), Stage 14 deployment check and readiness review, and this stage's process review.

## Answer: **Not yet**

**The product can do what a pilot needs. The service cannot run yet.** Taking money now would
mean charging for something that cannot be delivered.

### Blockers (must be fixed before the first invoice)

| #   | Blocker                                                                  | Why it blocks a paying pilot                                                                                                                                               | Size                                                        |
| --- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| B1  | **Email: built, not connected.** SMTP sending (Brevo) added in task D1 and tested; Brevo account, verified domain and a live test outstanding | Until connected, invitations and password resets cannot reach people. | Setup S3 (about an hour, plus DNS waiting time) |
| B2  | **Not hosted**                                                           | There is no live portal to activate (process 6). Planned: Oracle Cloud free tier, Johannesburg, with a domain name.                                                        | Setup, following docs/operations/deployment.md              |
| B3  | **Agreement not reviewed**                                               | Payment, cancellation, ownership and data-protection terms are proposals only. Charging without a reviewed agreement exposes both sides.                                   | Lawyer in Botswana (and an accountant for VAT and invoices) |
| B4  | **Data-protection groundwork**                                           | Controller/processor roles, privacy notice for members, transfer basis for hosting in South Africa, possible need to keep a copy in Botswana, sensitive data for churches. | Lawyer + your decisions                                     |
| B5  | **No two-factor sign-in for Super Admins**                               | One stolen password would expose every pilot organisation.                                                                                                                 | Development                                                 |
| B6  | **Operations not running**                                               | No monitoring, no off-site backup copy, no restore test on the real server, no named responders. Support promises in the templates could not be kept.                      | Setup + one restore test                                    |

### Needed before the first organisation **leaves** (within 60 days of the first activation)

| #   | Item                                                                      |
| --- | ------------------------------------------------------------------------- |
| L1  | Data deletion tool, reviewed and tested (process 12 is manual until then) |
| L2  | Post-pilot prices set in Control Centre → Plans (currently "not set")     |

### Not blocking a small pilot, but tell clients (already in the limitations template)

AI answering off; Chrome-only testing; no self-service deletion; manual payment checks; no
uptime guarantee; the 14.1.3-style nesting needs manual review.

## What _is_ ready (and tested)

- Branded portals for several organisations, kept strictly apart (tested in API and browser
  tests with two fictional organisations).
- Upload, extraction, review, approval and publishing with separate roles, all recorded.
- Search, "Find relevant clauses", approved answers, simple words, offline reading.
- Pilot subscriptions with end dates, grace periods and restriction; one-off invoices with a
  configurable amount (so "from P1,500" needs no code); payment reporting and verification;
  receipts.
- Organisation export (tested on fictional data).
- Production images, HTTPS setup, encrypted backups and a restore test on a throwaway
  environment.
- Processes and templates in this folder.

## What you can do now, honestly

1. **Sign letters of intent, not invoices.** Approach the 5–6 organisations with the demo (on
   fictional data), the limitations sheet and a non-binding letter of intent: "we intend to join
   the founding pilot at P[ ] when the service is live". Take no payment until activation day.
2. **Order of work:** B1 email and B5 two-factor (development) → B3/B4 lawyer review (in
   parallel) → B2 hosting → B6 operations and a restore test → first activation with RBPC
   → the other organisations one or two at a time.
3. Re-run this assessment when B1–B6 are done. The answer should then be **"Ready with
   conditions"**: L1 and L2 done within the first pilot.
