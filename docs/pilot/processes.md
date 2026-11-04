# Founding pilot processes

For the first 5–6 paying organisations, 60 days each. "CI" = Constitution Intelligence staff
(Platform Super Admin in the Control Centre). Each step says what the system does **today**;
where it does not do something, the step says so and gives the manual way. Technical
details are in [../operations/](../operations/).

## Pricing (configurable)

The founding pilot fee is **from P1,500 per organisation** for 60 days. It is not built into the
software: CI enters the agreed amount on each organisation's invoice (Control Centre → the
organisation → Billing → **Issue an invoice**: description, amount, due date). The pilot
subscription itself is "not billed", so the invoice is the only charge. Change the standard
price by changing this document and the agreement template; no code changes are needed. Tax
(VAT) treatment: confirm with an accountant ⚖️.

## 1. Organisation onboarding checklist

| #   | Step                                                                                       | Who              | Done when                                            |
| --- | ------------------------------------------------------------------------------------------ | ---------------- | ---------------------------------------------------- |
| 1   | Discovery call: needs, number of members, constitution available, decision-maker           | CI               | Notes in the client file                             |
| 2   | Demonstration ([demo script](templates/demonstration-script.md))                           | CI               | Organisation wants to proceed                        |
| 3   | Pilot limitations shared and acknowledged ([limitations](templates/pilot-limitations.md))  | CI → org         | Written acknowledgement                              |
| 4   | Pilot agreement signed ([requirements](templates/pilot-agreement-requirements.md))         | Both             | Signed copy filed                                    |
| 5   | Onboarding form completed ([form](templates/customer-onboarding.md))                       | Org              | All sections filled in                               |
| 6   | Organisation created in the Control Centre (name, portal address)                          | CI               | Onboarding checklist appears                         |
| 7   | Subscription set: Pilot plan, start date, **end date = start + 60 days**                   | CI               | Subscription page shows "Pilot subscription until …" |
| 8   | Invoice issued for the agreed fee, due within 7 days                                       | CI               | Invoice INV-YYYY-NNNN visible to the owner           |
| 9   | Constitution submitted with permission (process 2)                                         | Org              | Files received                                       |
| 10  | Branding (process 3)                                                                       | CI or org        | Preview approved                                     |
| 11  | Owner invited (process 7)                                                                  | CI               | Owner signed in                                      |
| 12  | Extraction and review (process 4); approval and publishing (process 5)                     | Org (CI assists) | Version published                                    |
| 13  | Payment verified (process 10) and portal activated (process 6)                             | CI               | Members can sign in                                  |
| 14  | Members invited (process 7); training session held                                         | Org, CI          | Agreed members have access                           |
| 15  | Day-30 check-in; day-55 completion review ([report](templates/pilot-completion-report.md)) | Both             | Report filed                                         |

## 2. Constitution submission and permission

1. The organisation sends its **current registered constitution** (PDF or Word, up to 10 MB;
   typed text works far better than scans: scanned pages without text cannot be read), plus
   any amendments in force, and says which version is current.
2. With it, an authorised office-bearer confirms in writing (onboarding form, section C):
   - the organisation owns or may use the documents and allows CI to store and process them
     to provide the portal;
   - which document is the official version;
   - who may approve content (names and roles).
3. CI never uploads a document before this confirmation. Documents arrive by email or a
   shared folder the organisation controls; CI deletes its working copies once uploaded.
4. If only a paper or scanned copy exists, CI may offer to type it (as done for RBPC). The
   typed version must be checked against the original and approved by the organisation; it
   is labelled as a typed copy.

## 3. Branding setup

1. Collect (onboarding form, section D): display name, short tagline, logo (PNG, JPEG or
   WebP, up to 512 KB, square works best; SVG is not accepted), three colours (primary,
   secondary, accent as hex codes) and a welcome message (plain text, up to 1,000 characters).
2. CI or the owner enters them: Control Centre → organisation → Branding, or portal →
   Manage → Branding. The page warns when colours are hard to read; choose another colour
   rather than ignore the warning.
3. Check the preview and the real sign-in page `/o/<address>/sign-in` on a phone.
4. The organisation approves the look in writing (email is enough).

## 4. Content extraction and review

1. Owner or Administrator: Manage → Documents → upload. The text is extracted automatically and
   saved as a **draft** that members cannot see.
2. A Content Reviewer (named by the organisation; CI may assist but does not approve) compares
   every section with the original: clause numbers, sub-clauses, schedules, tables. Sections
   marked "Check this" must be confirmed before the version can go further. Known limitation:
   lettered items under roman-numeral items can be nested wrongly (seen in RBPC 14.1.3); check
   these by hand.
3. Corrections are made in the review screen; each change is recorded.
4. The reviewer ticks "I have compared this text with the original document" and sends it for
   approval.
5. Optional: approved answers and simple-words texts are imported as drafts (CI may prepare
   drafts; they are labelled as drafted with AI help when they were) and reviewed the same way
   against the linked clauses.

## 5. Organisation approval

1. An Owner or Administrator reads the reviewed version and either **approves** it (with a
   note) or **requests changes** (it goes back to draft).
2. Approval does not publish. **Publishing** is a separate, confirmed step; the previous
   version, if any, is kept as superseded.
3. Approved answers and simple words: each one is approved individually by an Owner or
   Administrator after ticking that they read it against the original clause; their name is
   recorded.
4. The organisation, not CI, takes these decisions. CI records in the client file who approved
   and when (the audit log shows it too).

## 6. Portal activation

The portal is "active" when all of these are true. Check them in this order:

| Check                                                                                      | Where                                   |
| ------------------------------------------------------------------------------------------ | --------------------------------------- |
| Organisation status is active                                                              | Control Centre → organisation           |
| Subscription is Pilot with the right end date, and the invoice is paid (verified)          | Control Centre → organisation → Billing |
| A version is published                                                                     | Manage → Documents                      |
| Branding approved                                                                          | Process 3                               |
| Owner can sign in; one test member account can sign in, read, search, and use Find clauses | Portal                                  |
| Organisation told the address and the activation date (= day 1 of 60)                      | Email to the pilot contact              |

Record the activation date. The 60 days count from it; if activation is later than the
subscription start, CI moves the subscription end date accordingly.

## 7. User access

1. Roles: Owner (everything), Administrator (members, content, branding, approval), Content
   Reviewer (checks text, cannot approve), Member (reads), Auditor (reads members, billing and
   the activity log). Give the lowest role that works.
2. CI invites the first Owner from the Control Centre; Owners and Administrators invite
   everyone else (Manage → Members). Invitations are valid for 7 days; at most 50 per hour per
   organisation.
3. **Invitations and password resets are sent by email. No email provider is integrated yet**, so
   until it is, invitations cannot reach people. See the readiness assessment. This must be
   fixed before the first pilot starts.
4. People leaving: an Owner or Administrator removes them from the organisation (Manage →
   Members); their access to it ends at once. CI checks each organisation's Owners monthly.
5. Lost access: "Forgot password" on the sign-in page (needs email, as above). CI never sets or
   asks for anyone's password.

## 8. Customer feedback

There is **no feedback form inside the portal** for the pilot (the "Was this helpful?" buttons
belong to AI answers, which are switched off). Feedback is collected outside the system:

1. Day 14: short check-in call with the pilot contact.
2. Day 30: [feedback form](templates/customer-feedback.md) to the pilot contact and up to 10
   members (paper, email or an online form that keeps responses in an approved location).
3. Day 55: completion review ([report](templates/pilot-completion-report.md)).
4. CI logs every item (date, organisation, source, request, decision) in a feedback register;
   nothing identifies individual members in shared summaries.

## 9. Support requests

There is **no ticketing system inside the product**. Support works as described in
[templates/support-process.md](templates/support-process.md): the pilot contact reports by
email or WhatsApp, CI logs each request with a reference (SUP-YYYY-NNN), and CI uses the
Control Centre (Support page: failed sign-ins, expired invitations, organisations without an
owner; Audit log) to investigate. Access to an organisation's constitution text by CI needs a
reason (the support reference) and is recorded in that organisation's own activity log.

## 10. Subscription expiry and renewal

What the system does today, from the code:

- The pilot ends on the subscription end date. Then the **grace period** of the Pilot plan
  (currently 7 days) starts: everything keeps working, with a notice.
- An invoice not paid by its due date has the same effect: grace period, then restriction.
  A payment **reported** by the organisation does not count until CI has **verified** it
  against the bank or mobile-money statement.
- After the grace period, access is **restricted**: members cannot use the portal; Owners and
  Administrators can only read. Nothing is deleted.
- Pilots are not renewed as pilots. To continue, CI moves the organisation to a paid plan
  (Standard or Premium, monthly or annual, prices set in Control Centre → Plans, currently "not
  set") and issues the invoice. Prices for after the pilot must be decided before day 45.

Process: day 45, CI sends the continuation offer; day 55, completion review; by day 60, the
organisation chooses: continue (paid plan) or leave (process 11, then 12).

## 11. Data export

On request, and always when an organisation leaves: CI runs the export
([../operations/offboarding-and-retention.md](../operations/offboarding-and-retention.md)).
It contains that organisation's records (constitutions, versions, sections, approvals,
answers, simple words, members' names, emails and roles, invitations, subscription, invoices,
payments, activity log) and its original files, encrypted. It excludes passwords, sessions,
link tokens and members' private AI questions. Tested on fictional data: it contains only the
chosen organisation. Hand-over: decrypted by CI on a trusted computer, then sent to the Owner
in a password-protected archive, with the password sent by a different channel. Record the
date and recipient.

## 12. Data deletion

**There is no deletion tool yet.** Until there is, deletion requests are handled like this, and
the agreement must say so:

1. Access is restricted (cancel the subscription) and the data exported (process 11).
2. After the agreed retention period (proposed 90 days after access ends, unless the
   organisation asks for earlier deletion in writing), CI deletes the organisation's data using
   a reviewed, two-person procedure, keeping invoices and payment records as financial records.
3. Data remains inside encrypted backups until they expire (35 days), then it is gone.
4. CI confirms the deletion to the Owner in writing.

Building and testing the deletion tool before the first organisation leaves (day 60 of the
first pilot at the latest) is part of the readiness conditions.
